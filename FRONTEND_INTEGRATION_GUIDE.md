# 🚀 **Fafnir Bot Frontend Integration Guide**

## 📋 **Complete API Reference & Multi-User Implementation**

This guide covers **everything** your frontend needs to integrate with the Fafnir Bot backend, including the new multi-user/wallet system and Oracle functionality.

---

## 🏗️ **Architecture Overview**

### **Backend Components**
- **Multi-User Strategy Manager** - Handles multiple concurrent users
- **Multi-Wallet Manager** - Manages wallet connections and permissions
- **Oracle System** - Story generation and mystical experience
- **Enhanced API Server** - RESTful API + WebSocket real-time updates

### **Frontend Requirements**
- **Wallet Connection** - MetaMask + Gala Wallet support
- **Multi-User Dashboard** - Handle multiple connected wallets
- **Real-time Updates** - WebSocket integration
- **Oracle Interface** - Mystical story and countdown displays

---

## 🔌 **1. WALLET CONNECTION & AUTHENTICATION**

### **Connect Wallet**
```javascript
// Connect user's wallet to the bot
POST /api/wallet/connect
Content-Type: application/json

{
  "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
  "walletType": "metamask" | "galachain",
  "signature": "0x...", // Optional wallet signature
  "chainId": 1 // Ethereum mainnet
}

// Response
{
  "success": true,
  "data": {
    "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
    "sessionId": "session_abc123",
    "sessionExpiry": "2024-01-15T10:30:00Z",
    "isNewUser": true
  },
  "timestamp": "2024-01-14T10:30:00Z",
  "version": "1.0.0"
}
```

### **Cross-Chain Address Mapping**
```javascript
// Map MetaMask address to GalaChain address
POST /api/wallet/map-address
Content-Type: application/json

{
  "ethereumAddress": "0x978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
  "galachainAddress": "client|abc123def456...",
  "signature": "0x..." // MetaMask signature proving ownership
}

// Get existing mapping
GET /api/wallet/mapping/0x978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9

// Response
{
  "success": true,
  "data": {
    "ethereumAddress": "0x978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
    "galachainAddress": "client|abc123def456...",
    "mappingDate": "2024-01-14T10:30:00Z",
    "isVerified": true
  }
}
```

### **Trading Permissions**
```javascript
// Request trading permissions from user
POST /api/wallet/permissions
Content-Type: application/json

{
  "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
  "permissions": [
    {
      "strategy": "fafnir-treasure-hoarder",
      "maxTradeAmount": 100,
      "allowedPairs": ["GALA/USDC", "ETH/USDC"],
      "expiryHours": 24
    }
  ]
}

// Response
{
  "success": true,
  "data": {
    "permissionId": "perm_xyz789",
    "requiresSignature": true,
    "signatureMessage": "Approve trading permissions for Fafnir Bot..."
  }
}
```

### **Check Wallet Balances**
```javascript
// Get wallet token balances
GET /api/wallet/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9/balances

// Response
{
  "success": true,
  "data": {
    "balances": [
      {
        "tokenClass": "GUSDC",
        "quantity": "50.00",
        "symbol": "GUSDC",
        "name": "Gala USD Coin"
      },
      {
        "tokenClass": "GALA",
        "quantity": "1250.75",
        "symbol": "GALA",
        "name": "Gala"
      }
    ],
    "lastUpdated": "2024-01-14T10:30:00Z"
  }
}
```

---

## 🤖 **2. MULTI-USER STRATEGY MANAGEMENT**

### **Available Strategies**
```javascript
// Get all available strategies
GET /api/strategies

// Response
{
  "success": true,
  "data": {
    "strategies": [
      {
        "id": "fafnir-treasure-hoarder",
        "name": "Fafnir Treasure Hoarder",
        "description": "RSI + Bollinger Bands layered strategy",
        "riskLevel": "medium",
        "minBalance": 10,
        "supportedPairs": ["GALA/USDC", "ETH/USDC", "BTC/USDC"],
        "isActive": true
      },
      {
        "id": "triangular-arbitrage",
        "name": "Triangular Arbitrage",
        "description": "Multi-hop arbitrage opportunities",
        "riskLevel": "low",
        "minBalance": 50,
        "supportedPairs": ["GALA/USDC", "ETH/GALA", "ETH/USDC"],
        "isActive": true
      }
    ]
  }
}
```

### **Assign Strategy to Wallet**
```javascript
// Assign a strategy to a specific wallet
POST /api/strategies/assign
Content-Type: application/json

{
  "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
  "strategyId": "fafnir-treasure-hoarder",
  "config": {
    "tradingPairs": ["GALA/USDC"],
    "maxTradeAmount": 25,
    "riskLevel": "medium",
    "autoStart": true
  }
}

// Response
{
  "success": true,
  "data": {
    "assignmentId": "assign_abc123",
    "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
    "strategyId": "fafnir-treasure-hoarder",
    "status": "assigned",
    "message": "Strategy assigned successfully. Ready to start trading."
  }
}
```

### **Control Wallet's Strategy**
```javascript
// Start/Stop/Pause strategy for specific wallet
POST /api/strategies/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9/control
Content-Type: application/json

{
  "action": "start" | "stop" | "pause" | "resume",
  "reason": "User initiated" // Optional
}

// Response
{
  "success": true,
  "data": {
    "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
    "strategyId": "fafnir-treasure-hoarder",
    "previousStatus": "paused",
    "newStatus": "running",
    "timestamp": "2024-01-14T10:30:00Z"
  }
}
```

### **Get Wallet Strategy Status**
```javascript
// Get current strategy status for wallet
GET /api/strategies/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9/status

// Response
{
  "success": true,
  "data": {
    "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
    "strategyId": "fafnir-treasure-hoarder",
    "status": "running",
    "uptime": "02:45:30",
    "lastTradeTime": "2024-01-14T09:15:00Z",
    "totalTrades": 7,
    "currentBalance": "52.45 GUSDC",
    "unrealizedPnL": "+2.45 GUSDC",
    "config": {
      "tradingPairs": ["GALA/USDC"],
      "maxTradeAmount": 25,
      "riskLevel": "medium"
    }
  }
}
```

### **Update Strategy Configuration**
```javascript
// Update strategy config for specific wallet
PUT /api/strategies/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9/config
Content-Type: application/json

{
  "maxTradeAmount": 50,
  "riskLevel": "high",
  "tradingPairs": ["GALA/USDC", "ETH/USDC"]
}

// Response
{
  "success": true,
  "data": {
    "message": "Strategy configuration updated",
    "restartRequired": false,
    "newConfig": {
      "maxTradeAmount": 50,
      "riskLevel": "high",
      "tradingPairs": ["GALA/USDC", "ETH/USDC"]
    }
  }
}
```

---

## 📊 **3. PERFORMANCE & TRADING DATA**

### **Wallet Performance**
```javascript
// Get performance metrics for specific wallet
GET /api/performance/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9

// Response
{
  "success": true,
  "data": {
    "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
    "timeframe": "24h",
    "totalTrades": 12,
    "successfulTrades": 9,
    "winRate": 75.0,
    "totalVolume": "245.50 GUSDC",
    "realizedPnL": "+8.75 GUSDC",
    "unrealizedPnL": "+2.30 GUSDC",
    "maxDrawdown": "-1.20 GUSDC",
    "sharpeRatio": 1.85,
    "averageTradeSize": "20.46 GUSDC",
    "bestTrade": "+3.45 GUSDC",
    "worstTrade": "-0.85 GUSDC"
  }
}
```

### **Wallet Trade History**
```javascript
// Get trade history for specific wallet
GET /api/trades/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9?limit=20&offset=0

// Response
{
  "success": true,
  "data": {
    "trades": [
      {
        "tradeId": "trade_abc123",
        "timestamp": "2024-01-14T09:15:00Z",
        "strategy": "fafnir-treasure-hoarder",
        "pair": "GALA/USDC",
        "side": "buy",
        "amount": "25.00 GUSDC",
        "price": "0.02345",
        "received": "1065.45 GALA",
        "fees": "0.05 GUSDC",
        "pnl": "+1.25 GUSDC",
        "txHash": "0xabc123...",
        "status": "completed"
      }
    ],
    "pagination": {
      "total": 45,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

### **Enhanced Transaction Details**
```javascript
// Get detailed transaction data for content generation
GET /api/transactions/detailed?walletAddress=eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9&limit=10

// Response
{
  "success": true,
  "data": {
    "transactions": [
      {
        "transactionId": "tx_abc123",
        "timestamp": "2024-01-14T09:15:00Z",
        "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
        "strategy": "fafnir-treasure-hoarder",
        "
        "narrative": {
          "tradeType": "momentum_buy",
          "confidence": 0.85,
          "marketConditions": {
            "volatility": "medium",
            "trend": "bullish",
            "timeOfDay": "morning_session"
          },
          "positionMetrics": {
            "entryPrice": "0.02345",
            "currentPrice": "0.02398",
            "unrealizedPnL": "+1.25 GUSDC",
            "positionSize": "1065.45 GALA"
          },
          "storyElements": {
            "questType": "treasure_hunt",
            "treasureClass": "mystical_coin",
            "battleOutcome": "victory",
            "heroicMoment": "perfect_timing",
            "legendaryStatus": false
          }
        }
      }
    ]
  }
}
```

---

## 🔮 **4. ORACLE SYSTEM INTEGRATION**

### **Global Oracle Status**
```javascript
// Get global Oracle status (shared by all users)
GET /api/oracle/status

// Response
{
  "success": true,
  "data": {
    "isTransmitting": false,
    "nextTransmissionTime": "2024-01-14T12:30:00Z",
    "crystalCharge": 68,
    "currentStatus": "charging",
    "lastTransmissionTime": "2024-01-14T10:30:00Z",
    "transmissionCount": 15,
    "flavorText": "The crystal pulses with ethereal energy...",
    "signalStrength": 89,
    "timeRemaining": 7200000, // milliseconds
    "formattedCountdown": "02:00:00"
  }
}
```

### **Global Oracle Terminal Display**
```javascript
// Get ASCII terminal display for global Oracle
GET /api/oracle/terminal

// Response
{
  "success": true,
  "data": {
    "terminal": `═══════════════════════════════════════════════
ORACLE TRANSMISSION TERMINAL v0.99β
═══════════════════════════════════════════════

Next Chronicle: 02:00:00

Crystal Charge: [████████████░░░░░░░░] 68%

Status: CHARGING
Signal: 89%

> The crystal pulses with ethereal energy...
> _
═══════════════════════════════════════════════`
  }
}
```

### **Wallet-Specific Oracle**
```javascript
// Get Oracle status for specific wallet
GET /api/oracle/wallet/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9/status

// Response
{
  "success": true,
  "data": {
    "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
    "personalCrystalCharge": 75,
    "lastPersonalTransmission": "2024-01-14T08:30:00Z",
    "nextPersonalTransmission": "2024-01-14T12:30:00Z",
    "personalTransmissionCount": 3,
    "isSubscribedToGlobal": true,
    "personalPreferences": {
      "frequency": "sync_global"
    },
    "timeRemaining": 7200000,
    "formattedCountdown": "02:00:00"
  }
}
```

### **Wallet Oracle Terminal**
```javascript
// Get terminal display for wallet's Oracle (personal or global view)
GET /api/oracle/wallet/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9/terminal

// Response (if subscribed to global)
{
  "success": true,
  "data": {
    "terminal": `═══════════════════════════════════════════════
     ORACLE TRANSMISSION TERMINAL v0.99β
        🔮 MAIN CHAMBER - GLOBAL ORACLE 🔮
═══════════════════════════════════════════════

Dragon: eth|978BB9ec... (Connected)
Next Chronicle: 02:00:00

Crystal Charge: [████████████░░░░░░░░] 68%

Status: CHARGING
Signal: 89%
Personal Chronicles: 3

> The crystal pulses with ethereal energy...
> _
═══════════════════════════════════════════════`
  }
}
```

### **Update Oracle Preferences**
```javascript
// Update Oracle preferences for wallet
PUT /api/oracle/wallet/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9/preferences
Content-Type: application/json

{
  "frequency": "every_2h" | "every_4h" | "sync_global" | "custom",
  "customInterval": 3600000 // Only if frequency is "custom" (in milliseconds)
}

// Response
{
  "success": true,
  "data": {
    "message": "Oracle preferences updated",
    "newPreferences": {
      "frequency": "every_2h"
    },
    "nextTransmission": "2024-01-14T11:30:00Z"
  }
}
```

### **All Connected Wallet Oracles**
```javascript
// Get Oracle status for all connected wallets (admin view)
GET /api/oracle/wallets/all

// Response
{
  "success": true,
  "data": {
    "walletOracles": [
      {
        "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
        "personalCrystalCharge": 75,
        "isSubscribedToGlobal": true,
        "personalTransmissionCount": 3,
        "timeRemaining": 7200000
      },
      {
        "walletAddress": "eth|456AB7cd2EF123GHij9k8L7MnO6pQ5rS4tU3vW2x",
        "personalCrystalCharge": 45,
        "isSubscribedToGlobal": false,
        "personalTransmissionCount": 7,
        "timeRemaining": 4500000
      }
    ]
  }
}
```

---

## 📚 **5. STORY GENERATION**

### **Get Wallet Stories**
```javascript
// Get generated stories for specific wallet
GET /api/stories/wallet/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9?limit=5

// Response
{
  "success": true,
  "data": {
    "stories": [
      {
        "id": "story_abc123",
        "timestamp": "2024-01-14T10:30:00Z",
        "questTitle": "Chapter VII: The Silicon Peaks Arbitrage",
        "chronicleEntry": "In the mystical realm of GalaSwap, the great dragon Fafnir sensed a disturbance in the market forces...",
        "lootReport": {
          "goldGained": "+2.45 GUSDC",
          "experiencePoints": "+150 XP",
          "itemsFound": ["Scroll of RSI Wisdom", "Minor Slippage Potion"]
        },
        "gameTip": "TIP: Remember to save your game before attempting high-risk trades!",
        "partyMorale": "Heroic",
        "achievementUnlocked": "First Critical Trade!"
      }
    ],
    "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9"
  }
}
```

### **Update Story Preferences**
```javascript
// Update story generation preferences for wallet
POST /api/stories/wallet/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9/preferences
Content-Type: application/json

{
  "storyStyle": "epic" | "casual" | "technical",
  "frequency": "high" | "medium" | "low",
  "includeMarketData": true,
  "personalityTrait": "bold" | "cautious" | "analytical"
}

// Response
{
  "success": true,
  "data": {
    "message": "Story preferences updated",
    "preferences": {
      "storyStyle": "epic",
      "frequency": "medium",
      "includeMarketData": true,
      "personalityTrait": "bold"
    }
  }
}
```

### **Force Generate Story**
```javascript
// Manually trigger story generation for wallet
POST /api/stories/wallet/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9/generate
Content-Type: application/json

{
  "storyType": "trading_session" | "idle_period" | "achievement"
}

// Response
{
  "success": true,
  "data": {
    "story": {
      "id": "story_xyz789",
      "questTitle": "Chapter VIII: The Emergency Quest",
      "chronicleEntry": "Summoned by ancient magic, Fafnir awakens to face an unexpected challenge...",
      "lootReport": {
        "goldGained": "0 GUSDC",
        "experiencePoints": "+50 XP",
        "itemsFound": ["Scroll of Patience"]
      }
    },
    "message": "Story generated successfully"
  }
}
```

---

## 🌐 **6. WEBSOCKET REAL-TIME UPDATES**

### **Connection Setup**
```javascript
// Connect to WebSocket for real-time updates
const ws = new WebSocket('ws://localhost:3000');

ws.onopen = () => {
  console.log('Connected to Fafnir Bot WebSocket');

  // Subscribe to specific wallet updates
  ws.send(JSON.stringify({
    type: 'subscribe',
    walletAddress: 'eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9'
  }));
};
```

### **Message Types**

#### **Strategy Updates**
```javascript
{
  "type": "strategy_update",
  "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
  "data": {
    "strategyId": "fafnir-treasure-hoarder",
    "status": "running",
    "lastTradeTime": "2024-01-14T10:30:00Z",
    "currentBalance": "52.45 GUSDC",
    "unrealizedPnL": "+2.45 GUSDC"
  },
  "timestamp": "2024-01-14T10:30:00Z"
}
```

#### **Trade Notifications**
```javascript
{
  "type": "trade_executed",
  "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
  "data": {
    "tradeId": "trade_abc123",
    "pair": "GALA/USDC",
    "side": "buy",
    "amount": "25.00 GUSDC",
    "price": "0.02345",
    "pnl": "+1.25 GUSDC",
    "status": "completed"
  },
  "timestamp": "2024-01-14T10:30:00Z"
}
```

#### **Oracle Updates**
```javascript
// Global Oracle update
{
  "type": "oracle_update",
  "data": {
    "crystalCharge": 68,
    "currentStatus": "charging",
    "flavorText": "The crystal pulses with ethereal energy...",
    "timeRemaining": 7200000,
    "formattedCountdown": "02:00:00"
  },
  "timestamp": "2024-01-14T10:30:00Z"
}

// Wallet-specific Oracle update
{
  "type": "wallet_oracle_update",
  "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
  "data": {
    "personalCrystalCharge": 75,
    "isSubscribedToGlobal": false,
    "timeRemaining": 4500000,
    "formattedCountdown": "01:15:00"
  },
  "timestamp": "2024-01-14T10:30:00Z"
}
```

#### **Story Generation Complete**
```javascript
{
  "type": "story_generated",
  "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
  "data": {
    "storyId": "story_abc123",
    "questTitle": "Chapter IX: The Midnight Revelation",
    "chronicleEntry": "As the market slumbered, Fafnir discovered ancient secrets...",
    "transmissionType": "oracle_transmission"
  },
  "timestamp": "2024-01-14T10:30:00Z"
}
```

---

## 💻 **7. FRONTEND IMPLEMENTATION EXAMPLES**

### **Multi-Wallet Dashboard Component**
```javascript
class MultiWalletDashboard {
  constructor() {
    this.connectedWallets = new Map();
    this.ws = null;
    this.setupWebSocket();
  }

  async connectWallet(walletAddress, walletType = 'metamask') {
    try {
      // Connect wallet to backend
      const response = await fetch('/api/wallet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, walletType })
      });

      const result = await response.json();

      if (result.success) {
        // Add to connected wallets
        this.connectedWallets.set(walletAddress, {
          ...result.data,
          status: 'connected'
        });

        // Get initial strategy status
        await this.loadWalletStrategy(walletAddress);

        // Get Oracle status
        await this.loadWalletOracle(walletAddress);

        // Subscribe to updates
        this.subscribeToWalletUpdates(walletAddress);

        return result.data;
      }
    } catch (error) {
      console.error('Wallet connection failed:', error);
      throw error;
    }
  }

  async loadWalletStrategy(walletAddress) {
    try {
      const response = await fetch(`/api/strategies/${walletAddress}/status`);
      const result = await response.json();

      if (result.success) {
        const wallet = this.connectedWallets.get(walletAddress);
        wallet.strategy = result.data;
        this.updateWalletDisplay(walletAddress);
      }
    } catch (error) {
      console.error('Failed to load wallet strategy:', error);
    }
  }

  async loadWalletOracle(walletAddress) {
    try {
      const response = await fetch(`/api/oracle/wallet/${walletAddress}/status`);
      const result = await response.json();

      if (result.success) {
        const wallet = this.connectedWallets.get(walletAddress);
        wallet.oracle = result.data;
        this.updateOracleDisplay(walletAddress);
      }
    } catch (error) {
      console.error('Failed to load wallet Oracle:', error);
    }
  }

  setupWebSocket() {
    this.ws = new WebSocket('ws://localhost:3000');

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleWebSocketMessage(message);
    };
  }

  handleWebSocketMessage(message) {
    switch (message.type) {
      case 'strategy_update':
        this.handleStrategyUpdate(message);
        break;
      case 'trade_executed':
        this.handleTradeNotification(message);
        break;
      case 'oracle_update':
        this.handleGlobalOracleUpdate(message);
        break;
      case 'wallet_oracle_update':
        this.handleWalletOracleUpdate(message);
        break;
      case 'story_generated':
        this.handleStoryGenerated(message);
        break;
    }
  }

  async assignStrategy(walletAddress, strategyId, config) {
    try {
      const response = await fetch('/api/strategies/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          strategyId,
          config
        })
      });

      const result = await response.json();

      if (result.success) {
        // Reload strategy status
        await this.loadWalletStrategy(walletAddress);
        return result.data;
      }
    } catch (error) {
      console.error('Strategy assignment failed:', error);
      throw error;
    }
  }

  async controlStrategy(walletAddress, action) {
    try {
      const response = await fetch(`/api/strategies/${walletAddress}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });

      const result = await response.json();

      if (result.success) {
        // Update local state
        const wallet = this.connectedWallets.get(walletAddress);
        if (wallet.strategy) {
          wallet.strategy.status = result.data.newStatus;
          this.updateWalletDisplay(walletAddress);
        }
        return result.data;
      }
    } catch (error) {
      console.error('Strategy control failed:', error);
      throw error;
    }
  }
}
```

### **Oracle Interface Component**
```javascript
class OracleInterface {
  constructor(walletAddress) {
    this.walletAddress = walletAddress;
    this.oracleState = null;
    this.countdownInterval = null;
    this.setupOracle();
  }

  async setupOracle() {
    // Load initial Oracle state
    await this.loadOracleState();

    // Start countdown timer
    this.startCountdown();

    // Setup WebSocket listener
    this.setupWebSocketListener();
  }

  async loadOracleState() {
    try {
      const response = await fetch(`/api/oracle/wallet/${this.walletAddress}/status`);
      const result = await response.json();

      if (result.success) {
        this.oracleState = result.data;
        this.updateDisplay();
      }
    } catch (error) {
      console.error('Failed to load Oracle state:', error);
    }
  }

  async loadTerminalDisplay() {
    try {
      const response = await fetch(`/api/oracle/wallet/${this.walletAddress}/terminal`);
      const result = await response.json();

      if (result.success) {
        document.getElementById('oracle-terminal').textContent = result.data.terminal;
      }
    } catch (error) {
      console.error('Failed to load terminal display:', error);
    }
  }

  async updateOraclePreferences(preferences) {
    try {
      const response = await fetch(`/api/oracle/wallet/${this.walletAddress}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences)
      });

      const result = await response.json();

      if (result.success) {
        // Reload Oracle state
        await this.loadOracleState();
        return result.data;
      }
    } catch (error) {
      console.error('Failed to update Oracle preferences:', error);
      throw error;
    }
  }

  startCountdown() {
    this.countdownInterval = setInterval(() => {
      if (this.oracleState) {
        const now = Date.now();
        const nextTransmission = new Date(this.oracleState.nextPersonalTransmission).getTime();
        const timeRemaining = Math.max(0, nextTransmission - now);

        this.oracleState.timeRemaining = timeRemaining;
        this.oracleState.formattedCountdown = this.formatCountdown(timeRemaining);

        this.updateCountdownDisplay();

        // Update crystal charge based on time
        this.updateCrystalCharge();
      }
    }, 1000);
  }

  formatCountdown(milliseconds) {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  updateCrystalCharge() {
    if (this.oracleState.isSubscribedToGlobal) {
      // Use global Oracle charge
      // This would be updated via WebSocket
    } else {
      // Calculate personal crystal charge
      const totalInterval = 2 * 60 * 60 * 1000; // 2 hours in ms
      const elapsed = totalInterval - this.oracleState.timeRemaining;
      this.oracleState.personalCrystalCharge = Math.max(0, Math.min(100, (elapsed / totalInterval) * 100));
    }
  }

  setupWebSocketListener() {
    // This would be integrated with the main WebSocket connection
    // Listen for oracle_update and wallet_oracle_update messages
  }
}
```

### **Story Display Component**
```javascript
class StoryDisplay {
  constructor(walletAddress) {
    this.walletAddress = walletAddress;
    this.stories = [];
    this.loadStories();
  }

  async loadStories(limit = 10) {
    try {
      const response = await fetch(`/api/stories/wallet/${this.walletAddress}?limit=${limit}`);
      const result = await response.json();

      if (result.success) {
        this.stories = result.data.stories;
        this.renderStories();
      }
    } catch (error) {
      console.error('Failed to load stories:', error);
    }
  }

  renderStories() {
    const container = document.getElementById('stories-container');
    container.innerHTML = '';

    this.stories.forEach(story => {
      const storyElement = this.createStoryElement(story);
      container.appendChild(storyElement);
    });
  }

  createStoryElement(story) {
    const element = document.createElement('div');
    element.className = 'story-card';
    element.innerHTML = `
      <div class="story-header">
        <h3>${story.questTitle}</h3>
        <span class="story-timestamp">${new Date(story.timestamp).toLocaleString()}</span>
      </div>
      <div class="story-content">
        <p>${story.chronicleEntry}</p>
      </div>
      <div class="story-loot">
        <h4>Loot Report:</h4>
        <ul>
          <li>Gold: ${story.lootReport.goldGained}</li>
          <li>XP: ${story.lootReport.experiencePoints}</li>
          <li>Items: ${story.lootReport.itemsFound.join(', ')}</li>
        </ul>
      </div>
      <div class="story-footer">
        <div class="game-tip">${story.gameTip}</div>
        <div class="party-morale">Morale: ${story.partyMorale}</div>
        ${story.achievementUnlocked ? `<div class="achievement">🏆 ${story.achievementUnlocked}</div>` : ''}
      </div>
    `;
    return element;
  }

  async updateStoryPreferences(preferences) {
    try {
      const response = await fetch(`/api/stories/wallet/${this.walletAddress}/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences)
      });

      const result = await response.json();

      if (result.success) {
        console.log('Story preferences updated');
        return result.data;
      }
    } catch (error) {
      console.error('Failed to update story preferences:', error);
      throw error;
    }
  }
}
```

---

## 🚀 **8. GETTING STARTED**

### **Backend Setup**
```bash
# Start the enhanced API server with multi-user support
npm run start:api

# The server will be available at:
# HTTP API: http://localhost:3000
# WebSocket: ws://localhost:3000
```

### **Frontend Integration Checklist**

#### **✅ Wallet Connection**
- [ ] Implement MetaMask connection
- [ ] Implement Gala Wallet connection
- [ ] Handle cross-chain address mapping
- [ ] Request and manage trading permissions
- [ ] Display wallet balances

#### **✅ Multi-User Strategy Management**
- [ ] Display available strategies
- [ ] Allow strategy assignment per wallet
- [ ] Implement strategy controls (start/stop/pause)
- [ ] Show real-time strategy status
- [ ] Handle strategy configuration updates

#### **✅ Oracle System**
- [ ] Display global Oracle countdown
- [ ] Show wallet-specific Oracle status
- [ ] Implement Oracle preference controls
- [ ] Render ASCII terminal displays
- [ ] Handle Oracle mode switching (global/personal)

#### **✅ Real-time Updates**
- [ ] Establish WebSocket connection
- [ ] Handle strategy update messages
- [ ] Process trade notifications
- [ ] Update Oracle displays in real-time
- [ ] Show story generation notifications

#### **✅ Story Integration**
- [ ] Display generated stories
- [ ] Implement story preferences
- [ ] Handle manual story generation
- [ ] Show story notifications
- [ ] Create immersive story UI

### **Error Handling**
```javascript
// Standard error response format
{
  "success": false,
  "error": {
    "code": "WALLET_NOT_CONNECTED",
    "message": "Wallet must be connected before assigning strategies",
    "details": {
      "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
      "requiredAction": "connect_wallet"
    }
  },
  "timestamp": "2024-01-14T10:30:00Z",
  "version": "1.0.0"
}
```

### **Rate Limits**
- **API Calls**: 100 requests per minute per IP
- **WebSocket Messages**: 50 messages per minute per connection
- **Story Generation**: 5 manual generations per hour per wallet

---

## 🎯 **Summary**

Your frontend now has access to a **complete multi-user trading bot system** with:

✅ **Multi-Wallet Support** - Handle unlimited connected wallets
✅ **Strategy Management** - Assign and control strategies per wallet
✅ **Oracle System** - Mystical story generation with personal/global modes
✅ **Real-time Updates** - WebSocket integration for live data
✅ **Enhanced Trading Data** - Rich transaction details for content generation
✅ **Story Integration** - 90s RPG-themed chronicles for each wallet

The backend is **fully operational** and ready for frontend integration. Each wallet gets its own isolated trading experience while sharing the mystical Oracle community! 🔮⚡🐉
