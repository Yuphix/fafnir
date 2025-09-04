import { MarketCondition, PoolConfiguration } from './types.js';
import { CompetitionDetector } from './competition-detector.js';

export interface DynamicConfigSettings {
  targetProfitability: number;
  maxTradeSize: number;
  minTradeSize: number;
  resetIntervalMs: number;
  slippageTolerance: number;
  gasLimit: number;
}

export class DynamicConfig {
  private baseConfig: DynamicConfigSettings;
  private currentConfig: DynamicConfigSettings;
  private competitionDetector: CompetitionDetector;
  private lastAdjustment: number = Date.now();
  private adjustmentInterval: number = 300000; // 5 minutes

  constructor(competitionDetector: CompetitionDetector) {
    this.competitionDetector = competitionDetector;

    // Initialize with base configuration
    this.baseConfig = {
      targetProfitability: 1.015, // 1.5% base profit target
        maxTradeSize: 25,
  minTradeSize: 5,
      resetIntervalMs: 60000, // 1 minute base
      slippageTolerance: 0.8,
      gasLimit: 300000
    };

    this.currentConfig = { ...this.baseConfig };
  }

  async adjustParameters(marketCondition: MarketCondition): Promise<void> {
    const now = Date.now();

    // Only adjust if enough time has passed
    if (now - this.lastAdjustment < this.adjustmentInterval) {
      return;
    }

    this.lastAdjustment = now;

    // Reset to base configuration
    this.currentConfig = { ...this.baseConfig };

    // Adjust based on volatility
    await this.adjustForVolatility(marketCondition.volatility);

    // Adjust based on volume
    await this.adjustForVolume(marketCondition.volume);

    // Adjust based on competition
    await this.adjustForCompetition(marketCondition.competitionLevel);

    // Adjust based on time of day
    await this.adjustForTimeOfDay(marketCondition.timeOfDay);

    // Adjust based on recent performance
    await this.adjustForPerformance(marketCondition.recentPerformance);

    // Log adjustments
    this.logAdjustments();
  }

  private async adjustForVolatility(volatility: number): Promise<void> {
    if (volatility > 0.05) {
      // High volatility - require higher profits and reduce risk
      this.currentConfig.targetProfitability = 1.03; // 3% profit target
      this.currentConfig.maxTradeSize = Math.max(15, this.currentConfig.maxTradeSize * 0.8);
      this.currentConfig.slippageTolerance = Math.min(0.6, this.currentConfig.slippageTolerance * 0.9);
      console.log(`🌊 High volatility detected: Increasing profit requirements and reducing risk`);
    } else if (volatility < 0.01) {
      // Low volatility - accept lower profits and increase size
      this.currentConfig.targetProfitability = 1.01; // 1% profit target
      this.currentConfig.maxTradeSize = Math.min(40, this.currentConfig.maxTradeSize * 1.2);
      this.currentConfig.slippageTolerance = Math.min(1.0, this.currentConfig.slippageTolerance * 1.1);
      console.log(`🌤️ Low volatility detected: Reducing profit requirements and increasing size`);
    }
  }

  private async adjustForVolume(volume: number): Promise<void> {
    if (volume < 50) {
      // Low volume - reduce trade sizes
      this.currentConfig.maxTradeSize = Math.max(10, this.currentConfig.maxTradeSize * 0.7);
      this.currentConfig.minTradeSize = Math.max(3, this.currentConfig.minTradeSize * 0.8);
      console.log(`📉 Low volume detected: Reducing trade sizes`);
    } else if (volume > 200) {
      // High volume - increase trade sizes
      this.currentConfig.maxTradeSize = Math.min(50, this.currentConfig.maxTradeSize * 1.3);
      this.currentConfig.minTradeSize = Math.min(10, this.currentConfig.minTradeSize * 1.2);
      console.log(`📈 High volume detected: Increasing trade sizes`);
    }
  }

  private async adjustForCompetition(competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH'): Promise<void> {
    if (competitionLevel === 'HIGH') {
      // High competition - randomize intervals and reduce predictability
      const baseInterval = this.baseConfig.resetIntervalMs;
      const randomFactor = 0.8 + Math.random() * 0.4; // 0.8x to 1.2x
      this.currentConfig.resetIntervalMs = Math.round(baseInterval * randomFactor);

      // Reduce trade sizes to avoid detection
      this.currentConfig.maxTradeSize = Math.max(15, this.currentConfig.maxTradeSize * 0.8);

      // Increase slippage tolerance for faster execution
      this.currentConfig.slippageTolerance = Math.min(1.2, this.currentConfig.slippageTolerance * 1.1);

      console.log(`🤖 High competition detected: Randomizing intervals and reducing predictability`);
    } else if (competitionLevel === 'LOW') {
      // Low competition - optimize for efficiency
      this.currentConfig.resetIntervalMs = this.baseConfig.resetIntervalMs;
      this.currentConfig.maxTradeSize = this.baseConfig.maxTradeSize;
      this.currentConfig.slippageTolerance = this.baseConfig.slippageTolerance;
      console.log(`😌 Low competition detected: Optimizing for efficiency`);
    }
  }

  private async adjustForTimeOfDay(hour: number): Promise<void> {
    if (hour >= 9 && hour <= 17) {
      // Market hours - more aggressive
      this.currentConfig.targetProfitability = Math.max(1.01, this.currentConfig.targetProfitability * 0.95);
      this.currentConfig.maxTradeSize = Math.min(50, this.currentConfig.maxTradeSize * 1.1);
      console.log(`🌅 Market hours: Increasing aggressiveness`);
    } else if (hour >= 22 || hour <= 6) {
      // Off hours - more conservative
      this.currentConfig.targetProfitability = Math.min(1.025, this.currentConfig.targetProfitability * 1.05);
      this.currentConfig.maxTradeSize = Math.max(15, this.currentConfig.maxTradeSize * 0.9);
      console.log(`🌙 Off hours: Increasing conservativeness`);
    }
  }

  private async adjustForPerformance(recentPerformance: number): Promise<void> {
    if (recentPerformance > 0.8) {
      // Good performance - increase confidence
      this.currentConfig.maxTradeSize = Math.min(50, this.currentConfig.maxTradeSize * 1.1);
      this.currentConfig.targetProfitability = Math.max(1.01, this.currentConfig.targetProfitability * 0.98);
      console.log(`📈 Good performance: Increasing confidence`);
    } else if (recentPerformance < 0.3) {
      // Poor performance - reduce risk
      this.currentConfig.maxTradeSize = Math.max(10, this.currentConfig.maxTradeSize * 0.8);
      this.currentConfig.targetProfitability = Math.min(1.025, this.currentConfig.targetProfitability * 1.02);
      console.log(`📉 Poor performance: Reducing risk`);
    }
  }

  private logAdjustments(): void {
    console.log(`
🔧 DYNAMIC CONFIG ADJUSTMENTS
╔══════════════════════════════════════════════════════════════════════════════╗
║ Profit Target: ${(this.currentConfig.targetProfitability * 100 - 100).toFixed(2).padEnd(5)}% │ Max Size: $${this.currentConfig.maxTradeSize.toString().padEnd(8)} │ Min Size: $${this.currentConfig.minTradeSize.toString().padEnd(8)} ║
║ Reset Interval: ${(this.currentConfig.resetIntervalMs / 1000).toString().padEnd(5)}s │ Slippage: ${(this.currentConfig.slippageTolerance * 100).toFixed(1).padEnd(5)}% │ Gas Limit: ${this.currentConfig.gasLimit.toString().padEnd(8)} ║
╚══════════════════════════════════════════════════════════════════════════════╝
    `);
  }

  // Get current configuration
  getCurrentConfig(): DynamicConfigSettings {
    return { ...this.currentConfig };
  }

  // Get base configuration
  getBaseConfig(): DynamicConfigSettings {
    return { ...this.baseConfig };
  }

  // Reset to base configuration
  resetToBase(): void {
    this.currentConfig = { ...this.baseConfig };
    console.log(`🔄 Configuration reset to base values`);
  }

  // Update base configuration
  updateBaseConfig(newConfig: Partial<DynamicConfigSettings>): void {
    this.baseConfig = { ...this.baseConfig, ...newConfig };
    this.currentConfig = { ...this.currentConfig, ...newConfig };
    console.log(`⚙️ Base configuration updated`);
  }

  // Get configuration summary
  getConfigSummary(): string {
    return `
Dynamic Configuration Summary
============================
Profit Target: ${(this.currentConfig.targetProfitability * 100 - 100).toFixed(2)}%
Max Trade Size: $${this.currentConfig.maxTradeSize}
Min Trade Size: $${this.currentConfig.minTradeSize}
Reset Interval: ${this.currentConfig.resetIntervalMs / 1000}s
Slippage Tolerance: ${(this.currentConfig.slippageTolerance * 100).toFixed(1)}%
Gas Limit: ${this.currentConfig.gasLimit}
Last Adjustment: ${new Date(this.lastAdjustment).toLocaleTimeString()}
    `.trim();
  }
}
