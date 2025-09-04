import 'dotenv/config';
import { GSwap } from '@gala-chain/gswap-sdk';
import { createValidDTO } from '@gala-chain/api';
import fs from 'fs-extra';

/**
 * Pool Discovery Script
 *
 * Tests all possible token combinations with all fee tiers
 * to discover which pools actually exist on GalaSwap
 */

interface PoolDiscoveryResult {
  pair: string;
  tokenA: string;
  tokenB: string;
  feeTier: number;
  exists: boolean;
  error?: string;
  quoteResult?: {
    amountIn: string;
    amountOut: string;
    priceImpact?: number;
  };
}

interface DiscoveryReport {
  timestamp: string;
  totalTested: number;
  existingPools: number;
  results: PoolDiscoveryResult[];
  existingPoolsSummary: string[];
}

// All known GalaChain tokens
const TOKENS = [
  'GALA', 'GUSDC', 'GUSDT', 'GWETH', 'GWBTC',
  'SILK', 'ETIME', 'MTRM', 'GVBK', 'POWER'
];

const FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1.0%

function getTokenString(symbol: string): string {
  const tokenMap: { [key: string]: string } = {
    'GALA': 'GALA|Unit|none|none',
    'GUSDC': 'GUSDC|Unit|none|none',
    'GUSDT': 'GUSDT|Unit|none|none',
    'GWETH': 'GWETH|Unit|none|none',
    'GWBTC': 'GWBTC|Unit|none|none',
    'SILK': 'SILK|Unit|none|none',
    'ETIME': 'ETIME|Unit|none|none',
    'MTRM': 'MTRM|Unit|none|none',
    'GVBK': 'GVBK|Unit|none|none',
    'POWER': 'POWER|Unit|none|none'
  };

  const token = tokenMap[symbol];
  if (!token) throw new Error(`Unknown token symbol: ${symbol}`);
  return token;
}

async function discoverAllPools(): Promise<DiscoveryReport> {
  // Initialize GSwap client
  const gswap = new GSwap({
    gatewayBaseUrl: 'https://gateway-mainnet.galachain.com',
    dexBackendBaseUrl: 'https://dex-backend-prod1.defi.gala.com',
    bundlerBaseUrl: 'https://bundle-backend-prod1.defi.gala.com',
    dexContractBasePath: '/api/asset/dexv3-contract',
    tokenContractBasePath: '/api/asset/token-contract',
    bundlingAPIBasePath: '/bundle'
  });

  const results: PoolDiscoveryResult[] = [];
  let totalTested = 0;
  let existingPools = 0;

  console.log(`🔍 Starting pool discovery for ${TOKENS.length} tokens across ${FEE_TIERS.length} fee tiers...`);

  // Test all token pairs
  for (let i = 0; i < TOKENS.length; i++) {
    for (let j = i + 1; j < TOKENS.length; j++) {
      const tokenA = TOKENS[i];
      const tokenB = TOKENS[j];

      // Test both directions for each fee tier
      for (const feeTier of FEE_TIERS) {
        // Test A → B
        totalTested++;
        await testPoolDirection(gswap, tokenA, tokenB, feeTier, results);

        // Test B → A
        totalTested++;
        await testPoolDirection(gswap, tokenB, tokenA, feeTier, results);
      }
    }
  }

  // Count existing pools
  existingPools = results.filter(r => r.exists).length;

  // Create summary of existing pools
  const existingPoolsSummary = results
    .filter(r => r.exists)
    .map(r => `${r.pair} (${r.feeTier}bps)`)
    .sort();

  const report: DiscoveryReport = {
    timestamp: new Date().toISOString(),
    totalTested,
    existingPools,
    results,
    existingPoolsSummary
  };

  // Save results
  const outputPath = 'pool-discovery-results.json';
  await fs.writeJSON(outputPath, report, { spaces: 2 });

  console.log(`\n📊 Pool Discovery Complete!`);
  console.log(`├─ Total combinations tested: ${totalTested}`);
  console.log(`├─ Existing pools found: ${existingPools}`);
  console.log(`├─ Success rate: ${((existingPools / totalTested) * 100).toFixed(1)}%`);
  console.log(`└─ Results saved to: ${outputPath}`);

  console.log(`\n🏊 Existing Pools:`);
  existingPoolsSummary.forEach(pool => console.log(`  ✅ ${pool}`));

  return report;
}

async function testPoolDirection(
  gswap: GSwap,
  tokenIn: string,
  tokenOut: string,
  feeTier: number,
  results: PoolDiscoveryResult[]
): Promise<void> {
  const pair = `${tokenIn}/${tokenOut}`;

  try {
    const tokenInStr = getTokenString(tokenIn);
    const tokenOutStr = getTokenString(tokenOut);

    // Use small test amount
    const testAmount = '1';

    // Try to get a quote
    const quote = await (gswap as any).quoting.quoteExactInput(
      tokenInStr,
      tokenOutStr,
      testAmount,
      feeTier
    );

    if (quote && quote.outTokenAmount) {
      const amountOut = quote.outTokenAmount?.toString?.() ?? quote.outTokenAmount;

      results.push({
        pair,
        tokenA: tokenIn,
        tokenB: tokenOut,
        feeTier,
        exists: true,
        quoteResult: {
          amountIn: testAmount,
          amountOut: amountOut
        }
      });

      console.log(`✅ ${pair} (${feeTier}bps): ${testAmount} → ${amountOut}`);
    } else {
      // Quote returned but no amount - pool doesn't exist
      results.push({
        pair,
        tokenA: tokenIn,
        tokenB: tokenOut,
        feeTier,
        exists: false,
        error: 'No output amount in quote'
      });
    }

  } catch (error: any) {
    results.push({
      pair,
      tokenA: tokenIn,
      tokenB: tokenOut,
      feeTier,
      exists: false,
      error: error.message || String(error)
    });

    // Only log if it's not a common "not found" error
    if (!error.message?.includes('OBJECT_NOT_FOUND') &&
        !error.message?.includes('Not enough liquidity')) {
      console.log(`❌ ${pair} (${feeTier}bps): ${error.message}`);
    }
  }
}

// Run discovery
discoverAllPools().catch(console.error);

export { discoverAllPools, type DiscoveryReport, type PoolDiscoveryResult };
