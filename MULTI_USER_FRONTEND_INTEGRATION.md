# 🚀 Multi-User Frontend Integration Guide

## Overview
This guide shows how to integrate your frontend with the new multi-user Fafnir Bot system. Users can connect their MetaMask wallets and instantly start trading strategies without any container startup delays.

## 🏗️ Architecture

```
Frontend (React/Vue/Vanilla JS)
    ↓ MetaMask Connection
    ↓ Strategy Selection
    ↓ Real-time Updates
Enhanced API Server (Express + WebSocket)
    ↓ User Session Management
    ↓ Strategy Assignment
Multi-User Strategy Manager
    ↓ Isolated Strategy Instances
    ↓ Concurrent Execution
GalaChain Trading (swapAuth)
```

## 🔌 API Endpoints

### Wallet Management
```javascript
// Connect wallet
POST /api/wallet/connect
{
  "walletAddress": "0x123...",
  "signature": "0xabc...",  // Optional
  "chainId": 1             // Optional
}

// Disconnect wallet
POST /api/wallet/disconnect
{
  "walletAddress": "0x123..."
}

// Get wallet status
GET /api/wallet/0x123.../status
```

### Strategy Management
```javascript
// Get available strategies
GET /api/strategies

// Assign strategy (INSTANT!)
POST /api/strategies/assign
{
  "walletAddress": "0x123...",
  "strategy": "arbitrage",
  "config": {
    "minProfitBps": 50,
    "slippageBps": 100,
    "maxTradeSize": 100,
    "riskLevel": "moderate"
  }
}

// Control strategy
POST /api/strategies/0x123.../control
{
  "action": "start|stop|pause|resume",
  "strategy": "arbitrage",  // Required for start
  "config": {}              // Optional
}

// Get strategy status
GET /api/strategies/0x123.../status

// Update configuration
PUT /api/strategies/0x123.../config
{
  "minProfitBps": 75,
  "slippageBps": 80
}
```

### Performance & Monitoring
```javascript
// Get user performance
GET /api/performance/0x123...

// Get user trades
GET /api/trades/0x123...?limit=50

// Get dashboard overview
GET /api/dashboard
```

## 📡 WebSocket Integration

### Connection
```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onopen = () => {
  // Authenticate with wallet address
  ws.send(JSON.stringify({
    type: 'authenticate',
    walletAddress: '0x123...',
    sessionId: 'session_123'
  }));
};
```

### Real-time Updates
```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'strategy_update':
      updateStrategyStatus(data);
      break;

    case 'trade_notification':
      showTradeNotification(data);
      break;

    case 'performance_update':
      updatePerformanceMetrics(data);
      break;
  }
};
```

## 🎯 Frontend Implementation

### 1. Enhanced Wallet Connection
```javascript
class FafnirWalletManager {
  constructor() {
    this.walletAddress = null;
    this.isConnected = false;
    this.ws = null;
  }

  async connectMetaMask() {
    try {
      // Request MetaMask connection
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });

      this.walletAddress = accounts[0];

      // Connect to Fafnir API
      const response = await fetch('/api/wallet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: this.walletAddress,
          chainId: await this.getChainId()
        })
      });

      const result = await response.json();

      if (result.success) {
        this.isConnected = true;
        this.connectWebSocket();
        return result;
      }

      throw new Error('Failed to connect to Fafnir API');

    } catch (error) {
      console.error('Wallet connection failed:', error);
      throw error;
    }
  }

  connectWebSocket() {
    this.ws = new WebSocket('ws://localhost:3000');

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: 'authenticate',
        walletAddress: this.walletAddress
      }));
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleWebSocketMessage(data);
    };
  }

  handleWebSocketMessage(data) {
    // Emit custom events for UI updates
    document.dispatchEvent(new CustomEvent('fafnir-update', {
      detail: data
    }));
  }
}
```

### 2. Strategy Selection Component
```javascript
class StrategySelector {
  constructor(walletManager) {
    this.walletManager = walletManager;
    this.strategies = [];
    this.selectedStrategy = null;
  }

  async loadStrategies() {
    const response = await fetch('/api/strategies');
    const data = await response.json();
    this.strategies = data.strategies;
    this.renderStrategies();
  }

  async startStrategy(strategyId, config = {}) {
    try {
      const response = await fetch('/api/strategies/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: this.walletManager.walletAddress,
          strategy: strategyId,
          config
        })
      });

      const result = await response.json();

      if (result.success) {
        this.selectedStrategy = strategyId;
        this.showSuccessMessage(`${strategyId} strategy started!`);
        return result;
      }

      throw new Error(result.error || 'Failed to start strategy');

    } catch (error) {
      this.showErrorMessage(error.message);
      throw error;
    }
  }

  async stopStrategy() {
    if (!this.selectedStrategy) return;

    const response = await fetch(`/api/strategies/${this.walletManager.walletAddress}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' })
    });

    const result = await response.json();

    if (result.success) {
      this.selectedStrategy = null;
      this.showSuccessMessage('Strategy stopped');
    }
  }

  renderStrategies() {
    const container = document.getElementById('strategy-list');
    container.innerHTML = this.strategies.map(strategy => `
      <div class="strategy-card" data-strategy="${strategy.id}">
        <h3>${strategy.name}</h3>
        <p>${strategy.description}</p>
        <div class="strategy-stats">
          <span class="risk-level ${strategy.riskLevel}">${strategy.riskLevel}</span>
          <span class="expected-return">${strategy.expectedReturn}</span>
        </div>
        <button onclick="selectStrategy('${strategy.id}')"
                class="btn-primary">
          Select Strategy
        </button>
      </div>
    `).join('');
  }
}
```

### 3. Real-time Performance Dashboard
```javascript
class PerformanceDashboard {
  constructor(walletManager) {
    this.walletManager = walletManager;
    this.performance = null;
    this.trades = [];

    // Listen for real-time updates
    document.addEventListener('fafnir-update', (event) => {
      this.handleUpdate(event.detail);
    });
  }

  async loadPerformance() {
    const response = await fetch(`/api/performance/${this.walletManager.walletAddress}`);
    this.performance = await response.json();
    this.renderPerformance();
  }

  async loadTrades(limit = 20) {
    const response = await fetch(`/api/trades/${this.walletManager.walletAddress}?limit=${limit}`);
    const data = await response.json();
    this.trades = data.trades;
    this.renderTrades();
  }

  handleUpdate(data) {
    switch (data.type) {
      case 'strategy_update':
        this.updateStrategyStatus(data);
        break;

      case 'trade_notification':
        this.addNewTrade(data.lastTrade);
        this.updatePerformanceMetrics(data.performance);
        break;
    }
  }

  renderPerformance() {
    const container = document.getElementById('performance-dashboard');
    container.innerHTML = `
      <div class="performance-grid">
        <div class="metric-card">
          <h4>Total Profit</h4>
          <span class="metric-value profit">$${this.performance.performance.totalProfit.toFixed(2)}</span>
        </div>
        <div class="metric-card">
          <h4>Win Rate</h4>
          <span class="metric-value">${this.performance.performance.winRate.toFixed(1)}%</span>
        </div>
        <div class="metric-card">
          <h4>Total Trades</h4>
          <span class="metric-value">${this.performance.performance.totalTrades}</span>
        </div>
        <div class="metric-card">
          <h4>Daily Profit</h4>
          <span class="metric-value profit">$${this.performance.performance.dailyProfit.toFixed(2)}</span>
        </div>
      </div>
    `;
  }

  renderTrades() {
    const container = document.getElementById('trades-list');
    container.innerHTML = this.trades.map(trade => `
      <div class="trade-item ${trade.success ? 'success' : 'failed'}">
        <div class="trade-time">${new Date(trade.timestamp).toLocaleTimeString()}</div>
        <div class="trade-strategy">${trade.strategy}</div>
        <div class="trade-profit ${trade.profit >= 0 ? 'positive' : 'negative'}">
          $${trade.profit.toFixed(4)}
        </div>
        <div class="trade-volume">$${trade.volume.toFixed(2)}</div>
      </div>
    `).join('');
  }
}
```

## 🎨 Enhanced Frontend App Structure

```javascript
class FafnirApp {
  constructor() {
    this.walletManager = new FafnirWalletManager();
    this.strategySelector = new StrategySelector(this.walletManager);
    this.dashboard = new PerformanceDashboard(this.walletManager);

    this.init();
  }

  async init() {
    // Check if wallet was previously connected
    const savedWallet = localStorage.getItem('fafnir_wallet');
    if (savedWallet) {
      try {
        await this.walletManager.connectMetaMask();
        await this.loadUserData();
      } catch (error) {
        console.log('Auto-connect failed:', error);
      }
    }

    this.setupEventListeners();
    await this.strategySelector.loadStrategies();
  }

  async loadUserData() {
    await Promise.all([
      this.dashboard.loadPerformance(),
      this.dashboard.loadTrades(),
      this.checkActiveStrategy()
    ]);
  }

  async checkActiveStrategy() {
    const response = await fetch(`/api/strategies/${this.walletManager.walletAddress}/status`);
    const status = await response.json();

    if (status.hasActiveStrategy) {
      this.strategySelector.selectedStrategy = status.strategy;
      this.updateUI('strategy-active');
    }
  }

  setupEventListeners() {
    // Connect wallet button
    document.getElementById('connect-wallet').addEventListener('click', async () => {
      try {
        await this.walletManager.connectMetaMask();
        localStorage.setItem('fafnir_wallet', this.walletManager.walletAddress);
        await this.loadUserData();
        this.updateUI('wallet-connected');
      } catch (error) {
        this.showError('Failed to connect wallet: ' + error.message);
      }
    });

    // Disconnect wallet button
    document.getElementById('disconnect-wallet').addEventListener('click', async () => {
      await this.walletManager.disconnect();
      localStorage.removeItem('fafnir_wallet');
      this.updateUI('wallet-disconnected');
    });

    // Real-time updates
    document.addEventListener('fafnir-update', (event) => {
      this.handleRealTimeUpdate(event.detail);
    });
  }

  updateUI(state) {
    const app = document.getElementById('app');
    app.className = `fafnir-app ${state}`;

    switch (state) {
      case 'wallet-connected':
        document.getElementById('wallet-section').style.display = 'none';
        document.getElementById('strategy-section').style.display = 'block';
        document.getElementById('dashboard-section').style.display = 'block';
        break;

      case 'wallet-disconnected':
        document.getElementById('wallet-section').style.display = 'block';
        document.getElementById('strategy-section').style.display = 'none';
        document.getElementById('dashboard-section').style.display = 'none';
        break;

      case 'strategy-active':
        document.getElementById('strategy-controls').classList.add('active');
        break;
    }
  }

  handleRealTimeUpdate(data) {
    // Show toast notifications for trades
    if (data.type === 'trade_notification' && data.lastTrade) {
      this.showTradeNotification(data.lastTrade);
    }

    // Update strategy status indicator
    if (data.type === 'strategy_update') {
      this.updateStrategyStatusIndicator(data.status);
    }
  }

  showTradeNotification(trade) {
    const notification = document.createElement('div');
    notification.className = `trade-notification ${trade.success ? 'success' : 'failed'}`;
    notification.innerHTML = `
      <div class="notification-content">
        <strong>${trade.success ? '✅' : '❌'} Trade ${trade.success ? 'Successful' : 'Failed'}</strong>
        <div>Profit: $${trade.profit.toFixed(4)}</div>
        <div>Strategy: ${trade.strategy}</div>
      </div>
    `;

    document.body.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      notification.remove();
    }, 5000);
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.fafnirApp = new FafnirApp();
});
```

## 🚀 Key Benefits

### For Users:
- ⚡ **Instant Strategy Start** - No waiting for containers
- 🔄 **Real-time Updates** - Live trading notifications
- 📊 **Personal Dashboard** - Individual performance tracking
- 🔒 **Wallet Isolation** - Each user's trades are separate

### For Developers:
- 🏗️ **Scalable Architecture** - Single container handles multiple users
- 📡 **WebSocket Integration** - Real-time bidirectional communication
- 🔧 **Easy Configuration** - Per-user strategy settings
- 📈 **Performance Monitoring** - Built-in analytics

## 🔧 Deployment

### 1. Update Docker Compose
```yaml
version: '3.8'
services:
  fafnir-multi-user:
    build: .
    container_name: fafnir-multi-user-bot
    ports:
      - "3000:3000"  # API + WebSocket
    environment:
      - NODE_ENV=production
      - MULTI_USER_MODE=true
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped
```

### 2. Start the Enhanced System
```bash
# Build and start
docker-compose up -d

# Check logs
docker logs fafnir-multi-user-bot -f
```

### 3. Frontend Integration
```bash
# Update your frontend API URLs
const API_BASE = 'http://your-server:3000/api';
const WS_URL = 'ws://your-server:3000';
```

## 🎯 Next Steps

1. **Test the Integration** - Connect MetaMask and try strategies
2. **Customize UI** - Match your yuphix.io branding
3. **Add Features** - Strategy comparison, advanced analytics
4. **Scale Up** - Add more strategies and features
5. **Monitor Performance** - Track system metrics

Your multi-user Fafnir Bot system is now ready for production! 🚀
