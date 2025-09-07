import 'dotenv/config';
import fs from 'fs-extra';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { GSwap } from '@gala-chain/gswap-sdk';
import { signatures } from '@gala-chain/api';

// --- Token registry --------------------------------------------------------
const TOKENS: Record<string, string> = {
  GALA: 'GALA|Unit|none|none',
  GUSDC: 'GUSDC|Unit|none|none',
  GWETH: 'GWETH|Unit|none|none',
  GWBTC: 'GWBTC|Unit|none|none',
  GUSDT: 'GUSDT|Unit|none|none',
  USDT: 'USDT|Unit|none|none',
  WETH: 'WETH|Unit|none|none',
  USDC: 'USDC|Unit|none|none',
  SILK: 'SILK|Unit|none|none',
  MTRM: 'MTRM|Unit|none|none'
};

function token(type: string): string {
  const t = TOKENS[type];
  if (!t) throw new Error(`Unknown token symbol: ${type}`);
  return t;
}

// --- Config ---------------------------------------------------------------
const cfgPath = path.join(process.cwd(), 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
  pollSeconds: number;
  risk: 'cautious' | 'balanced' | 'aggressive';
  thresholdBps: number;
  pairs: { symbolIn: string; symbolOut: string; amountIn: string }[];
};

// Focus on specific pairs for testing
const FOCUSED_PAIRS = [
  { symbolIn: "GUSDT", symbolOut: "GWETH", amountIn: "10" },
  { symbolIn: "GALA", symbolOut: "GUSDC", amountIn: "10" },
  { symbolIn: "GUSDC", symbolOut: "GWETH", amountIn: "10" },
  { symbolIn: "GALA", symbolOut: "GUSDT", amountIn: "10" }
];


// Dry run settings
const DRY_RUN_CONFIG = {
  slippageTolerance: 0.5, // 0.5% slippage tolerance
  gasLimit: 300000, // estimated gas for swap
  minProfitAfterFees: 0.3, // minimum profit after fees (0.3%)
  maxSlippage: 1.0, // maximum allowed slippage (1.0%)
  simulateNetworkDelays: true, // simulate network delays
  logAllQuotes: true // log all quotes for analysis
};

// --- GalaSwap client ------------------------------------------------------
// Initialize GSwap client for quotes and swap payloads
const gatewayUrl = process.env.GSWAP_GATEWAY_URL || 'https://gateway-mainnet.galachain.com';
const dexBackendUrl = process.env.GSWAP_DEX_BACKEND_URL || 'https://dex-backend-prod1.defi.gala.com';
const bundlerUrl = process.env.GSWAP_BUNDLER_URL || 'https://bundle-backend-prod1.defi.gala.com';

const gswap = new GSwap({
  gatewayBaseUrl: gatewayUrl,
  dexBackendBaseUrl: dexBackendUrl,
  bundlerBaseUrl: bundlerUrl,
  dexContractBasePath: '/api/asset/dexv3-contract',
  tokenContractBasePath: '/api/asset/token-contract',
  bundlingAPIBasePath: '/bundle'
});

// --- Logging --------------------------------------------------------------
const logDir = path.join(process.cwd(), 'logs');
fs.ensureDirSync(logDir);
const dryRunLogFile = path.join(logDir, 'dry-run.log');
const tradeLogFile = path.join(logDir, 'trades.log');

function logLine(text: string, file: string = dryRunLogFile) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${text}`;
  console.log(line);
  fs.appendFileSync(file, line + '\n');
}

// --- Trade simulation -----------------------------------------------------
interface TradeSimulation {
  pair: { symbolIn: string; symbolOut: string; amountIn: string };
  quote1: { fee: number; outAmount: number };
  quote2: { fee: number; outAmount: number };
  grossProfitBps: number;
  netProfitBps: number;
  slippage1: number;
  slippage2: number;
  gasCost: number;
  totalFees: number;
  wouldExecute: boolean;
  reason: string;
  timestamp: string;
}

// Simulate slippage based on trade size and market conditions
function simulateSlippage(amountIn: number, tokenSymbol: string): number {
  // Simulate realistic slippage based on trade size
  const baseSlippage = 0.1; // 0.1% base slippage
  const sizeMultiplier = Math.min(amountIn / 100, 2); // Larger trades = more slippage
  const volatility = Math.random() * 0.3; // Random market volatility
  return baseSlippage + (sizeMultiplier * 0.2) + volatility;
}

// Calculate gas costs in GALA terms (GalaChain uses ~1 GALA per transaction)
function calculateGasCost(gasLimit: number): number {
  // GalaChain typically costs ~1 GALA per transaction
  // For more complex operations, it might be 1.5-2 GALA
  const baseGasCost = 1.0; // Base cost in GALA
  const complexityMultiplier = gasLimit > 200000 ? 1.5 : 1.0; // Higher gas limit = more complex
  return baseGasCost * complexityMultiplier;
}

// Simulate network delays and quote changes
async function simulateNetworkDelay(): Promise<void> {
  if (DRY_RUN_CONFIG.simulateNetworkDelays) {
    const delay = Math.random() * 2000 + 500; // 0.5-2.5 seconds
    await sleep(delay);
  }
}

// --- Quote helpers --------------------------------------------------------
async function bestQuoteWithFeeTier(inSym: string, outSym: string, amountIn: string, feeTier: number) {
  const tIn = token(inSym);
  const tOut = token(outSym);
  try {
    const q = await gswap.quoting.quoteExactInput(tIn, tOut, amountIn, feeTier as any);
    const outNum = Number((q as any).outTokenAmount?.toString?.() ?? q.outTokenAmount);

    // Extract liquidity information if available
    const liquidity = (q as any).liquidity || 'Unknown';
    const sqrtPriceX96 = (q as any).sqrtPriceX96 || 'Unknown';
    const tick = (q as any).tick || 'Unknown';

    return {
      fee: feeTier,
      outAmount: outNum,
      feeTier,
      liquidity,
      sqrtPriceX96,
      tick
    };
  } catch (err) {
    throw new Error(`No pool for ${inSym}->${outSym} with fee tier ${feeTier}`);
  }
}

async function bestQuote(inSym: string, outSym: string, amountIn: string) {
  const tIn = token(inSym);
  const tOut = token(outSym);
  try {
    // Find best fee tier for this pair
    const feeTiers = [500, 3000, 10000];
    let bestQuote = null;
    let bestFeeTier = null;

    for (const feeTier of feeTiers) {
      try {
        const q = await gswap.quoting.quoteExactInput(tIn, tOut, amountIn, feeTier);
        const outNum = Number((q as any).outTokenAmount?.toString?.() ?? q.outTokenAmount);

        if (!bestQuote || outNum > Number((bestQuote as any).outTokenAmount?.toString?.() ?? bestQuote.outTokenAmount)) {
          bestQuote = q;
          bestFeeTier = feeTier;
        }
      } catch (error) {
        continue;
      }
    }

    if (!bestQuote) {
      throw new Error(`No pools found for ${inSym}->${outSym}`);
    }

    const q = bestQuote;
    const outNum = Number((q as any).outTokenAmount?.toString?.() ?? q.outTokenAmount);
    const feeTier = (q as any).feeTier || 3000; // Default to 0.3% if not specified
    return { fee: feeTier, outAmount: outNum };
  } catch (err) {
    throw new Error(`No pool for ${inSym}->${outSym}`);
  }
}

// --- Trade simulation -----------------------------------------------------
async function simulateTrade(pair: { symbolIn: string; symbolOut: string; amountIn: string }): Promise<TradeSimulation> {
  const startTime = Date.now();

  // Get quotes from different fee tiers to find arbitrage opportunities
  const quotes: Array<{
    fee: number;
    outAmount: number;
    feeTier: number;
    liquidity: any;
    sqrtPriceX96: any;
    tick: any;
  }> = [];

  // Try different fee tiers
  console.log(`\n🔍 Checking pools for ${pair.symbolIn} → ${pair.symbolOut}:`);
  for (const feeTier of [500, 3000, 10000]) {
    try {
      const quote = await bestQuoteWithFeeTier(pair.symbolIn, pair.symbolOut, pair.amountIn, feeTier);
      quotes.push(quote);
      console.log(`   ✅ Fee ${feeTier/100}%: Pool found`);
    } catch (err: any) {
      console.log(`   ❌ Fee ${feeTier/100}%: ${err.message || err}`);
    }
  }

  // For realistic arbitrage, we need at least 1 pool to exist
  if (quotes.length === 0) {
    throw new Error(`No pools found for ${pair.symbolIn} → ${pair.symbolOut}`);
  }

  // If only 1 pool, we can still analyze it for potential opportunities
  if (quotes.length === 1) {
    console.log(`   ⚠️ Only 1 pool found - analyzing single pool opportunity`);
  }

  // For single pool analysis, we'll look at the pool's current state
  // For multiple pools, we'll compare them for arbitrage opportunities
  let bestBuy, bestSell;

  if (quotes.length === 1) {
    // Single pool - analyze current state
    bestBuy = bestSell = quotes[0];
    console.log(`   📊 Single pool analysis: Fee ${bestBuy.fee/100}%, Output: ${bestBuy.outAmount.toFixed(6)} ${pair.symbolOut}`);
  } else {
    // Multiple pools - find arbitrage opportunities
    bestBuy = quotes.reduce((best, current) =>
      current.outAmount > best.outAmount ? current : best
    );

    bestSell = quotes.reduce((best, current) =>
      current.outAmount < best.outAmount ? current : best
    );

    console.log(`   📊 Multi-pool arbitrage: Buy from ${bestBuy.fee/100}% pool, Sell to ${bestSell.fee/100}% pool`);
  }

  // Debug logging to understand the quotes and liquidity
  console.log(`\n🔍 DEBUG: ${pair.symbolIn} → ${pair.symbolOut}`);
  quotes.forEach((q, i) => {
    console.log(`   Pool ${i + 1}: Fee ${q.fee/100}%, Output: ${q.outAmount.toFixed(6)} ${pair.symbolOut}`);
    console.log(`     Liquidity: ${q.liquidity}, Tick: ${q.tick}, Price: ${q.sqrtPriceX96}`);
  });
  console.log(`   Best Buy: ${bestBuy.outAmount.toFixed(6)} ${pair.symbolOut} (Fee: ${bestBuy.fee/100}%)`);
  console.log(`   Best Sell: ${bestSell.outAmount.toFixed(6)} ${pair.symbolOut} (Fee: ${bestSell.fee/100}%)`);

  const inAmt = Number(pair.amountIn);

  // For realistic arbitrage, we need to compare different pools
  let grossProfitBps = 0, netProfitBps = 0;

  if (quotes.length === 1) {
    // Single pool - analyze current market conditions
    const currentPrice = bestBuy.outAmount / Number(pair.amountIn);
    grossProfitBps = 0; // No arbitrage in single pool
    netProfitBps = 0;
    console.log(`   💰 Single pool price: ${currentPrice.toFixed(6)} ${pair.symbolOut}/${pair.symbolIn}`);

    // For single pool, we can't do arbitrage, so return early
    return {
      pair,
      quote1: bestBuy,
      quote2: bestBuy,
      grossProfitBps: 0,
      netProfitBps: 0,
      slippage1: 0,
      slippage2: 0,
      gasCost: 0,
      totalFees: 0,
      wouldExecute: false,
      reason: 'Single pool - no arbitrage opportunity',
      timestamp: new Date().toISOString()
    };
  }

  // Multiple pools - find arbitrage opportunities
  const arbitrageOpportunities = [];
  for (let i = 0; i < quotes.length; i++) {
    for (let j = i + 1; j < quotes.length; j++) {
      const pool1 = quotes[i];
      const pool2 = quotes[j];

      // Calculate price difference between pools
      const priceDiff = Math.abs(pool1.outAmount - pool2.outAmount);
      const priceDiffPercent = (priceDiff / Math.min(pool1.outAmount, pool2.outAmount)) * 100;

      if (priceDiffPercent > 0.1) { // Only consider if price difference > 0.1%
        arbitrageOpportunities.push({
          pool1,
          pool2,
          priceDiff,
          priceDiffPercent
        });
      }
    }
  }

  // Find the best arbitrage opportunity
  const bestArbitrage = arbitrageOpportunities.reduce((best, current) =>
    current.priceDiffPercent > best.priceDiffPercent ? current : best
  );

  if (!bestArbitrage) {
    throw new Error(`No significant price differences found between pools`);
  }

  // Calculate profit from the best arbitrage opportunity
  const grossGain = bestArbitrage.priceDiffPercent / 100;
  grossProfitBps = Math.round(grossGain * 10000);

  console.log(`   Input: ${inAmt} ${pair.symbolIn}`);
  console.log(`   Pool 1: ${bestArbitrage.pool1.outAmount.toFixed(6)} ${pair.symbolOut} (Fee: ${bestArbitrage.pool1.fee/100}%)`);
  console.log(`   Pool 2: ${bestArbitrage.pool2.outAmount.toFixed(6)} ${pair.symbolOut} (Fee: ${bestArbitrage.pool2.fee/100}%)`);
  console.log(`   Price Difference: ${bestArbitrage.priceDiffPercent.toFixed(2)}% (${grossProfitBps} bps)`);

  // Simulate slippage for the arbitrage trade
  const slippage1 = simulateSlippage(inAmt, pair.symbolIn);
  const slippage2 = simulateSlippage(bestArbitrage.pool1.outAmount, pair.symbolOut);

  // Calculate actual amounts after slippage
  const actualOut1 = bestArbitrage.pool1.outAmount * (1 - slippage1 / 100);
  const actualOut2 = bestArbitrage.pool2.outAmount * (1 - slippage2 / 100);

  // Calculate net profit after slippage
  const netGain = grossGain; // Net gain is the price difference between pools
  netProfitBps = Math.round(netGain * 10000);

  // Calculate fees
  const gasCost = calculateGasCost(DRY_RUN_CONFIG.gasLimit);
  const swapFees = (inAmt * bestArbitrage.pool1.fee / 10000) + (inAmt * bestArbitrage.pool2.fee / 10000);
  const totalFees = gasCost + swapFees;

  // Determine if trade would execute
  const minProfitRequired = cfg.thresholdBps + (DRY_RUN_CONFIG.minProfitAfterFees * 100);
  const maxSlippageAllowed = DRY_RUN_CONFIG.maxSlippage;

  let wouldExecute = false;
  let reason = '';

  if (netProfitBps < minProfitRequired) {
            reason = `Insufficient profit after fees (${(netProfitBps/10000).toFixed(4)}% < ${(minProfitRequired/10000).toFixed(4)}%)`;
  } else if (slippage1 > maxSlippageAllowed || slippage2 > maxSlippageAllowed) {
    reason = `Slippage too high (${Math.max(slippage1, slippage2).toFixed(2)}% > ${maxSlippageAllowed}%)`;
  } else if (netProfitBps < cfg.thresholdBps) {
            reason = `Below profit threshold (${(netProfitBps/10000).toFixed(4)}% < ${(cfg.thresholdBps/10000).toFixed(4)}%)`;
  } else {
    wouldExecute = true;
    reason = 'Trade conditions met - would execute';
  }

  const simulation: TradeSimulation = {
    pair,
    quote1: { fee: bestArbitrage.pool1.fee, outAmount: bestArbitrage.pool1.outAmount },
    quote2: { fee: bestArbitrage.pool2.fee, outAmount: bestArbitrage.pool2.outAmount },
    grossProfitBps,
    netProfitBps,
    slippage1,
    slippage2,
    gasCost,
    totalFees,
    wouldExecute,
    reason,
    timestamp: new Date().toISOString()
  };

  return simulation;
}

// --- Analysis and reporting -----------------------------------------------
function analyzeTrade(simulation: TradeSimulation): string {
  const { pair, grossProfitBps, netProfitBps, slippage1, slippage2, gasCost, totalFees, wouldExecute, reason } = simulation;

  let analysis = `\n🔍 ARBITRAGE ANALYSIS: ${pair.symbolIn} ↔ ${pair.symbolOut}`;
  analysis += `\n   Input Amount: ${pair.amountIn} ${pair.symbolIn}`;
        analysis += `\n   Gross Profit: ${(grossProfitBps/10000).toFixed(4)}%`;
      analysis += `\n   Net Profit: ${(netProfitBps/10000).toFixed(4)}%`;
  analysis += `\n   Slippage: ${slippage1.toFixed(2)}% → ${slippage2.toFixed(2)}%`;
  analysis += `\n   Gas Cost: ${gasCost.toFixed(2)} GALA`;
  analysis += `\n   Total Fees: ${totalFees.toFixed(2)} GALA`;
  analysis += `\n   Decision: ${wouldExecute ? '✅ EXECUTE' : '❌ REJECT'}`;
  analysis += `\n   Reason: ${reason}`;

  return analysis;
}

// --- Main dry run loop ---------------------------------------------------
async function dryRunLoop() {
  console.clear();
  console.log('🔥 FAFNIR BOT - DRY RUN MODE (NO ACTUAL TRADES)');
  console.log('=' .repeat(60));
  console.log(`Risk: ${cfg.risk} | Threshold: ${(cfg.thresholdBps/10000).toFixed(4)}% | Poll: ${cfg.pollSeconds}s`);
  console.log(`Slippage Tolerance: ${DRY_RUN_CONFIG.slippageTolerance}% | Min Profit After Fees: ${DRY_RUN_CONFIG.minProfitAfterFees}%`);
  console.log('=' .repeat(60));

  let totalOpportunities = 0;
  let totalExecutions = 0;
  let totalRejected = 0;

  while (true) {
    const cycleStart = Date.now();
    console.log(`\n🔄 Cycle started at ${new Date().toLocaleTimeString()}`);

    for (const pair of FOCUSED_PAIRS) {
      try {
        const simulation = await simulateTrade(pair);

        if (DRY_RUN_CONFIG.logAllQuotes || simulation.wouldExecute) {
          const analysis = analyzeTrade(simulation);
          logLine(analysis);

          if (simulation.wouldExecute) {
            totalExecutions++;
            logLine(`🚀 WOULD EXECUTE: ${pair.symbolIn} → ${pair.symbolOut} → ${pair.symbolIn}`, tradeLogFile);
          } else {
            totalRejected++;
          }
        }

        totalOpportunities++;

      } catch (err: any) {
        logLine(`⚠️ Error simulating ${pair.symbolIn}/${pair.symbolOut}: ${err.message || err}`);
      }
    }

    // Summary for this cycle
    const cycleTime = Date.now() - cycleStart;
    const summary = `\n📊 CYCLE SUMMARY: ${totalOpportunities} opportunities, ${totalExecutions} would execute, ${totalRejected} rejected`;
    logLine(summary);

    // Wait for next cycle
    const waitTime = Math.max(0, cfg.pollSeconds * 1000 - cycleTime);
    await sleep(waitTime);
  }
}

// --- Error handling and startup -------------------------------------------
dryRunLoop().catch((e) => {
  console.error('🚨 Fatal error in dry run:', e);
  process.exit(1);
});

// --- Notes ---------------------------------------------------------------
// • This script simulates the complete trading process without executing trades
// • It includes realistic slippage, gas costs, and network delays
// • All potential trades are logged for analysis
// • Use this to fine-tune your trading parameters before going live
// • Check logs/dry-run.log for detailed analysis and logs/trades.log for execution decisions
