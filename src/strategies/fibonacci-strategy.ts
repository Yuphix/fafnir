import { TradingStrategy, MarketCondition, TradeResult } from '../types.js';
import fs from 'fs-extra';
import path from 'node:path';
import { GSwap } from '@gala-chain/gswap-sdk';
import { signatures } from '@gala-chain/api';
import { GalaChainSwapAuth } from '../galachain-swap-auth.js';

// DCA Position Management interfaces
interface Position {
  token: string;
  amount: number;
  buyPrice: number;
  buyTime: number;
  fibLevel: number;
  targetSellPrice: number;
}

interface PriceHistory {
  price: number;
  timestamp: number;
}

export class FibonacciStrategy implements TradingStrategy {
  name = 'fibonacci';
  minVolumeRequired = 3;
  maxRisk = 0.4;

  private gswap: GSwap;
  private sequence = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
  private currentIndex = 0;
  private consecutiveWins = 0;
  private consecutiveLosses = 0;
  private baseTradeSize = 2; // $2 base (reduced from $5 for more frequency)
  private minProfitBps: number = Number(process.env.FIB_MIN_PROFIT_BPS || 20);
  private slippageBps: number = Number(process.env.FIB_SLIPPAGE_BPS || 40);
  private dryRun: boolean = String(process.env.FIB_DRY_RUN || 'true').toLowerCase() !== 'false';
  private wallet: string | undefined;
  private swapAuth: GalaChainSwapAuth;

  // DCA Position Management
  private positions: Position[] = [];
  private priceHistory: Record<string, PriceHistory[]> = {};
  private currentPrices: Record<string, number> = {};
  private targetToken = 'GALA';
  private stableToken = 'GUSDC';
  private maxPositionSize = Number(process.env.FIB_MAX_POSITION || 100); // $100 max position
  private takeProfitPercent = Number(process.env.FIB_TAKE_PROFIT || 6); // 6% take profit (reduced from 8%)
  private stopLossPercent = Number(process.env.FIB_STOP_LOSS || 15); // 15% stop loss
  private buyDrawdownPct = Number(process.env.FIB_BUY_DRAWDOWN_PCT || 3); // Buy on -3% 24h drops
  private buyLevels = [0.236, 0.382, 0.5, 0.618, 0.786]; // More Fibonacci levels for more opportunities

  // Multi-Pool GALA Focus
  private galaPools = [
    'GALA/GUSDC',   // Primary - highest volume
    'GALA/GUSDT',   // Secondary - stable pair alternative
    'GALA/GWETH',   // Tertiary - ETH exposure
    'GALA/GWBTC'    // Quaternary - BTC exposure (higher minimums)
  ];

  private coinGeckoId = 'gala'; // For external price reference

  constructor(walletAddress?: string) {
    // Use provided wallet address if available, else fallback to env var
    this.wallet = walletAddress || process.env.GALACHAIN_WALLET_ADDRESS || process.env.GSWAP_WALLET || process.env.GSWAP_WALLET_ADDRESS;

    // Initialize GSwap client for building swap payloads
    const gatewayUrl = process.env.GSWAP_GATEWAY_URL || 'https://gateway-mainnet.galachain.com';
    const dexBackendUrl = process.env.GSWAP_DEX_BACKEND_URL || 'https://dex-backend-prod1.defi.gala.com';
    const bundlerUrl = process.env.GSWAP_BUNDLER_URL || 'https://bundle-backend-prod1.defi.gala.com';

    this.gswap = new GSwap({
      gatewayBaseUrl: gatewayUrl,
      dexBackendBaseUrl: dexBackendUrl,
      bundlerBaseUrl: bundlerUrl,
      dexContractBasePath: '/api/asset/dexv3-contract',
      tokenContractBasePath: '/api/asset/token-contract',
      bundlingAPIBasePath: '/bundle'
    });

    // Initialize enhanced swap authorization
    this.swapAuth = new GalaChainSwapAuth();

    console.log(`🔢 Fibonacci Strategy initialized: Sequence position ${this.currentIndex + 1}/${this.sequence.length}`);
    console.log(`📊 Base trade size: $${this.baseTradeSize} | Min profit: ${this.minProfitBps}bps | Dry run: ${this.dryRun}`);
    console.log(`🎯 DCA enabled: Max position $${this.maxPositionSize} | Take profit ${this.takeProfitPercent}% | Stop loss ${this.stopLossPercent}%`);

    // Load existing positions and state
    this.loadPositions();
  }

  shouldActivate(marketCondition: MarketCondition): boolean {
    // Fibonacci strategy works best in trending markets with moderate volatility
    return marketCondition.volatility > 0.015 &&
           marketCondition.volatility < 0.04 &&
           marketCondition.volume > 30;
  }

  async execute(): Promise<TradeResult> {
    try {
      console.log(`🔢 DCA Fibonacci checking market conditions...`);

      // Update current GALA price from GalaSwap
      await this.updateCurrentPrice();

      // Check for sell opportunities first (take profits on existing positions)
      const sellResult = await this.checkSellOpportunities();
      if (sellResult.success) {
        this.updateSequencePosition(true);
        this.savePositions();
        return sellResult;
      }

      // Check for buy opportunities (accumulate GALA on Fibonacci dips)
      const buyResult = await this.checkBuyOpportunities();
      if (buyResult.success) {
        this.updateSequencePosition(true);
        this.savePositions();
        return buyResult;
      }

      // No opportunities found
      return {
        success: false,
        profit: 0,
        volume: 0,
        strategy: this.name,
        pool: 'no-opportunity',
        timestamp: Date.now()
      };

    } catch (error: any) {
      return {
        success: false,
        profit: 0,
        volume: 0,
        strategy: this.name,
        pool: 'error',
        timestamp: Date.now(),
        error: error.message || 'Unknown error'
      };
    }
  }

  private calculateTradeSize(): number {
    // Base size from Fibonacci sequence
    let size = this.sequence[this.currentIndex] * this.baseTradeSize;

    // Adjust based on recent performance
    if (this.consecutiveWins >= 3) {
      // After 3 wins, increase size more aggressively
      size *= 1.2;
    } else if (this.consecutiveLosses >= 2) {
      // After 2 losses, reduce size
      size *= 0.8;
    }

    // Ensure size is within reasonable bounds
    size = Math.max(3, Math.min(50, size));

    // Add some randomness to avoid detection
    size = size * (0.95 + Math.random() * 0.1);

    return Math.round(size * 100) / 100; // Round to 2 decimal places
  }

  private selectPool(): string {
    // Select pool based on current market conditions and Fibonacci pattern
    const pools = ['GUSDC/GALA', 'GALA/GUSDT', 'GUSDC/GUSDT'];

    // Use Fibonacci index to select pool
    const poolIndex = this.currentIndex % pools.length;
    return pools[poolIndex];
  }

  private async executeTrade(pool: string, tradeSize: number): Promise<{ success: boolean; profit: number }> {
    const [tokenIn, tokenOut] = pool.split('/');
    console.log(`🔢 Fibonacci Strategy: Trading ${tradeSize} ${tokenIn} → ${tokenOut}`);
    console.log(`📊 Sequence position: ${this.currentIndex + 1}/${this.sequence.length}`);

    try {
      // Parse pool to get tokens
      const [tokenIn, tokenOut] = pool.split('/');
      const tIn = this.getTokenString(tokenIn);
      const tOut = this.getTokenString(tokenOut);

      console.log(`🔍 Getting real quote for ${tradeSize} ${tokenIn} → ${tokenOut}`);

      // Find best fee tier for this pair
      const feeTiers = [500, 3000, 10000];
      let bestQuote = null;

      for (const feeTier of feeTiers) {
        try {
          const quote = await this.gswap.quoting.quoteExactInput(tIn, tOut, tradeSize.toString(), feeTier);
          const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);

          if (!bestQuote || outAmount > Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount)) {
            bestQuote = quote;
          }
        } catch (error) {
          continue;
        }
      }

      if (!bestQuote) {
        throw new Error(`No pools found for ${tokenIn} → ${tokenOut}`);
      }

      const quote = bestQuote;
      const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);

      console.log(`   ✅ Real Quote: ${tradeSize} ${tokenIn} → ${outAmount.toFixed(6)} ${tokenOut}`);

      // Calculate potential edge via round-trip using the discovered fee tier
      const inputValue = tradeSize;
      const outputValue = outAmount;

      const currentPrice = outputValue / inputValue;
      console.log(`   💱 Current Market Price: ${currentPrice.toFixed(6)} ${tokenOut}/${tokenIn}`);

      // Discover best reverse fee tier independently
      let reverseOut = 0;
      let reverseFeeTier: number | null = null;
      for (const ft of [500, 3000, 10000]) {
        try {
          const rq = await this.gswap.quoting.quoteExactInput(tOut, tIn, outAmount.toString(), ft);
          const ra = Number((rq as any).outTokenAmount?.toString?.() ?? rq.outTokenAmount);
          if (ra > reverseOut) { reverseOut = ra; reverseFeeTier = ft; }
        } catch {}
      }

      const edgeBps = Math.round(((reverseOut - inputValue) / inputValue) * 10000);
      const thresholdBps = this.minProfitBps;
      let success = edgeBps >= thresholdBps;
      let profit = success ? (reverseOut - inputValue) : 0;

      // Threshold/execution flag summary
      console.log(`   ✅ Meets threshold: ${edgeBps}bps ${edgeBps >= thresholdBps ? '>=' : '<'} ${thresholdBps}bps | willExecute=${success && !this.dryRun ? 'yes' : 'no'} (dryRun=${this.dryRun})`);

      // Write single-file dry-run artifact
      if (this.dryRun) {
        try {
          const logsDir = path.join(process.cwd(), 'logs');
          const dryDir = path.join(logsDir, 'dryruns');
          fs.ensureDirSync(dryDir);
          const summary = {
            strategy: 'fibonacci',
            pool,
            feeTier: (quote as any).feeTier ?? 3000,
            input: tradeSize,
            quotedOut: outAmount,
            reverseQuoted: reverseOut,
            edgeBps,
            thresholdBps,
            slippageBps: this.slippageBps,
            success,
            profit,
            timestamp: new Date().toISOString()
          };
          const file = path.join(dryDir, `dryrun_enhanced_${Date.now()}_fibonacci.json`);
          fs.writeFileSync(file, JSON.stringify(summary, null, 2));
        } catch {}
      }

      // Optional live execute single-direction leg if we have an edge
      if (success && !this.dryRun) {
        const minOut = outAmount * (1 - this.slippageBps / 10000);
        console.log(`   🧾 Building swap ${tokenIn}→${tokenOut} | fee ${((quote as any).feeTier ?? 3000)}bps | exactIn=${tradeSize} | minOut=${minOut.toFixed(6)} | quotedOut=${outAmount.toFixed?.(6) ?? outAmount}`);
        try {
          console.log(`   🚀 Executing Fibonacci swap with proper authorization`);
          const swapResult = await this.swapAuth.executeSwap({
            tokenIn: tIn,
            tokenOut: tOut,
            amountIn: tradeSize.toString(),
            amountOutMinimum: minOut.toString(),
            feeTier: ((quote as any).feeTier ?? 3000),
            recipient: this.wallet || '',
            slippageBps: this.slippageBps
          });

          if (swapResult.success) {
            console.log(`   ✅ Fibonacci swap completed: ${swapResult.transactionId}`);
            console.log(`   💰 Expected out: ${outAmount.toFixed(6)}, Actual: ${swapResult.actualAmountOut || 'pending'}`);

            // Update the actual profit based on real execution
            if (swapResult.actualAmountOut) {
              const actualOut = Number(swapResult.actualAmountOut);
              profit = actualOut - tradeSize; // Recalculate based on actual output
              console.log(`   📊 Updated profit: $${profit.toFixed(4)}`);
            }
          } else {
            console.log(`   ❌ Fibonacci swap failed: ${swapResult.error}`);
            success = false;
            profit = 0;
          }
        } catch (execErr: any) {
          console.log(`   ❌ Authorized execution failed: ${execErr.message || execErr}`);
          success = false;
          profit = 0;
        }
      }

      if (success) {
        console.log(`✅ Fibonacci edge detected: +${(edgeBps/100).toFixed(2)}bps, profit ≈ $${profit.toFixed(4)}`);
      } else {
        console.log(`❌ No Fibonacci edge: ${(edgeBps/100).toFixed(2)}bps < ${(thresholdBps/100).toFixed(2)}bps`);
      }

      return { success, profit };

    } catch (error: any) {
      console.log(`❌ Error getting real quote: ${error.message}`);
      // No fallback - if quote fails, trade fails
      return { success: false, profit: 0 };
    }
  }

  private getTokenString(symbol: string): string {
    const TOKENS: Record<string, string> = {
      GALA: 'GALA|Unit|none|none',
      GUSDC: 'GUSDC|Unit|none|none',
      GWETH: 'GWETH|Unit|none|none',
      GWBTC: 'GWBTC|Unit|none|none',
      GUSDT: 'GUSDT|Unit|none|none'
    };

    const token = TOKENS[symbol];
    if (!token) throw new Error(`Unknown token symbol: ${symbol}`);
    return token;
  }

  private updateSequencePosition(success: boolean): void {
    if (success) {
      this.consecutiveWins++;
      this.consecutiveLosses = 0;

      // Move forward in sequence after wins
      if (this.consecutiveWins >= 2) {
        this.currentIndex = Math.min(this.currentIndex + 1, this.sequence.length - 1);
      }
    } else {
      this.consecutiveLosses++;
      this.consecutiveWins = 0;

      // Move backward in sequence after losses
      if (this.consecutiveLosses >= 2) {
        this.currentIndex = Math.max(this.currentIndex - 1, 0);
      }
    }
  }

  // Get current Fibonacci position for monitoring
  getCurrentPosition(): { index: number; sequence: number; tradeSize: number } {
    return {
      index: this.currentIndex,
      sequence: this.sequence[this.currentIndex],
      tradeSize: this.calculateTradeSize()
    };
  }

  // Get performance metrics for this strategy
  getPerformanceMetrics(): { consecutiveWins: number; consecutiveLosses: number; winRate: number } {
    const totalTrades = this.consecutiveWins + this.consecutiveLosses;
    const winRate = totalTrades > 0 ? (this.consecutiveWins / totalTrades) * 100 : 0;

    return {
      consecutiveWins: this.consecutiveWins,
      consecutiveLosses: this.consecutiveLosses,
      winRate
    };
  }

  // Reset strategy state (useful for testing or after significant losses)
  reset(): void {
    this.currentIndex = 0;
    this.consecutiveWins = 0;
    this.consecutiveLosses = 0;
    this.positions = [];
    console.log(`🔄 Fibonacci Strategy reset to initial state`);
  }

    // DCA Fibonacci Methods
  private async updateCurrentPrice(): Promise<void> {
    try {
      console.log(`🔍 Scanning ${this.galaPools.length} GALA pools for opportunities...`);

      // Get CoinGecko reference price
      const coinGeckoPrice = await this.getCoinGeckoPrice();

      // Check all GALA pools for best price and opportunities
      let bestPrice = 0;
      let bestPool = '';

      for (const pool of this.galaPools) {
        try {
          const [tokenIn, tokenOut] = pool.split('/');
          if (tokenIn !== 'GALA') continue; // Only check GALA as input for price discovery

          const tIn = this.getTokenString(tokenIn);
          const tOut = this.getTokenString(tokenOut);

          // Test with 1000 GALA tokens
          const testGalaAmount = 1000;
          const quote = await this.gswap.quoting.quoteExactInput(tIn, tOut, testGalaAmount.toString(), 10000);
          const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);

          if (outAmount > 0) {
            const poolPrice = outAmount / testGalaAmount;

            // Convert to USD if not already USD
            let usdPrice = poolPrice;
            if (tokenOut === 'GWETH') {
              usdPrice = poolPrice * 3300; // Approximate ETH price
            } else if (tokenOut === 'GWBTC') {
              usdPrice = poolPrice * 95000; // Approximate BTC price
            }

            console.log(`📊 ${pool}: 1 GALA = ${poolPrice.toFixed(8)} ${tokenOut} (~$${usdPrice.toFixed(6)})`);

            if (usdPrice > bestPrice) {
              bestPrice = usdPrice;
              bestPool = pool;
            }
          }
        } catch (error: any) {
          console.log(`⚠️ ${pool} quote failed: ${error.message}`);
        }
      }

      if (bestPrice > 0) {
        this.currentPrices[this.targetToken] = bestPrice;
        console.log(`💰 Best GALA price: $${bestPrice.toFixed(6)} from ${bestPool}`);

        // Compare with CoinGecko
        if (coinGeckoPrice) {
          const deviation = ((bestPrice - coinGeckoPrice) / coinGeckoPrice) * 100;
          console.log(`📈 CoinGecko ref: $${coinGeckoPrice.toFixed(6)} | Deviation: ${deviation.toFixed(2)}%`);
        }

        // Add to price history
        if (!this.priceHistory[this.targetToken]) {
          this.priceHistory[this.targetToken] = [];
        }

        this.priceHistory[this.targetToken].push({
          price: bestPrice,
          timestamp: Date.now()
        });

        // Keep only last 50 price points
        if (this.priceHistory[this.targetToken].length > 50) {
          this.priceHistory[this.targetToken] = this.priceHistory[this.targetToken].slice(-50);
        }

        console.log(`💰 Current ${this.targetToken} price: $${bestPrice.toFixed(6)}`);
      }
    } catch (error: any) {
      console.log(`⚠️ Price update failed: ${error.message}`);
    }
  }

  private async checkSellOpportunities(): Promise<TradeResult> {
    if (this.positions.length === 0) {
      console.log(`📈 No positions to sell`);
      return { success: false, profit: 0, volume: 0, strategy: this.name, pool: 'no-positions', timestamp: Date.now() };
    }

    const currentPrice = this.currentPrices[this.targetToken];
    if (!currentPrice) {
      return { success: false, profit: 0, volume: 0, strategy: this.name, pool: 'no-price', timestamp: Date.now() };
    }

    // Find positions ready to sell
    for (const position of this.positions) {
      const priceChange = (currentPrice - position.buyPrice) / position.buyPrice * 100;
      const shouldSell = (
        priceChange >= this.takeProfitPercent ||  // Take profit
        priceChange <= -this.stopLossPercent ||  // Stop loss
        currentPrice >= position.targetSellPrice // Target reached
      );

      if (shouldSell) {
        console.log(`🎯 Selling position: ${position.amount.toFixed(2)} ${position.token}`);
        console.log(`   Buy price: $${position.buyPrice.toFixed(6)} | Current: $${currentPrice.toFixed(6)} | Change: ${priceChange.toFixed(2)}%`);

        const sellResult = await this.executeSell(position);
        if (sellResult.success) {
          // Remove position from array
          this.positions = this.positions.filter(p => p !== position);
          return sellResult;
        }
      }
    }

    return { success: false, profit: 0, volume: 0, strategy: this.name, pool: 'no-sell-signal', timestamp: Date.now() };
  }

    private async checkBuyOpportunities(): Promise<TradeResult> {
    const currentPrice = this.currentPrices[this.targetToken];
    if (!currentPrice) {
      return { success: false, profit: 0, volume: 0, strategy: this.name, pool: 'no-price', timestamp: Date.now() };
    }

    // Calculate current position size
    const totalPositionValue = this.positions.reduce((sum, p) => sum + (p.amount * currentPrice), 0);
    if (totalPositionValue >= this.maxPositionSize) {
      console.log(`⏸️ Max position size reached: $${totalPositionValue.toFixed(2)}/$${this.maxPositionSize}`);
      return { success: false, profit: 0, volume: 0, strategy: this.name, pool: 'max-position', timestamp: Date.now() };
    }

        // Check if we're at a Fibonacci support level (good to buy)
    const fibLevel = this.calculateFibonacciLevel(currentPrice);
    if (fibLevel && fibLevel.isBuyLevel) {
      console.log(`🔢 Fibonacci buy signal at ${(fibLevel.level * 100).toFixed(1)}% retracement level`);

      // Find best pool for buying GALA
      const bestPool = await this.findBestBuyPool();
      if (bestPool) {
        console.log(`🎯 Best buy opportunity: ${bestPool.pool} (${bestPool.advantage.toFixed(2)}% advantage)`);

        const orderSize = this.calculateTradeSize();
        const buyResult = await this.executeBuyOnPool(bestPool.pool, orderSize);

        return buyResult;
      }
    }

    console.log(`📊 No buy signal - price: $${currentPrice.toFixed(6)}`);
    return { success: false, profit: 0, volume: 0, strategy: this.name, pool: 'no-buy-signal', timestamp: Date.now() };
  }

  private calculateFibonacciLevel(currentPrice: number): { level: number; isBuyLevel: boolean } | null {
    const history = this.priceHistory[this.targetToken];
    if (!history || history.length < 10) {
      return null; // Need some price history
    }

    // Get recent high and low (last 6 hours - more responsive)
    const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
    const recentPrices = history.filter(p => p.timestamp >= sixHoursAgo);

    if (recentPrices.length < 3) {
      return null;
    }

    const recentHigh = Math.max(...recentPrices.map(p => p.price));
    const recentLow = Math.min(...recentPrices.map(p => p.price));
    const range = recentHigh - recentLow;

    if (range === 0) {
      return null;
    }

    // Calculate where current price is in the range (0 = low, 1 = high)
    const positionInRange = (currentPrice - recentLow) / range;

    // Check if we're near a Fibonacci retracement level (buy opportunities)
    for (const buyLevel of this.buyLevels) {
      if (Math.abs(positionInRange - buyLevel) < 0.02) { // Within 2% of level (tighter tolerance)
        return { level: buyLevel, isBuyLevel: true };
      }
    }

    return null;
  }

        private async executeBuy(orderSizeUSD: number): Promise<TradeResult> {
    try {
      const currentPrice = this.currentPrices[this.targetToken];
      const pool = `GUSDC/GALA`;

      console.log(`🛒 Executing BUY: $${orderSizeUSD.toFixed(2)} GUSDC → ${this.targetToken}`);

      // executeTrade expects token amount for tokenIn
      // For GUSDC/GALA pool, we're trading GUSDC (USD amount) for GALA tokens
      const result = await this.executeTrade(pool, orderSizeUSD);

      if (result.success) {
        const tokenAmount = orderSizeUSD / currentPrice; // Calculate from USD amount and price
        const actualPrice = orderSizeUSD / tokenAmount;

        // Create position
        const position: Position = {
          token: this.targetToken,
          amount: tokenAmount,
          buyPrice: actualPrice,
          buyTime: Date.now(),
          fibLevel: this.currentIndex,
          targetSellPrice: actualPrice * (1 + this.takeProfitPercent / 100)
        };

        this.positions.push(position);

        console.log(`✅ BUY executed: ${tokenAmount.toFixed(2)} ${this.targetToken} at $${actualPrice.toFixed(6)}`);
        console.log(`🎯 Target sell price: $${position.targetSellPrice.toFixed(6)}`);

        return {
          success: true,
          profit: 0, // No immediate profit on buy
          volume: orderSizeUSD,
          strategy: this.name,
          pool: pool,
          timestamp: Date.now()
        };
      } else {
        return {
          success: false,
          profit: 0,
          volume: 0,
          strategy: this.name,
          pool: 'buy-failed',
          timestamp: Date.now()
        };
      }

    } catch (error: any) {
      return {
        success: false,
        profit: 0,
        volume: 0,
        strategy: this.name,
        pool: 'buy-error',
        timestamp: Date.now(),
        error: error.message
      };
    }
  }

    private async executeSell(position: Position): Promise<TradeResult> {
    try {
      const currentPrice = this.currentPrices[position.token];
      const pool = `GALA/GUSDC`;
      const expectedUSD = position.amount * currentPrice;

      console.log(`💰 Executing SELL: ${position.amount.toFixed(2)} ${position.token} → ~$${expectedUSD.toFixed(2)}`);

      // executeTrade expects token amount, so for GALA/GUSDC we pass the GALA token amount
      const result = await this.executeTrade(pool, position.amount);

      if (result.success) {
        const actualUSD = expectedUSD; // Use expected USD since executeTrade doesn't return actual amount
        const costBasis = position.amount * position.buyPrice;
        const profit = actualUSD - costBasis;
        const profitPercent = (profit / costBasis) * 100;

        console.log(`✅ SELL executed: ${position.amount.toFixed(2)} ${position.token} for $${actualUSD.toFixed(2)}`);
        console.log(`💰 Profit: $${profit.toFixed(2)} (${profitPercent.toFixed(2)}%)`);

        return {
          success: true,
          profit: profit,
          volume: actualUSD,
          strategy: this.name,
          pool: pool,
          timestamp: Date.now()
        };
      } else {
        return {
          success: false,
          profit: 0,
          volume: 0,
          strategy: this.name,
          pool: 'sell-failed',
          timestamp: Date.now()
        };
      }

    } catch (error: any) {
      return {
        success: false,
        profit: 0,
        volume: 0,
        strategy: this.name,
        pool: 'sell-error',
        timestamp: Date.now(),
        error: error.message
      };
    }
  }

  private loadPositions(): void {
    try {
      const stateFile = path.join(process.cwd(), 'logs', 'fibonacci-positions.json');
      if (fs.existsSync(stateFile)) {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        this.positions = state.positions || [];
        this.priceHistory = state.priceHistory || {};

        console.log(`📊 Loaded ${this.positions.length} existing positions`);
      }
    } catch (error: any) {
      console.log(`⚠️ Could not load positions: ${error.message}`);
    }
  }

  private savePositions(): void {
    try {
      const state = {
        positions: this.positions,
        priceHistory: this.priceHistory,
        timestamp: new Date().toISOString()
      };

      const stateFile = path.join(process.cwd(), 'logs', 'fibonacci-positions.json');
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch (error: any) {
      console.log(`⚠️ Could not save positions: ${error.message}`);
    }
  }

  private async findBestBuyPool(): Promise<{ pool: string; advantage: number } | null> {
    try {
      const buyPools = this.galaPools.map(pool => {
        const [tokenIn, tokenOut] = pool.split('/');
        return tokenOut === 'GALA' ? pool : `${tokenOut}/${tokenIn}`;
      }).filter(pool => pool.endsWith('/GALA'));

      let bestPool = '';
      let bestAdvantage = 0;

      for (const pool of buyPools) {
        try {
          const [tokenIn, tokenOut] = pool.split('/');
          const tIn = this.getTokenString(tokenIn);
          const tOut = this.getTokenString(tokenOut);

          // Test how much GALA we get for $10 worth of input token
          let testAmount = 10;
          if (tokenIn === 'GWETH') testAmount = 10 / 3300; // ~$10 worth of ETH
          if (tokenIn === 'GWBTC') testAmount = 10 / 95000; // ~$10 worth of BTC

          const quote = await this.gswap.quoting.quoteExactInput(tIn, tOut, testAmount.toString(), 10000);
          const galaOut = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);

          if (galaOut > 0) {
            const galaPerDollar = galaOut / 10;
            const advantage = ((galaPerDollar - (1 / this.currentPrices[this.targetToken])) / (1 / this.currentPrices[this.targetToken])) * 100;

            console.log(`🔍 ${pool}: ${galaOut.toFixed(2)} GALA for $10 (${advantage.toFixed(2)}% vs current price)`);

            if (advantage > bestAdvantage) {
              bestAdvantage = advantage;
              bestPool = pool;
            }
          }
        } catch (error: any) {
          console.log(`⚠️ ${pool} buy check failed: ${error.message}`);
        }
      }

      return bestAdvantage > 0 ? { pool: bestPool, advantage: bestAdvantage } : null;
    } catch (error: any) {
      console.log(`⚠️ Best pool search failed: ${error.message}`);
      return null;
    }
  }

  private async executeBuyOnPool(pool: string, orderSizeUSD: number): Promise<TradeResult> {
    try {
      const [tokenIn, tokenOut] = pool.split('/');
      const currentPrice = this.currentPrices[this.targetToken];

      console.log(`🛒 Executing BUY: $${orderSizeUSD.toFixed(2)} ${tokenIn} → ${tokenOut} on ${pool}`);

      // Convert USD to appropriate token amount
      let tokenAmount = orderSizeUSD;
      if (tokenIn === 'GWETH') tokenAmount = orderSizeUSD / 3300;
      if (tokenIn === 'GWBTC') tokenAmount = orderSizeUSD / 95000;

      const result = await this.executeTrade(pool, tokenAmount);

      if (result.success) {
        const galaAmount = orderSizeUSD / currentPrice; // Approximate GALA received
        const actualPrice = orderSizeUSD / galaAmount;

        // Create position
        const position: Position = {
          token: this.targetToken,
          amount: galaAmount,
          buyPrice: actualPrice,
          buyTime: Date.now(),
          fibLevel: this.currentIndex,
          targetSellPrice: actualPrice * (1 + this.takeProfitPercent / 100)
        };

        this.positions.push(position);

        console.log(`✅ BUY executed: ${galaAmount.toFixed(2)} ${this.targetToken} at $${actualPrice.toFixed(6)}`);
        console.log(`🎯 Target sell price: $${position.targetSellPrice.toFixed(6)}`);

        return {
          success: true,
          profit: 0, // No immediate profit on buy
          volume: orderSizeUSD,
          strategy: this.name,
          pool: pool,
          timestamp: Date.now()
        };
      } else {
        return {
          success: false,
          profit: 0,
          volume: 0,
          strategy: this.name,
          pool: 'buy-failed',
          timestamp: Date.now()
        };
      }

    } catch (error: any) {
      return {
        success: false,
        profit: 0,
        volume: 0,
        strategy: this.name,
        pool: 'buy-error',
        timestamp: Date.now(),
        error: error.message
      };
    }
  }

  private async getCoinGeckoPrice(): Promise<number | null> {
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${this.coinGeckoId}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const priceData = data[this.coinGeckoId];

      if (priceData && typeof priceData.usd === 'number') {
        const price = priceData.usd;
        const change24h = priceData.usd_24h_change || 0;
        const volume24h = priceData.usd_24h_vol || 0;

        console.log(`🦎 CoinGecko: $${price.toFixed(6)} | 24h: ${change24h.toFixed(2)}% | Vol: $${(volume24h / 1000000).toFixed(1)}M`);
        return price;
      }

      return null;
    } catch (error: any) {
      console.log(`⚠️ CoinGecko fetch failed: ${error.message}`);
      return null;
    }
  }

  private async getCoinGeckoData(): Promise<{ price: number; price_change_24h: number } | null> {
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${this.coinGeckoId}&vs_currencies=usd&include_24hr_change=true`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data || !data[this.coinGeckoId]) {
        return null;
      }

      const priceData = data[this.coinGeckoId];
      const price = priceData.usd;
      const priceChange24h = priceData.usd_24h_change || 0;

      return { price, price_change_24h: priceChange24h };
    } catch (error: any) {
      console.log(`⚠️ CoinGecko data fetch failed: ${error.message}`);
      return null;
    }
  }
}
