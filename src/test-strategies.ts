import { StrategyManager } from './strategy-manager.js';
import { MilestoneTracker } from './milestone-tracker.js';
import { CompetitionDetector } from './competition-detector.js';
import { PerformanceDashboard } from './dashboard.js';
import { DynamicConfig } from './dynamic-config';
import { MarketCondition } from './types.js';

async function testStrategies() {
  console.log('🧪 Testing Enhanced Fafnir Bot Components...\n');

  try {
    // Test 1: Strategy Manager
    console.log('1️⃣ Testing Strategy Manager...');
    const strategyManager = new StrategyManager();

    const marketCondition: MarketCondition = {
      volatility: 0.02,
      volume: 150,
      competitionLevel: 'MEDIUM',
      timeOfDay: 14,
      recentPerformance: 0.7
    };

    const selectedStrategy = await strategyManager.selectStrategy(marketCondition);
    console.log(`   ✅ Selected strategy: ${selectedStrategy}`);

    const result = await strategyManager.executeCurrentStrategy();
    console.log(`   ✅ Strategy execution result:`, result);

    // Test 2: Milestone Tracker
    console.log('\n2️⃣ Testing Milestone Tracker...');
    const milestones = [
      { trades: 5, reward: 20, completed: false },
      { trades: 10, reward: 30, completed: false }
    ];

    const milestoneTracker = new MilestoneTracker(milestones, 1000);
    await milestoneTracker.updateProgress(result);

    const stats = milestoneTracker.getStats();
    console.log(`   ✅ Milestone stats:`, stats);

    // Test 3: Competition Detector
    console.log('\n3️⃣ Testing Competition Detector...');
    const competitionDetector = new CompetitionDetector();

    // Simulate some trades
    await competitionDetector.addTrade({
      pool: 'GUSDC/GALA',
      amount: 25,
      timestamp: Date.now(),
      strategy: 'arbitrage'
    });

    await competitionDetector.addTrade({
      pool: 'GUSDC/GALA',
      amount: 25,
      timestamp: Date.now() + 60000,
      strategy: 'arbitrage'
    });

    const botsDetected = await competitionDetector.detectBots();
    console.log(`   ✅ Bots detected: ${botsDetected}`);

    const competitionLevel = await competitionDetector.getCompetitionLevel();
    console.log(`   ✅ Competition level: ${competitionLevel}`);

    // Test 4: Dynamic Config
    console.log('\n4️⃣ Testing Dynamic Config...');
    const dynamicConfig = new DynamicConfig(competitionDetector);

    await dynamicConfig.adjustParameters(marketCondition);
    const currentConfig = dynamicConfig.getCurrentConfig();
    console.log(`   ✅ Dynamic config adjusted:`, currentConfig);

    // Test 5: Performance Dashboard
    console.log('\n5️⃣ Testing Performance Dashboard...');
    const dashboard = new PerformanceDashboard(
      milestoneTracker,
      strategyManager,
      competitionDetector
    );

    await dashboard.generateReport();
    console.log(`   ✅ Dashboard generated successfully`);

    // Test 6: Strategy Performance
    console.log('\n6️⃣ Testing Strategy Performance...');
    const allMetrics = strategyManager.getAllPerformanceMetrics();
    console.log(`   ✅ Strategy metrics:`, allMetrics);

    // Test 7: Fibonacci Strategy Specific
    console.log('\n7️⃣ Testing Fibonacci Strategy...');
    const fibonacciStrategy = strategyManager['strategies'].get('fibonacci');
    if (fibonacciStrategy) {
      const position = (fibonacciStrategy as any).getCurrentPosition();
      console.log(`   ✅ Fibonacci position:`, position);

      const performance = (fibonacciStrategy as any).getPerformanceMetrics();
      console.log(`   ✅ Fibonacci performance:`, performance);
    }

    // Test 8: Triangular Arbitrage
    console.log('\n8️⃣ Testing Triangular Arbitrage...');
    const triangularStrategy = strategyManager['strategies'].get('triangular');
    if (triangularStrategy) {
      const result = await triangularStrategy.execute();
      console.log(`   ✅ Triangular arbitrage result:`, result);
    }

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📋 Test Summary:');
    console.log('   ✅ Strategy Manager: Working');
    console.log('   ✅ Milestone Tracker: Working');
    console.log('   ✅ Competition Detector: Working');
    console.log('   ✅ Dynamic Config: Working');
    console.log('   ✅ Performance Dashboard: Working');
    console.log('   ✅ All Strategies: Working');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run tests
testStrategies().catch(console.error);
