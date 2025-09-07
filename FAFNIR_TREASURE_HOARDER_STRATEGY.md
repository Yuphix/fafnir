# 🏴‍☠️ Fafnir Treasure Hoarder Strategy

## Overview

The **Fafnir Treasure Hoarder** is an advanced RSI + Bollinger Bands layered trading strategy designed specifically for GalaSwap DEX trading. This strategy combines momentum analysis (RSI) with volatility analysis (Bollinger Bands) to identify high-confidence trading opportunities while maintaining strict risk management.

## 🎯 Strategy Logic

### Primary Signal: RSI (Relative Strength Index)
- **Period**: 14 candles
- **BUY Signal**: RSI < 35 (adjusted for DEX volatility)
- **SELL Signal**: RSI > 65 (adjusted for DEX volatility)
- **NEUTRAL**: RSI between 35-65

### Confirmation Signal: Bollinger Bands
- **Period**: 20 candles (SMA)
- **Standard Deviations**: 2.0
- **BUY Confirmation**: Price touches or breaks below lower band
- **SELL Confirmation**: Price touches or breaks above upper band
- **Squeeze Detection**: Bandwidth < 2% (volatility compression)

## 🎲 Decision Matrix

| RSI Condition | Bollinger Condition | Action | Confidence | Position Size |
|---------------|-------------------|---------|------------|---------------|
| RSI < 35 | Price ≤ Lower Band | **STRONG BUY** | 90% | Full Position |
| RSI < 35 | Price in Middle | **WEAK BUY** | 60% | Half Position |
| RSI > 65 | Price ≥ Upper Band | **STRONG SELL** | 90% | Full Position |
| RSI > 65 | Price in Middle | **WEAK SELL** | 60% | Half Position |
| Any RSI | Bollinger Squeeze | **HOLD** | 50% | No Trade |

## ⚙️ Configuration Parameters

### Technical Indicators
```typescript
rsiPeriod: 14              // RSI calculation period
rsiOversold: 35            // RSI oversold threshold (DEX adjusted)
rsiOverbought: 65          // RSI overbought threshold (DEX adjusted)
bbPeriod: 20               // Bollinger Bands SMA period
bbStdDev: 2                // Standard deviations for bands
bbSqueezeThreshold: 0.02   // 2% bandwidth = squeeze detection
```

### Risk Management
```typescript
minConfidence: 0.6         // Minimum 60% confidence to trade
maxRiskPerTrade: 0.02      // Maximum 2% risk per trade
tradeCooldown: 300000      // 5 minutes between trades per pair
slippageBps: 100           // 1% slippage tolerance
minTradeAmount: 10         // Minimum $10 trades
maxTradeAmount: 1000       // Maximum $1000 trades
```

### Position Sizing
```typescript
strongSignal: 1.0          // Full position (90%+ confidence)
weakSignal: 0.5            // Half position (60-89% confidence)
testPosition: 0.25         // Quarter position (testing)
```

## 🚀 Key Features

### 1. **Multi-Confirmation Approach**
- Primary RSI momentum signals
- Bollinger Bands volatility confirmation
- Confidence scoring system (60%-90%)
- Squeeze detection prevents false breakouts

### 2. **Advanced Risk Management**
- Position sizing based on signal confidence
- Trade cooldown periods (5 minutes per pair)
- Maximum risk limits per trade (2%)
- Slippage protection

### 3. **DEX-Optimized Parameters**
- RSI thresholds adjusted for DEX volatility (35/65 vs traditional 30/70)
- Bollinger Bands calibrated for crypto market conditions
- Squeeze detection for low-volatility periods

### 4. **Comprehensive Logging**
- Real-time signal analysis logging
- Performance tracking and metrics
- Trade execution details
- Technical indicator values

## 📊 Technical Implementation

### Signal Generation Process

1. **Data Collection**: Gather price history (minimum 25 candles)
2. **RSI Calculation**: 14-period RSI with gain/loss averaging
3. **Bollinger Bands**: 20-period SMA with 2 standard deviations
4. **Signal Evaluation**: Apply decision matrix for confidence scoring
5. **Risk Assessment**: Calculate position size based on confidence
6. **Trade Execution**: Execute via GalaChainSwapAuth if criteria met

### Example Signal Output
```json
{
  "action": "BUY",
  "confidence": 0.9,
  "reasons": ["RSI oversold + Price at lower Bollinger Band"],
  "positionSize": 1.0,
  "indicators": {
    "rsi": 32.5,
    "bollingerBands": {
      "upper": 0.0245,
      "middle": 0.0238,
      "lower": 0.0231,
      "percentB": 0.15,
      "bandwidth": 0.0187
    }
  }
}
```

## 🐳 Usage Instructions

### 1. **Standalone Deployment**
```bash
# Deploy as dedicated container
docker-compose -f docker-compose.fafnir-treasure-hoarder.yml up -d

# Check logs
docker logs fafnir-treasure-hoarder-bot -f
```

### 2. **Multi-User Environment**
```javascript
// Assign strategy to user
POST /api/strategies/assign
{
  "walletAddress": "0x123...",
  "strategy": "fafnir-treasure-hoarder",
  "config": {
    "minConfidence": 0.7,
    "maxRiskPerTrade": 0.015
  }
}

// Check user status
GET /api/strategies/0x123.../status
```

### 3. **Strategy Manager Integration**
```bash
# Force strategy in existing container
export FORCE_STRATEGY=fafnir-treasure-hoarder
docker-compose up -d
```

## 📈 Performance Optimization

### Recommended Settings by Market Condition

#### **High Volatility Markets**
```typescript
rsiOversold: 40
rsiOverbought: 60
bbStdDev: 2.5
minConfidence: 0.7
```

#### **Low Volatility Markets**
```typescript
rsiOversold: 30
rsiOverbought: 70
bbStdDev: 1.5
minConfidence: 0.6
```

#### **Normal Markets** (Default)
```typescript
rsiOversold: 35
rsiOverbought: 65
bbStdDev: 2.0
minConfidence: 0.6
```

## 🛡️ Risk Management Features

### 1. **Confidence-Based Position Sizing**
- 90%+ confidence → Full position
- 70-89% confidence → 75% position
- 60-69% confidence → 50% position
- <60% confidence → No trade

### 2. **Trade Cooldown System**
- 5-minute cooldown between trades per pair
- Prevents overtrading and emotional decisions
- Allows market conditions to develop

### 3. **Bollinger Squeeze Protection**
- Detects low volatility periods (bandwidth < 2%)
- Holds positions during squeeze conditions
- Waits for volatility expansion before trading

### 4. **Slippage Protection**
- 1% default slippage tolerance
- Adjustable based on market conditions
- Protects against adverse price movements

## 🔧 Environment Variables

```bash
# Strategy Selection
FORCE_STRATEGY=fafnir-treasure-hoarder

# RSI Configuration
RSI_PERIOD=14
RSI_OVERSOLD=35
RSI_OVERBOUGHT=65

# Bollinger Bands Configuration
BB_PERIOD=20
BB_STD_DEV=2
BB_SQUEEZE_THRESHOLD=0.02

# Risk Management
MIN_CONFIDENCE=0.6
MAX_RISK_PER_TRADE=0.02
TRADE_COOLDOWN_MS=300000

# Execution Parameters
SLIPPAGE_BPS=100
MIN_TRADE_AMOUNT=10
MAX_TRADE_AMOUNT=1000
```

## 📋 Testing Recommendations

### 1. **Backtesting Phase**
- Test with at least 30 days of historical data
- Track win rate, profit factor, and maximum drawdown
- Optimize parameters for GalaSwap-specific behavior

### 2. **Paper Trading Phase**
- Run for 1 week without real money
- Log all signals and would-be results
- Validate signal accuracy and timing

### 3. **Live Testing Phase**
- Start with minimum position sizes
- Gradually increase based on performance
- Monitor and adjust parameters as needed

## 🎯 Expected Performance Characteristics

### **Strengths**
- Excellent performance in trending markets
- Strong risk-adjusted returns
- Low drawdown periods during consolidation
- High-confidence signals reduce false positives

### **Limitations**
- May underperform in highly choppy/sideways markets
- Requires sufficient volatility for signal generation
- 5-minute cooldowns may miss rapid opportunities
- Dependent on price history availability

## 🏴‍☠️ Fafnir's Treasure Detection

This strategy embodies Fafnir's legendary ability to detect and hoard treasure:

- **🔍 Treasure Detection**: RSI identifies undervalued/overvalued conditions
- **🛡️ Confirmation**: Bollinger Bands confirm the treasure's authenticity
- **⚖️ Wisdom**: Confidence scoring ensures only quality treasures are collected
- **🏰 Protection**: Risk management preserves the hoard from losses
- **⏰ Patience**: Cooldown periods prevent impulsive decisions

The dragon waits for the perfect moment to strike, ensuring maximum treasure accumulation with minimal risk! 🐉💎
