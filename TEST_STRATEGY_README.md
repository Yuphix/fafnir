# Test Strategy for Logging Refinement

## Overview

The Test Strategy is a simple trading bot designed specifically for testing and refining the logging system. It performs predictable, small-scale trades to generate consistent log data for analysis and system improvement.

## Strategy Behavior

### Trading Pattern
- **Buy**: $1 worth of GALA with GUSDC every 15 minutes
- **Sell**: Converts GALA back to GUSDC 5 minutes after purchase
- **Target Pair**: GALA/GUSDC only
- **Trade Size**: Fixed $1 USD per trade

### Timing
- **Buy Interval**: 15 minutes (900 seconds)
- **Sell Delay**: 5 minutes (300 seconds) after buy
- **Total Cycle**: 20 minutes from buy to next buy

## Features

### Enhanced Logging
- **Detailed Method Logs**: Every operation is logged with context
- **Error Tracking**: Separate error logs with stack traces
- **Performance Metrics**: Trade execution timing and results
- **Price Tracking**: Real-time GALA price monitoring

### Safety Features
- **Dry Run Mode**: Default safety mode (set `TEST_STRATEGY_DRY_RUN=false` to enable real trades)
- **Low Risk**: Very small trade amounts
- **Conservative Slippage**: 1% slippage tolerance
- **Error Handling**: Comprehensive error catching and logging

## Log Files

The strategy creates detailed logs in `logs/test-strategy/`:

- `test-strategy.log` - All operations and info logs
- `test-strategy-errors.log` - Error logs with stack traces

### Log Format
```json
{
  "timestamp": "2025-09-10T...",
  "strategy": "test-strategy",
  "level": "INFO|ERROR",
  "method": "executeBuy|executeSell|getGalaPrice",
  "message": "Description of operation",
  "data": { /* relevant data */ },
  "wallet": "wallet_address",
  "dryRun": true|false
}
```

## Running the Test Strategy

### Option 1: Standalone Test Runner
```bash
# Using the dedicated test runner
./start-test-strategy.ps1
```

### Option 2: Via API (Multi-User System)
```bash
# Assign test strategy to your wallet via API
curl -X POST http://localhost:3000/api/strategies/assign \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "eth|YOUR_WALLET_ADDRESS",
    "strategy": "test-strategy",
    "config": {}
  }'
```

### Option 3: Force Strategy Environment Variable
```bash
# Set environment variable to force test strategy
export FORCE_STRATEGY=test-strategy
node src/api-server.js
```

## Configuration

### Environment Variables
```bash
# Test strategy specific
TEST_STRATEGY_DRY_RUN=true          # Enable/disable dry run mode

# Required for real trades
GALACHAIN_PRIVATE_KEY=your_key      # Your GalaChain private key
GALACHAIN_WALLET_ADDRESS=your_addr  # Your GalaChain wallet address

# GSwap configuration
GSWAP_GATEWAY_URL=https://gateway-mainnet.galachain.com
GSWAP_DEX_BACKEND_URL=https://dex-backend-prod1.defi.gala.com
GSWAP_BUNDLER_URL=https://bundle-backend-prod1.defi.gala.com
```

## Status Monitoring

The test strategy provides detailed status information:

```javascript
{
  name: "test-strategy",
  lastBuyTime: "2025-09-10T...",     // When last buy occurred
  pendingSells: 2,                    // Number of pending sell orders
  nextBuyIn: 450000,                  // Milliseconds until next buy
  tradeCounter: 15,                   // Total number of trades executed
  dryRun: true,                       // Current dry run status
  testAmount: 1.0,                    // USD amount per trade
  targetPair: "GALA/GUSDC"           // Trading pair
}
```

## Use Cases

### 1. Logging System Development
- Generate consistent log data for analysis
- Test log parsing and aggregation systems
- Develop log-based alerts and monitoring

### 2. Infrastructure Testing
- Test API endpoints under regular load
- Validate database logging and storage
- Test WebSocket real-time updates

### 3. Trading System Validation
- Verify swap execution pipelines
- Test error handling and recovery
- Validate transaction tracking

### 4. Performance Analysis
- Measure system latency and throughput
- Monitor resource usage patterns
- Identify bottlenecks in trading flow

## Expected Log Output Examples

### Successful Buy Operation
```
🧪 [TEST-STRATEGY:executeBuy] Starting buy operation { tradeId: 'test-1-1694361234567', amount: 1 }
🧪 [TEST-STRATEGY:getGalaPrice] Price retrieved { galaPrice: 0.02156, quoteAmountOut: 46.395 }
🧪 [TEST-STRATEGY:executeBuy] DRY RUN: Simulating GUSDC -> GALA swap { symbolIn: 'GUSDC', symbolOut: 'GALA', amountIn: 1, expectedAmountOut: '46.395000' }
🧪 [TEST-STRATEGY:executeBuy] Buy completed, sell scheduled { sellScheduledAt: '2025-09-10T...', pendingSellsCount: 1 }
```

### Successful Sell Operation
```
🧪 [TEST-STRATEGY:executeSell] Starting sell operation { tradeId: 'test-1-1694361234567', galaAmount: '46.395000' }
🧪 [TEST-STRATEGY:executeSell] Current price data for sell { currentPrice: 0.02164, priceChange: '0.37%', estimatedProfit: '0.004' }
🧪 [TEST-STRATEGY:executeSell] DRY RUN: Simulating GALA -> GUSDC swap { expectedAmountOut: '1.004000', estimatedProfit: '0.004' }
🧪 [TEST-STRATEGY:executeSell] Sell completed - trade cycle finished { cycleProfit: '0.004', totalCycleTime: '5 minutes' }
```

## Integration with Main System

The test strategy is fully integrated with the Fafnir Bot system:

- ✅ Available in strategy manager
- ✅ Accessible via API endpoints
- ✅ Real-time WebSocket updates
- ✅ Performance tracking
- ✅ User session management

## Safety Notes

⚠️ **Important Safety Information**:

1. **Default Dry Run**: The strategy defaults to dry run mode for safety
2. **Small Amounts**: Even in live mode, trades are limited to $1
3. **Test Environment**: Designed for testing, not profit generation
4. **Rate Limited**: Built-in delays prevent excessive API calls

This test strategy provides a safe, controlled environment for refining your trading system's logging and monitoring capabilities while generating realistic usage patterns.
