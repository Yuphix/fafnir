import { TradingStrategy, TradeResult, MarketCondition } from '../types.js';
import { GalaChainSwapAuth } from '../galachain-swap-auth.js';
import { configManager } from '../config-manager.js';
import fs from 'fs-extra';
import path from 'path';

/**
 * Fafnir Treasure Hoarder Strategy
 *
 * RSI + Bollinger Bands Layered Strategy for GalaSwap
 * - Primary Signal: RSI momentum (35/65 thresholds for DEX volatility)
 * - Confirmation Signal: Bollinger Bands volatility analysis
 * - Multi-confirmation approach with confidence scoring
 * - Squeeze detection and breakout preparation
 */

interface TechnicalIndicators {
  rsi: number;
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    stdDev: number;
    bandwidth: number;
    percentB: number;
  };
  atr?: number;
}

interface TradingSignal {
  action: 'BUY' | 'SELL' | 'HOLD' | 'WAIT';
  confidence: number;
  reasons: string[];
  positionSize: number;
  indicators: TechnicalIndicators;
  stopLoss?: number;
  takeProfit?: number;
}

interface PriceData {
  timestamp: number;
  price: number;
  volume?: number;
}

interface StrategyConfig {
  // RSI Configuration
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;

  // Bollinger Bands Configuration
  bbPeriod: number;
  bbStdDev: number;
  bbSqueezeThreshold: number;

  // Risk Management
  minConfidence: number;
  maxRiskPerTrade: number;
  tradeCooldown: number;

  // Position Sizing
  positionSizing: {
    strongSignal: number;
    weakSignal: number;
    testPosition: number;
  };

  // Slippage and limits
  slippageBps: number;
  minTradeAmount: number;
  maxTradeAmount: number;

  // Testing parameters
  testTradeOnStart: boolean;
  testTradeAmount: number;
}

export class FafnirTreasureHoarder implements TradingStrategy {
  name = 'fafnir-treasure-hoarder';
  minVolumeRequired = 1000;
  maxRisk = 0.02; // 2% max risk per trade

  private config: StrategyConfig;
  private swapAuth: GalaChainSwapAuth;
  private priceHistory: Map<string, PriceData[]> = new Map();
  private lastTrades: Map<string, number> = new Map();
  private performanceLog: string;
  private hasExecutedTestTrade: boolean = false;

  constructor(swapAuth?: GalaChainSwapAuth) {
    this.swapAuth = swapAuth || new GalaChainSwapAuth();

    // Default configuration optimized for DEX trading
    this.config = {
      // RSI Configuration (adjusted for DEX volatility)
      rsiPeriod: 14,
      rsiOversold: 35,  // Higher than traditional 30 for DEX
      rsiOverbought: 65, // Lower than traditional 70 for DEX

      // Bollinger Bands Configuration
      bbPeriod: 20,
      bbStdDev: 2,
      bbSqueezeThreshold: 0.02, // 2% bandwidth = squeeze

      // Risk Management
      minConfidence: 0.6, // Minimum 60% confidence to trade
      maxRiskPerTrade: 0.02, // 2% max risk per trade
      tradeCooldown: 300000, // 5 minutes between trades per pair

      // Position Sizing
      positionSizing: {
        strongSignal: 1.0,   // Full position
        weakSignal: 0.5,     // Half position
        testPosition: 0.25   // Quarter position for testing
      },

      // Execution parameters
      slippageBps: 100, // 1% slippage tolerance
      minTradeAmount: 10,   // Minimum $10 trades
      maxTradeAmount: 1000, // Maximum $1000 trades

      // Testing parameters
      testTradeOnStart: String(process.env.FAFNIR_TEST_TRADE || 'false').toLowerCase() === 'true',
      testTradeAmount: parseFloat(process.env.FAFNIR_TEST_AMOUNT || '1.0') // Default $1 test trade
    };

    this.performanceLog = path.join(process.cwd(), 'logs', 'fafnir-treasure-hoarder.log');
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    const logDir = path.dirname(this.performanceLog);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Main execution method - implements the trading strategy
   */
  async execute(): Promise<TradeResult> {
    try {
      this.log('🏴‍☠️ Fafnir scanning for treasure opportunities...');

      // Execute test trade on first run if enabled
      if (this.config.testTradeOnStart && !this.hasExecutedTestTrade) {
        this.log('🧪 Executing test trade on startup...');
        const testResult = await this.executeTestTrade();
        this.hasExecutedTestTrade = true;

        if (testResult.success) {
          this.log(`✅ Test trade successful! Got ${testResult.profit.toFixed(4)} GALA for $${this.config.testTradeAmount}`);
        } else {
          this.log(`❌ Test trade failed: ${testResult.error}`);
        }

        return testResult;
      }

      // Get current market data
      const marketData = await this.getMarketData();
      if (!marketData) {
        return this.createResult(false, 0, 0, 'No market data available');
      }

      // Update price history
      await this.updatePriceHistory('GALA/GUSDC', marketData.price);

      // Check if we're in cooldown
      if (this.isInCooldown('GALA/GUSDC')) {
        this.log('⏰ Trade cooldown active, waiting...');
        return this.createResult(false, 0, 0, 'Trade cooldown active');
      }

      // Generate trading signal
      const signal = await this.generateTradingSignal('GALA/GUSDC');

      this.log(`📊 Signal Analysis: ${signal.action} | Confidence: ${(signal.confidence * 100).toFixed(1)}% | Reasons: ${signal.reasons.join(', ')}`);
      this.log(`📈 Indicators - RSI: ${signal.indicators.rsi} | %B: ${signal.indicators.bollingerBands.percentB.toFixed(2)} | Bandwidth: ${(signal.indicators.bollingerBands.bandwidth * 100).toFixed(2)}%`);

      // Log market context for enhanced decision making
      if (marketData.marketContext) {
        this.log(`🌍 Market Context - BTC: ${marketData.marketContext.btc.change24h.toFixed(1)}% | ETH: ${marketData.marketContext.eth.change24h.toFixed(1)}%`);
      }

      // Execute trade if signal is strong enough
      if (signal.confidence >= this.config.minConfidence && signal.action !== 'HOLD' && signal.action !== 'WAIT') {
        const tradeResult = await this.executeTrade(signal, marketData);

        if (tradeResult.success) {
          this.setTradeCooldown('GALA/GUSDC');
          this.log(`✅ Trade executed successfully! Profit: ${tradeResult.profit.toFixed(4)} GALA`);
        } else {
          this.log(`❌ Trade failed: ${tradeResult.error}`);
        }

        return tradeResult;
      }

      return this.createResult(false, 0, 0, `Signal not strong enough: ${signal.action} at ${(signal.confidence * 100).toFixed(1)}% confidence`);

    } catch (error: any) {
      this.log(`💥 Strategy execution error: ${error.message}`);
      return this.createResult(false, 0, 0, error.message);
    }
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  private calculateRSI(prices: number[]): number | null {
    if (prices.length < this.config.rsiPeriod + 1) return null;

    const gains: number[] = [];
    const losses: number[] = [];

    // Calculate price changes
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    // Calculate averages for RSI period
    const recentGains = gains.slice(-this.config.rsiPeriod);
    const recentLosses = losses.slice(-this.config.rsiPeriod);

    const avgGain = recentGains.reduce((a, b) => a + b, 0) / this.config.rsiPeriod;
    const avgLoss = recentLosses.reduce((a, b) => a + b, 0) / this.config.rsiPeriod;

    // Calculate RSI
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Calculate Bollinger Bands
   */
  private calculateBollingerBands(prices: number[], currentPrice: number) {
    if (prices.length < this.config.bbPeriod) return null;

    // Calculate SMA (middle band)
    const recentPrices = prices.slice(-this.config.bbPeriod);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / this.config.bbPeriod;

    // Calculate standard deviation
    const squaredDiffs = recentPrices.map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / this.config.bbPeriod;
    const stdDev = Math.sqrt(variance);

    // Calculate bands
    const upper = sma + (stdDev * this.config.bbStdDev);
    const lower = sma - (stdDev * this.config.bbStdDev);
    const bandwidth = (2 * stdDev * this.config.bbStdDev) / sma; // Normalized bandwidth
    const percentB = (currentPrice - lower) / (upper - lower); // %B position

    return {
      upper,
      middle: sma,
      lower,
      stdDev,
      bandwidth,
      percentB
    };
  }

  /**
   * Generate comprehensive trading signal
   */
  private async generateTradingSignal(pair: string): Promise<TradingSignal> {
    const priceHistory = this.priceHistory.get(pair);

    if (!priceHistory || priceHistory.length < Math.max(this.config.rsiPeriod, this.config.bbPeriod) + 2) {
      return {
        action: 'WAIT',
        confidence: 0,
        reasons: ['Insufficient price history'],
        positionSize: 0,
        indicators: {
          rsi: 0,
          bollingerBands: {
            upper: 0, middle: 0, lower: 0, stdDev: 0, bandwidth: 0, percentB: 0
          }
        }
      };
    }

    const prices = priceHistory.map(p => p.price);
    const currentPrice = prices[prices.length - 1];

    // Calculate technical indicators
    const rsi = this.calculateRSI(prices);
    const bands = this.calculateBollingerBands(prices, currentPrice);

    if (!rsi || !bands) {
      return {
        action: 'WAIT',
        confidence: 0,
        reasons: ['Failed to calculate indicators'],
        positionSize: 0,
        indicators: {
          rsi: rsi || 0,
          bollingerBands: bands || {
            upper: 0, middle: 0, lower: 0, stdDev: 0, bandwidth: 0, percentB: 0
          }
        }
      };
    }

    // Evaluate signals using the decision matrix
    return this.evaluateSignals(rsi, bands, currentPrice);
  }

  /**
   * Core signal evaluation logic - implements the decision matrix
   */
  private evaluateSignals(rsi: number, bands: any, currentPrice: number): TradingSignal {
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence = 0;
    let reasons: string[] = [];

    // Check for Bollinger Band squeeze first (overrides other signals)
    if (bands.bandwidth < this.config.bbSqueezeThreshold) {
      return {
        action: 'HOLD',
        confidence: 0.5,
        reasons: ['Bollinger Squeeze detected - awaiting breakout'],
        positionSize: 0,
        indicators: { rsi, bollingerBands: bands }
      };
    }

    // STRONG BUY CONDITIONS (90% confidence)
    if (rsi < this.config.rsiOversold && currentPrice <= bands.lower) {
      action = 'BUY';
      confidence = 0.9;
      reasons.push('RSI oversold + Price at lower Bollinger Band');
    }
    // MODERATE BUY CONDITIONS (60-65% confidence)
    else if (rsi < this.config.rsiOversold) {
      action = 'BUY';
      confidence = 0.6;
      reasons.push('RSI oversold');
    }
    else if (currentPrice <= bands.lower && rsi < 45) {
      action = 'BUY';
      confidence = 0.65;
      reasons.push('Price at lower band with RSI support');
    }
    // STRONG SELL CONDITIONS (90% confidence)
    else if (rsi > this.config.rsiOverbought && currentPrice >= bands.upper) {
      action = 'SELL';
      confidence = 0.9;
      reasons.push('RSI overbought + Price at upper Bollinger Band');
    }
    // MODERATE SELL CONDITIONS (60-65% confidence)
    else if (rsi > this.config.rsiOverbought) {
      action = 'SELL';
      confidence = 0.6;
      reasons.push('RSI overbought');
    }
    else if (currentPrice >= bands.upper && rsi > 55) {
      action = 'SELL';
      confidence = 0.65;
      reasons.push('Price at upper band with RSI resistance');
    }

    const positionSize = this.calculatePositionSize(confidence);

    return {
      action,
      confidence,
      reasons,
      positionSize,
      indicators: { rsi, bollingerBands: bands }
    };
  }

  /**
   * Calculate position size based on confidence level
   */
  private calculatePositionSize(confidence: number): number {
    if (confidence >= 0.9) return this.config.positionSizing.strongSignal;
    if (confidence >= 0.7) return this.config.positionSizing.weakSignal;
    if (confidence >= 0.6) return this.config.positionSizing.testPosition;
    return 0; // Don't trade below 60% confidence
  }

  /**
   * Execute the actual trade
   */
  private async executeTrade(signal: TradingSignal, marketData: any): Promise<TradeResult> {
    try {
      // Get current balances
      const balances = await this.swapAuth.getBalances();
      const galadBalance = parseFloat(balances.GALA || '0');
      const gusdcBalance = parseFloat(balances.GUSDC || '0');

      let result: any;
      let profit = 0;
      let volume = 0;

      if (signal.action === 'BUY' && gusdcBalance > this.config.minTradeAmount) {
        // Calculate trade amount based on position size and available balance
        const maxTradeAmount = Math.min(
          gusdcBalance * signal.positionSize,
          this.config.maxTradeAmount
        );

        if (maxTradeAmount >= this.config.minTradeAmount) {
          this.log(`🛒 Executing BUY: ${maxTradeAmount.toFixed(2)} GUSDC -> GALA (CoinGecko analysis, GalaSwap execution)`);

          result = await this.swapAuth.buyGALAWithGUSDC(
            maxTradeAmount.toString(),
            this.config.slippageBps
          );

          if (result && result.success) {
            profit = parseFloat(result.actualAmountOut || '0');
            volume = maxTradeAmount;
            this.log(`✅ BUY executed: Got ${profit.toFixed(4)} GALA for ${volume.toFixed(2)} GUSDC`);
          }
        }
      } else if (signal.action === 'SELL' && galadBalance > 0) {
        // Calculate trade amount based on position size and available balance
        const maxTradeAmount = galadBalance * signal.positionSize;

        if (maxTradeAmount > 0) {
          this.log(`💰 Executing SELL: ${maxTradeAmount.toFixed(4)} GALA -> GUSDC (CoinGecko analysis, GalaSwap execution)`);

          result = await this.swapAuth.sellGALAForGUSDC(
            maxTradeAmount.toString(),
            this.config.slippageBps
          );

          if (result && result.success) {
            profit = parseFloat(result.actualAmountOut || '0');
            volume = maxTradeAmount;
            this.log(`✅ SELL executed: Got ${profit.toFixed(2)} GUSDC for ${volume.toFixed(4)} GALA`);
          }
        }
      }

      const success = result && result.success;
      return this.createResult(
        success,
        success ? profit : 0,
        success ? volume : 0,
        success ? 'Trade executed successfully' : (result?.error || 'Trade execution failed')
      );

    } catch (error: any) {
      this.log(`💥 Trade execution error: ${error.message}`);
      return this.createResult(false, 0, 0, error.message);
    }
  }

  /**
   * Execute a test trade to verify the strategy works
   */
  private async executeTestTrade(): Promise<TradeResult> {
    try {
      this.log(`🧪 Executing $${this.config.testTradeAmount} test BUY to verify strategy functionality...`);

      // Skip balance check - just execute the trade
      this.log(`💰 Attempting trade with available wallet balance...`);

      // Execute test buy
      const result = await this.swapAuth.buyGALAWithGUSDC(
        this.config.testTradeAmount.toString(),
        this.config.slippageBps
      );

      if (result && result.success) {
        const galaReceived = parseFloat(result.actualAmountOut || '0');
        this.log(`✅ TEST BUY SUCCESS: Spent $${this.config.testTradeAmount} GUSDC → Received ${galaReceived.toFixed(4)} GALA`);

        // Set cooldown to prevent immediate trading
        this.setTradeCooldown('GALA/GUSDC');

        return this.createResult(true, galaReceived, this.config.testTradeAmount, 'Test trade executed successfully');
      } else {
        return this.createResult(false, 0, 0, result?.error || 'Test trade execution failed');
      }

    } catch (error: any) {
      this.log(`💥 Test trade error: ${error.message}`);
      return this.createResult(false, 0, 0, error.message);
    }
  }

  /**
   * Check if pair is in trading cooldown
   */
  private isInCooldown(pair: string): boolean {
    const lastTrade = this.lastTrades.get(pair);
    if (!lastTrade) return false;

    return Date.now() - lastTrade < this.config.tradeCooldown;
  }

  /**
   * Set trading cooldown for pair
   */
  private setTradeCooldown(pair: string): void {
    this.lastTrades.set(pair, Date.now());
  }

  /**
   * Update price history for technical analysis
   */
  private async updatePriceHistory(pair: string, currentPrice: number): Promise<void> {
    if (!this.priceHistory.has(pair)) {
      this.priceHistory.set(pair, []);
    }

    const history = this.priceHistory.get(pair)!;
    const now = Date.now();

    // Add new price point
    history.push({
      timestamp: now,
      price: currentPrice
    });

    // Keep only the last 50 data points (more than enough for BB20 + RSI14)
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }

    // Initialize with CoinGecko historical data if we don't have enough history
    if (history.length < 25) {
      await this.initializePriceHistoryFromCoinGecko(pair, currentPrice);
    }
  }

  /**
   * Initialize price history from CoinGecko historical data
   */
  private async initializePriceHistoryFromCoinGecko(pair: string, currentPrice: number): Promise<void> {
    try {
      this.log('📈 Fetching historical GALA price data from CoinGecko...');

      // Get 7 days of hourly data (168 data points, we'll use last 50)
      const response = await fetch(
        'https://api.coingecko.com/api/v3/coins/gala/market_chart?vs_currency=usd&days=7&interval=hourly'
      );

      if (!response.ok) {
        throw new Error(`CoinGecko historical API error: ${response.status}`);
      }

      const data = await response.json();
      const prices = data.prices; // Array of [timestamp, price]

      if (!prices || prices.length === 0) {
        throw new Error('No historical price data from CoinGecko');
      }

      const history = this.priceHistory.get(pair)!;

      // Take the last 50 data points and convert to our format
      const recentPrices = prices.slice(-50);

      for (const [timestamp, price] of recentPrices) {
        history.push({
          timestamp: timestamp,
          price: price
        });
      }

      // Add current price as the latest point
      history.push({
        timestamp: Date.now(),
        price: currentPrice
      });

      this.log(`✅ Initialized with ${history.length} historical price points from CoinGecko`);
      this.log(`📊 Price range: $${Math.min(...history.map(h => h.price)).toFixed(6)} - $${Math.max(...history.map(h => h.price)).toFixed(6)}`);

    } catch (error: any) {
      this.log(`⚠️ Failed to get CoinGecko historical data: ${error.message}`);
      this.log('📊 Falling back to simulated price history...');

      // Fallback to simulated data
      await this.simulateInitialPriceHistory(pair, currentPrice);
    }
  }

  /**
   * Simulate initial price history for testing (fallback only)
   */
  private async simulateInitialPriceHistory(pair: string, currentPrice: number): Promise<void> {
    const history = this.priceHistory.get(pair)!;
    const baseTime = Date.now() - (30 * 60 * 1000); // 30 minutes ago

    // Generate realistic price movements
    let price = currentPrice * 0.98; // Start slightly lower

    for (let i = 0; i < 25; i++) {
      const volatility = 0.002; // 0.2% volatility
      const change = (Math.random() - 0.5) * volatility;
      price = price * (1 + change);

      history.unshift({
        timestamp: baseTime + (i * 60 * 1000), // 1-minute intervals
        price: price
      });
    }

    this.log(`📊 Simulated ${history.length} price points for initial analysis`);
  }

  /**
   * Get current market data from CoinGecko (primary source)
   */
  private async getMarketData() {
    try {
      // Get comprehensive market data from CoinGecko (most accurate GALA price)
      const coinGeckoData = await this.getCoinGeckoData();

      if (coinGeckoData) {
        this.log(`📊 CoinGecko GALA: $${coinGeckoData.price.toFixed(6)} | 24h: ${coinGeckoData.priceChange24h.toFixed(2)}% | Vol: $${(coinGeckoData.volume24h / 1000000).toFixed(1)}M`);

        return {
          price: coinGeckoData.price,
          volume24h: coinGeckoData.volume24h,
          priceChange24h: coinGeckoData.priceChange24h,
          marketCap: coinGeckoData.marketCap,
          marketContext: coinGeckoData.marketContext,
          timestamp: Date.now()
        };
      }

      this.log(`❌ Failed to get CoinGecko data - strategy cannot proceed without accurate price data`);
      return null;

    } catch (error: any) {
      this.log(`📊 Market data error: ${error.message}`);
      return null;
    }
  }

  /**
   * Get comprehensive market data for multiple tokens from CoinGecko
   */
  private async getCoinGeckoData() {
    try {
      // Get data for all major tokens we might trade
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=gala,ethereum,bitcoin,usd-coin,tether&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_market_cap=true'
      );

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();

      // Return GALA data (primary focus) with market context
      const galaData = data.gala;
      const ethData = data.ethereum;
      const btcData = data.bitcoin;

      if (!galaData) {
        throw new Error('No GALA data from CoinGecko');
      }

      return {
        // Primary GALA data
        price: galaData.usd,
        volume24h: galaData.usd_24h_vol || 0,
        priceChange24h: galaData.usd_24h_change || 0,
        marketCap: galaData.usd_market_cap || 0,

        // Market context for enhanced analysis
        marketContext: {
          eth: {
            price: ethData?.usd || 0,
            change24h: ethData?.usd_24h_change || 0
          },
          btc: {
            price: btcData?.usd || 0,
            change24h: btcData?.usd_24h_change || 0
          }
        }
      };
    } catch (error: any) {
      this.log(`🌐 CoinGecko error: ${error.message}`);
      return null;
    }
  }

  /**
   * Enhanced market condition analysis using CoinGecko data
   */
  private analyzeMarketConditions(coinGeckoData: any): MarketCondition {
    const volatility = Math.abs(coinGeckoData.priceChange24h) / 100; // Convert % to decimal
    const volume = coinGeckoData.volume24h / 1000000; // Convert to millions for easier handling

    // Determine competition level based on market conditions
    let competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';

    if (volatility > 0.1 || volume > 50) { // High volatility or volume
      competitionLevel = 'HIGH';
    } else if (volatility < 0.02 && volume < 10) { // Low volatility and volume
      competitionLevel = 'LOW';
    }

    return {
      volatility: volatility,
      volume: volume,
      competitionLevel: competitionLevel,
      timeOfDay: new Date().getHours(),
      recentPerformance: coinGeckoData.priceChange24h / 100 // Convert % to decimal
    };
  }

  /**
   * Determine if strategy should activate based on market conditions
   */
  shouldActivate(marketCondition: MarketCondition): boolean {
    // Activate in medium to high volatility conditions
    // RSI + BB works best when there's enough price movement
    return marketCondition.volatility > 0.01 && // At least 1% volatility
           marketCondition.volume > this.minVolumeRequired &&
           marketCondition.competitionLevel !== 'HIGH'; // Avoid high competition periods
  }

  /**
   * Create standardized trade result
   */
  private createResult(success: boolean, profit: number, volume: number, error?: string): TradeResult {
    return {
      success,
      profit,
      volume,
      strategy: this.name,
      pool: 'GALA/GUSDC',
      timestamp: Date.now(),
      error
    };
  }

  /**
   * Logging utility
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;

    console.log(logMessage);

    // Append to log file
    try {
      fs.appendFileSync(this.performanceLog, logMessage + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }
}
