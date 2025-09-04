import 'dotenv/config';

/**
 * Cross-DEX Price Monitor for Low Volume DEX Arbitrage
 *
 * Monitors GALA and other token prices across multiple exchanges
 * to identify arbitrage opportunities between GalaChain and external markets.
 *
 * Perfect for low-volume DEX environments where price inefficiencies persist.
 */

export interface ExternalPrice {
  exchange: string;
  pair: string;
  price: number;
  volume24h: number;
  liquidity?: number;
  timestamp: number;
  source: 'dex' | 'cex' | 'aggregator';
  confidence: number; // 0-1 based on volume and recency
}

export interface CrossDexOpportunity {
  token: string;
  galaChainPrice: number;
  externalPrice: number;
  priceDifference: number;
  profitBps: number;
  direction: 'buy_external_sell_galachain' | 'buy_galachain_sell_external';
  exchange: string;
  volume24h: number;
  confidence: number;
  estimatedProfit: number;
  bridgeRequired: boolean;
  bridgeCost?: number;
  timeToExecute: number; // Estimated minutes
}

export class CrossDexMonitor {
  private priceCache: Map<string, ExternalPrice[]> = new Map();
  private cacheTTL: number = 60000; // 1 minute cache for price data
  private supportedTokens: string[];

  constructor() {
    this.supportedTokens = ['GALA', 'USDC', 'ETH', 'USDT'];
    console.log('🌐 Cross-DEX Monitor initialized for:', this.supportedTokens.join(', '));
  }

  /**
   * Get external prices from multiple sources
   */
  async getExternalPrices(token: string): Promise<ExternalPrice[]> {
    const cacheKey = token.toUpperCase();
    const now = Date.now();

    // Check cache
    const cached = this.priceCache.get(cacheKey);
    if (cached && cached.length > 0 && (now - cached[0].timestamp) < this.cacheTTL) {
      return cached;
    }

    console.log(`🔍 Fetching external prices for ${token}...`);

    const pricePromises = [
      this.getCoinGeckoPrices(token),
      this.getBinancePrices(token),
      this.getCoinbasePrices(token),
      this.getDexScreenerPrices(token)
    ];

    const results = await Promise.allSettled(pricePromises);
    const allPrices: ExternalPrice[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        allPrices.push(...result.value);
      }
    }

    // Sort by confidence
    allPrices.sort((a, b) => b.confidence - a.confidence);
    this.priceCache.set(cacheKey, allPrices);

    console.log(`📊 Found ${allPrices.length} external prices for ${token}`);
    return allPrices;
  }

  /**
   * CoinGecko aggregated prices (free API)
   */
  private async getCoinGeckoPrices(token: string): Promise<ExternalPrice[]> {
    try {
      const tokenIds: Record<string, string> = {
        'GALA': 'gala',
        'USDC': 'usd-coin',
        'ETH': 'ethereum',
        'USDT': 'tether'
      };

      const tokenId = tokenIds[token.toUpperCase()];
      if (!tokenId) return [];

      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd&include_24hr_vol=true`;
      const response = await fetch(url);

      if (!response.ok) return [];
      const data = await response.json() as any;

      const price = data[tokenId]?.usd;
      const volume = data[tokenId]?.usd_24h_vol || 0;

      if (!price) return [];

      return [{
        exchange: 'CoinGecko_Aggregate',
        pair: `${token}/USD`,
        price,
        volume24h: volume,
        timestamp: Date.now(),
        source: 'aggregator',
        confidence: Math.min(1, volume / 1000000) // Max confidence at $1M volume
      }];

    } catch (error) {
      return [];
    }
  }

  /**
   * Binance prices (high volume, reliable)
   */
  private async getBinancePrices(token: string): Promise<ExternalPrice[]> {
    try {
      const binanceSymbols: Record<string, string> = {
        'GALA': 'GALAUSDT',
        'ETH': 'ETHUSDT',
        'USDC': 'USDCUSDT'
      };

      const symbol = binanceSymbols[token.toUpperCase()];
      if (!symbol) return [];

      const [priceRes, statsRes] = await Promise.all([
        fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`),
        fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`)
      ]);

      if (!priceRes.ok || !statsRes.ok) return [];

      const priceData = await priceRes.json() as any;
      const statsData = await statsRes.json() as any;

      return [{
        exchange: 'Binance',
        pair: symbol.replace('USDT', '/USDT'),
        price: Number(priceData.price),
        volume24h: Number(statsData.quoteVolume),
        timestamp: Date.now(),
        source: 'cex',
        confidence: 0.95 // Very high confidence for Binance
      }];

    } catch (error) {
      return [];
    }
  }

  /**
   * Coinbase prices
   */
  private async getCoinbasePrices(token: string): Promise<ExternalPrice[]> {
    try {
      const coinbaseSymbols: Record<string, string> = {
        'GALA': 'GALA-USD',
        'ETH': 'ETH-USD',
        'USDC': 'USDC-USD'
      };

      const symbol = coinbaseSymbols[token.toUpperCase()];
      if (!symbol) return [];

      const response = await fetch(`https://api.exchange.coinbase.com/products/${symbol}/ticker`);
      if (!response.ok) return [];

      const data = await response.json() as any;

      return [{
        exchange: 'Coinbase',
        pair: symbol,
        price: Number(data.price),
        volume24h: Number(data.volume) * Number(data.price), // Convert to USD volume
        timestamp: Date.now(),
        source: 'cex',
        confidence: 0.9 // High confidence for Coinbase
      }];

    } catch (error) {
      return [];
    }
  }

  /**
   * DexScreener for DEX prices
   */
  private async getDexScreenerPrices(token: string): Promise<ExternalPrice[]> {
    try {
      // GALA contract addresses on different chains
      const contracts: Record<string, string> = {
        'GALA': '0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA' // Ethereum
      };

      const contract = contracts[token.toUpperCase()];
      if (!contract) return [];

      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contract}`);
      if (!response.ok) return [];

      const data = await response.json() as any;
      const pairs = data.pairs || [];

      return pairs
        .filter((pair: any) => pair.volume?.h24 > 5000) // Min $5k volume
        .slice(0, 3) // Top 3 DEX pairs
        .map((pair: any) => ({
          exchange: `${pair.dexId}_${pair.chainId}`,
          pair: `${token}/${pair.quoteToken?.symbol || 'USD'}`,
          price: Number(pair.priceUsd || 0),
          volume24h: Number(pair.volume?.h24 || 0),
          liquidity: Number(pair.liquidity?.usd || 0),
          timestamp: Date.now(),
          source: 'dex' as const,
          confidence: Math.min(0.8, Number(pair.volume?.h24 || 0) / 50000) // Max 0.8 confidence
        }));

    } catch (error) {
      return [];
    }
  }

  /**
   * Find cross-DEX arbitrage opportunities
   */
  async findCrossDexOpportunities(
    galaChainPrices: Map<string, number>,
    minProfitBps: number = 100 // 1% minimum
  ): Promise<CrossDexOpportunity[]> {
    const opportunities: CrossDexOpportunity[] = [];

    for (const [token, galaPrice] of galaChainPrices) {
      const externalPrices = await this.getExternalPrices(token);

      for (const extPrice of externalPrices) {
        // Filter low-quality prices
        if (extPrice.confidence < 0.4 || extPrice.volume24h < 10000) continue;

        const priceDiff = Math.abs(galaPrice - extPrice.price);
        const profitBps = (priceDiff / Math.min(galaPrice, extPrice.price)) * 10000;

        if (profitBps >= minProfitBps) {
          const direction = galaPrice > extPrice.price
            ? 'buy_external_sell_galachain' as const
            : 'buy_galachain_sell_external' as const;

          // Estimate execution details
          const bridgeRequired = extPrice.source !== 'aggregator';
          const bridgeCost = this.estimateBridgeCost(token, extPrice.exchange);
          const timeToExecute = this.estimateExecutionTime(extPrice.exchange, bridgeRequired);
          const estimatedProfit = this.calculateEstimatedProfit(profitBps, bridgeCost, 1000); // $1000 trade size

          if (estimatedProfit > 20) { // Min $20 profit after costs
            opportunities.push({
              token,
              galaChainPrice: galaPrice,
              externalPrice: extPrice.price,
              priceDifference: priceDiff,
              profitBps,
              direction,
              exchange: extPrice.exchange,
              volume24h: extPrice.volume24h,
              confidence: extPrice.confidence,
              estimatedProfit,
              bridgeRequired,
              bridgeCost,
              timeToExecute
            });
          }
        }
      }
    }

    return opportunities.sort((a, b) => b.estimatedProfit - a.estimatedProfit);
  }

  /**
   * Estimate bridge costs for cross-chain arbitrage
   */
  private estimateBridgeCost(token: string, exchange: string): number {
    // Bridge cost estimates based on typical cross-chain operations
    const bridgeCosts: Record<string, number> = {
      'Binance': 5, // CEX withdrawal
      'Coinbase': 8, // CEX withdrawal
      'uniswap': 25, // ETH gas + bridge
      'pancakeswap': 15, // BSC gas + bridge
      'sushiswap': 30, // ETH gas + bridge
      'default': 20
    };

    const exchangeLower = exchange.toLowerCase();
    for (const [key, cost] of Object.entries(bridgeCosts)) {
      if (exchangeLower.includes(key.toLowerCase())) {
        return cost;
      }
    }

    return bridgeCosts.default;
  }

  /**
   * Estimate execution time
   */
  private estimateExecutionTime(exchange: string, bridgeRequired: boolean): number {
    if (!bridgeRequired) return 2; // 2 minutes for same-chain

    // Cross-chain execution times
    const executionTimes: Record<string, number> = {
      'binance': 15, // CEX processing
      'coinbase': 20, // CEX processing
      'ethereum': 45, // ETH bridge + confirmation
      'bsc': 25, // BSC bridge
      'polygon': 20, // Polygon bridge
      'default': 30
    };

    const exchangeLower = exchange.toLowerCase();
    for (const [key, time] of Object.entries(executionTimes)) {
      if (exchangeLower.includes(key)) {
        return time;
      }
    }

    return executionTimes.default;
  }

  /**
   * Calculate estimated profit after all costs
   */
  private calculateEstimatedProfit(profitBps: number, bridgeCost: number, tradeSize: number): number {
    const grossProfit = (profitBps / 10000) * tradeSize;
    const gasCost = 5; // Estimated GalaChain gas
    const slippageCost = tradeSize * 0.002; // 0.2% slippage

    return grossProfit - bridgeCost - gasCost - slippageCost;
  }

  /**
   * Generate cross-DEX report
   */
  async generateCrossDexReport(galaChainPrices: Map<string, number>): Promise<string> {
    const opportunities = await this.findCrossDexOpportunities(galaChainPrices, 50);

    const report = [
      '🌐 CROSS-DEX ARBITRAGE REPORT',
      '============================',
      `Generated: ${new Date().toISOString()}`,
      '',
      '📊 Price Comparison:'
    ];

    // Add price comparison
    for (const [token, galaPrice] of galaChainPrices) {
      const external = await this.getExternalPrices(token);
      const best = external[0];

      report.push(`\n${token}:`);
      report.push(`  GalaChain: $${galaPrice.toFixed(6)}`);
      if (best) {
        const diff = ((galaPrice - best.price) / best.price * 100);
        report.push(`  ${best.exchange}: $${best.price.toFixed(6)} (${diff > 0 ? '+' : ''}${diff.toFixed(2)}%)`);
      }
    }

    // Add opportunities
    if (opportunities.length > 0) {
      report.push('\n💰 TOP ARBITRAGE OPPORTUNITIES:');
      opportunities.slice(0, 5).forEach((opp, i) => {
        report.push(`\n${i + 1}. ${opp.token} via ${opp.exchange}`);
        report.push(`   Profit: ${opp.profitBps.toFixed(0)}bps (~$${opp.estimatedProfit.toFixed(2)})`);
        report.push(`   Direction: ${opp.direction.replace(/_/g, ' ')}`);
        report.push(`   Time: ~${opp.timeToExecute}min, Bridge: ${opp.bridgeRequired ? `$${opp.bridgeCost}` : 'No'}`);
        report.push(`   Confidence: ${(opp.confidence * 100).toFixed(0)}%`);
      });
    } else {
      report.push('\n💰 No profitable opportunities found (check thresholds)');
    }

    return report.join('\n');
  }

  /**
   * Start monitoring with alerts
   */
  startMonitoring(
    galaChainPrices: Map<string, number>,
    intervalMs: number = 120000, // 2 minutes
    alertCallback?: (opportunities: CrossDexOpportunity[]) => void
  ): NodeJS.Timeout {
    console.log('🌐 Starting cross-DEX monitoring...');

    return setInterval(async () => {
      try {
        const opportunities = await this.findCrossDexOpportunities(galaChainPrices, 100);

        if (opportunities.length > 0) {
          console.log(`🚨 ${opportunities.length} cross-DEX opportunities detected!`);

          opportunities.forEach(opp => {
            console.log(`   ${opp.token}: ${opp.profitBps.toFixed(0)}bps on ${opp.exchange} (~$${opp.estimatedProfit.toFixed(2)})`);
          });

          if (alertCallback) alertCallback(opportunities);
        }
      } catch (error) {
        console.log(`❌ Cross-DEX monitoring error: ${error}`);
      }
    }, intervalMs);
  }
}

export const crossDexMonitor = new CrossDexMonitor();
