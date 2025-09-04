# Enhanced Trend Strategy - Live Trading Monitor
param(
    [string]$Action = "status"
)

function Show-Status {
    Write-Host "📊 Enhanced Trend Strategy - Live Trading Status" -ForegroundColor Green
    Write-Host "=" * 50
    
    # Check if container is running
    $container = docker ps --filter "name=fafnir-bot-trend" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>$null
    
    if ($container -match "fafnir-bot-trend") {
        Write-Host "✅ Status: TRADING LIVE" -ForegroundColor Green
        Write-Host $container
    } else {
        Write-Host "❌ Status: NOT RUNNING" -ForegroundColor Red
        return
    }
    
    Write-Host ""
    Write-Host "📈 Recent Activity:" -ForegroundColor Cyan
    docker logs fafnir-bot-trend --tail 5 2>$null
    
    Write-Host ""
    Write-Host "💰 Check Trade Logs:" -ForegroundColor Yellow
    if (Test-Path "./logs/enhanced-trend/trades.json") {
        $trades = Get-Content "./logs/enhanced-trend/trades.json" | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($trades) {
            Write-Host "  Total trades: $($trades.Count)"
            if ($trades.Count -gt 0) {
                $lastTrade = $trades[-1]
                Write-Host "  Last trade: $($lastTrade.action) $($lastTrade.amountGala) GALA at $($lastTrade.price)"
            }
        }
    } else {
        Write-Host "  No trades yet"
    }
}

function Show-Logs {
    Write-Host "📋 Live Logs (press Ctrl+C to exit):" -ForegroundColor Cyan
    docker logs fafnir-bot-trend -f --tail 20
}

function Stop-Trading {
    Write-Host "🛑 Stopping Enhanced Trend Strategy..." -ForegroundColor Yellow
    docker-compose -f docker-compose.enhanced-trend.yml down
    Write-Host "✅ Trading stopped" -ForegroundColor Green
}

function Show-Help {
    Write-Host "Enhanced Trend Strategy - Monitoring Commands" -ForegroundColor Green
    Write-Host ""
    Write-Host "Usage: .\monitor-trend-trading.ps1 [action]"
    Write-Host ""
    Write-Host "Actions:"
    Write-Host "  status  - Show current trading status (default)"
    Write-Host "  logs    - View live logs"
    Write-Host "  stop    - Stop trading"
    Write-Host "  help    - Show this help"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\monitor-trend-trading.ps1 status"
    Write-Host "  .\monitor-trend-trading.ps1 logs"
    Write-Host "  .\monitor-trend-trading.ps1 stop"
}

# Execute based on action
switch ($Action.ToLower()) {
    "status" { Show-Status }
    "logs" { Show-Logs }
    "stop" { Stop-Trading }
    "help" { Show-Help }
    default { 
        Write-Host "❌ Unknown action: $Action" -ForegroundColor Red
        Show-Help 
    }
}
