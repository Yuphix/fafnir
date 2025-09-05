import { TradingStrategy, MarketCondition, TradeResult } from '../types.js';
import fs from 'fs-extra';
import path from 'node:path';
import { GSwap } from '@gala-chain/gswap-sdk';
import { GalaChainSwapAuth } from '../galachain-swap-auth.js';
import { riskManager } from '../risk-manager.js';
import { createPerformanceOptimizer } from '../performance-optimizer.js';
import { StrategyAdvisor } from '../advisor.js';
import { crossDexMonitor, CrossDexOpportunity } from '../cross-dex-monitor.js';

/**
 * Liquidity Spider Strategy
 *
 * Hunts for liquidity imbalances across multiple low-volume pools
 * by deploying small amounts across many pools simultaneously.
 * Perfect for low-volume DEX environments.
 */

interface PoolOpportunity {
  tokenA: string;
  tokenB: string;
  feeTier: number;
  imbalanceScore: number;
  expectedProfit: number;
  liquidityDepth: number;
  lastTradeTime: number;
  riskAdjustedScore: number;
}

interface SpiderPosition {
  pool: string;
  tokenIn: string;
  tokenOut: string;
  amount: number;          // Original GUSDC amount invested
  tokenOutAmount: number;  // Actual tokens received (e.g. GWBTC amount)
  entryPrice: number;
  timestamp: number;
  targetProfit: number;
  stopLoss: number;
}

export class LiquiditySpiderStrategy implements TradingStrategy {
  private wallet: string | undefined;
  name = 'liquidity-spider';
  minVolumeRequired = 1; // Very low minimum for micro opportunities
  maxRisk = 0.3; // Conservative risk per position

  private gswap: GSwap;
  private swapAuth: GalaChainSwapAuth;
  private performanceOptimizer: any;
  private advisor: StrategyAdvisor;
  private activePositions: Map<string, SpiderPosition> = new Map();
  private poolTargets: string[];
  private maxPositions: number;
  private basePositionSize: number;
  private profitTarget: number; // Target profit in bps
  private stopLoss: number; // Stop loss in bps
  private scanInterval: number;
  private lastScan: number = 0;
  private lastAdvisorCheck: number = 0;
  private advisorInterval: number;
  private useAdvisorGuidance: boolean;
  private lastCrossDexCheck: number = 0;
  private crossDexInterval: number;
  private useCrossDexOpportunities: boolean;
  private dryRun: boolean;

  constructor(walletAddress?: string) {
    this.wallet = walletAddress || process.env.GALACHAIN_WALLET_ADDRESS || process.env.GSWAP_WALLET || process.env.GSWAP_WALLET_ADDRESS;
    // Initialize GSwap client
    const gatewayUrl = process.env.GSWAP_GATEWAY_URL || 'https://gateway-mainnet.galachain.com';
    const dexBackendUrl = process.env.GSWAP_DEX_BACKEND_URL || 'https://dex-backend-prod1.defi.gala.com';
    const bundlerUrl = process.env.GSWAP_BUNDLER_URL || 'https://bundle-backend-prod1.defi.gala.com';

    this.gswap = new GSwap({
      gatewayBaseUrl: gatewayUrl,
      dexBackendBaseUrl: dexBackendUrl,
      bundlerBaseUrl: bundlerUrl,
      dexContractBasePath: '/api/asset/dexv3-contract',
      tokenContractBasePath: '/api/asset/token-contract',
      bundlingAPIBasePath: '/bundle'
    });

    this.swapAuth = new GalaChainSwapAuth();
    this.performanceOptimizer = createPerformanceOptimizer(this.gswap);
    this.advisor = new StrategyAdvisor(this.gswap);

    // Strategy configuration
    this.maxPositions = Number(process.env.SPIDER_MAX_POSITIONS || 8);
    this.basePositionSize = Number(process.env.SPIDER_POSITION_SIZE || 5); // $5 per position
    this.profitTarget = Number(process.env.SPIDER_PROFIT_TARGET || 200); // 2% target
    this.stopLoss = Number(process.env.SPIDER_STOP_LOSS || 100); // 1% stop loss
    this.scanInterval = Number(process.env.SPIDER_SCAN_INTERVAL || 30000); // 30 seconds
    this.advisorInterval = Number(process.env.SPIDER_ADVISOR_INTERVAL || 120000); // 2 minutes
    this.useAdvisorGuidance = String(process.env.SPIDER_USE_ADVISOR || 'true').toLowerCase() === 'true';
    this.crossDexInterval = Number(process.env.SPIDER_CROSSDEX_INTERVAL || 300000); // 5 minutes
    this.useCrossDexOpportunities = String(process.env.SPIDER_USE_CROSSDEX || 'true').toLowerCase() === 'true';
    this.dryRun = String(process.env.SPIDER_DRY_RUN || 'true').toLowerCase() !== 'false';

    // Define target pools for scanning (verified working pools from discovery)
    this.poolTargets = [
      'GALA/GUSDC',   // 10000bps - High volume
      'GALA/ETIME',   // 3000bps  - Working well
      'GALA/GUSDT',   // 10000bps - Stable pair
      'GUSDC/GUSDT',  // 10000bps - Stablecoin arbitrage
      'GALA/GWETH',   // 10000bps - ETH pair (note: 10000bps, not 3000bps!)
      'GUSDC/GWETH'   // 10000bps - ETH/USD pair
    ];

    console.log(`🕷️ Liquidity Spider initialized: ${this.poolTargets.length} pools, max ${this.maxPositions} positions`);
  }

  shouldActivate(marketCondition: MarketCondition): boolean {
    // Spider strategy works in any market condition but prefers lower volatility
    // for easier liquidity detection
    return marketCondition.volume > 10 && marketCondition.volatility < 0.08;
  }

    async execute(): Promise<TradeResult> {
    try {
      console.log(`🕷️ Spider strategy scanning ${this.poolTargets.length} pools for opportunities...`);

      // Check AI advisor for market guidance
      const advisorGuidance = await this.getAdvisorGuidance();

      // Check cross-DEX opportunities
      const crossDexOpportunities = await this.getCrossDexOpportunities();

      // Scan for new opportunities
      const opportunities = await this.scanLiquidityOpportunities();

      // Apply advisor filtering if available
      const filteredOpportunities = await this.applyAdvisorGuidance(opportunities, advisorGuidance);

      // Manage existing positions
      await this.manageExistingPositions();

      // Execute new positions if we have capacity and good opportunities
      let executed = false;
      let totalProfit = 0;
      let totalVolume = 0;

      if (this.activePositions.size < this.maxPositions && filteredOpportunities.length > 0) {
        const result = await this.executeSpiderPositions(filteredOpportunities);
        executed = result.executed;
        totalProfit = result.profit;
        totalVolume = result.volume;
      }

      // Calculate overall strategy performance
      const positionProfits = await this.calculatePositionProfits();
      totalProfit += positionProfits.unrealizedPnL;

      return {
        success: executed || this.activePositions.size > 0,
        profit: totalProfit,
        volume: totalVolume,
        strategy: this.name,
        pool: `${this.activePositions.size} positions | ${filteredOpportunities.length} pool | ${crossDexOpportunities.length} cross-DEX`,
        timestamp: Date.now()
      };

    } catch (error: any) {
      return {
        success: false,
        profit: 0,
        volume: 0,
        strategy: this.name,
        pool: 'error',
        timestamp: Date.now(),
        error: error.message || 'Unknown spider strategy error'
      };
    }
  }

  /**
   * Scan multiple pools for liquidity imbalances and opportunities
   */
  private async scanLiquidityOpportunities(): Promise<PoolOpportunity[]> {
    const now = Date.now();

    // Don't scan too frequently
    if (now - this.lastScan < this.scanInterval) {
      return [];
    }

    console.log(`🔍 Scanning ${this.poolTargets.length} pools for liquidity imbalances...`);

    const scanPromises = this.poolTargets.map(async (poolPair) => {
      try {
        const [tokenA, tokenB] = poolPair.split('/');
        return await this.analyzePoolLiquidity(tokenA, tokenB);
      } catch (error) {
        return null;
      }
    });

    const results = await Promise.allSettled(scanPromises);
    const opportunities = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => (r as PromiseFulfilledResult<PoolOpportunity>).value)
      .filter(opp => opp.riskAdjustedScore > 5) // Minimum score threshold
      .sort((a, b) => b.riskAdjustedScore - a.riskAdjustedScore); // Best first

    this.lastScan = now;
    console.log(`🎯 Found ${opportunities.length} potential opportunities`);

    return opportunities.slice(0, 5); // Top 5 opportunities
  }

  /**
   * Analyze a specific pool for liquidity imbalances
   */
  private async analyzePoolLiquidity(tokenA: string, tokenB: string): Promise<PoolOpportunity | null> {
    try {
      const tA = this.getTokenString(tokenA);
      const tB = this.getTokenString(tokenB);

      // Use base position size for all pools
      const testAmount = this.basePositionSize;
      const testAmountStr = testAmount.toString();

      // Get quotes in both directions to detect imbalances
      const [forwardQuote, reverseQuote] = await Promise.all([
        this.performanceOptimizer.getOptimizedQuote(tA, tB, testAmountStr),
        this.performanceOptimizer.getOptimizedQuote(tB, tA, testAmountStr)
      ]);

      if (!forwardQuote || !reverseQuote) return null;

      const forwardOutput = Number(forwardQuote.outTokenAmount?.toString() ?? forwardQuote.outTokenAmount);
      const reverseOutput = Number(reverseQuote.outTokenAmount?.toString() ?? reverseQuote.outTokenAmount);

      // Calculate implied prices and detect imbalances
      const forwardPrice = forwardOutput / testAmount;
      const reversePrice = testAmount / reverseOutput;
      const priceImbalance = Math.abs(forwardPrice - reversePrice) / forwardPrice;

      // Calculate potential arbitrage profit
      const arbitrageProfit = reverseOutput - testAmount;
      const profitBps = Math.round((arbitrageProfit / testAmount) * 10000);

      // Score the opportunity
      const liquidityDepth = Math.min(forwardOutput, reverseOutput);
      const imbalanceScore = priceImbalance * 10000; // Convert to bps

      // Risk-adjusted scoring
      let riskScore = 0;
      riskScore += Math.min(20, profitBps / 5); // Profit component (max 20 points)
      riskScore += Math.min(15, imbalanceScore / 10); // Imbalance component (max 15 points)
      riskScore += Math.min(10, liquidityDepth / 100); // Liquidity component (max 10 points)
      riskScore -= Math.max(0, (Date.now() - this.lastScan) / 60000); // Freshness penalty

      if (riskScore < 5) return null; // Too low quality

      return {
        tokenA,
        tokenB,
        feeTier: forwardQuote.feeTier || 3000,
        imbalanceScore,
        expectedProfit: arbitrageProfit,
        liquidityDepth,
        lastTradeTime: Date.now(),
        riskAdjustedScore: riskScore
      };

    } catch (error) {
      return null;
    }
  }

  /**
   * Execute spider positions on best opportunities
   */
  private async executeSpiderPositions(opportunities: PoolOpportunity[]): Promise<{
    executed: boolean;
    profit: number;
    volume: number;
  }> {
    let totalProfit = 0;
    let totalVolume = 0;
    let executed = false;

    for (const opp of opportunities.slice(0, this.maxPositions - this.activePositions.size)) {
      try {
        // Risk management check
        const riskCheck = await riskManager.checkTradeAllowed(
          this.name,
          this.getTokenString(opp.tokenA),
          this.getTokenString(opp.tokenB),
          this.basePositionSize,
          100 // 1% slippage for spider positions
        );

        if (!riskCheck.allowed) {
          console.log(`🛑 Spider position blocked: ${riskCheck.reason}`);
          continue;
        }

        // Use base position size for all pools
        const positionSize = riskCheck.adjustedAmount || this.basePositionSize;

        if (this.dryRun) {
          console.log(`🕷️ DRY RUN: Would open spider position ${opp.tokenA}→${opp.tokenB}, size: $${positionSize}, score: ${opp.riskAdjustedScore.toFixed(1)}`);

          // Simulate position - get realistic token amount for dry run
          const mockQuote = await this.performanceOptimizer.getOptimizedQuote(
            this.getTokenString(opp.tokenA),
            this.getTokenString(opp.tokenB),
            positionSize.toString()
          ).catch(() => ({ expectedAmountOut: opp.expectedProfit.toString() }));

          const tokenOutAmount = Number(mockQuote.expectedAmountOut || opp.expectedProfit);

          const positionKey = `${opp.tokenA}/${opp.tokenB}`;
          this.activePositions.set(positionKey, {
            pool: positionKey,
            tokenIn: opp.tokenA,
            tokenOut: opp.tokenB,
            amount: positionSize,
            tokenOutAmount: tokenOutAmount,
            entryPrice: positionSize / tokenOutAmount,
            timestamp: Date.now(),
            targetProfit: opp.expectedProfit,
            stopLoss: positionSize * (this.stopLoss / 10000)
          });

          executed = true;
          totalVolume += positionSize;
          continue;
        }

        // Execute real spider position
        console.log(`🕷️ Opening spider position: ${opp.tokenA}→${opp.tokenB}, size: $${positionSize}`);

        const swapResult = await this.swapAuth.executeSwap({
          tokenIn: this.getTokenString(opp.tokenA),
          tokenOut: this.getTokenString(opp.tokenB),
          amountIn: positionSize.toString(),
          amountOutMinimum: (opp.expectedProfit * 0.95).toString(), // 5% slippage tolerance
          feeTier: opp.feeTier,
          recipient: process.env.GALACHAIN_WALLET_ADDRESS || '',
          slippageBps: 100
        });

        if (swapResult.success) {
          const tokenOutAmount = Number(swapResult.actualAmountOut || opp.expectedProfit);
          const positionKey = `${opp.tokenA}/${opp.tokenB}`;
          this.activePositions.set(positionKey, {
            pool: positionKey,
            tokenIn: opp.tokenA,
            tokenOut: opp.tokenB,
            amount: positionSize,
            tokenOutAmount: tokenOutAmount,
            entryPrice: positionSize / tokenOutAmount,
            timestamp: Date.now(),
            targetProfit: opp.expectedProfit,
            stopLoss: positionSize * (this.stopLoss / 10000)
          });

          console.log(`✅ Spider position opened: ${swapResult.transactionId}`);
          executed = true;
          totalVolume += positionSize;

          // Update position in risk manager
          await riskManager.updatePosition(
            opp.tokenB,
            Number(swapResult.actualAmountOut || opp.expectedProfit),
            1, // Price (simplified)
            true // Adding position
          );
        }

      } catch (error: any) {
        console.log(`❌ Spider position failed: ${error.message}`);
      }
    }

    return { executed, profit: totalProfit, volume: totalVolume };
  }

  /**
   * Manage existing spider positions
   */
  private async manageExistingPositions(): Promise<void> {
    for (const [key, position] of this.activePositions) {
      try {
        // Check if position should be closed (profit target or stop loss)
        const currentProfit = await this.calculatePositionProfit(position);
        const profitBps = (currentProfit / position.amount) * 10000;

        let shouldClose = false;
        let reason = '';

        if (profitBps >= this.profitTarget) {
          shouldClose = true;
          reason = `Profit target hit: ${profitBps.toFixed(0)}bps`;
        } else if (profitBps <= -this.stopLoss) {
          shouldClose = true;
          reason = `Stop loss hit: ${profitBps.toFixed(0)}bps`;
        } else if (Date.now() - position.timestamp > 3600000) { // 1 hour max hold
          shouldClose = true;
          reason = 'Maximum hold time reached';
        }

        if (shouldClose) {
          await this.closeSpiderPosition(key, position, reason);
        }

      } catch (error: any) {
        console.log(`❌ Error managing position ${key}: ${error.message}`);
      }
    }
  }

  /**
   * Close a spider position
   */
  private async closeSpiderPosition(key: string, position: SpiderPosition, reason: string): Promise<void> {
    try {
      console.log(`🕷️ Closing spider position ${key}: ${reason}`);

      if (this.dryRun) {
        console.log(`🕷️ DRY RUN: Would close position ${key}`);
        this.activePositions.delete(key);
        return;
      }

      // Execute close trade
      const closeResult = await this.swapAuth.executeSwap({
        tokenIn: this.getTokenString(position.tokenOut),
        tokenOut: this.getTokenString(position.tokenIn),
        amountIn: position.amount.toString(),
        amountOutMinimum: (position.amount * 0.95).toString(), // Accept up to 5% slippage on close
        feeTier: 3000, // Default fee tier
        recipient: process.env.GALACHAIN_WALLET_ADDRESS || '',
        slippageBps: 200 // Higher slippage tolerance for exits
      });

      if (closeResult.success) {
        console.log(`✅ Spider position closed: ${closeResult.transactionId}`);

        // Update risk manager
        await riskManager.updatePosition(
          position.tokenOut,
          position.amount,
          1,
          false // Removing position
        );
      }

      this.activePositions.delete(key);

    } catch (error: any) {
      console.log(`❌ Error closing spider position: ${error.message}`);
    }
  }

  /**
   * Calculate profit for a specific position
   */
  private async calculatePositionProfit(position: SpiderPosition): Promise<number> {
    try {
      // Get current market value by asking: "How much GUSDC would I get for my actual tokenOut amount?"
      const quote = await this.performanceOptimizer.getOptimizedQuote(
        this.getTokenString(position.tokenOut),
        this.getTokenString(position.tokenIn),
        position.tokenOutAmount.toString()  // Use actual token amount, not dollar amount!
      );

      const currentValueInGUSDC = Number(quote.expectedAmountOut || 0);
      const profit = currentValueInGUSDC - position.amount;  // Compare current value vs original investment

      // Debug logging for dry run
      if (this.dryRun) {
        console.log(`   💰 Position ${position.tokenIn}→${position.tokenOut}: $${position.amount} → ${position.tokenOutAmount.toFixed(6)} ${position.tokenOut} → $${currentValueInGUSDC.toFixed(2)} (profit: $${profit.toFixed(2)})`);
      }

      return profit;

    } catch (error) {
      console.log(`❌ Error calculating profit for ${position.tokenIn}/${position.tokenOut}: ${error}`);
      return -position.amount * 0.01; // Assume small 1% loss if we can't calculate
    }
  }

  /**
   * Calculate profits for all positions
   */
  private async calculatePositionProfits(): Promise<{
    unrealizedPnL: number;
    totalPositions: number;
    averageHoldTime: number;
  }> {
    let totalUnrealized = 0;
    let totalHoldTime = 0;
    const now = Date.now();

    for (const position of this.activePositions.values()) {
      const profit = await this.calculatePositionProfit(position);
      totalUnrealized += profit;
      totalHoldTime += now - position.timestamp;
    }

    return {
      unrealizedPnL: totalUnrealized,
      totalPositions: this.activePositions.size,
      averageHoldTime: this.activePositions.size > 0 ? totalHoldTime / this.activePositions.size : 0
    };
  }

  /**
   * Check for cross-DEX arbitrage opportunities
   */
  private async getCrossDexOpportunities(): Promise<CrossDexOpportunity[]> {
    const now = Date.now();

    if (!this.useCrossDexOpportunities ||
        (now - this.lastCrossDexCheck) < this.crossDexInterval) {
      return [];
    }

    try {
      console.log(`🌐 Checking cross-DEX opportunities...`);

      // Get current GalaChain prices for comparison
      const galaChainPrices = new Map<string, number>();

      for (const poolPair of ['GALA/GUSDC']) {
        try {
          const [tokenA, tokenB] = poolPair.split('/');
          const quote = await this.performanceOptimizer.getOptimizedQuote(
            this.getTokenString(tokenA),
            this.getTokenString(tokenB),
            '1'
          );

          if (quote) {
            const price = Number(quote.outTokenAmount?.toString() ?? quote.outTokenAmount);
            galaChainPrices.set(tokenA, price);
          }
        } catch (error) {
          // Skip if quote fails
        }
      }

      const opportunities = await crossDexMonitor.findCrossDexOpportunities(
        galaChainPrices,
        150 // 1.5% minimum profit for cross-DEX
      );

      this.lastCrossDexCheck = now;

      if (opportunities.length > 0) {
        console.log(`🚨 Found ${opportunities.length} cross-DEX arbitrage opportunities!`);
        opportunities.slice(0, 3).forEach(opp => {
          console.log(`   ${opp.token}: ${opp.profitBps.toFixed(0)}bps via ${opp.exchange} (~$${opp.estimatedProfit.toFixed(2)})`);
        });
      }

      return opportunities;

    } catch (error: any) {
      console.log(`⚠️ Cross-DEX check failed: ${error.message}`);
      this.lastCrossDexCheck = now; // Don't retry immediately
      return [];
    }
  }

  /**
   * Get AI advisor guidance for market conditions
   */
  private async getAdvisorGuidance(): Promise<string | null> {
    const now = Date.now();

    // Check if we should query advisor (every 10 minutes by default)
    if (!this.useAdvisorGuidance ||
        !this.advisor.isEnabled ||
        (now - this.lastAdvisorCheck) < this.advisorInterval) {
      return null;
    }

    try {
      console.log(`🧠 Consulting AI advisor for market guidance...`);

      // Create advisor query with spider-specific context
      const spiderPairs = this.poolTargets.map(pair => {
        const [tokenA, tokenB] = pair.split('/');
        return {
          symbolIn: tokenA,
          symbolOut: tokenB,
          amountIn: this.basePositionSize.toString()
        };
      });

      const guidance = await this.advisor.advise(spiderPairs, 100); // 1% slippage for spider
      this.lastAdvisorCheck = now;

      if (guidance) {
        console.log(`🎯 AI Advisor recommends: ${guidance.toUpperCase()}`);
        return guidance;
      }

      return null;
    } catch (error: any) {
      console.log(`⚠️ Advisor consultation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Apply advisor guidance to filter and prioritize opportunities
   */
  private async applyAdvisorGuidance(
    opportunities: PoolOpportunity[],
    guidance: string | null
  ): Promise<PoolOpportunity[]> {
    // First, filter out recently failed positions to prevent loss loops
    const recentlyFailed = new Set<string>();
    for (const [key, position] of this.activePositions) {
      try {
        const currentProfit = await this.calculatePositionProfit(position);
        const lossPercentage = (currentProfit / position.amount) * 100;

        if (lossPercentage < -0.5) { // 0.5% loss threshold (very conservative)
          const pairKey = `${position.tokenIn}/${position.tokenOut}`;
          recentlyFailed.add(pairKey);
          console.log(`🚫 Avoiding ${pairKey} due to ${lossPercentage.toFixed(1)}% loss`);
        }
      } catch (error) {
        // If we can't calculate profit, assume it's bad and avoid
        const pairKey = `${position.tokenIn}/${position.tokenOut}`;
        recentlyFailed.add(pairKey);
        console.log(`🚫 Avoiding ${pairKey} due to calculation error`);
      }
    }

    // Filter out failed pairs
    opportunities = opportunities.filter(opp => {
      const pairKey = `${opp.tokenA}/${opp.tokenB}`;
      const reversePairKey = `${opp.tokenB}/${opp.tokenA}`;
      return !recentlyFailed.has(pairKey) && !recentlyFailed.has(reversePairKey);
    });

    if (!guidance || !this.useAdvisorGuidance) {
      return opportunities;
    }

    console.log(`🧠 AI Advisor guidance: ${guidance.toUpperCase()}`);

    // Add special handling for "avoid" and "hold" guidance
    if (guidance.toLowerCase() === 'avoid' || guidance.toLowerCase() === 'hold') {
      console.log(`⏸️ Advisor recommends ${guidance.toUpperCase()}: Avoiding all new positions`);
      return []; // Return empty array to avoid all trades
    }

    // Apply advisor-based filtering and scoring adjustments
    const adjustedOpportunities = opportunities.map(opp => {
      let adjustedScore = opp.riskAdjustedScore;

      switch (guidance.toLowerCase()) {
        case 'arbitrage':
          // Favor opportunities with higher imbalance scores (good for arbitrage)
          if (opp.imbalanceScore > 50) { // 0.5% price imbalance
            adjustedScore *= 1.3; // 30% bonus
            console.log(`🎯 Advisor boost: ${opp.tokenA}/${opp.tokenB} (arbitrage-friendly)`);
          }
          break;

        case 'fibonacci':
          // Favor opportunities with steady liquidity (good for trend following)
          if (opp.liquidityDepth > 20 && opp.imbalanceScore < 30) {
            adjustedScore *= 1.2; // 20% bonus
            console.log(`📈 Advisor boost: ${opp.tokenA}/${opp.tokenB} (trend-friendly)`);
          }
          break;

        case 'triangular':
          // Favor opportunities that could be part of triangular paths
          const hasTriangularPotential = this.checkTriangularPotential(opp);
          if (hasTriangularPotential) {
            adjustedScore *= 1.4; // 40% bonus
            console.log(`🔺 Advisor boost: ${opp.tokenA}/${opp.tokenB} (triangular potential)`);
          }
          break;
      }

      return { ...opp, riskAdjustedScore: adjustedScore };
    });

    // Re-sort by adjusted scores
    const filtered = adjustedOpportunities
      .sort((a, b) => b.riskAdjustedScore - a.riskAdjustedScore)
      .slice(0, Math.ceil(opportunities.length * 0.8)); // Keep top 80%

    console.log(`🧠 Advisor filtering: ${opportunities.length} → ${filtered.length} opportunities (guidance: ${guidance})`);
    return filtered;
  }

  /**
   * Check if an opportunity has triangular arbitrage potential
   */
  private checkTriangularPotential(opp: PoolOpportunity): boolean {
    // Check if we can form triangular paths with this pair
    const { tokenA, tokenB } = opp;

    // Look for potential third tokens that form triangles
    const bridgeTokens = ['GUSDC', 'GALA'];

    for (const bridge of bridgeTokens) {
      if (bridge !== tokenA && bridge !== tokenB) {
        // Check if we have pools for both legs of the triangle
        const hasFirstLeg = this.poolTargets.some(pool =>
          pool === `${tokenA}/${bridge}` || pool === `${bridge}/${tokenA}`
        );
        const hasSecondLeg = this.poolTargets.some(pool =>
          pool === `${bridge}/${tokenB}` || pool === `${tokenB}/${bridge}`
        );

        if (hasFirstLeg && hasSecondLeg) {
          return true;
        }
      }
    }

    return false;
  }

  private getTokenString(symbol: string): string {
    const TOKENS: Record<string, string> = {
      GALA: 'GALA|Unit|none|none',
      GUSDC: 'GUSDC|Unit|none|none',
      GWETH: 'GWETH|Unit|none|none',
      GWBTC: 'GWBTC|Unit|none|none',
      GUSDT: 'GUSDT|Unit|none|none',
      SILK: 'SILK|Unit|none|none',
      ETIME: 'ETIME|Unit|none|none'
    };

    const token = TOKENS[symbol];
    if (!token) throw new Error(`Unknown token symbol: ${symbol}`);
    return token;
  }
}
