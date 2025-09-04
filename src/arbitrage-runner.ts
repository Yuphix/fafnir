#!/usr/bin/env node

import { ArbitrageStrategy } from './strategies/arbitrage-strategy.js';

/**
 * Enhanced Arbitrage Strategy Runner
 *
 * Features:
 * - AI advisor integration (toggleable)
 * - Multiple pool monitoring
 * - Risk management
 * - Concurrent trade limiting
 * - Real-time profit tracking
 */

class ArbitrageRunner {
  private strategy: ArbitrageStrategy;
  private intervalMs: number;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.strategy = new ArbitrageStrategy();
    this.intervalMs = Number(process.env.ARB_POLL_INTERVAL_MS || 120000); // 2 minutes default

    console.log(`🚀 Enhanced Arbitrage Runner initialized`);
    console.log(`⏱️ Polling interval: ${this.intervalMs / 1000}s`);
    console.log(`🤖 AI Advisor: ${process.env.ARB_USE_ADVISOR === 'true' ? 'ENABLED' : 'DISABLED'}`);
    console.log(`💰 Min profit threshold: ${process.env.ARB_MIN_PROFIT_BPS || 50}bps`);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Arbitrage runner is already running');
      return;
    }

    this.isRunning = true;
    console.log(`🎯 Starting Enhanced Arbitrage Strategy...`);

    // Execute immediately on startup
    await this.executeRound();

    // Set up recurring execution
    this.intervalId = setInterval(async () => {
      await this.executeRound();
    }, this.intervalMs);

    console.log(`✅ Enhanced Arbitrage Strategy is running (interval: ${this.intervalMs / 1000}s)`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log(`🛑 Enhanced Arbitrage Strategy stopped`);
  }

  private async executeRound(): Promise<void> {
    try {
      console.log(`\n📈 Enhanced Arbitrage scanning for opportunities...`);
      const startTime = Date.now();

      const result = await this.strategy.execute();
      const executionTime = Date.now() - startTime;

      if (result.success) {
        console.log(`✅ Arbitrage opportunity executed!`);
        console.log(`   💰 Profit: $${result.profit.toFixed(4)}`);
        console.log(`   📊 Volume: $${result.volume.toFixed(2)}`);
        console.log(`   🎯 Pool: ${result.pool}`);
        console.log(`   ⏱️ Execution time: ${executionTime}ms`);

        // Log successful trade to file
        await this.logTrade(result, executionTime);
      } else {
        const error = result.error || 'No profitable opportunities found';
        console.log(`⚠️ No arbitrage execution: ${error}`);

        if (error.includes('concurrent')) {
          console.log(`   ⏸️ Waiting for active trades to complete...`);
        }
      }

    } catch (error: any) {
      console.error(`❌ Arbitrage execution error: ${error.message}`);

      // Log error details for debugging
      if (error.stack) {
        console.error(`   📋 Stack trace: ${error.stack.split('\n')[0]}`);
      }
    }
  }

  private async logTrade(result: any, executionTime: number): Promise<void> {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        strategy: 'enhanced-arbitrage',
        success: result.success,
        profit: result.profit,
        volume: result.volume,
        pool: result.pool,
        executionTimeMs: executionTime,
        profitPercentage: ((result.profit / result.volume) * 100).toFixed(4)
      };

      // Append to trades log
      const fs = await import('fs-extra');
      const path = await import('node:path');
      const logsDir = path.join(process.cwd(), 'logs');
      await fs.ensureDir(logsDir);

      const tradesLog = path.join(logsDir, 'trades.log');
      const logLine = `[${logEntry.timestamp}] ✅ Enhanced Arbitrage: $${logEntry.profit} profit on ${logEntry.pool} (${logEntry.profitPercentage}% return)\n`;
      await fs.appendFile(tradesLog, logLine);

      // Also save detailed JSON
      const detailedLog = path.join(logsDir, 'arbitrage-trades.json');
      let trades: any[] = [];

      if (await fs.pathExists(detailedLog)) {
        const content = await fs.readFile(detailedLog, 'utf8');
        trades = JSON.parse(content);
      }

      trades.push(logEntry);

      // Keep only last 1000 trades
      if (trades.length > 1000) {
        trades = trades.slice(-1000);
      }

      await fs.writeFile(detailedLog, JSON.stringify(trades, null, 2));

    } catch (error: any) {
      console.error(`⚠️ Failed to log trade: ${error.message}`);
    }
  }
}

// Start the runner if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new ArbitrageRunner();

  // Graceful shutdown handlers
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await runner.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await runner.stop();
    process.exit(0);
  });

  // Start the runner
  runner.start().catch((error) => {
    console.error('❌ Failed to start Enhanced Arbitrage Runner:', error);
    process.exit(1);
  });
}

export { ArbitrageRunner };
