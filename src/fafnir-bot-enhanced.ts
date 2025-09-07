import 'dotenv/config';
import fs from 'fs-extra';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { GSwap } from '@gala-chain/gswap-sdk';
import { signatures } from '@gala-chain/api';

// Import enhanced components
import { StrategyManager } from './strategy-manager.js';
import { MilestoneTracker } from './milestone-tracker.js';
import { CompetitionDetector } from './competition-detector.js';
import { PerformanceDashboard } from './dashboard.js';
import { DynamicConfig } from './dynamic-config';
import { MarketCondition, TradeResult, PoolConfiguration } from './types.js';
import { StrategyAdvisor } from './advisor.js';
import { collectPoolSnapshot } from './pool-snapshot.js';

// --- Token registry --------------------------------------------------------
const TOKENS: Record<string, string> = {
  GALA: 'GALA|Unit|none|none',
  GUSDC: 'GUSDC|Unit|none|none',
  GWETH: 'GWETH|Unit|none|none',
  GWBTC: 'GWBTC|Unit|none|none',
  GUSDT: 'GUSDT|Unit|none|none',
  SILK: 'SILK|Unit|none|none',
  MTRM: 'MTRM|Unit|none|none'
};

const FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1.0%

function token(type: string): string {
  const t = TOKENS[type];
  if (!t) throw new Error(`Unknown token symbol: ${type}`);
  return t;
}

// --- Enhanced Config ------------------------------------------------------
let cfg: any;
try {
  const cfgPath = path.join(process.cwd(), 'config.json');
  const configText = fs.readFileSync(cfgPath, 'utf8');
  cfg = JSON.parse(configText);
} catch (error) {
  console.error('Failed to load config:', error);
  process.exit(1);
}



const thresholdBps = cfg.thresholdBps ?? 80;
const slippageBps = Number(process.env.SLIPPAGE_BPS || 100);
const forceDryRun = process.env.FORCE_DRYRUN === '1';
const isDryRun = process.env.DRY_RUN === '1' || forceDryRun;
const dashboardEnabled = String(process.env.DASHBOARD_ENABLED || 'false').toLowerCase() === 'true';

// --- Enhanced Production Configuration ------------------------------------
const PRODUCTION_CONFIG = {
  gasLimit: 300000,
  maxDailyLoss: 50,
  maxTradeSize: 25, // Updated for conservative trading
  minProfitAfterFees: 0.5,
  maxSlippage: 0.8,
  emergencyStop: false,
  // Balance safety limits for 2k GALA + 80 GUSDC
  minGUSDCBalance: 5, // Lowered to match new min trade size
  minGALABalance: 5,
  maxConcurrentTrades: 3,
  dailyStats: {
    totalTrades: 0,
    totalProfit: 0,
    totalLoss: 0,
    lastReset: new Date().toDateString()
  }
};

// --- GalaSwap client ------------------------------------------------------
// Initialize GSwap client for quotes and swap payloads
const gatewayUrl = process.env.GSWAP_GATEWAY_URL || 'https://gateway-mainnet.galachain.com';
const dexBackendUrl = process.env.GSWAP_DEX_BACKEND_URL || 'https://dex-backend-prod1.defi.gala.com';
const bundlerUrl = process.env.GSWAP_BUNDLER_URL || 'https://bundle-backend-prod1.defi.gala.com';

const gswap = new GSwap({
  gatewayBaseUrl: gatewayUrl,
  dexBackendBaseUrl: dexBackendUrl,
  bundlerBaseUrl: bundlerUrl,
  dexContractBasePath: '/api/asset/dexv3-contract',
  tokenContractBasePath: '/api/asset/token-contract',
  bundlingAPIBasePath: '/bundle'
});

// --- Enhanced Logging ----------------------------------------------------
const logDir = path.join(process.cwd(), 'logs');
fs.ensureDirSync(logDir);
const logFile = path.join(logDir, 'scout.log');
const dryDir = path.join(logDir, 'dryruns');
fs.ensureDirSync(dryDir);

function logLine(text: string) {
  const line = `[${new Date().toISOString()}] ${text}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

// --- Enhanced Components Initialization ----------------------------------
let strategyManager: StrategyManager;
let milestoneTracker: MilestoneTracker;
let competitionDetector: CompetitionDetector;
let performanceDashboard: PerformanceDashboard | null;
let dynamicConfig: DynamicConfig;
let advisor: StrategyAdvisor | null = null;
let lastAdvisorRun = 0;

async function initializeEnhancedComponents() {
  try {
    // Initialize milestone tracker
    milestoneTracker = new MilestoneTracker(
      cfg.milestoneSettings.milestones,
      cfg.milestoneSettings.volumeTarget
    );

    // Initialize competition detector
    competitionDetector = new CompetitionDetector();

    // Initialize dynamic config
    dynamicConfig = new DynamicConfig(competitionDetector);

    // Initialize strategy manager
    strategyManager = new StrategyManager();

    // Configure strategies with the pairs from config
    strategyManager.configureStrategies(cfg.pairs);

    // Initialize performance dashboard (optional)
    if (dashboardEnabled) {
      performanceDashboard = new PerformanceDashboard(
        milestoneTracker,
        strategyManager,
        competitionDetector
      );
    } else {
      performanceDashboard = null;
    }

    // Initialize advisor
    advisor = new StrategyAdvisor(gswap);

    logLine('🚀 Enhanced components initialized successfully');
  } catch (error: any) {
    logLine(`❌ Failed to initialize enhanced components: ${error.message}`);
    throw error;
  }
}

// --- Balance Safety Check -------------------------------------------------
async function checkBalanceSafety(): Promise<boolean> {
  try {
    // TODO: In production, get real balances from GalaChain SDK
    // For now, we'll use environment variables or config
    const gusdcBalance = Number(process.env.GUSDC_BALANCE || 80);
    const galaBalance = Number(process.env.GALA_BALANCE || 2000);

    if (gusdcBalance < PRODUCTION_CONFIG.minGUSDCBalance) {
      logLine(`🚨 INSUFFICIENT GUSDC: ${gusdcBalance} < ${PRODUCTION_CONFIG.minGUSDCBalance} - Stopping GUSDC trades`);
      return false;
    }

    if (galaBalance < PRODUCTION_CONFIG.minGALABalance) {
      logLine(`🚨 INSUFFICIENT GALA: ${galaBalance} < ${PRODUCTION_CONFIG.minGALABalance} - Stopping all trades`);
      return false;
    }

    logLine(`✅ Balance check passed: GUSDC ${gusdcBalance}, GALA ${galaBalance}`);
    return true;
  } catch (error: any) {
    logLine(`❌ Balance check failed: ${error.message}`);
    return false;
  }
}

// --- Market Condition Analysis -------------------------------------------
async function analyzeMarketCondition(): Promise<MarketCondition> {
  try {
    // TODO: In production, integrate with real market data APIs
    // For now, use basic time-based analysis with real SDK data

    const now = new Date();
    const hour = now.getHours();

    // Base market conditions - will be replaced with real data
    let volatility = 0.02; // Base volatility
    let volume = 100;

    // Time-based adjustments (temporary until real data integration)
    if (hour >= 9 && hour <= 17) {
      volatility = 0.025; // Slightly higher during market hours
      volume = 150;
    } else if (hour >= 22 || hour <= 6) {
      volatility = 0.015; // Lower during off hours
      volume = 80;
    }

    // Get competition level from detector
    const competitionLevel = await competitionDetector.getCompetitionLevel();

    return {
      volatility,
      volume,
      competitionLevel,
      timeOfDay: hour,
      recentPerformance: 0.5 // Will be calculated from real performance data
    };
  } catch (error: any) {
    logLine(`⚠️ Error analyzing market conditions: ${error.message}`);
    // Return safe defaults
    return {
      volatility: 0.02,
      volume: 100,
      competitionLevel: 'MEDIUM' as const,
      timeOfDay: new Date().getHours(),
      recentPerformance: 0.5
    };
  }
}



// --- Enhanced Trading Loop -----------------------------------------------
async function enhancedTradingLoop() {
  logLine('🔄 Starting enhanced trading loop');

  let lastStrategyCheck = Date.now();
  let lastDashboardUpdate = Date.now();

  while (true) {
    try {
      // Check emergency stop
      if (PRODUCTION_CONFIG.emergencyStop) {
        logLine(`🛑 Bot is in emergency stop mode. Check logs and restart manually.`);
        await sleep(30000);
        continue;
      }

      // Check balance safety
      const balanceSafe = await checkBalanceSafety();
      if (!balanceSafe) {
        logLine(`🛑 Insufficient balance - stopping trading loop`);
        await sleep(60000); // Wait 1 minute before checking again
        continue;
      }

      // Analyze market conditions
      const marketCondition = await analyzeMarketCondition();

      // Check if we should switch strategies
      if (Date.now() - lastStrategyCheck > cfg.strategySettings.strategySwitchInterval) {
        await strategyManager.selectStrategy(marketCondition);
        lastStrategyCheck = Date.now();
      }

      // Adjust dynamic parameters
      await dynamicConfig.adjustParameters(marketCondition);

      // Execute current strategy
      const result = await strategyManager.executeCurrentStrategy();

      // Update milestone progress (disabled for now)
      // await milestoneTracker.updateProgress(result);

      // Add trade to competition detector
      await competitionDetector.addTrade({
        pool: result.pool,
        amount: result.volume,
        timestamp: result.timestamp,
        strategy: result.strategy
      });

      // Log trade result
      if (result.success) {
        logLine(`✅ ${result.strategy} strategy executed successfully: $${result.profit.toFixed(4)} profit on ${result.pool}`);
      } else {
        logLine(`❌ ${result.strategy} strategy failed: ${result.error}`);
      }

      // Update dashboard periodically
      if (dashboardEnabled && performanceDashboard && (Date.now() - lastDashboardUpdate > 30000)) { // Every 30 seconds
        await performanceDashboard.generateReport();
        lastDashboardUpdate = Date.now();
      }

      // Advisor: every interval, request recommendation and safely switch
      if (advisor && advisor.isEnabled && Date.now() - lastAdvisorRun > advisor.intervalMs) {
        try {
          // Build pairs list from config
          const pairs = (cfg.pairs || []) as Array<{ symbolIn: string; symbolOut: string; amountIn: string }>;
          // Snapshot is produced inside advisor call; we pass slippage for minOut estimates
          const rec = await advisor.advise(pairs, slippageBps);
          if (rec && ['arbitrage','triangular','fibonacci'].includes(rec)) {
            // Respect StrategyManager cooldown; selectStrategy will honor switch interval
            console.log(`🤖 Advisor recommends: ${rec}`);
            // Hint selection by setting currentStrategy if cooldown passed and shouldActivate
            const mc = await analyzeMarketCondition();
            if ((strategyManager as any).rotationMode === 'round_robin') {
              // In round-robin mode, we let the loop advance naturally
            } else {
              // Score mode: bias selection by temporarily setting current strategy
              (strategyManager as any).currentStrategy = rec;
            }
          }
        } catch {}
        lastAdvisorRun = Date.now();
      }

      // Get delay for current strategy
      const delay = strategyManager.getDelayForStrategy();

      // Add random delay if competition detected
      if (await competitionDetector.detectBots()) {
        const randomDelay = competitionDetector.getRandomDelay();
        logLine(`🤖 Competition detected, adding random delay: ${randomDelay}ms`);
        await sleep(randomDelay);
      }

      await sleep(delay);

    } catch (error: any) {
      logLine(`⚠️ Error in enhanced trading loop: ${error.message}`);
      await sleep(10000); // Wait 10 seconds before retrying
    }
  }
}

// --- Process Lock to Prevent Duplicates --------------------------------
let isRunning = false;

// --- Main Function -------------------------------------------------------
async function main() {
  // Prevent multiple instances from running
  if (isRunning) {
    console.log('❌ Bot is already running! Exiting...');
    process.exit(1);
  }

  isRunning = true;

  try {
    console.clear();
    console.log('🔥 Fafnir Bot Enhanced — Advanced Trading Bot with Multi-Strategy Support');
    console.log('🚀 Initializing enhanced components...\n');

    // Initialize enhanced components
    await initializeEnhancedComponents();

    // Display initial dashboard (optional)
    if (dashboardEnabled && performanceDashboard) {
      await performanceDashboard.generateReport();
      performanceDashboard.startAutoRefresh(30000);
    }

    if (isDryRun) {
      logLine('🧪 DRY RUN MODE: Testing enhanced bot strategies');
      // Run a few cycles to test strategy switching
      for (let i = 0; i < 3; i++) {
        logLine(`\n🔄 Dry Run Cycle ${i + 1}/3`);

        // Analyze market conditions
        const marketCondition = await analyzeMarketCondition();
        logLine(`📊 Market: Volatility ${(marketCondition.volatility * 100).toFixed(2)}%, Volume ${marketCondition.volume.toFixed(0)}`);

        // Select and execute strategy
        const selectedStrategy = await strategyManager.selectStrategy(marketCondition);
        logLine(`🎯 Selected Strategy: ${selectedStrategy}`);

        const result = await strategyManager.executeCurrentStrategy();
        if (result.success) {
          logLine(`✅ ${result.strategy} executed: $${result.profit.toFixed(4)} profit on ${result.pool}`);
          logLine(`   📍 Pool: ${result.pool} | Volume: $${result.volume.toFixed(2)} | Strategy: ${result.strategy}`);
        } else {
          logLine(`❌ ${result.strategy} failed: ${result.error}`);
          logLine(`   📍 Pool: ${result.pool} | Error: ${result.error}`);
        }

        if (i < 2) await sleep(5000); // Wait 5 seconds between cycles
      }

      logLine('🧪 Dry run completed - check logs for details');
      process.exit(0);
    } else {
      // Start enhanced trading loop
      await enhancedTradingLoop();
    }

  } catch (error: any) {
    console.error('❌ Fatal error:', error);
    logLine(`❌ Fatal error: ${error.message}`);
    isRunning = false; // Reset lock on error
    process.exit(1);
  }
}

// --- Signal Handling -----------------------------------------------------
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down Fafnir Bot Enhanced...');

  // Stop auto-refresh timer
  if (dashboardEnabled && performanceDashboard) {
    performanceDashboard.stopAutoRefresh();
  }

  // Generate final summary
  if (dashboardEnabled && performanceDashboard) {
    const summary = await performanceDashboard.generateSummaryReport();
    logLine(`\n${summary}`);
  }

  isRunning = false; // Reset lock
  logLine('🔄 Bot shutdown complete');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');

  // Stop auto-refresh timer
  if (performanceDashboard) {
    performanceDashboard.stopAutoRefresh();
  }

  isRunning = false; // Reset lock
  process.exit(0);
});

// Start the enhanced bot
main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
