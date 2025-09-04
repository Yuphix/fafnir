import { BotSignature, Trade, CompetitionDetection } from './types.js';

export class CompetitionDetector {
  private recentTrades: Trade[] = [];
  private botPatterns: Map<string, BotSignature> = new Map();
  private maxTradeHistory = 100;
  private detectionThreshold = 3; // Minimum pattern matches to consider it a bot

  constructor() {
    // Clean up old trades periodically
    setInterval(() => this.cleanupOldTrades(), 300000); // Every 5 minutes
  }

  async addTrade(trade: Trade): Promise<void> {
    this.recentTrades.push(trade);

    // Keep only recent trades
    if (this.recentTrades.length > this.maxTradeHistory) {
      this.recentTrades = this.recentTrades.slice(-this.maxTradeHistory);
    }

    // Analyze for bot patterns
    await this.analyzeForBots();
  }

  private async analyzeForBots(): Promise<void> {
    // Look for regular intervals
    this.detectIntervalPatterns();

    // Look for round trade amounts
    this.detectRoundAmountPatterns();

    // Look for identical amounts repeatedly
    this.detectIdenticalAmountPatterns();

    // Look for time-based patterns
    this.detectTimeBasedPatterns();
  }

  private detectIntervalPatterns(): void {
    if (this.recentTrades.length < 5) return;

    const intervals: number[] = [];
    for (let i = 1; i < this.recentTrades.length; i++) {
      const interval = this.recentTrades[i].timestamp - this.recentTrades[i - 1].timestamp;
      intervals.push(interval);
    }

    // Look for common intervals
    const intervalCounts = new Map<number, number>();
    intervals.forEach(interval => {
      const rounded = Math.round(interval / 1000) * 1000; // Round to nearest second
      intervalCounts.set(rounded, (intervalCounts.get(rounded) || 0) + 1);
    });

    intervalCounts.forEach((count, interval) => {
      if (count >= this.detectionThreshold && interval > 0) {
        this.addBotSignature('interval', interval, [], Date.now());
      }
    });
  }

  private detectRoundAmountPatterns(): void {
    const roundAmounts = this.recentTrades
      .map(t => t.amount)
      .filter(amount => this.isRoundAmount(amount));

    if (roundAmounts.length >= this.detectionThreshold) {
      this.addBotSignature('round-amounts', 0, roundAmounts, Date.now());
    }
  }

  private detectIdenticalAmountPatterns(): void {
    const amountCounts = new Map<number, number>();

    this.recentTrades.forEach(trade => {
      amountCounts.set(trade.amount, (amountCounts.get(trade.amount) || 0) + 1);
    });

    amountCounts.forEach((count, amount) => {
      if (count >= this.detectionThreshold) {
        this.addBotSignature('identical-amounts', 0, [amount], Date.now());
      }
    });
  }

  private detectTimeBasedPatterns(): void {
    // Look for trades at specific times (e.g., every minute, every 5 minutes)
    const timePatterns = new Map<string, number>();

    this.recentTrades.forEach(trade => {
      const date = new Date(trade.timestamp);
      const minute = date.getMinutes();
      const hour = date.getHours();
      const timeKey = `${hour}:${Math.floor(minute / 5) * 5}`; // 5-minute buckets

      timePatterns.set(timeKey, (timePatterns.get(timeKey) || 0) + 1);
    });

    timePatterns.forEach((count, timeKey) => {
      if (count >= this.detectionThreshold) {
        this.addBotSignature('time-based', 0, [], Date.now());
      }
    });
  }

  private addBotSignature(pattern: string, interval: number, amounts: number[], timestamp: number): void {
    const signature: BotSignature = {
      pattern,
      interval,
      tradeAmounts: amounts,
      lastSeen: timestamp
    };

    this.botPatterns.set(pattern, signature);
  }

  private isRoundAmount(amount: number): boolean {
    // Check if amount is "round" (ends in 0, 5, or is a power of 10)
    const lastDigit = amount % 10;
    const isPowerOf10 = Math.log10(amount) % 1 === 0;

    return lastDigit === 0 || lastDigit === 5 || isPowerOf10;
  }

  private cleanupOldTrades(): void {
    const cutoff = Date.now() - 3600000; // 1 hour ago
    this.recentTrades = this.recentTrades.filter(t => t.timestamp > cutoff);

    // Clean up old bot signatures
    this.botPatterns.forEach((signature, pattern) => {
      if (Date.now() - signature.lastSeen > 1800000) { // 30 minutes
        this.botPatterns.delete(pattern);
      }
    });
  }

  async detectBots(): Promise<boolean> {
    return this.botPatterns.size > 0;
  }

  async getCompetitionLevel(): Promise<'LOW' | 'MEDIUM' | 'HIGH'> {
    const botCount = this.botPatterns.size;

    if (botCount === 0) return 'LOW';
    if (botCount <= 2) return 'MEDIUM';
    return 'HIGH';
  }

  async getAvoidanceRecommendations(): Promise<string[]> {
    const recommendations: string[] = [];

    if (this.botPatterns.has('interval')) {
      recommendations.push('Add random delays between trades (2-7 seconds)');
    }

    if (this.botPatterns.has('round-amounts')) {
      recommendations.push('Use odd trade amounts (e.g., $24.73 instead of $25)');
    }

    if (this.botPatterns.has('identical-amounts')) {
      recommendations.push('Vary trade sizes by ±10-15%');
    }

    if (this.botPatterns.has('time-based')) {
      recommendations.push('Randomize trading intervals');
    }

    if (recommendations.length === 0) {
      recommendations.push('No specific avoidance measures needed');
    }

    return recommendations;
  }

  async implementAvoidance(): Promise<void> {
    const recommendations = await this.getAvoidanceRecommendations();

    if (recommendations.length > 0) {
      console.log(`🤖 Competition detected! Implementing avoidance measures:`);
      recommendations.forEach(rec => console.log(`   • ${rec}`));
    }
  }

  getCompetitionDetection(): CompetitionDetection {
    return {
      botsDetected: this.botPatterns.size > 0,
      botSignatures: Array.from(this.botPatterns.values()),
      recommendedActions: []
    };
  }

  // Get random delay for avoiding competition
  getRandomDelay(): number {
    const baseDelay = 2000; // 2 seconds base
    const randomDelay = Math.random() * 5000; // 0-5 seconds random
    return baseDelay + randomDelay;
  }

  // Get randomized trade amount
  getRandomizedAmount(baseAmount: number): number {
    const variation = 0.1 + Math.random() * 0.1; // 10-20% variation
    const multiplier = Math.random() > 0.5 ? 1 + variation : 1 - variation;
    return Math.round(baseAmount * multiplier * 100) / 100;
  }

  // Reset detection (useful for testing)
  reset(): void {
    this.recentTrades = [];
    this.botPatterns.clear();
    console.log(`🔄 Competition detection reset`);
  }
}
