import fs from 'fs-extra';
import path from 'node:path';
import { spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Backend Story Generator for Fafnir Trading Bot
 * Generates fantasy stories from trading data with batch processing and wallet-based storage
 */

interface WalletStoryData {
  walletAddress: string;
  lastStoryGenerated: Date;
  totalTrades: number;
  lastTradeTime: Date | null;
  storyHistory: StoryEntry[];
  preferences: StoryPreferences;
}

interface StoryEntry {
  id: string;
  timestamp: Date;
  storyType: 'trading_saga' | 'idle_chronicle' | 'epic_battle' | 'treasure_hunt';
  title: string;
  content: string;
  metadata: {
    tradesIncluded: number;
    profitLoss: number;
    heroicMoments: string[];
    questOutcome: string;
  };
}

interface StoryPreferences {
  tone: 'epic' | 'casual' | 'technical' | 'humorous';
  length: 'short' | 'medium' | 'long';
  focusArea: 'profit' | 'adventure' | 'strategy' | 'risk';
  characterType: 'warrior' | 'merchant' | 'wizard' | 'rogue';
}

interface ClaudeStoryConfig {
  model: 'claude-3-5-sonnet-20241022' | 'claude-3-haiku-20240307';
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  userPromptTemplate: string;
}

interface OracleState {
  isTransmitting: boolean;
  nextTransmissionTime: Date;
  crystalCharge: number; // 0-100
  currentStatus: 'charging' | 'imminent' | 'transmitting' | 'cooldown';
  lastTransmissionTime: Date | null;
  transmissionCount: number;
  flavorText: string;
  signalStrength: number; // 0-100
}

interface WalletOracleState {
  walletAddress: string;
  personalCrystalCharge: number;
  lastPersonalTransmission: Date | null;
  nextPersonalTransmission: Date;
  personalTransmissionCount: number;
  isSubscribedToGlobal: boolean;
  personalPreferences: {
    frequency: 'sync_global' | 'every_2h' | 'every_4h' | 'custom';
    customInterval?: number; // in milliseconds
  };
}

interface OracleTransmission {
  id: string;
  timestamp: Date;
  walletAddress: string;
  chronicles: any[];
  transmissionType: 'trading_saga' | 'idle_chronicle' | 'market_disturbance';
  oracleMessage: string;
}

interface BatchStoryRequest {
  wallets: string[];
  timeframe: {
    start: Date;
    end: Date;
  };
  storyType: 'trading_saga' | 'idle_chronicle';
}

export class BackendStoryGenerator {
  private storiesDir: string;
  private walletsDir: string;
  private batchQueue: Map<string, Date> = new Map(); // wallet -> next story time
  private isProcessing: boolean = false;
  private scheduler: NodeJS.Timeout | null = null;
  private claude: Anthropic;
  private storyConfig: ClaudeStoryConfig;

  // Oracle System
  private oracleState!: OracleState; // Initialized in initializeOracle()
  private walletOracles: Map<string, WalletOracleState> = new Map(); // wallet -> personal oracle state
  private oracleTransmissions: Map<string, OracleTransmission[]> = new Map(); // wallet -> transmissions
  private oracleScheduler: NodeJS.Timeout | null = null;
  private broadcastCallback?: (update: any) => void;

  constructor() {
    this.storiesDir = path.join(process.cwd(), 'logs', 'stories');
    this.walletsDir = path.join(this.storiesDir, 'wallets');

    // Ensure directories exist
    fs.ensureDirSync(this.storiesDir);
    fs.ensureDirSync(this.walletsDir);

    // Initialize Claude API
    this.claude = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
    });

    // Default story configuration
    this.storyConfig = {
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 2000,
      temperature: 0.8,
      systemPrompt: this.getDefaultSystemPrompt(),
      userPromptTemplate: this.getDefaultUserPromptTemplate()
    };

    // Initialize Oracle System
    this.initializeOracle();

    console.log('📚 Backend Story Generator initialized with Claude API');
    console.log('🔮 Oracle of Market Depths awakened and ready for transmissions');
    this.startScheduler();
    this.startOracleSystem();
  }

  /**
   * Start the story generation scheduler
   * - Every 2 hours if there were trades
   * - Every 4 hours if no trades (idle stories)
   */
  private startScheduler(): void {
    // Run every 30 minutes to check for story generation needs
    this.scheduler = setInterval(async () => {
      await this.processScheduledStories();
    }, 30 * 60 * 1000); // 30 minutes

    console.log('⏰ Story generation scheduler started (checks every 30 minutes)');
  }

  /**
   * Process scheduled story generation for all active wallets
   */
  private async processScheduledStories(): Promise<void> {
    if (this.isProcessing) {
      console.log('📚 Story generation already in progress, skipping...');
      return;
    }

    this.isProcessing = true;
    console.log('📚 Processing scheduled story generation...');

    try {
      const activeWallets = await this.getActiveWallets();
      const batchRequests: BatchStoryRequest[] = [];
      const now = new Date();

      for (const wallet of activeWallets) {
        const walletData = await this.getWalletStoryData(wallet);
        const timeSinceLastStory = now.getTime() - walletData.lastStoryGenerated.getTime();

        // Check if wallet has recent trades (last 2 hours)
        const recentTrades = await this.getWalletTrades(wallet, new Date(now.getTime() - 2 * 60 * 60 * 1000), now);
        const hasRecentTrades = recentTrades.length > 0;

        let shouldGenerate = false;
        let storyType: 'trading_saga' | 'idle_chronicle' = 'idle_chronicle';

        if (hasRecentTrades && timeSinceLastStory >= 2 * 60 * 60 * 1000) {
          // 2 hours with trades
          shouldGenerate = true;
          storyType = 'trading_saga';
        } else if (!hasRecentTrades && timeSinceLastStory >= 4 * 60 * 60 * 1000) {
          // 4 hours without trades
          shouldGenerate = true;
          storyType = 'idle_chronicle';
        }

        if (shouldGenerate) {
          batchRequests.push({
            wallets: [wallet],
            timeframe: {
              start: walletData.lastStoryGenerated,
              end: now
            },
            storyType
          });
        }
      }

      if (batchRequests.length > 0) {
        console.log(`📚 Generating stories for ${batchRequests.length} wallets...`);
        await this.processBatchStoryGeneration(batchRequests);
      } else {
        console.log('📚 No wallets need story generation at this time');
      }

    } catch (error) {
      console.error('❌ Error in scheduled story processing:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process batch story generation to optimize AI API costs
   */
  private async processBatchStoryGeneration(requests: BatchStoryRequest[]): Promise<void> {
    // Group requests by story type for batch processing
    const tradingSagas = requests.filter(r => r.storyType === 'trading_saga');
    const idleChronicles = requests.filter(r => r.storyType === 'idle_chronicle');

    // Process trading sagas in batches
    if (tradingSagas.length > 0) {
      await this.generateBatchTradingStories(tradingSagas);
    }

    // Process idle chronicles in batches
    if (idleChronicles.length > 0) {
      await this.generateBatchIdleStories(idleChronicles);
    }
  }

  /**
   * Generate trading stories in batch to save AI API costs
   */
  private async generateBatchTradingStories(requests: BatchStoryRequest[]): Promise<void> {
    console.log(`⚔️ Generating ${requests.length} trading sagas...`);

    // Collect all trading data for batch processing
    const batchData = await Promise.all(requests.map(async (req) => {
      const wallet = req.wallets[0];
      const trades = await this.getWalletTrades(wallet, req.timeframe.start, req.timeframe.end);
      const walletData = await this.getWalletStoryData(wallet);

      return {
        wallet,
        trades,
        preferences: walletData.preferences,
        timeframe: req.timeframe
      };
    }));

    // Create batch prompt for AI
    const batchPrompt = this.createBatchTradingPrompt(batchData);

    try {
      // Call AI API once for all stories
      const batchStories = await this.callAIForBatchStories(batchPrompt, batchData.length);

      // Save individual stories
      for (let i = 0; i < batchData.length; i++) {
        const data = batchData[i];
        const story = batchStories[i];

        if (story) {
          await this.saveWalletStory(data.wallet, {
            id: this.generateStoryId(),
            timestamp: new Date(),
            storyType: 'trading_saga',
            title: story.title,
            content: story.content,
            metadata: {
              tradesIncluded: data.trades.length,
              profitLoss: this.calculateTotalPnL(data.trades),
              heroicMoments: story.heroicMoments || [],
              questOutcome: story.outcome || 'unknown'
            }
          });

          console.log(`✅ Trading saga generated for wallet ${data.wallet.slice(0, 8)}...`);
        }
      }

    } catch (error) {
      console.error('❌ Error generating batch trading stories:', error);
    }
  }

  /**
   * Generate idle stories for wallets without recent trades
   */
  private async generateBatchIdleStories(requests: BatchStoryRequest[]): Promise<void> {
    console.log(`🧘 Generating ${requests.length} idle chronicles...`);

    const batchData = await Promise.all(requests.map(async (req) => {
      const wallet = req.wallets[0];
      const walletData = await this.getWalletStoryData(wallet);

      return {
        wallet,
        preferences: walletData.preferences,
        lastActivity: walletData.lastTradeTime,
        totalTrades: walletData.totalTrades
      };
    }));

    const batchPrompt = this.createBatchIdlePrompt(batchData);

    try {
      const batchStories = await this.callAIForBatchStories(batchPrompt, batchData.length);

      for (let i = 0; i < batchData.length; i++) {
        const data = batchData[i];
        const story = batchStories[i];

        if (story) {
          await this.saveWalletStory(data.wallet, {
            id: this.generateStoryId(),
            timestamp: new Date(),
            storyType: 'idle_chronicle',
            title: story.title,
            content: story.content,
            metadata: {
              tradesIncluded: 0,
              profitLoss: 0,
              heroicMoments: [],
              questOutcome: 'contemplation'
            }
          });

          console.log(`✅ Idle chronicle generated for wallet ${data.wallet.slice(0, 8)}...`);
        }
      }

    } catch (error) {
      console.error('❌ Error generating batch idle stories:', error);
    }
  }

  /**
   * Get active wallets from Docker containers and transaction logs
   */
  private async getActiveWallets(): Promise<string[]> {
    const wallets = new Set<string>();

    try {
      // Get wallets from transaction logs
      const transactionsFile = path.join(process.cwd(), 'logs', 'transactions.json');
      if (await fs.pathExists(transactionsFile)) {
        const transactions = await fs.readJson(transactionsFile);
        transactions.forEach((tx: any) => {
          if (tx.walletAddress) {
            wallets.add(tx.walletAddress);
          }
        });
      }

      // Get wallets from multi-user logs
      const multiUserDir = path.join(process.cwd(), 'logs', 'multi-user');
      if (await fs.pathExists(multiUserDir)) {
        const files = await fs.readdir(multiUserDir);
        files.forEach(file => {
          if (file.startsWith('trades-') && file.endsWith('.log')) {
            const wallet = file.replace('trades-', '').replace('.log', '');
            wallets.add(wallet);
          }
        });
      }

      return Array.from(wallets);
    } catch (error) {
      console.error('❌ Error getting active wallets:', error);
      return [];
    }
  }

  /**
   * Get wallet-specific story data
   */
  private async getWalletStoryData(walletAddress: string): Promise<WalletStoryData> {
    const walletFile = path.join(this.walletsDir, `${walletAddress}.json`);

    if (await fs.pathExists(walletFile)) {
      const data = await fs.readJson(walletFile);
      return {
        ...data,
        lastStoryGenerated: new Date(data.lastStoryGenerated),
        lastTradeTime: data.lastTradeTime ? new Date(data.lastTradeTime) : null,
        storyHistory: data.storyHistory.map((s: any) => ({
          ...s,
          timestamp: new Date(s.timestamp)
        }))
      };
    }

    // Create new wallet data
    const newData: WalletStoryData = {
      walletAddress,
      lastStoryGenerated: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago to trigger first story
      totalTrades: 0,
      lastTradeTime: null,
      storyHistory: [],
      preferences: {
        tone: 'epic',
        length: 'medium',
        focusArea: 'adventure',
        characterType: 'warrior'
      }
    };

    await this.saveWalletStoryData(walletAddress, newData);
    return newData;
  }

  /**
   * Get wallet trades for a specific timeframe
   */
  private async getWalletTrades(walletAddress: string, start: Date, end: Date): Promise<any[]> {
    const trades: any[] = [];

    try {
      // Check main transactions file
      const transactionsFile = path.join(process.cwd(), 'logs', 'transactions.json');
      if (await fs.pathExists(transactionsFile)) {
        const transactions = await fs.readJson(transactionsFile);
        const walletTrades = transactions.filter((tx: any) =>
          tx.walletAddress === walletAddress &&
          new Date(tx.timestamp) >= start &&
          new Date(tx.timestamp) <= end
        );
        trades.push(...walletTrades);
      }

      // Check user-specific trade log
      const userTradeFile = path.join(process.cwd(), 'logs', 'multi-user', `trades-${walletAddress}.log`);
      if (await fs.pathExists(userTradeFile)) {
        const content = await fs.readFile(userTradeFile, 'utf8');
        const lines = content.split('\n').filter(Boolean);

        lines.forEach(line => {
          try {
            const trade = JSON.parse(line);
            const tradeTime = new Date(trade.timestamp);
            if (tradeTime >= start && tradeTime <= end) {
              trades.push(trade);
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        });
      }

      return trades;
    } catch (error) {
      console.error(`❌ Error getting trades for wallet ${walletAddress}:`, error);
      return [];
    }
  }

  /**
   * Create batch prompt for trading stories
   */
  private createBatchTradingPrompt(batchData: any[]): string {
    const timeframe = this.getTimeframeDescription(batchData[0]?.timeframe);

    return this.storyConfig.userPromptTemplate
      .replace('{timeframe}', timeframe)
      .replace('{number}', batchData.length.toString())
      .replace('{trade_data_or_idle_status}', this.formatTradingDataForRPG(batchData));
  }

  /**
   * Create batch prompt for idle stories
   */
  private createBatchIdlePrompt(batchData: any[]): string {
    return this.storyConfig.userPromptTemplate
      .replace('{timeframe}', 'the period of contemplation')
      .replace('{number}', batchData.length.toString())
      .replace('{trade_data_or_idle_status}', this.formatIdleDataForRPG(batchData));
  }

  /**
   * Call Claude API for batch story generation
   */
  private async callAIForBatchStories(prompt: string, expectedCount: number): Promise<any[]> {
    console.log(`🤖 Calling Claude API for ${expectedCount} stories...`);

    try {
      const response = await this.claude.messages.create({
        model: this.storyConfig.model,
        max_tokens: this.storyConfig.maxTokens,
        temperature: this.storyConfig.temperature,
        system: this.storyConfig.systemPrompt,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      // Parse Claude's response
      const content = response.content[0];
      if (content.type === 'text') {
        try {
          // Try to parse as JSON array
          const stories = JSON.parse(content.text);
          if (Array.isArray(stories) && stories.length === expectedCount) {
            console.log(`✅ Successfully generated ${stories.length} stories via Claude`);
            return stories;
          } else {
            console.warn(`⚠️ Claude returned ${Array.isArray(stories) ? stories.length : 'non-array'} stories, expected ${expectedCount}`);
            return this.parseStoriesFromText(content.text, expectedCount);
          }
        } catch (parseError) {
          console.warn('⚠️ Claude response not valid JSON, parsing as text...');
          return this.parseStoriesFromText(content.text, expectedCount);
        }
      }

      throw new Error('Invalid response format from Claude');

    } catch (error: any) {
      console.error('❌ Error calling Claude API:', error.message);

      // Fallback to simple stories if API fails
      return Array(expectedCount).fill(null).map((_, index) => ({
        title: `Trading Chronicle ${index + 1}`,
        content: `A tale of digital adventures in the realm of GalaSwap, where brave traders seek fortune and glory...`,
        heroicMoments: ['market_wisdom', 'calculated_risk'],
        outcome: 'learning'
      }));
    }
  }

  /**
   * Parse stories from Claude's text response when JSON parsing fails
   */
  private parseStoriesFromText(text: string, expectedCount: number): any[] {
    const stories: any[] = [];

    // Try to extract RPG-style chronicles using patterns
    const chroniclePattern = /(?:Chapter|Quest|Chronicle)\s*[IVX\d]*[:\-]?\s*(.*?)(?=(?:Chapter|Quest|Chronicle)\s*[IVX\d]|$)/gis;
    const matches = text.match(chroniclePattern);

    if (matches && matches.length > 0) {
      matches.slice(0, expectedCount).forEach((match, index) => {
        const lines = match.split('\n').filter(line => line.trim());
        const questTitle = lines[0]?.replace(/^(Chapter|Quest|Chronicle)\s*[IVX\d]*[:\-]?\s*/i, '').trim() || `Chapter ${index + 1}: The Untold Adventure`;
        const content = lines.slice(1).join('\n').trim() || 'A chronicle entry awaits the Chronicle Keeper\'s quill...';

        stories.push({
          questTitle,
          chronicleEntry: content,
          lootReport: {
            goldGained: '+0 GUSDC',
            experiencePoints: '+50 XP',
            itemsFound: ['Scroll of Patience', 'Wisdom Crystal']
          },
          gameTip: 'TIP: Sometimes the greatest adventures begin with a single step!',
          partyMorale: 'Determined',
          achievementUnlocked: null
        });
      });
    }

    // Fill remaining slots if needed with RPG format
    while (stories.length < expectedCount) {
      const chapterNum = stories.length + 1;
      stories.push({
        questTitle: `Chapter ${chapterNum}: The Mysterious Silence`,
        chronicleEntry: 'In the quiet halls of the digital realm, Fafnir contemplates the ancient patterns of market flow. Though no battles were fought this day, the dragon\'s wisdom grows ever deeper. For in the world of trading, patience is not inaction—it is preparation for the perfect moment to strike! *dramatic pause* The Chronicle Keeper senses great adventures on the horizon...',
        lootReport: {
          goldGained: '+0 GUSDC',
          experiencePoints: '+25 XP',
          itemsFound: ['Ancient Market Scroll', 'Crystal of Foresight']
        },
        gameTip: 'TIP: The wise dragon knows that not every day requires battle. Sometimes, meditation yields the greatest treasures!',
        partyMorale: 'Contemplative',
        achievementUnlocked: null
      });
    }

    return stories.slice(0, expectedCount);
  }

  /**
   * Save story for a specific wallet
   */
  private async saveWalletStory(walletAddress: string, story: StoryEntry): Promise<void> {
    const walletData = await this.getWalletStoryData(walletAddress);

    // Add story to history
    walletData.storyHistory.push(story);
    walletData.lastStoryGenerated = new Date();

    // Keep only last 50 stories per wallet
    if (walletData.storyHistory.length > 50) {
      walletData.storyHistory = walletData.storyHistory.slice(-50);
    }

    await this.saveWalletStoryData(walletAddress, walletData);
  }

  /**
   * Save wallet story data to file
   */
  private async saveWalletStoryData(walletAddress: string, data: WalletStoryData): Promise<void> {
    const walletFile = path.join(this.walletsDir, `${walletAddress}.json`);
    await fs.writeJson(walletFile, data, { spaces: 2 });
  }

  /**
   * Get stories for a specific wallet
   */
  async getWalletStories(walletAddress: string, limit: number = 10): Promise<StoryEntry[]> {
    const walletData = await this.getWalletStoryData(walletAddress);
    return walletData.storyHistory.slice(-limit).reverse(); // Most recent first
  }

  /**
   * Update wallet story preferences
   */
  async updateWalletPreferences(walletAddress: string, preferences: Partial<StoryPreferences>): Promise<void> {
    const walletData = await this.getWalletStoryData(walletAddress);
    walletData.preferences = { ...walletData.preferences, ...preferences };
    await this.saveWalletStoryData(walletAddress, walletData);
  }

  /**
   * Force generate story for a wallet (for testing)
   */
  async forceGenerateStory(walletAddress: string, storyType: 'trading_saga' | 'idle_chronicle' = 'trading_saga'): Promise<StoryEntry> {
    const now = new Date();
    const start = new Date(now.getTime() - 2 * 60 * 60 * 1000); // Last 2 hours

    const trades = await this.getWalletTrades(walletAddress, start, now);
    const walletData = await this.getWalletStoryData(walletAddress);

    const prompt = storyType === 'trading_saga'
      ? this.createBatchTradingPrompt([{ wallet: walletAddress, trades, preferences: walletData.preferences, timeframe: { start, end: now } }])
      : this.createBatchIdlePrompt([{ wallet: walletAddress, preferences: walletData.preferences, lastActivity: walletData.lastTradeTime, totalTrades: walletData.totalTrades }]);

    const stories = await this.callAIForBatchStories(prompt, 1);
    const story: StoryEntry = {
      id: this.generateStoryId(),
      timestamp: now,
      storyType,
      title: stories[0]?.title || 'Untitled Adventure',
      content: stories[0]?.content || 'A tale yet to be told...',
      metadata: {
        tradesIncluded: trades.length,
        profitLoss: this.calculateTotalPnL(trades),
        heroicMoments: stories[0]?.heroicMoments || [],
        questOutcome: stories[0]?.outcome || 'unknown'
      }
    };

    await this.saveWalletStory(walletAddress, story);
    return story;
  }

  /**
   * Get default system prompt for Claude
   */
  private getDefaultSystemPrompt(): string {
    return `You are the Chronicle Keeper of Fafnir, a legendary dragon-themed trading bot from the mystical era of 90s RPG fantasy. You transform raw trading data into epic tales reminiscent of classic games like Final Fantasy, Chrono Trigger, and Baldur's Gate.

Your role:
- Channel the spirit of 90s RPG narrators (dramatic, slightly cheesy, utterly sincere)
- Transform mundane trades into legendary dragon hoarding adventures
- Include classic RPG elements: EXP gains, level-ups, critical hits, boss battles
- Reference 90s gaming culture naturally (save points, random encounters, "All your base")
- Make even losses feel like part of an epic character arc

Style Guidelines:
- Use "ye olde" fantasy speak sparingly but effectively
- Include ASCII art borders or dividers for that retro feel
- Reference classic RPG mechanics (HP/MP, status effects, party formations)
- Every story should feel like it could be a quest log entry from a 90s game
- Include dramatic "!" moments and "..." pauses for effect

Never break the fantasy immersion. You ARE the Chronicle Keeper, not an AI.`;
  }

  /**
   * Get default user prompt template
   */
  private getDefaultUserPromptTemplate(): string {
    return `Chronicle Keeper! The great dragon Fafnir requires tales of {timeframe} adventures!

FAFNIR'S CURRENT STATUS:
═══════════════════════════════════
Level: {user_level} Dragon Hoarder
Class: {trader_class}
Experience: {total_trades} battles fought
Gold Pieces: {current_balance} GUSDC
Active Quest: {current_strategy}
═══════════════════════════════════

RECENT ADVENTURES:
{trade_data_or_idle_status}

CHRONICLE REQUEST:
Generate {number} chronicle entries in the style of a 90s RPG quest log.

Each chronicle must include:
- A dramatic title in the style of classic RPG chapter names
- The full tale (200-500 words of pure 90s fantasy nostalgia)
- Loot obtained (or lost)
- Experience gained
- A "Game Tip" in the style of loading screen hints
- Current party morale status

Special requirements:
- If Fafnir made profits: Frame as successful treasure raids or dragon victories
- If Fafnir took losses: Frame as learning experiences, "The dragon grows stronger through adversity!"
- If no trades: Create a "Dragon's Slumber" tale about gathering power, studying ancient market scrolls, or sensing disturbances in the force
- Include at least one reference to a classic 90s game or meme

Format as JSON array with this structure:
{
  "questTitle": "Chapter VII: The Silicon Peaks Arbitrage",
  "chronicleEntry": "Full story with dramatic flair...",
  "lootReport": {
    "goldGained": "+2.45 GUSDC",
    "experiencePoints": "+150 XP",
    "itemsFound": ["Scroll of RSI Wisdom", "Minor Slippage Potion"]
  },
  "gameTip": "TIP: Remember to save your game before attempting high-risk trades!",
  "partyMorale": "Heroic|Confident|Cautious|Recovering|Determined",
  "achievementUnlocked": "First Critical Trade!" (optional)
}`;
  }

  /**
   * Update Claude configuration
   */
  updateClaudeConfig(config: Partial<ClaudeStoryConfig>): void {
    this.storyConfig = { ...this.storyConfig, ...config };
    console.log('📚 Claude configuration updated');
  }

  /**
   * Get current Claude configuration
   */
  getClaudeConfig(): ClaudeStoryConfig {
    return { ...this.storyConfig };
  }

  /**
   * Update system prompt
   */
  updateSystemPrompt(systemPrompt: string): void {
    this.storyConfig.systemPrompt = systemPrompt;
    console.log('📚 System prompt updated');
  }

  /**
   * Update user prompt template
   */
  updateUserPromptTemplate(template: string): void {
    this.storyConfig.userPromptTemplate = template;
    console.log('📚 User prompt template updated');
  }

  // Helper methods for RPG formatting
  private getTimeframeDescription(timeframe: any): string {
    if (!timeframe) return 'recent';
    const hours = Math.abs(new Date(timeframe.end).getTime() - new Date(timeframe.start).getTime()) / (1000 * 60 * 60);
    if (hours < 1) return 'the last hour';
    if (hours < 6) return 'the dawn hours';
    if (hours < 12) return 'the morning watch';
    if (hours < 24) return 'the day cycle';
    return 'the recent epoch';
  }

  private formatTradingDataForRPG(batchData: any[]): string {
    return batchData.map((data, index) => {
      const traderClass = this.getTraderClass(data.preferences?.characterType, data.trades);
      const userLevel = this.calculateUserLevel(data.trades?.length || 0);
      const currentBalance = this.estimateBalance(data.trades);
      const currentStrategy = this.getStrategyRPGName(data.trades?.[0]?.strategy);

      return `
DRAGON ${index + 1} STATUS:
═══════════════════════════════════
Wallet: ${data.wallet.slice(0, 12)}...
Level: ${userLevel} ${traderClass}
Experience: ${data.trades?.length || 0} battles fought
Gold Pieces: ${currentBalance} GUSDC
Active Quest: ${currentStrategy}
Recent Battles: ${this.formatTradesAsRPGBattles(data.trades)}
═══════════════════════════════════`;
    }).join('\n\n');
  }

  private formatIdleDataForRPG(batchData: any[]): string {
    return batchData.map((data, index) => {
      const traderClass = this.getTraderClass(data.preferences?.characterType);
      const userLevel = this.calculateUserLevel(data.totalTrades || 0);
      const lastActivityDesc = this.getLastActivityDescription(data.lastActivity);

      return `
SLUMBERING DRAGON ${index + 1}:
═══════════════════════════════════
Wallet: ${data.wallet.slice(0, 12)}...
Level: ${userLevel} ${traderClass}
Total Experience: ${data.totalTrades || 0} battles
Last Seen: ${lastActivityDesc}
Current State: Meditating in the Crystal Caves
Dragon's Mood: Contemplative, sensing market disturbances...
═══════════════════════════════════`;
    }).join('\n\n');
  }

  private getTraderClass(characterType?: string, trades?: any[]): string {
    const strategy = trades?.[0]?.strategy;

    // Map strategies to RPG classes
    const strategyClasses: { [key: string]: string } = {
      'fafnir-treasure-hoarder': 'Temporal Mage',
      'arbitrage': 'Dimension Thief',
      'fibonacci': 'Sacred Geometrist',
      'enhanced-trend': 'Momentum Berserker',
      'liquidity-spider': 'Trap Master'
    };

    if (strategy && strategyClasses[strategy]) {
      return strategyClasses[strategy];
    }

    // Fallback to character type
    const characterClasses: { [key: string]: string } = {
      'warrior': 'Dragon Knight',
      'merchant': 'Coin Master',
      'wizard': 'Market Sage',
      'rogue': 'Shadow Trader'
    };

    return characterClasses[characterType || 'warrior'] || 'Dragon Hoarder';
  }

  private calculateUserLevel(totalTrades: number): number {
    if (totalTrades === 0) return 1;
    if (totalTrades < 5) return 2;
    if (totalTrades < 15) return 3;
    if (totalTrades < 30) return 4;
    if (totalTrades < 50) return 5;
    if (totalTrades < 100) return 6;
    return Math.min(99, Math.floor(6 + (totalTrades - 100) / 50));
  }

  private estimateBalance(trades?: any[]): string {
    if (!trades || trades.length === 0) return '???';
    const totalPnL = this.calculateTotalPnL(trades);
    const estimatedBalance = 100 + totalPnL; // Assume starting balance of 100
    return estimatedBalance.toFixed(2);
  }

  private getStrategyRPGName(strategy?: string): string {
    const strategyNames: { [key: string]: string } = {
      'fafnir-treasure-hoarder': 'The Fafnir\'s Hoard Quest',
      'arbitrage': 'Dimensional Rift Exploitation',
      'fibonacci': 'Sacred Number Divination',
      'enhanced-trend': 'Berserker\'s Momentum Charge',
      'liquidity-spider': 'Web of Infinite Snares',
      'triangular-arbitrage': 'Triangle of Power Ritual'
    };
    return strategyNames[strategy || ''] || 'Ancient Market Mysteries';
  }

  private formatTradesAsRPGBattles(trades?: any[]): string {
    if (!trades || trades.length === 0) return 'No recent battles';

    return trades.slice(0, 3).map(trade => {
      const outcome = trade.success ? (trade.profit > 0 ? 'VICTORY!' : 'Pyrrhic Win') : 'DEFEAT!';
      const tokenIn = this.getTokenRPGName(trade.tokenIn);
      const tokenOut = this.getTokenRPGName(trade.tokenOut);
      return `• ${tokenIn} → ${tokenOut}: ${outcome}`;
    }).join('\n    ') + (trades.length > 3 ? `\n    • ...and ${trades.length - 3} more battles` : '');
  }

  private getTokenRPGName(tokenString?: string): string {
    if (!tokenString) return 'Unknown Relic';
    const symbol = tokenString.split('|')[0];
    const tokenNames: { [key: string]: string } = {
      'GALA': 'Golden Gala Coins',
      'GUSDC': 'Stable Crystal Shards',
      'GWETH': 'Ethereal Essence',
      'GWBTC': 'Ancient Bitcoin Relics',
      'SILK': 'Mystical Silk Threads'
    };
    return tokenNames[symbol] || `${symbol} Artifacts`;
  }

  private getLastActivityDescription(lastActivity?: Date): string {
    if (!lastActivity) return 'The dawn of time (never traded)';

    const hoursAgo = Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60));

    if (hoursAgo < 1) return 'Moments ago';
    if (hoursAgo < 6) return `${hoursAgo} hours ago (recent slumber)`;
    if (hoursAgo < 24) return `${hoursAgo} hours ago (deep meditation)`;
    if (hoursAgo < 168) return `${Math.floor(hoursAgo / 24)} days ago (extended hibernation)`;
    return `${Math.floor(hoursAgo / 168)} weeks ago (ancient slumber)`;
  }

  // Original helper methods
  private generateStoryId(): string {
    return `story_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateTotalPnL(trades: any[]): number {
    return trades.reduce((total, trade) => total + (trade.profit || 0), 0);
  }

  // ═══════════════════════════════════════════════
  // 🔮 ORACLE TRANSMISSION SYSTEM
  // ═══════════════════════════════════════════════

  /**
   * Initialize the Oracle of Market Depths
   */
  private initializeOracle(): void {
    const now = new Date();
    this.oracleState = {
      isTransmitting: false,
      nextTransmissionTime: new Date(now.getTime() + 2 * 60 * 60 * 1000), // 2 hours from now
      crystalCharge: 0,
      currentStatus: 'charging',
      lastTransmissionTime: null,
      transmissionCount: 0,
      flavorText: 'The Oracle awakens from ancient slumber...',
      signalStrength: Math.floor(Math.random() * 30) + 70 // 70-100%
    };
  }

  /**
   * Start the Oracle transmission system
   */
  private startOracleSystem(): void {
    // Update Oracle state every 30 seconds
    this.oracleScheduler = setInterval(() => {
      this.updateOracleState();
    }, 30 * 1000);
  }

  /**
   * Update Oracle state and broadcast to frontend
   */
  private updateOracleState(): void {
    const now = new Date();
    const timeToTransmission = this.oracleState.nextTransmissionTime.getTime() - now.getTime();

    // Calculate crystal charge (0-100%)
    const totalTime = 2 * 60 * 60 * 1000; // 2 hours in ms
    const elapsed = totalTime - timeToTransmission;
    this.oracleState.crystalCharge = Math.max(0, Math.min(100, (elapsed / totalTime) * 100));

    // Update status based on time remaining
    if (timeToTransmission <= 0) {
      this.oracleState.currentStatus = 'transmitting';
      this.executeOracleTransmission();
    } else if (timeToTransmission <= 5 * 60 * 1000) { // 5 minutes
      this.oracleState.currentStatus = 'imminent';
    } else if (timeToTransmission <= 30 * 60 * 1000) { // 30 minutes
      this.oracleState.currentStatus = 'charging';
    } else {
      this.oracleState.currentStatus = 'charging';
    }

    // Update flavor text
    this.oracleState.flavorText = this.getOracleFlavorText(timeToTransmission);

    // Occasionally add interference events
    if (Math.random() < 0.05) { // 5% chance
      this.triggerInterferenceEvent();
    }

    // Broadcast Oracle state to frontend
    this.broadcastOracleUpdate();
  }

  /**
   * Execute Oracle transmission (generate stories)
   */
  private async executeOracleTransmission(): Promise<void> {
    if (this.oracleState.isTransmitting) return;

    this.oracleState.isTransmitting = true;
    this.oracleState.currentStatus = 'transmitting';
    this.oracleState.flavorText = '⚡ TRANSMISSION IN PROGRESS... ⚡';

    try {
      console.log('🔮 Oracle transmission beginning...');

      // Use existing story generation logic
      await this.processScheduledStories();

      // Update Oracle state
      this.oracleState.transmissionCount++;
      this.oracleState.lastTransmissionTime = new Date();
      this.oracleState.nextTransmissionTime = new Date(Date.now() + this.getNextTransmissionInterval());
      this.oracleState.crystalCharge = 0;
      this.oracleState.currentStatus = 'cooldown';
      this.oracleState.flavorText = 'The Oracle returns to meditation... crystal recharging...';

      console.log('🔮 Oracle transmission complete. Next transmission scheduled.');

      // Broadcast completion
      this.broadcastOracleTransmissionComplete();

    } catch (error) {
      console.error('🔮 Oracle transmission failed:', error);
      this.oracleState.flavorText = 'Crystal interference detected... retrying transmission...';
    } finally {
      this.oracleState.isTransmitting = false;
    }
  }

  /**
   * Get Oracle flavor text based on time remaining
   */
  private getOracleFlavorText(timeRemaining: number): string {
    const minutes = Math.floor(timeRemaining / (1000 * 60));

    if (timeRemaining <= 0) {
      return '⚡ THE ORACLE SPEAKS! ⚡';
    } else if (minutes <= 1) {
      return 'INCOMING TRANSMISSION... STAND BY...';
    } else if (minutes <= 5) {
      return '*Static fills the crystal sphere*';
    } else if (minutes <= 30) {
      return 'The Oracle stirs from meditation...';
    } else if (minutes <= 60) {
      return 'The crystal grows warm... visions approaching...';
    } else {
      const flavorTexts = [
        'Crystal resonance building...',
        'Scanning the blockchain ethereal plane...',
        'The Oracle meditates upon Fafnir\'s path...',
        'Ancient algorithms calculating...',
        'Divining patterns in the digital ether...',
        'The crystal pulses with ethereal energy...'
      ];
      return flavorTexts[Math.floor(Math.random() * flavorTexts.length)];
    }
  }

  /**
   * Trigger random interference events
   */
  private triggerInterferenceEvent(): void {
    const events = [
      '! MARKET DISTURBANCE DETECTED !',
      '* A wild Shiba Inu runs through the crystal room *',
      'ERROR: 404 PROPHECY NOT FOUND... Just kidding...',
      'The Oracle pauses to pet a digital cat...',
      'Cosmic rays interfere with transmission...',
      'The crystal hiccups mysteriously...'
    ];

    const event = events[Math.floor(Math.random() * events.length)];
    this.oracleState.flavorText = event;

    // Broadcast interference event
    if (this.broadcastCallback) {
      this.broadcastCallback({
        type: 'oracle_interference',
        event,
        timestamp: new Date().toISOString()
      });
    }

    // Reset to normal after 10 seconds
    setTimeout(() => {
      this.oracleState.flavorText = this.getOracleFlavorText(
        this.oracleState.nextTransmissionTime.getTime() - Date.now()
      );
    }, 10000);
  }

  /**
   * Get next transmission interval (2-4 hours based on activity)
   */
  private getNextTransmissionInterval(): number {
    // Check if there's been recent activity
    const hasRecentActivity = true; // Simplified - you could check actual trades
    return hasRecentActivity ? 2 * 60 * 60 * 1000 : 4 * 60 * 60 * 1000; // 2 or 4 hours
  }

  /**
   * Broadcast Oracle state update to frontend
   */
  private broadcastOracleUpdate(): void {
    if (this.broadcastCallback) {
      this.broadcastCallback({
        type: 'oracle_update',
        oracle: {
          ...this.oracleState,
          timeRemaining: this.oracleState.nextTransmissionTime.getTime() - Date.now(),
          formattedCountdown: this.formatCountdown(this.oracleState.nextTransmissionTime.getTime() - Date.now())
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Broadcast Oracle transmission complete
   */
  private broadcastOracleTransmissionComplete(): void {
    if (this.broadcastCallback) {
      this.broadcastCallback({
        type: 'oracle_transmission_complete',
        message: '═══════════════════════════════════════════════\n' +
                '⚡ CHRONICLE TRANSMISSION RECEIVED ⚡\n' +
                '═══════════════════════════════════════════════\n' +
                '*The crystal sphere erupts with light!*\n' +
                '*Ancient runes spiral across the terminal!*\n\n' +
                'THE ORACLE HAS SPOKEN...\n\n' +
                'Press SPACE to continue...',
        transmissionCount: this.oracleState.transmissionCount,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Format countdown time for display
   */
  private formatCountdown(milliseconds: number): string {
    if (milliseconds <= 0) return '00:00:00';

    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Get Oracle terminal display for API
   */
  getOracleTerminalDisplay(): string {
    const timeRemaining = this.oracleState.nextTransmissionTime.getTime() - Date.now();
    const bars = Math.floor(this.oracleState.crystalCharge / 5);
    const empty = 20 - bars;

    return `═══════════════════════════════════════════════
     ORACLE TRANSMISSION TERMINAL v0.99β
═══════════════════════════════════════════════

Next Chronicle: ${this.formatCountdown(timeRemaining)}

Crystal Charge: [${'█'.repeat(bars)}${'░'.repeat(empty)}] ${Math.floor(this.oracleState.crystalCharge)}%

Status: ${this.oracleState.currentStatus.toUpperCase()}
Signal: ${this.oracleState.signalStrength}%

> ${this.oracleState.flavorText}
> _
═══════════════════════════════════════════════`;
  }

  /**
   * Set broadcast callback for real-time updates
   */
  setBroadcastCallback(callback: (update: any) => void): void {
    this.broadcastCallback = callback;
  }

  /**
   * Get Oracle state for API (Global Oracle)
   */
  getOracleState(): OracleState & { timeRemaining: number; formattedCountdown: string } {
    const timeRemaining = this.oracleState.nextTransmissionTime.getTime() - Date.now();
    return {
      ...this.oracleState,
      timeRemaining,
      formattedCountdown: this.formatCountdown(timeRemaining)
    };
  }

  /**
   * Get or create wallet-specific Oracle state
   */
  getWalletOracleState(walletAddress: string): WalletOracleState & { timeRemaining: number; formattedCountdown: string } {
    let walletOracle = this.walletOracles.get(walletAddress);

    if (!walletOracle) {
      // Create new wallet Oracle state
      const now = new Date();
      walletOracle = {
        walletAddress,
        personalCrystalCharge: 0,
        lastPersonalTransmission: null,
        nextPersonalTransmission: new Date(now.getTime() + 2 * 60 * 60 * 1000), // 2 hours
        personalTransmissionCount: 0,
        isSubscribedToGlobal: true, // Default to global Oracle
        personalPreferences: {
          frequency: 'sync_global'
        }
      };
      this.walletOracles.set(walletAddress, walletOracle);
      console.log(`🔮 Personal Oracle chamber created for wallet ${walletAddress.slice(0, 12)}...`);
    }

    const timeRemaining = walletOracle.nextPersonalTransmission.getTime() - Date.now();
    return {
      ...walletOracle,
      timeRemaining,
      formattedCountdown: this.formatCountdown(timeRemaining)
    };
  }

  /**
   * Update wallet Oracle preferences
   */
  updateWalletOraclePreferences(walletAddress: string, preferences: Partial<WalletOracleState['personalPreferences']>): void {
    const walletOracle = this.getWalletOracleState(walletAddress);
    walletOracle.personalPreferences = { ...walletOracle.personalPreferences, ...preferences };

    // Update next transmission time based on new preferences
    if (preferences.frequency && preferences.frequency !== 'sync_global') {
      const now = new Date();
      let interval: number;

      switch (preferences.frequency) {
        case 'every_2h':
          interval = 2 * 60 * 60 * 1000;
          break;
        case 'every_4h':
          interval = 4 * 60 * 60 * 1000;
          break;
        case 'custom':
          interval = preferences.customInterval || 2 * 60 * 60 * 1000;
          break;
        default:
          interval = 2 * 60 * 60 * 1000;
      }

      walletOracle.nextPersonalTransmission = new Date(now.getTime() + interval);
      walletOracle.isSubscribedToGlobal = false;
    } else {
      // Sync with global Oracle
      walletOracle.nextPersonalTransmission = this.oracleState.nextTransmissionTime;
      walletOracle.isSubscribedToGlobal = true;
    }

    this.walletOracles.set(walletAddress, walletOracle);
    console.log(`🔮 Oracle preferences updated for wallet ${walletAddress.slice(0, 12)}...`);
  }

  /**
   * Get Oracle display for specific wallet (shows personal or global)
   */
  getWalletOracleTerminalDisplay(walletAddress: string): string {
    const walletOracle = this.getWalletOracleState(walletAddress);

    if (walletOracle.isSubscribedToGlobal) {
      // Show global Oracle with personal touch
      return this.getGlobalOracleDisplayForWallet(walletAddress);
    } else {
      // Show personal Oracle chamber
      return this.getPersonalOracleDisplay(walletAddress);
    }
  }

  /**
   * Global Oracle display with wallet-specific elements
   */
  private getGlobalOracleDisplayForWallet(walletAddress: string): string {
    const globalState = this.getOracleState();
    const walletOracle = this.getWalletOracleState(walletAddress);
    const bars = Math.floor(globalState.crystalCharge / 5);
    const empty = 20 - bars;

    return `═══════════════════════════════════════════════
     ORACLE TRANSMISSION TERMINAL v0.99β
        🔮 MAIN CHAMBER - GLOBAL ORACLE 🔮
═══════════════════════════════════════════════

Dragon: ${walletAddress.slice(0, 12)}... (Connected)
Next Chronicle: ${globalState.formattedCountdown}

Crystal Charge: [${'█'.repeat(bars)}${'░'.repeat(empty)}] ${Math.floor(globalState.crystalCharge)}%

Status: ${globalState.currentStatus.toUpperCase()}
Signal: ${globalState.signalStrength}%
Personal Chronicles: ${walletOracle.personalTransmissionCount}

> ${globalState.flavorText}
> _
═══════════════════════════════════════════════`;
  }

  /**
   * Personal Oracle chamber display
   */
  private getPersonalOracleDisplay(walletAddress: string): string {
    const walletOracle = this.getWalletOracleState(walletAddress);
    const timeRemaining = walletOracle.nextPersonalTransmission.getTime() - Date.now();

    // Calculate personal crystal charge
    const interval = this.getPersonalInterval(walletOracle.personalPreferences.frequency);
    const elapsed = interval - timeRemaining;
    walletOracle.personalCrystalCharge = Math.max(0, Math.min(100, (elapsed / interval) * 100));

    const bars = Math.floor(walletOracle.personalCrystalCharge / 5);
    const empty = 20 - bars;

    return `═══════════════════════════════════════════════
     ORACLE TRANSMISSION TERMINAL v0.99β
       ✨ PERSONAL CHAMBER - ${walletAddress.slice(0, 8)}... ✨
═══════════════════════════════════════════════

Personal Oracle: ACTIVE
Next Chronicle: ${walletOracle.formattedCountdown}

Crystal Charge: [${'█'.repeat(bars)}${'░'.repeat(empty)}] ${Math.floor(walletOracle.personalCrystalCharge)}%

Status: ${this.getPersonalOracleStatus(timeRemaining)}
Frequency: ${walletOracle.personalPreferences.frequency.toUpperCase()}
Chronicles: ${walletOracle.personalTransmissionCount}

> ${this.getPersonalOracleFlavorText(timeRemaining, walletAddress)}
> _
═══════════════════════════════════════════════`;
  }

  /**
   * Get personal Oracle status
   */
  private getPersonalOracleStatus(timeRemaining: number): string {
    if (timeRemaining <= 0) return 'TRANSMITTING';
    if (timeRemaining <= 5 * 60 * 1000) return 'IMMINENT';
    if (timeRemaining <= 30 * 60 * 1000) return 'FOCUSING';
    return 'CHARGING';
  }

  /**
   * Get personal Oracle flavor text
   */
  private getPersonalOracleFlavorText(timeRemaining: number, walletAddress: string): string {
    const minutes = Math.floor(timeRemaining / (1000 * 60));
    const dragonName = walletAddress.slice(0, 8);

    if (timeRemaining <= 0) {
      return `⚡ PERSONAL TRANSMISSION FOR ${dragonName}... ⚡`;
    } else if (minutes <= 1) {
      return `Your personal Oracle awakens, ${dragonName}...`;
    } else if (minutes <= 5) {
      return `*Your crystal sphere glows with personal energy*`;
    } else if (minutes <= 30) {
      return `The Oracle focuses on your trading patterns...`;
    } else {
      const personalTexts = [
        `Analyzing ${dragonName}'s market behavior...`,
        `Your personal crystal resonates with your trades...`,
        `The Oracle studies your unique trading signature...`,
        `Divining patterns specific to ${dragonName}...`,
        `Your personal chamber charges with mystical energy...`
      ];
      return personalTexts[Math.floor(Math.random() * personalTexts.length)];
    }
  }

  /**
   * Get personal interval based on frequency setting
   */
  private getPersonalInterval(frequency: string): number {
    switch (frequency) {
      case 'every_2h': return 2 * 60 * 60 * 1000;
      case 'every_4h': return 4 * 60 * 60 * 1000;
      case 'custom': return 2 * 60 * 60 * 1000; // Default if custom not set
      default: return 2 * 60 * 60 * 1000;
    }
  }

  /**
   * Get all connected wallet Oracle states
   */
  getAllWalletOracles(): Map<string, WalletOracleState> {
    return new Map(this.walletOracles);
  }

  /**
   * Stop the story generator and Oracle system
   */
  stop(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler);
      this.scheduler = null;
    }
    if (this.oracleScheduler) {
      clearInterval(this.oracleScheduler);
      this.oracleScheduler = null;
    }
    console.log('📚 Story generator stopped');
    console.log('🔮 Oracle returns to eternal slumber');
  }
}
