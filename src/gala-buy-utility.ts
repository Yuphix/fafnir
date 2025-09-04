import 'dotenv/config';
import { GalaChainSwapAuth } from './galachain-swap-auth.js';

/**
 * Simple GALA Buy Utility
 *
 * This utility provides an easy-to-use interface for buying GALA with GUSDC
 * using proper GalaChain SDK authorization.
 */

export class GalaBuyUtility {
  private swapAuth: GalaChainSwapAuth;

  constructor() {
    this.swapAuth = new GalaChainSwapAuth();
  }

  /**
   * Buy GALA with a specified amount of GUSDC
   */
  async buyGala(gusdcAmount: string, slippageBps: number = 100): Promise<{
    success: boolean;
    transactionId?: string;
    galaReceived?: string;
    error?: string;
  }> {
    try {
      console.log(`🛒 Initiating GALA purchase: ${gusdcAmount} GUSDC`);

      // Validate connection first
      const connectionValid = await this.swapAuth.validateConnection();
      if (!connectionValid) {
        throw new Error('Failed to validate wallet connection');
      }

      // Execute the buy
      const result = await this.swapAuth.buyGALAWithGUSDC(gusdcAmount, slippageBps);

      if (result.success) {
        console.log(`✅ GALA purchase successful!`);
        console.log(`   📦 Transaction ID: ${result.transactionId}`);
        console.log(`   💰 GALA received: ${result.actualAmountOut || 'pending confirmation'}`);
      } else {
        console.log(`❌ GALA purchase failed: ${result.error}`);
      }

      return {
        success: result.success,
        transactionId: result.transactionId,
        galaReceived: result.actualAmountOut,
        error: result.error
      };

    } catch (error: any) {
      console.error(`❌ Buy GALA failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Sell GALA for a specified amount of GUSDC
   */
  async sellGala(galaAmount: string, slippageBps: number = 100): Promise<{
    success: boolean;
    transactionId?: string;
    gusdcReceived?: string;
    error?: string;
  }> {
    try {
      console.log(`💸 Initiating GALA sale: ${galaAmount} GALA`);

      // Validate connection first
      const connectionValid = await this.swapAuth.validateConnection();
      if (!connectionValid) {
        throw new Error('Failed to validate wallet connection');
      }

      // Execute the sell
      const result = await this.swapAuth.sellGALAForGUSDC(galaAmount, slippageBps);

      if (result.success) {
        console.log(`✅ GALA sale successful!`);
        console.log(`   📦 Transaction ID: ${result.transactionId}`);
        console.log(`   💰 GUSDC received: ${result.actualAmountOut || 'pending confirmation'}`);
      } else {
        console.log(`❌ GALA sale failed: ${result.error}`);
      }

      return {
        success: result.success,
        transactionId: result.transactionId,
        gusdcReceived: result.actualAmountOut,
        error: result.error
      };

    } catch (error: any) {
      console.error(`❌ Sell GALA failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current quote for GUSDC to GALA
   */
  async getGalaQuote(gusdcAmount: string): Promise<{
    success: boolean;
    galaAmount?: string;
    feeTier?: number;
    error?: string;
  }> {
    try {
      const quote = await this.swapAuth.getQuote(
        'GUSDC|Unit|none|none',
        'GALA|Unit|none|none',
        gusdcAmount
      );

      const galaAmount = quote.outTokenAmount?.toString() || quote.outTokenAmount;

      console.log(`💭 Quote: ${gusdcAmount} GUSDC → ${galaAmount} GALA (fee tier: ${quote.feeTier}bps)`);

      return {
        success: true,
        galaAmount: galaAmount.toString(),
        feeTier: quote.feeTier
      };

    } catch (error: any) {
      console.error(`❌ Quote failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current quote for GALA to GUSDC
   */
  async getGusdcQuote(galaAmount: string): Promise<{
    success: boolean;
    gusdcAmount?: string;
    feeTier?: number;
    error?: string;
  }> {
    try {
      const quote = await this.swapAuth.getQuote(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        galaAmount
      );

      const gusdcAmount = quote.outTokenAmount?.toString() || quote.outTokenAmount;

      console.log(`💭 Quote: ${galaAmount} GALA → ${gusdcAmount} GUSDC (fee tier: ${quote.feeTier}bps)`);

      return {
        success: true,
        gusdcAmount: gusdcAmount.toString(),
        feeTier: quote.feeTier
      };

    } catch (error: any) {
      console.error(`❌ Quote failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check current wallet balances
   */
  async getBalances(): Promise<{
    success: boolean;
    balances?: { [token: string]: string };
    error?: string;
  }> {
    try {
      const balances = await this.swapAuth.getBalances();

      console.log(`💼 Current balances:`);
      Object.entries(balances).forEach(([token, amount]) => {
        console.log(`   ${token}: ${amount}`);
      });

      return {
        success: true,
        balances
      };

    } catch (error: any) {
      console.error(`❌ Balance check failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Test connection and authorization
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log(`🔍 Testing wallet connection and authorization...`);
      const isValid = await this.swapAuth.validateConnection();

      if (isValid) {
        console.log(`✅ Connection and authorization test passed`);
      } else {
        console.log(`❌ Connection and authorization test failed`);
      }

      return isValid;

    } catch (error: any) {
      console.error(`❌ Connection test error: ${error.message}`);
      return false;
    }
  }
}

// Export a singleton instance
export const galaBuyUtility = new GalaBuyUtility();
