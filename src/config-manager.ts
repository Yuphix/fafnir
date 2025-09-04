import fs from 'fs-extra';
import path from 'node:path';

/**
 * Dynamic Configuration Manager for Fafnir Bot
 *
 * Allows real-time adjustment of trading parameters via API
 * without restarting containers or strategies
 */

export interface TradingConfig {
  // Common Trading Parameters
  minSwapAmount: number;        // Minimum swap amount in USD
  maxSwapAmount: number;        // Maximum swap amount in USD
  profitThreshold: number;      // Minimum profit threshold in basis points (bps)
  slippageTolerance: number;    // Maximum slippage tolerance in bps
  maxDailyLoss: number;         // Maximum daily loss in USD
  maxPositionSize: number;      // Maximum position size in USD
  dryRun: boolean;              // Dry run mode
  useAdvisor: boolean;          // Enable AI advisor

  // Strategy-Specific Parameters
  fibonacci?: FibonacciConfig;
  arbitrage?: ArbitrageConfig;
  liquiditySpider?: LiquiditySpiderConfig;
  enhancedTrend?: EnhancedTrendConfig;
}

export interface FibonacciConfig {
  baseTradeSize: number;        // Base trade size in USD
  maxPositionSize: number;      // Maximum position size in USD
  takeProfitPercent: number;    // Take profit percentage
  stopLossPercent: number;      // Stop loss percentage
  buyLevels: number[];          // Fibonacci retracement levels for buying
  galaPools: string[];          // GALA trading pools
  pollIntervalMs: number;       // Polling interval in milliseconds
}

export interface ArbitrageConfig {
  minProfitBps: number;         // Minimum profit in basis points
  maxConcurrentTrades: number;  // Maximum concurrent arbitrage trades
  advisorIntervalMs: number;    // AI advisor consultation interval
  arbitragePools: string[];     // Pools to monitor for arbitrage
  baseAmount: number;           // Base amount for arbitrage trades
}

export interface LiquiditySpiderConfig {
  maxPositions: number;         // Maximum open positions
  basePositionSize: number;     // Base position size in USD
  profitTarget: number;         // Profit target in basis points
  stopLoss: number;             // Stop loss in basis points
  scanInterval: number;         // Pool scanning interval
  advisorInterval: number;      // AI advisor interval
  useCrossDexOpportunities: boolean; // Enable cross-DEX monitoring
  poolTargets: string[];        // Target pools for liquidity hunting
}

export interface EnhancedTrendConfig {
  orderSizeGusdc: number;       // Order size in GUSDC
  priceSource: 'galaswap' | 'coingecko' | 'hybrid'; // Price data source
  coinGeckoId: string;          // CoinGecko ID for price reference
  backfillHistory: boolean;     // Backfill historical data
  trendPairs: string[];         // Trading pairs for trend following
}

export class ConfigManager {
  private configPath: string;
  private config: TradingConfig;
  private defaultConfig: TradingConfig;

  constructor() {
    this.configPath = path.join(process.cwd(), 'trading-config.json');
    this.defaultConfig = this.getDefaultConfig();
    this.config = this.loadConfig();
  }

  private getDefaultConfig(): TradingConfig {
    return {
      // Common parameters with sensible defaults
      minSwapAmount: 5,           // $5 minimum
      maxSwapAmount: 100,         // $100 maximum
      profitThreshold: 25,        // 0.25% minimum profit
      slippageTolerance: 100,     // 1% slippage tolerance
      maxDailyLoss: 50,          // $50 max daily loss
      maxPositionSize: 100,       // $100 max position
      dryRun: true,              // Start in dry run mode
      useAdvisor: false,         // Advisor disabled by default

      // Strategy-specific defaults
      fibonacci: {
        baseTradeSize: 5,
        maxPositionSize: 100,
        takeProfitPercent: 8,
        stopLossPercent: 15,
        buyLevels: [0.618, 0.50, 0.382],
        galaPools: ['GALA/GUSDC', 'GALA/GUSDT', 'GALA/GWETH', 'GALA/GWBTC'],
        pollIntervalMs: 600000  // 10 minutes
      },

      arbitrage: {
        minProfitBps: 50,        // 0.5% minimum profit
        maxConcurrentTrades: 2,
        advisorIntervalMs: 300000, // 5 minutes
        arbitragePools: ['GALA/GUSDC', 'GALA/GUSDT', 'GUSDC/GUSDT', 'GALA/GWETH', 'GUSDC/GWETH'],
        baseAmount: 10           // $10 base arbitrage amount
      },

      liquiditySpider: {
        maxPositions: 8,
        basePositionSize: 5,
        profitTarget: 200,       // 2% profit target
        stopLoss: 100,          // 1% stop loss
        scanInterval: 30000,     // 30 seconds
        advisorInterval: 120000, // 2 minutes
        useCrossDexOpportunities: true,
        poolTargets: ['GALA/GUSDC', 'GALA/GUSDT', 'GALA/GWETH', 'GUSDC/GUSDT', 'GUSDC/GWETH']
      },

      enhancedTrend: {
        orderSizeGusdc: 10,
        priceSource: 'hybrid',
        coinGeckoId: 'gala',
        backfillHistory: true,
        trendPairs: ['GALA/GUSDC', 'GALA/GUSDT']
      }
    };
  }

  private loadConfig(): TradingConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readJsonSync(this.configPath);
        // Merge with defaults to ensure all fields are present
        return { ...this.defaultConfig, ...configData };
      }
    } catch (error) {
      console.warn('Failed to load trading config, using defaults:', error);
    }

    // Return defaults and save them
    this.saveConfig(this.defaultConfig);
    return this.defaultConfig;
  }

  private saveConfig(config: TradingConfig): void {
    try {
      fs.writeJsonSync(this.configPath, config, { spaces: 2 });
      console.log('💾 Trading configuration saved');
    } catch (error) {
      console.error('Failed to save trading config:', error);
    }
  }

  // Get current configuration
  getConfig(): TradingConfig {
    return { ...this.config };
  }

  // Get strategy-specific configuration
  getStrategyConfig(strategy: string): any {
    switch (strategy) {
      case 'fibonacci':
        return this.config.fibonacci;
      case 'arbitrage':
        return this.config.arbitrage;
      case 'liquidity-spider':
        return this.config.liquiditySpider;
      case 'enhanced-trend':
        return this.config.enhancedTrend;
      default:
        return null;
    }
  }

  // Update configuration (partial updates allowed)
  updateConfig(updates: Partial<TradingConfig>): TradingConfig {
    // Deep merge the updates with current config
    this.config = this.deepMerge(this.config, updates);
    this.saveConfig(this.config);

    console.log('🔧 Trading configuration updated:', Object.keys(updates));
    return this.config;
  }

  // Update strategy-specific configuration
  updateStrategyConfig(strategy: string, updates: any): TradingConfig {
    const strategyUpdate: Partial<TradingConfig> = {};
    (strategyUpdate as any)[strategy] = updates;

    return this.updateConfig(strategyUpdate);
  }

  // Reset to defaults
  resetToDefaults(): TradingConfig {
    this.config = { ...this.defaultConfig };
    this.saveConfig(this.config);
    console.log('🔄 Trading configuration reset to defaults');
    return this.config;
  }

  // Validate configuration values
  validateConfig(config: Partial<TradingConfig>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate common parameters
    if (config.minSwapAmount !== undefined) {
      if (config.minSwapAmount < 1 || config.minSwapAmount > 1000) {
        errors.push('minSwapAmount must be between $1 and $1000');
      }
    }

    if (config.maxSwapAmount !== undefined) {
      if (config.maxSwapAmount < 5 || config.maxSwapAmount > 10000) {
        errors.push('maxSwapAmount must be between $5 and $10000');
      }
    }

    if (config.profitThreshold !== undefined) {
      if (config.profitThreshold < 1 || config.profitThreshold > 1000) {
        errors.push('profitThreshold must be between 1bps and 1000bps');
      }
    }

    if (config.slippageTolerance !== undefined) {
      if (config.slippageTolerance < 10 || config.slippageTolerance > 500) {
        errors.push('slippageTolerance must be between 10bps and 500bps');
      }
    }

    if (config.maxDailyLoss !== undefined) {
      if (config.maxDailyLoss < 1 || config.maxDailyLoss > 1000) {
        errors.push('maxDailyLoss must be between $1 and $1000');
      }
    }

    // Validate min/max relationship
    if (config.minSwapAmount && config.maxSwapAmount) {
      if (config.minSwapAmount >= config.maxSwapAmount) {
        errors.push('minSwapAmount must be less than maxSwapAmount');
      }
    }

    // Validate strategy-specific configs
    if (config.fibonacci) {
      const fib = config.fibonacci;
      if (fib.takeProfitPercent && (fib.takeProfitPercent < 1 || fib.takeProfitPercent > 50)) {
        errors.push('fibonacci.takeProfitPercent must be between 1% and 50%');
      }
      if (fib.stopLossPercent && (fib.stopLossPercent < 5 || fib.stopLossPercent > 50)) {
        errors.push('fibonacci.stopLossPercent must be between 5% and 50%');
      }
    }

    if (config.arbitrage) {
      const arb = config.arbitrage;
      if (arb.maxConcurrentTrades && (arb.maxConcurrentTrades < 1 || arb.maxConcurrentTrades > 10)) {
        errors.push('arbitrage.maxConcurrentTrades must be between 1 and 10');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Apply configuration to environment variables (for container updates)
  applyToEnvironment(): Record<string, string> {
    const envVars: Record<string, string> = {};
    const config = this.config;

    // Common environment variables
    envVars.MIN_SWAP_AMOUNT = config.minSwapAmount.toString();
    envVars.MAX_SWAP_AMOUNT = config.maxSwapAmount.toString();
    envVars.PROFIT_THRESHOLD_BPS = config.profitThreshold.toString();
    envVars.SLIPPAGE_TOLERANCE_BPS = config.slippageTolerance.toString();
    envVars.MAX_DAILY_LOSS = config.maxDailyLoss.toString();
    envVars.MAX_POSITION_SIZE = config.maxPositionSize.toString();
    envVars.DRY_RUN = config.dryRun.toString();
    envVars.USE_ADVISOR = config.useAdvisor.toString();

    // Fibonacci strategy
    if (config.fibonacci) {
      envVars.FIB_BASE_TRADE_SIZE = config.fibonacci.baseTradeSize.toString();
      envVars.FIB_MAX_POSITION = config.fibonacci.maxPositionSize.toString();
      envVars.FIB_TAKE_PROFIT = config.fibonacci.takeProfitPercent.toString();
      envVars.FIB_STOP_LOSS = config.fibonacci.stopLossPercent.toString();
      envVars.FIB_POLL_INTERVAL_MS = config.fibonacci.pollIntervalMs.toString();
      envVars.FIB_MIN_PROFIT_BPS = config.profitThreshold.toString();
      envVars.FIB_SLIPPAGE_BPS = config.slippageTolerance.toString();
      envVars.FIB_DRY_RUN = config.dryRun.toString();
      envVars.FIB_USE_ADVISOR = config.useAdvisor.toString();
    }

    // Arbitrage strategy
    if (config.arbitrage) {
      envVars.ARB_MIN_PROFIT_BPS = config.arbitrage.minProfitBps.toString();
      envVars.ARB_MAX_CONCURRENT = config.arbitrage.maxConcurrentTrades.toString();
      envVars.ARB_ADVISOR_INTERVAL_MS = config.arbitrage.advisorIntervalMs.toString();
      envVars.ARB_SLIPPAGE_BPS = config.slippageTolerance.toString();
      envVars.ARB_DRY_RUN = config.dryRun.toString();
      envVars.ARB_USE_ADVISOR = config.useAdvisor.toString();
    }

    // Liquidity Spider strategy
    if (config.liquiditySpider) {
      envVars.SPIDER_MAX_POSITIONS = config.liquiditySpider.maxPositions.toString();
      envVars.SPIDER_POSITION_SIZE = config.liquiditySpider.basePositionSize.toString();
      envVars.SPIDER_PROFIT_TARGET = config.liquiditySpider.profitTarget.toString();
      envVars.SPIDER_STOP_LOSS = config.liquiditySpider.stopLoss.toString();
      envVars.SPIDER_SCAN_INTERVAL = config.liquiditySpider.scanInterval.toString();
      envVars.SPIDER_ADVISOR_INTERVAL = config.liquiditySpider.advisorInterval.toString();
      envVars.SPIDER_USE_CROSSDEX = config.liquiditySpider.useCrossDexOpportunities.toString();
      envVars.SPIDER_DRY_RUN = config.dryRun.toString();
      envVars.SPIDER_USE_ADVISOR = config.useAdvisor.toString();
    }

    // Enhanced Trend strategy
    if (config.enhancedTrend) {
      envVars.TREND_ORDER_SIZE = config.enhancedTrend.orderSizeGusdc.toString();
      envVars.TREND_PRICE_SOURCE = config.enhancedTrend.priceSource;
      envVars.TREND_COINGECKO_ID = config.enhancedTrend.coinGeckoId;
      envVars.TREND_BACKFILL_HISTORY = config.enhancedTrend.backfillHistory.toString();
      envVars.TREND_DRY_RUN = config.dryRun.toString();
      envVars.TREND_USE_ADVISOR = config.useAdvisor.toString();
    }

    return envVars;
  }

  // Deep merge utility function
  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  // Get configuration summary for display
  getConfigSummary(): any {
    return {
      common: {
        minSwapAmount: this.config.minSwapAmount,
        maxSwapAmount: this.config.maxSwapAmount,
        profitThreshold: `${this.config.profitThreshold}bps (${(this.config.profitThreshold/100).toFixed(2)}%)`,
        slippageTolerance: `${this.config.slippageTolerance}bps (${(this.config.slippageTolerance/100).toFixed(2)}%)`,
        maxDailyLoss: this.config.maxDailyLoss,
        maxPositionSize: this.config.maxPositionSize,
        dryRun: this.config.dryRun,
        useAdvisor: this.config.useAdvisor
      },
      strategies: {
        fibonacci: this.config.fibonacci,
        arbitrage: this.config.arbitrage,
        liquiditySpider: this.config.liquiditySpider,
        enhancedTrend: this.config.enhancedTrend
      },
      lastUpdated: new Date().toISOString(),
      configFile: this.configPath
    };
  }
}

// Singleton instance
export const configManager = new ConfigManager();
