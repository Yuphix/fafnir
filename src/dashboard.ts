import { PerformanceMetrics, Milestone, CompetitionDetection } from './types.js';
import { MilestoneTracker } from './milestone-tracker.js';
import { StrategyManager } from './strategy-manager.js';
import { CompetitionDetector } from './competition-detector.js';

export class PerformanceDashboard {
  private milestoneTracker: MilestoneTracker;
  private strategyManager: StrategyManager;
  private competitionDetector: CompetitionDetector;
  private lastUpdate = Date.now();
  private autoRefreshTimer: NodeJS.Timeout | null = null; // Add timer tracking

  constructor(
    milestoneTracker: MilestoneTracker,
    strategyManager: StrategyManager,
    competitionDetector: CompetitionDetector
  ) {
    this.milestoneTracker = milestoneTracker;
    this.strategyManager = strategyManager;
    this.competitionDetector = competitionDetector;
  }

  async generateReport(): Promise<void> {
    console.clear();
    await this.displayHeader();
    await this.displayPerformanceMetrics();
    await this.displayStrategyStatus();
    await this.displayMilestoneProgress();
    await this.displayCompetitionStatus();
    await this.displayFooter();
  }

  private async displayHeader(): Promise<void> {
    const now = new Date();
    const uptime = this.formatUptime(Date.now() - this.lastUpdate);

    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                           🐉 FAFNIR BOT DASHBOARD 🐉                        ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ Time: ${now.toLocaleString()} | Uptime: ${uptime}                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
    `);
  }

  private async displayPerformanceMetrics(): Promise<void> {
    const stats = this.milestoneTracker.getStats();

    console.log(`
📊 PERFORMANCE METRICS
╔══════════════════════════════════════════════════════════════════════════════╗
║ Total Volume: $${stats.totalVolume.toFixed(2).padEnd(10)} │ Profitable Trades: ${stats.profitableTrades.toString().padEnd(8)} │ Win Rate: ${stats.winRate.toFixed(1).padEnd(5)}% ║
║ Total Profit: $${stats.totalProfit.toFixed(2).padEnd(10)} │ Total Trades: ${stats.totalTrades.toString().padEnd(8)} │ Volume Target: ${stats.volumeProgress.percentage.toFixed(1).padEnd(5)}% ║
╚══════════════════════════════════════════════════════════════════════════════╝
    `);
  }

  private async displayStrategyStatus(): Promise<void> {
    const currentStrategy = this.strategyManager.getCurrentStrategy();
    const allMetrics = this.strategyManager.getAllPerformanceMetrics();

    console.log(`
🔄 STRATEGY STATUS
╔══════════════════════════════════════════════════════════════════════════════╗
║ Current Strategy: ${currentStrategy.toUpperCase().padEnd(50)} ║
╠══════════════════════════════════════════════════════════════════════════════╣`);

    allMetrics.forEach((metrics, name) => {
      const status = name === currentStrategy ? '🟢 ACTIVE' : '⚪ IDLE';
      const winRate = metrics.winRate.toFixed(1);
      const profit = metrics.totalProfit.toFixed(2);
      const trades = metrics.totalTrades.toString();
      const volume = metrics.totalVolume.toFixed(2);

      console.log(`║ ${name.padEnd(15)} │ ${status.padEnd(10)} │ Trades: ${trades.padEnd(6)} │ Volume: $${volume.padEnd(8)} │ Win Rate: ${winRate.padEnd(5)}% │ Profit: $${profit.padEnd(8)} ║`);
    });

    console.log(`╚══════════════════════════════════════════════════════════════════════════════╝`);
  }

  private async displayMilestoneProgress(): Promise<void> {
    const stats = this.milestoneTracker.getStats();
    const nextMilestone = this.milestoneTracker.getNextMilestone();

    console.log(`
🏆 MILESTONE PROGRESS
╔══════════════════════════════════════════════════════════════════════════════╗
║ Completed: ${stats.completedMilestones}/${stats.totalMilestones} │ Total Rewards: $${stats.totalRewards} ║`);

    if (nextMilestone) {
      const progress = stats.milestoneProgress;
      const progressBar = this.createProgressBar(progress.percentage, 30);

      console.log(`║ Next: ${nextMilestone.trades} trades │ Progress: ${progressBar} ${progress.percentage.toFixed(1)}% ║`);
    } else {
      console.log(`║ 🎉 ALL MILESTONES COMPLETED! 🎉 ║`);
    }

    console.log(`╚══════════════════════════════════════════════════════════════════════════════╝`);
  }

  private async displayCompetitionStatus(): Promise<void> {
    const competitionLevel = await this.competitionDetector.getCompetitionLevel();
    const botsDetected = await this.competitionDetector.detectBots();
    const recommendations = await this.competitionDetector.getAvoidanceRecommendations();

    const statusIcon = botsDetected ? '🤖' : '😌';
    const statusText = botsDetected ? 'COMPETITION DETECTED' : 'NO COMPETITION';

    console.log(`
${statusIcon} COMPETITION STATUS
╔══════════════════════════════════════════════════════════════════════════════╗
║ Level: ${competitionLevel.padEnd(10)} │ Status: ${statusText.padEnd(25)} ║`);

    if (botsDetected && recommendations.length > 0) {
      console.log(`╠══════════════════════════════════════════════════════════════════════════════╣`);
      console.log(`║ Avoidance Measures: ║`);
      recommendations.forEach(rec => {
        console.log(`║   • ${rec.padEnd(65)} ║`);
      });
    }

    console.log(`╚══════════════════════════════════════════════════════════════════════════════╝`);
  }

  private async displayFooter(): Promise<void> {
    const now = Date.now();
    this.lastUpdate = now;

    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║ Last Update: ${new Date(now).toLocaleTimeString().padEnd(50)} ║
║ Press Ctrl+C to exit | Auto-refresh every 30 seconds                        ║
╚══════════════════════════════════════════════════════════════════════════════╝
    `);
  }

  private createProgressBar(percentage: number, width: number): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;

    const filledBar = '█'.repeat(filled);
    const emptyBar = '░'.repeat(empty);

    return filledBar + emptyBar;
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // Generate a summary report for logging
  async generateSummaryReport(): Promise<string> {
    const stats = this.milestoneTracker.getStats();
    const currentStrategy = this.strategyManager.getCurrentStrategy();
    const competitionLevel = await this.competitionDetector.getCompetitionLevel();

    return `
FAFNIR BOT SUMMARY REPORT
=========================
Time: ${new Date().toLocaleString()}
Current Strategy: ${currentStrategy}
Total Volume: $${stats.totalVolume.toFixed(2)}
Profitable Trades: ${stats.profitableTrades}/${stats.totalTrades}
Win Rate: ${stats.winRate.toFixed(1)}%
Total Profit: $${stats.totalProfit.toFixed(2)}
Milestones Completed: ${stats.completedMilestones}/${stats.totalMilestones}
Competition Level: ${competitionLevel}
Volume Progress: ${stats.volumeProgress.percentage.toFixed(1)}%
    `.trim();
  }

  // Start auto-refresh
  startAutoRefresh(intervalMs: number = 30000): void {
    // Clear any existing timer to prevent duplicates
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
    }

    this.autoRefreshTimer = setInterval(async () => {
      await this.generateReport();
    }, intervalMs);
  }

  // Stop auto-refresh
  stopAutoRefresh(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }
}
