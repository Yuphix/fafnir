# 🎭 **Claude API Input Examples for Story Generation**

## 📊 **Example 1: Trading Saga (Active Trading Period)**

### **System Prompt:**
```
You are a master storyteller specializing in fantasy narratives about digital trading adventures. You create engaging stories from trading bot data, transforming mundane financial transactions into epic tales of treasure hunting, strategic battles, and heroic quests in the mystical realm of GalaSwap.

Your stories should:
- Transform trading data into fantasy adventures
- Use vivid imagery and engaging narrative
- Include character development and emotional stakes
- Maintain consistency with the trading context
- Be entertaining while respecting the underlying data

Always respond with valid JSON arrays when requested, following the exact format specified in the user prompt.
```

### **User Prompt (What Claude Receives):**
```
Generate 3 fantasy stories based on trading data. Transform the following trading information into engaging narratives:

STORY 1:
Wallet: eth|978B...
Trades: 4
Timeframe: 2025-09-07T03:22:44.471Z to 2025-09-07T05:22:44.471Z
Preferences: {"tone":"epic","length":"medium","focusArea":"adventure","characterType":"warrior"}
Trade Details: [
  {
    "timestamp": "2025-09-07T05:22:44.471Z",
    "transactionId": "ba50dd08-bbbf-464a-afe9-b22bee01e73e",
    "type": "BUY",
    "tokenIn": "GUSDC|Unit|none|none",
    "tokenOut": "GALA|Unit|none|none",
    "amountIn": "1",
    "amountOut": "pending",
    "quotedAmountOut": "61.92993139",
    "slippageBps": 100,
    "feeTier": 10000,
    "walletAddress": "eth|978BB9ec5AF287EBff8f5C3BeC2568EED56aE4a9",
    "transactionHash": "pending-confirmation",
    "success": true,
    "profit": 0.003,
    "strategy": "fafnir-treasure-hoarder"
  },
  {
    "timestamp": "2025-09-07T04:45:12.123Z",
    "transactionId": "abc123-def456-ghi789",
    "type": "SELL",
    "tokenIn": "GALA|Unit|none|none",
    "tokenOut": "GUSDC|Unit|none|none",
    "amountIn": "30.5",
    "amountOut": "0.485",
    "quotedAmountOut": "0.490",
    "slippageBps": 150,
    "success": true,
    "profit": -0.005,
    "strategy": "fafnir-treasure-hoarder"
  },
  {
    "timestamp": "2025-09-07T04:12:33.456Z",
    "transactionId": "xyz789-abc123-def456",
    "type": "BUY",
    "tokenIn": "GUSDC|Unit|none|none",
    "tokenOut": "GALA|Unit|none|none",
    "amountIn": "5.0",
    "amountOut": "312.15",
    "quotedAmountOut": "310.00",
    "slippageBps": 75,
    "success": true,
    "profit": 2.15,
    "strategy": "arbitrage"
  }
]

STORY 2:
Wallet: eth|456A...
Trades: 2
Timeframe: 2025-09-07T03:00:00.000Z to 2025-09-07T05:00:00.000Z
Preferences: {"tone":"casual","length":"short","focusArea":"profit","characterType":"merchant"}
Trade Details: [
  {
    "timestamp": "2025-09-07T04:30:15.789Z",
    "transactionId": "merchant-quest-001",
    "type": "BUY",
    "tokenIn": "GWETH|Unit|none|none",
    "tokenOut": "GALA|Unit|none|none",
    "amountIn": "0.001",
    "amountOut": "156.78",
    "quotedAmountOut": "155.00",
    "slippageBps": 200,
    "success": true,
    "profit": 1.78,
    "strategy": "liquidity-spider"
  },
  {
    "timestamp": "2025-09-07T03:45:22.111Z",
    "transactionId": "merchant-quest-002",
    "type": "SELL",
    "tokenIn": "GALA|Unit|none|none",
    "tokenOut": "GUSDC|Unit|none|none",
    "amountIn": "200.0",
    "amountOut": "3.24",
    "quotedAmountOut": "3.20",
    "slippageBps": 50,
    "success": true,
    "profit": 0.04,
    "strategy": "fibonacci"
  }
]

STORY 3:
Wallet: eth|789C...
Trades: 1
Timeframe: 2025-09-07T04:00:00.000Z to 2025-09-07T05:00:00.000Z
Preferences: {"tone":"humorous","length":"long","focusArea":"risk","characterType":"rogue"}
Trade Details: [
  {
    "timestamp": "2025-09-07T04:15:44.999Z",
    "transactionId": "rogue-adventure-001",
    "type": "BUY",
    "tokenIn": "GUSDC|Unit|none|none",
    "tokenOut": "SILK|Unit|none|none",
    "amountIn": "10.0",
    "amountOut": "0",
    "quotedAmountOut": "20.0",
    "slippageBps": 300,
    "success": false,
    "profit": -10.0,
    "error": "Slippage tolerance exceeded",
    "strategy": "enhanced-trend"
  }
]

Requirements:
- Each story should be 200-400 words
- Use fantasy themes (treasure hunting, battles, quests)
- Include specific trading details as story elements
- Make each story unique and engaging
- Focus on the trader's journey and emotions

Return a JSON array with the exact number of stories requested, each containing:
{
  "title": "Epic story title",
  "content": "Full story content",
  "heroicMoments": ["moment1", "moment2"],
  "outcome": "victory|defeat|learning|contemplation"
}
```

---

## 🧘 **Example 2: Idle Chronicle (No Recent Trading)**

### **User Prompt (What Claude Receives):**
```
Generate 2 fantasy idle chronicles for traders who haven't been active recently. These should be contemplative stories about preparation, strategy, and waiting for the right moment.

CHRONICLE 1:
Wallet: eth|123A...
Last Activity: 2025-09-05T14:30:00.000Z
Total Trades: 47
Preferences: {"tone":"epic","length":"medium","focusArea":"strategy","characterType":"wizard"}

CHRONICLE 2:
Wallet: eth|456B...
Last Activity: Never
Total Trades: 0
Preferences: {"tone":"casual","length":"short","focusArea":"adventure","characterType":"warrior"}

Return a JSON array with 2 chronicles, each containing:
{
  "title": "Chronicle title",
  "content": "Full chronicle content (150-300 words)",
  "heroicMoments": [],
  "outcome": "contemplation"
}
```

---

## 🎯 **Expected Claude Response Format**

### **For Trading Sagas:**
```json
[
  {
    "title": "The Fafnir's Dawn Raid",
    "content": "As the first light of dawn broke over the mystical realm of GalaSwap, the warrior known as eth|978B ventured forth on a treasure-hunting expedition. Armed with 1 GUSDC, they sought the legendary GALA coins that sparkled like starlight in the digital ether.\n\nThe quest began with perfect timing - their Fafnir Treasure Hoarder strategy had detected a moment of opportunity. With calculated precision, they exchanged their stable gold pieces for 61.93 GALA tokens, the transaction flowing smoothly through the ethereal networks with minimal slippage of just 100 basis points.\n\nBut this warrior was no mere novice. Throughout the morning hours, they executed a series of strategic maneuvers - selling 30.5 GALA tokens in a tactical retreat, then launching a bold 5 GUSDC assault that yielded an impressive 312 GALA tokens through masterful arbitrage.\n\nThough one trade resulted in a small loss of 0.005 GUSDC, the warrior's overall campaign proved successful, netting 2.15 in profit. As the morning mist cleared, they stood victorious, their digital coffers slightly heavier, having demonstrated the patience and skill that marks a true treasure hoarder of the realm.",
    "heroicMoments": ["perfect_timing", "strategic_brilliance", "calculated_risk"],
    "outcome": "victory"
  },
  {
    "title": "The Merchant's Swift Exchange",
    "content": "In the bustling marketplace of GalaSwap, a seasoned merchant with the address eth|456A conducted their daily business with the efficiency of years of experience. Unlike the grand quests of warriors, this trader preferred the steady rhythm of profitable exchanges.\n\nTheir morning began with a clever transaction - converting 0.001 GWETH (ethereal crystals) into 156.78 GALA tokens using their Liquidity Spider strategy. The market conditions were favorable, and they managed to secure 1.78 tokens more than expected, a small but satisfying profit.\n\nLater, demonstrating the merchant's eye for opportunity, they sold 200 GALA tokens for 3.24 GUSDC using their tried-and-true Fibonacci approach. Though the profit was modest at 0.04 GUSDC, the merchant understood that consistent small gains build lasting wealth.\n\nAs the trading session concluded, the merchant tallied their earnings with satisfaction. No grand adventures or dramatic battles - just the steady, reliable work of a professional trader who knows that patience and consistency triumph over reckless ambition.",
    "heroicMoments": ["market_mastery", "steady_wisdom"],
    "outcome": "victory"
  },
  {
    "title": "The Rogue's Costly Gamble",
    "content": "In the shadowy corners of the GalaSwap realm, a rogue trader known as eth|789C attempted a daring heist that would become a cautionary tale whispered among digital adventurers.\n\nArmed with 10 GUSDC and an Enhanced Trend strategy, this rogue spotted what appeared to be an opportunity in the SILK token markets. The plan seemed foolproof - exchange stable coins for the mysterious SILK tokens and profit from the market movements.\n\nBut the digital realm is treacherous for those who take excessive risks. Setting their slippage tolerance to a dangerous 300 basis points, the rogue dove headfirst into the trade. The market, however, had other plans.\n\nAs the transaction processed, the price of SILK shifted dramatically. The slippage exceeded even their generous tolerance, and the entire trade collapsed like a house of cards. The rogue watched helplessly as their 10 GUSDC vanished into the digital void, leaving them with nothing but a harsh lesson.\n\nThough defeated, the rogue learned valuable wisdom that day - that in the realm of trading, patience and prudence often triumph over boldness and haste. Sometimes the greatest victory is knowing when not to fight.",
    "heroicMoments": ["bold_attempt", "lesson_learned"],
    "outcome": "defeat"
  }
]
```

### **For Idle Chronicles:**
```json
[
  {
    "title": "The Wizard's Meditation",
    "content": "High in the crystalline tower overlooking the GalaSwap realm, the wizard eth|123A sits in contemplative silence. Two days have passed since their last trading ritual, but this is not inactivity - it is preparation.\n\nWith 47 successful trades behind them, this master of strategy understands that true power comes not from constant action, but from perfect timing. Their spellbooks lie open, filled with charts and patterns, market movements and algorithmic insights.\n\nThe wizard's eyes glow with inner knowledge as they study the ebb and flow of digital currencies. GALA tokens dance in their crystal ball, showing futures yet to unfold. They sense a great opportunity approaching - perhaps in the coming hours, perhaps tomorrow.\n\nPatience is the wizard's greatest weapon. While others rush into hasty trades, they wait for the perfect confluence of market forces. Their strategy is not just about profit, but about understanding the deeper rhythms of the digital realm.\n\nWhen the moment comes, they will be ready.",
    "heroicMoments": [],
    "outcome": "contemplation"
  },
  {
    "title": "The Newcomer's Vigil",
    "content": "At the gates of the GalaSwap realm stands a figure in simple armor, wallet address eth|456B gleaming on their chest like a badge of hope. This warrior has never set foot in the trading halls, never felt the rush of a successful exchange or the sting of a failed transaction.\n\nBut they are not idle. Each day, they watch the veteran traders come and go, observing their strategies, learning their ways. They study the movement of GALA tokens like a scholar studies ancient texts, understanding that knowledge is the foundation of all success.\n\nTheir first trade awaits - that moment when preparation meets opportunity. They know it will come, and when it does, they will be ready to begin their own legend in this mystical realm of digital treasures.",
    "heroicMoments": [],
    "outcome": "contemplation"
  }
]
```

---

## 🛠️ **Key Data Points Claude Receives:**

1. **Wallet Information**: Truncated addresses for privacy
2. **Trade Details**: Complete transaction objects with all metadata
3. **User Preferences**: Tone, length, focus area, character type
4. **Timeframes**: Exact timestamps for context
5. **Profit/Loss Data**: Real financial outcomes
6. **Strategy Names**: Actual bot strategy used
7. **Success/Failure Status**: Transaction outcomes
8. **Error Messages**: When trades fail

This gives you complete control over how Claude interprets and transforms your trading data into engaging fantasy narratives! 🏴‍☠️✨
