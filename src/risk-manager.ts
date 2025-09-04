import 'dotenv/config';
import fs from 'fs-extra';
import path from 'node:path';
import { galaSwapAuth } from './galachain-swap-auth.js';

/**
 * Comprehensive Risk Management System
 *
 * Provides portfolio-level risk controls, position sizing,
 * and dynamic risk adjustments based on market conditions.
 */

export interface RiskLimits {
  maxDailyLoss: number;
  maxPositionSize: number;
  maxPortfolioExposure: number;
  maxSlippage: number;
  maxConcurrentTrades: number;
  stopLossThreshold: number;
  dailyVolumeLimit: number;
  maxDrawdown: number;
}

export interface PositionInfo {
  token: string;
  amount: number;
  avgPrice: number;
  unrealizedPnL: number;
  timestamp: number;
}

export interface RiskMetrics {
  currentDrawdown: number;
  dailyPnL: number;
  totalExposure: number;
  activeTrades: number;
  riskScore: number; // 0-100
  maxRiskScore: number;
}

export class RiskManager {
  private riskLimits: RiskLimits;
  private positions: Map<string, PositionInfo> = new Map();
  private dailyStartBalance: number = 0;
  private lastResetDate: string = '';
  private emergencyStop: boolean = false;
  private riskLogFile: string;

  constructor() {
    // Initialize risk limits from environment or defaults
    this.riskLimits = {
      maxDailyLoss: Number(process.env.RISK_MAX_DAILY_LOSS || 50), // $50
      maxPositionSize: Number(process.env.RISK_MAX_POSITION_SIZE || 100), // $100 per position
      maxPortfolioExposure: Number(process.env.RISK_MAX_PORTFOLIO_EXPOSURE || 500), // $500 total
      maxSlippage: Number(process.env.RISK_MAX_SLIPPAGE || 300), // 3%
      maxConcurrentTrades: Number(process.env.RISK_MAX_CONCURRENT || 3),
      stopLossThreshold: Number(process.env.RISK_STOP_LOSS || 10), // 10% position loss
      dailyVolumeLimit: Number(process.env.RISK_DAILY_VOLUME_LIMIT || 1000), // $1000/day
      maxDrawdown: Number(process.env.RISK_MAX_DRAWDOWN || 20) // 20% max drawdown
    };

    // Setup risk logging
    const logDir = path.join(process.cwd(), 'logs');
    fs.ensureDirSync(logDir);
    this.riskLogFile = path.join(logDir, 'risk.log');

    // Initialize daily tracking
    this.initializeDailyTracking();

    console.log('🛡️ Risk Manager initialized with limits:', this.riskLimits);
  }

  /**
   * Check if a trade is allowed based on risk limits
   */
  async checkTradeAllowed(
    strategy: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    expectedSlippage: number
  ): Promise<{ allowed: boolean; reason?: string; adjustedAmount?: number }> {

    // Emergency stop check
    if (this.emergencyStop) {
      return { allowed: false, reason: 'Emergency stop activated' };
    }

    // Get current risk metrics
    const metrics = await this.getRiskMetrics();

    // Check daily loss limit
    if (metrics.dailyPnL <= -this.riskLimits.maxDailyLoss) {
      return { allowed: false, reason: `Daily loss limit exceeded: $${Math.abs(metrics.dailyPnL).toFixed(2)}` };
    }

    // Check maximum drawdown
    if (metrics.currentDrawdown >= this.riskLimits.maxDrawdown) {
      return { allowed: false, reason: `Maximum drawdown exceeded: ${metrics.currentDrawdown.toFixed(2)}%` };
    }

    // Check slippage tolerance
    if (expectedSlippage > this.riskLimits.maxSlippage) {
      return { allowed: false, reason: `Slippage too high: ${expectedSlippage.toFixed(2)}bps > ${this.riskLimits.maxSlippage}bps` };
    }

    // Check concurrent trades
    if (metrics.activeTrades >= this.riskLimits.maxConcurrentTrades) {
      return { allowed: false, reason: `Too many concurrent trades: ${metrics.activeTrades}` };
    }

    // Check and adjust position size
    const adjustedAmount = this.calculateOptimalPositionSize(amountIn, tokenOut, metrics);

    if (adjustedAmount === 0) {
      return { allowed: false, reason: 'Position size would exceed limits' };
    }

    // Check total exposure
    const newExposure = metrics.totalExposure + adjustedAmount;
    if (newExposure > this.riskLimits.maxPortfolioExposure) {
      return { allowed: false, reason: `Portfolio exposure limit exceeded: $${newExposure.toFixed(2)}` };
    }

    // Check risk score
    if (metrics.riskScore > metrics.maxRiskScore) {
      return { allowed: false, reason: `Risk score too high: ${metrics.riskScore}/100` };
    }

    this.logRiskDecision('ALLOWED', strategy, tokenIn, tokenOut, amountIn, adjustedAmount, metrics);

    return {
      allowed: true,
      adjustedAmount: adjustedAmount !== amountIn ? adjustedAmount : undefined
    };
  }

  /**
   * Calculate optimal position size based on risk parameters
   */
  private calculateOptimalPositionSize(
    requestedAmount: number,
    token: string,
    metrics: RiskMetrics
  ): number {
    // Kelly Criterion inspired sizing with conservative adjustments
    let optimalSize = requestedAmount;

    // Reduce size based on current risk level
    const riskAdjustment = 1 - (metrics.riskScore / 200); // Max 50% reduction
    optimalSize *= riskAdjustment;

    // Ensure we don't exceed position limits
    optimalSize = Math.min(optimalSize, this.riskLimits.maxPositionSize);

    // Ensure we don't exceed available exposure
    const availableExposure = this.riskLimits.maxPortfolioExposure - metrics.totalExposure;
    optimalSize = Math.min(optimalSize, availableExposure);

    // Account for existing position in this token
    const existingPosition = this.positions.get(token);
    if (existingPosition) {
      const maxAdditional = this.riskLimits.maxPositionSize - existingPosition.amount;
      optimalSize = Math.min(optimalSize, maxAdditional);
    }

    return Math.max(0, optimalSize);
  }

  /**
   * Update position after trade execution
   */
  async updatePosition(
    token: string,
    amount: number,
    price: number,
    isAdd: boolean
  ): Promise<void> {
    const existing = this.positions.get(token);

    if (isAdd) {
      if (existing) {
        // Update existing position with weighted average price
        const totalAmount = existing.amount + amount;
        const avgPrice = (existing.avgPrice * existing.amount + price * amount) / totalAmount;

        this.positions.set(token, {
          token,
          amount: totalAmount,
          avgPrice,
          unrealizedPnL: existing.unrealizedPnL,
          timestamp: Date.now()
        });
      } else {
        // New position
        this.positions.set(token, {
          token,
          amount,
          avgPrice: price,
          unrealizedPnL: 0,
          timestamp: Date.now()
        });
      }
    } else {
      // Reduce or close position
      if (existing) {
        const newAmount = Math.max(0, existing.amount - amount);
        if (newAmount === 0) {
          this.positions.delete(token);
        } else {
          this.positions.set(token, {
            ...existing,
            amount: newAmount,
            timestamp: Date.now()
          });
        }
      }
    }

    // Check for stop-loss triggers
    await this.checkStopLosses();
  }

  /**
   * Check for stop-loss triggers and emergency conditions
   */
  private async checkStopLosses(): Promise<void> {
    for (const [token, position] of this.positions) {
      // Calculate unrealized P&L (would need current price feed)
      // For now, we'll implement basic threshold checks

      const positionLossPercent = Math.abs(position.unrealizedPnL) / (position.amount * position.avgPrice) * 100;

      if (positionLossPercent > this.riskLimits.stopLossThreshold) {
        console.log(`🚨 Stop-loss triggered for ${token}: ${positionLossPercent.toFixed(2)}% loss`);
        this.logRiskEvent('STOP_LOSS_TRIGGERED', token, position);

        // In a real implementation, we'd execute the stop-loss trade here
        // For now, we'll just log and remove the position
        this.positions.delete(token);
      }
    }
  }

  /**
   * Get current risk metrics
   */
  async getRiskMetrics(): Promise<RiskMetrics> {
    const profitData = await galaSwapAuth.calculateTotalProfit();

    // Calculate current portfolio exposure
    let totalExposure = 0;
    for (const position of this.positions.values()) {
      totalExposure += position.amount * position.avgPrice;
    }

    // Calculate drawdown (simplified)
    const currentBalance = this.dailyStartBalance + profitData.totalProfit;
    const maxBalance = Math.max(this.dailyStartBalance, currentBalance);
    const currentDrawdown = ((maxBalance - currentBalance) / maxBalance) * 100;

    // Calculate risk score (0-100)
    let riskScore = 0;
    riskScore += Math.min(30, (totalExposure / this.riskLimits.maxPortfolioExposure) * 30); // 30% for exposure
    riskScore += Math.min(25, (currentDrawdown / this.riskLimits.maxDrawdown) * 25); // 25% for drawdown
    riskScore += Math.min(20, (profitData.totalTrades / 100) * 20); // 20% for activity
    riskScore += Math.min(25, Math.abs(profitData.totalProfit) / this.riskLimits.maxDailyLoss * 25); // 25% for P&L volatility

    return {
      currentDrawdown,
      dailyPnL: profitData.totalProfit,
      totalExposure,
      activeTrades: this.positions.size,
      riskScore: Math.min(100, riskScore),
      maxRiskScore: 75 // Don't allow trades above 75% risk score
    };
  }

  /**
   * Initialize daily tracking
   */
  private initializeDailyTracking(): void {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      this.dailyStartBalance = 1000; // Would get from actual balance
      this.lastResetDate = today;
      this.logRiskEvent('DAILY_RESET', 'SYSTEM', { startBalance: this.dailyStartBalance });
    }
  }

  /**
   * Activate emergency stop
   */
  activateEmergencyStop(reason: string): void {
    this.emergencyStop = true;
    console.log(`🚨 EMERGENCY STOP ACTIVATED: ${reason}`);
    this.logRiskEvent('EMERGENCY_STOP', 'SYSTEM', { reason });
  }

  /**
   * Deactivate emergency stop
   */
  deactivateEmergencyStop(): void {
    this.emergencyStop = false;
    console.log(`✅ Emergency stop deactivated`);
    this.logRiskEvent('EMERGENCY_STOP_CLEARED', 'SYSTEM', {});
  }

  /**
   * Generate risk report
   */
  async generateRiskReport(): Promise<string> {
    const metrics = await this.getRiskMetrics();

    const report = [
      '🛡️ RISK MANAGEMENT REPORT',
      '========================',
      '',
      '📊 Current Metrics:',
      `   Daily P&L: $${metrics.dailyPnL.toFixed(2)}`,
      `   Current Drawdown: ${metrics.currentDrawdown.toFixed(2)}%`,
      `   Total Exposure: $${metrics.totalExposure.toFixed(2)}`,
      `   Active Positions: ${metrics.activeTrades}`,
      `   Risk Score: ${metrics.riskScore.toFixed(1)}/100`,
      '',
      '🔒 Risk Limits:',
      `   Max Daily Loss: $${this.riskLimits.maxDailyLoss}`,
      `   Max Position Size: $${this.riskLimits.maxPositionSize}`,
      `   Max Portfolio Exposure: $${this.riskLimits.maxPortfolioExposure}`,
      `   Max Slippage: ${this.riskLimits.maxSlippage}bps`,
      `   Max Concurrent Trades: ${this.riskLimits.maxConcurrentTrades}`,
      '',
      '📈 Active Positions:',
      ...Array.from(this.positions.values()).map(pos =>
        `   ${pos.token}: ${pos.amount.toFixed(4)} @ $${pos.avgPrice.toFixed(6)} (P&L: $${pos.unrealizedPnL.toFixed(2)})`
      ),
      '',
      `🚨 Emergency Stop: ${this.emergencyStop ? 'ACTIVE' : 'Inactive'}`,
      ''
    ];

    return report.join('\n');
  }

  /**
   * Log risk decisions and events
   */
  private logRiskDecision(
    decision: string,
    strategy: string,
    tokenIn: string,
    tokenOut: string,
    requestedAmount: number,
    adjustedAmount: number,
    metrics: RiskMetrics
  ): void {
    const logEntry = [
      `[${new Date().toISOString()}]`,
      `RISK_DECISION: ${decision}`,
      `Strategy: ${strategy}`,
      `Trade: ${requestedAmount} ${tokenIn} → ${tokenOut}`,
      `Adjusted: ${adjustedAmount}`,
      `Risk Score: ${metrics.riskScore.toFixed(1)}/100`,
      `Daily P&L: $${metrics.dailyPnL.toFixed(2)}`
    ].join(' | ');

    fs.appendFileSync(this.riskLogFile, logEntry + '\n');
  }

  private logRiskEvent(event: string, token: string, data: any): void {
    const logEntry = [
      `[${new Date().toISOString()}]`,
      `RISK_EVENT: ${event}`,
      `Token: ${token}`,
      `Data: ${JSON.stringify(data)}`
    ].join(' | ');

    fs.appendFileSync(this.riskLogFile, logEntry + '\n');
  }
}

// Export singleton
export const riskManager = new RiskManager();
