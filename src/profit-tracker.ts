import 'dotenv/config';
import { galaSwapAuth } from './galachain-swap-auth.js';

/**
 * Comprehensive Profit Tracking and Reporting Utility
 *
 * This utility provides detailed profit analysis across all strategies
 * and transaction types using the unified logging system.
 */

export class ProfitTracker {

  /**
   * Generate a comprehensive profit report
   */
  async generateReport(): Promise<void> {
    try {
      console.log('\n📊 FAFNIR BOT PROFIT ANALYSIS');
      console.log('==============================\n');

      // Get overall statistics
      const stats = await galaSwapAuth.calculateTotalProfit();

      console.log('💰 OVERALL STATISTICS:');
      console.log(`   Total Trades: ${stats.totalTrades}`);
      console.log(`   Successful Trades: ${stats.successfulTrades}`);
      console.log(`   Success Rate: ${((stats.successfulTrades / stats.totalTrades) * 100).toFixed(2)}%`);
      console.log(`   Total Profit: $${stats.totalProfit.toFixed(4)}`);
      console.log(`   Average Profit per Trade: $${stats.averageProfit.toFixed(4)}\n`);

      // Profit breakdown by token
      if (Object.keys(stats.profitByToken).length > 0) {
        console.log('🎯 PROFIT BY TOKEN:');
        Object.entries(stats.profitByToken).forEach(([token, profit]) => {
          console.log(`   ${token}: $${profit.toFixed(4)}`);
        });
        console.log('');
      }

      // Recent transaction history
      const recentTransactions = await galaSwapAuth.getTransactionHistory(10);

      if (recentTransactions.length > 0) {
        console.log('📈 RECENT TRANSACTIONS (Last 10):');
        console.log('   Time               | Type | Amount                    | Profit      | TX ID');
        console.log('   -------------------|------|---------------------------|-------------|----------');

        recentTransactions.forEach(tx => {
          const time = new Date(tx.timestamp).toLocaleString().substring(0, 17);
          const type = tx.type.padEnd(4);
          const amount = `${tx.amountIn} ${this.getTokenSymbol(tx.tokenIn)} → ${tx.amountOut} ${this.getTokenSymbol(tx.tokenOut)}`.padEnd(25);
          const profit = tx.profit ? `$${tx.profit.toFixed(4)}`.padStart(10) : '    N/A   ';
          const txId = tx.transactionId.substring(0, 8) + '...';

          console.log(`   ${time} | ${type} | ${amount} | ${profit} | ${txId}`);
        });
        console.log('');
      }

      // Strategy performance analysis
      await this.analyzeStrategyPerformance(recentTransactions);

      console.log('✅ Profit analysis complete!\n');

    } catch (error: any) {
      console.error(`❌ Error generating profit report: ${error.message}`);
    }
  }

  /**
   * Analyze performance by strategy
   */
  private async analyzeStrategyPerformance(transactions: any[]): Promise<void> {
    const strategyStats: { [strategy: string]: { count: number; profit: number; success: number } } = {};

    transactions.forEach(tx => {
      const strategy = tx.strategy || tx.type;
      if (!strategyStats[strategy]) {
        strategyStats[strategy] = { count: 0, profit: 0, success: 0 };
      }

      strategyStats[strategy].count++;
      if (tx.success) {
        strategyStats[strategy].success++;
        if (tx.profit) {
          strategyStats[strategy].profit += tx.profit;
        }
      }
    });

    if (Object.keys(strategyStats).length > 0) {
      console.log('🎮 STRATEGY PERFORMANCE:');
      Object.entries(strategyStats).forEach(([strategy, stats]) => {
        const successRate = ((stats.success / stats.count) * 100).toFixed(1);
        const avgProfit = stats.success > 0 ? (stats.profit / stats.success).toFixed(4) : '0.0000';

        console.log(`   ${strategy.toUpperCase()}:`);
        console.log(`     Trades: ${stats.count} | Success: ${stats.success} (${successRate}%)`);
        console.log(`     Total Profit: $${stats.profit.toFixed(4)} | Avg: $${avgProfit}`);
      });
      console.log('');
    }
  }

  /**
   * Get token symbol from token string
   */
  private getTokenSymbol(tokenString: string): string {
    const parts = tokenString.split('|');
    return parts[0] || tokenString;
  }

  /**
   * Export transaction data to CSV for external analysis
   */
  async exportToCSV(filename: string = 'fafnir_transactions.csv'): Promise<void> {
    try {
      const transactions = await galaSwapAuth.getTransactionHistory(1000);

      if (transactions.length === 0) {
        console.log('No transactions to export');
        return;
      }

      const csvHeaders = [
        'Timestamp',
        'Type',
        'Strategy',
        'Token In',
        'Amount In',
        'Token Out',
        'Amount Out',
        'Quoted Amount Out',
        'Slippage BPS',
        'Actual Slippage',
        'Fee Tier',
        'Transaction ID',
        'Transaction Hash',
        'Profit',
        'Profit Percentage',
        'Success'
      ];

      const csvRows = transactions.map(tx => [
        tx.timestamp,
        tx.type,
        tx.strategy || '',
        this.getTokenSymbol(tx.tokenIn),
        tx.amountIn,
        this.getTokenSymbol(tx.tokenOut),
        tx.amountOut,
        tx.quotedAmountOut,
        tx.slippageBps.toString(),
        tx.actualSlippage?.toString() || '',
        tx.feeTier.toString(),
        tx.transactionId,
        tx.transactionHash || '',
        tx.profit?.toString() || '',
        tx.profitPercentage?.toString() || '',
        tx.success.toString()
      ]);

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(field => `"${field}"`).join(','))
      ].join('\n');

      const fs = await import('fs-extra');
      const path = await import('node:path');

      const outputPath = path.join(process.cwd(), 'logs', filename);
      await fs.writeFile(outputPath, csvContent);

      console.log(`📄 Transaction data exported to: ${outputPath}`);
      console.log(`   Exported ${transactions.length} transactions`);

    } catch (error: any) {
      console.error(`❌ Error exporting to CSV: ${error.message}`);
    }
  }

  /**
   * Real-time profit monitoring (for dashboard)
   */
  async startRealTimeMonitoring(intervalMs: number = 30000): Promise<void> {
    console.log(`📡 Starting real-time profit monitoring (every ${intervalMs/1000}s)`);

    setInterval(async () => {
      try {
        const stats = await galaSwapAuth.calculateTotalProfit();

        console.log(`💰 Current P&L: $${stats.totalProfit.toFixed(4)} | ` +
                   `Trades: ${stats.successfulTrades}/${stats.totalTrades} | ` +
                   `Avg: $${stats.averageProfit.toFixed(4)}`);

      } catch (error: any) {
        console.error(`⚠️  Monitoring error: ${error.message}`);
      }
    }, intervalMs);
  }
}

// Export singleton
export const profitTracker = new ProfitTracker();
