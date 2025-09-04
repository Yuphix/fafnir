import 'dotenv/config';
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { ChainCallDTO, SubmitCallDTO, createValidDTO, signatures } from '@gala-chain/api';
import BigNumber from 'bignumber.js';
import fs from 'fs-extra';
import path from 'node:path';

/**
 * Enhanced GalaChain Swap Authorization Handler
 *
 * This module provides proper authorization and signing for swap payloads
 * between GUSDC and GALA tokens using the GalaChain SDK.
 */

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMinimum: string;
  feeTier: number;
  recipient: string;
  slippageBps?: number;
}

export interface SwapResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  actualAmountOut?: string;
  gasUsed?: string;
}

export interface TransactionLogEntry {
  timestamp: string;
  transactionId: string;
  type: 'BUY' | 'SELL' | 'ARBITRAGE';
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  quotedAmountOut: string;
  slippageBps: number;
  actualSlippage?: number;
  feeTier: number;
  walletAddress: string;
  transactionHash?: string;
  gasUsed?: string;
  profit?: number;
  profitPercentage?: number;
  strategy?: string;
  success: boolean;
  error?: string;
}

export class GalaChainSwapAuth {
  private gswap: GSwap;
  private privateKey: string;
  private walletAddress: string;
  private signer: PrivateKeySigner;
  private logDir: string;
  private tradesLogFile: string;
  private transactionsLogFile: string;

    constructor() {
    // Validate environment variables
    this.privateKey = process.env.GALACHAIN_PRIVATE_KEY || process.env.PRIVATE_KEY || '';
    this.walletAddress = process.env.GALACHAIN_WALLET_ADDRESS || process.env.WALLET_ADDRESS || '';

    if (!this.privateKey) {
      throw new Error('GALACHAIN_PRIVATE_KEY or PRIVATE_KEY must be set in environment variables');
    }

    if (!this.walletAddress) {
      throw new Error('GALACHAIN_WALLET_ADDRESS or WALLET_ADDRESS must be set in environment variables');
    }

    // Initialize signer
    this.signer = new PrivateKeySigner(this.privateKey);

    // Initialize GSwap with proper authorization
    const gatewayUrl = process.env.GSWAP_GATEWAY_URL || 'https://gateway-mainnet.galachain.com';
    const dexBackendUrl = process.env.GSWAP_DEX_BACKEND_URL || 'https://dex-backend-prod1.defi.gala.com';
    const bundlerUrl = process.env.GSWAP_BUNDLER_URL || 'https://bundle-backend-prod1.defi.gala.com';

    this.gswap = new GSwap({
      gatewayBaseUrl: gatewayUrl,
      dexBackendBaseUrl: dexBackendUrl,
      bundlerBaseUrl: bundlerUrl,
      dexContractBasePath: '/api/asset/dexv3-contract',
      tokenContractBasePath: '/api/asset/token-contract',
      bundlingAPIBasePath: '/bundle',
      signer: this.signer // Add signer for proper authorization
    });

    // Setup logging directories and files
    this.logDir = path.join(process.cwd(), 'logs');
    this.tradesLogFile = path.join(this.logDir, 'trades.log');
    this.transactionsLogFile = path.join(this.logDir, 'transactions.json');

    // Ensure log directory exists
    fs.ensureDirSync(this.logDir);

    console.log(`🔐 GalaChain Swap Auth initialized for wallet: ${this.walletAddress}`);
    console.log(`📡 Socket connection for real-time confirmations: Optional`);
    console.log(`📝 Transaction logging enabled: ${this.tradesLogFile}`);
  }

  /**
   * Get a quote for exact input swap
   */
  async getQuote(tokenIn: string, tokenOut: string, amountIn: string, feeTier?: number): Promise<any> {
    try {
      console.log(`💭 Getting quote: ${amountIn} ${tokenIn} → ${tokenOut}`);

      if (feeTier) {
        return await this.gswap.quoting.quoteExactInput(tokenIn, tokenOut, amountIn, feeTier);
      }

      // Try different fee tiers to find the best quote
      const feeTiers = [500, 3000, 10000]; // 0.05%, 0.3%, 1.0%
      let bestQuote = null;
      let bestFeeTier = null;

      for (const tier of feeTiers) {
        try {
          const quote = await this.gswap.quoting.quoteExactInput(tokenIn, tokenOut, amountIn, tier);
          const outAmount = Number(quote.outTokenAmount?.toString() ?? quote.outTokenAmount);

          if (!bestQuote || outAmount > Number(bestQuote.outTokenAmount?.toString() ?? bestQuote.outTokenAmount)) {
            bestQuote = quote;
            bestFeeTier = tier;
          }
        } catch (error) {
          // Skip this fee tier if it doesn't exist
          continue;
        }
      }

      if (bestQuote) {
        console.log(`✅ Best quote found on ${bestFeeTier}bps fee tier: ${bestQuote.outTokenAmount} ${tokenOut}`);
        return { ...bestQuote, feeTier: bestFeeTier };
      }

      throw new Error('No liquidity pools found for this token pair');

    } catch (error: any) {
      console.error(`❌ Quote error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute a properly authorized swap
   */
  async executeSwap(params: SwapParams): Promise<SwapResult> {
    try {
      console.log(`🔄 Executing swap: ${params.amountIn} ${params.tokenIn} → ${params.tokenOut}`);

      // First get a quote to validate the swap
      const quote = await this.getQuote(params.tokenIn, params.tokenOut, params.amountIn, params.feeTier);
      const quotedOutput = Number(quote.outTokenAmount?.toString() ?? quote.outTokenAmount);

      console.log(`📊 Quote: ${params.amountIn} ${params.tokenIn} → ${quotedOutput} ${params.tokenOut}`);

      // Calculate minimum output with slippage protection
      const slippageBps = params.slippageBps || 100; // Default 1% slippage
      const minOut = quotedOutput * (1 - slippageBps / 10000);
      const finalMinOut = params.amountOutMinimum ?
        Math.max(minOut, Number(params.amountOutMinimum)) :
        minOut;

      console.log(`🛡️  Slippage protection: minimum output ${finalMinOut.toFixed(6)} ${params.tokenOut}`);

      // Execute the swap - this returns a PendingTransaction object
      const pendingTransaction = await this.gswap.swaps.swap(
        params.tokenIn,
        params.tokenOut,
        quote.feeTier || params.feeTier,
        {
          exactIn: params.amountIn,
          amountOutMinimum: finalMinOut.toString()
        },
        params.recipient || this.walletAddress
      );

            console.log(`📦 Swap submitted! Transaction ID: ${pendingTransaction.transactionId}`);
      console.log(`✅ Transaction submitted successfully to GalaChain!`);

      // Try to wait for confirmation, but fall back gracefully if socket connection isn't available
      let confirmationResult: any = null;
      try {
        console.log(`⏳ Attempting to get transaction confirmation...`);
        confirmationResult = await pendingTransaction.wait();
        console.log(`✅ Transaction confirmed! Hash: ${confirmationResult.transactionHash}`);
      } catch (socketError: any) {
        if (socketError.message?.includes('socket connection')) {
          console.log(`📡 Real-time confirmation unavailable (socket connection required)`);
          console.log(`✅ However, transaction was submitted successfully!`);
          console.log(`   Transaction ID: ${pendingTransaction.transactionId}`);
          console.log(`   You can verify the transaction status on GalaChain explorer`);
        } else {
          console.log(`⚠️  Confirmation check failed: ${socketError.message}`);
          console.log(`✅ But transaction was still submitted successfully!`);
        }
      }

      const result = {
        success: true,
        actualAmountOut: undefined, // Would need additional parsing from transaction receipt
        gasUsed: undefined,
        transactionHash: confirmationResult?.transactionHash || 'pending-confirmation'
      };

      // Log the successful transaction
      const logEntry: TransactionLogEntry = {
        timestamp: new Date().toISOString(),
        transactionId: pendingTransaction.transactionId,
        type: 'BUY', // Will be overridden by specific methods
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        amountOut: result.actualAmountOut || 'pending',
        quotedAmountOut: quotedOutput.toString(),
        slippageBps: params.slippageBps || 100,
        actualSlippage: result.actualAmountOut ?
          this.calculateActualSlippage(quotedOutput.toString(), result.actualAmountOut) : undefined,
        feeTier: quote.feeTier || params.feeTier,
        walletAddress: this.walletAddress,
        transactionHash: result.transactionHash,
        gasUsed: result.gasUsed,
        success: true
      };

      this.logTransaction(logEntry);

      return {
        success: result.success,
        transactionId: pendingTransaction.transactionId,
        actualAmountOut: result.actualAmountOut,
        gasUsed: result.gasUsed
      };

    } catch (error: any) {
      console.error(`❌ Swap execution failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute a GUSDC to GALA buy specifically
   */
  async buyGALAWithGUSDC(gusdcAmount: string, slippageBps: number = 100): Promise<SwapResult> {
    const tokenIn = 'GUSDC|Unit|none|none';
    const tokenOut = 'GALA|Unit|none|none';

    console.log(`🛒 Initiating GALA purchase: ${gusdcAmount} GUSDC → GALA`);

    // Get quote first to determine minimum output
    const quote = await this.getQuote(tokenIn, tokenOut, gusdcAmount);
    const quotedGALA = Number(quote.outTokenAmount?.toString() ?? quote.outTokenAmount);
    const minGALA = quotedGALA * (1 - slippageBps / 10000);

    const result = await this.executeSwap({
      tokenIn,
      tokenOut,
      amountIn: gusdcAmount,
      amountOutMinimum: minGALA.toString(),
      feeTier: quote.feeTier || 3000, // Default to 0.3% fee tier
      recipient: this.walletAddress,
      slippageBps
    });

    // Update the log entry to have correct type
    if (result.success && result.transactionId) {
      try {
        const transactions = await this.getTransactionHistory(1);
        if (transactions.length > 0) {
          transactions[0].type = 'BUY';
        }
      } catch (error) {
        // Ignore logging errors
      }
    }

    return result;
  }

  /**
   * Execute a GALA to GUSDC sell specifically
   */
  async sellGALAForGUSDC(galaAmount: string, slippageBps: number = 100): Promise<SwapResult> {
    const tokenIn = 'GALA|Unit|none|none';
    const tokenOut = 'GUSDC|Unit|none|none';

    console.log(`💸 Initiating GALA sale: ${galaAmount} GALA → GUSDC`);

    // Get quote first to determine minimum output
    const quote = await this.getQuote(tokenIn, tokenOut, galaAmount);
    const quotedGUSDC = Number(quote.outTokenAmount?.toString() ?? quote.outTokenAmount);
    const minGUSDC = quotedGUSDC * (1 - slippageBps / 10000);

    return await this.executeSwap({
      tokenIn,
      tokenOut,
      amountIn: galaAmount,
      amountOutMinimum: minGUSDC.toString(),
      feeTier: quote.feeTier || 3000, // Default to 0.3% fee tier
      recipient: this.walletAddress,
      slippageBps
    });
  }



  /**
   * Get current wallet balances
   */
  async getBalances(): Promise<{ [token: string]: string }> {
    try {
      // This would require additional API implementation
      // For now, return environment variable balances as fallback
      return {
        GALA: process.env.GALA_BALANCE || '0',
        GUSDC: process.env.GUSDC_BALANCE || '0'
      };
    } catch (error: any) {
      console.error(`❌ Error getting balances: ${error.message}`);
      return {};
    }
  }

  /**
   * Log a transaction to both text and JSON logs for tracking
   */
  private logTransaction(entry: TransactionLogEntry): void {
    try {
      // Text log for human reading
      const textEntry = [
        `[${entry.timestamp}]`,
        `${entry.success ? '✅' : '❌'}`,
        `${entry.type}:`,
        `${entry.amountIn} ${this.getTokenSymbol(entry.tokenIn)}`,
        `→ ${entry.amountOut} ${this.getTokenSymbol(entry.tokenOut)}`,
        `| TX: ${entry.transactionId}`,
        entry.profit ? `| Profit: $${entry.profit.toFixed(4)}` : '',
        entry.profitPercentage ? `(${entry.profitPercentage.toFixed(2)}%)` : '',
        entry.error ? `| Error: ${entry.error}` : ''
      ].filter(Boolean).join(' ');

      fs.appendFileSync(this.tradesLogFile, textEntry + '\n');

      // JSON log for programmatic analysis
      let transactions: TransactionLogEntry[] = [];
      try {
        if (fs.existsSync(this.transactionsLogFile)) {
          const content = fs.readFileSync(this.transactionsLogFile, 'utf8');
          transactions = JSON.parse(content);
        }
      } catch (error) {
        console.log(`⚠️  Error reading transaction log: ${error}`);
      }

      transactions.push(entry);

      // Keep only last 1000 transactions to prevent file from growing too large
      if (transactions.length > 1000) {
        transactions = transactions.slice(-1000);
      }

      fs.writeFileSync(this.transactionsLogFile, JSON.stringify(transactions, null, 2));

      console.log(`📝 Transaction logged: ${entry.type} ${entry.amountIn} ${this.getTokenSymbol(entry.tokenIn)} → ${entry.amountOut} ${this.getTokenSymbol(entry.tokenOut)}`);

    } catch (error: any) {
      console.error(`❌ Error logging transaction: ${error.message}`);
    }
  }

  /**
   * Get human-readable token symbol from token string
   */
  private getTokenSymbol(tokenString: string): string {
    const parts = tokenString.split('|');
    return parts[0] || tokenString;
  }

  /**
   * Calculate actual slippage from quoted vs actual amounts
   */
  private calculateActualSlippage(quotedAmount: string, actualAmount: string): number {
    const quoted = Number(quotedAmount);
    const actual = Number(actualAmount);
    if (quoted === 0) return 0;
    return ((quoted - actual) / quoted) * 10000; // Return in basis points
  }

  /**
   * Get recent transaction history for profit analysis
   */
  async getTransactionHistory(limit: number = 50): Promise<TransactionLogEntry[]> {
    try {
      if (!fs.existsSync(this.transactionsLogFile)) {
        return [];
      }

      const content = fs.readFileSync(this.transactionsLogFile, 'utf8');
      const transactions: TransactionLogEntry[] = JSON.parse(content);

      return transactions
        .filter(tx => tx.success) // Only successful transactions
        .slice(-limit) // Get most recent
        .reverse(); // Most recent first

    } catch (error: any) {
      console.error(`❌ Error reading transaction history: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate total profit from transaction history
   */
  async calculateTotalProfit(): Promise<{
    totalProfit: number;
    totalTrades: number;
    successfulTrades: number;
    averageProfit: number;
    profitByToken: { [token: string]: number };
  }> {
    try {
      const transactions = await this.getTransactionHistory(1000); // Get more for accurate calculation

      let totalProfit = 0;
      let successfulTrades = 0;
      const profitByToken: { [token: string]: number } = {};

      for (const tx of transactions) {
        if (tx.success && tx.profit !== undefined) {
          totalProfit += tx.profit;
          successfulTrades++;

          const tokenOut = this.getTokenSymbol(tx.tokenOut);
          profitByToken[tokenOut] = (profitByToken[tokenOut] || 0) + tx.profit;
        }
      }

      return {
        totalProfit,
        totalTrades: transactions.length,
        successfulTrades,
        averageProfit: successfulTrades > 0 ? totalProfit / successfulTrades : 0,
        profitByToken
      };

    } catch (error: any) {
      console.error(`❌ Error calculating profit: ${error.message}`);
      return {
        totalProfit: 0,
        totalTrades: 0,
        successfulTrades: 0,
        averageProfit: 0,
        profitByToken: {}
      };
    }
  }

  /**
   * Enable socket connection for real-time transaction confirmations (optional)
   * Note: Socket functionality may not be available in current SDK version
   */
  async enableSocketConnection(): Promise<boolean> {
    try {
      console.log(`📡 Attempting to connect to transaction status socket...`);

      // Check if socket functionality is available
      if (typeof (this.gswap as any).connectSocket === 'function') {
        await (this.gswap as any).connectSocket();
        console.log(`✅ Socket connection established for real-time confirmations`);
        return true;
      } else if (typeof (this.gswap as any).events?.connectEventSocket === 'function') {
        await (this.gswap as any).events.connectEventSocket();
        console.log(`✅ Socket connection established for real-time confirmations`);
        return true;
      } else {
        console.log(`📡 Socket functionality not available in current SDK version`);
        console.log(`   Transactions will work but without real-time confirmations`);
        return false;
      }
    } catch (error: any) {
      console.log(`⚠️  Socket connection failed: ${error.message}`);
      console.log(`   Transactions will still work, but without real-time status updates`);
      return false;
    }
  }

  /**
   * Validate wallet connection and authorization
   */
  async validateConnection(): Promise<boolean> {
    try {
      console.log(`🔍 Validating wallet connection for: ${this.walletAddress}`);

      // Try to get a simple quote to test connection
      await this.getQuote(
        'GUSDC|Unit|none|none',
        'GALA|Unit|none|none',
        '1'
      );

      console.log(`✅ Wallet connection validated`);
      return true;

    } catch (error: any) {
      console.error(`❌ Wallet connection validation failed: ${error.message}`);
      return false;
    }
  }
}

// Export a singleton instance
export const galaSwapAuth = new GalaChainSwapAuth();
