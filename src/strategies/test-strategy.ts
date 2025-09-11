import { TradingStrategy, MarketCondition, TradeResult } from '../types.js';
import fs from 'fs-extra';
import path from 'node:path';
import { GSwap } from '@gala-chain/gswap-sdk';
import { GalaChainSwapAuth } from '../galachain-swap-auth.js';

/**
 * Test Strategy for Logging Refinement
 * 
 * Simple strategy that:
 * 1. Buys $1 worth of GALA with GUSDC every 15 minutes
 * 2. Sells it back to GUSDC 5 minutes later
 * 
 * Purpose: Testing and logging system refinement
 */
export class TestStrategy implements TradingStrategy {
  name = 'test-strategy';
  minVolumeRequired = 0.1; // Very low requirement for testing
  maxRisk = 0.1; // Very low risk

  private gswap: GSwap;
  private swapAuth: GalaChainSwapAuth;
  private wallet: string | undefined;
  private dryRun: boolean;
  
  // Test strategy specific settings
  private readonly TEST_AMOUNT_USD = 1.0; // $1 worth of trades
  private readonly BUY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly SELL_DELAY_MS = 5 * 60 * 1000; // 5 minutes after buy
  private readonly TARGET_PAIR = 'GALA/GUSDC';
  
  // Tracking
  private lastBuyTime: number = 0;
  private pendingSells: Array<{
    sellTime: number;
    amount: string;
    buyPrice: number;
    tradeId: string;
  }> = [];
  private tradeCounter: number = 0;

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

    // Initialize swap authorization
    this.swapAuth = new GalaChainSwapAuth();

    // Test mode - always dry run unless explicitly disabled
    this.dryRun = String(process.env.TEST_STRATEGY_DRY_RUN || 'true').toLowerCase() !== 'false';

    console.log(`🧪 Test Strategy initialized for logging refinement`);
    console.log(`💰 Test amount: $${this.TEST_AMOUNT_USD} | Pair: ${this.TARGET_PAIR} | Dry run: ${this.dryRun}`);
    console.log(`⏱️ Buy interval: ${this.BUY_INTERVAL_MS / 1000 / 60} minutes | Sell delay: ${this.SELL_DELAY_MS / 1000 / 60} minutes`);
  }

  async execute(): Promise<TradeResult> {
    const now = Date.now();
    const tradeId = `test-${++this.tradeCounter}-${now}`;

    try {
      // Process any pending sells first
      await this.processPendingSells();

      // Check if it's time for a new buy
      if (this.shouldBuy(now)) {
        return await this.executeBuy(tradeId, now);
      }

      // No action needed right now
      return {
        success: true,
        profit: 0,
        volume: 0,
        strategy: this.name,
        pool: this.TARGET_PAIR,
        timestamp: now
      };

    } catch (error: any) {
      await this.logError('execute', error, { tradeId });
      return {
        success: false,
        profit: 0,
        volume: 0,
        strategy: this.name,
        pool: this.TARGET_PAIR,
        timestamp: now,
        error: error.message
      };
    }
  }

  private shouldBuy(now: number): boolean {
    return now - this.lastBuyTime >= this.BUY_INTERVAL_MS;
  }

  private async executeBuy(tradeId: string, now: number): Promise<TradeResult> {
    await this.logInfo('executeBuy', 'Starting buy operation', { tradeId, amount: this.TEST_AMOUNT_USD });

    try {
      // Get current GALA price in GUSDC
      const priceData = await this.getGalaPrice();
      const galaAmount = (this.TEST_AMOUNT_USD / priceData.price).toFixed(6);

      await this.logInfo('executeBuy', 'Price data retrieved', { 
        tradeId, 
        galaPrice: priceData.price, 
        galaAmount,
        usdcAmount: this.TEST_AMOUNT_USD 
      });

      if (this.dryRun) {
        await this.logInfo('executeBuy', 'DRY RUN: Simulating GUSDC -> GALA swap', { 
          tradeId,
          symbolIn: 'GUSDC',
          symbolOut: 'GALA',
          amountIn: this.TEST_AMOUNT_USD,
          expectedAmountOut: galaAmount
        });
      } else {
        // Execute actual swap: GUSDC -> GALA
        const swapResult = await this.executeSwap('GUSDC', 'GALA', this.TEST_AMOUNT_USD.toString());
        await this.logInfo('executeBuy', 'Real swap executed', { tradeId, swapResult });
      }

      // Schedule the sell
      const sellTime = now + this.SELL_DELAY_MS;
      this.pendingSells.push({
        sellTime,
        amount: galaAmount,
        buyPrice: priceData.price,
        tradeId
      });

      this.lastBuyTime = now;

      await this.logInfo('executeBuy', 'Buy completed, sell scheduled', { 
        tradeId, 
        sellScheduledAt: new Date(sellTime).toISOString(),
        pendingSellsCount: this.pendingSells.length
      });

      return {
        success: true,
        profit: 0, // Profit calculated on sell
        volume: this.TEST_AMOUNT_USD,
        strategy: this.name,
        pool: this.TARGET_PAIR,
        timestamp: now
      };

    } catch (error: any) {
      await this.logError('executeBuy', error, { tradeId });
      throw error;
    }
  }

  private async processPendingSells(): Promise<void> {
    const now = Date.now();
    const readyToSell = this.pendingSells.filter(sell => now >= sell.sellTime);

    for (const sellOrder of readyToSell) {
      try {
        await this.executeSell(sellOrder, now);
        // Remove from pending sells
        this.pendingSells = this.pendingSells.filter(s => s.tradeId !== sellOrder.tradeId);
      } catch (error: any) {
        await this.logError('processPendingSells', error, { tradeId: sellOrder.tradeId });
      }
    }
  }

  private async executeSell(sellOrder: any, now: number): Promise<void> {
    await this.logInfo('executeSell', 'Starting sell operation', { 
      tradeId: sellOrder.tradeId,
      galaAmount: sellOrder.amount,
      originalBuyPrice: sellOrder.buyPrice
    });

    try {
      // Get current GALA price
      const currentPriceData = await this.getGalaPrice();
      const expectedUsdcAmount = (parseFloat(sellOrder.amount) * currentPriceData.price).toFixed(6);
      const profit = (parseFloat(expectedUsdcAmount) - this.TEST_AMOUNT_USD).toFixed(6);

      await this.logInfo('executeSell', 'Current price data for sell', { 
        tradeId: sellOrder.tradeId,
        currentPrice: currentPriceData.price,
        buyPrice: sellOrder.buyPrice,
        priceChange: ((currentPriceData.price - sellOrder.buyPrice) / sellOrder.buyPrice * 100).toFixed(2) + '%',
        expectedUsdcAmount,
        estimatedProfit: profit
      });

      if (this.dryRun) {
        await this.logInfo('executeSell', 'DRY RUN: Simulating GALA -> GUSDC swap', { 
          tradeId: sellOrder.tradeId,
          symbolIn: 'GALA',
          symbolOut: 'GUSDC',
          amountIn: sellOrder.amount,
          expectedAmountOut: expectedUsdcAmount,
          estimatedProfit: profit
        });
      } else {
        // Execute actual swap: GALA -> GUSDC
        const swapResult = await this.executeSwap('GALA', 'GUSDC', sellOrder.amount);
        await this.logInfo('executeSell', 'Real sell swap executed', { 
          tradeId: sellOrder.tradeId, 
          swapResult,
          actualProfit: 'TBD from swap result'
        });
      }

      await this.logInfo('executeSell', 'Sell completed - trade cycle finished', { 
        tradeId: sellOrder.tradeId,
        cycleProfit: profit,
        totalCycleTime: `${(now - (sellOrder.sellTime - this.SELL_DELAY_MS)) / 1000 / 60} minutes`
      });

    } catch (error: any) {
      await this.logError('executeSell', error, { tradeId: sellOrder.tradeId });
      throw error;
    }
  }

  private async getGalaPrice(): Promise<{ price: number; timestamp: number }> {
    try {
      // Get price from GSwap quote using correct API
      const quote = await this.gswap.quoting.quoteExactInput(
        'GUSDC',
        'GALA', 
        '1', // 1 GUSDC
        3000 // Standard fee tier
      );

      const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);
      const price = 1 / outAmount;
      
      await this.logInfo('getGalaPrice', 'Price retrieved', { 
        galaPrice: price,
        quoteAmountOut: outAmount,
        source: 'GSwap quoting.quoteExactInput'
      });

      return {
        price,
        timestamp: Date.now()
      };
    } catch (error: any) {
      await this.logError('getGalaPrice', error, {});
      throw new Error(`Failed to get GALA price: ${error.message}`);
    }
  }

  private async executeSwap(symbolIn: string, symbolOut: string, amountIn: string): Promise<any> {
    try {
      await this.logInfo('executeSwap', 'Starting swap execution', { symbolIn, symbolOut, amountIn });

      // Get quote first using correct API
      const quote = await this.gswap.quoting.quoteExactInput(
        symbolIn,
        symbolOut,
        amountIn,
        3000 // Standard fee tier
      );

      const outAmount = Number((quote as any).outTokenAmount?.toString?.() ?? quote.outTokenAmount);
      const amountOutMinimum = (outAmount * 0.99).toString(); // 1% slippage

      await this.logInfo('executeSwap', 'Quote received', { 
        amountOut: outAmount,
        amountOutMinimum,
        feeTier: 3000
      });

      // Execute swap using swapAuth.executeSwap pattern from other strategies
      const swapResult = await this.swapAuth.executeSwap({
        tokenIn: symbolIn,
        tokenOut: symbolOut,
        amountIn: amountIn,
        amountOutMinimum: amountOutMinimum,
        feeTier: 3000,
        recipient: this.wallet!,
        slippageBps: 100 // 1% slippage for test trades
      });

      await this.logInfo('executeSwap', 'Swap executed', { 
        success: swapResult.success,
        transactionId: swapResult.transactionId,
        actualAmountOut: swapResult.actualAmountOut
      });

      return swapResult;

    } catch (error: any) {
      await this.logError('executeSwap', error, { symbolIn, symbolOut, amountIn });
      throw error;
    }
  }

  shouldActivate(marketCondition: MarketCondition): boolean {
    // This test strategy should always be available (low requirements)
    return marketCondition.volume >= this.minVolumeRequired;
  }

  // Enhanced logging methods for testing and refinement
  private async logInfo(method: string, message: string, data: any): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      strategy: this.name,
      level: 'INFO',
      method,
      message,
      data,
      wallet: this.wallet,
      dryRun: this.dryRun
    };

    console.log(`🧪 [TEST-STRATEGY:${method}] ${message}`, data);
    await this.writeToLogFile('test-strategy.log', logEntry);
  }

  private async logError(method: string, error: any, context: any): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      strategy: this.name,
      level: 'ERROR',
      method,
      error: error.message,
      stack: error.stack,
      context,
      wallet: this.wallet,
      dryRun: this.dryRun
    };

    console.error(`🚨 [TEST-STRATEGY:${method}] ERROR:`, error.message, context);
    await this.writeToLogFile('test-strategy-errors.log', logEntry);
  }

  private async writeToLogFile(filename: string, logEntry: any): Promise<void> {
    try {
      const logDir = path.join(process.cwd(), 'logs', 'test-strategy');
      await fs.ensureDir(logDir);
      
      const logFile = path.join(logDir, filename);
      const logLine = JSON.stringify(logEntry) + '\n';
      
      await fs.appendFile(logFile, logLine);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  // Status methods for monitoring
  getStatus(): any {
    return {
      name: this.name,
      lastBuyTime: this.lastBuyTime ? new Date(this.lastBuyTime).toISOString() : 'never',
      pendingSells: this.pendingSells.length,
      nextBuyIn: this.lastBuyTime ? Math.max(0, this.BUY_INTERVAL_MS - (Date.now() - this.lastBuyTime)) : 0,
      tradeCounter: this.tradeCounter,
      dryRun: this.dryRun,
      testAmount: this.TEST_AMOUNT_USD,
      targetPair: this.TARGET_PAIR
    };
  }
}
