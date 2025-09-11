#!/usr/bin/env node
/**
 * Test Strategy Runner
 * 
 * Runs only the test strategy for logging refinement and testing purposes.
 * This script will:
 * 1. Initialize the test strategy
 * 2. Run it in a loop every 30 seconds
 * 3. Log all activities for analysis
 */

import 'dotenv/config';
import { TestStrategy } from './src/strategies/test-strategy.js';
import { MarketCondition } from './src/types.js';

async function runTestStrategy() {
  console.log('🧪 Starting Test Strategy Runner for Logging Refinement');
  console.log('=' .repeat(60));

  // Initialize test strategy
  const testStrategy = new TestStrategy();
  
  // Create mock market condition (test strategy has very low requirements)
  const mockMarketCondition: MarketCondition = {
    volatility: 0.5,
    volume: 1.0, // Low volume is fine for test strategy
    competitionLevel: 'LOW',
    timeOfDay: new Date().getHours(),
    recentPerformance: 0.1
  };

  let executionCount = 0;
  const startTime = Date.now();

  console.log(`📊 Test Strategy Status:`, testStrategy.getStatus());
  console.log('');

  async function executeTestCycle() {
    executionCount++;
    const cycleStart = Date.now();
    
    console.log(`🔄 Test Cycle #${executionCount} - ${new Date().toISOString()}`);
    console.log('-'.repeat(50));

    try {
      // Check if strategy should activate
      const shouldActivate = testStrategy.shouldActivate(mockMarketCondition);
      console.log(`   ✅ Strategy activation check: ${shouldActivate}`);

      if (shouldActivate) {
        // Execute the strategy
        console.log(`   🚀 Executing test strategy...`);
        const result = await testStrategy.execute();
        
        console.log(`   📈 Execution result:`, {
          success: result.success,
          profit: result.profit,
          volume: result.volume,
          pool: result.pool,
          error: result.error || 'none'
        });

        // Log current status
        const status = testStrategy.getStatus();
        console.log(`   📊 Current status:`, status);
      } else {
        console.log(`   ⏸️ Strategy conditions not met`);
      }

    } catch (error: any) {
      console.error(`   ❌ Test cycle error:`, error.message);
    }

    const cycleTime = Date.now() - cycleStart;
    console.log(`   ⏱️ Cycle completed in ${cycleTime}ms`);
    console.log('');
  }

  // Run initial cycle
  await executeTestCycle();

  // Set up periodic execution every 30 seconds
  const intervalId = setInterval(async () => {
    await executeTestCycle();
  }, 30000); // 30 seconds

  // Graceful shutdown handling
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutdown signal received');
    clearInterval(intervalId);
    
    const totalRuntime = Date.now() - startTime;
    console.log(`📊 Test Strategy Runner Summary:`);
    console.log(`   • Total runtime: ${(totalRuntime / 1000 / 60).toFixed(1)} minutes`);
    console.log(`   • Total cycles: ${executionCount}`);
    console.log(`   • Final status:`, testStrategy.getStatus());
    console.log('🧪 Test Strategy Runner stopped');
    process.exit(0);
  });

  console.log('🔁 Test strategy running every 30 seconds...');
  console.log('💡 Press Ctrl+C to stop');
  console.log('📁 Check logs/test-strategy/ for detailed logs');
}

// Start the test runner
runTestStrategy().catch(error => {
  console.error('❌ Test Strategy Runner failed to start:', error);
  process.exit(1);
});
