# 🚀 Quick Integration Guide for yuphix.io

## Step 1: Copy Files to Your Website
```bash
# Copy these 5 files to your yuphix.io project:
- index.html          # Main page structure
- styles.css          # Complete styling
- app.js              # API integration logic
- config.js           # Configuration settings
- README.md           # Documentation
```

## Step 2: Update API Configuration

**In `config.js`, change line 11-12:**
```javascript
// FROM:
BASE_URL: 'http://localhost:3000/api',
WS_URL: 'ws://localhost:3000',

// TO:
BASE_URL: 'https://your-api-domain.com/api',
WS_URL: 'wss://your-api-domain.com',
```

## Step 3: Integration Options

### Option A: Standalone Page
1. Use `index.html` as-is
2. Add to your website menu: `/trading-bot.html`
3. No additional integration needed

### Option B: Embed in Existing Page
1. Copy the `<body>` content from `index.html`
2. Paste into your existing page template
3. Include `<link rel="stylesheet" href="styles.css">`
4. Include the two `<script>` tags before `</body>`

## Step 4: Test the Integration

**Tell your AI assistant to:**
1. ✅ Test the API connection button
2. ✅ Try connecting MetaMask wallet
3. ✅ Load strategies from dropdown
4. ✅ Test configuration save/load
5. ✅ Check WebSocket real-time updates

## Step 5: Customize for Your Brand

**Easy customizations in `config.js`:**
```javascript
UI: {
    ACCENT_COLOR: '#your-brand-color',  // Change blue theme
    THEME: 'dark',                      // or 'light'
}
```

**Color scheme in `styles.css`:**
```css
/* Change line 13 in styles.css */
color: #your-text-color;

/* Change line 64 in styles.css */
color: #your-accent-color;
```

## 🎯 What Your AI Assistant Needs to Know

**This frontend prototype:**
- ✅ **Works immediately** with your Fafnir Bot API
- ✅ **Handles all API endpoints** automatically
- ✅ **Includes real-time WebSocket** updates
- ✅ **Mobile responsive** design
- ✅ **Error handling** and user feedback
- ✅ **MetaMask integration** with address mapping

**What it does:**
1. **Dual Wallet Support** - Both MetaMask and Gala Wallet extension support
2. **Smart Address Mapping** - MetaMask → GalaChain address conversion + native Gala Wallet
3. **Strategy Control** - Start/stop trading strategies with authenticated wallets
4. **Live Monitoring** - Real-time bot status and logs
5. **Configuration** - Adjust trading parameters per wallet
6. **Safety Features** - Emergency stop, error alerts, wallet validation

**Perfect for AI expansion:**
- Clean, modular code structure
- Well-documented functions
- Easy to add new features
- Responsive design ready

## 🚨 Important Notes

1. **API URL**: Must point to your running Fafnir Bot API server
2. **CORS**: Your API must allow requests from yuphix.io domain
3. **HTTPS**: Use secure connections (wss://, https://) in production
4. **Testing**: Test with MetaMask on a test wallet first

**Ready to transport and expand! 🐉**
