import 'dotenv/config';
import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import fs from 'fs-extra';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// Import strategy components
import { StrategyManager } from './strategy-manager.js';
import { MilestoneTracker } from './milestone-tracker.js';
import { PerformanceDashboard } from './dashboard.js';
import { DynamicConfig } from './dynamic-config.js';
import { StrategyAdvisor } from './advisor.js';
import { CompetitionDetector } from './competition-detector.js';
import { MarketCondition, TradeResult, Milestone } from './types.js';

// Import all strategies
import { ArbitrageStrategy } from './strategies/arbitrage-strategy.js';
import { TriangularArbitrage } from './strategies/triangular-arbitrage.js';
import { FibonacciStrategy } from './strategies/fibonacci-strategy.js';
import { LiquiditySpiderStrategy } from './strategies/liquidity-spider-strategy.js';
import { EnhancedTrendStrategy } from './enhanced-trend-strategy.js';
import { FafnirTreasureHoarder } from './strategies/fafnir-treasure-hoarder.js';

/**
 * Multi-Strategy Fafnir Bot
 *
 * Always-active container that can switch between all available strategies
 * Provides API endpoints for frontend control and monitoring
 */

interface BotConfig {
  enableMultiStrategy: boolean;
  defaultStrategy: string;
  strategySwitchInterval: number;
  enableStrategySwitching: boolean;
  enableFrontendControl: boolean;
  availableStrategies: string[];
  dryRun: boolean;
  apiPort: number;
  corsOrigins: string[];
}

interface BotStatus {
  isRunning: boolean;
  currentStrategy: string;
  uptime: number;
  lastTradeTime: Date | null;
  totalTrades: number;
  currentProfit: number;
  availableStrategies: string[];
  lastStrategySwitch: Date | null;
}

class MultiStrategyFafnirBot {
  private config!: BotConfig;
  private strategyManager!: StrategyManager;
  private milestoneTracker!: MilestoneTracker;
  private dashboard!: PerformanceDashboard;
  private advisor!: StrategyAdvisor;
  private dynamicConfig!: DynamicConfig;

  private app!: express.Application;
  private server!: http.Server;
  private isRunning: boolean = false;
  private currentStrategy!: string;
  private startTime: Date;
  private lastTradeTime: Date | null = null;
  private totalTrades: number = 0;
  private currentProfit: number = 0;
  private lastStrategySwitch: Date | null = null;

  private strategies: Map<string, any> = new Map();

  constructor() {
    this.startTime = new Date();
    this.loadConfig();
    this.initializeStrategies();
    this.initializeComponents();
    this.setupAPI();

    console.log('🐉 Multi-Strategy Fafnir Bot initialized');
    console.log(`📊 Available strategies: ${this.config.availableStrategies.join(', ')}`);
    console.log(`🎯 Default strategy: ${this.config.defaultStrategy}`);
  }

  private loadConfig(): void {
    this.config = {
      enableMultiStrategy: process.env.ENABLE_MULTI_STRATEGY === 'true',
      defaultStrategy: process.env.DEFAULT_STRATEGY || 'fafnir-treasure-hoarder',
      strategySwitchInterval: parseInt(process.env.STRATEGY_SWITCH_INTERVAL_MS || '300000'),
      enableStrategySwitching: process.env.ENABLE_STRATEGY_SWITCHING === 'true',
      enableFrontendControl: process.env.ENABLE_FRONTEND_CONTROL === 'true',
      availableStrategies: (process.env.AVAILABLE_STRATEGIES || 'arbitrage,triangular,fibonacci,liquidity-spider,enhanced-trend,fafnir-treasure-hoarder').split(','),
      dryRun: process.env.DRY_RUN === 'true',
      apiPort: parseInt(process.env.BOT_API_PORT || '3001'),
      corsOrigins: (process.env.API_CORS_ORIGINS || 'http://localhost:3001,http://localhost:3000,https://yuphix.io').split(',')
    };

    this.currentStrategy = this.config.defaultStrategy;
  }

  private initializeStrategies(): void {
    // Initialize all available strategies
    this.strategies.set('arbitrage', new ArbitrageStrategy());
    this.strategies.set('triangular', new TriangularArbitrage());
    this.strategies.set('fibonacci', new FibonacciStrategy());
    this.strategies.set('liquidity-spider', new LiquiditySpiderStrategy());
    this.strategies.set('enhanced-trend', new EnhancedTrendStrategy());
    this.strategies.set('fafnir-treasure-hoarder', new FafnirTreasureHoarder());

    console.log(`✅ Initialized ${this.strategies.size} strategies`);
  }

  private initializeComponents(): void {
    this.strategyManager = new StrategyManager();

    // Initialize with default milestones
    const defaultMilestones: Milestone[] = [
      { trades: 10, reward: 100, completed: false },
      { trades: 50, reward: 500, completed: false },
      { trades: 100, reward: 1000, completed: false }
    ];
    this.milestoneTracker = new MilestoneTracker(defaultMilestones);

    // Create a basic CompetitionDetector for dependencies
    const competitionDetector = new CompetitionDetector();
    this.dashboard = new PerformanceDashboard(this.milestoneTracker, this.strategyManager, competitionDetector);

    // Initialize StrategyAdvisor with mock GSwap - this is fine since we're not using it for strategy recommendations
    const mockGSwap = {} as any; // Simplified mock since we don't use this functionality
    this.advisor = new StrategyAdvisor(mockGSwap);

    this.dynamicConfig = new DynamicConfig(competitionDetector);

    console.log('✅ Bot components initialized');
  }

  private setupAPI(): void {
    this.app = express();
    this.server = http.createServer(this.app);

    // Middleware
    this.app.use(cors({
      origin: this.config.corsOrigins,
      credentials: true
    }));
    this.app.use(express.json());

    // Bot status and control endpoints
    this.setupBotRoutes();

    console.log(`🚀 Bot API configured on port ${this.config.apiPort}`);
  }

  private setupBotRoutes(): void {
    // Get bot status
    this.app.get('/api/bot/status', (req: Request, res: Response) => {
      const status: BotStatus = {
        isRunning: this.isRunning,
        currentStrategy: this.currentStrategy,
        uptime: Date.now() - this.startTime.getTime(),
        lastTradeTime: this.lastTradeTime,
        totalTrades: this.totalTrades,
        currentProfit: this.currentProfit,
        availableStrategies: this.config.availableStrategies,
        lastStrategySwitch: this.lastStrategySwitch
      };

      res.json({
        success: true,
        data: status,
        timestamp: new Date().toISOString()
      });
    });

    // Start bot
    this.app.post('/api/bot/start', (req: Request, res: Response) => {
      try {
        if (this.isRunning) {
          return res.status(400).json({
            success: false,
            error: 'Bot is already running'
          });
        }

        this.startBot();
        res.json({
          success: true,
          message: 'Bot started successfully',
          strategy: this.currentStrategy
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Stop bot
    this.app.post('/api/bot/stop', (req: Request, res: Response) => {
      try {
        if (!this.isRunning) {
          return res.status(400).json({
            success: false,
            error: 'Bot is not running'
          });
        }

        this.stopBot();
        res.json({
          success: true,
          message: 'Bot stopped successfully'
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Switch strategy
    this.app.post('/api/bot/strategy/switch', (req: Request, res: Response) => {
      try {
        const { strategy } = req.body;

        if (!strategy) {
          return res.status(400).json({
            success: false,
            error: 'Strategy parameter required'
          });
        }

        if (!this.config.availableStrategies.includes(strategy)) {
          return res.status(400).json({
            success: false,
            error: `Invalid strategy. Available: ${this.config.availableStrategies.join(', ')}`
          });
        }

        this.switchStrategy(strategy);
        res.json({
          success: true,
          message: `Switched to ${strategy} strategy`,
          currentStrategy: this.currentStrategy,
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get available strategies
    this.app.get('/api/bot/strategies', (req: Request, res: Response) => {
      const strategiesInfo = this.config.availableStrategies.map(strategyId => {
        const strategy = this.strategies.get(strategyId);
        return {
          id: strategyId,
          name: strategy?.name || strategyId,
          description: this.getStrategyDescription(strategyId),
          isActive: strategyId === this.currentStrategy,
          riskLevel: this.getStrategyRiskLevel(strategyId)
        };
      });

      res.json({
        success: true,
        data: strategiesInfo,
        currentStrategy: this.currentStrategy
      });
    });

    // Get performance metrics
    this.app.get('/api/bot/performance', (req: Request, res: Response) => {
      try {
        const performance = {
          totalTrades: this.totalTrades,
          currentProfit: this.currentProfit,
          uptime: Date.now() - this.startTime.getTime(),
          currentStrategy: this.currentStrategy,
          lastTradeTime: this.lastTradeTime,
          isRunning: this.isRunning
        };

        res.json({
          success: true,
          data: performance,
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        uptime: Date.now() - this.startTime.getTime(),
        timestamp: new Date().toISOString()
      });
    });
  }

  private getStrategyDescription(strategyId: string): string {
    const descriptions: Record<string, string> = {
      'arbitrage': 'Price difference exploitation across DEXs',
      'triangular': 'Cross-pair arbitrage opportunities',
      'fibonacci': 'Support/resistance level trading',
      'liquidity-spider': 'Liquidity farming strategy',
      'enhanced-trend': 'Trend-following with momentum indicators',
      'fafnir-treasure-hoarder': 'RSI + Bollinger Bands layered strategy (NEW!)'
    };
    return descriptions[strategyId] || 'Trading strategy';
  }

  private getStrategyRiskLevel(strategyId: string): string {
    const riskLevels: Record<string, string> = {
      'arbitrage': 'Low',
      'triangular': 'Low-Medium',
      'fibonacci': 'Medium',
      'liquidity-spider': 'Low',
      'enhanced-trend': 'Medium-High',
      'fafnir-treasure-hoarder': 'Medium'
    };
    return riskLevels[strategyId] || 'Medium';
  }

  private async startBot(): Promise<void> {
    this.isRunning = true;
    console.log(`🚀 Starting bot with strategy: ${this.currentStrategy}`);

    // Start the trading loop
    this.tradingLoop();

    // Start strategy switching if enabled
    if (this.config.enableStrategySwitching) {
      this.strategySwitchingLoop();
    }
  }

  private stopBot(): void {
    this.isRunning = false;
    console.log('🛑 Bot stopped');
  }

  private switchStrategy(newStrategy: string): void {
    if (this.strategies.has(newStrategy)) {
      const previousStrategy = this.currentStrategy;
      this.currentStrategy = newStrategy;
      this.lastStrategySwitch = new Date();

      console.log(`🔄 Strategy switched: ${previousStrategy} → ${newStrategy}`);
    } else {
      throw new Error(`Strategy not available: ${newStrategy}`);
    }
  }

  private async tradingLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const strategy = this.strategies.get(this.currentStrategy);
        if (strategy) {
          console.log(`📊 Executing ${this.currentStrategy} strategy...`);

          const result = await strategy.execute();

          if (result.success) {
            this.totalTrades++;
            this.currentProfit += result.profit || 0;
            this.lastTradeTime = new Date();

            console.log(`✅ Trade executed: ${result.profit || 0} profit`);
          }
        }

        // Wait before next execution
        await sleep(30000); // 30 seconds between checks

      } catch (error) {
        console.error(`❌ Trading loop error:`, error);
        await sleep(60000); // Wait longer on error
      }
    }
  }

  private async strategySwitchingLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await sleep(this.config.strategySwitchInterval);

        if (this.isRunning) {
          // TODO: Implement strategy recommendation logic based on market conditions
          console.log(`🔄 Strategy evaluation cycle - current: ${this.currentStrategy}`);

          // For now, we'll rely on the configured strategy cycling
          // Future: Use advisor.advise() with market data to get recommendations
        }

      } catch (error) {
        console.error(`❌ Strategy switching error:`, error);
        await sleep(60000);
      }
    }
  }

  public async start(): Promise<void> {
    // Start API server
    this.server.listen(this.config.apiPort, () => {
      console.log(`🚀 Multi-Strategy Bot API running on port ${this.config.apiPort}`);
      console.log(`🎯 Bot Control Endpoints:`);
      console.log(`   GET  /api/bot/status - Bot status and metrics`);
      console.log(`   POST /api/bot/start - Start trading`);
      console.log(`   POST /api/bot/stop - Stop trading`);
      console.log(`   POST /api/bot/strategy/switch - Switch strategy`);
      console.log(`   GET  /api/bot/strategies - Available strategies`);
      console.log(`   GET  /api/bot/performance - Performance metrics`);
      console.log(`🌐 CORS enabled for: ${this.config.corsOrigins.join(', ')}`);

      // Auto-start if configured
      if (this.config.enableMultiStrategy) {
        console.log('🎯 Auto-starting multi-strategy bot...');
        this.startBot();
      }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 Received SIGTERM, shutting down gracefully...');
      this.stopBot();
      this.server.close(() => {
        console.log('✅ Multi-Strategy Bot stopped');
        process.exit(0);
      });
    });
  }
}

// Start the bot
const bot = new MultiStrategyFafnirBot();
bot.start().catch(error => {
  console.error('❌ Failed to start Multi-Strategy Bot:', error);
  process.exit(1);
});
