import 'dotenv/config';

export const config = {
  enableMultiStrategy: process.env.ENABLE_MULTI_STRATEGY === 'true',
  defaultStrategy: process.env.DEFAULT_STRATEGY || 'fafnir-treasure-hoarder',
  strategySwitchInterval: parseInt(process.env.STRATEGY_SWITCH_INTERVAL_MS || '300000'),
  enableStrategySwitching: process.env.ENABLE_STRATEGY_SWITCHING === 'true',
  enableFrontendControl: process.env.ENABLE_FRONTEND_CONTROL === 'true',
  availableStrategies: (process.env.AVAILABLE_STRATEGIES || 'arbitrage,triangular,fibonacci,liquidity-spider,enhanced-trend,fafnir-treasure-hoarder').split(','),
  dryRun: process.env.DRY_RUN === 'true',
  apiPort: parseInt(process.env.BOT_API_PORT || '3001'),
  corsOrigins: (process.env.API_CORS_ORIGINS || 'http://localhost:3001,http://localhost:3000,https://yuphix.io').split(','),
  thresholdBps: Number(process.env.THRESHOLD_BPS) || 80,
  slippageBps: Number(process.env.SLIPPAGE_BPS || 100),
  forceDryRun: process.env.FORCE_DRYRUN === '1',
  gatewayUrl: process.env.GSWAP_GATEWAY_URL || 'https://gateway-mainnet.galachain.com',
  dexBackendUrl: process.env.GSWAP_DEX_BACKEND_URL || 'https://dex-backend-prod1.defi.gala.com',
  bundlerUrl: process.env.GSWAP_BUNDLER_URL || 'https://bundle-backend-prod1.defi.gala.com',
  wallet: process.env.GALACHAIN_WALLET_ADDRESS || '',
  privateKey: process.env.GALACHAIN_PRIVATE_KEY || ''
};
