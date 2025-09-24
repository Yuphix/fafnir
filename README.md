<!-- Updated on 2025-09-24 -->
# 🔥 Fafnir Bot - GalaChain Arbitrage Bot

<!-- Updated by AI agent -->

A sophisticated arbitrage bot for the GalaChain DEX (gSwap) built with TypeScript and the official GalaChain SDK.

## 🚀 Features

- **Multi-direction Arbitrage** - Scans both A→B→A and B→A→B directions
- **Multi-fee Tier Detection** - Tests 500, 3000, and 10000 bps pools
- **Conservative Risk Management** - Daily loss limits, trade size restrictions
- **Production Safety** - Emergency stops, slippage protection
- **Real-time Monitoring** - Configurable polling with comprehensive logging
- **Docker Ready** - Production deployment configuration

## 🛡️ Risk Management

- **Conservative Thresholds** - 1.20% minimum profit (cautious risk level)
- **Daily Loss Limits** - $50 maximum daily loss protection
- **Trade Size Limits** - $25 maximum trade size
- **Slippage Protection** - 1.00% maximum slippage tolerance
- **Emergency Stop** - Automatic shutdown on safety breaches

## 📦 Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd fafnir-bot

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your credentials
```

## 🔐 Configuration

Create a `.env` file with your credentials:

```bash
# GalaChain Production Wallet Configuration
GALACHAIN_PRIVATE_KEY=your_private_key_here
GALACHAIN_WALLET_ADDRESS=your_wallet_address_here

# Trading Configuration
SLIPPAGE_BPS=100
FORCE_DRYRUN=0
LOG_LEVEL=info
```

## 🚀 Usage

### Development Mode
```bash
npm run start
```

### Dry-run Testing
```bash
FORCE_DRYRUN=1 npm run start
```

### Docker Deployment
```bash
docker-compose up -d
```

## 📊 Monitoring

- **Logs**: `logs/scout.log` - General activity
- **Trades**: `logs/dryruns/` - Transaction details
- **Docker**: `docker-compose logs -f fafnir-bot`

## ⚠️ Disclaimer

This bot is for educational and personal use. Trading cryptocurrencies involves risk. Use at your own discretion and never risk more than you can afford to lose.

## 📄 License

MIT License - see LICENSE file for details.

---

## 📜 Project Credits

- **Development Team**: Fafnir Bot Contributors
- **Special Thanks**: GalaChain Community

## 🛠️ Version Info

- **Current Version**: 1.0.0
- **Last Updated**: 2025-09-24
