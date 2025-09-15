import { MarketCondition, TradeResult, TradingStrategy } from '../types.js';
import { BasicRaydiumStrategy } from './strategies/basic-raydium-strategy.js';

/**
 * Dedicated strategy manager for Raydium based strategies.  This intentionally
 * mirrors the generic `StrategyManager` but keeps Raydium logic isolated from
 * GalaChain strategies.
 */
export class RaydiumStrategyManager {
  private strategies: Map<string, TradingStrategy> = new Map();
  private currentStrategy: string;

  constructor() {
    // Register built-in strategies
    const basic = new BasicRaydiumStrategy();
    this.strategies.set(basic.name, basic);
    this.currentStrategy = basic.name;
  }

  /**
   * Select a strategy to run based on market conditions.  The implementation is
   * simple for now – it keeps the current strategy if it can activate, otherwise
   * picks the first available strategy.
   */
  async selectStrategy(market: MarketCondition): Promise<string> {
    const strategy = this.strategies.get(this.currentStrategy);
    if (strategy && strategy.shouldActivate(market)) {
      return this.currentStrategy;
    }

    for (const [name, strat] of this.strategies) {
      if (strat.shouldActivate(market)) {
        this.currentStrategy = name;
        break;
      }
    }
    return this.currentStrategy;
  }

  async executeCurrentStrategy(): Promise<TradeResult> {
    const strategy = this.strategies.get(this.currentStrategy);
    if (!strategy) {
      throw new Error(`Strategy not found: ${this.currentStrategy}`);
    }
    return strategy.execute();
  }

  addStrategy(strategy: TradingStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  getCurrentStrategy(): string {
    return this.currentStrategy;
  }
}
