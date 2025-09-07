import express, { Request, Response } from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'fs-extra';
import cors from 'cors';
import { spawn } from 'child_process';
import { configManager, TradingConfig } from './config-manager.js';
import { securityManager } from './security-manager.js';
import { MultiWalletManager } from './multi-wallet-manager-simple.js';
import { MultiUserStrategyManager } from './multi-user-strategy-manager.js';
import { BackendStoryGenerator } from './story-generator.js';
import { ethers } from 'ethers';
import crypto from 'crypto';

/**
 * Fafnir Bot API Server
 * Provides structured JSON data for yuphix.io integration
 */

// Type definitions for structured outputs
interface BotStatus {
  botName: string;
  strategy: string;
  status: 'running' | 'stopped' | 'error';
  uptime: number;
  lastActivity: string;
  containerId?: string;
}

interface TradeData {
  timestamp: string;
  strategy: string;
  action: 'buy' | 'sell';
  pair: string;
  amount: number;
  price: number;
  profit?: number;
  status: 'success' | 'failed' | 'pending';
}

interface PerformanceMetrics {
  totalTrades: number;
  successfulTrades: number;
  totalProfit: number;
  totalVolume: number;
  winRate: number;
  averageProfit: number;
  dailyProfit: number;
  profitByToken: Record<string, number>;
  last24hTrades: TradeData[];
}

interface PoolData {
  pair: string;
  price: number;
  volume24h: number;
  liquidity: number;
  priceChange24h: number;
  lastUpdate: string;
}

interface Position {
  id: string;
  token: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
  entryTime: string;
  strategy: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
  version: string;
}

class FafnirBotAPI {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private port: number;
  private multiWalletManager: MultiWalletManager;
  private multiUserStrategyManager: MultiUserStrategyManager;
  private storyGenerator: BackendStoryGenerator;
  private addressMappings: Map<string, string> = new Map(); // ethereum -> galachain

  // File paths
  private readonly LOG_FILE_PATH = path.join(process.cwd(), 'logs', 'trades.log');
  private readonly TRANSACTIONS_FILE_PATH = path.join(process.cwd(), 'logs', 'transactions.json');
  private readonly POSITIONS_FILE_PATH = path.join(process.cwd(), 'logs', 'fibonacci-positions.json');

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.multiWalletManager = new MultiWalletManager();
    this.multiUserStrategyManager = new MultiUserStrategyManager();
    this.storyGenerator = new BackendStoryGenerator();

    // Load existing address mappings
    this.loadAddressMappings();

    // Connect multi-wallet manager to API server for real-time notifications
    this.multiWalletManager.setApiServerBroadcast(this.broadcastTradeApprovalRequest.bind(this));

    // Connect multi-user strategy manager for real-time updates
    this.multiUserStrategyManager.setBroadcastCallback((update) => {
      this.broadcastStrategyUpdate.call(this, update);
    });

    // Connect story generator Oracle system for real-time updates
    this.storyGenerator.setBroadcastCallback((update) => {
      this.broadcastOracleUpdate.call(this, update);
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware() {
    // Security headers
    this.app.use(securityManager.securityHeaders);

    // Rate limiting
    this.app.use(securityManager.createRateLimiter());

    // Enable CORS for yuphix.io with security
    this.app.use(cors(securityManager.getCorsOptions()));

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  private setupRoutes() {
    // Token approval endpoint
    this.app.post('/api/wallet/approve', async (req: Request, res: Response) => {
      try {
        const { message, signature } = req.body;
        if (!message || !signature) {
          return this.sendError(res, 'Approval message and signature required', 400);
        }
        // Basic validation: check message structure
        if (typeof message !== 'object' || !message.type || !message.token || !message.spender || !message.owner || !message.amount || !message.timestamp || !message.nonce) {
          return this.sendError(res, 'Invalid approval message format', 400);
        }
        // Verify signature (example for Ethereum)
        let valid = false;
        try {
          const recovered = ethers.utils.verifyMessage(JSON.stringify(message), signature);
          valid = recovered.toLowerCase() === message.owner.replace('eth|', '').toLowerCase();
        } catch (e) {
          return this.sendError(res, 'Signature verification failed', 400);
        }
        if (!valid) {
          return this.sendError(res, 'Signature does not match owner', 401);
        }
        // TODO: Store or process approval for swaps as needed
        this.sendResponse(res, {
          success: true,
          message: 'Token approval received and verified',
          approval: { message, signature }
        });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

        // Bot status
    this.app.get('/api/bots/status', async (req: Request, res: Response) => {
      try {
        const statuses = await this.getBotStatus();
        this.sendResponse(res, statuses);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Performance metrics
    this.app.get('/api/performance', async (req: Request, res: Response) => {
      try {
        const metrics = await this.getPerformanceMetrics();
        this.sendResponse(res, metrics);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Recent trades
    this.app.get('/api/trades', async (req: Request, res: Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const trades = await this.getTrades(limit);
        this.sendResponse(res, trades);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Enhanced transaction details for content generation
    this.app.get('/api/transactions/detailed', async (req: Request, res: Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const transactions = await this.getDetailedTransactions(limit);
        this.sendResponse(res, transactions);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Single transaction with full narrative data
    this.app.get('/api/transactions/:transactionId', async (req: Request, res: Response) => {
      try {
        const { transactionId } = req.params;
        const transaction = await this.getTransactionNarrative(transactionId);
        if (!transaction) {
          return this.sendError(res, 'Transaction not found', 404);
        }
        this.sendResponse(res, transaction);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Story generation endpoints
    this.app.get('/api/stories/wallet/:address', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;
        const limit = parseInt(req.query.limit as string) || 10;
        const stories = await this.storyGenerator.getWalletStories(address, limit);
        this.sendResponse(res, { stories, walletAddress: address });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.post('/api/stories/wallet/:address/preferences', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;
        const preferences = req.body;
        await this.storyGenerator.updateWalletPreferences(address, preferences);
        this.sendResponse(res, { success: true, message: 'Preferences updated' });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.post('/api/stories/wallet/:address/generate', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;
        const { storyType } = req.body;
        const story = await this.storyGenerator.forceGenerateStory(address, storyType);
        this.sendResponse(res, { story, message: 'Story generated successfully' });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Claude configuration endpoints
    this.app.get('/api/stories/claude/config', async (req: Request, res: Response) => {
      try {
        const config = this.storyGenerator.getClaudeConfig();
        this.sendResponse(res, config);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.put('/api/stories/claude/config', async (req: Request, res: Response) => {
      try {
        const config = req.body;
        this.storyGenerator.updateClaudeConfig(config);
        this.sendResponse(res, { success: true, message: 'Claude configuration updated' });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.put('/api/stories/claude/system-prompt', async (req: Request, res: Response) => {
      try {
        const { systemPrompt } = req.body;
        if (!systemPrompt) {
          return this.sendError(res, 'systemPrompt is required', 400);
        }
        this.storyGenerator.updateSystemPrompt(systemPrompt);
        this.sendResponse(res, { success: true, message: 'System prompt updated' });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.put('/api/stories/claude/user-prompt', async (req: Request, res: Response) => {
      try {
        const { userPromptTemplate } = req.body;
        if (!userPromptTemplate) {
          return this.sendError(res, 'userPromptTemplate is required', 400);
        }
        this.storyGenerator.updateUserPromptTemplate(userPromptTemplate);
        this.sendResponse(res, { success: true, message: 'User prompt template updated' });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Oracle system endpoints
    this.app.get('/api/oracle/status', async (req: Request, res: Response) => {
      try {
        const oracleState = this.storyGenerator.getOracleState();
        this.sendResponse(res, oracleState);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.get('/api/oracle/terminal', async (req: Request, res: Response) => {
      try {
        const terminalDisplay = this.storyGenerator.getOracleTerminalDisplay();
        this.sendResponse(res, { terminal: terminalDisplay });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Wallet-specific Oracle endpoints
    this.app.get('/api/oracle/wallet/:address/status', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;
        const walletOracleState = this.storyGenerator.getWalletOracleState(address);
        this.sendResponse(res, walletOracleState);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.get('/api/oracle/wallet/:address/terminal', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;
        const terminalDisplay = this.storyGenerator.getWalletOracleTerminalDisplay(address);
        this.sendResponse(res, { terminal: terminalDisplay });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.put('/api/oracle/wallet/:address/preferences', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;
        const preferences = req.body;
        this.storyGenerator.updateWalletOraclePreferences(address, preferences);
        this.sendResponse(res, { success: true, message: 'Oracle preferences updated' });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.get('/api/oracle/wallets/all', async (req: Request, res: Response) => {
      try {
        const allWalletOracles = this.storyGenerator.getAllWalletOracles();
        const walletOraclesArray = Array.from(allWalletOracles.entries()).map(([address, state]) => ({
          walletAddress: address,
          ...state
        }));
        this.sendResponse(res, { walletOracles: walletOraclesArray });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Current positions
    this.app.get('/api/positions', async (req: Request, res: Response) => {
      try {
        const positions = await this.getPositions();
        this.sendResponse(res, positions);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Live logs
    this.app.get('/api/logs', async (req: Request, res: Response) => {
      try {
        const lines = parseInt(req.query.lines as string) || 100;
        const logs = await this.getLogs(lines);
        this.sendResponse(res, logs);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Pool data
    this.app.get('/api/pools', async (req: Request, res: Response) => {
      try {
        const pools = await this.getPoolData();
        this.sendResponse(res, pools);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Available strategies
    this.app.get('/api/strategies', async (req: Request, res: Response) => {
      try {
        const strategies = await this.getAvailableStrategies();
        this.sendResponse(res, strategies);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Multi-user strategy endpoints
    this.app.post('/api/strategies/assign', async (req: Request, res: Response) => {
      try {
        const { walletAddress, strategy, config } = req.body;

        if (!walletAddress || !strategy) {
          return this.sendError(res, 'Wallet address and strategy required', 400);
        }

        // Assign strategy using multi-user manager (INSTANT!)
        const session = await this.multiUserStrategyManager.assignStrategy({
          walletAddress,
          strategy,
          config
        });

        this.sendResponse(res, {
          sessionId: session.sessionId,
          walletAddress: session.walletAddress,
          strategy: session.selectedStrategy,
          status: 'active',
          config: session.config
        });

      } catch (error: any) {
        console.error('Strategy assignment error:', error);
        this.sendError(res, error.message, 500);
      }
    });

    this.app.post('/api/strategies/:address/control', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;
        const { action, strategy, config } = req.body;

        let result: any = { success: false };

        switch (action) {
          case 'start':
            if (!strategy) {
              return this.sendError(res, 'Strategy required for start action', 400);
            }
            const session = await this.multiUserStrategyManager.assignStrategy({
              walletAddress: address,
              strategy,
              config
            });
            result = { success: true, sessionId: session.sessionId };
            break;

          case 'stop':
            const stopped = await this.multiUserStrategyManager.stopUserStrategy(address);
            result = { success: stopped };
            break;

          default:
            return this.sendError(res, 'Invalid action', 400);
        }

        this.sendResponse(res, {
          ...result,
          walletAddress: address,
          action
        });

      } catch (error: any) {
        console.error('Strategy control error:', error);
        this.sendError(res, error.message, 500);
      }
    });

    this.app.get('/api/strategies/:address/status', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;
        const session = this.multiUserStrategyManager.getUserStatus(address);

        if (!session) {
          return this.sendResponse(res, {
            hasActiveStrategy: false,
            walletAddress: address
          });
        }

        this.sendResponse(res, {
          hasActiveStrategy: true,
          walletAddress: address,
          strategy: session.selectedStrategy,
          isActive: session.isActive,
          sessionId: session.sessionId,
          startTime: session.startTime,
          lastActivity: session.lastActivity,
          lastTradeTime: session.lastTradeTime,
          config: session.config,
          performance: session.performance
        });

      } catch (error: any) {
        console.error('Strategy status error:', error);
        this.sendError(res, error.message, 500);
      }
    });

    this.app.put('/api/strategies/:address/config', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;
        const config = req.body;

        const updated = await this.multiUserStrategyManager.updateUserConfig(address, config);

        if (!updated) {
          return this.sendError(res, 'User session not found', 404);
        }

        this.sendResponse(res, {
          walletAddress: address,
          updatedConfig: config
        });

      } catch (error: any) {
        console.error('Update config error:', error);
        this.sendError(res, error.message, 500);
      }
    });

    this.app.get('/api/performance/:address', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;
        const session = this.multiUserStrategyManager.getUserStatus(address);

        if (!session) {
          return this.sendError(res, 'User session not found', 404);
        }

        this.sendResponse(res, {
          walletAddress: address,
          strategy: session.selectedStrategy,
          performance: session.performance,
          sessionInfo: {
            startTime: session.startTime,
            lastActivity: session.lastActivity,
            lastTradeTime: session.lastTradeTime,
            sessionId: session.sessionId
          }
        });

      } catch (error: any) {
        console.error('Get performance error:', error);
        this.sendError(res, error.message, 500);
      }
    });

    this.app.get('/api/trades/:address', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;

        // Read user's trade log file
        const logDir = path.join(process.cwd(), 'logs', 'multi-user');
        const tradeFile = path.join(logDir, `trades-${address}.log`);

        if (!await fs.pathExists(tradeFile)) {
          return this.sendResponse(res, { trades: [], totalTrades: 0 });
        }

        const logContent = await fs.readFile(tradeFile, 'utf8');
        const trades = logContent
          .split('\n')
          .filter(Boolean)
          .slice(-limit)
          .map(line => JSON.parse(line));

        this.sendResponse(res, {
          trades,
          totalTrades: trades.length,
          walletAddress: address
        });

      } catch (error: any) {
        console.error('Get trades error:', error);
        this.sendError(res, error.message, 500);
      }
    });

    // Strategy control endpoints (admin only)
    this.app.post('/api/strategies/:strategyId/start', securityManager.authenticateApiKey, securityManager.requireAdmin, async (req: Request, res: Response) => {
      try {
        const { strategyId } = req.params;
        const { walletAddress } = req.body;

        // Validate wallet address format
        if (walletAddress && !/^eth\|[0-9a-fA-F]{40}$/.test(walletAddress)) {
          return this.sendError(res, 'Wallet address must be in format eth|<EthereumAddress>', 400);
        }

        const result = await this.startStrategy(strategyId, walletAddress);
        this.sendResponse(res, result);

        // Broadcast strategy change to WebSocket clients
        this.broadcastStrategyChange('started', strategyId);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.post('/api/strategies/:strategyId/stop', async (req: Request, res: Response) => {
      try {
        const { strategyId } = req.params;
        const result = await this.stopStrategy(strategyId);
        this.sendResponse(res, result);

        // Broadcast strategy change to WebSocket clients
        this.broadcastStrategyChange('stopped', strategyId);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

        this.app.post('/api/strategies/switch', async (req: Request, res: Response) => {
      try {
        const { fromStrategy, toStrategy } = req.body;
        const result = await this.switchStrategy(fromStrategy, toStrategy);
        this.sendResponse(res, result);

        // Broadcast strategy switch to WebSocket clients
        this.broadcastStrategyChange('switched', toStrategy, fromStrategy);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // AI Advisor toggle endpoint
    this.app.post('/api/advisor/toggle', async (req: Request, res: Response) => {
      try {
        const { enabled } = req.body;
        const result = await this.toggleAdvisor(enabled);
        this.sendResponse(res, result);

        // Broadcast advisor change to WebSocket clients
        this.broadcastAdvisorChange(enabled);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

        // Wallet authentication endpoint
    this.app.post('/api/auth/wallet', async (req: Request, res: Response) => {
      try {
        const { walletAddress, signature, message, nftVerified } = req.body;

        if (!walletAddress || !signature || !message) {
          return this.sendError(res, 'Missing required fields: walletAddress, signature, message', 400);
        }

        if (!nftVerified) {
          return this.sendError(res, 'NFT verification required', 403);
        }

        // Generate session API key for this wallet
        const sessionApiKey = securityManager.generateSessionApiKey(walletAddress);

        this.sendResponse(res, {
          success: true,
          sessionApiKey,
          walletAddress,
          expiresIn: '24h',
          message: 'Wallet authenticated successfully'
        });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Multi-wallet endpoints
    this.app.post('/api/wallet/connect', async (req: Request, res: Response) => {
      try {
        const { walletAddress } = req.body;

        if (!walletAddress) {
          return this.sendError(res, 'Wallet address required', 400);
        }

        // Connect wallet using multi-wallet manager
        const connectedAddress = await this.multiWalletManager.connectUserWallet(walletAddress);

        this.sendResponse(res, {
          success: true,
          walletAddress: connectedAddress,
          message: 'Wallet connected successfully'
        });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Request trading permissions
    this.app.post('/api/wallet/permissions', async (req: Request, res: Response) => {
      try {
        const { walletAddress, permissions } = req.body;

        if (!walletAddress || !permissions) {
          return this.sendError(res, 'Wallet address and permissions required', 400);
        }

        const grantedPermissions = await this.multiWalletManager.requestTradingPermissions(
          walletAddress,
          permissions
        );

        this.sendResponse(res, {
          success: true,
          walletAddress,
          permissions: grantedPermissions,
          message: 'Permissions granted successfully'
        });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Get wallet balances
    this.app.get('/api/wallet/:address/balances', async (req: Request, res: Response) => {
      try {
        const { address } = req.params;

        const balances = await this.multiWalletManager.getUserWalletBalances(address);

        this.sendResponse(res, {
          success: true,
          walletAddress: address,
          balances
        });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Cross-chain authentication endpoint for MetaMask users
    this.app.post('/api/auth/cross-chain', async (req: Request, res: Response) => {
      try {
        const { ethereumAddress, ethereumSignature, galaChainAddress, message, walletType } = req.body;

        if (!ethereumAddress || !ethereumSignature || !message) {
          return this.sendError(res, 'Missing required fields: ethereumAddress, ethereumSignature, message', 400);
        }

        // Verify Ethereum signature
        const isValidSignature = await this.verifyEthereumSignature(ethereumAddress, ethereumSignature, message);
        if (!isValidSignature) {
          return this.sendError(res, 'Invalid Ethereum signature', 401);
        }

        // Get or create GalaChain address mapping
        const mappedGalaAddress = galaChainAddress || await this.getOrCreateGalaChainMapping(ethereumAddress);

        // Generate session API key for the GalaChain address
        const sessionApiKey = securityManager.generateSessionApiKey(mappedGalaAddress);

        this.sendResponse(res, {
          success: true,
          sessionApiKey,
          ethereumAddress,
          galaChainAddress: mappedGalaAddress,
          walletType: walletType || 'metamask',
          expiresIn: '24h',
          message: 'Cross-chain authentication successful'
        });

        console.log(`✅ Cross-chain auth successful: ${ethereumAddress} → ${mappedGalaAddress}`);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Address mapping endpoint with GalaChain verification
    this.app.post('/api/wallet/map-address', async (req: Request, res: Response) => {
      try {
        const { ethereumAddress, galaChainAddress } = req.body;

        if (!ethereumAddress || !ethers.utils.isAddress(ethereumAddress)) {
          return this.sendError(res, 'Valid Ethereum address required', 400);
        }

        let mappedAddress;
        let addressStatus = 'unknown';

        if (galaChainAddress) {
          // User provided their GalaChain address - verify it exists and has balance
          const verification = await this.verifyGalaChainAddress(galaChainAddress);
          if (verification.exists) {
            mappedAddress = galaChainAddress;
            addressStatus = verification.hasFunds ? 'verified_funded' : 'verified_empty';
          } else {
            return this.sendError(res, 'Provided GalaChain address does not exist or is invalid', 400);
          }
        } else {
          // No GalaChain address provided - create deterministic mapping but warn user
          mappedAddress = await this.getOrCreateGalaChainMapping(ethereumAddress);
          addressStatus = 'deterministic_unverified';
        }

        this.sendResponse(res, {
          success: true,
          ethereumAddress: ethereumAddress.toLowerCase(),
          galaChainAddress: mappedAddress,
          addressStatus,
          derivationMethod: galaChainAddress ? 'user_provided' : 'deterministic',
          message: addressStatus === 'deterministic_unverified'
            ? 'Deterministic mapping created, but GalaChain address verification needed for trading'
            : 'Address mapping successful',
          requiresGalaChainSetup: addressStatus === 'deterministic_unverified' || addressStatus === 'verified_empty'
        });

        console.log(`🔗 Address mapping: ${ethereumAddress} → ${mappedAddress} (${addressStatus})`);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Get address mapping
    this.app.get('/api/wallet/mapping/:ethereumAddress', async (req: Request, res: Response) => {
      try {
        const { ethereumAddress } = req.params;

        if (!ethers.utils.isAddress(ethereumAddress)) {
          return this.sendError(res, 'Valid Ethereum address required', 400);
        }

        const galaChainAddress = this.addressMappings.get(ethereumAddress.toLowerCase());

        if (!galaChainAddress) {
          return this.sendError(res, 'No mapping found for this Ethereum address', 404);
        }

        this.sendResponse(res, {
          success: true,
          ethereumAddress: ethereumAddress.toLowerCase(),
          galaChainAddress,
          derivationMethod: 'deterministic'
        });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Verify cross-chain signature
    this.app.post('/api/wallet/verify-signature', async (req: Request, res: Response) => {
      try {
        const { address, signature, message, walletType } = req.body;

        if (!address || !signature || !message || !walletType) {
          return this.sendError(res, 'Missing required fields: address, signature, message, walletType', 400);
        }

        let isValid = false;

        if (walletType === 'metamask') {
          isValid = await this.verifyEthereumSignature(address, signature, message);
        } else if (walletType === 'galachain') {
          // For GalaChain signatures - implement based on GalaChain SDK
          isValid = signature.length > 0; // Placeholder
        }

        this.sendResponse(res, {
          success: true,
          valid: isValid,
          address,
          walletType,
          message: isValid ? 'Signature valid' : 'Signature invalid'
        });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Check user's GalaChain readiness for trading
    this.app.post('/api/wallet/check-trading-readiness', async (req: Request, res: Response) => {
      try {
        const { ethereumAddress, galaChainAddress } = req.body;

        if (!ethereumAddress || !ethers.utils.isAddress(ethereumAddress)) {
          return this.sendError(res, 'Valid Ethereum address required', 400);
        }

        const readinessCheck = {
          ethereumAddress: ethereumAddress.toLowerCase(),
          hasGalaChainWallet: false,
          galaChainAddress: null as string | null,
          canTrade: false,
          balances: null as any,
          requiredActions: [] as string[]
        };

        if (galaChainAddress) {
          const verification = await this.verifyGalaChainAddress(galaChainAddress);
          readinessCheck.hasGalaChainWallet = verification.exists;
          readinessCheck.galaChainAddress = galaChainAddress;
          readinessCheck.balances = verification.balances;

          if (verification.exists && verification.hasFunds) {
            readinessCheck.canTrade = true;
          } else if (verification.exists && !verification.hasFunds) {
            readinessCheck.requiredActions.push('Fund GalaChain wallet with trading tokens (GALA, GUSDC, etc.)');
          } else {
            readinessCheck.requiredActions.push('Provided GalaChain address is invalid or does not exist');
          }
        } else {
          readinessCheck.requiredActions.push('Connect or create a GalaChain wallet');
          readinessCheck.requiredActions.push('Fund GalaChain wallet with trading tokens');
        }

        if (!readinessCheck.canTrade && readinessCheck.requiredActions.length === 0) {
          readinessCheck.requiredActions.push('Unknown issue preventing trading');
        }

        this.sendResponse(res, {
          success: true,
          readiness: readinessCheck,
          message: readinessCheck.canTrade
            ? 'User is ready for trading'
            : `Trading setup required: ${readinessCheck.requiredActions.length} action(s) needed`
        });

        console.log(`🧪 Trading readiness check: ${ethereumAddress} - canTrade: ${readinessCheck.canTrade}`);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Process trade approval
    this.app.post('/api/trades/approve', async (req: Request, res: Response) => {
      try {
        const { tradeId, approved, signature } = req.body;

        if (!tradeId || approved === undefined) {
          return this.sendError(res, 'Trade ID and approval status required', 400);
        }

        await this.multiWalletManager.processTradeApproval(tradeId, approved, signature);

        this.sendResponse(res, {
          success: true,
          tradeId,
          approved,
          message: 'Trade approval processed'
        });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

        // Wallet logout endpoint
    this.app.post('/api/auth/logout', securityManager.authenticateApiKey, async (req: Request, res: Response) => {
      try {
        const apiKey = req.headers['x-api-key'] as string || req.query.api_key as string;

        if (apiKey?.startsWith('session_')) {
          securityManager.revokeSessionApiKey(apiKey);
          this.sendResponse(res, {
            success: true,
            message: 'Session revoked successfully'
          });
        } else {
          this.sendResponse(res, {
            success: true,
            message: 'No session to revoke'
          });
        }
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Cross-chain authentication endpoint for MetaMask users
    this.app.post('/api/auth/cross-chain', async (req: Request, res: Response) => {
      try {
        const { ethereumAddress, ethereumSignature, galaChainAddress, message, walletType } = req.body;

        if (!ethereumAddress || !ethereumSignature || !message) {
          return this.sendError(res, 'Missing required fields: ethereumAddress, ethereumSignature, message', 400);
        }

        // Verify Ethereum signature
        const isValidSignature = await this.verifyEthereumSignature(ethereumAddress, ethereumSignature, message);
        if (!isValidSignature) {
          return this.sendError(res, 'Invalid Ethereum signature', 401);
        }

        // Get or create GalaChain address mapping
        const mappedGalaAddress = galaChainAddress || await this.getOrCreateGalaChainMapping(ethereumAddress);

        // Generate session API key for the GalaChain address
        const sessionApiKey = securityManager.generateSessionApiKey(mappedGalaAddress);

        this.sendResponse(res, {
          success: true,
          sessionApiKey,
          ethereumAddress,
          galaChainAddress: mappedGalaAddress,
          walletType: walletType || 'metamask',
          expiresIn: '24h',
          message: 'Cross-chain authentication successful'
        });

        console.log(`✅ Cross-chain auth successful: ${ethereumAddress} → ${mappedGalaAddress}`);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Address mapping endpoint
    this.app.post('/api/wallet/map-address', async (req: Request, res: Response) => {
      try {
        const { ethereumAddress } = req.body;

        if (!ethereumAddress || !ethers.utils.isAddress(ethereumAddress)) {
          return this.sendError(res, 'Valid Ethereum address required', 400);
        }

        const galaChainAddress = await this.getOrCreateGalaChainMapping(ethereumAddress);

        this.sendResponse(res, {
          success: true,
          ethereumAddress: ethereumAddress.toLowerCase(),
          galaChainAddress,
          derivationMethod: 'deterministic',
          message: 'Address mapping successful'
        });

        console.log(`🔗 Address mapping: ${ethereumAddress} → ${galaChainAddress}`);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Get address mapping
    this.app.get('/api/wallet/mapping/:ethereumAddress', async (req: Request, res: Response) => {
      try {
        const { ethereumAddress } = req.params;

        if (!ethers.utils.isAddress(ethereumAddress)) {
          return this.sendError(res, 'Valid Ethereum address required', 400);
        }

        const galaChainAddress = this.addressMappings.get(ethereumAddress.toLowerCase());

        if (!galaChainAddress) {
          return this.sendError(res, 'No mapping found for this Ethereum address', 404);
        }

        this.sendResponse(res, {
          success: true,
          ethereumAddress: ethereumAddress.toLowerCase(),
          galaChainAddress,
          derivationMethod: 'deterministic'
        });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Verify cross-chain signature
    this.app.post('/api/wallet/verify-signature', async (req: Request, res: Response) => {
      try {
        const { address, signature, message, walletType } = req.body;

        if (!address || !signature || !message || !walletType) {
          return this.sendError(res, 'Missing required fields: address, signature, message, walletType', 400);
        }

        let isValid = false;

        if (walletType === 'metamask') {
          isValid = await this.verifyEthereumSignature(address, signature, message);
        } else if (walletType === 'galachain') {
          // For GalaChain signatures - implement based on GalaChain SDK
          isValid = signature.length > 0; // Placeholder
        }

        this.sendResponse(res, {
          success: true,
          valid: isValid,
          address,
          walletType,
          message: isValid ? 'Signature valid' : 'Signature invalid'
        });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // AI Advisor status endpoint
    this.app.get('/api/advisor/status', async (req: Request, res: Response) => {
      try {
        const status = await this.getAdvisorStatus();
        this.sendResponse(res, status);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Configuration management endpoints (authentication required)
    this.app.get('/api/config', securityManager.authenticateApiKey, async (req: Request, res: Response) => {
      try {
        const config = configManager.getConfig();
        this.sendResponse(res, config);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.get('/api/config/summary', async (req: Request, res: Response) => {
      try {
        const summary = configManager.getConfigSummary();
        this.sendResponse(res, summary);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.get('/api/config/:strategy', async (req: Request, res: Response) => {
      try {
        const { strategy } = req.params;
        const config = configManager.getStrategyConfig(strategy);
        if (!config) {
          this.sendError(res, `Strategy '${strategy}' not found`, 404);
          return;
        }
        this.sendResponse(res, config);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.put('/api/config', securityManager.authenticateApiKey, async (req: Request, res: Response) => {
      try {
                const updates = req.body;
        const userRole = (req as any).userRole;
        const apiKey = (req as any).apiKey;

        // Security validation
        const securityValidation = securityManager.validateConfigChange(updates, userRole);
        if (!securityValidation.valid) {
          securityManager.auditLog('CONFIG_CHANGE_DENIED', apiKey, { updates, errors: securityValidation.errors, ip: req.ip });
          this.sendError(res, `Security validation failed: ${securityValidation.errors.join(', ')}`, 403);
          return;
        }

        // Validate configuration
        const validation = configManager.validateConfig(updates);
        if (!validation.valid) {
          this.sendError(res, `Configuration validation failed: ${validation.errors.join(', ')}`, 400);
          return;
        }

                const updatedConfig = configManager.updateConfig(updates);

        // Audit log successful change
        securityManager.auditLog('CONFIG_CHANGED', apiKey, { updates, ip: req.ip });

        this.sendResponse(res, updatedConfig);

        // Broadcast configuration change to WebSocket clients
        this.broadcastConfigChange('updated', updates);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.put('/api/config/:strategy', async (req: Request, res: Response) => {
      try {
        const { strategy } = req.params;
        const updates = req.body;

        const updatedConfig = configManager.updateStrategyConfig(strategy, updates);
        this.sendResponse(res, updatedConfig);

        // Broadcast strategy configuration change
        this.broadcastConfigChange('strategy_updated', { strategy, updates });
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.post('/api/config/reset', async (req: Request, res: Response) => {
      try {
        const defaultConfig = configManager.resetToDefaults();
        this.sendResponse(res, defaultConfig);

        // Broadcast configuration reset
        this.broadcastConfigChange('reset', {});
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    this.app.post('/api/config/apply', async (req: Request, res: Response) => {
      try {
        const envVars = configManager.applyToEnvironment();
        const result = await this.applyConfigToContainers(envVars);
        this.sendResponse(res, result);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });

    // Complete dashboard summary - main endpoint for yuphix.io (public)
    this.app.get('/api/dashboard', async (req: Request, res: Response) => {
      try {
        const [bots, performance, positions, pools] = await Promise.all([
          this.getBotStatus(),
          this.getPerformanceMetrics(),
          this.getPositions(),
          this.getPoolData()
        ]);

        const dashboard = {
          bots: {
            total: bots.length,
            running: bots.filter(b => b.status === 'running').length,
            stopped: bots.filter(b => b.status === 'stopped').length,
            errors: bots.filter(b => b.status === 'error').length,
            details: bots
          },
          performance,
          positions: {
            total: positions.length,
            totalValue: positions.reduce((sum, p) => sum + (p.amount * p.currentPrice), 0),
            unrealizedPnL: positions.reduce((sum, p) => sum + p.unrealizedPnL, 0),
            realizedPnL: positions.reduce((sum, p) => sum + p.realizedPnL, 0),
            details: positions
          },
          pools: {
            total: pools.length,
            totalVolume24h: pools.reduce((sum, p) => sum + p.volume24h, 0),
            details: pools
          },
          lastUpdate: new Date().toISOString()
        };

        this.sendResponse(res, dashboard);
      } catch (error: any) {
        this.sendError(res, error.message, 500);
      }
    });
  }

    private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket, request: any) => {
      // Authenticate WebSocket connection
      const auth = securityManager.authenticateWebSocket(request);

      if (!auth.authenticated) {
        console.warn('🚨 Unauthenticated WebSocket connection attempt');
        ws.close(1008, 'Authentication required');
        return;
      }

      console.log(`📡 WebSocket client connected (${auth.userRole})`);

      // Add user info to WebSocket
      (ws as any).userRole = auth.userRole;
      (ws as any).apiKey = auth.apiKey;

      // Send initial data
      this.sendInitialData(ws);

      // Extract wallet address from session API key if applicable
      let walletAddress: string | null = null;
      if (auth.apiKey && auth.apiKey.startsWith('session_')) {
        const parts = auth.apiKey.split('_');
        if (parts.length >= 3) {
          walletAddress = parts[parts.length - 1]; // Last part contains wallet suffix
        }
      }
      (ws as any).walletAddress = walletAddress;

      // Handle client messages
      ws.on('message', (message: WebSocket.RawData) => {
        try {
          const data = JSON.parse(message.toString());

          // Audit log WebSocket commands
          if (data.type !== 'ping' && data.type !== 'subscribe') {
            securityManager.auditLog(`WEBSOCKET_${data.type.toUpperCase()}`, (ws as any).apiKey, { data, userRole: (ws as any).userRole });
          }

          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });

      ws.on('close', () => {
        console.log('📡 WebSocket client disconnected');
      });
    });

    // Send periodic updates to all connected clients
    setInterval(() => {
      this.broadcastUpdates();
    }, 30000); // Every 30 seconds
  }

  // Data retrieval methods
  private async getBotStatus(): Promise<BotStatus[]> {
    return new Promise((resolve) => {
      const statuses: BotStatus[] = [];

      // Check Docker containers
      const dockerPs = spawn('docker', ['ps', '--format', 'table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}']);
      let output = '';

      dockerPs.stdout.on('data', (data) => {
        output += data.toString();
      });

      dockerPs.on('close', () => {
        const lines = output.split('\n').filter(line => line.includes('fafnir-bot'));

                lines.forEach(line => {
          const parts = line.split('\t');
          if (parts.length >= 2) {
            const name = parts[0].trim();
            const status = parts[1].trim();

            // Map container names to strategy types
            let strategy = 'Unknown';
            if (name.includes('fibonacci')) strategy = 'DCA Fibonacci';
            else if (name.includes('trend')) strategy = 'Enhanced Trend';
            else if (name.includes('spider')) strategy = 'Liquidity Spider';
            else if (name.includes('arbitrage') && name.includes('triangular')) strategy = 'Triangular Arbitrage';
            else if (name.includes('arbitrage')) strategy = 'Arbitrage';
            else if (name.includes('conservative')) strategy = 'Conservative Fibonacci';

            statuses.push({
              botName: name,
              strategy,
              status: status.includes('Up') ? 'running' : 'stopped',
              uptime: this.parseUptime(status),
              lastActivity: new Date().toISOString(),
              containerId: name
            });
          }
        });

        // If no containers found, show default status
        if (statuses.length === 0) {
          statuses.push({
            botName: 'fafnir-bot-fibonacci',
            strategy: 'DCA Fibonacci',
            status: 'stopped',
            uptime: 0,
            lastActivity: new Date().toISOString()
          });
        }

        resolve(statuses);
      });

      dockerPs.on('error', () => {
        resolve([{
          botName: 'fafnir-bot-fibonacci',
          strategy: 'DCA Fibonacci',
          status: 'error',
          uptime: 0,
          lastActivity: new Date().toISOString()
        }]);
      });
    });
  }

  private async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const trades = await this.getTrades(1000); // Get more trades for metrics
    const transactions = await this.getTransactionData();

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentTrades = trades.filter(t => new Date(t.timestamp) > last24h);
    const successfulTrades = trades.filter(t => t.status === 'success');

    const totalProfit = transactions.reduce((sum: number, tx: any) => {
      return sum + (tx.profit || 0);
    }, 0);

    const dailyProfit = transactions
      .filter((tx: any) => new Date(tx.timestamp) > last24h)
      .reduce((sum: number, tx: any) => sum + (tx.profit || 0), 0);

    const totalVolume = transactions.reduce((sum: number, tx: any) => {
      return sum + (tx.volume || 0);
    }, 0);

    const profitByToken: Record<string, number> = {};
    transactions.forEach((tx: any) => {
      if (tx.pool && tx.profit) {
        const tokens = tx.pool.split('/');
        tokens.forEach((token: string) => {
          profitByToken[token] = (profitByToken[token] || 0) + tx.profit;
        });
      }
    });

    return {
      totalTrades: trades.length,
      successfulTrades: successfulTrades.length,
      totalProfit,
      totalVolume,
      winRate: trades.length > 0 ? (successfulTrades.length / trades.length) * 100 : 0,
      averageProfit: successfulTrades.length > 0 ? totalProfit / successfulTrades.length : 0,
      dailyProfit,
      profitByToken,
      last24hTrades: recentTrades
    };
  }

  private async getTrades(limit: number = 50): Promise<TradeData[]> {
    try {
      if (!await fs.pathExists(this.LOG_FILE_PATH)) return [];

      const logs = (await fs.readFile(this.LOG_FILE_PATH, 'utf8'))
        .split('\n')
        .filter(Boolean);

      const trades: TradeData[] = [];

            logs.forEach(line => {
        // Parse trade logs based on your log format
        const tradeMatch = line.match(/\[(.*?)\].*?(buy|sell).*?(\w+\/\w+).*?(\d+\.?\d*)\s*(?:tokens?|GALA|GUSDC|GUSDT|GWETH)/i);
        if (tradeMatch) {
          const profitMatch = line.match(/profit[:\s]*([+-]?\d+\.?\d*)/i);

          // Extract strategy from log line
          let strategy = 'unknown';
          if (line.includes('fibonacci') || line.includes('DCA') || line.includes('Fibonacci')) strategy = 'fibonacci';
          else if (line.includes('trend') || line.includes('Trend')) strategy = 'trend';
          else if (line.includes('spider') || line.includes('Spider')) strategy = 'liquidity-spider';
          else if (line.includes('triangular') || line.includes('Triangular')) strategy = 'triangular-arbitrage';
          else if (line.includes('arbitrage') || line.includes('Arbitrage')) strategy = 'arbitrage';
          else if (line.includes('conservative') || line.includes('Conservative')) strategy = 'conservative-fibonacci';

          trades.push({
            timestamp: tradeMatch[1],
            strategy,
            action: tradeMatch[2].toLowerCase() as 'buy' | 'sell',
            pair: tradeMatch[3],
            amount: parseFloat(tradeMatch[4]),
            price: 0, // Extract if available
            profit: profitMatch ? parseFloat(profitMatch[1]) : undefined,
            status: line.includes('✅') ? 'success' : line.includes('❌') ? 'failed' : 'pending'
          });
        }
      });

      return trades.slice(-limit);
    } catch (error) {
      console.error('Error parsing trades:', error);
      return [];
    }
  }

  private async getPositions(): Promise<Position[]> {
    try {
      if (!await fs.pathExists(this.POSITIONS_FILE_PATH)) return [];

      const data = await fs.readJson(this.POSITIONS_FILE_PATH);
      const positions = data.positions || [];

      return positions.map((pos: any, index: number) => ({
        id: `pos_${index}`,
        token: pos.token || 'GALA',
        amount: pos.amount || 0,
        entryPrice: pos.entryPrice || 0,
        currentPrice: pos.currentPrice || pos.entryPrice || 0,
        unrealizedPnL: ((pos.currentPrice || pos.entryPrice) - pos.entryPrice) * pos.amount,
        realizedPnL: pos.realizedPnL || 0,
        entryTime: pos.entryTime || new Date().toISOString(),
        strategy: 'fibonacci'
      }));
    } catch (error) {
      console.error('Error reading positions:', error);
      return [];
    }
  }

  private async getPoolData(): Promise<PoolData[]> {
    // This would be populated by your pool monitoring logic
    // For now, return example structure
    return [
      {
        pair: 'GALA/GUSDC',
        price: 0.015837,
        volume24h: 125000,
        liquidity: 500000,
        priceChange24h: 5.2,
        lastUpdate: new Date().toISOString()
      },
      {
        pair: 'GALA/GUSDT',
        price: 0.015837,
        volume24h: 89000,
        liquidity: 320000,
        priceChange24h: 4.8,
        lastUpdate: new Date().toISOString()
      }
    ];
  }

  private async getLogs(lines: number = 100): Promise<string[]> {
    try {
      if (!await fs.pathExists(this.LOG_FILE_PATH)) return [];

      const logs = (await fs.readFile(this.LOG_FILE_PATH, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .slice(-lines);

      return logs;
    } catch (error) {
      console.error('Error reading logs:', error);
      return [];
    }
  }

  private async getTransactionData(): Promise<any[]> {
    try {
      if (!await fs.pathExists(this.TRANSACTIONS_FILE_PATH)) return [];
      const data = await fs.readJson(this.TRANSACTIONS_FILE_PATH);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error reading transactions:', error);
      return [];
    }
  }

  /**
   * Enhanced transaction data for content generation with rich narrative details
   */
  private async getDetailedTransactions(limit: number = 50): Promise<any[]> {
    try {
      const transactions = await this.getTransactionData();
      const trades = await this.getTrades(1000); // Get more context

      return transactions.slice(-limit).map(tx => {
        // Calculate position tracking
        const relatedTrades = trades.filter(t =>
          t.pair === this.extractPairFromTokens(tx.tokenIn, tx.tokenOut)
        );

        const position = this.calculatePositionMetrics(tx, relatedTrades);

        return {
          // Core Transaction Data
          transactionId: tx.transactionId,
          timestamp: tx.timestamp,
          blockTime: new Date(tx.timestamp).getTime(),

          // Trading Action Details
          action: {
            type: tx.type,
            strategy: tx.strategy || this.detectStrategyFromTransaction(tx),
            confidence: this.calculateTradeConfidence(tx, relatedTrades)
          },

          // Token Exchange Details
          exchange: {
            tokenIn: {
              symbol: this.getTokenSymbol(tx.tokenIn),
              fullName: this.getTokenFullName(tx.tokenIn),
              amount: parseFloat(tx.amountIn),
              valueUSD: this.estimateTokenValueUSD(tx.tokenIn, tx.amountIn)
            },
            tokenOut: {
              symbol: this.getTokenSymbol(tx.tokenOut),
              fullName: this.getTokenFullName(tx.tokenOut),
              amountExpected: parseFloat(tx.quotedAmountOut),
              amountActual: tx.amountOut === 'pending' ? null : parseFloat(tx.amountOut),
              valueUSD: this.estimateTokenValueUSD(tx.tokenOut, tx.quotedAmountOut)
            },
            slippage: {
              allowedBps: tx.slippageBps,
              actualBps: tx.actualSlippage || null,
              slippageImpact: this.calculateSlippageImpact(tx)
            }
          },

          // Position & Profit Tracking
          position: {
            currentHoldings: position.currentHoldings,
            averageEntryPrice: position.averageEntryPrice,
            unrealizedPnL: position.unrealizedPnL,
            realizedPnL: tx.profit || 0,
            profitPercentage: tx.profitPercentage || 0,
            totalInvested: position.totalInvested,
            positionSize: position.positionSize
          },

          // Transaction Execution Details
          execution: {
            status: tx.success ? 'SUCCESS' : 'FAILED',
            transactionHash: tx.transactionHash,
            gasUsed: tx.gasUsed,
            feeTier: tx.feeTier,
            executionTime: this.estimateExecutionTime(tx),
            networkConditions: this.assessNetworkConditions(tx)
          },

          // Wallet & Identity
          trader: {
            walletAddress: tx.walletAddress,
            addressType: this.getAddressType(tx.walletAddress),
            traderRank: this.calculateTraderRank(tx.walletAddress, relatedTrades),
            experienceLevel: this.assessExperienceLevel(tx.walletAddress, relatedTrades)
          },

          // Market Context for Storytelling
          marketContext: {
            timeOfDay: this.getTimeOfDay(tx.timestamp),
            marketPhase: this.getMarketPhase(tx.timestamp),
            volatilityLevel: this.assessVolatility(relatedTrades),
            trendDirection: this.getTrendDirection(relatedTrades),
            competitionLevel: this.assessCompetitionLevel(tx),
            riskLevel: this.calculateRiskLevel(tx, position)
          },

          // Narrative Elements for Content Generation
          narrative: {
            questType: this.generateQuestType(tx),
            treasureClass: this.classifyTreasure(tx),
            battleOutcome: this.determineBattleOutcome(tx),
            heroicMoment: this.identifyHeroicMoment(tx, position),
            legendaryStatus: this.assessLegendaryStatus(tx, position),
            storyElements: this.generateStoryElements(tx, position, relatedTrades)
          },

          // Error Details (if any)
          error: tx.error ? {
            message: tx.error,
            category: this.categorizeError(tx.error),
            recoveryAction: this.suggestRecoveryAction(tx.error)
          } : null
        };
      });
    } catch (error) {
      console.error('Error generating detailed transactions:', error);
      return [];
    }
  }

  /**
   * Get single transaction with full narrative context
   */
  private async getTransactionNarrative(transactionId: string): Promise<any | null> {
    try {
      const transactions = await this.getDetailedTransactions(1000);
      return transactions.find(tx => tx.transactionId === transactionId) || null;
    } catch (error) {
      console.error('Error getting transaction narrative:', error);
      return null;
    }
  }

  // Helper methods for enhanced transaction data
  private extractPairFromTokens(tokenIn: string, tokenOut: string): string {
    const symbolIn = this.getTokenSymbol(tokenIn);
    const symbolOut = this.getTokenSymbol(tokenOut);
    return `${symbolIn}/${symbolOut}`;
  }

  private getTokenSymbol(tokenString: string): string {
    const parts = tokenString.split('|');
    return parts[0] || tokenString;
  }

  private getTokenFullName(tokenString: string): string {
    const symbol = this.getTokenSymbol(tokenString);
    const nameMap: { [key: string]: string } = {
      'GALA': 'Gala Games Token',
      'GUSDC': 'Gala USD Coin',
      'GWETH': 'Gala Wrapped Ethereum',
      'GWBTC': 'Gala Wrapped Bitcoin',
      'GUSDT': 'Gala Tether USD',
      'SILK': 'Silk Token'
    };
    return nameMap[symbol] || symbol;
  }

  private estimateTokenValueUSD(tokenString: string, amount: string): number {
    // Simplified USD estimation - in production, you'd use real price feeds
    const symbol = this.getTokenSymbol(tokenString);
    const priceMap: { [key: string]: number } = {
      'GALA': 0.0162,
      'GUSDC': 1.00,
      'GWETH': 2500,
      'GWBTC': 45000,
      'GUSDT': 1.00,
      'SILK': 0.50
    };
    return parseFloat(amount) * (priceMap[symbol] || 0);
  }

  private calculatePositionMetrics(tx: any, relatedTrades: any[]): any {
    // Calculate position metrics from trade history
    let totalInvested = 0;
    let totalReceived = 0;
    let currentHoldings = 0;

    relatedTrades.forEach(trade => {
      if (trade.action === 'buy') {
        totalInvested += trade.amount * trade.price;
        currentHoldings += trade.amount;
      } else {
        totalReceived += trade.amount * trade.price;
        currentHoldings -= trade.amount;
      }
    });

    const averageEntryPrice = totalInvested / Math.max(currentHoldings, 1);
    const currentPrice = this.estimateTokenValueUSD(tx.tokenOut, '1');
    const unrealizedPnL = currentHoldings * (currentPrice - averageEntryPrice);

    return {
      currentHoldings,
      averageEntryPrice,
      unrealizedPnL,
      totalInvested,
      positionSize: totalInvested
    };
  }

  private detectStrategyFromTransaction(tx: any): string {
    // Detect strategy based on transaction patterns
    if (tx.type === 'ARBITRAGE') return 'arbitrage';
    if (tx.amountIn === '1' && tx.tokenOut.includes('GALA')) return 'fafnir-treasure-hoarder';
    return 'unknown';
  }

  private calculateTradeConfidence(tx: any, relatedTrades: any[]): number {
    // Calculate confidence based on success rate and patterns
    const recentTrades = relatedTrades.slice(-10);
    const successRate = recentTrades.filter(t => t.status === 'success').length / Math.max(recentTrades.length, 1);
    return Math.round(successRate * 100);
  }

  private calculateSlippageImpact(tx: any): string {
    if (!tx.actualSlippage) return 'unknown';
    if (tx.actualSlippage < 50) return 'minimal';
    if (tx.actualSlippage < 100) return 'moderate';
    return 'high';
  }

  private estimateExecutionTime(tx: any): number {
    // Estimate based on network conditions and transaction complexity
    return Math.random() * 30000 + 5000; // 5-35 seconds
  }

  private assessNetworkConditions(tx: any): string {
    const conditions = ['optimal', 'good', 'congested', 'slow'];
    return conditions[Math.floor(Math.random() * conditions.length)];
  }

  private getAddressType(address: string): string {
    if (address.startsWith('eth|')) return 'ethereum';
    if (address.startsWith('gala|')) return 'galachain';
    return 'unknown';
  }

  private calculateTraderRank(address: string, trades: any[]): string {
    const tradeCount = trades.filter(t => t.pair).length;
    if (tradeCount > 100) return 'legendary';
    if (tradeCount > 50) return 'expert';
    if (tradeCount > 20) return 'experienced';
    if (tradeCount > 5) return 'novice';
    return 'beginner';
  }

  private assessExperienceLevel(address: string, trades: any[]): string {
    const profitableTrades = trades.filter(t => (t.profit || 0) > 0).length;
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? profitableTrades / totalTrades : 0;

    if (winRate > 0.8) return 'master';
    if (winRate > 0.6) return 'skilled';
    if (winRate > 0.4) return 'learning';
    return 'apprentice';
  }

  private getTimeOfDay(timestamp: string): string {
    const hour = new Date(timestamp).getHours();
    if (hour < 6) return 'dawn';
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    if (hour < 22) return 'evening';
    return 'night';
  }

  private getMarketPhase(timestamp: string): string {
    const phases = ['accumulation', 'markup', 'distribution', 'markdown'];
    return phases[Math.floor(Math.random() * phases.length)];
  }

  private assessVolatility(trades: any[]): string {
    // Simplified volatility assessment
    const recentTrades = trades.slice(-20);
    const priceChanges = recentTrades.map(t => Math.abs(t.profit || 0));
    const avgChange = priceChanges.reduce((a, b) => a + b, 0) / Math.max(priceChanges.length, 1);

    if (avgChange > 5) return 'extreme';
    if (avgChange > 2) return 'high';
    if (avgChange > 0.5) return 'moderate';
    return 'low';
  }

  private getTrendDirection(trades: any[]): string {
    const recentTrades = trades.slice(-10);
    const profits = recentTrades.map(t => t.profit || 0);
    const trend = profits.reduce((a, b) => a + b, 0);

    if (trend > 5) return 'strongly_bullish';
    if (trend > 1) return 'bullish';
    if (trend > -1) return 'sideways';
    if (trend > -5) return 'bearish';
    return 'strongly_bearish';
  }

  private assessCompetitionLevel(tx: any): string {
    // Assess based on slippage and execution speed
    const slippage = tx.slippageBps || 0;
    if (slippage > 200) return 'fierce';
    if (slippage > 100) return 'competitive';
    if (slippage > 50) return 'moderate';
    return 'calm';
  }

  private calculateRiskLevel(tx: any, position: any): string {
    const positionSize = position.positionSize || 0;
    const amount = parseFloat(tx.amountIn) || 0;
    const riskRatio = amount / Math.max(positionSize, 1);

    if (riskRatio > 0.5) return 'extreme';
    if (riskRatio > 0.2) return 'high';
    if (riskRatio > 0.1) return 'moderate';
    return 'conservative';
  }

  // Narrative generation methods for fantasy storytelling
  private generateQuestType(tx: any): string {
    const questTypes = [
      'treasure_hunt', 'dragon_slaying', 'artifact_recovery', 'dungeon_raid',
      'merchant_expedition', 'royal_commission', 'ancient_ritual', 'prophecy_fulfillment'
    ];

    // Base on transaction type and amount
    if (tx.type === 'BUY') {
      if (parseFloat(tx.amountIn) > 100) return 'dragon_slaying';
      if (parseFloat(tx.amountIn) < 5) return 'treasure_hunt';
    }

    return questTypes[Math.floor(Math.random() * questTypes.length)];
  }

  private classifyTreasure(tx: any): string {
    const symbol = this.getTokenSymbol(tx.tokenOut);
    const amount = parseFloat(tx.quotedAmountOut) || 0;

    const treasureMap: { [key: string]: string } = {
      'GALA': amount > 1000 ? 'legendary_gala_hoard' : amount > 100 ? 'rare_gala_cache' : 'common_gala_coins',
      'GWETH': 'ethereal_crystals',
      'GWBTC': 'ancient_bitcoin_relics',
      'GUSDC': 'stable_gold_pieces'
    };

    return treasureMap[symbol] || 'mysterious_tokens';
  }

  private determineBattleOutcome(tx: any): string {
    if (tx.success) {
      const profit = tx.profit || 0;
      if (profit > 10) return 'glorious_victory';
      if (profit > 1) return 'successful_conquest';
      if (profit > 0) return 'narrow_victory';
      return 'pyrrhic_victory';
    }
    return 'heroic_defeat';
  }

  private identifyHeroicMoment(tx: any, position: any): string {
    const moments = [
      'perfect_timing', 'against_all_odds', 'strategic_brilliance', 'lucky_discovery',
      'calculated_risk', 'market_mastery', 'divine_intervention', 'legendary_patience'
    ];

    if (tx.actualSlippage && tx.actualSlippage < 10) return 'perfect_timing';
    if ((tx.profit || 0) > 5) return 'strategic_brilliance';
    if (position.unrealizedPnL > 0) return 'market_mastery';

    return moments[Math.floor(Math.random() * moments.length)];
  }

  private assessLegendaryStatus(tx: any, position: any): boolean {
    const profit = tx.profit || 0;
    const positionValue = position.positionSize || 0;

    return profit > 20 || positionValue > 1000 || (tx.profitPercentage || 0) > 50;
  }

  private generateStoryElements(tx: any, position: any, relatedTrades: any[]): any {
    return {
      setting: this.generateSetting(tx),
      characters: this.generateCharacters(tx, position),
      conflict: this.generateConflict(tx, relatedTrades),
      resolution: this.generateResolution(tx),
      moralLesson: this.generateMoralLesson(tx, position)
    };
  }

  private generateSetting(tx: any): string {
    const timeOfDay = this.getTimeOfDay(tx.timestamp);
    const settings = {
      dawn: 'misty_mountain_peaks',
      morning: 'bustling_marketplace',
      afternoon: 'golden_trading_halls',
      evening: 'twilight_exchange',
      night: 'moonlit_treasury'
    };
    return settings[timeOfDay as keyof typeof settings] || 'mysterious_realm';
  }

  private generateCharacters(tx: any, position: any): any {
    const traderRank = this.calculateTraderRank(tx.walletAddress, []);
    const characterMap = {
      legendary: 'ancient_dragon_lord',
      expert: 'master_merchant',
      experienced: 'seasoned_adventurer',
      novice: 'brave_apprentice',
      beginner: 'curious_wanderer'
    };

    return {
      protagonist: characterMap[traderRank as keyof typeof characterMap] || 'mysterious_trader',
      allies: ['wise_oracle', 'loyal_companion', 'market_sage'],
      antagonists: ['market_volatility_demon', 'slippage_trickster', 'gas_fee_goblin']
    };
  }

  private generateConflict(tx: any, relatedTrades: any[]): string {
    if (tx.error) return 'cursed_transaction';
    if ((tx.actualSlippage || 0) > 100) return 'slippage_storm';
    if (relatedTrades.filter(t => t.status === 'failed').length > 2) return 'losing_streak_curse';
    return 'market_uncertainty';
  }

  private generateResolution(tx: any): string {
    if (tx.success && (tx.profit || 0) > 0) return 'treasure_secured';
    if (tx.success) return 'mission_accomplished';
    return 'lesson_learned';
  }

  private generateMoralLesson(tx: any, position: any): string {
    const lessons = [
      'patience_rewards_the_wise',
      'calculated_risks_yield_treasures',
      'market_timing_is_everything',
      'diversification_brings_stability',
      'knowledge_conquers_fear'
    ];
    return lessons[Math.floor(Math.random() * lessons.length)];
  }

  private categorizeError(error: string): string {
    if (error.includes('slippage')) return 'slippage_exceeded';
    if (error.includes('balance')) return 'insufficient_funds';
    if (error.includes('gas')) return 'gas_estimation_failed';
    if (error.includes('network')) return 'network_congestion';
    return 'unknown_error';
  }

  private suggestRecoveryAction(error: string): string {
    if (error.includes('slippage')) return 'increase_slippage_tolerance';
    if (error.includes('balance')) return 'add_more_funds';
    if (error.includes('gas')) return 'retry_with_higher_gas';
    if (error.includes('network')) return 'wait_for_network_stability';
    return 'contact_support';
  }

  private async getAvailableStrategies(): Promise<any[]> {
    const strategies = [
      {
        id: 'fibonacci',
        name: 'DCA Fibonacci',
        description: 'Dollar Cost Averaging with Fibonacci retracement levels for GALA accumulation',
        status: 'active',
        dockerCompose: 'docker-compose.fibonacci.yml',
        configFile: 'src/strategies/fibonacci-strategy.ts',
        supportedPairs: ['GALA/GUSDC', 'GALA/GUSDT', 'GALA/GWETH', 'GALA/GWBTC']
      },
      {
        id: 'enhanced-trend',
        name: 'Enhanced Trend',
        description: 'Trend-following strategy with CoinGecko integration and hybrid price sourcing',
        status: 'available',
        dockerCompose: 'docker-compose.enhanced-trend.yml',
        configFile: 'src/enhanced-trend-strategy.ts',
        supportedPairs: ['GALA/GUSDC', 'GALA/GUSDT']
      },
      {
        id: 'liquidity-spider',
        name: 'Liquidity Spider',
        description: 'Low-volume DEX arbitrage with AI advisor and cross-DEX monitoring',
        status: 'available',
        dockerCompose: 'docker-compose.liquidity-spider.yml',
        configFile: 'src/strategies/liquidity-spider-strategy.ts',
        supportedPairs: ['GALA/GUSDC', 'GALA/GUSDT', 'GALA/GWETH', 'GUSDC/GUSDT', 'GUSDC/GWETH']
      },
      {
        id: 'arbitrage',
        name: 'Enhanced Arbitrage',
        description: 'Smart arbitrage with AI advisor, risk management, and multi-pool monitoring',
        status: 'available',
        dockerCompose: 'docker-compose.arbitrage.yml',
        configFile: 'src/strategies/arbitrage-strategy.ts',
        supportedPairs: ['GALA/GUSDC', 'GALA/GUSDT', 'GUSDC/GUSDT', 'GALA/GWETH', 'GUSDC/GWETH']
      },
      {
        id: 'triangular-arbitrage',
        name: 'Triangular Arbitrage',
        description: 'Three-way arbitrage across multiple token pairs',
        status: 'available',
        dockerCompose: null,
        configFile: 'src/strategies/triangular-arbitrage.ts',
        supportedPairs: ['GALA/GUSDC', 'GALA/GUSDT', 'GUSDC/GUSDT']
      },
      {
        id: 'conservative-fibonacci',
        name: 'Conservative Fibonacci',
        description: 'Conservative arbitrage-based Fibonacci strategy (legacy)',
        status: 'deprecated',
        dockerCompose: null,
        configFile: 'src/strategies/conservative-fibonacci-strategy.ts',
        supportedPairs: ['GUSDC/GUSDT', 'GALA/GUSDT', 'GALA/GWETH']
      },
      {
        id: 'trend',
        name: 'Trend Strategy',
        description: 'Basic trend-following strategy (legacy)',
        status: 'deprecated',
        dockerCompose: null,
        configFile: 'src/trend-strategy.ts',
        supportedPairs: ['GALA/GUSDC']
      }
    ];

    return strategies;
  }

  // Strategy control methods
  private async startStrategy(strategyId: string, walletAddress?: string): Promise<any> {
    const strategies = await this.getAvailableStrategies();
    const strategy = strategies.find(s => s.id === strategyId);

    if (!strategy) {
      throw new Error(`Strategy '${strategyId}' not found`);
    }

    if (!strategy.dockerCompose) {
      throw new Error(`Strategy '${strategyId}' is not deployable via Docker`);
    }

    // Prepare env vars
    const env = { ...process.env };
    if (walletAddress) {
      env.GALACHAIN_WALLET_ADDRESS = walletAddress;
    }

    return new Promise((resolve, reject) => {
      console.log(`🚀 Starting strategy: ${strategy.name}`);

            const dockerProcess = spawn('docker', ['compose', '-f', strategy.dockerCompose, 'up', '-d', '--build'], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });

      let output = '';
      let errorOutput = '';

      dockerProcess.stdout.on('data', (data: any) => {
        output += data.toString();
      });

      dockerProcess.stderr.on('data', (data: any) => {
        errorOutput += data.toString();
      });

      dockerProcess.on('close', (code: any) => {
        if (code === 0) {
          console.log(`✅ Strategy ${strategy.name} started successfully`);
          resolve({
            success: true,
            strategy: strategyId,
            action: 'started',
            message: `Strategy ${strategy.name} started successfully`,
            output: output
          });
        } else {
          console.error(`❌ Failed to start strategy ${strategy.name}: ${errorOutput}`);
          reject(new Error(`Failed to start strategy: ${errorOutput || `exit code ${code}`}`));
        }
      });

      dockerProcess.on('error', (error: any) => {
        console.error(`❌ Error starting strategy ${strategy.name}:`, error);
        reject(error);
      });
    });
  }

  private async stopStrategy(strategyId: string): Promise<any> {
    const strategies = await this.getAvailableStrategies();
    const strategy = strategies.find(s => s.id === strategyId);

    if (!strategy) {
      throw new Error(`Strategy '${strategyId}' not found`);
    }

    if (!strategy.dockerCompose) {
      throw new Error(`Strategy '${strategyId}' is not deployable via Docker`);
    }

    return new Promise((resolve, reject) => {
      console.log(`🛑 Stopping strategy: ${strategy.name}`);

            const dockerProcess = spawn('docker', ['compose', '-f', strategy.dockerCompose, 'down'], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      dockerProcess.stdout.on('data', (data: any) => {
        output += data.toString();
      });

      dockerProcess.stderr.on('data', (data: any) => {
        errorOutput += data.toString();
      });

      dockerProcess.on('close', (code: any) => {
        if (code === 0) {
          console.log(`✅ Strategy ${strategy.name} stopped successfully`);
          resolve({
            success: true,
            strategy: strategyId,
            action: 'stopped',
            message: `Strategy ${strategy.name} stopped successfully`,
            output: output
          });
        } else {
          console.error(`❌ Failed to stop strategy ${strategy.name}: ${errorOutput}`);
          reject(new Error(`Failed to stop strategy: ${errorOutput || `exit code ${code}`}`));
        }
      });

      dockerProcess.on('error', (error: any) => {
        console.error(`❌ Error stopping strategy ${strategy.name}:`, error);
        reject(error);
      });
    });
  }

  private async switchStrategy(fromStrategy: string, toStrategy: string): Promise<any> {
    console.log(`🔄 Switching from ${fromStrategy} to ${toStrategy}`);

    try {
      // Stop the current strategy if provided
      if (fromStrategy && fromStrategy !== 'none') {
        await this.stopStrategy(fromStrategy);
        // Wait 3 seconds for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Start the new strategy
      const result = await this.startStrategy(toStrategy);

      return {
        success: true,
        action: 'switched',
        fromStrategy,
        toStrategy,
        message: `Successfully switched from ${fromStrategy} to ${toStrategy}`,
        details: result
      };
    } catch (error: any) {
      throw new Error(`Failed to switch strategies: ${error.message}`);
    }
  }

    private broadcastStrategyChange(action: string, strategyId: string, fromStrategy?: string) {
    const message = JSON.stringify({
      type: 'strategy_change',
      data: {
        action,
        strategy: strategyId,
        fromStrategy,
        timestamp: new Date().toISOString()
      }
    });

    this.wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  private async toggleAdvisor(enabled: boolean): Promise<any> {
    try {
      // Get running containers
      const containers = await this.getRunningContainers();
      const results: any[] = [];

      for (const container of containers) {
        if (container.includes('fafnir-bot')) {
          // Update environment variable in running container
          const envVar = this.getAdvisorEnvVar(container);
          if (envVar) {
            const result = await this.updateContainerEnv(container, envVar, enabled.toString());
            results.push({
              container,
              success: result.success,
              message: result.message
            });
          }
        }
      }

      return {
        success: true,
        action: 'advisor_toggle',
        enabled,
        affectedContainers: results.length,
        details: results,
        message: `AI Advisor ${enabled ? 'enabled' : 'disabled'} for ${results.length} containers`
      };
    } catch (error: any) {
      throw new Error(`Failed to toggle advisor: ${error.message}`);
    }
  }

  private async getAdvisorStatus(): Promise<any> {
    try {
      const containers = await this.getRunningContainers();
      const statuses: any[] = [];

      for (const container of containers) {
        if (container.includes('fafnir-bot')) {
          const envVar = this.getAdvisorEnvVar(container);
          if (envVar) {
            const status = await this.getContainerEnvVar(container, envVar);
            statuses.push({
              container,
              strategy: this.getStrategyFromContainer(container),
              advisorEnabled: status === 'true',
              envVar
            });
          }
        }
      }

      return {
        globalAdvisorAvailable: !!process.env.GEMINI_API_KEY,
        containers: statuses,
        geminiConfigured: !!process.env.GEMINI_API_KEY
      };
    } catch (error: any) {
      throw new Error(`Failed to get advisor status: ${error.message}`);
    }
  }

  private getAdvisorEnvVar(containerName: string): string | null {
    if (containerName.includes('arbitrage')) return 'ARB_USE_ADVISOR';
    if (containerName.includes('fibonacci')) return 'FIB_USE_ADVISOR';
    if (containerName.includes('spider')) return 'SPIDER_USE_ADVISOR';
    if (containerName.includes('trend')) return 'TREND_USE_ADVISOR';
    return null;
  }

  private getStrategyFromContainer(containerName: string): string {
    if (containerName.includes('fibonacci')) return 'DCA Fibonacci';
    if (containerName.includes('arbitrage')) return 'Enhanced Arbitrage';
    if (containerName.includes('spider')) return 'Liquidity Spider';
    if (containerName.includes('trend')) return 'Enhanced Trend';
    return 'Unknown';
  }

  private async getRunningContainers(): Promise<string[]> {
    return new Promise((resolve) => {
      const process = spawn('docker', ['ps', '--format', '{{.Names}}']);
      let output = '';

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.on('close', () => {
        const containers = output.split('\n').filter(name => name.trim());
        resolve(containers);
      });

      process.on('error', () => {
        resolve([]);
      });
    });
  }

  private async updateContainerEnv(containerName: string, envVar: string, value: string): Promise<any> {
    // Note: Docker doesn't support changing environment variables in running containers
    // This is a placeholder for restarting containers with new env vars
    return {
      success: false,
      message: 'Container restart required to change advisor setting'
    };
  }

  private async getContainerEnvVar(containerName: string, envVar: string): Promise<string> {
    return new Promise((resolve) => {
      const process = spawn('docker', ['exec', containerName, 'printenv', envVar]);
      let output = '';

      process.stdout.on('data', (data) => {
        output += data.toString().trim();
      });

      process.on('close', () => {
        resolve(output || 'false');
      });

      process.on('error', () => {
        resolve('false');
      });
    });
  }

    private broadcastAdvisorChange(enabled: boolean) {
    const message = JSON.stringify({
      type: 'advisor_change',
      data: {
        enabled,
        timestamp: new Date().toISOString()
      }
    });

    this.wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  private broadcastConfigChange(action: string, data: any) {
    const message = JSON.stringify({
      type: 'config_change',
      data: {
        action,
        changes: data,
        timestamp: new Date().toISOString()
      }
    });

    this.wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  private async applyConfigToContainers(envVars: Record<string, string>): Promise<any> {
    try {
      const containers = await this.getRunningContainers();
      const fafnirContainers = containers.filter(name => name.includes('fafnir-bot'));

      const results: any[] = [];

      for (const container of fafnirContainers) {
        // Note: Docker doesn't support live env var updates
        // This would typically require container restart with new env vars
        results.push({
          container,
          status: 'restart_required',
          message: 'Container restart required to apply new configuration',
          affectedVars: Object.keys(envVars).filter(key =>
            key.includes(this.getStrategyFromContainer(container).toLowerCase().replace(' ', '_'))
          )
        });
      }

      return {
        success: true,
        action: 'config_apply',
        affectedContainers: results.length,
        details: results,
        message: 'Configuration prepared for application. Container restart required.',
        envVars: Object.keys(envVars).length
      };
    } catch (error: any) {
      throw new Error(`Failed to apply configuration: ${error.message}`);
    }
  }

  // Utility methods
  private parseUptime(status: string): number {
    const uptimeMatch = status.match(/Up (\d+) (seconds?|minutes?|hours?|days?)/);
    if (!uptimeMatch) return 0;

    const value = parseInt(uptimeMatch[1]);
    const unit = uptimeMatch[2];

    const multipliers: Record<string, number> = {
      'second': 1000,
      'seconds': 1000,
      'minute': 60000,
      'minutes': 60000,
      'hour': 3600000,
      'hours': 3600000,
      'day': 86400000,
      'days': 86400000
    };

    return value * (multipliers[unit] || 1000);
  }

  private sendResponse<T>(res: express.Response, data: T) {
    const response: ApiResponse<T> = {
      success: true,
      data,
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
    res.json(response);
  }

  private sendError(res: express.Response, error: string, statusCode: number = 400) {
    const response: ApiResponse<null> = {
      success: false,
      error,
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
    res.status(statusCode).json(response);
  }

  private async sendInitialData(ws: WebSocket) {
    try {
      const dashboard = await this.getDashboardData();
      ws.send(JSON.stringify({
        type: 'initial',
        data: dashboard
      }));
    } catch (error) {
      console.error('Error sending initial data:', error);
    }
  }

  private async handleWebSocketMessage(ws: WebSocket, data: any) {
    // Handle incoming WebSocket messages
    try {
      switch (data.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          break;

        case 'subscribe':
          // Handle subscription requests
          ws.send(JSON.stringify({
            type: 'subscribed',
            message: 'Subscribed to real-time updates',
            timestamp: new Date().toISOString()
          }));
          break;

        case 'subscribe_trade_approvals':
          await this.handleSubscribeTradeApprovals(ws, data);
          break;

        case 'trade_approval':
          await this.handleTradeApprovalWebSocket(ws, data);
          break;

        case 'start_strategy':
          try {
            const result = await this.startStrategy(data.strategyId);
            ws.send(JSON.stringify({
              type: 'strategy_result',
              data: result,
              timestamp: new Date().toISOString()
            }));
            this.broadcastStrategyChange('started', data.strategyId);
          } catch (error: any) {
            ws.send(JSON.stringify({
              type: 'error',
              message: error.message,
              timestamp: new Date().toISOString()
            }));
          }
          break;

        case 'stop_strategy':
          try {
            const result = await this.stopStrategy(data.strategyId);
            ws.send(JSON.stringify({
              type: 'strategy_result',
              data: result,
              timestamp: new Date().toISOString()
            }));
            this.broadcastStrategyChange('stopped', data.strategyId);
          } catch (error: any) {
            ws.send(JSON.stringify({
              type: 'error',
              message: error.message,
              timestamp: new Date().toISOString()
            }));
          }
          break;

                case 'switch_strategy':
          try {
            const result = await this.switchStrategy(data.fromStrategy, data.toStrategy);
            ws.send(JSON.stringify({
              type: 'strategy_result',
              data: result,
              timestamp: new Date().toISOString()
            }));
            this.broadcastStrategyChange('switched', data.toStrategy, data.fromStrategy);
          } catch (error: any) {
            ws.send(JSON.stringify({
              type: 'error',
              message: error.message,
              timestamp: new Date().toISOString()
            }));
          }
          break;

        case 'update_config':
          try {
            const validation = configManager.validateConfig(data.config);
            if (!validation.valid) {
              ws.send(JSON.stringify({
                type: 'error',
                message: `Configuration validation failed: ${validation.errors.join(', ')}`,
                timestamp: new Date().toISOString()
              }));
              break;
            }

            const updatedConfig = configManager.updateConfig(data.config);
            ws.send(JSON.stringify({
              type: 'config_result',
              data: updatedConfig,
              timestamp: new Date().toISOString()
            }));
            this.broadcastConfigChange('updated', data.config);
          } catch (error: any) {
            ws.send(JSON.stringify({
              type: 'error',
              message: error.message,
              timestamp: new Date().toISOString()
            }));
          }
          break;

        case 'get_config':
          try {
            const config = data.strategy ?
              configManager.getStrategyConfig(data.strategy) :
              configManager.getConfig();
            ws.send(JSON.stringify({
              type: 'config_data',
              data: config,
              strategy: data.strategy,
              timestamp: new Date().toISOString()
            }));
          } catch (error: any) {
            ws.send(JSON.stringify({
              type: 'error',
              message: error.message,
              timestamp: new Date().toISOString()
            }));
          }
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: `Unknown message type: ${data.type}`,
            timestamp: new Date().toISOString()
          }));
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Internal server error',
        timestamp: new Date().toISOString()
      }));
    }
  }

  private async broadcastUpdates() {
    try {
      const dashboard = await this.getDashboardData();
      const message = JSON.stringify({
        type: 'update',
        data: dashboard,
        timestamp: new Date().toISOString()
      });

      this.wss.clients.forEach((client: WebSocket) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    } catch (error) {
      console.error('Error broadcasting updates:', error);
    }
  }

  private async getDashboardData() {
    const [bots, performance, positions, pools] = await Promise.all([
      this.getBotStatus(),
      this.getPerformanceMetrics(),
      this.getPositions(),
      this.getPoolData()
    ]);

    return {
      bots,
      performance,
      positions,
      pools,
      lastUpdate: new Date().toISOString()
    };
  }

  public start() {
    this.server.listen(this.port, () => {
      console.log(`🚀 Fafnir Bot API Server running on http://localhost:${this.port}`);
      console.log(`📊 API Endpoints available:`);
      console.log(`   GET  /api/dashboard - Complete dashboard data`);
      console.log(`   GET  /api/bots/status - Bot status information`);
      console.log(`   GET  /api/performance - Performance metrics`);
      console.log(`   GET  /api/trades - Recent trades`);
      console.log(`   GET  /api/transactions/detailed - Enhanced transaction data for content generation`);
      console.log(`   GET  /api/transactions/:id - Single transaction with full narrative context`);
      console.log(`   GET  /api/stories/wallet/:address - Get wallet-specific stories`);
      console.log(`   POST /api/stories/wallet/:address/preferences - Update story preferences`);
      console.log(`   POST /api/stories/wallet/:address/generate - Force generate story`);
      console.log(`   GET  /api/stories/claude/config - Get Claude configuration`);
      console.log(`   PUT  /api/stories/claude/config - Update Claude configuration`);
      console.log(`   PUT  /api/stories/claude/system-prompt - Update system prompt`);
      console.log(`   PUT  /api/stories/claude/user-prompt - Update user prompt template`);
      console.log(`   GET  /api/oracle/status - Global Oracle transmission system status`);
      console.log(`   GET  /api/oracle/terminal - Global Oracle CRT terminal display`);
      console.log(`   GET  /api/oracle/wallet/:address/status - Wallet-specific Oracle status`);
      console.log(`   GET  /api/oracle/wallet/:address/terminal - Wallet-specific Oracle terminal`);
      console.log(`   PUT  /api/oracle/wallet/:address/preferences - Update wallet Oracle preferences`);
      console.log(`   GET  /api/oracle/wallets/all - All connected wallet Oracle states`);
      console.log(`   GET  /api/positions - Current positions`);
      console.log(`   GET  /api/logs - Recent log entries`);
      console.log(`   GET  /api/pools - Pool data`);
      console.log(`   GET  /api/strategies - Available trading strategies`);
      console.log(`   POST /api/strategies/:id/start - Start a strategy`);
      console.log(`   POST /api/strategies/:id/stop - Stop a strategy`);
      console.log(`   POST /api/strategies/switch - Switch between strategies`);
      console.log(`   GET  /api/advisor/status - AI advisor status`);
      console.log(`   POST /api/advisor/toggle - Toggle AI advisor`);
      console.log(`   GET  /api/config - Get full trading configuration`);
      console.log(`   GET  /api/config/summary - Get configuration summary`);
      console.log(`   GET  /api/config/:strategy - Get strategy configuration`);
      console.log(`   PUT  /api/config - Update trading configuration`);
      console.log(`   PUT  /api/config/:strategy - Update strategy configuration`);
      console.log(`   POST /api/config/reset - Reset to default configuration`);
      console.log(`   POST /api/config/apply - Apply configuration to containers`);
      console.log(`🔐 Authentication Endpoints:`);
      console.log(`   POST /api/auth/wallet - Authenticate with GalaChain wallet`);
      console.log(`   POST /api/auth/cross-chain - Authenticate with MetaMask (cross-chain)`);
      console.log(`   POST /api/auth/logout - Revoke session API key`);
      console.log(`🔗 Cross-Chain Endpoints:`);
      console.log(`   POST /api/wallet/map-address - Create Ethereum to GalaChain mapping`);
      console.log(`   GET  /api/wallet/mapping/:address - Get address mapping`);
      console.log(`   POST /api/wallet/verify-signature - Verify cross-chain signatures`);
      console.log(`   WebSocket: Real-time updates + strategy/config control at ws://localhost:${this.port}`);
      console.log(`🌐 CORS enabled for yuphix.io`);
    });
  }

  public stop() {
    this.storyGenerator.stop();
    this.wss.close();
    this.server.close(() => {
      console.log('✅ API server stopped');
    });
  }

  // Trade approval WebSocket handlers
  private async handleSubscribeTradeApprovals(ws: WebSocket, data: any): Promise<void> {
    const walletAddress = (ws as any).walletAddress;

    if (!walletAddress) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Wallet address required for approval subscription',
        timestamp: new Date().toISOString()
      }));
      return;
    }

    // Store this connection for trade approval notifications
    if (!this.approvalSubscriptions) {
      this.approvalSubscriptions = new Map();
    }

    this.approvalSubscriptions.set(walletAddress, ws);

    ws.send(JSON.stringify({
      type: 'trade_approvals_subscribed',
      message: 'Subscribed to trade approval requests',
      walletAddress,
      timestamp: new Date().toISOString()
    }));

    console.log(`📝 WebSocket subscribed to trade approvals for ${walletAddress}`);
  }

  private async handleTradeApprovalWebSocket(ws: WebSocket, data: any): Promise<void> {
    try {
      const { tradeId, approved, signature } = data;

      if (!tradeId || approved === undefined) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid trade approval data',
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // Process the trade approval through multi-wallet manager
      await this.multiWalletManager.processTradeApproval(tradeId, approved, signature);

      // Confirm approval processed
      ws.send(JSON.stringify({
        type: 'approval_processed',
        tradeId,
        approved,
        timestamp: new Date().toISOString()
      }));

      console.log(`✅ Trade approval processed via WebSocket: ${tradeId} - ${approved ? 'APPROVED' : 'REJECTED'}`);

    } catch (error: any) {
      console.error('❌ Trade approval error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  }

  // Broadcast trade approval request to user's WebSocket
  public broadcastTradeApprovalRequest(walletAddress: string, tradeRequest: any): void {
    if (!this.approvalSubscriptions) return;

    const ws = this.approvalSubscriptions.get(walletAddress);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'trade_approval_request',
        trade: tradeRequest,
        timestamp: new Date().toISOString()
      }));

      console.log(`📨 Trade approval request sent to ${walletAddress}`);
    } else {
      console.log(`⚠️  No active WebSocket connection for ${walletAddress}`);
    }
  }

  // Broadcast strategy updates to all connected clients
  private broadcastStrategyUpdate(update: any): void {
    const message = {
      type: 'strategy_update',
      ...update,
      timestamp: new Date().toISOString()
    };

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  private broadcastOracleUpdate(update: any): void {
    const message = {
      ...update,
      timestamp: new Date().toISOString()
    };
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  // Storage for approval subscriptions
  private approvalSubscriptions?: Map<string, WebSocket>;

  // GalaChain address verification method
  private async verifyGalaChainAddress(galaChainAddress: string): Promise<{exists: boolean, hasFunds: boolean, balances?: any}> {
    try {
      // TODO: Implement with actual GalaChain SDK when dependencies are resolved
      // For now, simulate verification based on address format

      // GalaChain addresses have multiple formats:
      // - gala[hex] format (deterministic/generated by our API)
      // - client|[hex] format (server/backend client addresses)
      // - eth|[hex] format (browser wallet extension addresses)
      // - other formats may exist
      const isValidFormat = (
        (galaChainAddress.startsWith('gala') && galaChainAddress.length >= 20) ||
        (galaChainAddress.startsWith('client|') && galaChainAddress.length >= 30) ||
        (galaChainAddress.startsWith('eth|') && galaChainAddress.length >= 40) ||
        (galaChainAddress.includes('|') && galaChainAddress.length >= 20) // General format with pipe
      );

      if (!isValidFormat) {
        return { exists: false, hasFunds: false };
      }

            // Simulate balance check - in reality this would use:
      // const client = new ChainClient(galaChainConfig);
      // const balances = await client.getBalance(galaChainAddress);

      // For user's actual addresses, simulate having funds
      const isUserAddress = galaChainAddress === 'eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9' ||
                            galaChainAddress.includes('603da345646dc21ea19f5b15');

      const mockBalances = isUserAddress ? {
        GALA: 150.75,  // User has some GALA
        GUSDC: 75.50,  // User has some GUSDC
        GWETH: 0.05,   // Small amount of GWETH
      } : {
        GALA: Math.random() > 0.7 ? Math.random() * 1000 : 0, // 30% chance for others
        GUSDC: Math.random() > 0.8 ? Math.random() * 500 : 0, // 20% chance for others
      };

      const hasFunds = Object.values(mockBalances).some(balance => balance > 0);

      console.log(`🔍 GalaChain verification: ${galaChainAddress} - exists: ${isValidFormat}, hasFunds: ${hasFunds}`);

      return {
        exists: isValidFormat,
        hasFunds,
        balances: mockBalances
      };
    } catch (error: any) {
      console.error('❌ GalaChain address verification failed:', error);
      return { exists: false, hasFunds: false };
    }
  }

  // Cross-chain helper methods
  private async getOrCreateGalaChainMapping(ethereumAddress: string): Promise<string> {
    const normalizedEthAddress = ethereumAddress.toLowerCase();

    // Check if mapping already exists
    const existingMapping = this.addressMappings.get(normalizedEthAddress);
    if (existingMapping) {
      console.log('📋 Using existing mapping:', normalizedEthAddress, '→', existingMapping);
      return existingMapping;
    }

    // Create new deterministic mapping
    const galaChainAddress = this.deriveGalaChainAddress(normalizedEthAddress);

    // Store mapping
    this.addressMappings.set(normalizedEthAddress, galaChainAddress);

    // Log mapping creation
    await this.logAddressMapping(normalizedEthAddress, galaChainAddress);

    console.log('🆕 Created new mapping:', normalizedEthAddress, '→', galaChainAddress);
    return galaChainAddress;
  }

    private deriveGalaChainAddress(ethereumAddress: string): string {
    // GalaChain uses eth| prefix instead of 0x for Ethereum-derived addresses
    // This is the actual format used by GalaChain/GalaSwap

    const normalizedEthAddress = ethereumAddress.toLowerCase();

    // Remove 0x prefix and replace with eth|
    const addressWithoutPrefix = normalizedEthAddress.startsWith('0x')
      ? normalizedEthAddress.slice(2)
      : normalizedEthAddress;

    const galaChainAddress = `eth|${addressWithoutPrefix}`;

    console.log(`🔄 GalaChain derivation: ${ethereumAddress} → ${galaChainAddress}`);
    return galaChainAddress;
  }

  private async verifyEthereumSignature(address: string, signature: string, message: string): Promise<boolean> {
    try {
      // Recover address from signature
      const recoveredAddress = ethers.utils.verifyMessage(message, signature);

      // Compare addresses (case insensitive)
      const isValid = recoveredAddress.toLowerCase() === address.toLowerCase();

      console.log('🔍 Signature verification:', {
        expected: address.toLowerCase(),
        recovered: recoveredAddress.toLowerCase(),
        valid: isValid
      });

      return isValid;
    } catch (error: any) {
      console.error('❌ Ethereum signature verification failed:', error);
      return false;
    }
  }

  private async logAddressMapping(ethereumAddress: string, galaChainAddress: string): Promise<void> {
    try {
      const logEntry = {
        eventType: 'ADDRESS_MAPPING_CREATED',
        ethereumAddress,
        galaChainAddress,
        derivationMethod: 'deterministic',
        timestamp: new Date().toISOString()
      };

      const logDir = path.join(process.cwd(), 'logs');
      fs.ensureDirSync(logDir);

      const logFile = path.join(logDir, 'address-mappings.log');
      await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
    } catch (error: any) {
      console.error('❌ Failed to log address mapping:', error);
    }
  }

  private loadAddressMappings(): void {
    try {
      const logFile = path.join(process.cwd(), 'logs', 'address-mappings.log');

      if (fs.existsSync(logFile)) {
        const logContent = fs.readFileSync(logFile, 'utf8');
        const lines = logContent.trim().split('\n').filter(line => line);

        lines.forEach(line => {
          try {
            const entry = JSON.parse(line);
            if (entry.ethereumAddress && entry.galaChainAddress) {
              this.addressMappings.set(entry.ethereumAddress, entry.galaChainAddress);
            }
          } catch (parseError) {
            console.warn('⚠️ Failed to parse address mapping log line:', line);
          }
        });

        console.log(`📥 Loaded ${this.addressMappings.size} address mappings from log`);
      }
    } catch (error: any) {
      console.error('❌ Failed to load address mappings:', error);
    }
  }
}

// Start the API server if run directly
const isMain = process.argv[1]?.endsWith('api-server.ts') || process.argv[1]?.endsWith('api-server.js');
if (isMain) {
  const api = new FafnirBotAPI(3000);
  api.start();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down API server...');
    api.stop();
    process.exit(0);
  });
}

export { FafnirBotAPI };
