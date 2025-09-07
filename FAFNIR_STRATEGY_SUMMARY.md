# 🏴‍☠️ Fafnir Treasure Hoarder

**Advanced RSI + Bollinger Bands strategy that combines momentum analysis with volatility detection for high-confidence trading opportunities.**

*"Patient hunter of market treasures - strikes decisively when technical conditions align"*

## 📊 Strategy Overview

The Fafnir Treasure Hoarder uses a dual-confirmation system combining RSI momentum signals with Bollinger Bands volatility analysis. This creates a disciplined approach that waits for high-probability setups rather than frequent trading.

## 🎯 Key Features

- **RSI Momentum Signals** - 35/65 thresholds optimized for DEX volatility
- **Bollinger Bands Analysis** - 20-period SMA with 2 standard deviations
- **Bollinger Squeeze Detection** - Avoids trading during low volatility periods
- **CoinGecko Integration** - Real-time accurate price data for analysis
- **Confidence-Based Sizing** - Full positions on 90%+ confidence, half on 60-89%
- **Smart Trade Cooldowns** - 5-minute minimum between trades per pair

## 📈 Performance Profile

| Metric | Target |
|--------|---------|
| **Daily Returns** | 1-3% |
| **Trades Per Day** | 2-4 selective trades |
| **Win Rate** | 70-85% |
| **Risk Level** | Medium |
| **Max Drawdown** | < 5% |
| **Hold Time** | 2-6 hours average |

## 🎲 Trading Logic

### Strong Buy Signal (90% Confidence)
- RSI < 35 **AND** Price ≤ Lower Bollinger Band
- **Action**: Full position size

### Moderate Buy Signal (60-65% Confidence)
- RSI < 35 **OR** Price ≤ Lower Band + RSI < 45
- **Action**: Half position size

### Strong Sell Signal (90% Confidence)
- RSI > 65 **AND** Price ≥ Upper Bollinger Band
- **Action**: Full position size

### Hold Conditions
- Bollinger Squeeze (bandwidth < 2%)
- Confidence < 60%
- Trade cooldown active
- Neutral RSI (35-65 range)

## 🎯 Ideal For

✅ **Conservative traders** seeking consistent returns
✅ **Quality over quantity** trading approach
✅ **Moderate to high volatility** markets
✅ **Users who prefer** technical analysis
✅ **Both trending and sideways** market conditions

## ⚠️ Considerations

- Requires sufficient market volatility (>1%) to activate
- May have fewer trades during low volatility periods
- Best performance in markets with clear technical patterns
- 5-minute cooldowns may miss rapid opportunities

## 🔧 Technical Specifications

- **Primary Indicator**: RSI (14-period)
- **Confirmation**: Bollinger Bands (20-period, 2σ)
- **Data Source**: CoinGecko + GalaSwap execution
- **Position Sizing**: Dynamic based on signal confidence
- **Risk Management**: Built-in cooldowns and squeeze detection

---

**Strategy Type**: Technical Analysis • Advanced • Medium Risk
**Best Markets**: GALA/GUSDC with moderate volatility
**Trading Style**: Patient, selective, high-confidence setups
