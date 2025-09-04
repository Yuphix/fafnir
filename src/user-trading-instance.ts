import { MultiWalletManager, TradingPermission, TradeRequest, TradeApproval } from './multi-wallet-manager.js';
import { TokenBalance } from '@gala-chain/api';
// import { TradingStrategy } from './interfaces/trading-strategy.js'; // Will be implemented
import { ArbitrageStrategy } from './strategies/arbitrage-strategy.js';
import crypto from 'crypto';

/**
 * Individual Trading Instance for Each User
 * Manages trading operations for a specific user's wallet with their permissions
 */

export interface UserTradingConfig {
  walletAddress: string;
  enabledStrategies: string[];
  riskLevel: 'conservative' | 'moderate' | 'aggressive';
  maxDailyVolume: number;
  autoApprove: boolean;          // If true, auto-approve trades within limits
  autoApproveLimit: number;      // Auto-approve trades under this USD amount
  profitThreshold: number;       // Minimum profit threshold (basis points)
  stopLossThreshold: number;     // Stop loss threshold (basis points)
}

export interface UserTradeResult {
  success: boolean;
  tradeId: string;
  txHash?: string;
  profit?: number;
  error?: string;
  timestamp: Date;
}

export class UserTradingInstance {
  private walletAddress: string;
  private walletManager: MultiWalletManager;
  private permissions: TradingPermission[];
  private config: UserTradingConfig;
  private strategies: Map<string, any> = new Map(); // Will use proper TradingStrategy interface later
  private isActive: boolean = false;
  private lastBalanceCheck: Date = new Date();
  private currentBalances: TokenBalance[] = [];

  constructor(
    walletAddress: string,
    walletManager: MultiWalletManager,
    permissions: TradingPermission[],
    config: UserTradingConfig
  ) {
    this.walletAddress = walletAddress;
    this.walletManager = walletManager;
    this.permissions = permissions;
    this.config = config;

    this.initializeStrategies();
    console.log(`🤖 Trading instance created for ${walletAddress}`);
  }

  /**
   * Initialize trading strategies based on user permissions
   */
  private initializeStrategies(): void {
    // Get unique strategies from all permissions
    const allowedStrategies = new Set<string>();
    this.permissions.forEach(permission => {
      permission.strategies.forEach(strategy => allowedStrategies.add(strategy));
    });

    // Initialize each allowed strategy
    allowedStrategies.forEach(strategyName => {
      if (this.config.enabledStrategies.includes(strategyName)) {
        try {
          switch (strategyName) {
            case 'arbitrage':
              this.strategies.set('arbitrage', new ArbitrageStrategy());
              break;
            case 'fibonacci':
              // Import and initialize fibonacci strategy
              // this.strategies.set('fibonacci', new FibonacciStrategy());
              break;
            // Add more strategies as needed
          }
          console.log(`✅ Strategy '${strategyName}' initialized for ${this.walletAddress}`);
        } catch (error) {
          console.error(`❌ Failed to initialize strategy '${strategyName}':`, error);
        }
      }
    });
  }

  /**
   * Start trading for this user
   */
  async start(): Promise<void> {
    if (this.isActive) {
      console.log(`⚠️  Trading already active for ${this.walletAddress}`);
      return;
    }

    try {
      // Update wallet balances
      await this.updateWalletBalances();

      // Validate permissions are still active
      await this.validatePermissions();

      this.isActive = true;
      console.log(`🚀 Trading started for ${this.walletAddress}`);

      // Start trading loop
      this.startTradingLoop();

    } catch (error) {
      console.error(`❌ Failed to start trading for ${this.walletAddress}:`, error);
      throw error;
    }
  }

  /**
   * Stop trading for this user
   */
  async stop(): Promise<void> {
    this.isActive = false;
    console.log(`🛑 Trading stopped for ${this.walletAddress}`);
  }

  /**
   * Main trading loop
   */
  private async startTradingLoop(): Promise<void> {
    while (this.isActive) {
      try {
        // Update balances periodically
        if (Date.now() - this.lastBalanceCheck.getTime() > 60000) { // Every minute
          await this.updateWalletBalances();
        }

        // Execute trading strategies
        for (const [strategyName, strategy] of this.strategies) {
          if (this.isActive) {
            await this.executeStrategy(strategyName, strategy);
          }
        }

        // Wait before next iteration
        await this.sleep(30000); // 30 seconds

          } catch (error: any) {
      console.error(`❌ Trading loop error for ${this.walletAddress}:`, error);
      await this.sleep(60000); // Wait longer on error
    }
    }
  }

  /**
   * Execute a specific trading strategy
   */
  private async executeStrategy(strategyName: string, strategy: any): Promise<void> {
    try {
      console.log(`🔄 Executing ${strategyName} strategy for ${this.walletAddress}`);

      // Get strategy recommendations
      const recommendations = await strategy.analyze();

      if (!recommendations || recommendations.length === 0) {
        return;
      }

      // Process each trade recommendation
      for (const recommendation of recommendations) {
        if (!this.isActive) break;

        await this.processTradeRecommendation(recommendation, strategyName);
      }

    } catch (error: any) {
      console.error(`❌ Strategy execution failed for ${strategyName}:`, error);
    }
  }

  /**
   * Process a trade recommendation from a strategy
   */
  private async processTradeRecommendation(recommendation: any, strategyName: string): Promise<void> {
    try {
      // Create trade request
      const tradeRequest: TradeRequest = {
        id: crypto.randomUUID(),
        walletAddress: this.walletAddress,
        tokenIn: recommendation.tokenIn,
        tokenOut: recommendation.tokenOut,
        amountIn: recommendation.amountIn,
        amountUSD: recommendation.amountUSD,
        strategy: strategyName,
        slippageTolerance: recommendation.slippageTolerance || 100, // 1%
        timestamp: new Date()
      };

      // Validate trade against permissions
      if (!this.validateTradeRequest(tradeRequest)) {
        console.log(`⚠️  Trade rejected - insufficient permissions: ${tradeRequest.tokenIn}→${tradeRequest.tokenOut}`);
        return;
      }

      // Check if auto-approval is enabled and trade is under limit
      if (this.config.autoApprove && tradeRequest.amountUSD <= this.config.autoApproveLimit) {
        // Auto-approve small trades
        const approval: TradeApproval = {
          tradeId: tradeRequest.id,
          approved: true,
          timestamp: new Date(),
          userAddress: this.walletAddress
        };

        await this.executeTrade(tradeRequest, approval);
      } else {
        // Request user approval
        await this.requestUserApproval(tradeRequest);
      }

    } catch (error) {
      console.error(`❌ Failed to process trade recommendation:`, error);
    }
  }

  /**
   * Validate trade request against user permissions
   */
  private validateTradeRequest(trade: TradeRequest): boolean {
    // Use wallet manager's validation
    return this.walletManager.validateTradePermission(this.walletAddress, trade);
  }

  /**
   * Request approval from user for a trade
   */
  private async requestUserApproval(trade: TradeRequest): Promise<void> {
    try {
      console.log(`📝 Requesting approval for trade: ${trade.amountUSD} USD ${trade.tokenIn}→${trade.tokenOut}`);

      // Request approval through wallet manager
      const approval = await this.walletManager.requestTradeApproval(trade);

      if (approval.approved) {
        await this.executeTrade(trade, approval);
      } else {
        console.log(`❌ Trade rejected by user: ${trade.id}`);
      }

    } catch (error) {
      console.error(`❌ Trade approval failed:`, error);
    }
  }

  /**
   * Execute the actual trade
   */
  private async executeTrade(trade: TradeRequest, approval: TradeApproval): Promise<UserTradeResult> {
    try {
      console.log(`🔄 Executing trade for ${this.walletAddress}: ${trade.amountIn} ${trade.tokenIn} → ${trade.tokenOut}`);

      // Execute trade through wallet manager
      const result = await this.walletManager.executeTradeWithUserWallet(trade, approval);

      const tradeResult: UserTradeResult = {
        success: true,
        tradeId: trade.id,
        txHash: result.transactionHash,
        profit: this.calculateProfit(result),
        timestamp: new Date()
      };

      console.log(`✅ Trade executed successfully: ${tradeResult.txHash}`);

      // Update balances after successful trade
      await this.updateWalletBalances();

      return tradeResult;

        } catch (error: any) {
      console.error(`❌ Trade execution failed:`, error);

      return {
        success: false,
        tradeId: trade.id,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Update wallet balances
   */
  private async updateWalletBalances(): Promise<void> {
    try {
      this.currentBalances = await this.walletManager.getUserWalletBalances(this.walletAddress);
      this.lastBalanceCheck = new Date();

      console.log(`💰 Updated balances for ${this.walletAddress}: ${this.currentBalances.length} tokens`);

    } catch (error) {
      console.error(`❌ Failed to update balances for ${this.walletAddress}:`, error);
    }
  }

  /**
   * Validate that permissions are still active
   */
  private async validatePermissions(): Promise<void> {
    const now = new Date();
    let validPermissions = 0;

    this.permissions = this.permissions.filter(permission => {
      if (!permission.isActive || permission.expiryDate < now) {
        console.log(`⚠️  Permission expired: ${permission.tokenPair}`);
        return false;
      }
      validPermissions++;
      return true;
    });

    if (validPermissions === 0) {
      console.log(`❌ No valid permissions remaining for ${this.walletAddress}`);
      await this.stop();
      throw new Error('No valid trading permissions');
    }

    console.log(`✅ ${validPermissions} valid permissions for ${this.walletAddress}`);
  }

  /**
   * Get current status of this trading instance
   */
  getStatus() {
    return {
      walletAddress: this.walletAddress,
      isActive: this.isActive,
      enabledStrategies: Array.from(this.strategies.keys()),
      permissions: this.permissions.length,
      validPermissions: this.permissions.filter(p => p.isActive && p.expiryDate > new Date()).length,
      currentBalances: this.currentBalances.length,
      lastBalanceCheck: this.lastBalanceCheck,
      config: this.config
    };
  }

  /**
   * Update trading configuration
   */
  updateConfig(newConfig: Partial<UserTradingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log(`⚙️  Configuration updated for ${this.walletAddress}`);
  }

  /**
   * Add new trading permission
   */
  addPermission(permission: TradingPermission): void {
    this.permissions.push(permission);
    console.log(`✅ Permission added for ${this.walletAddress}: ${permission.tokenPair}`);
  }

  /**
   * Revoke a trading permission
   */
  revokePermission(tokenPair: string): void {
    this.permissions = this.permissions.map(p =>
      p.tokenPair === tokenPair ? { ...p, isActive: false } : p
    );
    console.log(`❌ Permission revoked for ${this.walletAddress}: ${tokenPair}`);
  }

  // Private helper methods
  private calculateProfit(tradeResult: any): number {
    // Calculate profit based on trade result
    // This would depend on the specific result format from GalaChain
    return tradeResult.profit || 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default UserTradingInstance;
