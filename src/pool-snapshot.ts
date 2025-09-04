import fs from 'fs-extra';
import path from 'node:path';
import { GSwap } from '@gala-chain/gswap-sdk';

type Pair = { symbolIn: string; symbolOut: string; amountIn: string };

const TOKENS: Record<string, string> = {
  GALA: 'GALA|Unit|none|none',
  GUSDC: 'GUSDC|Unit|none|none',
  GWETH: 'GWETH|Unit|none|none',
  GWBTC: 'GWBTC|Unit|none|none',
  GUSDT: 'GUSDT|Unit|none|none'
};

function getTokenString(symbol: string): string {
  const t = TOKENS[symbol];
  if (!t) throw new Error(`Unknown token symbol: ${symbol}`);
  return t;
}

export async function collectPoolSnapshot(
  gswap: GSwap,
  pairs: Pair[],
  slippageBps: number
): Promise<any> {
  const feeTiers = [500, 3000, 10000];
  const out: any[] = [];

  for (const p of pairs) {
    try {
      const tIn = getTokenString(p.symbolIn);
      const tOut = getTokenString(p.symbolOut);

      let bestQuote: any = null;
      let bestFee: number | null = null;
      for (const ft of feeTiers) {
        try {
          const q = await (gswap as any).quoting.quoteExactInput(tIn, tOut, p.amountIn, ft);
          const outNum = Number((q as any).outTokenAmount?.toString?.() ?? q.outTokenAmount);
          if (!bestQuote || outNum > Number((bestQuote as any).outTokenAmount?.toString?.() ?? bestQuote.outTokenAmount)) {
            bestQuote = q;
            bestFee = ft;
          }
        } catch (_) {
          // skip tier if not available
        }
      }

      if (!bestQuote || bestFee == null) {
        out.push({ pair: `${p.symbolIn}/${p.symbolOut}`, available: false });
        continue;
      }

      const outAmount = Number((bestQuote as any).outTokenAmount?.toString?.() ?? bestQuote.outTokenAmount);
      const minOut = outAmount * (1 - slippageBps / 10000);

      out.push({
        pair: `${p.symbolIn}/${p.symbolOut}`,
        amountIn: Number(p.amountIn),
        bestFeeBps: bestFee,
        outAmount,
        minOut,
        timestamp: new Date().toISOString()
      });

    } catch (e: any) {
      out.push({ pair: `${p.symbolIn}/${p.symbolOut}`, error: e?.message || String(e) });
    }
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    slippageBps,
    entries: out,
    references: [
      'GalaChain SDK (@gala-chain/api)',
      'GSwap SDK (@gala-chain/gswap-sdk)',
      'GalaSwap app (fee tiers, pool behavior)',
      'https://arb.gala.com/'
    ]
  };

  const logsDir = path.join(process.cwd(), 'logs');
  const snapDir = path.join(logsDir, 'snapshots');
  fs.ensureDirSync(snapDir);
  const file = path.join(snapDir, `snapshot_${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));

  return snapshot;
}
