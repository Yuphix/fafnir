import * as fs from 'fs-extra';
import * as path from 'path';

// Types for trade data service
export interface TradeRecord {
  id: string;
  walletAddress: string;
  strategy: string;
  action: 'buy' | 'sell';
  pair: string;
  amount: number;
  price: string;
  status: 'success' | 'failed' | 'pending';
  transactionId?: string;
  transactionHash?: string;
  galascanUrl?: string;
  timestamp: string;
  profit?: number;
  fees?: number;
  slippage?: number;
}

export interface TradeHistoryRequest {
  type: 'get_trade_history';
  data: {
    walletAddress: string;
    limit?: number;
    offset?: number;
    strategy?: string;
    action?: 'buy' | 'sell';
    status?: 'success' | 'failed' | 'pending';
    dateFrom?: string;
    dateTo?: string;
    sortBy?: 'timestamp' | 'profit' | 'amount';
    sortOrder?: 'asc' | 'desc';
  };
}

export interface TradeAnalytics {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalVolume: number;
  totalPnL: number;
  totalFees: number;
  winRate: number;
  averageTradeSize: number;
  averageProfit: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  averageGalaPrice: number;
  totalGalaBought: number;
  totalGalaSold: number;
  strategiesUsed: string[];
  tradingDays: number;
  tradesPerDay: number;
}

export interface TradeHistoryResponse {
  type: 'trade_history_response';
  data: {
    trades: TradeRecord[];
    total: number;
    hasMore: boolean;
    analytics: TradeAnalytics;
    filters: {
      walletAddress: string;
      strategy?: string;
      dateRange?: {
        from: string;
        to: string;
      };
    };
  };
}

export interface TradeExportRequest {
  type: 'export_trade_history';
  data: {
    walletAddress: string;
    format: 'csv' | 'excel' | 'json';
    strategy?: string;
    dateFrom?: string;
    dateTo?: string;
    includeAnalytics?: boolean;
  };
}

export interface TradeExportResponse {
  type: 'trade_export_response';
  data: {
    downloadUrl: string;
    filename: string;
    fileSize: number;
    format: string;
    recordCount: number;
  };
}

/**
 * Trade Data Service - Handles all trade history storage, retrieval, and analytics
 */
export class TradeDataService {
  private readonly dataDir: string;
  private readonly tradesFile: string;
  private readonly exportsDir: string;
  private tradeHistory: Map<string, TradeRecord[]> = new Map(); // walletAddress -> trades

  constructor() {
    this.dataDir = path.join(process.cwd(), 'data', 'trades');
    this.tradesFile = path.join(this.dataDir, 'trade-history.json');
    this.exportsDir = path.join(process.cwd(), 'exports');

    this.initializeDirectories();
    this.loadTradeHistory();
  }

  private async initializeDirectories(): Promise<void> {
    await fs.ensureDir(this.dataDir);
    await fs.ensureDir(this.exportsDir);
  }

  /**
   * Store a new trade record
   */
  async storeTrade(trade: Omit<TradeRecord, 'id'>): Promise<TradeRecord> {
    const tradeRecord: TradeRecord = {
      ...trade,
      id: this.generateTradeId()
    };

    // Add to in-memory storage
    if (!this.tradeHistory.has(trade.walletAddress)) {
      this.tradeHistory.set(trade.walletAddress, []);
    }

    const userTrades = this.tradeHistory.get(trade.walletAddress)!;
    userTrades.push(tradeRecord);

    // Sort by timestamp (newest first)
    userTrades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Persist to file
    await this.saveTradeHistory();

    console.log(`💾 Stored trade: ${trade.action} ${trade.amount} ${trade.pair} for ${trade.walletAddress}`);

    return tradeRecord;
  }

  /**
   * Get trade history for a wallet with filtering and pagination
   */
  async getTradeHistory(request: TradeHistoryRequest['data']): Promise<TradeHistoryResponse['data']> {
    const {
      walletAddress,
      limit = 50,
      offset = 0,
      strategy,
      action,
      status,
      dateFrom,
      dateTo,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = request;

    let trades = this.tradeHistory.get(walletAddress) || [];

    // Apply filters
    if (strategy) {
      trades = trades.filter(t => t.strategy === strategy);
    }

    if (action) {
      trades = trades.filter(t => t.action === action);
    }

    if (status) {
      trades = trades.filter(t => t.status === status);
    }

    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      trades = trades.filter(t => new Date(t.timestamp) >= fromDate);
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      trades = trades.filter(t => new Date(t.timestamp) <= toDate);
    }

    // Sort trades
    trades.sort((a, b) => {
      let aValue: any, bValue: any;

      switch (sortBy) {
        case 'profit':
          aValue = a.profit || 0;
          bValue = b.profit || 0;
          break;
        case 'amount':
          aValue = a.amount;
          bValue = b.amount;
          break;
        case 'timestamp':
        default:
          aValue = new Date(a.timestamp).getTime();
          bValue = new Date(b.timestamp).getTime();
          break;
      }

      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
    });

    const total = trades.length;
    const paginatedTrades = trades.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    // Calculate analytics
    const analytics = this.calculateAnalytics(trades);

    return {
      trades: paginatedTrades,
      total,
      hasMore,
      analytics,
      filters: {
        walletAddress,
        strategy,
        dateRange: dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined
      }
    };
  }

  /**
   * Export trade history to different formats
   */
  async exportTradeHistory(request: TradeExportRequest['data']): Promise<TradeExportResponse['data']> {
    const {
      walletAddress,
      format,
      strategy,
      dateFrom,
      dateTo,
      includeAnalytics = true
    } = request;

    // Get filtered trades
    const historyRequest: TradeHistoryRequest['data'] = {
      walletAddress,
      limit: 10000, // Get all trades
      strategy,
      dateFrom,
      dateTo
    };

    const historyData = await this.getTradeHistory(historyRequest);
    const { trades, analytics } = historyData;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `trades_${walletAddress.replace(/[|:]/g, '_')}_${timestamp}`;

    let exportData: any;
    let filePath: string;

    switch (format) {
      case 'csv':
        filePath = path.join(this.exportsDir, `${filename}.csv`);
        exportData = this.generateCSV(trades, includeAnalytics ? analytics : undefined);
        await fs.writeFile(filePath, exportData, 'utf8');
        break;

      case 'excel':
        filePath = path.join(this.exportsDir, `${filename}.xlsx`);
        // For now, generate CSV and note that Excel support could be added with a library like xlsx
        exportData = this.generateCSV(trades, includeAnalytics ? analytics : undefined);
        await fs.writeFile(filePath.replace('.xlsx', '.csv'), exportData, 'utf8');
        filePath = filePath.replace('.xlsx', '.csv');
        break;

      case 'json':
      default:
        filePath = path.join(this.exportsDir, `${filename}.json`);
        exportData = JSON.stringify({
          trades,
          analytics: includeAnalytics ? analytics : undefined,
          exportedAt: new Date().toISOString(),
          walletAddress,
          filters: { strategy, dateFrom, dateTo }
        }, null, 2);
        await fs.writeFile(filePath, exportData, 'utf8');
        break;
    }

    const stats = await fs.stat(filePath);
    const downloadUrl = `/exports/${path.basename(filePath)}`;

    return {
      downloadUrl,
      filename: path.basename(filePath),
      fileSize: stats.size,
      format: format === 'excel' ? 'csv' : format, // Update if we actually implement Excel
      recordCount: trades.length
    };
  }

  /**
   * Calculate comprehensive analytics for trades
   */
  private calculateAnalytics(trades: TradeRecord[]): TradeAnalytics {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        successfulTrades: 0,
        failedTrades: 0,
        totalVolume: 0,
        totalPnL: 0,
        totalFees: 0,
        winRate: 0,
        averageTradeSize: 0,
        averageProfit: 0,
        averageLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        averageGalaPrice: 0,
        totalGalaBought: 0,
        totalGalaSold: 0,
        strategiesUsed: [],
        tradingDays: 0,
        tradesPerDay: 0
      };
    }

    const successfulTrades = trades.filter(t => t.status === 'success');
    const failedTrades = trades.filter(t => t.status === 'failed');
    const profitableTrades = trades.filter(t => (t.profit || 0) > 0);
    const losingTrades = trades.filter(t => (t.profit || 0) < 0);

    const totalVolume = trades.reduce((sum, t) => sum + t.amount, 0);
    const totalPnL = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
    const totalFees = trades.reduce((sum, t) => sum + (t.fees || 0), 0);

    const buyTrades = trades.filter(t => t.action === 'buy');
    const sellTrades = trades.filter(t => t.action === 'sell');

    const galaTrades = trades.filter(t => t.pair.includes('GALA'));
    const galaPrices = galaTrades.map(t => parseFloat(t.price)).filter(p => p > 0);
    const averageGalaPrice = galaPrices.length > 0 ?
      galaPrices.reduce((sum, p) => sum + p, 0) / galaPrices.length : 0;

    const totalGalaBought = buyTrades
      .filter(t => t.pair.includes('GALA'))
      .reduce((sum, t) => sum + t.amount, 0);

    const totalGalaSold = sellTrades
      .filter(t => t.pair.includes('GALA'))
      .reduce((sum, t) => sum + t.amount, 0);

    const strategiesUsed = [...new Set(trades.map(t => t.strategy))];

    // Calculate trading days
    const tradeDates = [...new Set(trades.map(t =>
      new Date(t.timestamp).toDateString()
    ))];
    const tradingDays = tradeDates.length;

    const profits = profitableTrades.map(t => t.profit || 0);
    const losses = losingTrades.map(t => Math.abs(t.profit || 0));

    return {
      totalTrades: trades.length,
      successfulTrades: successfulTrades.length,
      failedTrades: failedTrades.length,
      totalVolume,
      totalPnL,
      totalFees,
      winRate: trades.length > 0 ? (profitableTrades.length / trades.length) * 100 : 0,
      averageTradeSize: totalVolume / trades.length,
      averageProfit: profits.length > 0 ? profits.reduce((sum, p) => sum + p, 0) / profits.length : 0,
      averageLoss: losses.length > 0 ? losses.reduce((sum, l) => sum + l, 0) / losses.length : 0,
      largestWin: profits.length > 0 ? Math.max(...profits) : 0,
      largestLoss: losses.length > 0 ? Math.max(...losses) : 0,
      averageGalaPrice,
      totalGalaBought,
      totalGalaSold,
      strategiesUsed,
      tradingDays,
      tradesPerDay: tradingDays > 0 ? trades.length / tradingDays : 0
    };
  }

  /**
   * Generate CSV export data
   */
  private generateCSV(trades: TradeRecord[], analytics?: TradeAnalytics): string {
    const headers = [
      'ID', 'Timestamp', 'Strategy', 'Action', 'Pair', 'Amount', 'Price',
      'Status', 'Profit', 'Fees', 'Transaction Hash', 'GalaScan URL'
    ];

    let csv = headers.join(',') + '\n';

    trades.forEach(trade => {
      const row = [
        trade.id,
        trade.timestamp,
        trade.strategy,
        trade.action,
        trade.pair,
        trade.amount,
        trade.price,
        trade.status,
        trade.profit || 0,
        trade.fees || 0,
        trade.transactionHash || '',
        trade.galascanUrl || ''
      ];

      // Escape commas in values
      const escapedRow = row.map(value =>
        typeof value === 'string' && value.includes(',') ? `"${value}"` : value
      );

      csv += escapedRow.join(',') + '\n';
    });

    // Add analytics section if provided
    if (analytics) {
      csv += '\n\nAnalytics:\n';
      csv += `Total Trades,${analytics.totalTrades}\n`;
      csv += `Successful Trades,${analytics.successfulTrades}\n`;
      csv += `Win Rate,${analytics.winRate.toFixed(2)}%\n`;
      csv += `Total PnL,${analytics.totalPnL.toFixed(6)}\n`;
      csv += `Total Volume,${analytics.totalVolume.toFixed(6)}\n`;
      csv += `Average GALA Price,${analytics.averageGalaPrice.toFixed(6)}\n`;
      csv += `Strategies Used,"${analytics.strategiesUsed.join(', ')}"\n`;
      csv += `Trading Days,${analytics.tradingDays}\n`;
      csv += `Trades Per Day,${analytics.tradesPerDay.toFixed(2)}\n`;
    }

    return csv;
  }

  /**
   * Load trade history from persistent storage
   */
  private async loadTradeHistory(): Promise<void> {
    try {
      if (await fs.pathExists(this.tradesFile)) {
        const data = await fs.readJSON(this.tradesFile);

        // Convert array data to Map structure
        if (Array.isArray(data)) {
          // Old format - convert to new format
          data.forEach((trade: TradeRecord) => {
            if (!this.tradeHistory.has(trade.walletAddress)) {
              this.tradeHistory.set(trade.walletAddress, []);
            }
            this.tradeHistory.get(trade.walletAddress)!.push(trade);
          });
        } else if (data && typeof data === 'object') {
          // New format - Map structure
          Object.entries(data).forEach(([walletAddress, trades]) => {
            this.tradeHistory.set(walletAddress, trades as TradeRecord[]);
          });
        }

        console.log(`📊 Loaded trade history for ${this.tradeHistory.size} wallets`);
      }
    } catch (error) {
      console.error('Error loading trade history:', error);
    }
  }

  /**
   * Save trade history to persistent storage
   */
  private async saveTradeHistory(): Promise<void> {
    try {
      const data: { [walletAddress: string]: TradeRecord[] } = {};

      this.tradeHistory.forEach((trades, walletAddress) => {
        data[walletAddress] = trades;
      });

      await fs.writeJSON(this.tradesFile, data, { spaces: 2 });
    } catch (error) {
      console.error('Error saving trade history:', error);
    }
  }

  /**
   * Generate unique trade ID
   */
  private generateTradeId(): string {
    return `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get wallet trade summary
   */
  async getWalletSummary(walletAddress: string): Promise<{
    totalTrades: number;
    totalPnL: number;
    winRate: number;
    activeStrategies: string[];
    lastTradeDate: string | null;
  }> {
    const trades = this.tradeHistory.get(walletAddress) || [];
    const analytics = this.calculateAnalytics(trades);

    return {
      totalTrades: analytics.totalTrades,
      totalPnL: analytics.totalPnL,
      winRate: analytics.winRate,
      activeStrategies: analytics.strategiesUsed,
      lastTradeDate: trades.length > 0 ? trades[0].timestamp : null
    };
  }

  /**
   * Clean up old export files (older than 24 hours)
   */
  async cleanupExports(): Promise<void> {
    try {
      const files = await fs.readdir(this.exportsDir);
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

      for (const file of files) {
        const filePath = path.join(this.exportsDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime.getTime() < oneDayAgo) {
          await fs.remove(filePath);
          console.log(`🗑️ Cleaned up old export file: ${file}`);
        }
      }
    } catch (error) {
      console.error('Error cleaning up exports:', error);
    }
  }
}
