# Test Strategy Runner
# Runs the test strategy for logging refinement and testing

Write-Host "🧪 Starting Fafnir Test Strategy Runner" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Check if we're in the right directory
if (-not (Test-Path "src\strategies\test-strategy.ts")) {
    Write-Host "❌ Error: Please run this script from the fafnir-bot directory" -ForegroundColor Red
    exit 1
}

# Check for required environment variables
if (-not $env:GALACHAIN_PRIVATE_KEY -and -not $env:PRIVATE_KEY) {
    Write-Host "⚠️  Warning: GALACHAIN_PRIVATE_KEY not set - test will run in DRY RUN mode" -ForegroundColor Yellow
}

if (-not $env:GALACHAIN_WALLET_ADDRESS -and -not $env:WALLET_ADDRESS) {
    Write-Host "⚠️  Warning: GALACHAIN_WALLET_ADDRESS not set" -ForegroundColor Yellow
}

# Set test strategy specific environment variables
$env:TEST_STRATEGY_DRY_RUN = "true"  # Force dry run for safety
$env:FORCE_STRATEGY = "test-strategy"  # Force use of test strategy

Write-Host "📋 Configuration:" -ForegroundColor Green
Write-Host "   • Strategy: test-strategy" -ForegroundColor Gray
Write-Host "   • Dry Run: $env:TEST_STRATEGY_DRY_RUN" -ForegroundColor Gray
Write-Host "   • Wallet: $($env:GALACHAIN_WALLET_ADDRESS -or $env:WALLET_ADDRESS -or 'not set')" -ForegroundColor Gray
Write-Host ""

Write-Host "🚀 Starting test strategy runner..." -ForegroundColor Green

try {
    # Run the test strategy runner
    node test-strategy-runner.js
} catch {
    Write-Host "❌ Test strategy runner failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
