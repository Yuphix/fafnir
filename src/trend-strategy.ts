import 'dotenv/config';
import fs from 'fs-extra';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { GSwap } from '@gala-chain/gswap-sdk';
import { signatures } from '@gala-chain/api';
import axios from 'axios';
import { GalaChainSwapAuth, TransactionLogEntry } from './galachain-swap-auth.js';

type PriceSample = { ts: number; price: number };
type LedgerEntry = {
  ts: number;
  action: 'BUY' | 'SELL';
  base: string; // GALA
  quote: string; // GUSDC
  amountQuote: number; // e.g., 20 GUSDC spent or received
  amountBase: number; // GALA bought or sold
  price: number; // quote per base (GUSDC per 1 GALA)
  reason: string;
};

const TOKEN_TYPES: Record<string, string> = {
  GALA: 'GALA|Unit|none|none',
  GUSDC: 'GUSDC|Unit|none|none',
};

function token(type: string): string {
  const t = TOKEN_TYPES[type];
  if (!t) throw new Error(`Unknown token symbol: ${type}`);
  return t;
}

const gatewayUrl = process.env.GSWAP_GATEWAY_URL || 'https://gateway-mainnet.galachain.com';
const dexBackendUrl = process.env.GSWAP_DEX_BACKEND_URL || 'https://dex-backend-prod1.defi.gala.com';
const bundlerUrl = process.env.GSWAP_BUNDLER_URL || 'https://bundle-backend-prod1.defi.gala.com';

const PRIVATE_KEY = process.env.GALACHAIN_PRIVATE_KEY || '';
function parsePrivateKeyBuffer(pk: string): Buffer {
  const trimmed = pk.trim();
  if (trimmed.startsWith('0x')) return Buffer.from(trimmed.slice(2), 'hex');
  // hex without 0x
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) return Buffer.from(trimmed, 'hex');
  // base64 fallback
  try { return Buffer.from(trimmed, 'base64'); } catch { return Buffer.from(trimmed, 'utf8'); }
}
const SIGNER: any = PRIVATE_KEY ? {
  // Return signature; do not mutate payload (SDK will attach as needed)
  signObject: async (obj: any) => {
    const payload = typeof obj === 'string' ? { method: obj } : obj;
    return signatures.getSignature(payload, parsePrivateKeyBuffer(PRIVATE_KEY));
  }
} : undefined;

const gswap = new GSwap({
  gatewayBaseUrl: gatewayUrl,
  dexBackendBaseUrl: dexBackendUrl,
  bundlerBaseUrl: bundlerUrl,
  dexContractBasePath: '/api/asset/dexv3-contract',
  tokenContractBasePath: '/api/asset/token-contract',
  bundlingAPIBasePath: '/bundle',
  signer: SIGNER
} as any);

// Initialize enhanced swap authorization with comprehensive logging
const swapAuth = new GalaChainSwapAuth();

async function submitBundle(transactions: any[]): Promise<any> {
  try {
    return await (gswap as any).bundling.bundle(transactions);
  } catch (e: any) {
    try {
      const resp = await axios.post(
        `${bundlerUrl}/bundle`,
        { transactions },
        { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
      );
      return resp.data;
    } catch (e2: any) {
      const body = e2?.response?.data ? ` body=${JSON.stringify(e2.response.data)}` : '';
      throw new Error(`${e2?.message || e2}${body}`);
    }
  }
}

const LOG_DIR = path.join(process.cwd(), 'logs');
const PRICE_FILE = path.join(LOG_DIR, 'trend_prices_gala_gusdc.json');
const LEDGER_FILE = path.join(LOG_DIR, 'trend_ledger.json');
fs.ensureDirSync(LOG_DIR);

// Config via env
const POLL_INTERVAL_MS = Number(process.env.TREND_POLL_INTERVAL_MS || 60 * 60 * 1000); // hourly default
const BUY_DRAWDOWN_PCT = Number(process.env.TREND_BUY_DRAWDOWN_PCT || 5); // buy if -5% over 24h
const SELL_TP1_PCT = Number(process.env.TREND_SELL_TP1_PCT || 8); // sell if +8% from entry
const SELL_TP2_PCT = Number(process.env.TREND_SELL_TP2_PCT || 10); // secondary rule after drawdown-buy
const ORDER_SIZE_GUSDC = Number(process.env.TREND_ORDER_SIZE_GUSDC || 20);
const MAX_HISTORY_HOURS = Number(process.env.TREND_MAX_HISTORY_HOURS || 30); // keep ~30 samples
const DRY_RUN = (process.env.TREND_DRY_RUN || 'true').toLowerCase() === 'true';
const FORCE_BUY_ON_START = (process.env.TREND_FORCE_BUY_ON_START || 'false').toLowerCase() === 'true';
const SLIPPAGE_BPS = Number(process.env.TREND_SLIPPAGE_BPS || 80);
const PRICE_SOURCE = (process.env.TREND_PRICE_SOURCE || 'gswap').toLowerCase(); // 'gswap' | 'coingecko'
const COINGECKO_ID = process.env.COINGECKO_ID || 'gala';
const COINGECKO_VS = process.env.COINGECKO_VS || 'usd';
const ADVISOR_ENABLED = (process.env.ADVISOR_ENABLED || 'false').toLowerCase() === 'true';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-pro';
const ADVISOR_MIN_CONFIDENCE = Number(process.env.ADVISOR_MIN_CONFIDENCE || 0.6);

// State
let prices: PriceSample[] = [];
let ledger: LedgerEntry[] = [];

function now(): number { return Date.now(); }

function pruneOld(): void {
  const cutoff = now() - 24 * 60 * 60 * 1000;
  prices = prices.filter(p => p.ts >= cutoff);
  while (prices.length > MAX_HISTORY_HOURS) prices.shift();
}

function loadState(): void {
  try { prices = JSON.parse(fs.readFileSync(PRICE_FILE, 'utf8')); } catch {}
  try { ledger = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8')); } catch {}
}

function saveState(): void {
  fs.writeFileSync(PRICE_FILE, JSON.stringify(prices, null, 2));
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2));
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(LOG_DIR, 'trend.log'), line + '\n');
}

async function bestFeeQuote(tokenIn: string, tokenOut: string, amountIn: string): Promise<{ fee: number; out: number }> {
  const tiers = [500, 3000, 10000];
  let best: { fee: number; out: number } | null = null;
  for (const fee of tiers) {
    try {
      const q = await gswap.quoting.quoteExactInput(tokenIn, tokenOut, amountIn, fee as any);
      const out = Number((q as any).outTokenAmount?.toString?.() ?? (q as any).outTokenAmount);
      if (!best || out > best.out) best = { fee, out };
    } catch (_) {
      // ignore missing tiers
    }
  }
  if (!best) throw new Error('No liquidity across fee tiers');
  return best;
}

async function quoteGalaPerGusdc(): Promise<number> {
  if (PRICE_SOURCE === 'coingecko') {
    // Use current spot from CoinGecko (USD ≈ GUSDC)
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${COINGECKO_ID}&vs_currencies=${COINGECKO_VS}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    const px = data?.[COINGECKO_ID]?.[COINGECKO_VS];
    if (!px || typeof px !== 'number') throw new Error('CoinGecko price unavailable');
    return px; // GUSDC per GALA
  }
  // Fallback to GalaSwap: price = GUSDC per 1 GALA via inverse of 1 GUSDC→GALA
  const { out } = await bestFeeQuote(token('GUSDC'), token('GALA'), '1');
  if (out <= 0) throw new Error('Bad quote');
  return 1 / out; // GUSDC per GALA
}

async function backfill24hFromCoinGecko(): Promise<void> {
  if (PRICE_SOURCE !== 'coingecko') return;
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${COINGECKO_ID}/market_chart?vs_currency=${COINGECKO_VS}&days=1&interval=hourly`;
    const { data } = await axios.get(url, { timeout: 15000 });
    const series: Array<[number, number]> = data?.prices || [];
    if (!Array.isArray(series) || series.length === 0) throw new Error('Empty market_chart');

    // Merge and dedupe by timestamp
    const byTs = new Map<number, number>();
    for (const p of prices) byTs.set(p.ts, p.price);
    for (const [ts, px] of series) {
      if (typeof ts === 'number' && typeof px === 'number') byTs.set(ts, px);
    }
    const merged = Array.from(byTs.entries()).map(([ts, price]) => ({ ts, price }));
    merged.sort((a, b) => a.ts - b.ts);
    prices = merged;
    pruneOld();
    saveState();
    log(`🗂️ Backfilled CoinGecko 24h: samples=${prices.length}`);
  } catch (e: any) {
    log(`⚠️ backfill error: ${e.message || e}`);
  }
}

function pctChange(current: number, past: number): number {
  return ((current - past) / past) * 100;
}

function lastEntryDirection(): 'LONG' | 'FLAT' {
  // if last action was BUY without a subsequent SELL, we are LONG
  for (let i = ledger.length - 1; i >= 0; i--) {
    if (ledger[i].action === 'BUY') return 'LONG';
    if (ledger[i].action === 'SELL') return 'FLAT';
  }
  return 'FLAT';
}

function currentPositionSizeGala(): number {
  // sum buys - sells in base units
  let size = 0;
  for (const e of ledger) {
    size += e.action === 'BUY' ? e.amountBase : -e.amountBase;
  }
  return Math.max(0, size);
}

function entryPriceOfOpen(): number | null {
  // last BUY price if not fully sold
  let running = 0;
  for (const e of ledger) running += e.action === 'BUY' ? e.amountBase : -e.amountBase;
  if (running <= 0) return null;
  for (let i = ledger.length - 1; i >= 0; i--) {
    if (ledger[i].action === 'BUY') return ledger[i].price;
  }
  return null;
}

function requiredTpPctForOpen(): number {
  // If last BUY was due to 24h drawdown, use SELL_TP2_PCT; else SELL_TP1_PCT
  let running = 0;
  for (const e of ledger) running += e.action === 'BUY' ? e.amountBase : -e.amountBase;
  if (running <= 0) return Number.POSITIVE_INFINITY;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i];
    if (e.action === 'BUY') {
      const r = (e.reason || '').toLowerCase();
      const isDrawdownBuy = r.includes('24h change') || r.includes('drawdown');
      return isDrawdownBuy ? SELL_TP2_PCT : SELL_TP1_PCT;
    }
  }
  return SELL_TP1_PCT;
}

async function maybeBuy(currentPrice: number): Promise<void> {
  const oldest = prices[0]?.price;
  if (!oldest) return;
  const change24h = pctChange(currentPrice, oldest);
  if (change24h <= -BUY_DRAWDOWN_PCT) {
    // buy 20 GUSDC worth of GALA
    const amountQuote = ORDER_SIZE_GUSDC;
    const expectedGala = amountQuote / currentPrice;

    if (DRY_RUN) {
      ledger.push({ ts: now(), action: 'BUY', base: 'GALA', quote: 'GUSDC', amountQuote, amountBase: expectedGala, price: currentPrice, reason: `24h change ${change24h.toFixed(2)}% ≤ -${BUY_DRAWDOWN_PCT}%` });
      log(`🟢 BUY (dry): ${amountQuote} GUSDC → ~${expectedGala.toFixed(6)} GALA @ ${currentPrice.toFixed(6)} (24h ${change24h.toFixed(2)}%)`);
      saveState();
      return;
    }

    // live path with enhanced authorization and logging
    try {
      log(`🔄 Executing authorized BUY: ${amountQuote} GUSDC → GALA`);
      const buyResult = await swapAuth.buyGALAWithGUSDC(String(amountQuote), SLIPPAGE_BPS);

      if (buyResult.success) {
        const actualGala = buyResult.actualAmountOut ? Number(buyResult.actualAmountOut) : expectedGala;
        ledger.push({
          ts: now(),
          action: 'BUY',
          base: 'GALA',
          quote: 'GUSDC',
          amountQuote,
          amountBase: actualGala,
          price: currentPrice,
          reason: `24h change ${change24h.toFixed(2)}% ≤ -${BUY_DRAWDOWN_PCT}%`
        });
        log(`✅ BUY completed: ${amountQuote} GUSDC → ${actualGala.toFixed(6)} GALA | TX: ${buyResult.transactionId}`);
        saveState();
      } else {
        throw new Error(buyResult.error || 'Unknown buy error');
      }
    } catch (e: any) {
      log(`❌ BUY failed: ${e.message || e}`);
    }
  }
}

async function forceBuy(currentPrice: number): Promise<void> {
  const amountQuote = ORDER_SIZE_GUSDC;
  const expectedGala = amountQuote / currentPrice;

  if (DRY_RUN) {
    ledger.push({ ts: now(), action: 'BUY', base: 'GALA', quote: 'GUSDC', amountQuote, amountBase: expectedGala, price: currentPrice, reason: 'force-buy-on-start' });
    log(`🟢 BUY (forced dry): ${amountQuote} GUSDC → ~${expectedGala.toFixed(6)} GALA @ ${currentPrice.toFixed(6)}`);
    saveState();
    return;
  }

  try {
    log(`🔄 Executing authorized forced BUY: ${amountQuote} GUSDC → GALA`);
    const buyResult = await swapAuth.buyGALAWithGUSDC(String(amountQuote), SLIPPAGE_BPS);

    if (buyResult.success) {
      const actualGala = buyResult.actualAmountOut ? Number(buyResult.actualAmountOut) : expectedGala;
      ledger.push({
        ts: now(),
        action: 'BUY',
        base: 'GALA',
        quote: 'GUSDC',
        amountQuote,
        amountBase: actualGala,
        price: currentPrice,
        reason: 'force-buy-on-start'
      });
      log(`✅ Forced BUY completed: ${amountQuote} GUSDC → ${actualGala.toFixed(6)} GALA | TX: ${buyResult.transactionId}`);
      saveState();
    } else {
      throw new Error(buyResult.error || 'Unknown forced buy error');
    }
  } catch (e: any) {
    log(`❌ Forced BUY failed: ${e.message || e}`);
  }
}

async function maybeSell(currentPrice: number): Promise<void> {
  if (lastEntryDirection() !== 'LONG') return;
  const entry = entryPriceOfOpen();
  if (!entry) return;
  const changeFromEntry = pctChange(currentPrice, entry);
  const sizeGala = currentPositionSizeGala();
  if (sizeGala <= 0) return;

  const tpRequired = requiredTpPctForOpen();
  if (changeFromEntry < tpRequired) return;

  const amountBase = sizeGala; // sell all open
  const expectedQuote = amountBase * currentPrice;

  if (DRY_RUN) {
    ledger.push({ ts: now(), action: 'SELL', base: 'GALA', quote: 'GUSDC', amountQuote: expectedQuote, amountBase, price: currentPrice, reason: `TP hit: ${changeFromEntry.toFixed(2)}% ≥ ${Math.min(SELL_TP1_PCT, SELL_TP2_PCT)}%` });
    log(`🔴 SELL (dry): ${amountBase.toFixed(6)} GALA → ~${expectedQuote.toFixed(2)} GUSDC @ ${currentPrice.toFixed(6)} (from entry ${changeFromEntry.toFixed(2)}%, req ≥ ${tpRequired}%)`);
    saveState();
    return;
  }

  try {
    log(`🔄 Executing authorized SELL: ${amountBase.toFixed(6)} GALA → GUSDC`);
    const sellResult = await swapAuth.sellGALAForGUSDC(String(amountBase), SLIPPAGE_BPS);

    if (sellResult.success) {
      const actualGusdc = sellResult.actualAmountOut ? Number(sellResult.actualAmountOut) : expectedQuote;
      ledger.push({
        ts: now(),
        action: 'SELL',
        base: 'GALA',
        quote: 'GUSDC',
        amountQuote: actualGusdc,
        amountBase,
        price: currentPrice,
        reason: `TP hit: ${changeFromEntry.toFixed(2)}% (req ≥ ${tpRequired}%)`
      });
      log(`✅ SELL completed: ${amountBase.toFixed(6)} GALA → ${actualGusdc.toFixed(2)} GUSDC | TX: ${sellResult.transactionId}`);
      saveState();
    } else {
      throw new Error(sellResult.error || 'Unknown sell error');
    }
  } catch (e: any) {
    log(`❌ SELL failed: ${e.message || e}`);
  }
}

async function cycle(): Promise<void> {
  try {
    const price = await quoteGalaPerGusdc();
    prices.push({ ts: now(), price });
    pruneOld();
    saveState();
    log(`📈 Price: ${price.toFixed(6)} GUSDC/GALA | samples=${prices.length} | src=${PRICE_SOURCE}`);

    // Advisor gate (Gemini JSON)
    if (ADVISOR_ENABLED && GEMINI_API_KEY) {
      try {
        const body = {
          contents: [
            {
              role: 'user',
              parts: [
                { text: 'Return strict JSON with keys: decision(BUY|SELL|HOLD), confidence(0-1), reason.' },
                { text: JSON.stringify({
                  priceSeries: prices.slice(-24).map(p => ({ ts: p.ts, price: p.price })),
                  lastAction: ledger[ledger.length - 1]?.action || 'NONE',
                  openPositionGala: currentPositionSizeGala(),
                  thresholds: { BUY_DRAWDOWN_PCT, SELL_TP1_PCT, SELL_TP2_PCT },
                  env: { orderSizeGusdc: ORDER_SIZE_GUSDC }
                }) }
              ]
            }
          ],
          generationConfig: { response_mime_type: 'application/json' }
        } as any;

        const resp = await axios.post(
          'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent',
          body,
          { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, timeout: 15000 }
        );
        const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const { decision, confidence } = JSON.parse(text || '{}');
        const conf = Number(confidence ?? 0);
        const gate = decision && conf >= ADVISOR_MIN_CONFIDENCE;
        log(`🤖 Advisor: decision=${decision || 'N/A'} conf=${conf.toFixed(2)} gate=${gate}`);
        if (gate) {
          if (decision === 'SELL') await maybeSell(price);
          else if (decision === 'BUY') await maybeBuy(price);
        }
      } catch (e: any) {
        log(`⚠️ advisor error: ${e.message || e}`);
        // Fallback to local rules
        await maybeSell(price);
        await maybeBuy(price);
      }
    } else {
      // No advisor, apply local rules
      await maybeSell(price);
      await maybeBuy(price);
    }
  } catch (e: any) {
    log(`⚠️ cycle error: ${e.message || e}`);
  }
}

async function main(): Promise<void> {
  log('🔥 Trend strategy started (GUSDC⇄GALA). Dry run: ' + DRY_RUN);
  loadState();
  if (PRICE_SOURCE === 'coingecko') {
    await backfill24hFromCoinGecko();
  }
  if (!DRY_RUN && FORCE_BUY_ON_START) {
    try {
      const price = await quoteGalaPerGusdc();
      await forceBuy(price);
    } catch (e: any) {
      log(`⚠️ force buy failed: ${e.message || e}`);
    }
  }
  while (true) {
    await cycle();
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
