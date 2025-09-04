import 'dotenv/config';
import { GSwap } from '@gala-chain/gswap-sdk';
import fs from 'fs-extra';
import path from 'node:path';

/**
 * Real-time Pool Monitor for GalaSwap
 *
 * Provides comprehensive pool data access including:
 * - Pool liquidity and reserves
 * - Price impact analysis
 * - Fee tier optimization
 * - Historical tracking
 * - Live monitoring capabilities
 */

export interface PoolData {
  pair: string;
  tokenA: string;
  tokenB: string;
  feeTier: number;
  liquidity: string;
  sqrtPriceX96: string;
  tick: number;
  reserve0: number;
  reserve1: number;
  priceImpact: number;
  volume24h?: number;
  fees24h?: number;
  lastUpdated: number;
  available: boolean;
}

export interface PoolSnapshot {
  timestamp: number;
  pools: PoolData[];
  totalLiquidity: number;
  activePoolCount: number;
  averageFeeReturn: number;
}

export class PoolMonitor {
  private gswap: GSwap;
  private monitoredPools: string[];
  private poolCache: Map<string, PoolData> = new Map();
  private cacheTTL: number = 15000; // 15 seconds
  private isMonitoring: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private logDir: string;

  constructor() {
    // Initialize GSwap client with latest endpoints
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

    // Default monitored pools
    this.monitoredPools = [
      'GALA/GUSDC', 'GALA/GWETH', 'GALA/GUSDT', 'GALA/GWBTC',
      'GUSDC/GWETH', 'GUSDC/GUSDT', 'GUSDC/GWBTC',
      'GWETH/GUSDT', 'GWETH/GWBTC', 'GUSDT/GWBTC',
      'GALA/SILK', 'GUSDC/SILK', 'GWETH/SILK',
      'GALA/ETIME', 'GUSDC/ETIME', 'SILK/ETIME'
    ];

    this.logDir = path.join(process.cwd(), 'logs', 'pools');
    fs.ensureDirSync(this.logDir);

    console.log(`🏊 Pool Monitor initialized - tracking ${this.monitoredPools.length} pools`);
  }

  /**
   * Get real-time pool data for a specific pair
   */
  async getPoolData(tokenA: string, tokenB: string, feeTier?: number): Promise<PoolData | null> {
    const pairKey = `${tokenA}/${tokenB}`;
    const now = Date.now();

    // Check cache first
    const cached = this.poolCache.get(pairKey);
    if (cached && (now - cached.lastUpdated) < this.cacheTTL) {
      return cached;
    }

    try {
      const tA = this.getTokenString(tokenA);
      const tB = this.getTokenString(tokenB);
      const testAmount = '1'; // 1 unit for testing

      // Try multiple fee tiers to find the best pool
      const feeTiers = feeTier ? [feeTier] : [500, 3000, 10000];
      let bestPoolData: PoolData | null = null;
      let bestLiquidity = 0;

      for (const tier of feeTiers) {
        try {
          // Get quote to access pool data
          const quote = await this.gswap.quoting.quoteExactInput(tA, tB, testAmount, tier);

          if (!quote) continue;

          // Extract pool information from quote response
          const poolInfo = this.extractPoolInfo(quote, tokenA, tokenB, tier);

          if (poolInfo && Number(poolInfo.liquidity) > bestLiquidity) {
            bestPoolData = poolInfo;
            bestLiquidity = Number(poolInfo.liquidity);
          }

        } catch (error) {
          // Pool doesn't exist for this fee tier
          continue;
        }
      }

      if (bestPoolData) {
        // Calculate additional metrics
        await this.enhancePoolData(bestPoolData);

        // Cache the result
        this.poolCache.set(pairKey, bestPoolData);

        console.log(`📊 Pool data updated: ${pairKey} (${bestPoolData.feeTier}bps) - Liquidity: ${bestPoolData.liquidity}`);
      }

      return bestPoolData;

    } catch (error: any) {
      console.log(`❌ Failed to get pool data for ${pairKey}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract pool information from quote response
   */
  private extractPoolInfo(quote: any, tokenA: string, tokenB: string, feeTier: number): PoolData | null {
    try {
      const outAmount = Number(quote.outTokenAmount?.toString() ?? quote.outTokenAmount);

      return {
        pair: `${tokenA}/${tokenB}`,
        tokenA,
        tokenB,
        feeTier,
        liquidity: quote.liquidity?.toString() || '0',
        sqrtPriceX96: quote.sqrtPriceX96?.toString() || '0',
        tick: Number(quote.tick) || 0,
        reserve0: 0, // Will be calculated in enhancement
        reserve1: outAmount,
        priceImpact: 0, // Will be calculated in enhancement
        lastUpdated: Date.now(),
        available: outAmount > 0
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Enhance pool data with additional calculations
   */
  private async enhancePoolData(poolData: PoolData): Promise<void> {
    try {
      // Calculate price impact by testing different amounts
      const baseAmount = 1;
      const largeAmount = 100;

      const tA = this.getTokenString(poolData.tokenA);
      const tB = this.getTokenString(poolData.tokenB);

      const [baseQuote, largeQuote] = await Promise.all([
        this.gswap.quoting.quoteExactInput(tA, tB, baseAmount.toString(), poolData.feeTier),
        this.gswap.quoting.quoteExactInput(tA, tB, largeAmount.toString(), poolData.feeTier)
      ]);

      if (baseQuote && largeQuote) {
        const basePrice = Number(baseQuote.outTokenAmount?.toString() ?? baseQuote.outTokenAmount) / baseAmount;
        const largePrice = Number(largeQuote.outTokenAmount?.toString() ?? largeQuote.outTokenAmount) / largeAmount;

        poolData.priceImpact = Math.abs(basePrice - largePrice) / basePrice * 100;
        poolData.reserve0 = baseAmount;
        poolData.reserve1 = Number(baseQuote.outTokenAmount?.toString() ?? baseQuote.outTokenAmount);
      }

    } catch (error) {
      // Enhancement failed, keep basic data
    }
  }

  /**
   * Get data for all monitored pools
   */
  async getAllPoolData(): Promise<PoolData[]> {
    console.log(`🔍 Scanning ${this.monitoredPools.length} pools...`);

    const poolPromises = this.monitoredPools.map(async (poolPair) => {
      const [tokenA, tokenB] = poolPair.split('/');
      return await this.getPoolData(tokenA, tokenB);
    });

    const results = await Promise.allSettled(poolPromises);

    return results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => (r as PromiseFulfilledResult<PoolData>).value);
  }

  /**
   * Start live pool monitoring
   */
  startLiveMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      console.log('⚠️ Pool monitoring already active');
      return;
    }

    console.log(`🔴 Starting live pool monitoring (${intervalMs/1000}s intervals)`);
    this.isMonitoring = true;

    this.monitorInterval = setInterval(async () => {
      try {
        const snapshot = await this.createPoolSnapshot();
        await this.savePoolSnapshot(snapshot);

        console.log(`📸 Pool snapshot: ${snapshot.activePoolCount} active pools, $${snapshot.totalLiquidity.toFixed(2)} total liquidity`);

        // Check for significant changes
        await this.detectPoolChanges(snapshot);

      } catch (error: any) {
        console.log(`❌ Pool monitoring error: ${error.message}`);
      }
    }, intervalMs);
  }

  /**
   * Stop live pool monitoring
   */
  stopLiveMonitoring(): void {
    if (!this.isMonitoring) return;

    console.log('🟥 Stopping live pool monitoring');
    this.isMonitoring = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  /**
   * Create a comprehensive pool snapshot
   */
  async createPoolSnapshot(): Promise<PoolSnapshot> {
    const pools = await this.getAllPoolData();

    const totalLiquidity = pools.reduce((sum, pool) => {
      return sum + (Number(pool.liquidity) / 1e18); // Convert from wei
    }, 0);

    const activePoolCount = pools.filter(p => p.available).length;

    const averageFeeReturn = pools.length > 0
      ? pools.reduce((sum, pool) => sum + pool.feeTier, 0) / pools.length
      : 0;

    return {
      timestamp: Date.now(),
      pools,
      totalLiquidity,
      activePoolCount,
      averageFeeReturn
    };
  }

  /**
   * Detect significant pool changes
   */
  private async detectPoolChanges(currentSnapshot: PoolSnapshot): Promise<void> {
    // Load previous snapshot for comparison
    const prevSnapshotFile = path.join(this.logDir, 'latest-snapshot.json');

    if (!fs.existsSync(prevSnapshotFile)) return;

    try {
      const prevSnapshot: PoolSnapshot = JSON.parse(fs.readFileSync(prevSnapshotFile, 'utf8'));

      // Check for significant liquidity changes
      const liquidityChange = Math.abs(currentSnapshot.totalLiquidity - prevSnapshot.totalLiquidity);
      const liquidityChangePercent = (liquidityChange / prevSnapshot.totalLiquidity) * 100;

      if (liquidityChangePercent > 10) {
        console.log(`🚨 Significant liquidity change detected: ${liquidityChangePercent.toFixed(2)}%`);
      }

      // Check for new or disappeared pools
      const currentPairs = new Set(currentSnapshot.pools.map(p => p.pair));
      const prevPairs = new Set(prevSnapshot.pools.map(p => p.pair));

      const newPools = [...currentPairs].filter(p => !prevPairs.has(p));
      const removedPools = [...prevPairs].filter(p => !currentPairs.has(p));

      if (newPools.length > 0) {
        console.log(`🆕 New pools detected: ${newPools.join(', ')}`);
      }

      if (removedPools.length > 0) {
        console.log(`🔴 Pools removed: ${removedPools.join(', ')}`);
      }

    } catch (error) {
      // Previous snapshot corrupted or missing
    }
  }

  /**
   * Save pool snapshot to disk
   */
  private async savePoolSnapshot(snapshot: PoolSnapshot): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotFile = path.join(this.logDir, `snapshot-${timestamp}.json`);
    const latestFile = path.join(this.logDir, 'latest-snapshot.json');

    await fs.writeJson(snapshotFile, snapshot, { spaces: 2 });
    await fs.writeJson(latestFile, snapshot, { spaces: 2 });
  }

  /**
   * Find best pools for arbitrage opportunities
   */
  async findArbitrageOpportunities(minProfitBps: number = 20): Promise<Array<{
    pair: string;
    buyPool: PoolData;
    sellPool: PoolData;
    profitBps: number;
    volume: number;
  }>> {
    const pools = await this.getAllPoolData();
    const opportunities: any[] = [];

    // Group pools by token pair (ignoring direction)
    const pairGroups = new Map<string, PoolData[]>();

    for (const pool of pools) {
      const normalizedPair = [pool.tokenA, pool.tokenB].sort().join('/');
      if (!pairGroups.has(normalizedPair)) {
        pairGroups.set(normalizedPair, []);
      }
      pairGroups.get(normalizedPair)!.push(pool);
    }

    // Look for price differences between fee tiers
    for (const [pair, poolGroup] of pairGroups) {
      if (poolGroup.length < 2) continue;

      for (let i = 0; i < poolGroup.length; i++) {
        for (let j = i + 1; j < poolGroup.length; j++) {
          const pool1 = poolGroup[i];
          const pool2 = poolGroup[j];

          // Calculate price difference
          const price1 = pool1.reserve1 / pool1.reserve0;
          const price2 = pool2.reserve1 / pool2.reserve0;

          if (price1 === 0 || price2 === 0) continue;

          const priceDiff = Math.abs(price1 - price2);
          const profitBps = (priceDiff / Math.min(price1, price2)) * 10000;

          if (profitBps >= minProfitBps) {
            const buyPool = price1 < price2 ? pool1 : pool2;
            const sellPool = price1 < price2 ? pool2 : pool1;

            opportunities.push({
              pair,
              buyPool,
              sellPool,
              profitBps,
              volume: Math.min(Number(buyPool.liquidity), Number(sellPool.liquidity)) / 1e18
            });
          }
        }
      }
    }

    return opportunities.sort((a, b) => b.profitBps - a.profitBps);
  }

  /**
   * Get pool statistics report
   */
  async getPoolReport(): Promise<string> {
    const snapshot = await this.createPoolSnapshot();
    const opportunities = await this.findArbitrageOpportunities();

    const report = [
      '🏊 POOL MONITOR REPORT',
      '=====================',
      '',
      `📊 Pool Statistics:`,
      `   Active Pools: ${snapshot.activePoolCount}/${this.monitoredPools.length}`,
      `   Total Liquidity: $${snapshot.totalLiquidity.toFixed(2)}`,
      `   Average Fee Tier: ${snapshot.averageFeeReturn.toFixed(0)}bps`,
      '',
      `💰 Top Arbitrage Opportunities:`,
      ...opportunities.slice(0, 5).map(opp =>
        `   ${opp.pair}: ${opp.profitBps.toFixed(0)}bps profit (${opp.buyPool.feeTier}→${opp.sellPool.feeTier}bps)`
      ),
      '',
      `🔄 Pool Activity:`,
      ...snapshot.pools.filter(p => p.available).slice(0, 10).map(pool =>
        `   ${pool.pair}: ${pool.feeTier}bps, impact: ${pool.priceImpact.toFixed(2)}%`
      ),
      ''
    ];

    return report.join('\n');
  }

  private getTokenString(symbol: string): string {
    const TOKENS: Record<string, string> = {
      GALA: 'GALA|Unit|none|none',
      GUSDC: 'GUSDC|Unit|none|none',
      GWETH: 'GWETH|Unit|none|none',
      GWBTC: 'GWBTC|Unit|none|none',
      GUSDT: 'GUSDT|Unit|none|none',
      SILK: 'SILK|Unit|none|none',
      ETIME: 'ETIME|Unit|none|none'
    };

    const token = TOKENS[symbol];
    if (!token) throw new Error(`Unknown token symbol: ${symbol}`);
    return token;
  }
}

// Export singleton
export const poolMonitor = new PoolMonitor();
