import 'dotenv/config';
import { GSwap } from '@gala-chain/gswap-sdk';

/**
 * Performance Optimization System
 *
 * Provides quote caching, concurrent processing, fee tier optimization,
 * and other performance enhancements for trading strategies.
 */

interface CachedQuote {
  quote: any;
  timestamp: number;
  feeTier: number;
}

interface QuoteCache {
  [key: string]: CachedQuote;
}

interface OptimalFeeResult {
  feeTier: number;
  expectedOutput: number;
  confidence: number;
}

export class PerformanceOptimizer {
  private quoteCache: QuoteCache = {};
  private cacheTTL: number = 30000; // 30 seconds
  private gswap: GSwap;
  private feeTierHistory: Map<string, number[]> = new Map();
  private lastOptimization: number = 0;
  private optimizationInterval: number = 300000; // 5 minutes

  constructor(gswap: GSwap) {
    this.gswap = gswap;
    console.log('⚡ Performance Optimizer initialized');
  }

  /**
   * Get cached quote or fetch new one with performance optimizations
   */
  async getOptimizedQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    preferredFeeTier?: number
  ): Promise<any> {
    const cacheKey = `${tokenIn}:${tokenOut}:${amountIn}`;
    const now = Date.now();

    // Check cache first
    const cached = this.quoteCache[cacheKey];
    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      console.log(`📋 Using cached quote for ${tokenIn}→${tokenOut}`);
      return { ...cached.quote, feeTier: cached.feeTier, fromCache: true };
    }

    // Get optimal fee tier
    const optimalFee = preferredFeeTier || await this.getOptimalFeeTier(tokenIn, tokenOut, amountIn);

    try {
      // Fetch new quote
      const quote = await this.gswap.quoting.quoteExactInput(
        tokenIn,
        tokenOut,
        amountIn,
        optimalFee
      );

      // Cache the result
      this.quoteCache[cacheKey] = {
        quote,
        timestamp: now,
        feeTier: optimalFee
      };

      // Clean old cache entries
      this.cleanCache();

      console.log(`🔄 Fresh quote cached for ${tokenIn}→${tokenOut} (fee: ${optimalFee}bps)`);
      return { ...quote, feeTier: optimalFee, fromCache: false };

    } catch (error: any) {
      console.log(`❌ Quote fetch failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get quotes for multiple pairs concurrently
   */
  async getBatchQuotes(
    requests: Array<{
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      preferredFeeTier?: number;
    }>
  ): Promise<Array<{ quote: any; error?: string; index: number }>> {
    console.log(`⚡ Fetching ${requests.length} quotes concurrently`);

    const promises = requests.map(async (req, index) => {
      try {
        const quote = await this.getOptimizedQuote(
          req.tokenIn,
          req.tokenOut,
          req.amountIn,
          req.preferredFeeTier
        );
        return { quote, index };
      } catch (error: any) {
        return { quote: null, error: error.message, index };
      }
    });

    const results = await Promise.allSettled(promises);

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return { quote: null, error: result.reason?.message || 'Unknown error', index };
      }
    });
  }

  /**
   * Determine optimal fee tier based on historical performance and liquidity
   */
  private async getOptimalFeeTier(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<number> {
    const pairKey = `${tokenIn}:${tokenOut}`;

    // Try multiple fee tiers concurrently to find the best
    const feeTiers = [500, 3000, 10000]; // 0.05%, 0.3%, 1.0%
    const now = Date.now();

    // Skip optimization if done recently
    if (now - this.lastOptimization < this.optimizationInterval) {
      return this.getBestHistoricalFeeTier(pairKey) || 3000;
    }

    console.log(`🔍 Optimizing fee tier for ${tokenIn}→${tokenOut}`);

    try {
      const quotePromises = feeTiers.map(async (feeTier) => {
        try {
          const quote = await this.gswap.quoting.quoteExactInput(
            tokenIn,
            tokenOut,
            amountIn,
            feeTier
          );
          const output = Number(quote.outTokenAmount?.toString() ?? quote.outTokenAmount);

          return {
            feeTier,
            output,
            quote,
            efficiency: output / (1 + feeTier / 1000000) // Adjust for fee cost
          };
        } catch (error) {
          return {
            feeTier,
            output: 0,
            quote: null,
            efficiency: 0
          };
        }
      });

      const results = await Promise.allSettled(quotePromises);
      const validResults = results
        .filter(r => r.status === 'fulfilled' && r.value.output > 0)
        .map(r => (r as PromiseFulfilledResult<any>).value);

      if (validResults.length === 0) {
        return 3000; // Default fallback
      }

      // Find the most efficient fee tier
      const optimal = validResults.reduce((best, current) =>
        current.efficiency > best.efficiency ? current : best
      );

      // Update historical data
      this.updateFeeTierHistory(pairKey, optimal.feeTier);
      this.lastOptimization = now;

      console.log(`✅ Optimal fee tier for ${pairKey}: ${optimal.feeTier}bps (output: ${optimal.output.toFixed(6)})`);
      return optimal.feeTier;

    } catch (error: any) {
      console.log(`⚠️ Fee tier optimization failed: ${error.message}`);
      return this.getBestHistoricalFeeTier(pairKey) || 3000;
    }
  }

  /**
   * Update historical fee tier performance
   */
  private updateFeeTierHistory(pairKey: string, feeTier: number): void {
    const history = this.feeTierHistory.get(pairKey) || [];
    history.push(feeTier);

    // Keep only last 20 entries
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    this.feeTierHistory.set(pairKey, history);
  }

  /**
   * Get most frequently used fee tier from history
   */
  private getBestHistoricalFeeTier(pairKey: string): number | null {
    const history = this.feeTierHistory.get(pairKey);
    if (!history || history.length === 0) return null;

    // Count frequency of each fee tier
    const counts = history.reduce((acc, feeTier) => {
      acc[feeTier] = (acc[feeTier] || 0) + 1;
      return acc;
    }, {} as { [key: number]: number });

    // Return most frequent
    return Number(Object.keys(counts).reduce((a, b) =>
      counts[Number(a)] > counts[Number(b)] ? a : b
    ));
  }

  /**
   * Concurrent arbitrage path evaluation
   */
  async evaluateArbitragePathsConcurrently(
    paths: Array<{
      tokenA: string;
      tokenB: string;
      amountIn: string;
    }>
  ): Promise<Array<{
    path: string;
    profit: number;
    profitBps: number;
    forwardQuote: any;
    reverseQuote: any;
    viable: boolean;
  }>> {
    console.log(`⚡ Evaluating ${paths.length} arbitrage paths concurrently`);

    const evaluationPromises = paths.map(async (path) => {
      try {
        // Get forward and reverse quotes concurrently
        const [forwardQuote, reverseQuote] = await Promise.all([
          this.getOptimizedQuote(path.tokenA, path.tokenB, path.amountIn),
          this.getOptimizedQuote(
            path.tokenB,
            path.tokenA,
            '1' // We'll scale this based on forward quote
          )
        ]);

        const forwardOutput = Number(forwardQuote.outTokenAmount?.toString() ?? forwardQuote.outTokenAmount);

        // Get reverse quote with actual forward output
        const actualReverseQuote = await this.getOptimizedQuote(
          path.tokenB,
          path.tokenA,
          forwardOutput.toString()
        );

        const reverseOutput = Number(actualReverseQuote.outTokenAmount?.toString() ?? actualReverseQuote.outTokenAmount);
        const inputAmount = Number(path.amountIn);

        const profit = reverseOutput - inputAmount;
        const profitBps = Math.round((profit / inputAmount) * 10000);

        return {
          path: `${path.tokenA}→${path.tokenB}→${path.tokenA}`,
          profit,
          profitBps,
          forwardQuote,
          reverseQuote: actualReverseQuote,
          viable: profitBps > 20 // Minimum 0.2% profit
        };
      } catch (error: any) {
        return {
          path: `${path.tokenA}→${path.tokenB}→${path.tokenA}`,
          profit: 0,
          profitBps: 0,
          forwardQuote: null,
          reverseQuote: null,
          viable: false
        };
      }
    });

    const results = await Promise.allSettled(evaluationPromises);

    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value)
      .sort((a, b) => b.profitBps - a.profitBps); // Sort by profit descending
  }

  /**
   * Dynamic slippage calculation based on market conditions
   */
  calculateOptimalSlippage(
    baseSlippage: number,
    volatility: number,
    liquidity: number,
    urgency: number = 1
  ): number {
    // Base slippage adjusted for market conditions
    let optimalSlippage = baseSlippage;

    // Increase slippage for high volatility
    optimalSlippage *= (1 + volatility * 0.5);

    // Increase slippage for low liquidity
    const liquidityAdjustment = Math.max(0.5, Math.min(2, 1 / Math.sqrt(liquidity)));
    optimalSlippage *= liquidityAdjustment;

    // Increase slippage for urgent trades
    optimalSlippage *= urgency;

    // Cap between 0.1% and 5%
    return Math.max(10, Math.min(500, Math.round(optimalSlippage)));
  }

  /**
   * MEV protection through randomized delays
   */
  async getMEVProtectionDelay(): Promise<number> {
    // Random delay between 1-5 seconds to avoid MEV bots
    const baseDelay = 1000 + Math.random() * 4000;

    // Add small random jitter
    const jitter = Math.random() * 500;

    return Math.round(baseDelay + jitter);
  }

  /**
   * Clean expired cache entries
   */
  private cleanCache(): void {
    const now = Date.now();
    const expiredKeys = Object.keys(this.quoteCache).filter(
      key => now - this.quoteCache[key].timestamp > this.cacheTTL
    );

    expiredKeys.forEach(key => delete this.quoteCache[key]);

    if (expiredKeys.length > 0) {
      console.log(`🧹 Cleaned ${expiredKeys.length} expired cache entries`);
    }
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): {
    cacheHitRate: number;
    cacheSize: number;
    feeTierOptimizations: number;
    lastOptimization: string;
  } {
    const totalQuotes = Object.keys(this.quoteCache).length;
    const cacheHits = Object.values(this.quoteCache).filter(c => c.timestamp > 0).length;

    return {
      cacheHitRate: totalQuotes > 0 ? (cacheHits / totalQuotes) * 100 : 0,
      cacheSize: totalQuotes,
      feeTierOptimizations: this.feeTierHistory.size,
      lastOptimization: new Date(this.lastOptimization).toISOString()
    };
  }

  /**
   * Clear all caches (useful for testing)
   */
  clearCaches(): void {
    this.quoteCache = {};
    this.feeTierHistory.clear();
    this.lastOptimization = 0;
    console.log('🧹 All performance caches cleared');
  }
}

// Export for use in strategies
export const createPerformanceOptimizer = (gswap: GSwap) => new PerformanceOptimizer(gswap);
