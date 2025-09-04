# Enhanced Trend Strategy - Production Deployment Script
# Safety checks and deployment automation

Write-Host "Enhanced Trend Strategy - Production Deployment" -ForegroundColor Green
Write-Host "=" * 60

# Safety confirmation
Write-Host ""
Write-Host "⚠️  PRODUCTION TRADING WARNING ⚠️" -ForegroundColor Yellow
Write-Host "This will start LIVE trading with real money!"
Write-Host ""
Write-Host "Configuration:"
Write-Host "  • Strategy: Enhanced Trend"
Write-Host "  • Order Size: $15 GUSDC"
Write-Host "  • Buy Trigger: -5% (24h drop)"
Write-Host "  • Sell Target: +8% (profit)"
Write-Host "  • Stop Loss: -12% (emergency)"
Write-Host "  • Max Position: 1000 GALA"
Write-Host ""

$confirmation = Read-Host "Type 'START TRADING' to confirm live trading"

if ($confirmation -ne "START TRADING") {
    Write-Host "❌ Deployment cancelled - confirmation not matched" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ Confirmation received - Starting deployment..." -ForegroundColor Green

# Pre-flight checks
Write-Host ""
Write-Host "🔍 Pre-flight checks..." -ForegroundColor Cyan

# Check .env file
if (-not (Test-Path ".env")) {
    Write-Host "❌ Missing .env file with wallet credentials" -ForegroundColor Red
    exit 1
}

# Check required environment variables
$envContent = Get-Content ".env" -Raw
if (-not ($envContent -match "GALACHAIN_PRIVATE_KEY")) {
    Write-Host "❌ Missing GALACHAIN_PRIVATE_KEY in .env" -ForegroundColor Red
    exit 1
}

if (-not ($envContent -match "GALACHAIN_WALLET_ADDRESS")) {
    Write-Host "❌ Missing GALACHAIN_WALLET_ADDRESS in .env" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Environment configuration validated" -ForegroundColor Green

# Test the strategy first
Write-Host ""
Write-Host "🧪 Testing strategy (dry run)..." -ForegroundColor Cyan

try {
    $testResult = npm run test:enhanced-trend 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Strategy test failed:" -ForegroundColor Red
        Write-Host $testResult
        exit 1
    }
    Write-Host "✅ Strategy test passed" -ForegroundColor Green
} catch {
    Write-Host "❌ Strategy test error: $_" -ForegroundColor Red
    exit 1
}

# Build the production container
Write-Host ""
Write-Host "🔨 Building production container..." -ForegroundColor Cyan

try {
    docker-compose -f docker-compose.enhanced-trend.yml build --no-cache
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Container build failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Container built successfully" -ForegroundColor Green
} catch {
    Write-Host "❌ Build error: $_" -ForegroundColor Red
    exit 1
}

# Start the production trading
Write-Host ""
Write-Host "🚀 Starting Enhanced Trend Strategy - LIVE TRADING..." -ForegroundColor Green

try {
    docker-compose -f docker-compose.enhanced-trend.yml up -d
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to start container" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Startup error: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ Enhanced Trend Strategy is now LIVE!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Monitoring commands:" -ForegroundColor Cyan
Write-Host "  View logs:    docker logs fafnir-bot-trend -f"
Write-Host "  Stop trading: docker-compose -f docker-compose.enhanced-trend.yml down"
Write-Host "  Quick stop:   docker stop fafnir-bot-trend"
Write-Host ""
Write-Host "📈 The bot will:"
Write-Host "  • Monitor GALA price every 10 minutes"
Write-Host "  • Buy on -5% drops (24h)"
Write-Host "  • Sell on +8% gains"
Write-Host "  • Emergency stop at -12% loss"
Write-Host ""

# Show initial logs
Write-Host "Initial logs (press Ctrl+C to exit log view):"
Write-Host ""
docker logs fafnir-bot-trend -f --tail 20
