import { TradingStrategy, MarketCondition, TradeResult } from '../types.js';
import fs from 'fs-extra';
import path from 'node:path';
import { GSwap } from '@gala-chain/gswap-sdk';
import { GalaChainSwapAuth } from '../galachain-swap-auth.js';
import { createPerformanceOptimizer } from '../performance-optimizer.js';

/**
 * Conservative Fibonacci Strategy
 *
 * Based on your existing Fibonacci strategy but optimized for:
 * - Low-risk, steady profits
 * - Small position sizes
 * - Conservative profit targets
 * - Complementary to Trend bot (different pools/timing)
 *
 * Key Features:
 * - Smaller base trade sizes ($3-8 vs $5-50)
 * - Higher profit thresholds (30bps vs 20bps)
 * - Conservative pool selection
 * - Risk-adjusted position sizing
 * - Smart cooldown management
 */
export class ConservativeFibonacciStrategy implements TradingStrategy {
  private wallet: string;
  name = 'conservative-fibonacci';
  minVolumeRequired = 5;
  maxRisk = 0.25; // Lower risk than original (0.4)

  private gswap: GSwap;
  private swapAuth: GalaChainSwapAuth;
  private performanceOptimizer: any;

  // Conservative Fibonacci sequence (smaller numbers)
  private sequence = [1, 1, 2, 3, 5, 8, 13, 21]; // Stopped at 21 vs 55
  private currentIndex = 0;
  private consecutiveWins = 0;
  private consecutiveLosses = 0;

  // Conservative configuration
  private baseTradeSize = 3; // $3 base (vs $5)
  private maxTradeSize = 8;  // $8 max (vs $50)
  private minProfitBps = Number(process.env.CFIB_MIN_PROFIT_BPS || 30); // 30bps vs 20bps
  private slippageBps = Number(process.env.CFIB_SLIPPAGE_BPS || 50); // 50bps vs 40bps
  private dryRun = String(process.env.CFIB_DRY_RUN || 'false').toLowerCase() === 'true';

  // Risk management
  private maxDailyTrades = Number(process.env.CFIB_MAX_DAILY_TRADES || 12);
  private cooldownMs = Number(process.env.CFIB_COOLDOWN_MS || 900000); // 15 minutes
  private maxDailyLoss = Number(process.env.CFIB_MAX_DAILY_LOSS || 25); // $25 max daily loss

  // State tracking
  private lastTradeTime = 0;
  private dailyTrades = 0;
  private dailyProfit = 0;
  private tradingDay = new Date().getDate();

  constructor(walletAddress?: string) {
  this.wallet = walletAddress || process.env.GALACHAIN_WALLET_ADDRESS || '';
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

    this.swapAuth = new GalaChainSwapAuth();
    this.performanceOptimizer = createPerformanceOptimizer(this.gswap);

    this.loadDailyState();

    console.log(`📊 Conservative Fibonacci Strategy initialized:`);
    console.log(`   Base trade size: $${this.baseTradeSize}`);
    console.log(`   Max trade size: $${this.maxTradeSize}`);
    console.log(`   Min profit: ${this.minProfitBps}bps`);
    console.log(`   Max daily trades: ${this.maxDailyTrades}`);
    console.log(`   Dry run: ${this.dryRun ? 'ON' : 'OFF'}`);
  }

  shouldActivate(marketCondition: MarketCondition): boolean {
    // Conservative activation - only trade in stable conditions
    return marketCondition.volatility > 0.01 &&   // Some movement needed
           marketCondition.volatility < 0.03 &&   // But not too volatile
           marketCondition.volume > 20 &&         // Decent volume
           this.canTrade();                       // Risk checks
  }

  async execute(): Promise<TradeResult> {
    try {
      this.checkNewDay();

      if (!this.canTrade()) {
        return this.createNoTradeResult('Risk limits or cooldown active');
      }

      // Calculate conservative trade size
      const tradeSize = this.calculateConservativeTradeSize();

      // Select optimal pool (avoid conflicts with Trend bot)
      const pool = await this.selectOptimalPool();

      // Execute the trade with conservative parameters
      const result = await this.executeConservativeTrade(pool, tradeSize);

      // Update sequence and state
      this.updateSequencePosition(result.success);
      this.updateDailyState(result);

      return {
        success: result.success,
        profit: result.profit,
        volume: tradeSize,
        strategy: this.name,
        pool: pool,
        timestamp: Date.now()
      };

    } catch (error: any) {
      console.log(`❌ Conservative Fibonacci error: ${error.message}`);
      return this.createNoTradeResult(error.message);
    }
  }

  private calculateConservativeTradeSize(): number {
    // Start with Fibonacci base
    let size = this.sequence[this.currentIndex] * this.baseTradeSize;

    // Conservative adjustments (smaller than original)
    if (this.consecutiveWins >= 2) {
      // Only modest increases after wins
      size *= 1.1; // vs 1.2 in original
    } else if (this.consecutiveLosses >= 2) {
      // More aggressive reductions after losses
      size *= 0.7; // vs 0.8 in original
    }

    // Strict bounds for conservative trading
    size = Math.max(this.baseTradeSize, Math.min(this.maxTradeSize, size));

    // Reduce size if approaching daily loss limit
    const remainingLossCapacity = this.maxDailyLoss + this.dailyProfit; // If dailyProfit is negative
    if (remainingLossCapacity < size) {
      size = Math.max(this.baseTradeSize, remainingLossCapacity * 0.5);
    }

    // Small randomness for detection avoidance
    size = size * (0.98 + Math.random() * 0.04);

    return Math.round(size * 100) / 100;
  }

  private async selectOptimalPool(): Promise<string> {
    // Conservative pool selection - avoid conflicts with Trend bot
    // Trend bot uses GALA/GUSDC, so we focus on other stable pairs
    const conservativePools = [
      'GUSDC/GUSDT',   // Stable pair, low volatility - good for small profits
      'GALA/GUSDT',    // Alternative to GUSDC pair
      'GALA/GWETH'     // GALA/ETH pair - better value than ETIME
    ];

    // Check each pool for current opportunities
    for (const pool of conservativePools) {
      try {
        const [tokenIn, tokenOut] = pool.split('/');
        const testAmount = this.baseTradeSize.toString();

        const quote = await this.performanceOptimizer.getOptimizedQuote(
          this.getTokenString(tokenIn),
          this.getTokenString(tokenOut),
          testAmount
        );

        if (quote && quote.outTokenAmount) {
          console.log(`✅ Pool ${pool} available with good liquidity`);
          return pool;
        }
      } catch (error: any) {
        console.log(`⚠️ Pool ${pool} unavailable: ${error.message}`);
      }
    }

    // Fallback to Fibonacci-based selection if all pools fail
    const poolIndex = this.currentIndex % conservativePools.length;
    return conservativePools[poolIndex];
  }

  private async executeConservativeTrade(pool: string, tradeSize: number): Promise<{ success: boolean; profit: number }> {
    console.log(`🔢 Conservative Fibonacci: Trading $${tradeSize} on ${pool}`);
    console.log(`📊 Sequence: ${this.currentIndex + 1}/${this.sequence.length} | Daily: ${this.dailyTrades}/${this.maxDailyTrades}`);

    try {
      const [tokenIn, tokenOut] = pool.split('/');
      const tIn = this.getTokenString(tokenIn);
      const tOut = this.getTokenString(tokenOut);

      // Get optimized quote using performance optimizer
      const quote = await this.performanceOptimizer.getOptimizedQuote(
        tIn, tOut, tradeSize.toString()
      );

      if (!quote || !quote.outTokenAmount) {
        throw new Error(`No quote available for ${pool}`);
      }

      const outAmount = Number(quote.outTokenAmount.toString());
      console.log(`   💱 Quote: ${tradeSize} ${tokenIn} → ${outAmount.toFixed(6)} ${tokenOut}`);

      // Conservative profit calculation - use USD value estimation
      // Instead of reverse quotes (which can be misleading), calculate expected USD value

      // Use market ratio analysis for realistic edge calculation
      const expectedRatio = this.getExpectedTokenRatio(tokenIn, tokenOut);
      const actualRatio = outAmount / tradeSize;

      // Calculate edge as the difference from expected fair value
      const edgeBps = Math.round(((actualRatio - expectedRatio) / expectedRatio) * 10000);

      // Conservative approach: Only trade if edge is significant AND realistic
      const isRealisticEdge = edgeBps > 0 && edgeBps < 500; // Max 5% edge (realistic)
      const meetsMinProfit = edgeBps >= this.minProfitBps;

      console.log(`   📊 Edge analysis: ${edgeBps}bps (expected ratio: ${expectedRatio.toFixed(6)}, actual: ${actualRatio.toFixed(6)})`);
      console.log(`   🔍 Realistic: ${isRealisticEdge}, Meets min: ${meetsMinProfit}`);

      let success = isRealisticEdge && meetsMinProfit;
      let profit = success ? (tradeSize * edgeBps / 10000) : 0;

      // Log decision
      console.log(`   ✅ Trade decision: ${success ? 'EXECUTE' : 'SKIP'} | Edge: ${edgeBps}bps | Profit: $${profit.toFixed(4)}`);

      // Execute if profitable and not dry run
      if (success && !this.dryRun) {
        const minOut = outAmount * (1 - this.slippageBps / 10000);

        console.log(`   🚀 Executing conservative swap: ${tokenIn}→${tokenOut}`);
        const swapResult = await this.swapAuth.executeSwap({
          tokenIn: tIn,
          tokenOut: tOut,
          amountIn: tradeSize.toString(),
          amountOutMinimum: minOut.toString(),
          feeTier: quote.feeTier || 3000,
          recipient: this.wallet,
          slippageBps: this.slippageBps
        });

        if (swapResult.success) {
          console.log(`   ✅ Conservative swap completed: ${swapResult.transactionId}`);

          // Update profit with actual results
          if (swapResult.actualAmountOut) {
            const actualOut = Number(swapResult.actualAmountOut);
            const actualRatio = actualOut / tradeSize;
            const expectedRatio = this.getExpectedTokenRatio(tokenIn, tokenOut);
            const actualEdgeBps = Math.round(((actualRatio - expectedRatio) / expectedRatio) * 10000);

            // Conservative profit estimate - only count edge if it's realistic
            profit = actualEdgeBps > 0 && actualEdgeBps < 500 ? (tradeSize * actualEdgeBps / 10000) : 0;
            console.log(`   💰 Actual out: ${actualOut.toFixed(6)} | Actual edge: ${actualEdgeBps}bps | Est. profit: $${profit.toFixed(4)}`);
          }

          this.lastTradeTime = Date.now();
        } else {
          console.log(`   ❌ Swap failed: ${swapResult.error}`);
          success = false;
          profit = 0;
        }
      }

      // Save dry run or trade log
      await this.saveTradeSummary({
        pool, tradeSize, outAmount, edgeBps,
        success, profit, dryRun: this.dryRun
      });

      return { success, profit };

    } catch (error: any) {
      console.log(`   ❌ Trade execution failed: ${error.message}`);
      return { success: false, profit: 0 };
    }
  }

  private getExpectedTokenRatio(tokenIn: string, tokenOut: string): number {
    // Conservative estimates based on typical market ratios
    // These should be regularly updated with real market data
        const ratios: Record<string, Record<string, number>> = {
      'GALA': {
        'GUSDC': 0.017, // 1 GALA ≈ $0.017
        'GUSDT': 0.017, // 1 GALA ≈ $0.017
        'GWETH': 0.000005 // 1 GALA ≈ 0.000005 GWETH
      },
      'GUSDC': {
        'GALA': 58,     // $1 ≈ 58 GALA
        'GUSDT': 1.0,   // $1 GUSDC ≈ $1 GUSDT (stable pair)
        'GWETH': 0.0003 // $1 ≈ 0.0003 GWETH
      },
      'GUSDT': {
        'GALA': 58,     // $1 ≈ 58 GALA
        'GUSDC': 1.0,   // $1 GUSDT ≈ $1 GUSDC (stable pair)
        'GWETH': 0.0003 // $1 ≈ 0.0003 GWETH
      },
      'GWETH': {
        'GALA': 200000, // 1 GWETH ≈ 200,000 GALA (ETH expensive!)
        'GUSDC': 3300,  // 1 GWETH ≈ $3,300
        'GUSDT': 3300   // 1 GWETH ≈ $3,300
      }
    };

    return ratios[tokenIn]?.[tokenOut] || 1.0;
  }

  private canTrade(): boolean {
    const now = Date.now();

    // Check cooldown
    if (now - this.lastTradeTime < this.cooldownMs) {
      const remainingMs = this.cooldownMs - (now - this.lastTradeTime);
      console.log(`⏸️ Cooldown active: ${Math.round(remainingMs / 60000)} minutes remaining`);
      return false;
    }

    // Check daily trade limit
    if (this.dailyTrades >= this.maxDailyTrades) {
      console.log(`⏸️ Daily trade limit reached: ${this.dailyTrades}/${this.maxDailyTrades}`);
      return false;
    }

    // Check daily loss limit
    if (this.dailyProfit <= -this.maxDailyLoss) {
      console.log(`⏸️ Daily loss limit hit: $${this.dailyProfit.toFixed(2)}`);
      return false;
    }

    return true;
  }

  private updateSequencePosition(success: boolean): void {
    if (success) {
      this.consecutiveWins++;
      this.consecutiveLosses = 0;

      // Move forward in sequence on success, but conservatively
      this.currentIndex = Math.min(this.currentIndex + 1, this.sequence.length - 1);
    } else {
      this.consecutiveLosses++;
      this.consecutiveWins = 0;

      // Move back more aggressively on failure (conservative approach)
      this.currentIndex = Math.max(0, this.currentIndex - 2);
    }

    console.log(`📈 Sequence updated: ${this.currentIndex + 1}/${this.sequence.length} | W:${this.consecutiveWins} L:${this.consecutiveLosses}`);
  }

  private checkNewDay(): void {
    const currentDay = new Date().getDate();
    if (currentDay !== this.tradingDay) {
      console.log(`📅 New trading day: Resetting daily counters`);
      this.tradingDay = currentDay;
      this.dailyTrades = 0;
      this.dailyProfit = 0;
      this.saveDailyState();
    }
  }

  private updateDailyState(result: { success: boolean; profit: number }): void {
    this.dailyTrades++;
    this.dailyProfit += result.profit;

    console.log(`📊 Daily stats: ${this.dailyTrades} trades | $${this.dailyProfit.toFixed(2)} profit`);
    this.saveDailyState();
  }

  private loadDailyState(): void {
    try {
      const stateFile = path.join(process.cwd(), 'logs', 'conservative-fib-state.json');
      if (fs.existsSync(stateFile)) {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

        if (state.tradingDay === new Date().getDate()) {
          this.dailyTrades = state.dailyTrades || 0;
          this.dailyProfit = state.dailyProfit || 0;
          this.currentIndex = state.currentIndex || 0;
          this.consecutiveWins = state.consecutiveWins || 0;
          this.consecutiveLosses = state.consecutiveLosses || 0;
          this.lastTradeTime = state.lastTradeTime || 0;
        }
      }
    } catch (error: any) {
      console.log(`⚠️ Could not load daily state: ${error.message}`);
    }
  }

  private saveDailyState(): void {
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      fs.ensureDirSync(logsDir);

      const state = {
        tradingDay: this.tradingDay,
        dailyTrades: this.dailyTrades,
        dailyProfit: this.dailyProfit,
        currentIndex: this.currentIndex,
        consecutiveWins: this.consecutiveWins,
        consecutiveLosses: this.consecutiveLosses,
        lastTradeTime: this.lastTradeTime,
        timestamp: new Date().toISOString()
      };

      const stateFile = path.join(logsDir, 'conservative-fib-state.json');
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch (error: any) {
      console.log(`⚠️ Could not save daily state: ${error.message}`);
    }
  }

  private async saveTradeSummary(data: any): Promise<void> {
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      const fibDir = path.join(logsDir, 'conservative-fibonacci');
      fs.ensureDirSync(fibDir);

      const summary = {
        strategy: 'conservative-fibonacci',
        ...data,
        timestamp: new Date().toISOString(),
        sequence: `${this.currentIndex + 1}/${this.sequence.length}`,
        dailyStats: {
          trades: this.dailyTrades,
          profit: this.dailyProfit
        }
      };

      const filename = `cfib_${Date.now()}_${data.success ? 'success' : 'skip'}.json`;
      const filepath = path.join(fibDir, filename);
      fs.writeFileSync(filepath, JSON.stringify(summary, null, 2));
    } catch (error: any) {
      console.log(`⚠️ Could not save trade summary: ${error.message}`);
    }
  }

  private createNoTradeResult(reason: string): TradeResult {
    return {
      success: false,
      profit: 0,
      volume: 0,
      strategy: this.name,
      pool: 'no-trade',
      timestamp: Date.now(),
      error: reason
    };
  }

  private getTokenString(symbol: string): string {
    const tokenMap: { [key: string]: string } = {
      'GALA': 'GALA|Unit|none|none',
      'GUSDC': 'GUSDC|Unit|none|none',
      'GUSDT': 'GUSDT|Unit|none|none',
      'GWETH': 'GWETH|Unit|none|none'
    };

    const token = tokenMap[symbol];
    if (!token) throw new Error(`Unknown token symbol: ${symbol}`);
    return token;
  }
}
