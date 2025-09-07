#!/usr/bin/env node

/**
 * Local Test Script for Fafnir Treasure Hoarder Strategy
 * This script tests the strategy without requiring full GalaChain connection
 */

import { FafnirTreasureHoarder } from './src/strategies/fafnir-treasure-hoarder.js';

console.log('🏴‍☠️ Testing Fafnir Treasure Hoarder Strategy Locally...\n');

// Mock GalaChainSwapAuth for testing
class MockGalaChainSwapAuth {
  async getBalances() {
    return {
      GALA: '1000.0',
      GUSDC: '500.0'
    };
  }

  async getQuote(amount, fromToken, toToken) {
    // Simulate realistic price quote
    const mockRate = fromToken === 'GUSDC' ? '0.0234' : '42.735';
    return {
      rate: mockRate,
      amountOut: (parseFloat(amount) * parseFloat(mockRate)).toString(),
      success: true
    };
  }

  async buyGALAWithGUSDC(amountGusdc, slippageBps) {
    console.log(`🛒 Mock BUY: ${amountGusdc} GUSDC -> GALA (slippage: ${slippageBps}bps)`);
    const mockAmountOut = (parseFloat(amountGusdc) * 42.735).toFixed(4);
    return {
      success: true,
      amountOut: mockAmountOut,
      transactionId: 'mock-tx-' + Date.now()
    };
  }

  async sellGALAForGUSDC(amountGala, slippageBps) {
    console.log(`💰 Mock SELL: ${amountGala} GALA -> GUSDC (slippage: ${slippageBps}bps)`);
    const mockAmountOut = (parseFloat(amountGala) * 0.0234).toFixed(2);
    return {
      success: true,
      amountOut: mockAmountOut,
      transactionId: 'mock-tx-' + Date.now()
    };
  }
}

// Mock market condition for testing
const mockMarketCondition = {
  volatility: 0.025,        // 2.5% volatility
  volume: 1500,             // Good volume
  competitionLevel: 'MEDIUM',
  timeOfDay: 14,            // 2 PM
  recentPerformance: 0.02   // 2% recent performance
};

async function testStrategy() {
  try {
    // Create strategy instance with mock auth
    const mockSwapAuth = new MockGalaChainSwapAuth();
    const strategy = new FafnirTreasureHoarder(mockSwapAuth);

    console.log('📋 Strategy Details:');
    console.log(`   Name: ${strategy.name}`);
    console.log(`   Min Volume Required: ${strategy.minVolumeRequired}`);
    console.log(`   Max Risk: ${(strategy.maxRisk * 100).toFixed(1)}%`);

    // Test shouldActivate method
    console.log('\n🎯 Testing Market Condition Activation:');
    const shouldActivate = strategy.shouldActivate(mockMarketCondition);
    console.log(`   Should Activate: ${shouldActivate ? '✅ YES' : '❌ NO'}`);
    console.log(`   Market Volatility: ${(mockMarketCondition.volatility * 100).toFixed(1)}%`);
    console.log(`   Market Volume: ${mockMarketCondition.volume}`);
    console.log(`   Competition Level: ${mockMarketCondition.competitionLevel}`);

    if (shouldActivate) {
      console.log('\n🚀 Executing Strategy Test...');

      // Execute the strategy multiple times to see different scenarios
      for (let i = 1; i <= 3; i++) {
        console.log(`\n--- Test Run #${i} ---`);

        const result = await strategy.execute();

        console.log(`📊 Result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
        console.log(`   Strategy: ${result.strategy}`);
        console.log(`   Pool: ${result.pool}`);
        console.log(`   Profit: ${result.profit.toFixed(4)}`);
        console.log(`   Volume: ${result.volume.toFixed(4)}`);
        console.log(`   Timestamp: ${new Date(result.timestamp).toLocaleTimeString()}`);

        if (result.error) {
          console.log(`   Error: ${result.error}`);
        }

        // Wait 2 seconds between runs
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log('\n🏴‍☠️ Fafnir Strategy Test Complete!');
    console.log('\n📝 Next Steps:');
    console.log('   1. ✅ Strategy compiles and runs without errors');
    console.log('   2. 🔄 Test with real GalaChain connection');
    console.log('   3. 🐳 Deploy via Docker container');
    console.log('   4. 🌐 Test via API endpoints');

  } catch (error) {
    console.error('💥 Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testStrategy().catch(console.error);
