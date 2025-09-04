import { unifiedWallet, WalletType, WalletConnection } from './unified-wallet-service.js';

/**
 * Dual Wallet Component for Fafnir Bot
 * Provides unified interface for both MetaMask and GalaChain wallet integration
 */

export interface DualWalletConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  supportedNetworks?: number[];
  requiredNFTContract?: string;
}

export interface TradingPermission {
  tokenPair: string;
  maxTradeAmount: number;
  dailyLimit: number;
  strategies: string[];
  expiryDate: Date;
}

export interface AuthenticationResult {
  success: boolean;
  sessionApiKey?: string;
  walletType: WalletType;
  ethereumAddress?: string;
  galaChainAddress: string;
  error?: string;
}

export class DualWalletComponent {
  private config: DualWalletConfig;
  private currentConnection: WalletConnection | null = null;
  private websocket: WebSocket | null = null;
  private eventListeners: Map<string, Function[]> = new Map();

  constructor(config: DualWalletConfig) {
    this.config = config;
    this.setupEventListeners();
    console.log('🚀 Dual Wallet Component initialized');
  }

  /**
   * Get available wallet types in the current environment
   */
  getAvailableWallets(): WalletType[] {
    return unifiedWallet.getAvailableWallets();
  }

  /**
   * Connect to a specific wallet type
   */
  async connectWallet(walletType: WalletType): Promise<WalletConnection> {
    try {
      this.emit('connectionStarted', { walletType });

      let connection: WalletConnection;

      switch (walletType) {
        case WalletType.GALACHAIN:
          connection = await unifiedWallet.connectGalaChain();
          break;

        case WalletType.METAMASK:
          connection = await unifiedWallet.connectMetaMask();
          break;

        default:
          throw new Error(`Unsupported wallet type: ${walletType}`);
      }

      this.currentConnection = connection;
      this.emit('walletConnected', connection);

      console.log('✅ Wallet connected:', connection);
      return connection;
    } catch (error: any) {
      this.emit('connectionError', { walletType, error: error.message });
      throw error;
    }
  }

  /**
   * Authenticate with the Fafnir API using the connected wallet
   */
  async authenticate(nftVerified: boolean = true): Promise<AuthenticationResult> {
    if (!this.currentConnection) {
      throw new Error('No wallet connected');
    }

    try {
      this.emit('authenticationStarted', { walletType: this.currentConnection.type });

      const message = `Authenticate with Fafnir Bot at ${new Date().toISOString()}`;
      const signature = await unifiedWallet.signMessage(message);

      let authResult: AuthenticationResult;

      if (this.currentConnection.type === WalletType.METAMASK) {
        // Cross-chain authentication for MetaMask
        authResult = await this.authenticateMetaMask(message, signature, nftVerified);
      } else {
        // Direct GalaChain authentication
        authResult = await this.authenticateGalaChain(message, signature, nftVerified);
      }

      if (authResult.success) {
        this.emit('authenticationSuccess', authResult);
      } else {
        this.emit('authenticationError', authResult);
      }

      return authResult;
    } catch (error: any) {
      const errorResult: AuthenticationResult = {
        success: false,
        walletType: this.currentConnection.type,
        galaChainAddress: this.currentConnection.galaChainAddress,
        error: error.message
      };

      this.emit('authenticationError', errorResult);
      return errorResult;
    }
  }

  /**
   * Authenticate MetaMask wallet with cross-chain support
   */
  private async authenticateMetaMask(
    message: string,
    signature: string,
    nftVerified: boolean
  ): Promise<AuthenticationResult> {
    const response = await fetch(`${this.config.apiBaseUrl}/api/auth/cross-chain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ethereumAddress: this.currentConnection!.address,
        ethereumSignature: signature,
        galaChainAddress: this.currentConnection!.galaChainAddress,
        message,
        walletType: 'metamask',
        nftVerified
      })
    });

    const data = await response.json();

    if (data.success) {
      return {
        success: true,
        sessionApiKey: data.sessionApiKey,
        walletType: WalletType.METAMASK,
        ethereumAddress: data.ethereumAddress,
        galaChainAddress: data.galaChainAddress
      };
    } else {
      throw new Error(data.error || 'MetaMask authentication failed');
    }
  }

  /**
   * Authenticate GalaChain wallet directly
   */
  private async authenticateGalaChain(
    message: string,
    signature: string,
    nftVerified: boolean
  ): Promise<AuthenticationResult> {
    const response = await fetch(`${this.config.apiBaseUrl}/api/auth/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: this.currentConnection!.galaChainAddress,
        signature,
        message,
        nftVerified
      })
    });

    const data = await response.json();

    if (data.success) {
      return {
        success: true,
        sessionApiKey: data.sessionApiKey,
        walletType: WalletType.GALACHAIN,
        galaChainAddress: data.walletAddress
      };
    } else {
      throw new Error(data.error || 'GalaChain authentication failed');
    }
  }

  /**
   * Grant trading permissions for the connected wallet
   */
  async grantTradingPermissions(permissions: Omit<TradingPermission, 'signature'>[]): Promise<void> {
    if (!this.currentConnection) {
      throw new Error('No wallet connected');
    }

    try {
      this.emit('permissionGrantStarted', { permissions });

      // Sign each permission with the wallet
      const signedPermissions = await Promise.all(
        permissions.map(async (permission) => {
          const signature = await unifiedWallet.signMessage(permission);
          return { ...permission, signature };
        })
      );

      // Send to API
      const response = await fetch(`${this.config.apiBaseUrl}/api/wallet/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: this.currentConnection.galaChainAddress,
          permissions: signedPermissions
        })
      });

      const data = await response.json();

      if (data.success) {
        this.emit('permissionsGranted', { permissions: data.permissions });
        console.log('✅ Trading permissions granted:', data.permissions.length);
      } else {
        throw new Error(data.error || 'Failed to grant permissions');
      }
    } catch (error: any) {
      this.emit('permissionError', { error: error.message });
      throw error;
    }
  }

  /**
   * Set up WebSocket connection for real-time updates
   */
  async connectWebSocket(sessionApiKey: string): Promise<void> {
    try {
      const wsUrl = `${this.config.wsBaseUrl}?api_key=${sessionApiKey}`;
      console.log('📡 Connecting to WebSocket:', wsUrl);

      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('✅ WebSocket connected');
        this.emit('websocketConnected');

        // Subscribe to trade approvals
        this.websocket!.send(JSON.stringify({
          type: 'subscribe_trade_approvals'
        }));
      };

      this.websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWebSocketMessage(data);
        } catch (error) {
          console.error('❌ Failed to parse WebSocket message:', error);
        }
      };

      this.websocket.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        this.emit('websocketError', { error });
      };

      this.websocket.onclose = (event) => {
        console.log('📡 WebSocket disconnected:', event.code);
        this.emit('websocketDisconnected', { code: event.code });

        // Auto-reconnect if not normal closure
        if (event.code !== 1000 && sessionApiKey) {
          setTimeout(() => {
            this.connectWebSocket(sessionApiKey);
          }, 5000);
        }
      };
    } catch (error: any) {
      console.error('❌ WebSocket connection failed:', error);
      this.emit('websocketError', { error: error.message });
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(data: any): void {
    console.log('📨 WebSocket message:', data.type);

    switch (data.type) {
      case 'trade_approval_request':
        this.emit('tradeApprovalRequest', data.trade);
        break;

      case 'approval_processed':
        this.emit('tradeApprovalProcessed', data);
        break;

      case 'user_stats':
        this.emit('userStatsUpdate', data);
        break;

      case 'error':
        this.emit('websocketError', { error: data.message });
        break;

      default:
        this.emit('websocketMessage', data);
    }
  }

  /**
   * Approve a trade via WebSocket
   */
  async approveTrade(tradeId: string): Promise<void> {
    if (!this.websocket || !this.currentConnection) {
      throw new Error('WebSocket not connected or wallet not connected');
    }

    try {
      // Sign approval
      const approval = {
        tradeId,
        approved: true,
        timestamp: Date.now()
      };

      const signature = await unifiedWallet.signMessage(approval);

      // Send via WebSocket
      this.websocket.send(JSON.stringify({
        type: 'trade_approval',
        tradeId,
        approved: true,
        signature
      }));

      this.emit('tradeApproved', { tradeId });
      console.log('✅ Trade approved:', tradeId);
    } catch (error: any) {
      this.emit('tradeApprovalError', { tradeId, error: error.message });
      throw error;
    }
  }

  /**
   * Reject a trade via WebSocket
   */
  async rejectTrade(tradeId: string): Promise<void> {
    if (!this.websocket) {
      throw new Error('WebSocket not connected');
    }

    try {
      this.websocket.send(JSON.stringify({
        type: 'trade_approval',
        tradeId,
        approved: false
      }));

      this.emit('tradeRejected', { tradeId });
      console.log('❌ Trade rejected:', tradeId);
    } catch (error: any) {
      this.emit('tradeRejectionError', { tradeId, error: error.message });
      throw error;
    }
  }

  /**
   * Get wallet balances
   */
  async getWalletBalances(): Promise<any> {
    if (!this.currentConnection) {
      throw new Error('No wallet connected');
    }

    try {
      const response = await fetch(
        `${this.config.apiBaseUrl}/api/wallet/${this.currentConnection.galaChainAddress}/balances`
      );

      const data = await response.json();

      if (data.success) {
        return data.balances;
      } else {
        throw new Error(data.error || 'Failed to get balances');
      }
    } catch (error: any) {
      console.error('❌ Failed to get wallet balances:', error);
      throw error;
    }
  }

  /**
   * Get current connection info
   */
  getCurrentConnection(): WalletConnection | null {
    return this.currentConnection;
  }

  /**
   * Get wallet type
   */
  getWalletType(): WalletType | null {
    return this.currentConnection?.type || null;
  }

  /**
   * Get addresses
   */
  getAddresses(): { ethereum?: string; galachain: string } | null {
    if (!this.currentConnection) return null;

    return {
      ethereum: this.currentConnection.type === WalletType.METAMASK
        ? this.currentConnection.address
        : undefined,
      galachain: this.currentConnection.galaChainAddress
    };
  }

  /**
   * Disconnect wallet and cleanup
   */
  disconnect(): void {
    if (this.websocket) {
      this.websocket.close(1000);
      this.websocket = null;
    }

    unifiedWallet.disconnect();
    this.currentConnection = null;

    this.emit('disconnected');
    console.log('🔌 Wallet disconnected');
  }

  /**
   * Event system for component communication
   */
  on(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, data?: any): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`❌ Event listener error for ${event}:`, error);
      }
    });
  }

  /**
   * Setup wallet event listeners (account/network changes)
   */
  private setupEventListeners(): void {
    // MetaMask account changes
    unifiedWallet.setupAccountChangeListener((accounts) => {
      if (accounts.length === 0) {
        this.disconnect();
      } else if (this.currentConnection?.type === WalletType.METAMASK) {
        this.emit('accountChanged', { newAccount: accounts[0] });
      }
    });

    // MetaMask network changes
    unifiedWallet.setupNetworkChangeListener((chainId) => {
      if (this.currentConnection?.type === WalletType.METAMASK) {
        this.emit('networkChanged', { chainId: parseInt(chainId, 16) });
      }
    });
  }

  /**
   * Cleanup method
   */
  destroy(): void {
    this.disconnect();
    unifiedWallet.removeEventListeners();
    this.eventListeners.clear();
    console.log('🗑️ Dual Wallet Component destroyed');
  }
}

export default DualWalletComponent;
