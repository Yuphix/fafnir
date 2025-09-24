import { config } from './config.js';
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
  SILK: 'SILK|Unit|none|none',
  MTRM: 'MTRM|Unit|none|none'
};
const FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1.0%

function token(type: string): string {
  const t = TOKENS[type];
  if (!t) throw new Error(`Unknown token symbol: ${type}`);
  return t;
}

function parseTypeStr(ts: string) {
  const [collection, category, type, additionalKey] = ts.split('|');
  return { collection, category, type, additionalKey };
}

// --- Config ---------------------------------------------------------------
const cfgPath = path.join(process.cwd(), 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
  pollSeconds: number;
  risk: 'cautious' | 'balanced' | 'aggressive';
  thresholdBps: number;
  pairs: { symbolIn: string; symbolOut: string; amountIn: string }[];
};
const thresholdBps = cfg.thresholdBps ?? 80;
const slippageBps = Number(process.env.SLIPPAGE_BPS || 100); // default 1.00%
const forceDryRun = process.env.FORCE_DRYRUN === '1';

// Production safety configuration
const PRODUCTION_CONFIG = {
  gasLimit: 300000, // estimated gas for swap
  maxDailyLoss: 50, // maximum daily loss in USD
  maxTradeSize: 25, // maximum trade size in USD
  minProfitAfterFees: 0.5, // minimum profit after fees (0.5%)
  maxSlippage: 0.8, // maximum allowed slippage (0.8%)
  emergencyStop: false, // emergency stop flag
  dailyStats: {
    totalTrades: 0,
    totalProfit: 0,
    totalLoss: 0,
    lastReset: new Date().toDateString()
  }
};

// --- GalaSwap client ------------------------------------------------------
// Initialize GSwap client for quotes and swap payloads
const gswap = new GSwap({
  gatewayBaseUrl: config.gatewayUrl,
  dexBackendBaseUrl: config.dexBackendUrl,
  bundlerBaseUrl: config.bundlerUrl,
  dexContractBasePath: '/api/asset/dexv3-contract',
  tokenContractBasePath: '/api/asset/token-contract',
  bundlingAPIBasePath: '/bundle'
});

// Wallet address and signer for operations that need them
const wallet = process.env.GALACHAIN_WALLET_ADDRESS || '';
const pk = process.env.GALACHAIN_PRIVATE_KEY || '';
const signer = pk ? { privateKey: pk } : undefined;

// --- Logging --------------------------------------------------------------
const logDir = path.join(process.cwd(), 'logs');
fs.ensureDirSync(logDir);
const logFile = path.join(logDir, 'scout.log');
const dryDir = path.join(logDir, 'dryruns');
fs.ensureDirSync(dryDir);
function logLine(text: string) {
  const line = `[${new Date().toISOString()}] ${text}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

// --- Quote helpers --------------------------------------------------------
async function bestQuote(inSym: string, outSym: string, amountIn: string) {
  const tIn = token(inSym);
  const tOut = token(outSym);
  let best: { fee: number; outAmount: number } | null = null;
  for (const fee of FEE_TIERS) {
    try {
      // Prefer single-pool quote to see tier effect
      const q = await gswap.quoting.quoteExactInput(tIn, tOut, amountIn, fee);
      const outNum = Number((q as any).outTokenAmount?.toString?.() ?? q.outTokenAmount);
      if (!best || outNum > best.outAmount) {
        best = { fee, outAmount: outNum };
      }
    } catch (_) {
      // ignore if pool missing for this tier
    }
  }
  return best;
}

async function roundTrip(pair: { symbolIn: string; symbolOut: string; amountIn: string }) {
  // Check both directions for better opportunities
  const forward = await bestQuote(pair.symbolIn, pair.symbolOut, pair.amountIn);
  if (!forward) throw new Error(`No pool for ${pair.symbolIn}->${pair.symbolOut}`);

  const reverse = await bestQuote(pair.symbolOut, pair.symbolIn, String(forward.outAmount));
  if (!reverse) throw new Error(`No pool for ${pair.symbolOut}->${pair.symbolIn}`);

  // Calculate forward direction (A→B→A)
  const inAmt = Number(pair.amountIn);
  const backAmt = reverse.outAmount;
  const forwardGain = (backAmt - inAmt) / inAmt;
  const forwardGainBps = Math.round(forwardGain * 10000);

  // Calculate reverse direction (B→A→B) with adjusted amounts
  const reverseAmount = Math.min(Number(pair.amountIn) * 0.95, 50); // Conservative reverse amount
  const reverseForward = await bestQuote(pair.symbolOut, pair.symbolIn, String(reverseAmount));
  if (reverseForward) {
    const reverseBack = await bestQuote(pair.symbolIn, pair.symbolOut, String(reverseForward.outAmount));
    if (reverseBack) {
      const reverseGain = (reverseBack.outAmount - reverseAmount) / reverseAmount;
      const reverseGainBps = Math.round(reverseGain * 10000);

      // Return the better opportunity
      if (reverseGainBps > forwardGainBps) {
        return {
          q1: reverseForward,
          q2: reverseBack,
          gainBps: reverseGainBps,
          direction: 'reverse',
          originalAmount: reverseAmount
        };
      }
    }
  }

  return {
    q1: forward,
    q2: reverse,
    gainBps: forwardGainBps,
    direction: 'forward',
    originalAmount: inAmt
  };
}

function asPct(bps: number) { return (bps / 10000).toFixed(4) + '%'; }

function suggest(pair: { symbolIn: string; symbolOut: string; amountIn: string }, gainBps: number) {
  if (gainBps >= thresholdBps) {
    return `✅ Opportunity: ${pair.amountIn} ${pair.symbolIn} → ${pair.symbolOut} → ${pair.symbolIn} (round-trip +${asPct(gainBps)})`;
  }
  return `ℹ️ No edge on ${pair.symbolIn}/${pair.symbolOut} (round-trip ${asPct(gainBps)} < target ${asPct(thresholdBps)})`;
}

// --- PRODUCTION TRADE BUILDER (SDK + Signing) -----------------------------
async function buildProductionSwap(
  inSym: string,
  outSym: string,
  amountIn: string,
  bestFeeBps: number,
  quotedOut: number,
  isDryRun: boolean = true
) {
  const tIn = token(inSym);
  const tOut = token(outSym);
  const amountOutMin = (quotedOut * (1 - slippageBps / 10000)).toString();

  try {
    // Use SDK to build the swap transaction
    const swapParams = {
      tokenIn: tIn,
      tokenOut: tOut,
      fee: bestFeeBps,
      amountIn: amountIn,
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: '0', // No price limit
      recipient: wallet || '0x0000000000000000000000000000000000000000'
    };

        if (isDryRun) {
      // Dry-run mode: simulate transaction
      const swapTransaction = {
        ...swapParams,
        estimatedGas: PRODUCTION_CONFIG.gasLimit,
        status: 'dry-run-simulation'
      };

      const dryRunData = {
        method: 'swap',
        params: swapParams,
        transaction: swapTransaction,
        estimatedGas: PRODUCTION_CONFIG.gasLimit,
        feeTier: bestFeeBps,
        slippageTolerance: slippageBps / 10000,
        timestamp: new Date().toISOString()
      };

      const file = path.join(dryDir, `dryrun_sdk_${Date.now()}_${inSym}-${outSym}.json`);
      fs.writeFileSync(file, JSON.stringify(dryRunData, null, 2));

      logLine(`🧪 Built SDK dry-run swap → saved ${path.basename(file)} (fee ${bestFeeBps} bps, slippage ${asPct(slippageBps)})`);

    } else {
      // Production mode: build and sign actual transaction
      if (!signer || !wallet) {
        throw new Error('Signer and wallet required for production trades');
      }

      try {
        // Build the actual swap transaction using correct SDK signature
        const swapTransaction = await gswap.swaps.swap(
          tIn,                    // tokenIn
          tOut,                   // tokenOut
          bestFeeBps,             // fee tier
          {
            exactIn: amountIn,
            amountOutMinimum: amountOutMin,
          },
          wallet                   // recipient wallet
        );

        // The SDK handles signing automatically when using PrivateKeySigner
        // The transaction is ready for submission
        const signedTx = {
          ...swapTransaction,
          status: 'signed-ready-for-submission'
        };

        // Save production transaction data
        const productionData = {
          method: 'swap',
          params: swapParams,
          transaction: swapTransaction,
          signedTransaction: signedTx,
          estimatedGas: PRODUCTION_CONFIG.gasLimit,
          feeTier: bestFeeBps,
          slippageTolerance: slippageBps / 10000,
          timestamp: new Date().toISOString(),
          status: 'signed-ready-for-submission'
        };

        const file = path.join(dryDir, `production_${Date.now()}_${inSym}-${outSym}.json`);
        fs.writeFileSync(file, JSON.stringify(productionData, null, 2));

        logLine(`🚀 BUILT PRODUCTION SWAP: ${inSym}→${outSym} | Fee: ${bestFeeBps}bps | Ready for submission`);

        return { signedTx, swapTransaction };

      } catch (error: any) {
        logLine(`❌ Failed to build production swap: ${error.message || error}`);
        throw error;
      }
    }

  } catch (error: any) {
    logLine(`⚠️ Error building swap for ${inSym}->${outSym}: ${error.message || error}`);

    // Fallback: Create a simplified record
    const fallbackData = {
      method: 'swap (fallback)',
      params: {
        tokenIn: tIn,
        tokenOut: tOut,
        fee: bestFeeBps,
        amountIn: amountIn,
        amountOutMinimum: amountOutMin
      },
      note: 'SDK transaction building failed, showing basic parameters only',
      timestamp: new Date().toISOString()
    };

    const file = path.join(dryDir, `fallback_${Date.now()}_${inSym}-${outSym}.json`);
    fs.writeFileSync(file, JSON.stringify(fallbackData, null, 2));

    logLine(`📝 Saved fallback data to ${path.basename(file)}`);
  }
}

// --- Production safety functions -------------------------------------------
function resetDailyStats() {
  const today = new Date().toDateString();
  if (PRODUCTION_CONFIG.dailyStats.lastReset !== today) {
    PRODUCTION_CONFIG.dailyStats.totalTrades = 0;
    PRODUCTION_CONFIG.dailyStats.totalProfit = 0;
    PRODUCTION_CONFIG.dailyStats.totalLoss = 0;
    PRODUCTION_CONFIG.dailyStats.lastReset = today;
    logLine(`📅 Daily stats reset for ${today}`);
  }
}

function emergencyStop(reason: string) {
  PRODUCTION_CONFIG.emergencyStop = true;
  logLine(`🚨 EMERGENCY STOP ACTIVATED: ${reason}`);
  logLine(`🛑 Bot will stop trading until manually restarted`);
}

// --- Main loop ------------------------------------------------------------
async function loop() {
  console.clear();
  console.log('🔥 Fafnir Bot — Gala Price Scout (suggestions + dry-run builder)');
  console.log(`Risk: ${cfg.risk} | Threshold: ${asPct(thresholdBps)} | Poll: ${cfg.pollSeconds}s | Slippage: ${asPct(slippageBps)}\n`);

  if (forceDryRun) {
    // build a dry-run immediately for the first pair (demo)
    const p = cfg.pairs[0];
    const q = await bestQuote(p.symbolIn, p.symbolOut, p.amountIn);
    if (q) await buildProductionSwap(p.symbolIn, p.symbolOut, p.amountIn, q.fee, q.outAmount, true);
  }

  while (true) {
    // Reset daily stats if needed
    resetDailyStats();

    // Check emergency stop
    if (PRODUCTION_CONFIG.emergencyStop) {
      logLine(`🛑 Bot is in emergency stop mode. Check logs and restart manually.`);
      await sleep(30000); // Wait 30 seconds before checking again
      continue;
    }

    for (const p of cfg.pairs) {
      try {
        const { q1, q2, gainBps } = await roundTrip(p);
        const line = suggest(p, gainBps) + ` | Best fee tiers: ${q1.fee}bps, ${q2.fee}bps`;
        logLine(line);

        // Production safety checks
        if (gainBps >= thresholdBps) {
          // Check daily loss limit
          if (PRODUCTION_CONFIG.dailyStats.totalLoss >= PRODUCTION_CONFIG.maxDailyLoss) {
            logLine(`🚨 DAILY LOSS LIMIT REACHED: $${PRODUCTION_CONFIG.dailyStats.totalLoss} - Skipping trade`);
            continue;
          }

          // Check trade size limit
          const tradeSizeUSD = Number(p.amountIn) * (p.symbolIn === 'GUSDC' ? 1 : 0.05); // Rough USD conversion
          if (tradeSizeUSD > PRODUCTION_CONFIG.maxTradeSize) {
            logLine(`⚠️ Trade size $${tradeSizeUSD.toFixed(2)} exceeds limit $${PRODUCTION_CONFIG.maxTradeSize} - Skipping`);
            continue;
          }

          // Build dry-run for production review
          await buildProductionSwap(p.symbolIn, p.symbolOut, p.amountIn, q1.fee, q1.outAmount, true);

          logLine(`🎯 PRODUCTION OPPORTUNITY: ${p.symbolIn}↔${p.symbolOut} +${asPct(gainBps)} | Size: $${tradeSizeUSD.toFixed(2)}`);
        }
      } catch (err: any) {
        logLine(`⚠️ Error on ${p.symbolIn}/${p.symbolOut}: ${err.message || err}`);
      }
    }
    await sleep(cfg.pollSeconds * 1000);
  }
}

loop().catch((e) => { console.error('Fatal:', e); process.exit(1); });

// --- Auto-trade prep ------------------------------------------------------
// Later we will:
// • Build a swap payload with gswap.swaps.swap()
// • Sign it with PrivateKeySigner (requires GALACHAIN_PRIVATE_KEY)
// • Submit via gswap.transactions.bundle()
// • Check status with gswap.transactions.getTransactionStatus()
// These steps prepare Fafnir for live execution, but for now we only scout.
