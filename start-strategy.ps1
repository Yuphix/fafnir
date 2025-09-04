# Fafnir Bot Strategy Launcher
# Usage: .\start-strategy.ps1 <strategy> [dry-run]
# Examples:
#   .\start-strategy.ps1 triangular
#   .\start-strategy.ps1 arbitrage dry
#   .\start-strategy.ps1 fibonacci
#   .\start-strategy.ps1 liquidity-spider

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("arbitrage", "triangular", "fibonacci", "liquidity-spider")]
    [string]$Strategy,

    [Parameter(Mandatory=$false)]
    [ValidateSet("dry", "live")]
    [string]$Mode = "live"
)

Write-Host "🚀 Starting Fafnir Bot with strategy: $Strategy ($Mode mode)" -ForegroundColor Green

# Stop existing container
Write-Host "📦 Stopping existing container..." -ForegroundColor Yellow
docker-compose down 2>$null

# Set environment variables
$env:FORCE_STRATEGY = $Strategy.ToLower()
$env:STRATEGY_TEST_MODE = if ($Mode -eq "dry") { "true" } else { "false" }

Write-Host "🔧 Configuration:" -ForegroundColor Cyan
Write-Host "   Strategy: $($env:FORCE_STRATEGY)" -ForegroundColor White
Write-Host "   Dry Run: $($env:STRATEGY_TEST_MODE)" -ForegroundColor White

# Start container with new strategy
Write-Host "🚀 Starting container..." -ForegroundColor Green
docker-compose up -d

Write-Host "✅ Bot started! Use 'docker logs fafnir-bot -f' to follow logs" -ForegroundColor Green
Write-Host "🛑 Use 'docker-compose down' to stop" -ForegroundColor Yellow
