import { MarketCondition, TradeResult, PerformanceMetrics, TradingStrategy } from './types.js';
import { TriangularArbitrage } from './strategies/triangular-arbitrage.js';
import { FibonacciStrategy } from './strategies/fibonacci-strategy.js';
import { ArbitrageStrategy } from './strategies/arbitrage-strategy.js';
import { LiquiditySpiderStrategy } from './strategies/liquidity-spider-strategy.js';
import { FafnirTreasureHoarder } from './strategies/fafnir-treasure-hoarder.js';
import { EnhancedTrendStrategy } from './enhanced-trend-strategy.js';
import { TestStrategy } from './strategies/test-strategy.js';
import fs from 'fs-extra';
import path from 'node:path';

/**
 * Multi-User Strategy Manager
 *
 * Handles multiple users running different strategies simultaneously
 * Each user gets their own isolated strategy instance with independent execution
 */

export interface UserSession {
  walletAddress: string;
  selectedStrategy: string;
  strategyInstance: TradingStrategy;
  isActive: boolean;
  startTime: number;
  lastActivity: number;
  lastTradeTime: number;
  sessionId: string;
  config: UserStrategyConfig;
  performance: UserPerformanceMetrics;
}

export interface UserStrategyConfig {
  minProfitBps?: number;
  slippageBps?: number;
  maxTradeSize?: number;
  riskLevel?: 'conservative' | 'moderate' | 'aggressive';
  autoTrade?: boolean;
  notifications?: boolean;
}

export interface UserPerformanceMetrics {
  totalTrades: number;
  successfulTrades: number;
  totalProfit: number;
  totalVolume: number;
  winRate: number;
  averageProfit: number;
  lastUpdated: number;
  dailyProfit: number;
}

export interface StrategyAssignmentRequest {
  walletAddress: string;
  strategy: string;
  config?: UserStrategyConfig;
}

export interface StrategyStatusUpdate {
  walletAddress: string;
  sessionId: string;
  strategy: string;
  status: 'active' | 'paused' | 'stopped' | 'error';
  lastTrade?: TradeResult;
  performance: UserPerformanceMetrics;
  timestamp: number;
}

export class MultiUserStrategyManager {
  private userSessions: Map<string, UserSession> = new Map();
  private availableStrategies: Map<string, new () => TradingStrategy> = new Map();
  private globalMarketCondition: MarketCondition = {
    volatility: 0.02,
    volume: 100,
    competitionLevel: 'MEDIUM',
    timeOfDay: new Date().getHours(),
    recentPerformance: 0.0
  };
  private updateInterval: NodeJS.Timeout | null = null;
  private logDir: string;
  private broadcastCallback?: (update: StrategyStatusUpdate) => void;

  constructor() {
    this.logDir = path.join(process.cwd(), 'logs', 'multi-user');
    fs.ensureDirSync(this.logDir);

    this.initializeAvailableStrategies();
    this.loadUserSessions();
    this.startPeriodicUpdates();

    console.log(`🚀 Multi-User Strategy Manager initialized`);
    console.log(`📊 Available strategies: ${Array.from(this.availableStrategies.keys()).join(', ')}`);
  }

  /**
   * Set callback function for broadcasting real-time updates
   */
  setBroadcastCallback(callback: (update: StrategyStatusUpdate) => void): void {
    this.broadcastCallback = callback;
    console.log('📡 Broadcast callback registered for real-time updates');
  }

  /**
   * Initialize all available strategy classes
   */
  private initializeAvailableStrategies(): void {
    this.availableStrategies.set('arbitrage', ArbitrageStrategy as any);
    this.availableStrategies.set('triangular', TriangularArbitrage as any);
    this.availableStrategies.set('fibonacci', FibonacciStrategy as any);
    this.availableStrategies.set('liquidity-spider', LiquiditySpiderStrategy as any);
    this.availableStrategies.set('enhanced-trend', EnhancedTrendStrategy as any);
    this.availableStrategies.set('fafnir-treasure-hoarder', FafnirTreasureHoarder as any);
    this.availableStrategies.set('test-strategy', TestStrategy as any);
  }

  /**
   * Assign a strategy to a user (instant assignment)
   */
  async assignStrategy(request: StrategyAssignmentRequest): Promise<UserSession> {
    const { walletAddress, strategy, config = {} } = request;

    console.log(`🎯 Assigning ${strategy} strategy to wallet ${walletAddress}`);

    // Stop existing session if any
    if (this.userSessions.has(walletAddress)) {
      await this.stopUserStrategy(walletAddress);
    }

    // Validate strategy exists
    const StrategyClass = this.availableStrategies.get(strategy);
    if (!StrategyClass) {
      throw new Error(`Strategy '${strategy}' not available. Available: ${Array.from(this.availableStrategies.keys()).join(', ')}`);
    }

    // Create isolated strategy instance for this user
    const strategyInstance = new (StrategyClass as any)(walletAddress);

    // Apply user configuration to strategy if supported
    this.applyUserConfig(strategyInstance, config);

    // Create user session
    const sessionId = `session_${walletAddress.slice(-8)}_${Date.now()}`;
    const session: UserSession = {
      walletAddress,
      selectedStrategy: strategy,
      strategyInstance,
      isActive: true,
      startTime: Date.now(),
      lastActivity: Date.now(),
      lastTradeTime: 0,
      sessionId,
      config: {
        minProfitBps: 50,
        slippageBps: 100,
        maxTradeSize: 50,
        riskLevel: 'moderate',
        autoTrade: true,
        notifications: true,
        ...config
      },
      performance: {
        totalTrades: 0,
        successfulTrades: 0,
        totalProfit: 0,
        totalVolume: 0,
        winRate: 0,
        averageProfit: 0,
        lastUpdated: Date.now(),
        dailyProfit: 0
      }
    };

    this.userSessions.set(walletAddress, session);
    this.saveUserSessions();

    console.log(`✅ Strategy ${strategy} assigned to ${walletAddress} (Session: ${sessionId})`);

    // Broadcast initial status
    this.broadcastUserUpdate(session);

    return session;
  }

  /**
   * Execute trading cycle for all active users
   */
  async executeAllUserStrategies(): Promise<void> {
    if (this.userSessions.size === 0) {
      return; // No active users
    }

    console.log(`🔄 Executing strategies for ${this.userSessions.size} active users`);

    // Update global market condition (shared across all users)
    await this.updateGlobalMarketCondition();

    // Execute each user's strategy in parallel
    const executionPromises = Array.from(this.userSessions.values()).map(async (session) => {
      if (!session.isActive) return;

      try {
        await this.executeUserStrategy(session);
      } catch (error: any) {
        console.error(`❌ Error executing strategy for ${session.walletAddress}: ${error.message}`);
        await this.handleUserStrategyError(session, error);
      }
    });

    await Promise.allSettled(executionPromises);
  }

  /**
   * Execute strategy for a specific user
   */
  private async executeUserStrategy(session: UserSession): Promise<void> {
    const { walletAddress, strategyInstance, selectedStrategy } = session;

    // Check if strategy should activate based on market conditions
    if (!strategyInstance.shouldActivate(this.globalMarketCondition)) {
      console.log(`⏸️ Strategy ${selectedStrategy} for ${walletAddress} waiting for better market conditions`);
      return;
    }

    console.log(`🚀 Executing ${selectedStrategy} for ${walletAddress}`);

    // Execute the strategy
    const result = await strategyInstance.execute();

    // Update session activity
    session.lastActivity = Date.now();
    if (result.success) {
      session.lastTradeTime = Date.now();
    }

    // Update performance metrics
    this.updateUserPerformance(session, result);

    // Log the trade
    await this.logUserTrade(session, result);

    // Broadcast update
    this.broadcastUserUpdate(session, result);

    console.log(`📊 ${selectedStrategy} result for ${walletAddress}: ${result.success ? '✅' : '❌'} Profit: $${result.profit.toFixed(4)}`);
  }

  /**
   * Stop strategy for a specific user
   */
  async stopUserStrategy(walletAddress: string): Promise<boolean> {
    const session = this.userSessions.get(walletAddress);
    if (!session) {
      return false;
    }

    console.log(`🛑 Stopping strategy ${session.selectedStrategy} for ${walletAddress}`);

    session.isActive = false;

    // Clean up strategy instance if it has cleanup methods
    if (typeof (session.strategyInstance as any).cleanup === 'function') {
      await (session.strategyInstance as any).cleanup();
    }

    this.userSessions.delete(walletAddress);
    this.saveUserSessions();

    // Broadcast final status
    const finalUpdate: StrategyStatusUpdate = {
      walletAddress,
      sessionId: session.sessionId,
      strategy: session.selectedStrategy,
      status: 'stopped',
      performance: session.performance,
      timestamp: Date.now()
    };

    if (this.broadcastCallback) {
      this.broadcastCallback(finalUpdate);
    }

    console.log(`✅ Strategy stopped for ${walletAddress}`);
    return true;
  }

  /**
   * Get status for a specific user
   */
  getUserStatus(walletAddress: string): UserSession | null {
    return this.userSessions.get(walletAddress) || null;
  }

  /**
   * Get status for all active users
   */
  getAllUserStatuses(): UserSession[] {
    return Array.from(this.userSessions.values());
  }

  /**
   * Get available strategies
   */
  getAvailableStrategies(): string[] {
    return Array.from(this.availableStrategies.keys());
  }

  /**
   * Update user strategy configuration
   */
  async updateUserConfig(walletAddress: string, config: Partial<UserStrategyConfig>): Promise<boolean> {
    const session = this.userSessions.get(walletAddress);
    if (!session) {
      return false;
    }

    // Update session config
    session.config = { ...session.config, ...config };

    // Apply new config to strategy instance
    this.applyUserConfig(session.strategyInstance, session.config);

    this.saveUserSessions();
    this.broadcastUserUpdate(session);

    console.log(`🔧 Updated config for ${walletAddress}:`, config);
    return true;
  }

  /**
   * Apply user configuration to strategy instance
   */
  private applyUserConfig(strategy: TradingStrategy, config: UserStrategyConfig): void {
    // Apply configuration if the strategy supports it
    if (typeof (strategy as any).setConfig === 'function') {
      (strategy as any).setConfig(config);
    }

    // Apply common configurations
    if (config.minProfitBps && typeof (strategy as any).minProfitBps !== 'undefined') {
      (strategy as any).minProfitBps = config.minProfitBps;
    }

    if (config.slippageBps && typeof (strategy as any).slippageBps !== 'undefined') {
      (strategy as any).slippageBps = config.slippageBps;
    }
  }

  /**
   * Update user performance metrics
   */
  private updateUserPerformance(session: UserSession, result: TradeResult): void {
    const perf = session.performance;

    perf.totalTrades++;
    if (result.success) {
      perf.successfulTrades++;
      perf.totalProfit += result.profit;
      perf.totalVolume += result.volume;
    }

    perf.winRate = perf.totalTrades > 0 ? (perf.successfulTrades / perf.totalTrades) * 100 : 0;
    perf.averageProfit = perf.successfulTrades > 0 ? perf.totalProfit / perf.successfulTrades : 0;
    perf.lastUpdated = Date.now();

    // Calculate daily profit (last 24 hours)
    // This would need to be enhanced with historical trade tracking
    perf.dailyProfit = perf.totalProfit; // Simplified for now
  }

  /**
   * Broadcast user update via callback
   */
  private broadcastUserUpdate(session: UserSession, lastTrade?: TradeResult): void {
    if (!this.broadcastCallback) return;

    const update: StrategyStatusUpdate = {
      walletAddress: session.walletAddress,
      sessionId: session.sessionId,
      strategy: session.selectedStrategy,
      status: session.isActive ? 'active' : 'stopped',
      lastTrade,
      performance: session.performance,
      timestamp: Date.now()
    };

    this.broadcastCallback(update);
  }

  /**
   * Handle strategy execution errors
   */
  private async handleUserStrategyError(session: UserSession, error: Error): Promise<void> {
    console.error(`❌ Strategy error for ${session.walletAddress}:`, error.message);

    // Log error
    const errorLog = {
      timestamp: new Date().toISOString(),
      walletAddress: session.walletAddress,
      strategy: session.selectedStrategy,
      error: error.message,
      stack: error.stack
    };

    const errorFile = path.join(this.logDir, `errors-${session.walletAddress}.log`);
    await fs.appendFile(errorFile, JSON.stringify(errorLog) + '\n');

    // Broadcast error status
    const errorUpdate: StrategyStatusUpdate = {
      walletAddress: session.walletAddress,
      sessionId: session.sessionId,
      strategy: session.selectedStrategy,
      status: 'error',
      performance: session.performance,
      timestamp: Date.now()
    };

    if (this.broadcastCallback) {
      this.broadcastCallback(errorUpdate);
    }
  }

  /**
   * Log user trade to file
   */
  private async logUserTrade(session: UserSession, result: TradeResult): Promise<void> {
    const tradeLog = {
      timestamp: new Date().toISOString(),
      walletAddress: session.walletAddress,
      sessionId: session.sessionId,
      strategy: session.selectedStrategy,
      success: result.success,
      profit: result.profit,
      volume: result.volume,
      pool: result.pool,
      error: result.error
    };

    const tradeFile = path.join(this.logDir, `trades-${session.walletAddress}.log`);
    await fs.appendFile(tradeFile, JSON.stringify(tradeLog) + '\n');
  }

  /**
   * Update global market condition (shared across all users)
   */
  private async updateGlobalMarketCondition(): Promise<void> {
    // This would integrate with your existing market analysis
    // For now, using a simplified version
    this.globalMarketCondition = {
      volatility: Math.random() * 0.05, // 0-5% volatility
      volume: 50 + Math.random() * 100, // 50-150 volume
      competitionLevel: Math.random() > 0.66 ? 'HIGH' : Math.random() > 0.33 ? 'MEDIUM' : 'LOW',
      timeOfDay: new Date().getHours(),
      recentPerformance: (Math.random() - 0.5) * 0.1 // -5% to +5%
    };
  }

  /**
   * Start periodic execution for all users
   */
  private startPeriodicUpdates(): void {
    const intervalMs = 30000; // 30 seconds

    this.updateInterval = setInterval(async () => {
      try {
        await this.executeAllUserStrategies();
      } catch (error: any) {
        console.error('❌ Error in periodic update:', error.message);
      }
    }, intervalMs);

    console.log(`⏰ Started periodic updates every ${intervalMs/1000} seconds`);
  }

  /**
   * Stop periodic updates
   */
  stopPeriodicUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('⏹️ Stopped periodic updates');
    }
  }

  /**
   * Save user sessions to disk
   */
  private saveUserSessions(): void {
    try {
      const sessionsData = Array.from(this.userSessions.entries()).map(([address, session]) => ({
        walletAddress: address,
        selectedStrategy: session.selectedStrategy,
        isActive: session.isActive,
        startTime: session.startTime,
        lastActivity: session.lastActivity,
        lastTradeTime: session.lastTradeTime,
        sessionId: session.sessionId,
        config: session.config,
        performance: session.performance
      }));

      const sessionsFile = path.join(this.logDir, 'user-sessions.json');
      fs.writeFileSync(sessionsFile, JSON.stringify(sessionsData, null, 2));
    } catch (error: any) {
      console.error('❌ Error saving user sessions:', error.message);
    }
  }

  /**
   * Load user sessions from disk
   */
  private loadUserSessions(): void {
    try {
      const sessionsFile = path.join(this.logDir, 'user-sessions.json');
      if (!fs.existsSync(sessionsFile)) return;

      const sessionsData = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));

      // Restore active sessions (but don't auto-restart strategies)
      for (const sessionData of sessionsData) {
        if (sessionData.isActive) {
          console.log(`📂 Found previous session for ${sessionData.walletAddress} (${sessionData.selectedStrategy})`);
          // Sessions will need to be manually restarted by users
        }
      }

      console.log(`📂 Loaded ${sessionsData.length} previous sessions`);
    } catch (error: any) {
      console.error('❌ Error loading user sessions:', error.message);
    }
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down Multi-User Strategy Manager...');

    this.stopPeriodicUpdates();

    // Stop all user strategies
    const stopPromises = Array.from(this.userSessions.keys()).map(address =>
      this.stopUserStrategy(address)
    );

    await Promise.allSettled(stopPromises);

    console.log('✅ Multi-User Strategy Manager shutdown complete');
  }
}
