import fs from 'fs-extra';
import path from 'node:path';
import { GSwap } from '@gala-chain/gswap-sdk';
import { collectPoolSnapshot } from './pool-snapshot.js';

type AdvisorConfig = {
  enabled: boolean;
  apiKey?: string;
  endpoint: string;
  intervalMs: number;
};

export class StrategyAdvisor {
  private gswap: GSwap;
  private cfg: AdvisorConfig;

  constructor(gswap: GSwap) {
    this.gswap = gswap;
    this.cfg = {
      enabled: String(process.env.ADVISOR_ENABLED || 'false').toLowerCase() === 'true',
      apiKey: process.env.GEMINI_API_KEY,
      endpoint: process.env.GEMINI_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      intervalMs: Number(process.env.ADVISOR_INTERVAL_MS || 600000)
    };
  }

  get isEnabled(): boolean { return this.cfg.enabled && !!this.cfg.apiKey; }
  get intervalMs(): number { return this.cfg.intervalMs; }

  async advise(pairs: Array<{ symbolIn: string; symbolOut: string; amountIn: string }>, slippageBps: number): Promise<string | null> {
    try {
      const snapshot = await collectPoolSnapshot(this.gswap, pairs, slippageBps);
      const logsPath = path.join(process.cwd(), 'logs', 'scout.log');
      let recentLogs = '';
      try {
        if (fs.existsSync(logsPath)) {
          const content = fs.readFileSync(logsPath, 'utf8');
          recentLogs = content.split('\n').slice(-200).join('\n');
        }
      } catch {}

      const thresholds = {
        arbMinProfitBps: Number(process.env.ARB_MIN_PROFIT_BPS || 0),
        fibMinProfitBps: Number(process.env.FIB_MIN_PROFIT_BPS || 0),
        triangularMinProfitBps: Number(process.env.TRIANGULAR_MIN_PROFIT_BPS || 0),
        slippageBps
      };

      const prompt = [
        'You are an on-chain trading strategy advisor for a GalaChain bot using GalaSwap.',
        'Goal: Recommend exactly one strategy for the next 10 minutes: arbitrage, triangular, or fibonacci.',
        '',
        'Key rules (GalaSwap/GalaChain specifics):',
        '- Use discovered pool fee tiers only (e.g., 500/3000/10000 bps) from live quotes; do not assume defaults.',
        '- Expected net return must include all pool fees and slippage tolerance.',
        '- Reject routes with insufficient liquidity or excessive price impact at the proposed input size.',
        '- Quotes older than 90s are stale; treat stale data as higher risk or insufficient.',
        '- Prefer routes with recent successful execution (bundled and confirmed) and low timeout risk.',
        '',
        'Context:',
        `- Snapshot: ${JSON.stringify(snapshot)}`,
        `- Pairs: ${JSON.stringify(pairs)}`,
        `- Thresholds/slippage: ${JSON.stringify(thresholds)}`,
        `- Recent execution logs (tail):\n${recentLogs}`,
        '',
        'Decision rubric:',
        '1) Compute expected net return (after fees and slippage) for each candidate strategy.',
        '2) Penalize high price impact, thin liquidity, stale quotes, and recent execution failures/timeouts.',
        '3) Triangular only if the full cycle back to the start token is > minProfitBps and each hop is liquid at its discovered fee tier.',
        '4) Fibonacci only if trend and volatility suggest edge after fees and slippage.',
        '5) If data is insufficient or stale, prefer arbitrage with conservative sizing.',
        '',
        'Output JSON only:',
        '{',
        '  "recommended_strategy": "arbitrage|triangular|fibonacci",',
        '  "rationale": "brief reason focused on net return, liquidity, slippage, staleness",',
        '  "confidence_0_to_1": 0.0,',
        '  "risk_flags": ["liquidity", "price_impact", "stale_data", "execution_risk"],',
        '  "notes": "optional brief operational notes"',
        '}',
        '',
        'References (for context only, do not browse):',
        '- GalaChain SDK (@gala-chain/api)',
        '- GSwap SDK (@gala-chain/gswap-sdk)',
        '- GalaSwap app for fee tier patterns and pool behavior',
        '- arb.gala.com (Gala Arb)'
      ].join('\n');

      const body = {
        contents: [
          {
            parts: [
              { text: prompt }
            ]
          }
        ]
      } as any;

      const res = await (globalThis as any).fetch(this.cfg.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.cfg.apiKey as string
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) throw new Error(`Advisor HTTP ${res.status}`);
      const data = await res.json();

      const extractCandidateText = (payload: any): string => {
        const parts = payload?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          const first = parts.find((p: any) => typeof p?.text === 'string') || parts[0];
          if (typeof first === 'string') return first;
          if (first && typeof first.text === 'string') return first.text;
        }
        return '';
      };

      const rawText = (extractCandidateText(data) || '').toString();

      const tryParseJson = (s: string): any | null => {
        if (!s) return null;
        let t = s.trim();
        t = t.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        try { return JSON.parse(t); } catch {}
        const first = t.indexOf('{');
        const last = t.lastIndexOf('}');
        if (first >= 0 && last > first) {
          const sub = t.slice(first, last + 1);
          try { return JSON.parse(sub); } catch {}
        }
        return null;
      };

      const json = tryParseJson(rawText);
      const allowed = ['arbitrage','triangular','fibonacci'];
      if (json && typeof json === 'object') {
        const rec = String(json.recommended_strategy || '').toLowerCase();
        if (allowed.includes(rec)) return rec;
      }

      const fallback = rawText.trim().toLowerCase();
      if (allowed.includes(fallback)) return fallback;
      const found = allowed.find(k => fallback.includes(k));
      if (found) return found;
      return null;
    } catch (e) {
      return null;
    }
  }
}
