import { MarketCondition, TradeResult, PerformanceMetrics, StrategyConfig, TradingStrategy } from './types.js';
import { TriangularArbitrage } from './strategies/triangular-arbitrage.js';
import { FibonacciStrategy } from './strategies/fibonacci-strategy.js';
import { ArbitrageStrategy } from './strategies/arbitrage-strategy.js';
import { LiquiditySpiderStrategy } from './strategies/liquidity-spider-strategy.js';
import { FafnirTreasureHoarder } from './strategies/fafnir-treasure-hoarder.js';

export class StrategyManager {
  private strategies: Map<string, TradingStrategy> = new Map();
  private currentStrategy: string = 'liquidity-spider';
  private lastStrategySwitch: number = Date.now();
  private strategyPerformance: Map<string, PerformanceMetrics> = new Map();
  private strategySwitchInterval: number = Number(process.env.STRATEGY_SWITCH_INTERVAL_MS || 300000); // default 5 min
  private forceStrategy: string | undefined = process.env.FORCE_STRATEGY?.toLowerCase();
  private rotationMode: 'score' | 'round_robin' = (process.env.STRATEGY_ROTATION_MODE === 'round_robin') ? 'round_robin' : 'score';
  private strategyOrder: string[] = ['arbitrage', 'triangular', 'fibonacci', 'liquidity-spider', 'fafnir-treasure-hoarder'];

    constructor() {
    this.initializeStrategies();

    // Apply forced strategy immediately on startup if specified
    if (this.forceStrategy && this.strategies.has(this.forceStrategy)) {
      this.currentStrategy = this.forceStrategy;
      console.log(`🔒 FORCE_STRATEGY applied at startup: ${this.currentStrategy}`);
    }
  }

  private initializeStrategies(): void {
    // Initialize all available strategies
    this.strategies.set('arbitrage', new ArbitrageStrategy());
    this.strategies.set('triangular', new TriangularArbitrage());
    this.strategies.set('fibonacci', new FibonacciStrategy());
    this.strategies.set('liquidity-spider', new LiquiditySpiderStrategy());
    this.strategies.set('fafnir-treasure-hoarder', new FafnirTreasureHoarder());

    // Initialize performance tracking for each strategy
    for (const [name] of this.strategies) {
      this.strategyPerformance.set(name, {
        totalTrades: 0,
        profitableTrades: 0,
        totalVolume: 0,
        totalProfit: 0,
        winRate: 0,
        lastUpdated: Date.now()
      });
    }
  }

  async selectStrategy(marketData: MarketCondition): Promise<string> {
    const now = Date.now();

    // Optional override via env to force a strategy (ignored in round_robin mode)
    if (this.rotationMode !== 'round_robin') {
      if (this.forceStrategy && this.strategies.has(this.forceStrategy)) {
        if (this.currentStrategy !== this.forceStrategy) {
          this.currentStrategy = this.forceStrategy;
          this.lastStrategySwitch = now;
          console.log(`🔒 FORCE_STRATEGY active: ${this.currentStrategy}`);
        }
        return this.currentStrategy;
      }
    }

    // Only switch strategies if enough time has passed
    if (now - this.lastStrategySwitch < this.strategySwitchInterval) {
      return this.currentStrategy;
    }

    // Round-robin rotation mode: endlessly rotate through strategies with cooldown
    if (this.rotationMode === 'round_robin') {
      const order = this.strategyOrder.filter((name) => this.strategies.has(name));
      if (order.length === 0) return this.currentStrategy;

      const currentIdx = Math.max(0, order.indexOf(this.currentStrategy));
      // Try next strategies in order, respecting shouldActivate; fall back to next even if not ideal
      let chosen = this.currentStrategy;
      for (let i = 1; i <= order.length; i++) {
        const cand = order[(currentIdx + i) % order.length];
        const strategy = this.strategies.get(cand)!;
        if (strategy.shouldActivate(marketData)) { chosen = cand; break; }
        // If none activate, last iteration will select next anyway
        if (i === order.length) chosen = order[(currentIdx + 1) % order.length];
      }

      if (chosen !== this.currentStrategy) {
        this.currentStrategy = chosen;
        this.lastStrategySwitch = now;
        console.log(`🔁 Round-robin switch → ${chosen}`);
      }
      return this.currentStrategy;
    }

    let bestStrategy = this.currentStrategy;
    let bestScore = -Infinity;

    for (const [name, strategy] of this.strategies) {
      if (!strategy.shouldActivate(marketData)) {
        continue;
      }

      const score = this.calculateStrategyScore(name, marketData);
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = name;
      }
    }

    if (bestStrategy !== this.currentStrategy) {
      this.lastStrategySwitch = now;
      this.currentStrategy = bestStrategy;
      console.log(`🔄 Strategy switched to: ${bestStrategy}`);
    }

    return this.currentStrategy;
  }

  private calculateStrategyScore(strategyName: string, marketData: MarketCondition): number {
    const performance = this.strategyPerformance.get(strategyName);
    if (!performance) return -Infinity;

    let score = 0;

    // Base score from recent performance
    score += performance.winRate * 100;
    score += performance.totalProfit * 10;

    // Market condition adjustments
    if (marketData.volatility > 0.05) {
      // High volatility - prefer arbitrage
      score += strategyName === 'arbitrage' ? 50 : 0;
    } else if (marketData.volatility < 0.01) {
      // Low volatility - prefer triangular
      score += strategyName === 'triangular' ? 30 : 0;
    }

    // Volume considerations
    if (marketData.volume < 100) {
      // Low volume - prefer smaller strategies
      score += strategyName === 'fibonacci' ? 20 : 0;
      score += strategyName === 'liquidity-spider' ? 30 : 0; // Spider excels in low volume
    }

    // Time of day adjustments
    const hour = marketData.timeOfDay;
    if (hour >= 9 && hour <= 17) {
      // Market hours - prefer aggressive strategies
      score += strategyName === 'triangular' ? 25 : 0;
    } else {
      // Off hours - prefer conservative strategies
      score += strategyName === 'arbitrage' ? 25 : 0;
    }

    // Competition level adjustments
    if (marketData.competitionLevel === 'HIGH') {
      // High competition - prefer unique strategies
      score += strategyName === 'fibonacci' ? 40 : 0;
    }

    return score;
  }

  async executeCurrentStrategy(): Promise<TradeResult> {
    console.log(`🚀 Executing strategy: ${this.currentStrategy}`);
    const strategy = this.strategies.get(this.currentStrategy);
    if (!strategy) {
      throw new Error(`Strategy not found: ${this.currentStrategy}`);
    }

    try {
      console.log(`📋 Calling strategy.execute() for ${this.currentStrategy}`);
      const result = await strategy.execute();
      console.log(`✅ Strategy execution result:`, result);
      this.updateStrategyPerformance(this.currentStrategy, result);
      return result;
    } catch (error: any) {
      const errorResult: TradeResult = {
        success: false,
        profit: 0,
        volume: 0,
        strategy: this.currentStrategy,
        pool: 'unknown',
        timestamp: Date.now(),
        error: error.message || 'Unknown error'
      };

      this.updateStrategyPerformance(this.currentStrategy, errorResult);
      return errorResult;
    }
  }

  private updateStrategyPerformance(strategyName: string, result: TradeResult): void {
    const performance = this.strategyPerformance.get(strategyName);
    if (!performance) return;

    performance.totalTrades++;
    performance.totalVolume += result.volume;

    if (result.success && result.profit > 0) {
      performance.profitableTrades++;
      performance.totalProfit += result.profit;
    }

    performance.winRate = (performance.profitableTrades / performance.totalTrades) * 100;
    performance.lastUpdated = Date.now();
  }

  getCurrentStrategy(): string {
    return this.currentStrategy;
  }

  getStrategyPerformance(strategyName: string): PerformanceMetrics | undefined {
    return this.strategyPerformance.get(strategyName);
  }

  getAllPerformanceMetrics(): Map<string, PerformanceMetrics> {
    return new Map(this.strategyPerformance);
  }

  getDelayForStrategy(): number {
    // Return delay based on current strategy
    switch (this.currentStrategy) {
      case 'arbitrage':
        return 60000; // 1 minute
      case 'triangular':
        return 90000; // 1.5 minutes
      case 'fibonacci':
        return 120000; // 2 minutes
      case 'liquidity-spider':
        return 45000; // 45 seconds - faster for multi-pool scanning
      default:
        return 60000;
    }
  }

  getStrategy(name: string): TradingStrategy | undefined {
    return this.strategies.get(name);
  }

  configureStrategies(pairs: Array<{ symbolIn: string; symbolOut: string; amountIn: string }>) {
    // Configure arbitrage strategy with pairs
    const arbitrageStrategy = this.strategies.get('arbitrage') as ArbitrageStrategy;
    if (arbitrageStrategy && 'setPairs' in arbitrageStrategy) {
      (arbitrageStrategy as any).setPairs(pairs);
    }
  }
}
