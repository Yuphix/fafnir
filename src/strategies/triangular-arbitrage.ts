import { TradingStrategy, MarketCondition, TradeResult, ArbitragePath } from '../types.js';
import fs from 'fs-extra';
import nodePath from 'node:path';
import { GSwap } from '@gala-chain/gswap-sdk';
import { signatures } from '@gala-chain/api';
import { GalaChainSwapAuth } from '../galachain-swap-auth.js';

export class TriangularArbitrage implements TradingStrategy {
  name = 'triangular';
  minVolumeRequired = 10;
  maxRisk = 0.5;

  private gswap: GSwap;
  private swapAuth: GalaChainSwapAuth;
  private baseAmount: number;
  private minProfitBps: number;
  private slippageBps: number;
  private dryRun: boolean;
  private wallet: string | undefined;
  private paths = [
    ['GUSDC', 'GALA', 'GUSDT', 'GUSDC'],  // Path 1
    ['GUSDC', 'GWETH', 'GUSDT', 'GUSDC'], // Path 2
    ['GUSDT', 'GALA', 'GUSDC', 'GUSDT'],  // Path 3 (reverse)
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
    this.baseAmount = Number(process.env.TRIANGULAR_BASE_AMOUNT || 15);
    this.minProfitBps = Number(process.env.TRIANGULAR_MIN_PROFIT_BPS || 30); // 0.30%
    this.slippageBps = Number(process.env.TRIANGULAR_SLIPPAGE_BPS || 40); // 0.40%
    this.dryRun = String(process.env.TRIANGULAR_DRY_RUN || 'true').toLowerCase() !== 'false';
    this.wallet = process.env.GALACHAIN_WALLET_ADDRESS || process.env.GSWAP_WALLET || process.env.GSWAP_WALLET_ADDRESS;

    // Initialize enhanced swap authorization
    this.swapAuth = new GalaChainSwapAuth();
  }

  shouldActivate(marketCondition: MarketCondition): boolean {
    // Triangular arbitrage works best in volatile markets with good liquidity
    // Lowered thresholds for testing
    return marketCondition.volatility > 0.01 && marketCondition.volume > 50;
  }

  async execute(): Promise<TradeResult> {
    try {
      // Find the most profitable triangular path
      const profitablePath = await this.findProfitablePath();

      if (!profitablePath) {
        return {
          success: false,
          profit: 0,
          volume: 0,
          strategy: this.name,
          pool: 'no-opportunity',
          timestamp: Date.now(),
          error: 'No profitable triangular path found'
        };
      }

      // Execute the triangular arbitrage
      const result = await this.executeTriangularPath(profitablePath);

      return {
        success: true,
        profit: result.profit,
        volume: result.volume,
        strategy: this.name,
        pool: profitablePath.path.join('→'),
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

  async findProfitablePath(): Promise<ArbitragePath | null> {
    let bestPath: ArbitragePath | null = null;
    let bestProfit = 0;

    for (const path of this.paths) {
      try {
        const pathAnalysis = await this.analyzePath(path);

        const profitBps = Math.round((pathAnalysis.expectedProfit / pathAnalysis.tradeSize) * 10000);
        if (pathAnalysis.expectedProfit > bestProfit &&
            profitBps >= this.minProfitBps) {
          bestProfit = pathAnalysis.expectedProfit;
          bestPath = pathAnalysis;
        }
      } catch (error) {
        console.log(`Path ${path.join('→')} analysis failed:`, error);
        continue;
      }
    }

    return bestPath;
  }

  private async analyzePath(path: string[]): Promise<ArbitragePath> {
    console.log(`🔍 Analyzing triangular path: ${path.join(' → ')}`);

    const baseAmount = this.baseAmount; // Use configured base
    let currentAmount = baseAmount;
    let totalFees = 0;
    let pathDetails: Array<{ step: number; from: string; to: string; input: number; output: number; fee: number; feeTier: number }> = [];

    try {
      // Analyze each step of the triangular path using real GalaChain SDK
      for (let i = 0; i < path.length - 1; i++) {
        const fromToken = path[i];
        const toToken = path[i + 1];

        console.log(`   📍 Step ${i + 1}: ${fromToken} → ${toToken}`);

        try {
          // Get real quote from GalaChain SDK
          const tIn = this.getTokenString(fromToken);
          const tOut = this.getTokenString(toToken);

          // Find best fee tier for this pair
          const feeTiers = [500, 3000, 10000];
          let bestQuote = null;
          let bestFeeTier = null;

          for (const feeTier of feeTiers) {
            try {
              const quote = await this.gswap.quoting.quoteExactInput(tIn, tOut, currentAmount.toString(), feeTier);
              const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);

              if (!bestQuote || outAmount > Number((bestQuote as any).outTokenAmount?.toString?.() ?? bestQuote.outTokenAmount)) {
                bestQuote = quote;
                bestFeeTier = feeTier;
              }
            } catch (error) {
              continue;
            }
          }

          if (!bestQuote) {
            throw new Error(`No pools found for ${fromToken} → ${toToken}`);
          }

          const quote = bestQuote;
          const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);

          // Get pool details (use discovered fee tier)
          const feeTier = (quote as any).feeTier ?? bestFeeTier!;
          const feePercentage = feeTier / 10000; // Convert basis points to decimal (500 -> 0.05)

          console.log(`      ✅ Real Quote: ${currentAmount.toFixed(6)} ${fromToken} → ${outAmount.toFixed(6)} ${toToken}`);
          console.log(`      💰 Fee: ${(feePercentage * 100).toFixed(2)}% (${feeTier}bps)`);

          // Apply real fees (for reporting only; quotes already include pool fee in outAmount)
          const inputBefore = currentAmount;
          const stepFee = inputBefore * feePercentage;
          totalFees += stepFee;
          currentAmount = outAmount;

          pathDetails.push({
            step: i + 1,
            from: fromToken,
            to: toToken,
            input: inputBefore,
            output: outAmount,
            fee: feePercentage,
            feeTier: feeTier
          });

        } catch (error: any) {
          console.log(`      ❌ Failed to get quote for ${fromToken} → ${toToken}: ${error.message}`);
          throw new Error(`Path step ${i + 1} failed: ${error.message}`);
        }
      }

      // Calculate real arbitrage opportunity
      const expectedProfit = currentAmount - baseAmount;
      const profitPercentage = (expectedProfit / baseAmount) * 100;

      console.log(`   📊 Path Analysis Complete:`);
      console.log(`      💰 Starting Amount: $${baseAmount.toFixed(2)}`);
      console.log(`      🎯 Final Amount: $${currentAmount.toFixed(6)}`);
      console.log(`      💸 Total Fees: $${totalFees.toFixed(4)}`);
      console.log(`      💎 Expected Profit: $${expectedProfit.toFixed(4)} (${profitPercentage.toFixed(2)}%)`);

      const confidence = Math.min(0.9, 0.5 + (expectedProfit / baseAmount) * 10);

      return {
        path,
        expectedProfit,
        totalFees,
        tradeSize: baseAmount,
        confidence,
        hops: pathDetails.map(h => ({ from: h.from, to: h.to, feeTier: h.feeTier, quotedOut: h.output }))
      };

    } catch (error: any) {
      console.log(`   ❌ Path analysis failed: ${error.message}`);
      throw error;
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

  private async executeTriangularPath(path: ArbitragePath): Promise<{ profit: number; volume: number }> {
    console.log(`🔄 Executing triangular path: ${path.path.join(' → ')}`);
    console.log(`💰 Expected profit: $${path.expectedProfit.toFixed(4)}`);
    console.log(`📊 Trade size: $${path.tradeSize}`);

    try {
      // Enforce minimum profit threshold before attempting execution
      const expectedProfitBps = Math.round((path.expectedProfit / path.tradeSize) * 10000);
      if (expectedProfitBps < this.minProfitBps) {
        console.log(`   ❌ Skipping: expected ${(expectedProfitBps/100).toFixed(2)}bps < min ${(this.minProfitBps/100).toFixed(2)}bps`);
        return { profit: 0, volume: path.tradeSize };
      }

      if (!path.hops || path.hops.length < 3) {
        console.log(`   ❌ Missing hop details; cannot execute safely.`);
        return { profit: 0, volume: path.tradeSize };
      }

      console.log(`   📋 Executing trades for triangular arbitrage (dryRun=${this.dryRun})...`);

      let currentAmount = path.tradeSize;
      const hopArtifacts: any[] = [];
      const submittedHops: Array<{ hop: number; txId?: string; feeTier: number; exactIn: number; minOut: number; quotedOut: number; tokenIn: string; tokenOut: string }> = [];

      for (let i = 0; i < path.hops.length; i++) {
        const hop = path.hops[i]!;
        const tIn = this.getTokenString(hop.from);
        const tOut = this.getTokenString(hop.to);
        const feeTier = hop.feeTier;

        const quotedOut = Number(hop.quotedOut);
        const amountOutMinimum = quotedOut * (1 - this.slippageBps / 10000);

        console.log(`     ⚙️ Hop ${i + 1}: ${hop.from}→${hop.to} | fee ${feeTier}bps | exactIn=${currentAmount} | minOut=${amountOutMinimum.toFixed(6)} (slip ${(this.slippageBps/100).toFixed(2)}%)`);

        if (this.dryRun) {
          // In dry-run, collect hop artifact; write once after loop
          hopArtifacts.push({
            strategy: 'triangular',
            path: Array.isArray((path as any).path) ? (path as any).path.join('→') : String((path as any).path || ''),
            hop: i + 1,
            tokenIn: hop.from,
            tokenOut: hop.to,
            feeTier,
            exactIn: String(currentAmount),
            quotedOut: String(quotedOut),
            amountOutMinimum: String(amountOutMinimum),
            slippageBps: this.slippageBps,
            timestamp: new Date().toISOString()
          });
          currentAmount = quotedOut;
          continue;
        }

        // Execute swap with proper authorization
        console.log(`     🚀 Executing hop ${i + 1} with proper authorization: ${currentAmount} ${hop.from} → ${hop.to}`);

        const swapResult = await this.swapAuth.executeSwap({
          tokenIn: tIn,
          tokenOut: tOut,
          amountIn: currentAmount.toString(),
          amountOutMinimum: amountOutMinimum.toString(),
          feeTier: feeTier,
          recipient: this.wallet || '',
          slippageBps: this.slippageBps
        });

        if (!swapResult.success) {
          console.log(`     ❌ Hop ${i + 1} failed: ${swapResult.error}`);
          throw new Error(`Triangular arbitrage failed at hop ${i + 1}: ${swapResult.error}`);
        }

        console.log(`     ✅ Hop ${i + 1} completed: ${swapResult.transactionId}`);

        // Update current amount for next hop (use actual amount if available, fallback to quoted)
        const actualAmountOut = swapResult.actualAmountOut ? Number(swapResult.actualAmountOut) : quotedOut;
        submittedHops.push({
          hop: i + 1,
          txId: swapResult.transactionId,
          feeTier,
          exactIn: currentAmount,
          minOut: amountOutMinimum,
          quotedOut: quotedOut,
          tokenIn: hop.from,
          tokenOut: hop.to
        });

        console.log(`     📊 Hop ${i + 1}: Expected ${quotedOut.toFixed(6)}, Actual ${actualAmountOut.toFixed(6)} ${hop.to}`);
        // Continue to next hop (currentAmount already updated above)
      }

      // Calculate actual profit based on final amount received vs initial investment
      const actualProfit = this.dryRun ? path.expectedProfit : (currentAmount - path.tradeSize);
      const actualPct = (actualProfit / path.tradeSize) * 100;

      console.log(`   ✅ Triangular path ${this.dryRun ? 'prepared (dry-run)' : 'executed'}:`);
      console.log(`     💰 Expected profit: $${path.expectedProfit.toFixed(4)} (${((path.expectedProfit / path.tradeSize) * 100).toFixed(2)}%)`);
      if (!this.dryRun) {
        console.log(`     💰 Actual profit: $${actualProfit.toFixed(4)} (${actualPct.toFixed(2)}%)`);
        console.log(`     📊 Final amount: ${currentAmount.toFixed(6)} vs Initial: ${path.tradeSize.toFixed(6)}`);
      }
      console.log(`     🔄 Path: ${Array.isArray((path as any).path) ? (path as any).path.join('→') : String((path as any).path || '')}`);

      if (!this.dryRun && submittedHops.length > 0) {
        console.log(`   🧾 Execution summary:`);
        for (const h of submittedHops) {
          console.log(`     • Hop ${h.hop}: txId=${h.txId} | ${h.tokenIn}→${h.tokenOut} | fee=${h.feeTier}bps | exactIn=${h.exactIn} | minOut=${h.minOut} | quotedOut=${h.quotedOut}`);
        }
      }

      // Write one dry-run artifact file summarizing the run
      if (this.dryRun && hopArtifacts.length > 0) {
        try {
          const logsDir = nodePath.join(process.cwd(), 'logs');
          const dryDir = nodePath.join(logsDir, 'dryruns');
          fs.ensureDirSync(dryDir);
          const summary = {
            strategy: 'triangular',
            path: Array.isArray((path as any).path) ? (path as any).path.join('→') : String((path as any).path || ''),
            tradeSize: path.tradeSize,
            expectedProfit: path.expectedProfit,
            totalFees: path.totalFees,
            hops: hopArtifacts,
            timestamp: new Date().toISOString()
          };
          const file = nodePath.join(dryDir, `dryrun_enhanced_${Date.now()}_triangular.json`);
          fs.writeFileSync(file, JSON.stringify(summary, null, 2));
        } catch {}
      }

      return { profit: actualProfit, volume: path.tradeSize };

    } catch (error: any) {
      console.log(`   ❌ Error during triangular execution: ${error.message}`);
      throw error;
    }
  }

  // Helper method to get current prices for a token pair
  private async getCurrentPrice(tokenA: string, tokenB: string): Promise<number> {
    try {
      // Get real price from GalaChain SDK
      const tIn = this.getTokenString(tokenA);
      const tOut = this.getTokenString(tokenB);

      // Find best fee tier for price calculation
      const feeTiers = [500, 3000, 10000];
      let bestQuote = null;

      for (const feeTier of feeTiers) {
        try {
          const quote = await this.gswap.quoting.quoteExactInput(tIn, tOut, '1', feeTier);
          const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);

          if (!bestQuote || outAmount > Number((bestQuote as any).outTokenAmount?.toString?.() ?? bestQuote.outTokenAmount)) {
            bestQuote = quote;
          }
        } catch (error) {
          continue;
        }
      }

      if (!bestQuote) {
        throw new Error(`Failed to get price for ${tokenA}/${tokenB}`);
      }

      const quote = bestQuote;
      const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);

      return outAmount; // This is the price of tokenA in terms of tokenB
    } catch (error) {
      throw new Error(`Failed to get price for ${tokenA}/${tokenB}: ${error}`);
    }
  }
}
