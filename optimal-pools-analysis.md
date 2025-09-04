# Optimal Pools Analysis - GalaSwap Discovery Results

## Executive Summary
From our comprehensive discovery of **270 pool combinations**, we found **29 working pools** (10.7% success rate).

## Tier 1: High-Volume, Stable Pools (Best for Trend Strategy)
**Primary trading pools with good liquidity and consistent quotes:**

1. **GALA/GUSDC (10000bps)** ⭐⭐⭐
   - Quote: 1 GALA → 0.015633 GUSDC
   - Volume: High
   - Status: ✅ Most reliable pool
   - Perfect for trend strategy

2. **GUSDC/GALA (500bps)** ⭐⭐⭐
   - Quote: 1 GUSDC → 56.927 GALA
   - Volume: High
   - Status: ✅ Lower fee tier alternative
   - Excellent liquidity

3. **GALA/ETIME (3000bps & 10000bps)** ⭐⭐
   - 3000bps: 1 GALA → 3.8297 ETIME
   - 10000bps: 1 GALA → 3.1663 ETIME
   - Status: ✅ Consistent performer
   - Good for diversification

## Tier 2: Stablecoin Arbitrage Pools
**Low-risk arbitrage opportunities between stablecoins:**

4. **GUSDC/GUSDT (10000bps)** ⭐⭐
   - Quote: 1 GUSDC → 0.9895 GUSDT
   - Opportunity: 1.05% spread potential
   - Risk: Very low
   - Strategy: Stablecoin arbitrage

5. **GALA/GUSDT (10000bps)** ⭐⭐
   - Quote: 1 GALA → 0.015628 GUSDT
   - Similar to GUSDC pair
   - Good backup option

## Tier 3: ETH/BTC Pairs (Higher Risk/Reward)
**Higher volatility but potential for larger moves:**

6. **GALA/GWETH (10000bps)** ⭐
   - Quote: 1 GALA → 0.00000359 GWETH
   - High volatility potential
   - Note: Only works with 10000bps fee tier

7. **GWETH/GALA (10000bps)** ⭐
   - Quote: 1 GWETH → 237,521 GALA
   - Reverse of above
   - High impact trades

## Recommended Pool Strategy

### For Trend Strategy (Focus on 1-2 pools):
```json
"primaryPools": [
  "GALA/GUSDC",    // Main trading pair
  "GUSDC/GALA"     // Reverse direction
]
```

### For LiquiditySpider Strategy (Diversified):
```json
"spiderPools": [
  "GALA/GUSDC",    // Core pair
  "GALA/ETIME",    // Alternative
  "GUSDC/GUSDT",   // Stablecoin arb
  "GALA/GUSDT"     // Backup GALA pair
]
```

## Key Insights

1. **Fee Tier Patterns:**
   - GALA pairs mostly use 10000bps (1%)
   - ETIME pairs work with 3000bps (0.3%)
   - GWETH pairs ONLY work with 10000bps
   - BTC pairs need much higher minimums

2. **Liquidity Quality:**
   - GALA/GUSDC has best overall liquidity
   - Stablecoin pairs have tight spreads
   - ETH/BTC pairs have higher slippage

3. **Trading Recommendations:**
   - **Trend Strategy**: Focus on GALA/GUSDC for consistent execution
   - **Arbitrage**: Use stablecoin pairs for low-risk profits
   - **High Frequency**: Stick to Tier 1 pools only
   - **Diversification**: Add ETIME and GUSDT pairs

## Action Items

1. ✅ Update trend strategy to focus on GALA/GUSDC
2. ✅ Optimize fee tier selection (prioritize working tiers)
3. ✅ Reduce pool scanning to proven performers
4. ✅ Implement tier-based risk management
