import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import cors from 'cors';

/**
 * Real-Time Fafnir Bot Web Dashboard Server
 * 
 * Features:
 * - Live Docker logs streaming
 * - Real-time trading metrics
 * - Interactive controls (start/stop/restart)
 * - Position tracking
 * - Pool monitoring
 * - Trade history
 */

interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  strategy?: string;
  pool?: string;
  profit?: number;
  volume?: number;
}

interface DashboardData {
  status: 'running' | 'stopped' | 'error';
  strategy: string;
  uptime: number;
  totalProfit: number;
  totalVolume: number;
  trades: number;
  positions: any[];
  pools: any[];
  logs: LogEntry[];
  lastUpdate: number;
}

export class WebDashboardServer {
  private app: express.Application;
  private server: any;
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private dashboardData: DashboardData;
  private logWatcher: any;
  
  constructor(private port: number = 3001) {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    
    this.dashboardData = {
      status: 'stopped',
      strategy: 'fibonacci',
      uptime: 0,
      totalProfit: 0,
      totalVolume: 0,
      trades: 0,
      positions: [],
      pools: [],
      logs: [],
      lastUpdate: Date.now()
    };
    
    this.setupExpress();
    this.setupWebSocket();
    this.startLogWatching();
  }
  
  private setupExpress() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../dashboard-ui')));
    
    // API Routes
    this.app.get('/api/status', (req, res) => {
      res.json(this.dashboardData);
    });
    
    this.app.post('/api/control/:action', async (req, res) => {
      const { action } = req.params;
      
      try {
        switch (action) {
          case 'start':
            await this.startBot();
            break;
          case 'stop':
            await this.stopBot();
            break;
          case 'restart':
            await this.restartBot();
            break;
          default:
            return res.status(400).json({ error: 'Invalid action' });
        }
        
        res.json({ success: true, action });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    this.app.get('/api/logs/:limit?', (req, res) => {
      const limit = parseInt(req.params.limit || '100');
      const logs = this.dashboardData.logs.slice(-limit);
      res.json(logs);
    });
    
    this.app.get('/api/positions', (req, res) => {
      res.json(this.dashboardData.positions);
    });
    
    // Serve React app
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../dashboard-ui/index.html'));
    });
  }
  
  private setupWebSocket() {
    this.wss.on('connection', (ws) => {
      console.log('📱 Dashboard client connected');
      this.clients.add(ws);
      
      // Send current data immediately
      ws.send(JSON.stringify({
        type: 'data',
        payload: this.dashboardData
      }));
      
      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('📱 Dashboard client disconnected');
      });
      
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message.toString());
          await this.handleClientMessage(data, ws);
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });
    });
  }
  
  private async handleClientMessage(data: any, ws: WebSocket) {
    switch (data.type) {
      case 'control':
        if (data.action === 'start') await this.startBot();
        if (data.action === 'stop') await this.stopBot();
        if (data.action === 'restart') await this.restartBot();
        break;
        
      case 'getLogs':
        const logs = this.dashboardData.logs.slice(-100);
        ws.send(JSON.stringify({ type: 'logs', payload: logs }));
        break;
    }
  }
  
  private startLogWatching() {
    // Watch Docker logs for fafnir-bot-fibonacci
    this.logWatcher = spawn('docker', ['logs', '-f', '--tail', '50', 'fafnir-bot-fibonacci'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    this.logWatcher.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        this.processLogLine(line.trim());
      }
    });
    
    this.logWatcher.stderr.on('data', (data: Buffer) => {
      console.error('Docker logs error:', data.toString());
    });
    
    // Also watch position files
    this.watchPositionFiles();
    
    // Update dashboard every 5 seconds
    setInterval(() => {
      this.updateDashboardData();
      this.broadcastToClients();
    }, 5000);
  }
  
  private processLogLine(line: string) {
    if (!line || line.includes('npm notice')) return;
    
    const timestamp = Date.now();
    let level: LogEntry['level'] = 'info';
    let strategy = 'fibonacci';
    let pool: string | undefined;
    let profit: number | undefined;
    let volume: number | undefined;
    
    // Parse different log types
    if (line.includes('✅') || line.includes('💰')) level = 'success';
    if (line.includes('⚠️') || line.includes('❌')) level = 'warn';
    if (line.includes('Error') || line.includes('failed')) level = 'error';
    
    // Extract pool information
    const poolMatch = line.match(/(?:GALA\/\\w+|\\w+\/GALA)/);
    if (poolMatch) pool = poolMatch[0];
    
    // Extract profit information
    const profitMatch = line.match(/profit[^\\d]*([\\d.-]+)/i);
    if (profitMatch) profit = parseFloat(profitMatch[1]);
    
    // Extract volume information
    const volumeMatch = line.match(/volume[^\\d]*([\\d.-]+)/i);
    if (volumeMatch) volume = parseFloat(volumeMatch[1]);
    
    const logEntry: LogEntry = {
      timestamp,
      level,
      message: line,
      strategy,
      pool,
      profit,
      volume
    };
    
    this.dashboardData.logs.push(logEntry);
    
    // Keep only last 500 logs
    if (this.dashboardData.logs.length > 500) {
      this.dashboardData.logs = this.dashboardData.logs.slice(-500);
    }
    
    // Update metrics
    if (profit) this.dashboardData.totalProfit += profit;
    if (volume) this.dashboardData.totalVolume += volume;
    if (line.includes('executed')) this.dashboardData.trades++;
    
    // Broadcast to clients
    this.broadcastToClients();
  }
  
  private watchPositionFiles() {
    const positionFile = path.join(process.cwd(), 'logs', 'fibonacci-positions.json');
    
    setInterval(async () => {
      try {
        if (await fs.pathExists(positionFile)) {
          const data = await fs.readJson(positionFile);
          this.dashboardData.positions = data.positions || [];
        }
      } catch (error) {
        // File doesn't exist yet
      }
    }, 10000);
  }
  
  private updateDashboardData() {
    // Update bot status
    this.checkBotStatus();
    
    // Update timestamp
    this.dashboardData.lastUpdate = Date.now();
  }
  
  private async checkBotStatus() {
    try {
      const result = spawn('docker', ['ps', '--filter', 'name=fafnir-bot-fibonacci', '--format', 'table {{.Status}}'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      result.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        if (output.includes('Up')) {
          this.dashboardData.status = 'running';
        } else {
          this.dashboardData.status = 'stopped';
        }
      });
    } catch (error) {
      this.dashboardData.status = 'error';
    }
  }
  
  private broadcastToClients() {
    const message = JSON.stringify({
      type: 'data',
      payload: this.dashboardData
    });
    
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
  
  private async startBot() {
    return new Promise((resolve, reject) => {
      const process = spawn('docker-compose', ['-f', 'docker-compose.fibonacci.yml', 'up', '-d'], {
        cwd: process.cwd()
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          this.dashboardData.status = 'running';
          resolve(true);
        } else {
          reject(new Error(`Failed to start bot: exit code ${code}`));
        }
      });
    });
  }
  
  private async stopBot() {
    return new Promise((resolve, reject) => {
      const process = spawn('docker-compose', ['-f', 'docker-compose.fibonacci.yml', 'down'], {
        cwd: process.cwd()
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          this.dashboardData.status = 'stopped';
          resolve(true);
        } else {
          reject(new Error(`Failed to stop bot: exit code ${code}`));
        }
      });
    });
  }
  
  private async restartBot() {
    await this.stopBot();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    await this.startBot();
  }
  
  public start() {
    this.server.listen(this.port, () => {
      console.log(`🚀 Fafnir Bot Dashboard running at http://localhost:${this.port}`);
      console.log(`📊 WebSocket server ready for real-time updates`);
    });
  }
  
  public stop() {
    if (this.logWatcher) {
      this.logWatcher.kill();
    }
    
    this.clients.forEach(client => client.close());
    this.wss.close();
    this.server.close();
  }
}

// Start the dashboard server if run directly
if (require.main === module) {
  const dashboard = new WebDashboardServer(3001);
  dashboard.start();
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down dashboard...');
    dashboard.stop();
    process.exit(0);
  });
}
