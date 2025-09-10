# 🐉 Fafnir Bot Multi-User API - Frontend Integration Guide

> **Version**: 2.1.0
> **Date**: September 8, 2025
> **Status**: ✅ **PRODUCTION READY**

## 🚀 Quick Start

You now have **TWO deployment options** for your Fafnir Bot:

### **Option 1: Local API + Container Bot** (Recommended)
- **Local API Server**: `http://localhost:3000` (multi-user support)
- **Container Bot**: `http://localhost:3001` (always-active multi-strategy bot)
- **Frontend Dashboard**: Connect from `http://localhost:3001/fafnir`

### **Option 2: Full Container Deployment**
- **Container API**: `http://localhost:3000` (multi-user API)
- **Container Bot**: `http://localhost:3001` (multi-strategy bot)
- **Auto-scaling**: Both services in Docker with health checks

**CORS Status**: ✅ **WORKING** - `localhost:3001` is whitelisted

---

## 🐳 **NEW: Containerized Multi-Strategy Bot**

### **Always-Active Container Features**
- ✅ **6 Strategies Available** including Fafnir Treasure Hoarder
- ✅ **Auto Strategy Switching** based on market conditions
- ✅ **Frontend Control API** at `http://localhost:3001`
- ✅ **Health Monitoring** with automatic restarts
- ✅ **Performance Tracking** with real-time metrics
- ✅ **Risk Management** built-in

### **Quick Launch**
```powershell
# Launch containerized multi-strategy bot
.\start-multi-strategy.ps1

# Check status
docker logs fafnir-multi-strategy-bot -f
```

### **Container Endpoints**
| Endpoint | Description |
|----------|-------------|
| `GET /api/bot/status` | Bot status and current strategy |
| `POST /api/bot/start` | Start trading |
| `POST /api/bot/stop` | Stop trading |
| `POST /api/bot/strategy/switch` | Switch to different strategy |
| `GET /api/bot/strategies` | List all available strategies |
| `GET /api/bot/performance` | Performance metrics |

---

## 🎯 Available Trading Strategies

| Strategy | ID | Description | Risk Level | Optimal For |
|----------|----|-----------|-----------|-----------|
| **🏴‍☠️ Fafnir Treasure Hoarder** | `fafnir-treasure-hoarder` | **NEW!** RSI + Bollinger Bands layered strategy | Medium | DEX volatility |
| ⚡ Enhanced Trend | `enhanced-trend` | Trend-following with momentum | Medium-High | Strong trends |
| 🔺 Triangular Arbitrage | `triangular` | Cross-pair arbitrage | Low-Medium | High liquidity |
| 📊 Fibonacci Strategy | `fibonacci` | Support/resistance levels | Medium | Range-bound |
| 🕷️ Liquidity Spider | `liquidity-spider` | Liquidity farming | Low | Stable income |
| 🔄 Arbitrage | `arbitrage` | Price difference exploitation | Low | Quick profits |

---

## 🏴‍☠️ NEW: Fafnir Treasure Hoarder Strategy

### **What Makes It Special**
- **RSI + Bollinger Bands** layered analysis
- **DEX-optimized** parameters (35/65 RSI thresholds)
- **Confidence scoring** (60%-90%)
- **Squeeze detection** prevents false breakouts
- **Risk management** with position sizing

### **Strategy Configuration**
```javascript
{
  "strategy": "fafnir-treasure-hoarder",
  "config": {
    "rsiOversold": 35,        // Buy threshold (DEX optimized)
    "rsiOverbought": 65,      // Sell threshold (DEX optimized)
    "minConfidence": 0.6,     // 60% minimum confidence
    "maxRiskPerTrade": 0.02,  // 2% max risk per trade
    "tradeCooldown": 300000,  // 5 minutes between trades
    "slippageBps": 100        // 1% slippage tolerance
  }
}
```

---

## 🔌 Frontend API Integration

### **Option 1: Control Containerized Bot (Recommended)**

```javascript
// Get bot status
const botStatus = await fetch('http://localhost:3001/api/bot/status')
  .then(r => r.json());

console.log('Bot Status:', {
  isRunning: botStatus.data.isRunning,
  currentStrategy: botStatus.data.currentStrategy,
  totalTrades: botStatus.data.totalTrades,
  currentProfit: botStatus.data.currentProfit
});

// Switch strategy in container
const switchResponse = await fetch('http://localhost:3001/api/bot/strategy/switch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    strategy: "fafnir-treasure-hoarder"
  })
});

// Start/Stop bot
await fetch('http://localhost:3001/api/bot/start', { method: 'POST' });
await fetch('http://localhost:3001/api/bot/stop', { method: 'POST' });
```

### **Option 2: Multi-User API (Individual Users)**

```javascript
// Assign strategy to specific user (API server)
const response = await fetch('http://localhost:3000/api/strategies/assign', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    walletAddress: "0x123...", // User's connected wallet
    strategy: "fafnir-treasure-hoarder",
    config: {
      minConfidence: 0.7,
      maxRiskPerTrade: 0.015,
      riskLevel: "moderate"
    }
  })
});
```

### **Hybrid Approach (Best of Both)**

```javascript
class FafnirController {
  constructor() {
    this.botAPI = 'http://localhost:3001';      // Container bot
    this.userAPI = 'http://localhost:3000';     // Multi-user API
  }

  // Control the main bot container
  async controlMainBot(action, strategy = null) {
    const endpoint = action === 'switch'
      ? '/api/bot/strategy/switch'
      : `/api/bot/${action}`;

    const body = action === 'switch' ? { strategy } : {};

    return fetch(`${this.botAPI}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json());
  }

  // Assign strategies to individual users
  async assignUserStrategy(walletAddress, strategy, config) {
    return fetch(`${this.userAPI}/api/strategies/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ walletAddress, strategy, config })
    }).then(r => r.json());
  }

  // Get combined status
  async getFullStatus() {
    const [botStatus, userStats] = await Promise.all([
      fetch(`${this.botAPI}/api/bot/status`).then(r => r.json()),
      fetch(`${this.userAPI}/api/dashboard`).then(r => r.json())
    ]);

    return {
      mainBot: botStatus.data,
      multiUser: userStats.data
    };
  }
}
```---

## 📊 API Endpoints Reference

### **Core Strategy Endpoints**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/strategies` | List all available strategies |
| `POST` | `/api/strategies/assign` | Assign strategy to wallet |
| `POST` | `/api/strategies/{address}/control` | Start/stop strategies |
| `GET` | `/api/strategies/{address}/status` | Get strategy status |
| `PUT` | `/api/strategies/{address}/config` | Update configuration |

### **Performance & Monitoring**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/performance/{address}` | User performance metrics |
| `GET` | `/api/dashboard` | Complete dashboard data |
| `GET` | `/api/trades` | Recent trades |
| `GET` | `/api/cors-test` | Test CORS connectivity |

### **Wallet Integration**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/cross-chain` | MetaMask authentication |
| `POST` | `/api/wallet/map-address` | Link ETH↔GALA addresses |
| `GET` | `/api/wallet/mapping/{address}` | Get address mapping |

---

## 🎨 Frontend Integration Examples

### **Strategy Selector Component**

```javascript
class StrategySelector {
  constructor(walletManager) {
    this.walletManager = walletManager;
    this.strategies = [];
  }

  async loadStrategies() {
    const response = await fetch('http://localhost:3000/api/strategies');
    const data = await response.json();
    this.strategies = data.data;
    this.renderStrategies();
  }

  renderStrategies() {
    const strategyList = document.getElementById('strategy-list');
    strategyList.innerHTML = this.strategies.map(strategy => `
      <div class="strategy-card ${strategy.id === 'fafnir-treasure-hoarder' ? 'featured' : ''}">
        <h3>${strategy.id === 'fafnir-treasure-hoarder' ? '🏴‍☠️ ' : ''}${strategy.name}</h3>
        <p class="description">${strategy.description}</p>
        <div class="risk-level">Risk: ${strategy.riskLevel}</div>
        <button onclick="selectStrategy('${strategy.id}')"
                class="btn ${strategy.id === 'fafnir-treasure-hoarder' ? 'btn-featured' : 'btn-primary'}">
          ${strategy.id === 'fafnir-treasure-hoarder' ? '⚡ Try New Strategy!' : 'Select'}
        </button>
      </div>
    `).join('');
  }
}

async function selectStrategy(strategyId) {
  if (!walletManager.isConnected()) {
    alert('Please connect your wallet first');
    return;
  }

  // Special handling for Fafnir Treasure Hoarder
  const config = strategyId === 'fafnir-treasure-hoarder' ? {
    minConfidence: 0.7,
    maxRiskPerTrade: 0.02,
    riskLevel: "moderate"
  } : {};

  try {
    const response = await fetch('http://localhost:3000/api/strategies/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        walletAddress: walletManager.walletAddress,
        strategy: strategyId,
        config
      })
    });

    const result = await response.json();
    if (result.success) {
      showSuccess(`Strategy "${strategyId}" assigned successfully!`);
      updateStrategyStatus();
    }
  } catch (error) {
    showError('Failed to assign strategy: ' + error.message);
  }
}
```

### **Performance Dashboard Component**

```javascript
class PerformanceDashboard {
  constructor(walletAddress) {
    this.walletAddress = walletAddress;
    this.setupWebSocket();
  }

  async loadPerformance() {
    const response = await fetch(`http://localhost:3000/api/performance/${this.walletAddress}`, {
      credentials: 'include'
    });
    const data = await response.json();
    this.renderPerformance(data.data);
  }

  renderPerformance(performance) {
    document.getElementById('performance-dashboard').innerHTML = `
      <div class="performance-grid">
        <div class="metric-card">
          <h4>Total Trades</h4>
          <span class="metric-value">${performance.totalTrades}</span>
        </div>
        <div class="metric-card">
          <h4>Win Rate</h4>
          <span class="metric-value">${(performance.winRate * 100).toFixed(1)}%</span>
        </div>
        <div class="metric-card">
          <h4>Total Profit</h4>
          <span class="metric-value ${performance.totalProfit >= 0 ? 'positive' : 'negative'}">
            ${performance.totalProfit >= 0 ? '+' : ''}$${performance.totalProfit.toFixed(2)}
          </span>
        </div>
        <div class="metric-card">
          <h4>Strategy</h4>
          <span class="metric-value">
            ${performance.activeStrategy === 'fafnir-treasure-hoarder' ? '🏴‍☠️ ' : ''}
            ${performance.activeStrategy || 'None'}
          </span>
        </div>
      </div>
    `;
  }

  setupWebSocket() {
    this.ws = new WebSocket('ws://localhost:3000');
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'performance_update' && data.walletAddress === this.walletAddress) {
        this.renderPerformance(data.performance);
      }
    };
  }
}
```

---

## 🛡️ Security & Best Practices

### **1. CORS Configuration**
✅ **Currently Whitelisted Origins:**
- `https://yuphix.io`
- `http://localhost:3001` (your dashboard)
- `http://localhost:3000`
- `http://127.0.0.1:3001`

### **2. API Authentication**
```javascript
// Include credentials for authenticated requests
fetch(apiUrl, {
  credentials: 'include',  // Important for session management
  headers: {
    'Content-Type': 'application/json'
  }
});
```

### **3. Error Handling**
```javascript
async function safeApiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...options
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} - ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    showError('Connection failed. Please check if the API server is running.');
    throw error;
  }
}
```

---

## 🎯 Quick Integration Checklist

- [x] **API Server Running** - `http://localhost:3000` ✅
- [x] **CORS Working** - `localhost:3001` whitelisted ✅
- [x] **Multi-User Support** - Active with 6 strategies ✅
- [x] **Fafnir Treasure Hoarder** - Available and ready ✅
- [ ] **Frontend Updated** - Update strategy list to include new strategy
- [ ] **WebSocket Integration** - Add real-time updates
- [ ] **Error Handling** - Implement proper error handling
- [ ] **Strategy Configuration** - Add Treasure Hoarder specific configs

---

## 🚀 Next Steps

1. **Update Frontend Strategy List**: Add Fafnir Treasure Hoarder to your strategy selector
2. **Test CORS**: Run `fetch('http://localhost:3000/api/cors-test')` from your dashboard
3. **Implement WebSocket**: Add real-time updates for better UX
4. **Add Strategy Configs**: Include Treasure Hoarder specific configuration options
5. **Performance Tracking**: Display strategy-specific metrics

---

## 🔧 Troubleshooting

### **CORS Issues**
```javascript
// Test CORS connectivity
fetch('http://localhost:3000/api/cors-test')
  .then(response => response.json())
  .then(data => console.log('CORS Test:', data))
  .catch(error => console.error('CORS Error:', error));
```

### **Strategy Assignment Fails**
- Ensure wallet is connected
- Check if strategy ID is correct: `fafnir-treasure-hoarder`
- Verify API server is running
- Check browser console for errors

### **WebSocket Connection Issues**
- Verify WebSocket URL: `ws://localhost:3000`
- Check browser developer tools for WebSocket connection
- Ensure API server WebSocket support is enabled

---

**🎉 Your multi-user Fafnir Bot API is ready for production with the new Treasure Hoarder strategy!**
