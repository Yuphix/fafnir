import { BrowserConnectClient } from '@gala-chain/connect';
import { ethers } from 'ethers';
import crypto from 'crypto';

/**
 * Unified Wallet Service - Supports both MetaMask and GalaChain wallets
 * Provides seamless integration for dual wallet authentication and trading
 */

export enum WalletType {
  GALACHAIN = 'galachain',
  METAMASK = 'metamask'
}

export interface WalletConnection {
  type: WalletType;
  address: string;
  galaChainAddress: string;
  provider?: any;
  chainId?: number;
}

export interface AddressMapping {
  ethereumAddress: string;
  galaChainAddress: string;
  derivationMethod: 'deterministic' | 'manual';
  createdAt: Date;
  verified: boolean;
}

export class UnifiedWalletService {
  private galaWallet: BrowserConnectClient;
  private currentConnection: WalletConnection | null = null;
  private addressMappings: Map<string, AddressMapping> = new Map();

  constructor() {
    this.galaWallet = new BrowserConnectClient();
    console.log('🔗 Unified Wallet Service initialized');
  }

  /**
   * Check which wallet types are available in the browser
   */
  getAvailableWallets(): WalletType[] {
    const available: WalletType[] = [];

    if (typeof window !== 'undefined') {
      // Check for GalaChain wallet
      if ((window as any).galachain) {
        available.push(WalletType.GALACHAIN);
      }

      // Check for MetaMask (or any Ethereum provider)
      if ((window as any).ethereum) {
        available.push(WalletType.METAMASK);
      }
    }

    console.log('🔍 Available wallets:', available);
    return available;
  }

  /**
   * Connect to GalaChain wallet directly
   */
  async connectGalaChain(): Promise<WalletConnection> {
    try {
      console.log('🌟 Connecting to Gala Wallet...');

      // Check for Gala Wallet availability
      if (!((window as any).gala)) {
        throw new Error('Gala Wallet not found. Please install the Gala Wallet extension.');
      }

      // Request account access using the correct Gala Wallet API
      const galaWallet = await (window as any).gala.request({
        method: "eth_requestAccounts",
      });

      if (!galaWallet || galaWallet.length === 0) {
        throw new Error('No accounts found in Gala Wallet');
      }

      const walletAddress = galaWallet[0];

      const connection: WalletConnection = {
        type: WalletType.GALACHAIN,
        address: walletAddress,
        galaChainAddress: walletAddress // Gala Wallet provides GalaChain addresses directly
      };

      this.currentConnection = connection;
      console.log('✅ Gala Wallet connected:', walletAddress);

      return connection;
    } catch (error: any) {
      console.error('❌ GalaChain connection failed:', error);
      throw new Error(`GalaChain connection failed: ${error.message}`);
    }
  }

  /**
   * Connect to MetaMask and derive GalaChain address
   */
  async connectMetaMask(): Promise<WalletConnection> {
    try {
      console.log('🦊 Connecting to MetaMask...');

      if (!((window as any).ethereum)) {
        throw new Error('MetaMask not found. Please install MetaMask extension.');
      }

      const provider = new ethers.providers.Web3Provider((window as any).ethereum);

      // Request account access
      await provider.send('eth_requestAccounts', []);
      const signer = provider.getSigner();
      const ethereumAddress = await signer.getAddress();

      // Get network info
      const network = await provider.getNetwork();
      console.log('📡 Connected to network:', network.name, network.chainId);

      // Derive GalaChain address from Ethereum address
      const galaChainAddress = await this.deriveGalaChainAddress(ethereumAddress);

      const connection: WalletConnection = {
        type: WalletType.METAMASK,
        address: ethereumAddress,
        galaChainAddress: galaChainAddress,
        provider: provider,
        chainId: network.chainId
      };

      this.currentConnection = connection;

      // Store mapping
      await this.storeAddressMapping(ethereumAddress, galaChainAddress);

      console.log('✅ MetaMask connected:', ethereumAddress);
      console.log('🔗 Mapped to GalaChain address:', galaChainAddress);

      return connection;
    } catch (error: any) {
      console.error('❌ MetaMask connection failed:', error);
      throw new Error(`MetaMask connection failed: ${error.message}`);
    }
  }

  /**
   * Derive GalaChain address from Ethereum address using deterministic method
   */
  private async deriveGalaChainAddress(ethereumAddress: string): Promise<string> {
    try {
      // GalaChain uses eth| prefix instead of 0x for Ethereum-derived addresses
      // This is the actual format used by GalaChain/GalaSwap

      const normalizedEthAddress = ethereumAddress.toLowerCase();

      // Remove 0x prefix and replace with eth|
      const addressWithoutPrefix = normalizedEthAddress.startsWith('0x')
        ? normalizedEthAddress.slice(2)
        : normalizedEthAddress;

      const galaChainAddress = `eth|${addressWithoutPrefix}`;

      console.log('🔄 Address derivation:', {
        ethereum: normalizedEthAddress,
        galachain: galaChainAddress
      });

      return galaChainAddress;
    } catch (error: any) {
      console.error('❌ Address derivation failed:', error);
      throw new Error(`Failed to derive GalaChain address: ${error.message}`);
    }
  }

  /**
   * Create deterministic seed from Ethereum address
   */
  private createDeterministicSeed(ethereumAddress: string): string {
    // Create consistent seed using Ethereum address and a salt
    const salt = 'fafnir_galachain_mapping_v1';
    const combined = ethereumAddress + salt;

    // Generate deterministic hash
    const seed = crypto.createHash('sha256').update(combined).digest('hex');

    return seed;
  }

  /**
   * Generate GalaChain-compatible address from seed
   */
  private generateGalaChainAddress(seed: string, ethereumAddress: string): string {
    // Method 1: Create a GalaChain-style address
    // This creates a consistent format that can be used for GalaChain operations

    // Take first 40 characters of the hash for address-like format
    const addressPart = seed.substring(0, 40);

    // Create GalaChain-style address (this format may need adjustment based on actual GalaChain specs)
    const galaChainAddress = `gala${addressPart}`;

    return galaChainAddress;
  }

  /**
   * Store address mapping for future reference
   */
  private async storeAddressMapping(ethereumAddress: string, galaChainAddress: string): Promise<void> {
    const mapping: AddressMapping = {
      ethereumAddress: ethereumAddress.toLowerCase(),
      galaChainAddress,
      derivationMethod: 'deterministic',
      createdAt: new Date(),
      verified: false
    };

    this.addressMappings.set(ethereumAddress.toLowerCase(), mapping);

    console.log('💾 Address mapping stored:', mapping);
  }

  /**
   * Get stored address mapping
   */
  getAddressMapping(ethereumAddress: string): AddressMapping | null {
    return this.addressMappings.get(ethereumAddress.toLowerCase()) || null;
  }

  /**
   * Sign message with current wallet
   */
  async signMessage(message: string | object): Promise<string> {
    if (!this.currentConnection) {
      throw new Error('No wallet connected');
    }

    const messageToSign = typeof message === 'string' ? message : JSON.stringify(message);

    try {
      switch (this.currentConnection.type) {
        case WalletType.GALACHAIN:
          console.log('📝 Signing with Gala Wallet...');

          if (!this.currentConnection?.address) {
            throw new Error('No Gala Wallet address available');
          }

          // Use Gala Wallet's personal_sign method
          const galaSignResult = await (window as any).gala.request({
            method: "personal_sign",
            params: [messageToSign, this.currentConnection.address],
          });

          return galaSignResult;

        case WalletType.METAMASK:
          console.log('📝 Signing with MetaMask...');
          if (!this.currentConnection.provider) {
            throw new Error('MetaMask provider not available');
          }

          const signer = this.currentConnection.provider.getSigner();
          const signature = await signer.signMessage(messageToSign);

          return signature;

        default:
          throw new Error('Unsupported wallet type');
      }
    } catch (error: any) {
      console.error('❌ Message signing failed:', error);
      throw new Error(`Failed to sign message: ${error.message}`);
    }
  }

  /**
   * Verify signature for cross-chain authentication
   */
  async verifySignature(
    message: string,
    signature: string,
    address: string,
    walletType: WalletType
  ): Promise<boolean> {
    try {
      switch (walletType) {
        case WalletType.METAMASK:
          // Verify Ethereum signature
          const recoveredAddress = ethers.utils.verifyMessage(message, signature);
          return recoveredAddress.toLowerCase() === address.toLowerCase();

        case WalletType.GALACHAIN:
          // For GalaChain, we'd need to implement their specific verification
          // For now, return true if signature exists (implement proper verification)
          return signature.length > 0;

        default:
          return false;
      }
    } catch (error: any) {
      console.error('❌ Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Switch network for MetaMask users
   */
  async switchNetwork(chainId: number): Promise<void> {
    if (this.currentConnection?.type !== WalletType.METAMASK) {
      throw new Error('Network switching only available for MetaMask');
    }

    try {
      await (window as any).ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });

      // Update connection info
      if (this.currentConnection) {
        this.currentConnection.chainId = chainId;
      }

      console.log('🔄 Network switched to chain ID:', chainId);
    } catch (error: any) {
      console.error('❌ Network switch failed:', error);
      throw new Error(`Failed to switch network: ${error.message}`);
    }
  }

  /**
   * Get wallet balance for current connection
   */
  async getWalletBalance(): Promise<{ ethereum?: string; galachain?: string }> {
    if (!this.currentConnection) {
      throw new Error('No wallet connected');
    }

    const balances: { ethereum?: string; galachain?: string } = {};

    try {
      if (this.currentConnection.type === WalletType.METAMASK && this.currentConnection.provider) {
        // Get Ethereum balance
        const balance = await this.currentConnection.provider.getBalance(this.currentConnection.address);
        balances.ethereum = ethers.utils.formatEther(balance);
      }

      // Get GalaChain balance (would need GalaChain API integration)
      // balances.galachain = await this.getGalaChainBalance(this.currentConnection.galaChainAddress);

      return balances;
    } catch (error: any) {
      console.error('❌ Failed to get wallet balance:', error);
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  /**
   * Get current connection info
   */
  getCurrentConnection(): WalletConnection | null {
    return this.currentConnection;
  }

  /**
   * Get GalaChain address for trading (works for both wallet types)
   */
  getGalaChainAddress(): string | null {
    return this.currentConnection?.galaChainAddress || null;
  }

  /**
   * Get Ethereum address (only for MetaMask connections)
   */
  getEthereumAddress(): string | null {
    if (this.currentConnection?.type === WalletType.METAMASK) {
      return this.currentConnection.address;
    }
    return null;
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return this.currentConnection !== null;
  }

  /**
   * Get wallet type
   */
  getWalletType(): WalletType | null {
    return this.currentConnection?.type || null;
  }

  /**
   * Disconnect wallet
   */
  disconnect(): void {
    this.currentConnection = null;
    console.log('🔌 Wallet disconnected');
  }

  /**
   * Listen for account changes (MetaMask)
   */
  setupAccountChangeListener(callback: (accounts: string[]) => void): void {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      (window as any).ethereum.on('accountsChanged', callback);
    }
  }

  /**
   * Listen for network changes (MetaMask)
   */
  setupNetworkChangeListener(callback: (chainId: string) => void): void {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      (window as any).ethereum.on('chainChanged', callback);
    }
  }

  /**
   * Remove event listeners
   */
  removeEventListeners(): void {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      (window as any).ethereum.removeAllListeners('accountsChanged');
      (window as any).ethereum.removeAllListeners('chainChanged');
    }
  }

  /**
   * Check if Gala Wallet is available
   */
  static isGalaWalletAvailable(): boolean {
    return typeof window !== 'undefined' && typeof (window as any).gala !== 'undefined';
  }

  /**
   * Check if MetaMask is available
   */
  static isMetaMaskAvailable(): boolean {
    return typeof window !== 'undefined' && typeof (window as any).ethereum !== 'undefined';
  }

  /**
   * Get available wallets
   */
  static getAvailableWallets(): { gala: boolean; metamask: boolean } {
    return {
      gala: UnifiedWalletService.isGalaWalletAvailable(),
      metamask: UnifiedWalletService.isMetaMaskAvailable()
    };
  }

  /**
   * Export address mappings (for backup/migration)
   */
  exportAddressMappings(): AddressMapping[] {
    return Array.from(this.addressMappings.values());
  }

  /**
   * Import address mappings (for backup/migration)
   */
  importAddressMappings(mappings: AddressMapping[]): void {
    mappings.forEach(mapping => {
      this.addressMappings.set(mapping.ethereumAddress, mapping);
    });
    console.log('📥 Imported', mappings.length, 'address mappings');
  }
}

// Export singleton instance
export const unifiedWallet = new UnifiedWalletService();
