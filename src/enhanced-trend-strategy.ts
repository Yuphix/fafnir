import 'dotenv/config';
import fs from 'fs-extra';
import path from 'node:path';
import { GalaChainSwapAuth, TransactionLogEntry } from './galachain-swap-auth.js';
import { createPerformanceOptimizer } from './performance-optimizer.js';
import { GSwap } from '@gala-chain/gswap-sdk';
import axios from 'axios';

/**
 * Enhanced Trend Strategy - Optimized for Discovered Pools
 *
 * Based on discovery results:
 * - GALA/GUSDC (10000bps) - Primary trading pair ⭐⭐⭐
 * - GUSDC/GALA (500bps) - Lower fee alternative ⭐⭐⭐
 * - Fallback to GALA/GUSDT if needed
 *
 * Improvements over original:
 * 1. Multi-pool optimization
 * 2. Dynamic fee tier selection
 * 3. Enhanced risk management
 * 4. Better price discovery
 * 5. Pool health monitoring
 */

interface TrendConfig {
  // Pool configuration
  primaryPair: string;        // "GALA/GUSDC"
  fallbackPair: string;       // "GALA/GUSDT"
  preferredFeeTiers: number[];// [500, 10000] based on discovery

  // Trading parameters
  orderSizeGusdc: number;     // Position size in GUSDC
  buyDrawdownPct: number;     // Buy on -X% drop
  sellTakeProfitPct: number;  // Sell on +X% gain
  slippageBps: number;        // Slippage tolerance

  // Price source configuration
  priceSource: 'galaswap' | 'coingecko' | 'hybrid'; // Price data source
  coingeckoId: string;        // CoinGecko token ID
  backfillHistory: boolean;   // Backfill 24h history on startup

  // Risk management
  maxPositionGala: number;    // Max GALA position
  stopLossPct: number;        // Emergency exit
  cooldownMs: number;         // Min time between trades

  // Monitoring
  pollIntervalMs: number;     // Price check frequency
  maxHistoryHours: number;    // Price history to keep
  dryRun: boolean;           // Paper trading mode
}

interface PriceSample {
  timestamp: number;
  price: number;
  source: string;
  pool: string;
  feeTier: number;
}

interface TradeEntry {
  timestamp: number;
  action: 'BUY' | 'SELL';
  amountGusdc: number;
  amountGala: number;
  price: number;
  pool: string;
  feeTier: number;
  reason: string;
  txId?: string;
}

export class EnhancedTrendStrategy {
  private config: TrendConfig;
  private swapAuth: GalaChainSwapAuth;
  private gswap: GSwap;
  private performanceOptimizer: any;
  private priceHistory: PriceSample[] = [];
  private tradeHistory: TradeEntry[] = [];
  private lastTradeTime: number = 0;
  private logDir: string;

  constructor(config?: Partial<TrendConfig>) {
        this.config = {
      primaryPair: 'GALA/GUSDC',
      fallbackPair: 'GALA/GUSDT',
      preferredFeeTiers: [500, 10000], // Based on discovery: GUSDC/GALA(500bps), GALA/GUSDC(10000bps)
      orderSizeGusdc: Number(process.env.TREND_ORDER_SIZE_GUSDC || 20),
      buyDrawdownPct: Number(process.env.TREND_BUY_DRAWDOWN_PCT || 5),
      sellTakeProfitPct: Number(process.env.TREND_SELL_TP_PCT || 8),
      slippageBps: Number(process.env.TREND_SLIPPAGE_BPS || 80),
      priceSource: (process.env.TREND_PRICE_SOURCE || 'hybrid') as 'galaswap' | 'coingecko' | 'hybrid',
      coingeckoId: process.env.COINGECKO_ID || 'gala',
      backfillHistory: (process.env.TREND_BACKFILL_HISTORY || 'true').toLowerCase() === 'true',
      maxPositionGala: Number(process.env.TREND_MAX_POSITION_GALA || 2000),
      stopLossPct: Number(process.env.TREND_STOP_LOSS_PCT || 15),
      cooldownMs: Number(process.env.TREND_COOLDOWN_MS || 300000), // 5 minutes
      pollIntervalMs: Number(process.env.TREND_POLL_INTERVAL_MS || 600000), // 10 minutes
      maxHistoryHours: Number(process.env.TREND_MAX_HISTORY_HOURS || 48),
      dryRun: (process.env.TREND_DRY_RUN || 'true').toLowerCase() === 'true',
      ...config
    };

    // Initialize components
    this.swapAuth = new GalaChainSwapAuth();

    this.gswap = new GSwap({
      gatewayBaseUrl: process.env.GSWAP_GATEWAY_URL || 'https://gateway-mainnet.galachain.com',
      dexBackendBaseUrl: process.env.GSWAP_DEX_BACKEND_URL || 'https://dex-backend-prod1.defi.gala.com',
      bundlerBaseUrl: process.env.GSWAP_BUNDLER_URL || 'https://bundle-backend-prod1.defi.gala.com',
      dexContractBasePath: '/api/asset/dexv3-contract',
      tokenContractBasePath: '/api/asset/token-contract',
      bundlingAPIBasePath: '/bundle'
    });

    this.performanceOptimizer = createPerformanceOptimizer(this.gswap);

    this.logDir = path.join(process.cwd(), 'logs', 'enhanced-trend');
    fs.ensureDirSync(this.logDir);

        this.loadState();

    console.log(`📈 Enhanced Trend Strategy initialized:`);
    console.log(`   Primary pair: ${this.config.primaryPair}`);
    console.log(`   Price source: ${this.config.priceSource}`);
    console.log(`   Order size: $${this.config.orderSizeGusdc} GUSDC`);
    console.log(`   Buy trigger: -${this.config.buyDrawdownPct}%`);
    console.log(`   Sell target: +${this.config.sellTakeProfitPct}%`);
    console.log(`   Dry run: ${this.config.dryRun ? 'ON' : 'OFF'}`);

    // Backfill historical data if configured
    if (this.config.backfillHistory) {
      this.backfill24hHistory().catch(error => {
        this.log(`⚠️ Failed to backfill history: ${error.message}`);
      });
    }
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);

    const logFile = path.join(this.logDir, 'trend.log');
    fs.appendFileSync(logFile, logMessage + '\n');
  }

  private loadState(): void {
    try {
      const pricesFile = path.join(this.logDir, 'prices.json');
      const tradesFile = path.join(this.logDir, 'trades.json');

      if (fs.existsSync(pricesFile)) {
        this.priceHistory = JSON.parse(fs.readFileSync(pricesFile, 'utf8'));
      }

      if (fs.existsSync(tradesFile)) {
        this.tradeHistory = JSON.parse(fs.readFileSync(tradesFile, 'utf8'));
      }

      this.log(`📂 Loaded state: ${this.priceHistory.length} prices, ${this.tradeHistory.length} trades`);
    } catch (error: any) {
      this.log(`⚠️ Error loading state: ${error.message}`);
    }
  }

  private saveState(): void {
    try {
      const pricesFile = path.join(this.logDir, 'prices.json');
      const tradesFile = path.join(this.logDir, 'trades.json');

      fs.writeFileSync(pricesFile, JSON.stringify(this.priceHistory, null, 2));
      fs.writeFileSync(tradesFile, JSON.stringify(this.tradeHistory, null, 2));
    } catch (error: any) {
      this.log(`⚠️ Error saving state: ${error.message}`);
    }
  }

  private pruneOldData(): void {
    const cutoffTime = Date.now() - (this.config.maxHistoryHours * 60 * 60 * 1000);

    const oldPriceCount = this.priceHistory.length;
    this.priceHistory = this.priceHistory.filter(p => p.timestamp >= cutoffTime);

    if (this.priceHistory.length !== oldPriceCount) {
      this.log(`🧹 Pruned ${oldPriceCount - this.priceHistory.length} old price samples`);
    }
  }

  private getTokenString(symbol: string): string {
    const tokenMap: { [key: string]: string } = {
      'GALA': 'GALA|Unit|none|none',
      'GUSDC': 'GUSDC|Unit|none|none',
      'GUSDT': 'GUSDT|Unit|none|none'
    };

    const token = tokenMap[symbol];
    if (!token) throw new Error(`Unknown token symbol: ${symbol}`);
    return token;
  }

  /**
   * Get price from CoinGecko
   */
  private async getCoinGeckoPrice(): Promise<PriceSample> {
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${this.config.coingeckoId}&vs_currencies=usd`;
      const response = await axios.get(url, { timeout: 10000 });

      const price = response.data?.[this.config.coingeckoId]?.usd;
      if (!price || typeof price !== 'number') {
        throw new Error('Invalid CoinGecko price data');
      }

      return {
        timestamp: Date.now(),
        price,
        source: 'coingecko',
        pool: 'external',
        feeTier: 0
      };
    } catch (error: any) {
      throw new Error(`CoinGecko API error: ${error.message}`);
    }
  }

  /**
   * Backfill 24h price history from CoinGecko
   */
  private async backfill24hHistory(): Promise<void> {
    if (!this.config.backfillHistory || this.config.priceSource === 'galaswap') {
      return;
    }

    try {
      this.log('📊 Backfilling 24h price history from CoinGecko...');

      const url = `https://api.coingecko.com/api/v3/coins/${this.config.coingeckoId}/market_chart?vs_currency=usd&days=1&interval=hourly`;
      const response = await axios.get(url, { timeout: 15000 });

      const priceData: Array<[number, number]> = response.data?.prices || [];

      if (!Array.isArray(priceData) || priceData.length === 0) {
        throw new Error('No historical price data available');
      }

      // Convert to our format and merge with existing data
      const historicalPrices: PriceSample[] = priceData.map(([timestamp, price]) => ({
        timestamp,
        price,
        source: 'coingecko-historical',
        pool: 'external',
        feeTier: 0
      }));

      // Merge and deduplicate by timestamp
      const priceMap = new Map<number, PriceSample>();

      // Add existing prices first
      for (const price of this.priceHistory) {
        priceMap.set(price.timestamp, price);
      }

      // Add historical prices (older data won't overwrite newer)
      for (const price of historicalPrices) {
        if (!priceMap.has(price.timestamp)) {
          priceMap.set(price.timestamp, price);
        }
      }

      // Sort by timestamp and update history
      this.priceHistory = Array.from(priceMap.values()).sort((a, b) => a.timestamp - b.timestamp);

      this.log(`✅ Backfilled ${historicalPrices.length} historical price points`);
      this.log(`📈 Total price history: ${this.priceHistory.length} samples`);

    } catch (error: any) {
      this.log(`⚠️ Failed to backfill price history: ${error.message}`);
    }
  }

  /**
   * Get best price using our discovered optimal pools and fee tiers
   */
  private async getGalaSwapPrice(): Promise<PriceSample> {
    const pairs = [
      { pair: this.config.primaryPair, feeTiers: this.config.preferredFeeTiers },
      { pair: this.config.fallbackPair, feeTiers: [10000] } // GUSDT typically 10000bps
    ];

    let bestPrice: PriceSample | null = null;

    for (const { pair, feeTiers } of pairs) {
      for (const feeTier of feeTiers) {
        try {
          // For GALA price in GUSDC, we need GUSDC output per 1 GALA input
          const quote = await this.performanceOptimizer.getOptimizedQuote(
            this.getTokenString('GALA'),
            this.getTokenString(pair.includes('GUSDT') ? 'GUSDT' : 'GUSDC'),
            '1000', // Use 1000 GALA for better accuracy
            feeTier
          );

          if (quote && quote.outTokenAmount) {
            const outputAmount = Number(quote.outTokenAmount.toString());
            const price = outputAmount / 1000; // Price per 1 GALA

            const sample: PriceSample = {
              timestamp: Date.now(),
              price,
              source: 'galaswap',
              pool: pair,
              feeTier
            };

            // Use first successful quote as best (prioritized by order)
            if (!bestPrice) {
              bestPrice = sample;
              break;
            }
          }
        } catch (error: any) {
          // Try next fee tier/pair
        }
      }

      if (bestPrice) break; // Found good price, stop trying
    }

    if (!bestPrice) {
      throw new Error('No price available from any configured pool');
    }

    return bestPrice;
  }

  /**
   * Get optimal price based on configured source
   */
  private async getOptimalPrice(): Promise<PriceSample> {
    switch (this.config.priceSource) {
      case 'coingecko':
        return await this.getCoinGeckoPrice();

      case 'galaswap':
        return await this.getGalaSwapPrice();

      case 'hybrid':
      default:
        // Try GalaSwap first, fallback to CoinGecko
        try {
          return await this.getGalaSwapPrice();
        } catch (error) {
          this.log(`⚠️ GalaSwap price failed, using CoinGecko: ${error.message}`);
          return await this.getCoinGeckoPrice();
        }
    }
  }

  private getCurrentPosition(): number {
    let totalGala = 0;

    for (const trade of this.tradeHistory) {
      if (trade.action === 'BUY') {
        totalGala += trade.amountGala;
      } else {
        totalGala -= trade.amountGala;
      }
    }

    return Math.max(0, totalGala);
  }

  private getAverageEntryPrice(): number | null {
    let totalGala = 0;
    let weightedPriceSum = 0;

    // Calculate position-weighted average entry price
    for (const trade of this.tradeHistory) {
      if (trade.action === 'BUY') {
        totalGala += trade.amountGala;
        weightedPriceSum += trade.amountGala * trade.price;
      } else {
        totalGala -= trade.amountGala;
        weightedPriceSum -= trade.amountGala * trade.price;
      }
    }

    return totalGala > 0 ? weightedPriceSum / totalGala : null;
  }

    private async calculatePriceChange24h(currentPrice: number): Promise<number | null> {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const oldestRecentPrice = this.priceHistory.find(p => p.timestamp >= oneDayAgo);

    // If we have 24h history, use it
    if (oldestRecentPrice && oldestRecentPrice.timestamp <= oneDayAgo) {
      return ((currentPrice - oldestRecentPrice.price) / oldestRecentPrice.price) * 100;
    }

    // Fallback: get current CoinGecko price and compare with yesterday's price
    try {
      this.log('📊 Getting 24h price change from CoinGecko...');

      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${this.config.coingeckoId}&vs_currencies=usd&include_24hr_change=true`;
      const response = await axios.get(url, { timeout: 5000 });

      const data = response.data?.[this.config.coingeckoId];
      const change24h = data?.usd_24h_change;

      if (typeof change24h === 'number') {
        this.log(`📈 CoinGecko 24h change: ${change24h.toFixed(2)}%`);
        return change24h;
      }
    } catch (error: any) {
      this.log(`⚠️ CoinGecko 24h change failed: ${error.message}`);
    }

    return null;
  }

  private async shouldBuy(currentPrice: number): Promise<{ should: boolean; reason: string }> {
    // Check cooldown
    if (Date.now() - this.lastTradeTime < this.config.cooldownMs) {
      return { should: false, reason: 'Cooldown period active' };
    }

    // Check max position
    const currentPosition = this.getCurrentPosition();
    const maxPositionValue = this.config.maxPositionGala;

    if (currentPosition >= maxPositionValue) {
      return { should: false, reason: `Max position reached: ${currentPosition.toFixed(2)} GALA` };
    }

    // Check 24h drawdown
    const change24h = await this.calculatePriceChange24h(currentPrice);

    if (change24h === null) {
      return { should: false, reason: 'Insufficient price history for 24h analysis' };
    }

    if (change24h <= -this.config.buyDrawdownPct) {
      return {
        should: true,
        reason: `24h drawdown trigger: ${change24h.toFixed(2)}% <= -${this.config.buyDrawdownPct}%`
      };
    }

    return { should: false, reason: `24h change ${change24h.toFixed(2)}% above buy threshold` };
  }

  private shouldSell(currentPrice: number): { should: boolean; reason: string } {
    const currentPosition = this.getCurrentPosition();

    if (currentPosition <= 0) {
      return { should: false, reason: 'No position to sell' };
    }

    // Check cooldown
    if (Date.now() - this.lastTradeTime < this.config.cooldownMs) {
      return { should: false, reason: 'Cooldown period active' };
    }

    const avgEntryPrice = this.getAverageEntryPrice();

    if (!avgEntryPrice) {
      return { should: false, reason: 'No entry price available' };
    }

    const profitPct = ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100;

    // Check stop loss
    if (profitPct <= -this.config.stopLossPct) {
      return {
        should: true,
        reason: `Stop loss triggered: ${profitPct.toFixed(2)}% <= -${this.config.stopLossPct}%`
      };
    }

    // Check take profit
    if (profitPct >= this.config.sellTakeProfitPct) {
      return {
        should: true,
        reason: `Take profit triggered: ${profitPct.toFixed(2)}% >= +${this.config.sellTakeProfitPct}%`
      };
    }

    return { should: false, reason: `P&L ${profitPct.toFixed(2)}% within hold range` };
  }

  private async executeBuy(currentPrice: number, reason: string): Promise<boolean> {
    const amountGusdc = this.config.orderSizeGusdc;
    const expectedGala = amountGusdc / currentPrice;

    this.log(`🔄 Executing BUY: $${amountGusdc} GUSDC → ~${expectedGala.toFixed(2)} GALA`);
    this.log(`   Reason: ${reason}`);
    this.log(`   Price: ${currentPrice.toFixed(6)} GUSDC/GALA`);

    if (this.config.dryRun) {
      const trade: TradeEntry = {
        timestamp: Date.now(),
        action: 'BUY',
        amountGusdc,
        amountGala: expectedGala,
        price: currentPrice,
        pool: this.config.primaryPair,
        feeTier: this.config.preferredFeeTiers[0],
        reason
      };

      this.tradeHistory.push(trade);
      this.lastTradeTime = Date.now();
      this.saveState();

      this.log(`✅ BUY completed (DRY RUN): ${expectedGala.toFixed(2)} GALA`);
      return true;
    }

    try {
      const result = await this.swapAuth.buyGALAWithGUSDC(
        amountGusdc.toString(),
        this.config.slippageBps
      );

      if (result.success) {
        const actualGala = result.actualAmountOut ? Number(result.actualAmountOut) : expectedGala;

        const trade: TradeEntry = {
          timestamp: Date.now(),
          action: 'BUY',
          amountGusdc,
          amountGala: actualGala,
          price: currentPrice,
          pool: this.config.primaryPair,
          feeTier: this.config.preferredFeeTiers[0],
          reason,
          txId: result.transactionId
        };

        this.tradeHistory.push(trade);
        this.lastTradeTime = Date.now();
        this.saveState();

        this.log(`✅ BUY completed: ${actualGala.toFixed(2)} GALA | TX: ${result.transactionId}`);
        return true;
      } else {
        this.log(`❌ BUY failed: ${result.error || 'Unknown error'}`);
        return false;
      }
    } catch (error: any) {
      this.log(`❌ BUY error: ${error.message}`);
      return false;
    }
  }

  private async executeSell(currentPrice: number, reason: string): Promise<boolean> {
    const currentPosition = this.getCurrentPosition();
    const expectedGusdc = currentPosition * currentPrice;

    this.log(`🔄 Executing SELL: ${currentPosition.toFixed(2)} GALA → ~$${expectedGusdc.toFixed(2)} GUSDC`);
    this.log(`   Reason: ${reason}`);
    this.log(`   Price: ${currentPrice.toFixed(6)} GUSDC/GALA`);

    if (this.config.dryRun) {
      const trade: TradeEntry = {
        timestamp: Date.now(),
        action: 'SELL',
        amountGusdc: expectedGusdc,
        amountGala: currentPosition,
        price: currentPrice,
        pool: this.config.primaryPair,
        feeTier: this.config.preferredFeeTiers[0],
        reason
      };

      this.tradeHistory.push(trade);
      this.lastTradeTime = Date.now();
      this.saveState();

      this.log(`✅ SELL completed (DRY RUN): $${expectedGusdc.toFixed(2)} GUSDC`);
      return true;
    }

    try {
      const result = await this.swapAuth.sellGALAForGUSDC(
        currentPosition.toString(),
        this.config.slippageBps
      );

      if (result.success) {
        const actualGusdc = result.actualAmountOut ? Number(result.actualAmountOut) : expectedGusdc;

        const trade: TradeEntry = {
          timestamp: Date.now(),
          action: 'SELL',
          amountGusdc: actualGusdc,
          amountGala: currentPosition,
          price: currentPrice,
          pool: this.config.primaryPair,
          feeTier: this.config.preferredFeeTiers[0],
          reason,
          txId: result.transactionId
        };

        this.tradeHistory.push(trade);
        this.lastTradeTime = Date.now();
        this.saveState();

        this.log(`✅ SELL completed: $${actualGusdc.toFixed(2)} GUSDC | TX: ${result.transactionId}`);
        return true;
      } else {
        this.log(`❌ SELL failed: ${result.error || 'Unknown error'}`);
        return false;
      }
    } catch (error: any) {
      this.log(`❌ SELL error: ${error.message}`);
      return false;
    }
  }

  async executeTradingCycle(): Promise<void> {
    try {
      // Get current optimal price
      const priceSample = await this.getOptimalPrice();
      this.priceHistory.push(priceSample);

      // Clean old data
      this.pruneOldData();

      // Save updated state
      this.saveState();

            const currentPrice = priceSample.price;
      const currentPosition = this.getCurrentPosition();

      this.log(`📊 Price Update: ${currentPrice.toFixed(6)} GUSDC/GALA`);
      this.log(`   Source: ${priceSample.pool} (${priceSample.feeTier}bps)`);
      this.log(`   Position: ${currentPosition.toFixed(2)} GALA`);

      // Check trading conditions (buyCheck needs price change calculation)
      const buyCheck = await this.shouldBuy(currentPrice);
      const sellCheck = this.shouldSell(currentPrice);

      if (sellCheck.should) {
        await this.executeSell(currentPrice, sellCheck.reason);
      } else if (buyCheck.should) {
        await this.executeBuy(currentPrice, buyCheck.reason);
      } else {
        this.log(`⏸️ No action: ${buyCheck.reason || sellCheck.reason}`);
      }

    } catch (error: any) {
      this.log(`❌ Trading cycle error: ${error.message}`);
    }
  }

  async startTrading(): Promise<void> {
    this.log(`🚀 Starting Enhanced Trend Strategy trading...`);

    while (true) {
      await this.executeTradingCycle();

      // Wait for next cycle
      await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
    }
  }

  generateReport(): object {
    const currentPosition = this.getCurrentPosition();
    const avgEntryPrice = this.getAverageEntryPrice();
    const currentPrice = this.priceHistory[this.priceHistory.length - 1]?.price || 0;

    let totalPnL = 0;
    let totalTrades = this.tradeHistory.length;
    let winningTrades = 0;

    // Calculate P&L and stats
    let runningGala = 0;
    let runningGusdc = 0;

    for (const trade of this.tradeHistory) {
      if (trade.action === 'BUY') {
        runningGala += trade.amountGala;
        runningGusdc -= trade.amountGusdc;
      } else {
        runningGala -= trade.amountGala;
        runningGusdc += trade.amountGusdc;
        if (trade.amountGusdc > trade.amountGala * trade.price) {
          winningTrades++;
        }
      }
    }

    // Add current position value
    const currentPositionValue = currentPosition * currentPrice;
    totalPnL = runningGusdc + currentPositionValue;

    return {
      strategy: 'enhanced-trend',
      timestamp: new Date().toISOString(),
      current: {
        price: currentPrice,
        position: currentPosition,
        avgEntryPrice,
        positionValueGusdc: currentPositionValue,
        unrealizedPnL: avgEntryPrice ? (currentPrice - avgEntryPrice) * currentPosition : 0
      },
      performance: {
        totalPnL,
        totalTrades,
        winningTrades,
        winRate: totalTrades > 0 ? (winningTrades / (totalTrades / 2)) * 100 : 0,
        priceHistory: this.priceHistory.length,
        dataPoints24h: this.priceHistory.filter(p => p.timestamp > Date.now() - 24*60*60*1000).length
      },
      config: this.config
    };
  }
}

// Run strategy if called directly as main script
async function main() {
  if (process.argv[1]?.includes('enhanced-trend-strategy.ts') ||
      process.argv[1]?.includes('enhanced-trend-strategy.js')) {
    const strategy = new EnhancedTrendStrategy();
    await strategy.startTrading();
  }
}

main().catch(console.error);

// Export for use in other modules
export { TrendConfig, PriceSample, TradeEntry };
