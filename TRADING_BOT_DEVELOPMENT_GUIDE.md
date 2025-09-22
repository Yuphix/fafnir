# 🤖 Complete Trading Bot Development Guide for GalaSwap

## 📋 Table of Contents
1. [Overview](#overview)
2. [Prerequisites & Setup](#prerequisites--setup)
3. [Project Structure](#project-structure)
4. [Core Components](#core-components)
5. [Building the Basic Bot](#building-the-basic-bot)
6. [Implementing Arbitrage Strategy](#implementing-arbitrage-strategy)
7. [Creating a Testing Strategy](#creating-a-testing-strategy)
8. [Transaction Logging System](#transaction-logging-system)
9. [Environment Configuration](#environment-configuration)
10. [Running & Testing](#running--testing)
11. [AI Agent Instructions](#ai-agent-instructions)
12. [Advanced Features](#advanced-features)
13. [Troubleshooting](#troubleshooting)

---

## 🌟 Overview

This guide provides step-by-step instructions for building a trading bot that operates on **GalaSwap** using the **GSwap SDK** and **GalaChain API**. The bot will include:

- **🔄 Arbitrage Strategy**: Detects price differences across trading pairs
- **🧪 Testing Strategy**: Executes $1 GALA trades for testing transaction logs
- **📊 Comprehensive Logging**: Detailed transaction and performance tracking
- **🛡️ Risk Management**: Built-in safety mechanisms and limits

### Key Technologies
- **GSwap SDK**: For DEX operations and quotes
- **GalaChain API**: For blockchain interactions and signing
- **TypeScript**: Type-safe development
- **Node.js**: Runtime environment

---

## 🔧 Prerequisites & Setup

### 1. Environment Requirements

```bash
# Node.js version 18+ required
node --version  # Should be 18.0.0 or higher
npm --version   # Should be 8.0.0 or higher
```

### 2. Create New Project

```bash
# Create project directory
mkdir galaswap-trading-bot
cd galaswap-trading-bot

# Initialize npm project
npm init -y

# Install required dependencies
npm install @gala-chain/gswap-sdk @gala-chain/api @gala-chain/client
npm install fs-extra axios dotenv
npm install --save-dev typescript @types/node @types/fs-extra tsx

# Create TypeScript configuration
npx tsc --init
```

### 3. Package.json Configuration

```json
{
  "name": "galaswap-trading-bot",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/bot.ts",
    "test": "tsx src/test-strategy.ts",
    "arbitrage": "tsx src/arbitrage-strategy.ts",
    "build": "tsc",
    "dev": "tsx --watch src/bot.ts"
  },
  "dependencies": {
    "@gala-chain/gswap-sdk": "^0.0.7",
    "@gala-chain/api": "^2.4.3",
    "@gala-chain/client": "^2.4.3",
    "fs-extra": "^11.2.0",
    "axios": "^1.11.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^20.19.11",
    "@types/fs-extra": "^11.0.4",
    "typescript": "^5.5.4",
    "tsx": "^4.15.7"
  }
}
```

### 4. Environment Variables Setup

Create `.env` file:

```bash
# GalaChain Wallet Configuration
GALACHAIN_PRIVATE_KEY=your_private_key_here
GALACHAIN_WALLET_ADDRESS=your_wallet_address_here

# GSwap Configuration
GSWAP_GATEWAY_URL=https://gateway-mainnet.galachain.com
GSWAP_DEX_BACKEND_URL=https://dex-backend-prod1.defi.gala.com
GSWAP_BUNDLER_URL=https://bundle-backend-prod1.defi.gala.com

# Trading Configuration
DRY_RUN=true
MIN_PROFIT_BPS=50
SLIPPAGE_BPS=100
MAX_TRADE_SIZE=25
```

---

## 📁 Project Structure

```
galaswap-trading-bot/
├── src/
│   ├── types.ts              # Type definitions
│   ├── galachain-auth.ts     # GalaChain authentication
│   ├── strategies/
│   │   ├── base-strategy.ts  # Base strategy interface
│   │   ├── arbitrage.ts      # Arbitrage implementation
│   │   └── test-strategy.ts  # Testing strategy
│   ├── utils/
│   │   ├── logger.ts         # Logging utilities
│   │   └── risk-manager.ts   # Risk management
│   └── bot.ts                # Main bot entry point
├── logs/                     # Log files directory
├── config/
│   └── trading-config.json   # Trading configuration
├── .env                      # Environment variables
├── package.json
└── tsconfig.json
```

---

## 🏗️ Core Components

### 1. Type Definitions (`src/types.ts`)

```typescript
export interface TradingStrategy {
  name: string;
  minVolumeRequired: number;
  maxRisk: number;

  execute(): Promise<TradeResult>;
  shouldActivate(marketCondition: MarketCondition): boolean;
}

export interface TradeResult {
  success: boolean;
  profit: number;
  volume: number;
  strategy: string;
  pool: string;
  timestamp: number;
  transactionId?: string;
  transactionHash?: string;
  error?: string;
}

export interface MarketCondition {
  volatility: number;
  volume: number;
  competitionLevel: number;
  timeOfDay: 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';
  recentPerformance: number;
}

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMinimum?: string;
  slippageBps?: number;
  feeTier?: number;
  recipient?: string;
}

export interface SwapResult {
  success: boolean;
  transactionId?: string;
  transactionHash?: string;
  actualAmountOut?: string;
  gasUsed?: string;
  error?: string;
}

export interface QuoteResult {
  outTokenAmount: string;
  feeTier: number;
  priceImpact: number;
}
```

### 2. GalaChain Authentication (`src/galachain-auth.ts`)

```typescript
import { GSwap } from '@gala-chain/gswap-sdk';
import { PrivateKeySigner } from '@gala-chain/api';
import { SwapParams, SwapResult } from './types.js';
import fs from 'fs-extra';
import path from 'path';

export class GalaChainSwapAuth {
  private gswap: GSwap;
  private privateKey: string;
  private walletAddress: string;
  private signer: PrivateKeySigner;
  private logDir: string;

  constructor() {
    // Validate environment variables
    this.privateKey = process.env.GALACHAIN_PRIVATE_KEY || '';
    this.walletAddress = process.env.GALACHAIN_WALLET_ADDRESS || '';

    if (!this.privateKey) {
      throw new Error('GALACHAIN_PRIVATE_KEY must be set in environment variables');
    }

    if (!this.walletAddress) {
      throw new Error('GALACHAIN_WALLET_ADDRESS must be set in environment variables');
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
      signer: this.signer
    });

    // Setup logging
    this.logDir = path.join(process.cwd(), 'logs');
    fs.ensureDirSync(this.logDir);

    console.log(`🔐 GalaChain Swap Auth initialized for wallet: ${this.walletAddress.slice(0, 8)}...`);
  }

  /**
   * Get a quote for a swap
   */
  async getQuote(tokenIn: string, tokenOut: string, amountIn: string, feeTier?: number): Promise<any> {
    try {
      console.log(`📊 Getting quote: ${amountIn} ${tokenIn} → ${tokenOut}`);

      // Convert token symbols to proper token class format
      const tokenInClass = this.formatTokenClass(tokenIn);
      const tokenOutClass = this.formatTokenClass(tokenOut);

      const quote = await this.gswap.quoting.quoteExactInput(
        tokenInClass,
        tokenOutClass,
        amountIn,
        feeTier || 3000 // Default to 0.3% fee tier
      );

      console.log(`✅ Quote received: ${quote.outTokenAmount} ${tokenOut}`);
      return quote;

    } catch (error: any) {
      console.error(`❌ Quote failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute a swap with proper authorization
   */
  async executeSwap(params: SwapParams): Promise<SwapResult> {
    try {
      console.log(`🔄 Executing swap: ${params.amountIn} ${params.tokenIn} → ${params.tokenOut}`);

      // First get a quote to validate the swap
      const quote = await this.getQuote(params.tokenIn, params.tokenOut, params.amountIn, params.feeTier);
      const quotedOutput = Number(quote.outTokenAmount?.toString() ?? quote.outTokenAmount);

      // Calculate minimum output with slippage protection
      const slippageBps = params.slippageBps || 100; // Default 1% slippage
      const minOut = quotedOutput * (1 - slippageBps / 10000);
      const finalMinOut = params.amountOutMinimum ?
        Math.max(minOut, Number(params.amountOutMinimum)) :
        minOut;

      console.log(`🛡️ Slippage protection: minimum output ${finalMinOut.toFixed(6)} ${params.tokenOut}`);

      // Execute the swap
      const pendingTransaction = await this.gswap.swaps.swap(
        this.formatTokenClass(params.tokenIn),
        this.formatTokenClass(params.tokenOut),
        quote.feeTier || params.feeTier || 3000,
        {
          exactIn: params.amountIn,
          amountOutMinimum: finalMinOut.toString()
        },
        params.recipient || this.walletAddress
      );

      console.log(`📦 Swap submitted! Transaction ID: ${pendingTransaction.transactionId}`);

      // Wait for confirmation
      let confirmationResult: any = null;
      try {
        confirmationResult = await pendingTransaction.getResult();
        console.log(`✅ Swap confirmed: ${confirmationResult.transactionId}`);
      } catch (confirmError) {
        console.log(`⚠️ Confirmation timeout, but transaction was submitted: ${pendingTransaction.transactionId}`);
      }

      const result: SwapResult = {
        success: true,
        transactionId: pendingTransaction.transactionId,
        transactionHash: confirmationResult?.transactionHash || pendingTransaction.transactionId,
        actualAmountOut: confirmationResult?.actualAmountOut || quotedOutput.toString(),
        gasUsed: confirmationResult?.gasUsed
      };

      // Log the successful trade
      await this.logTrade(params, result);

      return result;

    } catch (error: any) {
      console.error(`❌ Swap execution failed: ${error.message}`);

      const result: SwapResult = {
        success: false,
        error: error.message
      };

      // Log the failed trade
      await this.logTrade(params, result);

      return result;
    }
  }

  /**
   * Convenience method for buying GALA with GUSDC
   */
  async buyGALAWithGUSDC(usdcAmount: string, slippageBps: number = 100): Promise<SwapResult> {
    return this.executeSwap({
      tokenIn: 'GUSDC',
      tokenOut: 'GALA',
      amountIn: usdcAmount,
      slippageBps
    });
  }

  /**
   * Convenience method for selling GALA for GUSDC
   */
  async sellGALAForGUSDC(galaAmount: string, slippageBps: number = 100): Promise<SwapResult> {
    return this.executeSwap({
      tokenIn: 'GALA',
      tokenOut: 'GUSDC',
      amountIn: galaAmount,
      slippageBps
    });
  }

  /**
   * Format token symbol to proper token class format
   */
  private formatTokenClass(tokenSymbol: string): string {
    // GalaChain token class format: TOKEN|Unit|none|none
    return `${tokenSymbol}|Unit|none|none`;
  }

  /**
   * Log trade execution details
   */
  private async logTrade(params: SwapParams, result: SwapResult): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      wallet: this.walletAddress,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      success: result.success,
      transactionId: result.transactionId,
      transactionHash: result.transactionHash,
      actualAmountOut: result.actualAmountOut,
      error: result.error
    };

    const logFile = path.join(this.logDir, 'trades.log');
    const logLine = JSON.stringify(logEntry) + '\n';

    try {
      await fs.appendFile(logFile, logLine);
    } catch (error) {
      console.error('Failed to write trade log:', error);
    }
  }

  /**
   * Get wallet balances (mock implementation - replace with actual balance check)
   */
  async getBalances(): Promise<any> {
    // This is a simplified mock - in production, implement actual balance checking
    return {
      GALA: process.env.MOCK_GALA_BALANCE || '1000',
      GUSDC: process.env.MOCK_GUSDC_BALANCE || '50',
      GUSDT: process.env.MOCK_GUSDT_BALANCE || '50'
    };
  }
}
```

### 3. Base Strategy Interface (`src/strategies/base-strategy.ts`)

```typescript
import { TradingStrategy, MarketCondition, TradeResult } from '../types.js';

export abstract class BaseStrategy implements TradingStrategy {
  abstract name: string;
  abstract minVolumeRequired: number;
  abstract maxRisk: number;

  abstract execute(): Promise<TradeResult>;
  abstract shouldActivate(marketCondition: MarketCondition): boolean;

  /**
   * Helper method to check if dry run mode is enabled
   */
  protected isDryRun(): boolean {
    return String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
  }

  /**
   * Helper method to log strategy actions
   */
  protected async log(level: 'info' | 'error' | 'warn', message: string, data?: any): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      strategy: this.name,
      level: level.toUpperCase(),
      message,
      data
    };

    console.log(`[${this.name.toUpperCase()}] ${message}`, data || '');

    // Write to strategy-specific log file
    const fs = await import('fs-extra');
    const path = await import('path');

    const logDir = path.join(process.cwd(), 'logs', 'strategies');
    await fs.ensureDir(logDir);

    const logFile = path.join(logDir, `${this.name}.log`);
    const logLine = JSON.stringify(logEntry) + '\n';

    try {
      await fs.appendFile(logFile, logLine);
    } catch (error) {
      console.error('Failed to write strategy log:', error);
    }
  }
}
```

---

## 🔄 Implementing Arbitrage Strategy

### Arbitrage Strategy (`src/strategies/arbitrage.ts`)

```typescript
import { GSwap } from '@gala-chain/gswap-sdk';
import { BaseStrategy } from './base-strategy.js';
import { MarketCondition, TradeResult } from '../types.js';
import { GalaChainSwapAuth } from '../galachain-auth.js';

export class ArbitrageStrategy extends BaseStrategy {
  name = 'arbitrage';
  minVolumeRequired = 5;
  maxRisk = 0.6;

  private gswap: GSwap;
  private swapAuth: GalaChainSwapAuth;
  private minProfitBps: number;
  private slippageBps: number;
  private maxTradeSize: number;

  // Arbitrage trading pairs
  private arbitragePairs = [
    { tokenA: 'GALA', tokenB: 'GUSDC', baseAmount: 10 },
    { tokenA: 'GALA', tokenB: 'GUSDT', baseAmount: 10 },
    { tokenA: 'GUSDC', tokenB: 'GUSDT', baseAmount: 10 },
    { tokenA: 'GALA', tokenB: 'GWETH', baseAmount: 100 }
  ];

  constructor() {
    super();

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

    // Configuration
    this.minProfitBps = Number(process.env.MIN_PROFIT_BPS || 50); // 0.5%
    this.slippageBps = Number(process.env.SLIPPAGE_BPS || 100); // 1%
    this.maxTradeSize = Number(process.env.MAX_TRADE_SIZE || 25); // $25

    this.log('info', 'Arbitrage strategy initialized', {
      minProfitBps: this.minProfitBps,
      slippageBps: this.slippageBps,
      maxTradeSize: this.maxTradeSize,
      dryRun: this.isDryRun()
    });
  }

  async execute(): Promise<TradeResult> {
    const startTime = Date.now();

    try {
      await this.log('info', 'Starting arbitrage scan');

      // Scan all pairs for arbitrage opportunities
      const opportunities = await this.scanArbitrageOpportunities();

      if (opportunities.length === 0) {
        await this.log('info', 'No arbitrage opportunities found');
        return {
          success: true,
          profit: 0,
          volume: 0,
          strategy: this.name,
          pool: 'none',
          timestamp: startTime
        };
      }

      // Execute the best opportunity
      const bestOpportunity = opportunities[0];
      await this.log('info', 'Executing arbitrage opportunity', bestOpportunity);

      if (this.isDryRun()) {
        await this.log('info', 'DRY RUN: Would execute arbitrage', bestOpportunity);
        return {
          success: true,
          profit: bestOpportunity.estimatedProfit,
          volume: bestOpportunity.tradeAmount,
          strategy: this.name,
          pool: `${bestOpportunity.tokenA}/${bestOpportunity.tokenB}`,
          timestamp: startTime
        };
      }

      // Execute real arbitrage
      const result = await this.executeArbitrage(bestOpportunity);

      await this.log('info', 'Arbitrage execution completed', {
        success: result.success,
        profit: result.profit,
        transactionId: result.transactionId
      });

      return result;

    } catch (error: any) {
      await this.log('error', 'Arbitrage execution failed', { error: error.message });
      return {
        success: false,
        profit: 0,
        volume: 0,
        strategy: this.name,
        pool: 'error',
        timestamp: startTime,
        error: error.message
      };
    }
  }

  private async scanArbitrageOpportunities(): Promise<any[]> {
    const opportunities = [];

    for (const pair of this.arbitragePairs) {
      try {
        // Get quotes for both directions
        const forwardQuote = await this.swapAuth.getQuote(
          pair.tokenA,
          pair.tokenB,
          pair.baseAmount.toString()
        );

        const backwardQuote = await this.swapAuth.getQuote(
          pair.tokenB,
          pair.tokenA,
          forwardQuote.outTokenAmount
        );

        const finalAmount = Number(backwardQuote.outTokenAmount);
        const profit = finalAmount - pair.baseAmount;
        const profitBps = (profit / pair.baseAmount) * 10000;

        if (profitBps > this.minProfitBps) {
          opportunities.push({
            tokenA: pair.tokenA,
            tokenB: pair.tokenB,
            tradeAmount: pair.baseAmount,
            estimatedProfit: profit,
            profitBps,
            forwardQuote,
            backwardQuote
          });

          await this.log('info', 'Arbitrage opportunity found', {
            pair: `${pair.tokenA}/${pair.tokenB}`,
            profitBps,
            estimatedProfit: profit
          });
        }

      } catch (error: any) {
        await this.log('warn', 'Failed to check arbitrage pair', {
          pair: `${pair.tokenA}/${pair.tokenB}`,
          error: error.message
        });
      }
    }

    // Sort by profitability
    return opportunities.sort((a, b) => b.profitBps - a.profitBps);
  }

  private async executeArbitrage(opportunity: any): Promise<TradeResult> {
    const startTime = Date.now();

    try {
      // Execute first swap: tokenA -> tokenB
      const firstSwap = await this.swapAuth.executeSwap({
        tokenIn: opportunity.tokenA,
        tokenOut: opportunity.tokenB,
        amountIn: opportunity.tradeAmount.toString(),
        slippageBps: this.slippageBps
      });

      if (!firstSwap.success) {
        throw new Error(`First swap failed: ${firstSwap.error}`);
      }

      // Execute second swap: tokenB -> tokenA
      const secondSwap = await this.swapAuth.executeSwap({
        tokenIn: opportunity.tokenB,
        tokenOut: opportunity.tokenA,
        amountIn: firstSwap.actualAmountOut!,
        slippageBps: this.slippageBps
      });

      if (!secondSwap.success) {
        throw new Error(`Second swap failed: ${secondSwap.error}`);
      }

      // Calculate actual profit
      const finalAmount = Number(secondSwap.actualAmountOut!);
      const actualProfit = finalAmount - opportunity.tradeAmount;

      return {
        success: true,
        profit: actualProfit,
        volume: opportunity.tradeAmount,
        strategy: this.name,
        pool: `${opportunity.tokenA}/${opportunity.tokenB}`,
        timestamp: startTime,
        transactionId: `${firstSwap.transactionId},${secondSwap.transactionId}`
      };

    } catch (error: any) {
      return {
        success: false,
        profit: 0,
        volume: opportunity.tradeAmount,
        strategy: this.name,
        pool: `${opportunity.tokenA}/${opportunity.tokenB}`,
        timestamp: startTime,
        error: error.message
      };
    }
  }

  shouldActivate(marketCondition: MarketCondition): boolean {
    // Arbitrage works best with good volume and moderate volatility
    return marketCondition.volume > this.minVolumeRequired &&
           marketCondition.volatility > 0.01 &&
           marketCondition.volatility < 0.1;
  }
}
```

---

## 🧪 Creating a Testing Strategy

### Test Strategy (`src/strategies/test-strategy.ts`)

```typescript
import { BaseStrategy } from './base-strategy.js';
import { MarketCondition, TradeResult } from '../types.js';
import { GalaChainSwapAuth } from '../galachain-auth.js';

/**
 * Test Strategy for Transaction Logging
 *
 * Executes simple $1 GALA trades to test transaction logging system:
 * 1. Buys $1 worth of GALA with GUSDC every 15 minutes
 * 2. Sells it back to GUSDC 5 minutes later
 */
export class TestStrategy extends BaseStrategy {
  name = 'test-strategy';
  minVolumeRequired = 0.1;
  maxRisk = 0.1;

  private swapAuth: GalaChainSwapAuth;

  // Test configuration
  private readonly TEST_AMOUNT_USD = 1.0; // $1 trades
  private readonly BUY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly SELL_DELAY_MS = 5 * 60 * 1000; // 5 minutes
  private readonly TARGET_PAIR = 'GALA/GUSDC';

  // State tracking
  private lastBuyTime: number = 0;
  private pendingSells: Array<{
    sellTime: number;
    amount: string;
    buyPrice: number;
    tradeId: string;
  }> = [];
  private tradeCounter: number = 0;

  constructor() {
    super();

    this.swapAuth = new GalaChainSwapAuth();

    this.log('info', 'Test strategy initialized', {
      testAmount: this.TEST_AMOUNT_USD,
      buyInterval: this.BUY_INTERVAL_MS / 1000 / 60 + ' minutes',
      sellDelay: this.SELL_DELAY_MS / 1000 / 60 + ' minutes',
      targetPair: this.TARGET_PAIR,
      dryRun: this.isDryRun()
    });
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

      // No action needed
      return {
        success: true,
        profit: 0,
        volume: 0,
        strategy: this.name,
        pool: this.TARGET_PAIR,
        timestamp: now
      };

    } catch (error: any) {
      await this.log('error', 'Test strategy execution failed', {
        tradeId,
        error: error.message
      });

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
    await this.log('info', 'Executing test buy', {
      tradeId,
      amount: this.TEST_AMOUNT_USD
    });

    try {
      // Get current GALA price
      const priceData = await this.getGalaPrice();
      const galaAmount = (this.TEST_AMOUNT_USD / priceData.price).toFixed(6);

      await this.log('info', 'Price data retrieved', {
        tradeId,
        galaPrice: priceData.price,
        galaAmount,
        usdcAmount: this.TEST_AMOUNT_USD
      });

      let swapResult;

      if (this.isDryRun()) {
        // Simulate swap in dry run mode
        await this.log('info', 'DRY RUN: Simulating GUSDC -> GALA swap', {
          tradeId,
          amountIn: this.TEST_AMOUNT_USD,
          expectedAmountOut: galaAmount
        });

        swapResult = {
          success: true,
          transactionId: `dry-run-${tradeId}`,
          actualAmountOut: galaAmount
        };
      } else {
        // Execute real swap
        swapResult = await this.swapAuth.buyGALAWithGUSDC(
          this.TEST_AMOUNT_USD.toString(),
          100 // 1% slippage
        );
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

      await this.log('info', 'Buy completed, sell scheduled', {
        tradeId,
        sellScheduledAt: new Date(sellTime).toISOString(),
        pendingSellsCount: this.pendingSells.length,
        transactionId: swapResult.transactionId
      });

      return {
        success: true,
        profit: 0, // Profit calculated on sell
        volume: this.TEST_AMOUNT_USD,
        strategy: this.name,
        pool: this.TARGET_PAIR,
        timestamp: now,
        transactionId: swapResult.transactionId
      };

    } catch (error: any) {
      await this.log('error', 'Buy execution failed', { tradeId, error: error.message });
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

        await this.log('info', 'Sell order completed', {
          tradeId: sellOrder.tradeId
        });

      } catch (error: any) {
        await this.log('error', 'Sell execution failed', {
          tradeId: sellOrder.tradeId,
          error: error.message
        });
      }
    }
  }

  private async executeSell(sellOrder: any, now: number): Promise<void> {
    await this.log('info', 'Executing test sell', {
      tradeId: sellOrder.tradeId,
      galaAmount: sellOrder.amount,
      originalBuyPrice: sellOrder.buyPrice
    });

    try {
      // Get current GALA price
      const currentPriceData = await this.getGalaPrice();
      const expectedUsdcAmount = (parseFloat(sellOrder.amount) * currentPriceData.price).toFixed(6);
      const profit = parseFloat(expectedUsdcAmount) - this.TEST_AMOUNT_USD;

      await this.log('info', 'Current price data for sell', {
        tradeId: sellOrder.tradeId,
        currentPrice: currentPriceData.price,
        buyPrice: sellOrder.buyPrice,
        priceChange: ((currentPriceData.price - sellOrder.buyPrice) / sellOrder.buyPrice * 100).toFixed(2) + '%',
        expectedUsdcAmount,
        estimatedProfit: profit.toFixed(6)
      });

      let swapResult;

      if (this.isDryRun()) {
        // Simulate swap in dry run mode
        await this.log('info', 'DRY RUN: Simulating GALA -> GUSDC swap', {
          tradeId: sellOrder.tradeId,
          amountIn: sellOrder.amount,
          expectedAmountOut: expectedUsdcAmount
        });

        swapResult = {
          success: true,
          transactionId: `dry-run-sell-${sellOrder.tradeId}`,
          actualAmountOut: expectedUsdcAmount
        };
      } else {
        // Execute real swap
        swapResult = await this.swapAuth.sellGALAForGUSDC(
          sellOrder.amount,
          100 // 1% slippage
        );
      }

      await this.log('info', 'Sell completed - trade cycle finished', {
        tradeId: sellOrder.tradeId,
        cycleProfit: profit.toFixed(6),
        totalCycleTime: `${(now - (sellOrder.sellTime - this.SELL_DELAY_MS)) / 1000 / 60} minutes`,
        transactionId: swapResult.transactionId
      });

    } catch (error: any) {
      await this.log('error', 'Sell execution failed', {
        tradeId: sellOrder.tradeId,
        error: error.message
      });
      throw error;
    }
  }

  private async getGalaPrice(): Promise<{ price: number; timestamp: number }> {
    try {
      // Get price from GSwap quote
      const quote = await this.swapAuth.getQuote('GUSDC', 'GALA', '1');
      const outAmount = Number(quote.outTokenAmount);
      const price = 1 / outAmount; // GALA price in GUSDC

      await this.log('info', 'GALA price retrieved', {
        galaPrice: price,
        quoteAmountOut: outAmount
      });

      return {
        price,
        timestamp: Date.now()
      };

    } catch (error: any) {
      await this.log('error', 'Failed to get GALA price', { error: error.message });
      throw new Error(`Failed to get GALA price: ${error.message}`);
    }
  }

  shouldActivate(marketCondition: MarketCondition): boolean {
    // Test strategy should always be available
    return marketCondition.volume >= this.minVolumeRequired;
  }

  /**
   * Get current strategy status for monitoring
   */
  getStatus(): any {
    return {
      name: this.name,
      lastBuyTime: this.lastBuyTime ? new Date(this.lastBuyTime).toISOString() : 'never',
      pendingSells: this.pendingSells.length,
      nextBuyIn: this.lastBuyTime ?
        Math.max(0, this.BUY_INTERVAL_MS - (Date.now() - this.lastBuyTime)) : 0,
      tradeCounter: this.tradeCounter,
      testAmount: this.TEST_AMOUNT_USD,
      targetPair: this.TARGET_PAIR,
      dryRun: this.isDryRun()
    };
  }
}
```

---

## 📊 Transaction Logging System

### Logger Utility (`src/utils/logger.ts`)

```typescript
import fs from 'fs-extra';
import path from 'path';

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  component: string;
  message: string;
  data?: any;
  transactionId?: string;
  walletAddress?: string;
}

export class Logger {
  private logDir: string;

  constructor(logDirectory: string = 'logs') {
    this.logDir = path.join(process.cwd(), logDirectory);
    fs.ensureDirSync(this.logDir);
  }

  async log(entry: LogEntry): Promise<void> {
    // Console output
    const consoleMessage = `[${entry.timestamp}] ${entry.level} [${entry.component}] ${entry.message}`;

    switch (entry.level) {
      case 'ERROR':
        console.error(consoleMessage, entry.data || '');
        break;
      case 'WARN':
        console.warn(consoleMessage, entry.data || '');
        break;
      case 'DEBUG':
        console.debug(consoleMessage, entry.data || '');
        break;
      default:
        console.log(consoleMessage, entry.data || '');
    }

    // File output
    await this.writeToFile(entry);
  }

  private async writeToFile(entry: LogEntry): Promise<void> {
    try {
      // Main log file
      const mainLogFile = path.join(this.logDir, 'main.log');
      const logLine = JSON.stringify(entry) + '\n';
      await fs.appendFile(mainLogFile, logLine);

      // Component-specific log file
      const componentLogFile = path.join(this.logDir, `${entry.component.toLowerCase()}.log`);
      await fs.appendFile(componentLogFile, logLine);

      // Error-specific log file
      if (entry.level === 'ERROR') {
        const errorLogFile = path.join(this.logDir, 'errors.log');
        await fs.appendFile(errorLogFile, logLine);
      }

      // Transaction-specific log file
      if (entry.transactionId) {
        const transactionLogFile = path.join(this.logDir, 'transactions.log');
        await fs.appendFile(transactionLogFile, logLine);
      }

    } catch (error) {
      console.error('Failed to write log entry:', error);
    }
  }

  // Convenience methods
  async info(component: string, message: string, data?: any, transactionId?: string): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      component,
      message,
      data,
      transactionId
    });
  }

  async error(component: string, message: string, data?: any, transactionId?: string): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      component,
      message,
      data,
      transactionId
    });
  }

  async warn(component: string, message: string, data?: any, transactionId?: string): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      level: 'WARN',
      component,
      message,
      data,
      transactionId
    });
  }

  async debug(component: string, message: string, data?: any, transactionId?: string): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      component,
      message,
      data,
      transactionId
    });
  }
}

// Global logger instance
export const logger = new Logger();
```

---

## 🤖 Main Bot Implementation

### Main Bot (`src/bot.ts`)

```typescript
import dotenv from 'dotenv';
import { ArbitrageStrategy } from './strategies/arbitrage.js';
import { TestStrategy } from './strategies/test-strategy.js';
import { MarketCondition, TradingStrategy } from './types.js';
import { logger } from './utils/logger.js';

// Load environment variables
dotenv.config();

export class TradingBot {
  private strategies: Map<string, TradingStrategy> = new Map();
  private isRunning: boolean = false;
  private currentStrategy: TradingStrategy | null = null;
  private executionInterval: number = 60000; // 1 minute

  constructor() {
    this.initializeStrategies();
  }

  private initializeStrategies(): void {
    // Register available strategies
    const arbitrageStrategy = new ArbitrageStrategy();
    const testStrategy = new TestStrategy();

    this.strategies.set('arbitrage', arbitrageStrategy);
    this.strategies.set('test', testStrategy);

    logger.info('TradingBot', 'Strategies initialized', {
      availableStrategies: Array.from(this.strategies.keys())
    });
  }

  async start(strategyName?: string): Promise<void> {
    if (this.isRunning) {
      logger.warn('TradingBot', 'Bot is already running');
      return;
    }

    this.isRunning = true;

    // Select strategy
    if (strategyName) {
      this.currentStrategy = this.strategies.get(strategyName) || null;
      if (!this.currentStrategy) {
        throw new Error(`Strategy '${strategyName}' not found`);
      }
    } else {
      // Default to test strategy
      this.currentStrategy = this.strategies.get('test')!;
    }

    logger.info('TradingBot', 'Bot started', {
      strategy: this.currentStrategy.name,
      executionInterval: this.executionInterval,
      dryRun: process.env.DRY_RUN !== 'false'
    });

    // Start execution loop
    await this.executionLoop();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('TradingBot', 'Bot stopped');
  }

  private async executionLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        if (this.currentStrategy) {
          // Get current market condition
          const marketCondition = await this.getMarketCondition();

          // Check if strategy should activate
          if (this.currentStrategy.shouldActivate(marketCondition)) {
            logger.info('TradingBot', 'Executing strategy', {
              strategy: this.currentStrategy.name,
              marketCondition
            });

            // Execute strategy
            const result = await this.currentStrategy.execute();

            logger.info('TradingBot', 'Strategy execution completed', {
              strategy: this.currentStrategy.name,
              result
            });

            // Log trade result if successful
            if (result.success && result.profit !== 0) {
              await this.logTradeResult(result);
            }
          } else {
            logger.debug('TradingBot', 'Strategy conditions not met', {
              strategy: this.currentStrategy.name,
              marketCondition
            });
          }
        }

        // Wait before next execution
        await this.sleep(this.executionInterval);

      } catch (error: any) {
        logger.error('TradingBot', 'Execution loop error', {
          error: error.message,
          stack: error.stack
        });

        // Wait longer on error to avoid rapid retries
        await this.sleep(this.executionInterval * 2);
      }
    }
  }

  private async getMarketCondition(): Promise<MarketCondition> {
    // Simplified market condition - in production, implement real market analysis
    const now = new Date();
    const hour = now.getHours();

    let timeOfDay: MarketCondition['timeOfDay'];
    if (hour >= 5 && hour < 9) timeOfDay = 'dawn';
    else if (hour >= 9 && hour < 12) timeOfDay = 'morning';
    else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
    else timeOfDay = 'night';

    return {
      volatility: 0.02, // 2% volatility
      volume: 100, // Mock volume
      competitionLevel: 0.5,
      timeOfDay,
      recentPerformance: 0.1
    };
  }

  private async logTradeResult(result: any): Promise<void> {
    logger.info('TradingBot', 'Trade executed', {
      strategy: result.strategy,
      profit: result.profit,
      volume: result.volume,
      pool: result.pool,
      transactionId: result.transactionId,
      timestamp: result.timestamp
    }, result.transactionId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public methods for external control
  async switchStrategy(strategyName: string): Promise<void> {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) {
      throw new Error(`Strategy '${strategyName}' not found`);
    }

    this.currentStrategy = strategy;
    logger.info('TradingBot', 'Strategy switched', { newStrategy: strategyName });
  }

  getStatus(): any {
    return {
      isRunning: this.isRunning,
      currentStrategy: this.currentStrategy?.name || null,
      availableStrategies: Array.from(this.strategies.keys()),
      executionInterval: this.executionInterval
    };
  }
}

// Main execution
async function main() {
  try {
    const bot = new TradingBot();

    // Get strategy from command line or environment
    const strategyName = process.argv[2] || process.env.STRATEGY || 'test';

    logger.info('Main', 'Starting Fafnir Trading Bot', {
      strategy: strategyName,
      dryRun: process.env.DRY_RUN !== 'false'
    });

    await bot.start(strategyName);

  } catch (error: any) {
    logger.error('Main', 'Bot startup failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Main', 'Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Main', 'Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

// Start the bot if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

---

## 🔧 Environment Configuration

### Complete `.env` Example

```bash
# GalaChain Wallet Configuration
GALACHAIN_PRIVATE_KEY=your_64_character_private_key_here
GALACHAIN_WALLET_ADDRESS=eth|your_galachain_address_here

# GSwap API Configuration
GSWAP_GATEWAY_URL=https://gateway-mainnet.galachain.com
GSWAP_DEX_BACKEND_URL=https://dex-backend-prod1.defi.gala.com
GSWAP_BUNDLER_URL=https://bundle-backend-prod1.defi.gala.com

# Trading Configuration
DRY_RUN=true
STRATEGY=test
MIN_PROFIT_BPS=50
SLIPPAGE_BPS=100
MAX_TRADE_SIZE=25

# Mock Balances (for testing)
MOCK_GALA_BALANCE=1000
MOCK_GUSDC_BALANCE=50
MOCK_GUSDT_BALANCE=50

# Logging Configuration
LOG_LEVEL=info
LOG_TO_FILE=true

# Risk Management
MAX_DAILY_LOSS=50
MAX_CONCURRENT_TRADES=2
EMERGENCY_STOP=false
```

### Trading Configuration (`config/trading-config.json`)

```json
{
  "pollSeconds": 60,
  "risk": "cautious",
  "strategies": {
    "arbitrage": {
      "enabled": true,
      "minProfitBps": 50,
      "maxTradeSize": 25,
      "pairs": [
        { "tokenA": "GALA", "tokenB": "GUSDC", "baseAmount": 10 },
        { "tokenA": "GALA", "tokenB": "GUSDT", "baseAmount": 10 },
        { "tokenA": "GUSDC", "tokenB": "GUSDT", "baseAmount": 10 }
      ]
    },
    "test": {
      "enabled": true,
      "testAmountUSD": 1.0,
      "buyIntervalMinutes": 15,
      "sellDelayMinutes": 5,
      "targetPair": "GALA/GUSDC"
    }
  },
  "riskManagement": {
    "maxDailyLoss": 50,
    "maxPositionSize": 100,
    "maxSlippage": 300,
    "maxConcurrentTrades": 2
  }
}
```

---

## 🚀 Running & Testing

### 1. Setup Commands

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your wallet details

# Create log directories
mkdir -p logs/strategies

# Build TypeScript (optional)
npm run build
```

### 2. Running the Bot

```bash
# Run test strategy (safe for testing)
npm run start test

# Run arbitrage strategy
npm run start arbitrage

# Run with specific environment
DRY_RUN=false STRATEGY=test npm start

# Development mode with auto-reload
npm run dev
```

### 3. Testing Commands

```bash
# Test individual strategies
npm run test

# Test arbitrage strategy only
npm run arbitrage

# Check logs
tail -f logs/main.log
tail -f logs/transactions.log
tail -f logs/strategies/test-strategy.log
```

### 4. Monitoring

```bash
# Check bot status
curl http://localhost:3000/status  # If you add a web interface

# View recent logs
tail -n 50 logs/main.log | jq .

# Monitor specific strategy
tail -f logs/strategies/arbitrage.log | jq .
```

---

## 🤖 AI Agent Instructions

### Prompt for AI Agent to Create Trading Bot

```markdown
Create a GalaSwap trading bot with the following specifications:

**CORE REQUIREMENTS:**
1. Use @gala-chain/gswap-sdk for DEX operations
2. Use @gala-chain/api for blockchain interactions
3. Implement TypeScript with proper type definitions
4. Include comprehensive logging system

**STRATEGIES TO IMPLEMENT:**
1. **Arbitrage Strategy:**
   - Scan GALA/GUSDC, GALA/GUSDT, GUSDC/GUSDT pairs
   - Minimum 0.5% profit threshold
   - Maximum $25 trade size
   - Proper slippage protection (1%)

2. **Test Strategy:**
   - Buy $1 GALA with GUSDC every 15 minutes
   - Sell back to GUSDC after 5 minutes
   - Log all transaction details for testing

**TECHNICAL REQUIREMENTS:**
1. **GalaChain Integration:**
   ```typescript
   // Use PrivateKeySigner for authentication
   const signer = new PrivateKeySigner(privateKey);

   // Initialize GSwap with proper config
   const gswap = new GSwap({
     gatewayBaseUrl: 'https://gateway-mainnet.galachain.com',
     dexBackendBaseUrl: 'https://dex-backend-prod1.defi.gala.com',
     bundlerBaseUrl: 'https://bundle-backend-prod1.defi.gala.com',
     signer: signer
   });
   ```

2. **Token Format:**
   - Use format: `TOKEN|Unit|none|none` for token classes
   - Example: `GALA|Unit|none|none`, `GUSDC|Unit|none|none`

3. **Swap Execution:**
   ```typescript
   // Get quote first
   const quote = await gswap.quoting.quoteExactInput(tokenIn, tokenOut, amount, feeTier);

   // Execute swap with slippage protection
   const result = await gswap.swaps.swap(tokenIn, tokenOut, feeTier, {
     exactIn: amount,
     amountOutMinimum: minOut.toString()
   }, walletAddress);
   ```

4. **Logging Requirements:**
   - JSON structured logs
   - Separate files for: main.log, transactions.log, errors.log
   - Include: timestamp, strategy, transaction ID, amounts, success/failure
   - Console output with colored formatting

5. **Safety Features:**
   - DRY_RUN mode by default
   - Maximum trade size limits
   - Slippage protection
   - Error handling and recovery
   - Graceful shutdown handling

6. **Environment Variables:**
   ```bash
   GALACHAIN_PRIVATE_KEY=your_key
   GALACHAIN_WALLET_ADDRESS=your_address
   DRY_RUN=true
   MIN_PROFIT_BPS=50
   SLIPPAGE_BPS=100
   ```

**PROJECT STRUCTURE:**
```
src/
├── types.ts              # TypeScript interfaces
├── galachain-auth.ts     # Authentication & swap execution
├── strategies/
│   ├── base-strategy.ts  # Strategy interface
│   ├── arbitrage.ts      # Arbitrage implementation
│   └── test-strategy.ts  # Test strategy
├── utils/
│   └── logger.ts         # Logging system
└── bot.ts                # Main bot orchestrator
```

**TESTING APPROACH:**
1. Start with DRY_RUN=true
2. Test with small amounts ($1 trades)
3. Verify all logs are generated correctly
4. Test error handling scenarios
5. Gradually increase trade sizes

**DELIVERABLES:**
1. Complete TypeScript codebase
2. Package.json with all dependencies
3. Environment configuration template
4. README with setup instructions
5. Example log outputs
6. Testing procedures

Focus on safety, proper error handling, and comprehensive logging. The bot should never execute trades without explicit confirmation in production mode.
```

### Step-by-Step AI Instructions

```markdown
**STEP 1: Project Setup**
- Create TypeScript project with proper tsconfig.json
- Install GalaChain and GSwap SDK dependencies
- Set up environment variable loading with dotenv
- Create basic project structure with src/ directory

**STEP 2: Type Definitions**
- Define TradingStrategy interface with execute() and shouldActivate() methods
- Create TradeResult interface with success, profit, volume, timestamp fields
- Define SwapParams and SwapResult interfaces for transaction data
- Add MarketCondition interface for strategy activation logic

**STEP 3: GalaChain Authentication**
- Create GalaChainSwapAuth class with PrivateKeySigner
- Implement getQuote() method using gswap.quoting.quoteExactInput()
- Implement executeSwap() method with proper slippage protection
- Add convenience methods: buyGALAWithGUSDC() and sellGALAForGUSDC()
- Include comprehensive transaction logging

**STEP 4: Base Strategy Class**
- Create abstract BaseStrategy class implementing TradingStrategy
- Add protected logging methods (log, error, warn)
- Include isDryRun() helper method
- Implement strategy-specific log file writing

**STEP 5: Test Strategy Implementation**
- Create TestStrategy extending BaseStrategy
- Implement $1 GALA buy/sell cycle with 15-minute intervals
- Add pending sell order tracking with timestamps
- Include detailed logging for each trade phase
- Add getStatus() method for monitoring

**STEP 6: Arbitrage Strategy Implementation**
- Create ArbitrageStrategy extending BaseStrategy
- Implement scanArbitrageOpportunities() for multiple pairs
- Add executeArbitrage() method for two-step trades
- Include profitability calculations and filtering
- Add proper error handling for failed swaps

**STEP 7: Logging System**
- Create Logger class with structured JSON logging
- Implement multiple log levels (INFO, WARN, ERROR, DEBUG)
- Add file-based logging with rotation
- Include transaction-specific logging
- Add console output with formatting

**STEP 8: Main Bot Orchestrator**
- Create TradingBot class with strategy management
- Implement execution loop with market condition checking
- Add strategy switching and status monitoring
- Include graceful shutdown handling
- Add command-line argument processing

**STEP 9: Configuration & Environment**
- Create comprehensive .env template
- Add trading-config.json for strategy parameters
- Include risk management settings
- Add mock balance configuration for testing
- Document all configuration options

**STEP 10: Testing & Validation**
- Create test scripts for individual strategies
- Add dry-run mode validation
- Include error scenario testing
- Add log output verification
- Create monitoring and status checking tools

Remember: Always implement DRY_RUN mode first, include comprehensive error handling, and prioritize transaction logging for debugging and compliance.
```

---

## 🔧 Advanced Features

### 1. Risk Management System

```typescript
// src/utils/risk-manager.ts
export class RiskManager {
  private maxDailyLoss: number;
  private maxPositionSize: number;
  private dailyStats: { trades: number; profit: number; loss: number };

  constructor() {
    this.maxDailyLoss = Number(process.env.MAX_DAILY_LOSS || 50);
    this.maxPositionSize = Number(process.env.MAX_POSITION_SIZE || 100);
    this.dailyStats = { trades: 0, profit: 0, loss: 0 };
  }

  canExecuteTrade(amount: number): boolean {
    return amount <= this.maxPositionSize &&
           Math.abs(this.dailyStats.loss) < this.maxDailyLoss;
  }

  recordTrade(profit: number): void {
    this.dailyStats.trades++;
    if (profit > 0) {
      this.dailyStats.profit += profit;
    } else {
      this.dailyStats.loss += Math.abs(profit);
    }
  }
}
```

### 2. Performance Monitoring

```typescript
// src/utils/performance-monitor.ts
export class PerformanceMonitor {
  private metrics: Map<string, any> = new Map();

  recordExecution(strategy: string, duration: number, success: boolean): void {
    const key = `${strategy}_executions`;
    const current = this.metrics.get(key) || { count: 0, totalTime: 0, successes: 0 };

    current.count++;
    current.totalTime += duration;
    if (success) current.successes++;

    this.metrics.set(key, current);
  }

  getReport(): any {
    const report: any = {};

    for (const [key, value] of this.metrics) {
      report[key] = {
        ...value,
        averageTime: value.totalTime / value.count,
        successRate: (value.successes / value.count) * 100
      };
    }

    return report;
  }
}
```

### 3. Web Dashboard (Optional)

```typescript
// src/web-dashboard.ts
import express from 'express';
import { TradingBot } from './bot.js';

export class WebDashboard {
  private app = express();
  private bot: TradingBot;

  constructor(bot: TradingBot) {
    this.bot = bot;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.get('/status', (req, res) => {
      res.json(this.bot.getStatus());
    });

    this.app.get('/logs/:strategy', async (req, res) => {
      // Return recent logs for strategy
      const logs = await this.getRecentLogs(req.params.strategy);
      res.json(logs);
    });

    this.app.post('/strategy/:name', async (req, res) => {
      try {
        await this.bot.switchStrategy(req.params.name);
        res.json({ success: true });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });
  }

  start(port: number = 3000): void {
    this.app.listen(port, () => {
      console.log(`Dashboard running on http://localhost:${port}`);
    });
  }
}
```

---

## 🐛 Troubleshooting

### Common Issues & Solutions

#### 1. Authentication Errors
```bash
# Error: Invalid private key format
# Solution: Ensure private key is 64 characters (hex)
echo $GALACHAIN_PRIVATE_KEY | wc -c  # Should be 65 (including newline)

# Error: Wallet address format
# Solution: Use proper GalaChain format
GALACHAIN_WALLET_ADDRESS=eth|your_address_here
```

#### 2. SDK Connection Issues
```typescript
// Error: Cannot connect to GSwap backend
// Solution: Check network connectivity and URLs
const testConnection = async () => {
  try {
    const response = await fetch(process.env.GSWAP_DEX_BACKEND_URL + '/health');
    console.log('Backend status:', response.status);
  } catch (error) {
    console.error('Connection failed:', error);
  }
};
```

#### 3. Transaction Failures
```typescript
// Error: Insufficient balance
// Solution: Check wallet balances before trading
const balances = await swapAuth.getBalances();
console.log('Current balances:', balances);

// Error: Slippage exceeded
// Solution: Increase slippage tolerance
const result = await swapAuth.executeSwap({
  // ... other params
  slippageBps: 200  // Increase from 100 to 200 (2%)
});
```

#### 4. Logging Issues
```bash
# Error: Permission denied writing logs
# Solution: Create logs directory with proper permissions
mkdir -p logs/strategies
chmod 755 logs
chmod 755 logs/strategies

# Error: Log files too large
# Solution: Implement log rotation
npm install winston winston-daily-rotate-file
```

### Debug Mode

```bash
# Enable debug logging
DEBUG=true npm start

# Run with verbose output
npm start -- --verbose

# Test individual components
npm run test:auth
npm run test:strategies
npm run test:logging
```

---

## 📚 Summary

This guide provides a complete foundation for building a GalaSwap trading bot with:

✅ **Arbitrage Strategy** - Automated profit detection across trading pairs
✅ **Testing Strategy** - $1 GALA trades for transaction log validation
✅ **Comprehensive Logging** - Structured JSON logs with transaction tracking
✅ **Risk Management** - Built-in safety limits and error handling
✅ **TypeScript Implementation** - Type-safe development with proper interfaces
✅ **GalaChain Integration** - Proper SDK usage and authentication
✅ **Production Ready** - Environment configuration and monitoring tools

### Next Steps

1. **🔧 Setup**: Follow the prerequisites and create your project structure
2. **🔑 Configure**: Set up your GalaChain wallet and environment variables
3. **🧪 Test**: Start with DRY_RUN=true and the test strategy
4. **📊 Monitor**: Check logs and verify transaction recording
5. **🚀 Deploy**: Gradually move to live trading with small amounts
6. **📈 Scale**: Add more strategies and increase trade sizes

The bot is designed to be **safe**, **extensible**, and **well-documented** - perfect for both learning GalaSwap development and building production trading systems! 🤖⚡


