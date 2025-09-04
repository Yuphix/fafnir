export interface PoolConfiguration {
  tokenA: string;
  tokenB: string;
  fee: number;
  minTradeSize: number;
  maxTradeSize: number;
  targetProfitability: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  enabledStrategies: string[];
}

export interface MarketCondition {
  volatility: number;
  volume: number;
  competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  timeOfDay: number; // 0-23 hour
  recentPerformance: number;
}

export interface TradeResult {
  success: boolean;
  profit: number;
  volume: number;
  strategy: string;
  pool: string;
  timestamp: number;
  error?: string;
}

export interface PerformanceMetrics {
  totalTrades: number;
  profitableTrades: number;
  totalVolume: number;
  totalProfit: number;
  winRate: number;
  lastUpdated: number;
}

export interface ArbitragePath {
  path: string[];
  expectedProfit: number;
  totalFees: number;
  tradeSize: number;
  confidence: number;
  // Optional per-hop details for execution
  hops?: Array<{
    from: string;
    to: string;
    feeTier: number;
    quotedOut: number;
  }>;
}

export interface BotSignature {
  pattern: string;
  interval: number;
  tradeAmounts: number[];
  lastSeen: number;
}

export interface Trade {
  pool: string;
  amount: number;
  timestamp: number;
  strategy: string;
}

export interface Milestone {
  trades: number;
  reward: number;
  completed: boolean;
}

export interface StrategyConfig {
  name: string;
  minVolumeRequired: number;
  maxRisk: number;
  enabled: boolean;
}

export interface CompetitionDetection {
  botsDetected: boolean;
  botSignatures: BotSignature[];
  recommendedActions: string[];
}

export interface TradingStrategy {
  name: string;
  execute(): Promise<TradeResult>;
  shouldActivate(marketCondition: MarketCondition): boolean;
  minVolumeRequired: number;
  maxRisk: number;
}
