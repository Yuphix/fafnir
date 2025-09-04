# 🔌 Fafnir Bot WebSocket API Documentation

## 📡 **Connection Details**

### **WebSocket Endpoint**
```
ws://localhost:3000
```

### **Authentication**
Browser WebSocket connections must use query parameters (headers are not supported in browsers):

#### **Method 1: Query Parameter (Browser-Compatible)**
```
ws://localhost:3000?api_key=your_api_key_here
```

#### **Method 2: Headers (Node.js/Server Only)**
```
X-API-Key: your_api_key_here
```

### **Connection Example (JavaScript - Browser)**
```javascript
// Browser-compatible connection
const apiKey = 'your_api_key_here';
const ws = new WebSocket(`ws://localhost:3000?api_key=${apiKey}`);

ws.onopen = () => {
  console.log('Connected to Fafnir Bot WebSocket');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

### **Connection Example (Node.js - Server)**
```javascript
// Server-side connection with headers
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000', {
  headers: {
    'X-API-Key': 'your_api_key_here'
  }
});
```

---

## 📨 **Message Format**

All messages use JSON format with the following structure:

### **Outgoing Messages (Server → Client)**
```json
{
  "type": "message_type",
  "data": {}, // Optional payload
  "timestamp": "2025-09-04T18:30:00.000Z",
  "version": "1.0"
}
```

### **Incoming Messages (Client → Server)**
```json
{
  "type": "command_type",
  "data": {}, // Optional payload
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

---

## 🔄 **Real-Time Events**

### **Bot Status Updates**
Sent every 30 seconds to all connected clients.

```json
{
  "type": "bot_status_update",
  "data": {
    "bots": [
      {
        "botName": "fafnir-bot-fibonacci",
        "strategy": "DCA Fibonacci",
        "status": "running",
        "uptime": 3600,
        "lastActivity": "2025-09-04T18:30:00.000Z",
        "containerId": "fafnir-bot-fibonacci"
      }
    ]
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

### **Trade Executions**
Sent immediately when trades are executed.

```json
{
  "type": "trade_executed",
  "data": {
    "timestamp": "2025-09-04T18:30:00.000Z",
    "strategy": "DCA Fibonacci",
    "action": "buy",
    "pair": "GUSDC/GALA",
    "amount": 2.0,
    "price": 0.015567,
    "profit": 0,
    "status": "success"
  }
}
```

### **Strategy Changes**
Sent when strategies are started, stopped, or switched.

```json
{
  "type": "strategy_change",
  "data": {
    "action": "started", // "started", "stopped", "switched"
    "strategy": "DCA Fibonacci",
    "previousStrategy": null, // Only for "switched"
    "timestamp": "2025-09-04T18:30:00.000Z"
  }
}
```

### **Configuration Updates**
Sent when bot configuration is modified.

```json
{
  "type": "config_update",
  "data": {
    "config": {
      "strategy": "fibonacci",
      "settings": {
        "baseTradeSize": 2,
        "takeProfit": 6,
        "stopLoss": 15
      }
    },
    "timestamp": "2025-09-04T18:30:00.000Z"
  }
}
```

---

## 📤 **Client Commands**

### **1. Ping/Pong**
**Purpose**: Keep connection alive and test latency

**Send**:
```json
{
  "type": "ping",
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

**Receive**:
```json
{
  "type": "pong",
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

### **2. Subscribe to Updates**
**Purpose**: Subscribe to real-time updates

**Send**:
```json
{
  "type": "subscribe",
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

**Receive**:
```json
{
  "type": "subscribed",
  "message": "Subscribed to real-time updates",
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

### **3. Subscribe to Trade Approvals**
**Purpose**: Receive trade approval requests for specific wallet

**Send**:
```json
{
  "type": "subscribe_trade_approvals",
  "data": {
    "walletAddress": "0x1234..."
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

**Receive**:
```json
{
  "type": "trade_approval_request",
  "data": {
    "tradeId": "trade_123",
    "walletAddress": "0x1234...",
    "strategy": "DCA Fibonacci",
    "action": "buy",
    "pair": "GUSDC/GALA",
    "amount": 2.0,
    "price": 0.015567,
    "estimatedProfit": 0.5,
    "timeout": 30000 // 30 seconds to respond
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

### **4. Approve/Reject Trade**
**Purpose**: Respond to trade approval requests

**Send**:
```json
{
  "type": "trade_approval",
  "data": {
    "tradeId": "trade_123",
    "approved": true, // or false
    "walletAddress": "0x1234..."
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

**Receive**:
```json
{
  "type": "trade_approval_result",
  "data": {
    "tradeId": "trade_123",
    "approved": true,
    "status": "executed", // "executed", "rejected", "timeout"
    "message": "Trade approved and executed"
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

### **5. Start Strategy**
**Purpose**: Start a specific trading strategy

**Send**:
```json
{
  "type": "start_strategy",
  "data": {
    "strategyId": "fibonacci" // "fibonacci", "trend", "arbitrage", "spider"
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

**Receive**:
```json
{
  "type": "strategy_result",
  "data": {
    "success": true,
    "strategy": "fibonacci",
    "status": "running",
    "message": "Fibonacci strategy started successfully"
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

### **6. Stop Strategy**
**Purpose**: Stop a running strategy

**Send**:
```json
{
  "type": "stop_strategy",
  "data": {
    "strategyId": "fibonacci"
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

**Receive**:
```json
{
  "type": "strategy_result",
  "data": {
    "success": true,
    "strategy": "fibonacci",
    "status": "stopped",
    "message": "Fibonacci strategy stopped successfully"
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

### **7. Switch Strategy**
**Purpose**: Switch from one strategy to another

**Send**:
```json
{
  "type": "switch_strategy",
  "data": {
    "fromStrategy": "fibonacci",
    "toStrategy": "trend"
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

**Receive**:
```json
{
  "type": "strategy_result",
  "data": {
    "success": true,
    "fromStrategy": "fibonacci",
    "toStrategy": "trend",
    "status": "switched",
    "message": "Successfully switched from Fibonacci to Trend strategy"
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

### **8. Update Configuration**
**Purpose**: Update bot configuration settings

**Send**:
```json
{
  "type": "update_config",
  "data": {
    "config": {
      "strategy": "fibonacci",
      "settings": {
        "baseTradeSize": 3,
        "takeProfit": 7,
        "stopLoss": 12
      }
    }
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

**Receive**:
```json
{
  "type": "config_result",
  "data": {
    "success": true,
    "config": {
      "strategy": "fibonacci",
      "settings": {
        "baseTradeSize": 3,
        "takeProfit": 7,
        "stopLoss": 12
      }
    },
    "message": "Configuration updated successfully"
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

---

## 🚨 **Error Messages**

### **Authentication Error**
```json
{
  "type": "error",
  "data": {
    "code": "AUTH_REQUIRED",
    "message": "Authentication required",
    "details": "Valid API key must be provided"
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

### **Validation Error**
```json
{
  "type": "error",
  "data": {
    "code": "VALIDATION_ERROR",
    "message": "Configuration validation failed",
    "details": ["baseTradeSize must be between 1 and 50"]
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

### **Strategy Error**
```json
{
  "type": "error",
  "data": {
    "code": "STRATEGY_ERROR",
    "message": "Failed to start Fibonacci strategy",
    "details": "Strategy already running"
  },
  "timestamp": "2025-09-04T18:30:00.000Z"
}
```

---

## 📊 **Available Strategies**

| Strategy ID | Name | Description |
|-------------|------|-------------|
| `fibonacci` | DCA Fibonacci | Dollar-cost averaging with Fibonacci retracement levels |
| `trend` | Enhanced Trend | Trend-following with CoinGecko integration |
| `arbitrage` | Arbitrage | Cross-pool arbitrage opportunities |
| `spider` | Liquidity Spider | Liquidity pool monitoring and trading |
| `conservative-fib` | Conservative Fibonacci | Lower-risk Fibonacci strategy |

---

## 🔧 **Frontend Integration Example**

### **JavaScript/TypeScript**
```javascript
class FafnirBotWebSocket {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    // Browser-compatible WebSocket connection with query parameter
    this.ws = new WebSocket(`ws://localhost:3000?api_key=${this.apiKey}`);

    this.ws.onopen = () => {
      console.log('Connected to Fafnir Bot WebSocket');
      this.reconnectAttempts = 0;

      // Subscribe to updates
      this.send({
        type: 'subscribe',
        timestamp: new Date().toISOString()
      });
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.reconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'bot_status_update':
        this.updateBotStatus(data.data);
        break;
      case 'trade_executed':
        this.handleTradeExecution(data.data);
        break;
      case 'trade_approval_request':
        this.showTradeApproval(data.data);
        break;
      case 'strategy_change':
        this.handleStrategyChange(data.data);
        break;
      case 'error':
        this.handleError(data.data);
        break;
    }
  }

  approveTrade(tradeId, walletAddress) {
    this.send({
      type: 'trade_approval',
      data: {
        tradeId,
        approved: true,
        walletAddress
      },
      timestamp: new Date().toISOString()
    });
  }

  rejectTrade(tradeId, walletAddress) {
    this.send({
      type: 'trade_approval',
      data: {
        tradeId,
        approved: false,
        walletAddress
      },
      timestamp: new Date().toISOString()
    });
  }

  startStrategy(strategyId) {
    this.send({
      type: 'start_strategy',
      data: { strategyId },
      timestamp: new Date().toISOString()
    });
  }

  stopStrategy(strategyId) {
    this.send({
      type: 'stop_strategy',
      data: { strategyId },
      timestamp: new Date().toISOString()
    });
  }

  switchStrategy(fromStrategy, toStrategy) {
    this.send({
      type: 'switch_strategy',
      data: { fromStrategy, toStrategy },
      timestamp: new Date().toISOString()
    });
  }

  reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Reconnecting... Attempt ${this.reconnectAttempts}`);
        this.connect();
      }, 5000 * this.reconnectAttempts);
    }
  }
}

// Usage
const bot = new FafnirBotWebSocket('your_api_key_here');
bot.connect();
```

---

## 🔐 **Security Notes**

1. **API Key Required**: All WebSocket connections must include a valid API key
2. **Browser Limitation**: Browsers cannot send headers with WebSocket connections - use query parameters instead
3. **Rate Limiting**: Avoid sending messages more frequently than once per second
4. **Reconnection**: Implement exponential backoff for reconnection attempts
5. **Validation**: Always validate incoming messages before processing
6. **Error Handling**: Implement proper error handling for all message types
7. **Authentication Methods**:
   - **Browsers**: Use `ws://localhost:3000?api_key=your_key`
   - **Servers**: Use headers `X-API-Key: your_key`

---

## 📝 **Testing**

### **Test Connection (Browser-Compatible)**
```bash
# Using wscat with query parameter
wscat -c "ws://localhost:3000?api_key=your_api_key_here"
```

### **Test Connection (Server-Side)**
```bash
# Using wscat with headers (Node.js/Server only)
wscat -c ws://localhost:3000 -H "X-API-Key: your_api_key_here"
```

### **Send Test Message**
```json
{"type": "ping", "timestamp": "2025-09-04T18:30:00.000Z"}
```

---

## 🆘 **Troubleshooting**

### **Common Issues**

1. **Connection Refused**: Ensure the API server is running on port 3000
2. **Authentication Failed**: Verify your API key is valid
3. **Message Parsing Errors**: Ensure all messages are valid JSON
4. **Missing Timestamps**: Always include timestamp in messages
5. **Strategy Not Found**: Verify strategy ID exists

### **Debug Mode**
Enable debug logging by setting environment variable:
```bash
LOG_LEVEL=debug
```

---

*Last Updated: 2025-09-04*
*Version: 1.0*
