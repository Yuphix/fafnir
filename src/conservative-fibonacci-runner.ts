import 'dotenv/config';
import { ConservativeFibonacciStrategy } from './strategies/conservative-fibonacci-strategy.js';

/**
 * Conservative Fibonacci Strategy Runner
 *
 * Runs the conservative Fibonacci strategy every 30 minutes
 * Perfect complement to the always-on Trend bot
 */

async function runConservativeFibonacci(): Promise<void> {
  console.log('🔢 Starting Conservative Fibonacci Strategy Runner...');

  const strategy = new ConservativeFibonacciStrategy();
  const intervalMs = Number(process.env.CFIB_POLL_INTERVAL_MS || 1800000); // 30 minutes

  console.log(`⏰ Will check for opportunities every ${intervalMs / 60000} minutes`);

  // Execute immediately on start
  console.log('🚀 Running initial check...');
  await executeStrategy(strategy);

  // Then run on interval
  setInterval(async () => {
    await executeStrategy(strategy);
  }, intervalMs);

  console.log('✅ Conservative Fibonacci Strategy is now running continuously');
}

async function executeStrategy(strategy: ConservativeFibonacciStrategy): Promise<void> {
  try {
    console.log('\n🔍 Conservative Fibonacci checking for opportunities...');
    const result = await strategy.execute();

    if (result.success) {
      console.log(`✅ Trade executed: $${result.profit.toFixed(4)} profit on ${result.pool}`);
    } else {
      console.log(`⏸️ No trade: ${result.error || 'No profitable opportunity'}`);
    }

    console.log(`📊 Volume: $${result.volume} | Strategy: ${result.strategy}`);

  } catch (error: any) {
    console.error(`❌ Strategy execution error: ${error.message}`);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down Conservative Fibonacci Strategy...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down Conservative Fibonacci Strategy...');
  process.exit(0);
});

// Start the runner
runConservativeFibonacci().catch(error => {
  console.error('💥 Fatal error in Conservative Fibonacci Runner:', error);
  process.exit(1);
});
