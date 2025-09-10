#!/usr/bin/env pwsh
# Launch Multi-Strategy Fafnir Bot in Docker

Write-Host "🐉 Starting Fafnir Multi-Strategy Bot..." -ForegroundColor Green

# Check if .env file exists
if (-not (Test-Path .env)) {
    Write-Host "⚠️  .env file not found. Creating template..." -ForegroundColor Yellow
    @"
# Fafnir Bot Configuration
GALACHAIN_PRIVATE_KEY=your_private_key_here
GALACHAIN_WALLET_ADDRESS=your_wallet_address_here
GALACHAIN_RPC_URL=https://galachain-rpc.gala.com
GALASWAP_API_URL=https://api.galaswap.gala.com

# Multi-Strategy Configuration
ENABLE_MULTI_STRATEGY=true
DEFAULT_STRATEGY=fafnir-treasure-hoarder
STRATEGY_SWITCH_INTERVAL_MS=300000
ENABLE_STRATEGY_SWITCHING=true
ENABLE_FRONTEND_CONTROL=true

# Trading Configuration
DRY_RUN=false
MIN_TRADE_AMOUNT=10
MAX_TRADE_AMOUNT=1000
SLIPPAGE_BPS=100

# Risk Management
MAX_DAILY_LOSS=50
MAX_POSITION_SIZE=100
STOP_LOSS_THRESHOLD=10
DAILY_VOLUME_LIMIT=1000

# API Configuration
ENABLE_BOT_API=true
BOT_API_PORT=3001
API_CORS_ORIGINS=http://localhost:3001,http://localhost:3000,https://yuphix.io

# Logging
LOG_LEVEL=info
"@ | Out-File -FilePath .env -Encoding UTF8
    Write-Host "✅ Created .env template. Please edit with your credentials." -ForegroundColor Green
    return
}

# Launch the multi-strategy bot
Write-Host "🚀 Launching multi-strategy bot containers..." -ForegroundColor Cyan

docker-compose -f docker-compose.multi-strategy.yml down
docker-compose -f docker-compose.multi-strategy.yml up --build -d

Write-Host ""
Write-Host "🎯 Multi-Strategy Bot Status:" -ForegroundColor Green
Write-Host "   Bot API:      http://localhost:3001" -ForegroundColor White
Write-Host "   Frontend API: http://localhost:3000" -ForegroundColor White
Write-Host "   Strategies:   6 available (including Fafnir Treasure Hoarder)" -ForegroundColor White
Write-Host ""
Write-Host "📊 Check status with:" -ForegroundColor Yellow
Write-Host "   docker logs fafnir-multi-strategy-bot -f" -ForegroundColor White
Write-Host ""
Write-Host "🎮 Frontend Integration:" -ForegroundColor Yellow
Write-Host "   Bot Control:  fetch('http://localhost:3001/api/bot/status')" -ForegroundColor White
Write-Host "   Switch Strategy: POST http://localhost:3001/api/bot/strategy/switch" -ForegroundColor White
Write-Host ""
Write-Host "✅ Multi-Strategy Bot is now running!" -ForegroundColor Green
