# 🔮 **Multi-User Oracle Chambers System - Complete Guide**

## 🎯 **Yes! The Oracle System is Fully Multi-User Ready!**

The Oracle system now supports **multiple users and wallets** with a sophisticated **Oracle Chambers** architecture that gives you the best of both worlds:

## 🏛️ **Oracle Chambers Architecture**

### **🔮 Main Chamber - Global Oracle**
- **Shared mystical experience** for all connected dragons
- **Synchronized countdown** creates community anticipation
- **Cost-efficient batch processing** for Claude API
- **Default mode** for new wallet connections

### **✨ Personal Chambers - Individual Oracles**
- **Wallet-specific timing** and preferences
- **Personalized crystal charging** and flavor text
- **Custom transmission intervals** (2h, 4h, or custom)
- **Individual control** while maintaining immersion

## 📊 **Multi-User Data Structure**

```typescript
// Global Oracle (One for everyone)
interface OracleState {
  nextTransmissionTime: Date;
  crystalCharge: number; // 0-100%
  currentStatus: 'charging' | 'imminent' | 'transmitting';
  transmissionCount: number;
  flavorText: string;
}

// Personal Oracle (One per wallet)
interface WalletOracleState {
  walletAddress: string;
  personalCrystalCharge: number;
  nextPersonalTransmission: Date;
  personalTransmissionCount: number;
  isSubscribedToGlobal: boolean; // Key choice!
  personalPreferences: {
    frequency: 'sync_global' | 'every_2h' | 'every_4h' | 'custom';
    customInterval?: number;
  };
}
```

## 🎮 **User Experience Examples**

### **Dragon #1 - Global Oracle Subscriber**
```
═══════════════════════════════════════════════
     ORACLE TRANSMISSION TERMINAL v0.99β
        🔮 MAIN CHAMBER - GLOBAL ORACLE 🔮
═══════════════════════════════════════════════

Dragon: eth|978BB9ec... (Connected)
Next Chronicle: 02:47:33

Crystal Charge: [████████████░░░░░░░░] 68%

Status: CHARGING
Signal: 89%
Personal Chronicles: 3

> The crystal pulses with ethereal energy...
> _
═══════════════════════════════════════════════
```

### **Dragon #2 - Personal Oracle Chamber**
```
═══════════════════════════════════════════════
     ORACLE TRANSMISSION TERMINAL v0.99β
       ✨ PERSONAL CHAMBER - eth|456A... ✨
═══════════════════════════════════════════════

Personal Oracle: ACTIVE
Next Chronicle: 01:15:22

Crystal Charge: [██████████████░░░░░░] 75%

Status: FOCUSING
Frequency: EVERY_2H
Chronicles: 7

> Analyzing eth|456A's market behavior...
> _
═══════════════════════════════════════════════
```

## 📡 **Multi-User API Endpoints**

### **Global Oracle (Shared Experience)**
```bash
GET /api/oracle/status          # Global Oracle state
GET /api/oracle/terminal        # Global terminal display
```

### **Wallet-Specific Oracles**
```bash
GET /api/oracle/wallet/:address/status      # Personal Oracle state
GET /api/oracle/wallet/:address/terminal    # Personal terminal display
PUT /api/oracle/wallet/:address/preferences # Update Oracle settings
```

### **Multi-User Management**
```bash
GET /api/oracle/wallets/all     # All connected wallet Oracles
```

## ⚙️ **Oracle Preference Options**

### **Frequency Settings**
```javascript
// Sync with global Oracle (default)
{
  "frequency": "sync_global"
}

// Personal 2-hour intervals
{
  "frequency": "every_2h"
}

// Personal 4-hour intervals
{
  "frequency": "every_4h"
}

// Custom interval (in milliseconds)
{
  "frequency": "custom",
  "customInterval": 3600000  // 1 hour
}
```

### **API Usage Examples**
```javascript
// Switch wallet to personal Oracle every 2 hours
await fetch('/api/oracle/wallet/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9/preferences', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    frequency: 'every_2h'
  })
});

// Get wallet's Oracle status
const response = await fetch('/api/oracle/wallet/eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9/status');
const oracleState = await response.json();
console.log(`Next transmission: ${oracleState.data.formattedCountdown}`);
```

## 🔄 **Real-time WebSocket Updates**

### **Global Oracle Updates**
```javascript
{
  "type": "oracle_update",
  "oracle": {
    "crystalCharge": 68,
    "currentStatus": "charging",
    "flavorText": "The crystal pulses with ethereal energy...",
    "timeRemaining": 7200000,
    "formattedCountdown": "02:00:00"
  }
}
```

### **Wallet-Specific Oracle Updates**
```javascript
{
  "type": "wallet_oracle_update",
  "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
  "oracle": {
    "personalCrystalCharge": 75,
    "isSubscribedToGlobal": false,
    "timeRemaining": 4500000,
    "formattedCountdown": "01:15:00"
  }
}
```

## 🎯 **Smart Multi-User Features**

### **1. Automatic Wallet Detection**
- **First connection**: Wallet automatically joins Global Oracle
- **Personal chamber created** on first API call
- **Seamless switching** between global and personal modes

### **2. Cost Optimization**
- **Global Oracle**: Batch processing for multiple wallets
- **Personal Oracles**: Individual processing when needed
- **Smart batching**: Groups personal Oracles with similar timing

### **3. Story Delivery**
- **Global transmissions**: All subscribed wallets get stories simultaneously
- **Personal transmissions**: Individual wallet gets personalized story
- **Wallet-specific storage**: Stories always tied to correct wallet address

## 🏗️ **Frontend Integration Patterns**

### **Multi-User Dashboard**
```javascript
class MultiUserOracleDashboard {
  constructor() {
    this.connectedWallets = new Map();
    this.setupWebSocket();
  }

  async addWallet(walletAddress) {
    // Get wallet's Oracle state
    const response = await fetch(`/api/oracle/wallet/${walletAddress}/status`);
    const oracleState = await response.json();

    // Add to dashboard
    this.connectedWallets.set(walletAddress, oracleState.data);
    this.renderWalletOracle(walletAddress);
  }

  setupWebSocket() {
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'oracle_update') {
        // Update global Oracle display
        this.updateGlobalOracle(data.oracle);
      } else if (data.type === 'wallet_oracle_update') {
        // Update specific wallet Oracle
        this.updateWalletOracle(data.walletAddress, data.oracle);
      }
    };
  }
}
```

### **Oracle Preference Panel**
```javascript
class OraclePreferencePanel {
  async updatePreferences(walletAddress, preferences) {
    await fetch(`/api/oracle/wallet/${walletAddress}/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferences)
    });

    // Refresh display
    this.refreshWalletOracle(walletAddress);
  }
}
```

## 🎮 **User Journey Examples**

### **New User (Dragon Joins the Realm)**
1. **Connects wallet** → Automatically joins Global Oracle
2. **Sees shared countdown** → Feels part of community
3. **Receives first chronicle** → Delivered with global transmission
4. **Discovers personal chamber** → Can switch to individual timing

### **Power User (Dragon Master)**
1. **Switches to personal Oracle** → Sets 2-hour intervals
2. **Gets personalized timing** → Stories arrive on their schedule
3. **Customizes preferences** → Fine-tunes experience
4. **Manages multiple wallets** → Each with own Oracle chamber

### **Community Events**
1. **Global Oracle countdown** → All dragons anticipate together
2. **Synchronized transmission** → Shared "The Oracle has spoken!" moment
3. **Individual story delivery** → Each gets their personal chronicle
4. **Community discussion** → Dragons share their adventures

## 💰 **Cost Management**

### **Efficient Batching Strategy**
```typescript
// Global Oracle transmission (cost-efficient)
const globalWallets = wallets.filter(w => w.isSubscribedToGlobal);
await generateBatchStories(globalWallets); // Single Claude API call

// Personal Oracle transmissions (when needed)
const personalWallets = wallets.filter(w => !w.isSubscribedToGlobal && w.isDue);
await generatePersonalStories(personalWallets); // Individual or small batch calls
```

## 🚀 **Ready to Use!**

The multi-user Oracle system is **fully operational**:

1. **Start API server**: `npm run start:api`
2. **Connect multiple wallets**: Each gets their own Oracle chamber
3. **Default experience**: All wallets join Global Oracle
4. **Personal control**: Any wallet can switch to personal Oracle
5. **Real-time updates**: WebSocket broadcasts to all connected clients

## 🎯 **Perfect Multi-User Architecture**

✅ **Scales infinitely** - Add as many wallets as needed
✅ **Cost optimized** - Smart batching reduces AI API costs
✅ **User choice** - Global community or personal experience
✅ **Real-time sync** - WebSocket updates for all users
✅ **Immersive lore** - Oracle chambers maintain fantasy theme

Your Oracle system now supports the full multi-user, multi-wallet architecture you planned! Each dragon can have their own mystical experience while still being part of the greater Oracle community. 🔮⚡🐉
