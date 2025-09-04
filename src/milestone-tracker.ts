import { Milestone, TradeResult } from './types.js';
import fs from 'fs-extra';
import path from 'node:path';

export class MilestoneTracker {
  private milestones: Milestone[];
  private totalVolume: number = 0;
  private profitableTrades: number = 0;
  private totalTrades: number = 0;
  private totalProfit: number = 0;
  private volumeTarget: number = 1500;
  private dataFile: string;

  constructor(milestones: Milestone[], volumeTarget: number = 1500) {
    this.milestones = milestones;
    this.volumeTarget = volumeTarget;
    this.dataFile = path.join(process.cwd(), 'logs', 'milestone-data.json');
    this.loadProgress();
  }

  async updateProgress(tradeResult: TradeResult): Promise<void> {
    this.totalTrades++;
    this.totalVolume += tradeResult.volume;

    if (tradeResult.success && tradeResult.profit > 0) {
      this.profitableTrades++;
      this.totalProfit += tradeResult.profit;
    }

    // Check for milestone completions
    await this.checkMilestoneProgress();

    // Save progress
    await this.saveProgress();
  }

  private async checkMilestoneProgress(): Promise<void> {
    for (const milestone of this.milestones) {
      if (!milestone.completed && this.profitableTrades >= milestone.trades) {
        milestone.completed = true;
        await this.announceMilestone(milestone);
      }
    }
  }

  private async announceMilestone(milestone: Milestone): Promise<void> {
    const message = `
🎉 MILESTONE ACHIEVED! 🎉
📊 ${milestone.trades} Profitable Trades Completed
💰 Reward: $${milestone.reward}
📈 Total Volume: $${this.totalVolume.toFixed(2)}
🏆 Progress: ${this.getCompletedMilestones()}/${this.milestones.length} milestones
    `;

    console.log(message);

    // Log to file
    const logDir = path.join(process.cwd(), 'logs');
    const logFile = path.join(logDir, 'milestone-achievements.log');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] MILESTONE: ${milestone.trades} trades - $${milestone.reward} reward\n`;

    await fs.appendFile(logFile, logEntry);
  }

  getNextMilestone(): Milestone | null {
    const nextMilestone = this.milestones.find(m => !m.completed);
    return nextMilestone || null;
  }

  getMilestoneProgress(): { current: number; next: number; percentage: number } {
    const nextMilestone = this.getNextMilestone();
    if (!nextMilestone) {
      return { current: this.profitableTrades, next: 0, percentage: 100 };
    }

    const current = this.profitableTrades;
    const next = nextMilestone.trades;
    const percentage = Math.min(100, (current / next) * 100);

    return { current, next, percentage };
  }

  getVolumeProgress(): { current: number; target: number; percentage: number } {
    const percentage = Math.min(100, (this.totalVolume / this.volumeTarget) * 100);
    return {
      current: this.totalVolume,
      target: this.volumeTarget,
      percentage
    };
  }

  shouldReduceProfitRequirements(): boolean {
    const nextMilestone = this.getNextMilestone();
    if (!nextMilestone) return false;

    // If we're close to a milestone, reduce profit requirements
    const tradesNeeded = nextMilestone.trades - this.profitableTrades;

    if (tradesNeeded <= 2) {
      return true; // Close to milestone
    }

    if (tradesNeeded <= 5 && this.getVolumeProgress().percentage >= 80) {
      return true; // Close to milestone and volume target
    }

    return false;
  }

  getAdjustedProfitTarget(baseTarget: number): number {
    if (this.shouldReduceProfitRequirements()) {
      // Reduce profit requirements when close to milestones
      return baseTarget * 0.7; // 30% reduction
    }

    return baseTarget;
  }

  getCompletedMilestones(): number {
    return this.milestones.filter(m => m.completed).length;
  }

  getTotalRewards(): number {
    return this.milestones
      .filter(m => m.completed)
      .reduce((sum, m) => sum + m.reward, 0);
  }

  getTotalMilestones(): number {
    return this.milestones.length;
  }

  getStats(): {
    totalTrades: number;
    profitableTrades: number;
    totalVolume: number;
    totalProfit: number;
    winRate: number;
    completedMilestones: number;
    totalRewards: number;
    totalMilestones: number;
    volumeProgress: { current: number; target: number; percentage: number };
    milestoneProgress: { current: number; next: number; percentage: number };
  } {
    return {
      totalTrades: this.totalTrades,
      profitableTrades: this.profitableTrades,
      totalVolume: this.totalVolume,
      totalProfit: this.totalProfit,
      winRate: this.totalTrades > 0 ? (this.profitableTrades / this.totalTrades) * 100 : 0,
      completedMilestones: this.getCompletedMilestones(),
      totalRewards: this.getTotalRewards(),
      totalMilestones: this.getTotalMilestones(),
      volumeProgress: this.getVolumeProgress(),
      milestoneProgress: this.getMilestoneProgress()
    };
  }

  private async loadProgress(): Promise<void> {
    try {
      if (await fs.pathExists(this.dataFile)) {
        const data = await fs.readJson(this.dataFile);
        this.totalVolume = data.totalVolume || 0;
        this.profitableTrades = data.profitableTrades || 0;
        this.totalTrades = data.totalTrades || 0;
        this.totalProfit = data.totalProfit || 0;
        console.log(`📊 Loaded milestone progress: ${this.profitableTrades} profitable trades, $${this.totalVolume.toFixed(2)} volume`);
      }
    } catch (error) {
      console.log(`⚠️ Could not load milestone progress: ${error}`);
    }
  }

  private async saveProgress(): Promise<void> {
    try {
      const data = {
        totalVolume: this.totalVolume,
        profitableTrades: this.profitableTrades,
        totalTrades: this.totalTrades,
        totalProfit: this.totalProfit,
        lastUpdated: new Date().toISOString()
      };

      await fs.writeJson(this.dataFile, data, { spaces: 2 });
    } catch (error) {
      console.log(`⚠️ Could not save milestone progress: ${error}`);
    }
  }

  // Reset progress (useful for testing)
  async resetProgress(): Promise<void> {
    this.totalVolume = 0;
    this.profitableTrades = 0;
    this.totalTrades = 0;
    this.totalProfit = 0;

    for (const milestone of this.milestones) {
      milestone.completed = false;
    }

    await this.saveProgress();
    console.log(`🔄 Milestone progress reset`);
  }
}
