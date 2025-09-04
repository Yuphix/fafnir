# Interactive Strategy Switcher for Fafnir Bot
Write-Host "🚀 Fafnir Bot Strategy Switcher" -ForegroundColor Magenta
Write-Host "================================" -ForegroundColor Magenta

Write-Host "`nAvailable Strategies:" -ForegroundColor Cyan
Write-Host "1. ⚡ Arbitrage (Fast pair-to-pair)" -ForegroundColor Yellow
Write-Host "2. 🔺 Triangular (Multi-hop arbitrage)" -ForegroundColor Magenta
Write-Host "3. 🔢 Fibonacci (Sequence-based trading)" -ForegroundColor Blue
Write-Host "4. 🕷️  Liquidity Spider (Low-volume DEX hunter)" -ForegroundColor Green
Write-Host "5. 🛑 Stop Bot" -ForegroundColor Red

$choice = Read-Host "`nSelect strategy (1-5)"

switch ($choice) {
    "1" {
        Write-Host "⚡ Starting Arbitrage Strategy..." -ForegroundColor Yellow
        $env:FORCE_STRATEGY = "arbitrage"
    }
    "2" {
        Write-Host "🔺 Starting Triangular Arbitrage..." -ForegroundColor Magenta
        $env:FORCE_STRATEGY = "triangular"
    }
    "3" {
        Write-Host "🔢 Starting Fibonacci Strategy..." -ForegroundColor Blue
        $env:FORCE_STRATEGY = "fibonacci"
    }
    "4" {
        Write-Host "🕷️ Starting Liquidity Spider..." -ForegroundColor Green
        $env:FORCE_STRATEGY = "liquidity-spider"
    }
    "5" {
        Write-Host "🛑 Stopping Bot..." -ForegroundColor Red
        docker-compose down
        Write-Host "✅ Bot stopped!" -ForegroundColor Green
        exit
    }
    default {
        Write-Host "❌ Invalid choice. Exiting..." -ForegroundColor Red
        exit
    }
}

Write-Host "🔧 Restarting with strategy: $($env:FORCE_STRATEGY)" -ForegroundColor Cyan

# Create temporary .env override for the strategy
$envContent = "FORCE_STRATEGY=$($env:FORCE_STRATEGY)"
$envContent | Out-File -FilePath ".env.strategy" -Encoding ASCII

Write-Host "📝 Environment: $envContent" -ForegroundColor Gray

docker-compose down 2>$null
docker-compose --env-file .env.strategy up -d

Write-Host "✅ Bot restarted!" -ForegroundColor Green
Write-Host "📊 View logs: docker logs fafnir-bot -f" -ForegroundColor White
Write-Host "🛑 Stop bot: docker-compose down" -ForegroundColor Yellow
