import { TradeRecord } from './trade-data-service.js';

export interface Position {
  pair: string;
  baseToken: string;
  quoteToken: string;
  totalBaseAmount: number;
  totalQuoteAmount: number;
  averagePrice: string;
  unrealizedPnL: number;
  realizedPnL: number;
  totalFees: number;
  entryCount: number;
  exitCount: number;
  netPosition: number; // Positive = long, negative = short, 0 = flat
  lastTradeTime: string;
  firstTradeTime: string;
}

export interface PositionUpdate {
  type: 'position_update';
  data: {
    walletAddress: string;
    strategy: string;
    positions: Position[];
    totalPortfolioValue: number;
    totalPnL: number;
    totalFees: number;
    summary: {
      totalTrades: number;
      winningTrades: number;
      losingTrades: number;
      winRate: number;
      averageWin: number;
      averageLoss: number;
      largestWin: number;
      largestLoss: number;
    };
    lastUpdate: string;
  };
}

export interface PositionRequest {
  type: 'get_positions' | 'subscribe_positions';
  data?: {
    walletAddress?: string;
    strategy?: string;
    pair?: string;
  };
}

export class PositionTracker {
  private positions: Map<string, Map<string, Position>> = new Map(); // walletAddress -> pair -> Position
  private subscribers: Set<any> = new Set(); // WebSocket connections

  constructor() {
    console.log('🎯 Position Tracker initialized');
  }

  /**
   * Update position based on a trade
   */
  updatePosition(trade: TradeRecord): Position | null {
    const key = `${trade.walletAddress}`;
    const pair = trade.pair;

    if (!this.positions.has(key)) {
      this.positions.set(key, new Map());
    }

    const userPositions = this.positions.get(key)!;
    let position = userPositions.get(pair);

    if (!position) {
      // Create new position
      const [baseToken, quoteToken] = pair.split('/');
      position = {
        pair,
        baseToken,
        quoteToken,
        totalBaseAmount: 0,
        totalQuoteAmount: 0,
        averagePrice: '0',
        unrealizedPnL: 0,
        realizedPnL: 0,
        totalFees: trade.fees || 0,
        entryCount: 0,
        exitCount: 0,
        netPosition: 0,
        lastTradeTime: trade.timestamp,
        firstTradeTime: trade.timestamp
      };
    }

    // Update position based on trade action
    if (trade.action === 'buy') {
      position.totalBaseAmount += trade.amount;
      position.totalQuoteAmount += parseFloat(trade.price) * trade.amount;
      position.entryCount++;
      position.netPosition += trade.amount;
    } else if (trade.action === 'sell') {
      position.totalBaseAmount -= trade.amount;
      position.exitCount++;
      position.netPosition -= trade.amount;
      // Add to realized PnL
      if (trade.profit !== undefined) {
        position.realizedPnL += trade.profit;
      }
    }

    // Update average price
    if (position.totalBaseAmount > 0) {
      position.averagePrice = (position.totalQuoteAmount / position.totalBaseAmount).toFixed(6);
    }

    // Update fees
    position.totalFees += trade.fees || 0;
    position.lastTradeTime = trade.timestamp;

    userPositions.set(pair, position);

    // Broadcast position update
    this.broadcastPositionUpdate(trade.walletAddress, trade.strategy);

    return position;
  }

  /**
   * Get positions for a wallet
   */
  getPositions(walletAddress: string, strategy?: string): Position[] {
    const userPositions = this.positions.get(walletAddress);
    if (!userPositions) return [];

    return Array.from(userPositions.values());
  }

  /**
   * Calculate portfolio summary
   */
  getPortfolioSummary(walletAddress: string): PositionUpdate['data'] {
    const positions = this.getPositions(walletAddress);

    const totalPnL = positions.reduce((sum, pos) => sum + pos.realizedPnL + pos.unrealizedPnL, 0);
    const totalFees = positions.reduce((sum, pos) => sum + pos.totalFees, 0);
    const totalTrades = positions.reduce((sum, pos) => sum + pos.entryCount + pos.exitCount, 0);

    const winningPositions = positions.filter(pos => pos.realizedPnL > 0);
    const losingPositions = positions.filter(pos => pos.realizedPnL < 0);

    return {
      walletAddress,
      strategy: 'all', // Could be filtered
      positions,
      totalPortfolioValue: 0, // Would need current market prices
      totalPnL,
      totalFees,
      summary: {
        totalTrades,
        winningTrades: winningPositions.length,
        losingTrades: losingPositions.length,
        winRate: totalTrades > 0 ? (winningPositions.length / totalTrades) * 100 : 0,
        averageWin: winningPositions.length > 0 ?
          winningPositions.reduce((sum, pos) => sum + pos.realizedPnL, 0) / winningPositions.length : 0,
        averageLoss: losingPositions.length > 0 ?
          losingPositions.reduce((sum, pos) => sum + pos.realizedPnL, 0) / losingPositions.length : 0,
        largestWin: Math.max(...winningPositions.map(pos => pos.realizedPnL), 0),
        largestLoss: Math.min(...losingPositions.map(pos => pos.realizedPnL), 0)
      },
      lastUpdate: new Date().toISOString()
    };
  }

  /**
   * Subscribe to position updates
   */
  subscribe(ws: any): void {
    this.subscribers.add(ws);
    console.log(`📡 Position tracker subscriber added (${this.subscribers.size} total)`);
  }

  /**
   * Unsubscribe from position updates
   */
  unsubscribe(ws: any): void {
    this.subscribers.delete(ws);
    console.log(`📡 Position tracker subscriber removed (${this.subscribers.size} total)`);
  }

  /**
   * Broadcast position update to all subscribers
   */
  private broadcastPositionUpdate(walletAddress: string, strategy: string): void {
    const summary = this.getPortfolioSummary(walletAddress);

    const update: PositionUpdate = {
      type: 'position_update',
      data: {
        ...summary,
        strategy
      }
    };

    this.subscribers.forEach(ws => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        // Only send to authenticated users or specific wallet
        const wsWalletAddress = (ws as any).walletAddress;
        if (!wsWalletAddress || wsWalletAddress === walletAddress) {
          ws.send(JSON.stringify(update));
        }
      }
    });

    console.log(`🎯 Position update broadcasted for ${walletAddress} (${this.subscribers.size} subscribers)`);
  }
}
