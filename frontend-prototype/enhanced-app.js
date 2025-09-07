/**
 * Enhanced Fafnir Bot Frontend - Multi-User Support
 *
 * Features:
 * - MetaMask wallet connection
 * - Instant strategy assignment (no container delays!)
 * - Real-time trading updates via WebSocket
 * - Individual performance tracking
 * - Strategy configuration management
 */

class FafnirMultiUserApp {
  constructor() {
    this.config = {
      API_BASE: 'http://localhost:3000/api',
      WS_URL: 'ws://localhost:3000',
      RECONNECT_INTERVAL: 5000,
      HEARTBEAT_INTERVAL: 30000
    };

    this.state = {
      walletAddress: null,
      isConnected: false,
      selectedStrategy: null,
      isStrategyActive: false,
      sessionId: null,
      performance: null,
      trades: [],
      strategies: []
    };

    this.ws = null;
    this.heartbeatInterval = null;
    this.reconnectTimeout = null;

    this.init();
  }

  async init() {
    console.log('🚀 Initializing Enhanced Fafnir Bot Frontend');

    // Setup UI event listeners
    this.setupEventListeners();

    // Load available strategies
    await this.loadStrategies();

    // Check for saved wallet connection
    const savedWallet = localStorage.getItem('fafnir_wallet_address');
    if (savedWallet && window.ethereum) {
      try {
        await this.connectWallet(true); // Auto-connect
      } catch (error) {
        console.log('Auto-connect failed:', error.message);
        localStorage.removeItem('fafnir_wallet_address');
      }
    }

    this.updateUI();
  }

  setupEventListeners() {
    // Wallet connection
    document.getElementById('connect-wallet-btn')?.addEventListener('click', () => {
      this.connectWallet();
    });

    document.getElementById('disconnect-wallet-btn')?.addEventListener('click', () => {
      this.disconnectWallet();
    });

    // Strategy controls
    document.getElementById('start-strategy-btn')?.addEventListener('click', () => {
      this.startSelectedStrategy();
    });

    document.getElementById('stop-strategy-btn')?.addEventListener('click', () => {
      this.stopStrategy();
    });

    // Strategy selection
    document.addEventListener('change', (event) => {
      if (event.target.id === 'strategy-select') {
        this.selectedStrategy = event.target.value;
        this.updateStrategyInfo();
      }
    });

    // Configuration updates
    document.getElementById('update-config-btn')?.addEventListener('click', () => {
      this.updateStrategyConfig();
    });

    // Real-time updates
    document.addEventListener('fafnir-realtime-update', (event) => {
      this.handleRealtimeUpdate(event.detail);
    });

    // Page visibility change (pause/resume WebSocket)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseWebSocket();
      } else {
        this.resumeWebSocket();
      }
    });
  }

  async connectWallet(autoConnect = false) {
    try {
      if (!window.ethereum) {
        throw new Error('MetaMask not detected. Please install MetaMask to continue.');
      }

      this.showStatus('Connecting wallet...', 'info');

      let accounts;
      if (autoConnect) {
        // Try to get existing connection
        accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length === 0) {
          throw new Error('No existing connection');
        }
      } else {
        // Request new connection
        accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      }

      this.state.walletAddress = accounts[0];

      // Connect to Fafnir API
      const response = await fetch(`${this.config.API_BASE}/wallet/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: this.state.walletAddress,
          chainId: await this.getChainId()
        })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to connect to Fafnir API');
      }

      this.state.isConnected = true;
      localStorage.setItem('fafnir_wallet_address', this.state.walletAddress);

      // Connect WebSocket for real-time updates
      this.connectWebSocket();

      // Load user data
      await this.loadUserData();

      this.showStatus(`Wallet connected: ${this.formatAddress(this.state.walletAddress)}`, 'success');
      this.updateUI();

      console.log('✅ Wallet connected successfully');

    } catch (error) {
      console.error('❌ Wallet connection failed:', error);
      this.showStatus(`Connection failed: ${error.message}`, 'error');
      this.state.isConnected = false;
      this.updateUI();
    }
  }

  async disconnectWallet() {
    try {
      if (this.state.walletAddress) {
        // Stop strategy if running
        if (this.state.isStrategyActive) {
          await this.stopStrategy();
        }

        // Disconnect from API
        await fetch(`${this.config.API_BASE}/wallet/disconnect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress: this.state.walletAddress })
        });
      }

      // Close WebSocket
      this.disconnectWebSocket();

      // Reset state
      this.state = {
        ...this.state,
        walletAddress: null,
        isConnected: false,
        selectedStrategy: null,
        isStrategyActive: false,
        sessionId: null,
        performance: null,
        trades: []
      };

      localStorage.removeItem('fafnir_wallet_address');

      this.showStatus('Wallet disconnected', 'info');
      this.updateUI();

      console.log('👋 Wallet disconnected');

    } catch (error) {
      console.error('❌ Disconnect error:', error);
      this.showStatus(`Disconnect error: ${error.message}`, 'error');
    }
  }

  async loadStrategies() {
    try {
      const response = await fetch(`${this.config.API_BASE}/strategies`);
      const data = await response.json();

      this.state.strategies = data.strategies;
      this.renderStrategies();

      console.log(`📊 Loaded ${this.state.strategies.length} strategies`);

    } catch (error) {
      console.error('❌ Failed to load strategies:', error);
      this.showStatus('Failed to load strategies', 'error');
    }
  }

  async loadUserData() {
    if (!this.state.walletAddress) return;

    try {
      // Load strategy status
      const statusResponse = await fetch(`${this.config.API_BASE}/strategies/${this.state.walletAddress}/status`);
      const statusData = await statusResponse.json();

      if (statusData.hasActiveStrategy) {
        this.state.selectedStrategy = statusData.strategy;
        this.state.isStrategyActive = statusData.isActive;
        this.state.sessionId = statusData.sessionId;
      }

      // Load performance data
      if (this.state.isStrategyActive) {
        await this.loadPerformance();
        await this.loadTrades();
      }

      this.updateUI();

    } catch (error) {
      console.error('❌ Failed to load user data:', error);
    }
  }

  async loadPerformance() {
    try {
      const response = await fetch(`${this.config.API_BASE}/performance/${this.state.walletAddress}`);
      const data = await response.json();

      this.state.performance = data.performance;
      this.renderPerformance();

    } catch (error) {
      console.error('❌ Failed to load performance:', error);
    }
  }

  async loadTrades(limit = 20) {
    try {
      const response = await fetch(`${this.config.API_BASE}/trades/${this.state.walletAddress}?limit=${limit}`);
      const data = await response.json();

      this.state.trades = data.trades || [];
      this.renderTrades();

    } catch (error) {
      console.error('❌ Failed to load trades:', error);
    }
  }

  async startSelectedStrategy() {
    if (!this.state.selectedStrategy) {
      this.showStatus('Please select a strategy first', 'warning');
      return;
    }

    try {
      this.showStatus('Starting strategy...', 'info');

      // Get configuration from form
      const config = this.getStrategyConfig();

      const response = await fetch(`${this.config.API_BASE}/strategies/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: this.state.walletAddress,
          strategy: this.state.selectedStrategy,
          config
        })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to start strategy');
      }

      this.state.isStrategyActive = true;
      this.state.sessionId = result.sessionId;

      this.showStatus(`Strategy ${this.state.selectedStrategy} started successfully!`, 'success');
      this.updateUI();

      // Start loading performance data
      setTimeout(() => {
        this.loadPerformance();
        this.loadTrades();
      }, 2000);

      console.log(`🚀 Strategy ${this.state.selectedStrategy} started`);

    } catch (error) {
      console.error('❌ Failed to start strategy:', error);
      this.showStatus(`Failed to start strategy: ${error.message}`, 'error');
    }
  }

  async stopStrategy() {
    try {
      this.showStatus('Stopping strategy...', 'info');

      const response = await fetch(`${this.config.API_BASE}/strategies/${this.state.walletAddress}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to stop strategy');
      }

      this.state.isStrategyActive = false;
      this.state.sessionId = null;

      this.showStatus('Strategy stopped', 'info');
      this.updateUI();

      console.log('🛑 Strategy stopped');

    } catch (error) {
      console.error('❌ Failed to stop strategy:', error);
      this.showStatus(`Failed to stop strategy: ${error.message}`, 'error');
    }
  }

  async updateStrategyConfig() {
    if (!this.state.isStrategyActive) return;

    try {
      const config = this.getStrategyConfig();

      const response = await fetch(`${this.config.API_BASE}/strategies/${this.state.walletAddress}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update configuration');
      }

      this.showStatus('Configuration updated', 'success');

    } catch (error) {
      console.error('❌ Failed to update config:', error);
      this.showStatus(`Failed to update config: ${error.message}`, 'error');
    }
  }

  connectWebSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    try {
      this.ws = new WebSocket(this.config.WS_URL);

      this.ws.onopen = () => {
        console.log('🔌 WebSocket connected');

        // Authenticate with wallet address
        this.ws.send(JSON.stringify({
          type: 'authenticate',
          walletAddress: this.state.walletAddress,
          sessionId: this.state.sessionId
        }));

        // Start heartbeat
        this.startHeartbeat();

        // Clear reconnect timeout
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWebSocketMessage(data);
        } catch (error) {
          console.error('❌ Invalid WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        this.stopHeartbeat();

        // Attempt to reconnect if wallet is still connected
        if (this.state.isConnected && !this.reconnectTimeout) {
          this.reconnectTimeout = setTimeout(() => {
            console.log('🔄 Attempting to reconnect WebSocket...');
            this.connectWebSocket();
          }, this.config.RECONNECT_INTERVAL);
        }
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };

    } catch (error) {
      console.error('❌ Failed to connect WebSocket:', error);
    }
  }

  disconnectWebSocket() {
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  handleWebSocketMessage(data) {
    switch (data.type) {
      case 'connected':
        console.log('✅ WebSocket authenticated');
        break;

      case 'strategy_update':
        this.handleStrategyUpdate(data);
        break;

      case 'trade_notification':
        this.handleTradeNotification(data);
        break;

      case 'performance_update':
        this.handlePerformanceUpdate(data);
        break;

      case 'pong':
        // Heartbeat response
        break;

      default:
        console.log('❓ Unknown WebSocket message:', data.type);
    }

    // Emit custom event for other components
    document.dispatchEvent(new CustomEvent('fafnir-realtime-update', {
      detail: data
    }));
  }

  handleStrategyUpdate(data) {
    if (data.walletAddress === this.state.walletAddress) {
      this.state.isStrategyActive = data.status === 'active';
      this.updateStrategyStatus(data.status);
    }
  }

  handleTradeNotification(data) {
    if (data.walletAddress === this.state.walletAddress && data.lastTrade) {
      // Add new trade to the beginning of the list
      this.state.trades.unshift(data.lastTrade);

      // Keep only last 50 trades
      if (this.state.trades.length > 50) {
        this.state.trades = this.state.trades.slice(0, 50);
      }

      // Update performance
      if (data.performance) {
        this.state.performance = data.performance;
        this.renderPerformance();
      }

      this.renderTrades();
      this.showTradeNotification(data.lastTrade);
    }
  }

  handlePerformanceUpdate(data) {
    if (data.walletAddress === this.state.walletAddress) {
      this.state.performance = data.performance;
      this.renderPerformance();
    }
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.config.HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  pauseWebSocket() {
    // Reduce activity when page is hidden
    this.stopHeartbeat();
  }

  resumeWebSocket() {
    // Resume activity when page is visible
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.startHeartbeat();
    }
  }

  renderStrategies() {
    const container = document.getElementById('strategy-list');
    if (!container) return;

    container.innerHTML = this.state.strategies.map(strategy => `
      <div class="strategy-card" data-strategy="${strategy.id}">
        <div class="strategy-header">
          <h3>${strategy.name}</h3>
          <span class="risk-badge risk-${strategy.riskLevel}">${strategy.riskLevel}</span>
        </div>
        <p class="strategy-description">${strategy.description}</p>
        <div class="strategy-stats">
          <div class="stat">
            <label>Expected Return:</label>
            <span>${strategy.expectedReturn}</span>
          </div>
          <div class="stat">
            <label>Min Amount:</label>
            <span>$${strategy.minAmount}</span>
          </div>
          <div class="stat">
            <label>Max Amount:</label>
            <span>$${strategy.maxAmount}</span>
          </div>
        </div>
        <div class="strategy-pairs">
          <label>Supported Pairs:</label>
          <div class="pairs-list">
            ${strategy.supportedPairs.map(pair => `<span class="pair-tag">${pair}</span>`).join('')}
          </div>
        </div>
      </div>
    `).join('');

    // Update strategy select dropdown
    const select = document.getElementById('strategy-select');
    if (select) {
      select.innerHTML = '<option value="">Select a strategy...</option>' +
        this.state.strategies.map(strategy =>
          `<option value="${strategy.id}">${strategy.name}</option>`
        ).join('');

      if (this.state.selectedStrategy) {
        select.value = this.state.selectedStrategy;
      }
    }
  }

  renderPerformance() {
    if (!this.state.performance) return;

    const container = document.getElementById('performance-metrics');
    if (!container) return;

    const perf = this.state.performance;

    container.innerHTML = `
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Total Profit</div>
          <div class="metric-value profit ${perf.totalProfit >= 0 ? 'positive' : 'negative'}">
            $${perf.totalProfit.toFixed(2)}
          </div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Daily Profit</div>
          <div class="metric-value profit ${perf.dailyProfit >= 0 ? 'positive' : 'negative'}">
            $${perf.dailyProfit.toFixed(2)}
          </div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Win Rate</div>
          <div class="metric-value">${perf.winRate.toFixed(1)}%</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Total Trades</div>
          <div class="metric-value">${perf.totalTrades}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Successful Trades</div>
          <div class="metric-value">${perf.successfulTrades}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Average Profit</div>
          <div class="metric-value profit ${perf.averageProfit >= 0 ? 'positive' : 'negative'}">
            $${perf.averageProfit.toFixed(4)}
          </div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Total Volume</div>
          <div class="metric-value">$${perf.totalVolume.toFixed(2)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Last Updated</div>
          <div class="metric-value">${new Date(perf.lastUpdated).toLocaleTimeString()}</div>
        </div>
      </div>
    `;
  }

  renderTrades() {
    const container = document.getElementById('trades-list');
    if (!container) return;

    if (this.state.trades.length === 0) {
      container.innerHTML = '<div class="no-trades">No trades yet</div>';
      return;
    }

    container.innerHTML = this.state.trades.map(trade => `
      <div class="trade-item ${trade.success ? 'success' : 'failed'}">
        <div class="trade-time">${new Date(trade.timestamp).toLocaleString()}</div>
        <div class="trade-strategy">${trade.strategy}</div>
        <div class="trade-pool">${trade.pool || 'N/A'}</div>
        <div class="trade-profit ${trade.profit >= 0 ? 'positive' : 'negative'}">
          $${trade.profit.toFixed(4)}
        </div>
        <div class="trade-volume">$${trade.volume.toFixed(2)}</div>
        <div class="trade-status">
          ${trade.success ? '✅' : '❌'}
          ${trade.error ? `<span class="error-tooltip" title="${trade.error}">⚠️</span>` : ''}
        </div>
      </div>
    `).join('');
  }

  updateUI() {
    const app = document.getElementById('app');
    if (!app) return;

    // Update main app state classes
    app.className = `fafnir-app ${this.state.isConnected ? 'wallet-connected' : 'wallet-disconnected'} ${this.state.isStrategyActive ? 'strategy-active' : 'strategy-inactive'}`;

    // Update wallet info
    const walletInfo = document.getElementById('wallet-info');
    if (walletInfo) {
      if (this.state.isConnected) {
        walletInfo.innerHTML = `
          <div class="wallet-address">
            <strong>Connected:</strong> ${this.formatAddress(this.state.walletAddress)}
          </div>
          <div class="wallet-actions">
            <button id="disconnect-wallet-btn" class="btn btn-secondary">Disconnect</button>
          </div>
        `;
        // Re-attach event listener
        document.getElementById('disconnect-wallet-btn').addEventListener('click', () => {
          this.disconnectWallet();
        });
      } else {
        walletInfo.innerHTML = `
          <div class="wallet-prompt">
            <p>Connect your MetaMask wallet to start trading</p>
            <button id="connect-wallet-btn" class="btn btn-primary">Connect Wallet</button>
          </div>
        `;
        // Re-attach event listener
        document.getElementById('connect-wallet-btn').addEventListener('click', () => {
          this.connectWallet();
        });
      }
    }

    // Update strategy controls
    const strategyControls = document.getElementById('strategy-controls');
    if (strategyControls) {
      if (this.state.isConnected) {
        if (this.state.isStrategyActive) {
          strategyControls.innerHTML = `
            <div class="active-strategy">
              <h3>Active Strategy: ${this.state.selectedStrategy}</h3>
              <div class="strategy-actions">
                <button id="stop-strategy-btn" class="btn btn-danger">Stop Strategy</button>
                <button id="update-config-btn" class="btn btn-secondary">Update Config</button>
              </div>
            </div>
          `;
          // Re-attach event listeners
          document.getElementById('stop-strategy-btn').addEventListener('click', () => {
            this.stopStrategy();
          });
          document.getElementById('update-config-btn').addEventListener('click', () => {
            this.updateStrategyConfig();
          });
        } else {
          strategyControls.innerHTML = `
            <div class="strategy-selection">
              <h3>Select Strategy</h3>
              <select id="strategy-select" class="form-control">
                <option value="">Choose a strategy...</option>
              </select>
              <button id="start-strategy-btn" class="btn btn-primary" disabled>Start Strategy</button>
            </div>
          `;
          // Re-attach event listeners and populate select
          const select = document.getElementById('strategy-select');
          select.innerHTML = '<option value="">Choose a strategy...</option>' +
            this.state.strategies.map(strategy =>
              `<option value="${strategy.id}">${strategy.name}</option>`
            ).join('');

          select.addEventListener('change', (e) => {
            this.state.selectedStrategy = e.target.value;
            document.getElementById('start-strategy-btn').disabled = !e.target.value;
            this.updateStrategyInfo();
          });

          document.getElementById('start-strategy-btn').addEventListener('click', () => {
            this.startSelectedStrategy();
          });
        }
      }
    }

    // Show/hide sections based on state
    this.toggleSection('wallet-section', !this.state.isConnected);
    this.toggleSection('strategy-section', this.state.isConnected);
    this.toggleSection('dashboard-section', this.state.isConnected && this.state.isStrategyActive);
  }

  updateStrategyInfo() {
    const infoContainer = document.getElementById('strategy-info');
    if (!infoContainer || !this.state.selectedStrategy) return;

    const strategy = this.state.strategies.find(s => s.id === this.state.selectedStrategy);
    if (!strategy) return;

    infoContainer.innerHTML = `
      <div class="strategy-details">
        <h4>${strategy.name}</h4>
        <p>${strategy.description}</p>
        <div class="strategy-config">
          <h5>Configuration</h5>
          <div class="config-grid">
            <div class="config-item">
              <label for="min-profit">Min Profit (bps):</label>
              <input type="number" id="min-profit" value="50" min="10" max="500">
            </div>
            <div class="config-item">
              <label for="slippage">Slippage (bps):</label>
              <input type="number" id="slippage" value="100" min="50" max="1000">
            </div>
            <div class="config-item">
              <label for="max-trade-size">Max Trade Size ($):</label>
              <input type="number" id="max-trade-size" value="100" min="${strategy.minAmount}" max="${strategy.maxAmount}">
            </div>
            <div class="config-item">
              <label for="risk-level">Risk Level:</label>
              <select id="risk-level">
                <option value="conservative">Conservative</option>
                <option value="moderate" selected>Moderate</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  updateStrategyStatus(status) {
    const statusIndicator = document.getElementById('strategy-status');
    if (statusIndicator) {
      statusIndicator.className = `status-indicator ${status}`;
      statusIndicator.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }
  }

  getStrategyConfig() {
    return {
      minProfitBps: parseInt(document.getElementById('min-profit')?.value || '50'),
      slippageBps: parseInt(document.getElementById('slippage')?.value || '100'),
      maxTradeSize: parseInt(document.getElementById('max-trade-size')?.value || '100'),
      riskLevel: document.getElementById('risk-level')?.value || 'moderate',
      autoTrade: true,
      notifications: true
    };
  }

  showTradeNotification(trade) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `trade-notification ${trade.success ? 'success' : 'failed'}`;
    notification.innerHTML = `
      <div class="notification-header">
        <span class="notification-icon">${trade.success ? '✅' : '❌'}</span>
        <span class="notification-title">Trade ${trade.success ? 'Successful' : 'Failed'}</span>
        <button class="notification-close">&times;</button>
      </div>
      <div class="notification-content">
        <div>Strategy: ${trade.strategy}</div>
        <div>Profit: $${trade.profit.toFixed(4)}</div>
        <div>Volume: $${trade.volume.toFixed(2)}</div>
        ${trade.pool ? `<div>Pool: ${trade.pool}</div>` : ''}
      </div>
    `;

    // Add to page
    document.body.appendChild(notification);

    // Auto-remove after 5 seconds
    const autoRemove = setTimeout(() => {
      notification.remove();
    }, 5000);

    // Manual close
    notification.querySelector('.notification-close').addEventListener('click', () => {
      clearTimeout(autoRemove);
      notification.remove();
    });

    // Slide in animation
    setTimeout(() => {
      notification.classList.add('show');
    }, 100);
  }

  showStatus(message, type = 'info') {
    const statusBar = document.getElementById('status-bar');
    if (!statusBar) {
      console.log(`${type.toUpperCase()}: ${message}`);
      return;
    }

    statusBar.className = `status-bar ${type}`;
    statusBar.textContent = message;
    statusBar.style.display = 'block';

    // Auto-hide after 5 seconds for non-error messages
    if (type !== 'error') {
      setTimeout(() => {
        statusBar.style.display = 'none';
      }, 5000);
    }
  }

  toggleSection(sectionId, show) {
    const section = document.getElementById(sectionId);
    if (section) {
      section.style.display = show ? 'block' : 'none';
    }
  }

  formatAddress(address) {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  async getChainId() {
    try {
      return await window.ethereum.request({ method: 'eth_chainId' });
    } catch (error) {
      return 1; // Default to mainnet
    }
  }

  handleRealtimeUpdate(data) {
    // This method can be overridden by external code
    // for custom real-time update handling
  }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.fafnirApp = new FafnirMultiUserApp();
});

// Export for external use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FafnirMultiUserApp;
}
