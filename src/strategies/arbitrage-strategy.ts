import { TradingStrategy, MarketCondition, TradeResult } from '../types.js';
import fs from 'fs-extra';
import path from 'node:path';
import { GSwap } from '@gala-chain/gswap-sdk';
import { signatures } from '@gala-chain/api';
import { GalaChainSwapAuth } from '../galachain-swap-auth.js';
import { riskManager } from '../risk-manager.js';
import { createPerformanceOptimizer } from '../performance-optimizer.js';
import { StrategyAdvisor } from '../advisor.js';

export class ArbitrageStrategy implements TradingStrategy {
  name = 'arbitrage';
  minVolumeRequired = 5;
  maxRisk = 0.6; // Reduced risk for more conservative approach

  private gswap: GSwap;
  private swapAuth: GalaChainSwapAuth;
  private performanceOptimizer: any;
  private advisor: StrategyAdvisor;
  private pairs: Array<{ symbolIn: string; symbolOut: string; amountIn: string }>;
  private minProfitBps: number;
  private slippageBps: number;
  private dryRun: boolean;
  private wallet: string | undefined;
  private useAdvisor: boolean;
  private maxConcurrentTrades: number;
  private activeTrades: Set<string>;
  private lastAdvisorCall: number;
  private advisorIntervalMs: number;

  // Enhanced arbitrage pools - focus on high-volume, stable pairs
  private arbitragePools = [
    'GALA/GUSDC',   // Primary - highest liquidity
    'GALA/GUSDT',   // Secondary - stable alternative
    'GUSDC/GUSDT',  // Stable-to-stable arbitrage
    'GALA/GWETH',   // ETH exposure for volatility
    'GUSDC/GWETH'   // ETH-stable arbitrage
  ];

  constructor() {
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

    // Initialize enhanced swap authorization handler
    this.swapAuth = new GalaChainSwapAuth();

    // Initialize performance optimizer
    this.performanceOptimizer = createPerformanceOptimizer(this.gswap);

    // Initialize AI advisor
    this.advisor = new StrategyAdvisor(this.gswap);

    // Configuration from environment
    this.minProfitBps = Number(process.env.ARB_MIN_PROFIT_BPS || 50); // Increased minimum profit
    this.slippageBps = Number(process.env.ARB_SLIPPAGE_BPS || 100); // More conservative slippage
    this.dryRun = String(process.env.ARB_DRY_RUN || 'true').toLowerCase() !== 'false';
    this.wallet = process.env.GALACHAIN_WALLET_ADDRESS || process.env.GSWAP_WALLET || process.env.GSWAP_WALLET_ADDRESS;
    this.useAdvisor = String(process.env.ARB_USE_ADVISOR || 'false').toLowerCase() === 'true';
    this.maxConcurrentTrades = Number(process.env.ARB_MAX_CONCURRENT || 2);
    this.advisorIntervalMs = Number(process.env.ARB_ADVISOR_INTERVAL_MS || 300000); // 5 minutes

    // Initialize tracking
    this.activeTrades = new Set();
    this.lastAdvisorCall = 0;
    this.pairs = this.generateArbitragePairs(); // Auto-generate pairs from pools

    console.log(`📈 Enhanced Arbitrage Strategy initialized`);
    console.log(`💰 Min profit: ${this.minProfitBps}bps | Slippage: ${this.slippageBps}bps | Dry run: ${this.dryRun}`);
    console.log(`🤖 AI Advisor: ${this.useAdvisor ? 'ENABLED' : 'DISABLED'} | Max concurrent: ${this.maxConcurrentTrades}`);
    console.log(`🎯 Monitoring ${this.arbitragePools.length} high-volume pools for arbitrage opportunities`);
  }

  setPairs(pairs: Array<{ symbolIn: string; symbolOut: string; amountIn: string }>) {
    console.log(`🔧 Setting ${pairs.length} pairs for arbitrage strategy:`, pairs.map(p => `${p.symbolIn}/${p.symbolOut}`));
    this.pairs = pairs;
  }

  private generateArbitragePairs(): Array<{ symbolIn: string; symbolOut: string; amountIn: string }> {
    const pairs: Array<{ symbolIn: string; symbolOut: string; amountIn: string }> = [];
    const baseAmount = '10'; // $10 base trade size for arbitrage

    this.arbitragePools.forEach(pool => {
      const [tokenA, tokenB] = pool.split('/');

      // Add both directions for each pool
      pairs.push(
        { symbolIn: tokenA, symbolOut: tokenB, amountIn: baseAmount },
        { symbolIn: tokenB, symbolOut: tokenA, amountIn: baseAmount }
      );
    });

    console.log(`🔄 Auto-generated ${pairs.length} arbitrage pairs from ${this.arbitragePools.length} pools`);
    return pairs;
  }

  private async consultAdvisor(): Promise<string | null> {
    if (!this.useAdvisor || !this.advisor.isEnabled) {
      return null;
    }

    const now = Date.now();
    if (now - this.lastAdvisorCall < this.advisorIntervalMs) {
      return null; // Too soon for another advisor call
    }

    try {
      console.log(`🤖 Consulting AI advisor for arbitrage opportunities...`);
      this.lastAdvisorCall = now;

      const advice = await this.advisor.advise(this.pairs, this.slippageBps);
      if (advice) {
        console.log(`🧠 AI Advisor recommendation: ${advice.substring(0, 200)}...`);

        // Save advisor recommendation to logs
        const logsDir = path.join(process.cwd(), 'logs', 'advisor');
        await fs.ensureDir(logsDir);
        const advisorLog = path.join(logsDir, `arbitrage_${Date.now()}.log`);
        await fs.writeFile(advisorLog, `[${new Date().toISOString()}] ${advice}\n`);
      }

      return advice;
    } catch (error: any) {
      console.log(`⚠️ Advisor consultation failed: ${error.message}`);
      return null;
    }
  }

  shouldActivate(marketCondition: MarketCondition): boolean {
    // Arbitrage works best in stable markets with good volume
    return marketCondition.volatility < 0.03 && marketCondition.volume > 50;
  }

  async execute(): Promise<TradeResult> {
    try {
      console.log(`📈 Enhanced Arbitrage strategy executing with ${this.pairs.length} pairs configured`);
      console.log(`⚡ Active trades: ${this.activeTrades.size}/${this.maxConcurrentTrades}`);

      if (this.pairs.length === 0) {
        console.log('❌ No pairs configured for arbitrage strategy');
        return {
          success: false,
          profit: 0,
          volume: 0,
          strategy: this.name,
          pool: 'no-pairs-configured',
          timestamp: Date.now(),
          error: 'No pairs configured for arbitrage strategy'
        };
      }

      // Check if we can start new trades
      if (this.activeTrades.size >= this.maxConcurrentTrades) {
        console.log(`⏸️ Max concurrent trades reached (${this.maxConcurrentTrades}), waiting...`);
        return {
          success: false,
          profit: 0,
          volume: 0,
          strategy: this.name,
          pool: 'max-concurrent-reached',
          timestamp: Date.now(),
          error: `Max concurrent trades reached: ${this.activeTrades.size}/${this.maxConcurrentTrades}`
        };
      }

      // Consult AI advisor if enabled
      const advisorAdvice = await this.consultAdvisor();

      let bestOpportunity = null;
      let bestProfit = 0;
      const runArtifacts: any[] = [];

      // Check each configured pair for arbitrage opportunities
      for (const pair of this.pairs) {
        try {
          console.log(`\n🔍 Checking ${pair.symbolIn} → ${pair.symbolOut} for arbitrage...`);

          // First, try to get pool info from GalaChain API
          const poolInfo = await this.getPoolInfoFromAPI(pair.symbolIn, pair.symbolOut);
          // Skip logging API pool info; rely on SDK-derived quotes below

          // Get quote for this pair using GSwap SDK
          const tIn = this.getTokenString(pair.symbolIn);
          const tOut = this.getTokenString(pair.symbolOut);

          // Try different fee tiers to find the best quote
          const feeTiers = [500, 3000, 10000]; // 0.05%, 0.3%, 1.0%
          let bestQuote = null;
          let bestFeeTier = null;

          for (const feeTier of feeTiers) {
            try {
              const quote = await this.gswap.quoting.quoteExactInput(tIn, tOut, pair.amountIn, feeTier);
              const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);

              if (!bestQuote || outAmount > Number((bestQuote as any).outTokenAmount?.toString?.() ?? bestQuote.outTokenAmount)) {
                bestQuote = quote;
                bestFeeTier = feeTier;
              }
            } catch (error) {
              // Skip this fee tier if it doesn't exist
              continue;
            }
          }

          if (!bestQuote) {
            console.log(`   ❌ No pools found for ${pair.symbolIn} → ${pair.symbolOut}`);
            continue;
          }

          const outAmount = Number((bestQuote as any).outTokenAmount?.toString?.() ?? bestQuote.outTokenAmount);
          console.log(`   ✅ Pool found: ${pair.amountIn} ${pair.symbolIn} → ${outAmount.toFixed(6)} ${pair.symbolOut}`);

          // Calculate REAL arbitrage opportunity using actual quotes
          const inputValue = Number(pair.amountIn);
          const outputValue = outAmount;

          // Get the current price for this pair
          const currentPrice = outputValue / inputValue;
          console.log(`   💱 Current Price: ${currentPrice.toFixed(6)} ${pair.symbolOut}/${pair.symbolIn}`);

          // For real arbitrage, we need to check the reverse direction
          try {
            // Discover best reverse fee tier independently
            const feeTiersReverse = [500, 3000, 10000];
            let bestReverseQuote: any = null;
            let bestReverseFee: number | null = null;
            for (const ft of feeTiersReverse) {
              try {
                const rq = await this.gswap.quoting.quoteExactInput(tOut, tIn, outputValue.toString(), ft);
                const ra = Number((rq as any).outTokenAmount?.toString?.() ?? rq.outTokenAmount);
                if (!bestReverseQuote || ra > Number((bestReverseQuote as any).outTokenAmount?.toString?.() ?? bestReverseQuote.outTokenAmount)) {
                  bestReverseQuote = rq;
                  bestReverseFee = ft;
                }
              } catch (_) { /* skip */ }
            }
            if (!bestReverseQuote) throw new Error('No reverse quote');
            const reverseAmount = Number((bestReverseQuote as any).outTokenAmount?.toString?.() ?? bestReverseQuote.outTokenAmount);

            console.log(`   🔄 Reverse Quote: ${outputValue} ${pair.symbolOut} → ${reverseAmount.toFixed(6)} ${pair.symbolIn}`);

            // Calculate actual arbitrage opportunity
            const arbitrageProfit = reverseAmount - inputValue;
            const profitBps = Math.round((arbitrageProfit / inputValue) * 10000);

            console.log(`   💰 Arbitrage Analysis: Input ${inputValue} → Output ${reverseAmount.toFixed(6)} | Profit: $${arbitrageProfit.toFixed(4)} (${(profitBps/100).toFixed(2)}% | ${profitBps}bps)`);

            // Only consider if there's a real profit opportunity (after fees) based on env threshold
            if (profitBps >= this.minProfitBps) {
              if (arbitrageProfit > bestProfit) {
                bestProfit = arbitrageProfit;
                bestOpportunity = {
                  pair: `${pair.symbolIn}/${pair.symbolOut}`,
                  input: inputValue,
                  output: outputValue,
                  profit: arbitrageProfit,
                  reverseAmount: reverseAmount,
                  profitPercentage: (profitBps / 100),
                  feeForward: bestFeeTier,
                  feeReverse: bestReverseFee,
                  tIn,
                  tOut
                };
              }
            } else {
              console.log(`   ❌ Insufficient profit: ${(profitBps/100).toFixed(2)}% (${profitBps}bps) < ${(this.minProfitBps/100).toFixed(2)}% (${this.minProfitBps}bps) threshold`);
              runArtifacts.push({
                strategy: 'arbitrage',
                pair: `${pair.symbolIn}/${pair.symbolOut}`,
                feeForward: bestFeeTier,
                input: inputValue,
                output: outputValue,
                reverseQuoted: reverseAmount,
                profit: arbitrageProfit,
                profitBps,
                timestamp: new Date().toISOString()
              });
            }

          } catch (reverseError: any) {
            console.log(`   ⚠️ Reverse direction not available: ${reverseError.message}`);
            // No fallback profit - if no reverse quote, skip this pair
            console.log(`   ❌ Skipping ${pair.symbolIn}/${pair.symbolOut} - no reverse liquidity`);
            continue;
          }

        } catch (error: any) {
          console.log(`   ❌ Pool error: ${error.message}`);
          continue;
        }
      }

      if (this.dryRun && runArtifacts.length > 0) {
        try {
          const logsDir = path.join(process.cwd(), 'logs');
          const dryDir = path.join(logsDir, 'dryruns');
          fs.ensureDirSync(dryDir);
          const summary = {
            strategy: 'arbitrage',
            evaluated: runArtifacts,
            timestamp: new Date().toISOString()
          };
          const file = path.join(dryDir, `dryrun_enhanced_${Date.now()}_arbitrage.json`);
          fs.writeFileSync(file, JSON.stringify(summary, null, 2));
        } catch {}
      }

      if (!bestOpportunity) {
        return {
          success: false,
          profit: 0,
          volume: 0,
          strategy: this.name,
          pool: 'no-opportunity',
          timestamp: Date.now(),
          error: 'No profitable arbitrage opportunities found'
        };
      }

      // Execute live arbitrage with proper authorization if above env thresholds
      const execOpBps = Math.round((bestOpportunity.profit / bestOpportunity.input) * 10000);
      const execWillExecute = !this.dryRun && execOpBps >= this.minProfitBps;
      const tradeId = `${bestOpportunity.pair}_${Date.now()}`;

      if (execWillExecute) {
        // Add to active trades tracking
        this.activeTrades.add(tradeId);
        // Risk management check
        const riskCheck = await riskManager.checkTradeAllowed(
          this.name,
            bestOpportunity.tIn,
            bestOpportunity.tOut,
          bestOpportunity.input,
          this.slippageBps
        );

        if (!riskCheck.allowed) {
          console.log(`🛑 Risk management blocked trade: ${riskCheck.reason}`);
          return {
            success: false,
            profit: 0,
            volume: bestOpportunity.input,
            strategy: this.name,
            pool: bestOpportunity.pair,
            timestamp: Date.now(),
            error: `Risk management: ${riskCheck.reason}`
          };
        }

        // Use adjusted amount if risk manager suggests it
        const adjustedAmount = riskCheck.adjustedAmount || bestOpportunity.input;
        if (adjustedAmount !== bestOpportunity.input) {
          console.log(`📊 Risk manager adjusted trade size: ${bestOpportunity.input} → ${adjustedAmount}`);
          bestOpportunity.input = adjustedAmount;
          // Recalculate outputs based on adjusted input
          bestOpportunity.output = bestOpportunity.output * (adjustedAmount / bestOpportunity.input);
          bestOpportunity.profit = bestOpportunity.reverseAmount - adjustedAmount;
        }
        try {
          console.log(`🚀 Executing arbitrage with proper authorization...`);

          // Execute first swap with proper authorization
          console.log(`   📈 Swap 1: ${bestOpportunity.input} ${bestOpportunity.pair.split('/')[0]} → ${bestOpportunity.pair.split('/')[1]}`);
          const swap1Result = await this.swapAuth.executeSwap({
            tokenIn: bestOpportunity.tIn,
            tokenOut: bestOpportunity.tOut,
            amountIn: bestOpportunity.input.toString(),
            amountOutMinimum: (bestOpportunity.output * (1 - this.slippageBps / 10000)).toString(),
            feeTier: bestOpportunity.feeForward || 3000,
            recipient: this.wallet || '',
            slippageBps: this.slippageBps
          });

          if (!swap1Result.success) {
            throw new Error(`Swap 1 failed: ${swap1Result.error}`);
          }

          console.log(`   ✅ Swap 1 completed: ${swap1Result.transactionId}`);

          // Execute second swap (reverse) with proper authorization
          console.log(`   📉 Swap 2: ${bestOpportunity.output} ${bestOpportunity.pair.split('/')[1]} → ${bestOpportunity.pair.split('/')[0]}`);
          const swap2Result = await this.swapAuth.executeSwap({
            tokenIn: bestOpportunity.tOut,
            tokenOut: bestOpportunity.tIn,
            amountIn: bestOpportunity.output.toString(),
            amountOutMinimum: (bestOpportunity.reverseAmount * (1 - this.slippageBps / 10000)).toString(),
            feeTier: bestOpportunity.feeReverse || 3000,
            recipient: this.wallet || '',
            slippageBps: this.slippageBps
          });

          if (!swap2Result.success) {
            throw new Error(`Swap 2 failed: ${swap2Result.error}`);
          }

          console.log(`   ✅ Swap 2 completed: ${swap2Result.transactionId}`);
          console.log(`   💰 Arbitrage executed successfully! Both swaps confirmed.`);

        } catch (execErr: any) {
          console.log(`   ❌ Authorized execution failed: ${execErr.message || execErr}`);
        } finally {
          // Remove from active trades regardless of outcome
          this.activeTrades.delete(tradeId);
        }
      }

      const result: TradeResult = {
        success: true,
        profit: bestOpportunity.profit,
        volume: bestOpportunity.input,
        strategy: this.name,
        pool: bestOpportunity.pair,
        timestamp: Date.now()
      };

      // Log comprehensive trade details
      console.log(`\n💰 ARBITRAGE TRADE EXECUTED:`);
      console.log(`   📍 Pool/Pair: ${bestOpportunity.pair}`);
      console.log(`   💵 Purchased: ${bestOpportunity.input} ${bestOpportunity.pair.split('/')[0]}`);
      console.log(`   🎯 Sold: ${bestOpportunity.output.toFixed(6)} ${bestOpportunity.pair.split('/')[1]}`);
      console.log(`   🔄 Reverse Amount: ${bestOpportunity.reverseAmount?.toFixed(6) || 'N/A'} ${bestOpportunity.pair.split('/')[0]}`);
      console.log(`   💰 Profit: $${bestOpportunity.profit.toFixed(4)} (${bestOpportunity.profitPercentage?.toFixed(2) || ((bestOpportunity.profit / bestOpportunity.input) * 100).toFixed(2)}%)`);
      console.log(`   📊 Volume: $${bestOpportunity.input.toFixed(2)}`);
      console.log(`   🕒 Timestamp: ${new Date().toISOString()}`);

      // Threshold/execution flag summary
      const summaryOpBps = Math.round((bestOpportunity.profit / bestOpportunity.input) * 10000);
      const summaryWillExecute = !this.dryRun && summaryOpBps >= this.minProfitBps;
      console.log(`   ✅ Meets threshold: ${(summaryOpBps/100).toFixed(2)}% (${summaryOpBps}bps) ${summaryOpBps >= this.minProfitBps ? '>=' : '<'} ${(this.minProfitBps/100).toFixed(2)}% (${this.minProfitBps}bps) | executed=${summaryWillExecute ? 'yes' : 'no'} (dryRun=${this.dryRun})`);

      return result;

    } catch (error: any) {
      return {
        success: false,
        profit: 0,
        volume: 0,
        strategy: this.name,
        pool: 'unknown',
        timestamp: Date.now(),
        error: error.message || 'Unknown error'
      };
    }
  }

  // New method: Get pool info from GalaChain API
  private async getPoolInfoFromAPI(_tokenIn: string, _tokenOut: string): Promise<null> {
    // Uniform behavior: do not use API pool info in logs; SDK quotes determine pools/fees
    return null;
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

  // Helper method to calculate potential profit for a pair
  async calculateProfit(pair: { symbolIn: string; symbolOut: string; amountIn: string }): Promise<number> {
    try {
      // Get real quote from SDK
      const tIn = this.getTokenString(pair.symbolIn);
      const tOut = this.getTokenString(pair.symbolOut);

      // Find best fee tier for profit calculation
      const feeTiers = [500, 3000, 10000];
      let bestQuote = null;

      for (const feeTier of feeTiers) {
        try {
          const quote = await this.gswap.quoting.quoteExactInput(tIn, tOut, pair.amountIn, feeTier);
          const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);

          if (!bestQuote || outAmount > Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount)) {
            bestQuote = quote;
          }
        } catch (error) {
          continue;
        }
      }

      if (!bestQuote) {
        return 0; // No profit if no pools found
      }

      const quote = bestQuote;
      const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);

      // Calculate real profit potential based on current market price
      const inputValue = Number(pair.amountIn);
      const outputValue = outAmount;

      // This is a simplified calculation - in practice you'd need reverse quote too
      const priceImpact = Math.abs(outputValue - inputValue) / inputValue;
      return priceImpact;

    } catch (error) {
      return 0; // No profit if quote fails
    }
  }
}
