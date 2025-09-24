import { config } from './config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';


// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const cfg = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf8'));
const thresholdBps = Number(process.env.THRESHOLD_BPS) || cfg.thresholdBps;
const debug = process.env.DEBUG === 'true';

// Utility functions
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const dbg = (...args: any[]) => debug && console.log('[DEBUG]', ...args);

// Token mapping (you may need to adjust these based on actual GalaSwap token addresses)
const token = (symbol: string) => {
  const tokens: Record<string, string> = {
    'GUSDC': '0x0000000000000000000000000000000000000000', // Replace with actual address
    'GALA': '0x0000000000000000000000000000000000000000',  // Replace with actual address
    'ETH': '0x0000000000000000000000000000000000000000'   // Replace with actual address
  };
  return tokens[symbol] || symbol;
};

// GalaSwap SDK initialization (you'll need to implement this based on actual SDK)
// For now, this is a placeholder - you'll need to import and initialize the actual SDK
const gswap = {
  quoting: {
    quoteExactInput: async (tokenIn: string, tokenOut: string, amountIn: string) => {
      // Placeholder implementation - replace with actual SDK call
      console.log(`[PLACEHOLDER] Quote: ${amountIn} ${tokenIn} -> ${tokenOut}`);
      return {
        feeTier: 0.003,
        outTokenAmount: (parseFloat(amountIn) * 0.997).toString()
      };
    }
  }
};

// Helper function for percentage formatting
function bps(n: number) {
  return `${(n / 100).toFixed(2)}%`;
}

// Quote exact input function
async function quoteExactIn(inSym: string, outSym: string, amountIn: string) {
  const tIn = token(inSym);
  const tOut = token(outSym);
  const q = await gswap.quoting.quoteExactInput(tIn, tOut, amountIn);
  // Expect q to expose outTokenAmount and feeTier; normalize to strings
  return {
    feeTier: (q as any).feeTier,
    outAmount: (q as any).outTokenAmount?.toString?.() ?? String((q as any).outTokenAmount),
  };
}

// Round trip gain calculation
async function roundTripGain(pair: { symbolIn: string; symbolOut: string; amountIn: string }) {
  // 1) A -> B
  const q1 = await quoteExactIn(pair.symbolIn, pair.symbolOut, pair.amountIn);
  // 2) B -> A using q1.outAmount as input
  const q2 = await quoteExactIn(pair.symbolOut, pair.symbolIn, q1.outAmount);

  const inX = Number(pair.amountIn);
  const backX = Number(q2.outAmount);
  const gain = (backX - inX) / inX; // e.g., 0.009 = 0.9%
  const gainBps = Math.round(gain * 10000);

  return { q1, q2, gain, gainBps };
}

// Suggestion text generation
function suggestionText(pair: { symbolIn: string; symbolOut: string; amountIn: string }, gainBps: number) {
  if (gainBps >= thresholdBps) {
    return `✅ Opportunity: Start with ${pair.amountIn} ${pair.symbolIn} → ${pair.symbolOut} → ${pair.symbolIn} (round-trip +${bps(gainBps)})`;
  }
  return `ℹ️ No strong edge on ${pair.symbolIn}↔${pair.symbolOut} (round-trip ${bps(gainBps)} < target ${bps(thresholdBps)})`;
}

// Main loop
async function loop() {
  console.clear();
  console.log('Gala Price Scout — suggestions only (no auto-trading)');
  console.log(`Risk: ${cfg.risk} | Threshold: ${bps(thresholdBps)} | Poll: ${cfg.pollSeconds}s\n`);

  while (true) {
    const start = Date.now();
    for (const p of cfg.pairs) {
      try {
        const { q1, q2, gainBps } = await roundTripGain(p);
        const line = suggestionText(p, gainBps);
        console.log(`[${new Date().toLocaleTimeString()}] ${line}`);
        dbg('  Quotes:', p.symbolIn, '->', p.symbolOut, q1, '|', p.symbolOut, '->', p.symbolIn, q2);
      } catch (err: any) {
        console.error(`⚠️ Error on pair ${p.symbolIn}/${p.symbolOut}:`, err.message || err);
      }
    }
    const elapsed = Date.now() - start;
    const wait = Math.max(0, cfg.pollSeconds * 1000 - elapsed);
    await sleep(wait);
  }
}

// Error handling and startup
loop().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});

// --- Notes ---------------------------------------------------------------
// • This app *only* suggests opportunities based on instantaneous round-trip quotes.
// • It ignores network fees and slippage changes during execution; use a margin above
//   threshold if you later automate.
// • To add a new pair, edit config.json and include amountIn sized to your comfort.
// • IMPORTANT: Replace the placeholder gswap implementation with actual GalaSwap SDK calls
// • Update token addresses in the token() function with actual GalaSwap token addresses
