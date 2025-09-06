import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { ipKeyGenerator } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

import fs from 'fs-extra';
import path from 'path';

/**
 * Security Manager for Fafnir Bot API
 * Provides authentication, authorization, and rate limiting
 */

export interface SecurityConfig {
  apiKeys: string[];
  adminApiKeys: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  corsOrigins: string[];
  enableHttps: boolean;
  sessionSecret: string;
}

export class SecurityManager {
  private config: SecurityConfig;
  private activeSessions: Set<string> = new Set();

  constructor() {
    this.config = {
      apiKeys: this.loadApiKeys(),
      adminApiKeys: this.loadAdminApiKeys(),
      rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000), // 15 minutes
      rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
      corsOrigins: this.loadCorsOrigins(),
      enableHttps: process.env.ENABLE_HTTPS === 'true',
      sessionSecret: process.env.SESSION_SECRET || this.generateSecret()
    };

    console.log('🔐 Security Manager initialized');
    console.log(`📊 Rate limiting: ${this.config.rateLimitMaxRequests} requests per ${this.config.rateLimitWindowMs/60000} minutes`);
    console.log(`🌐 CORS origins: ${this.config.corsOrigins.join(', ')}`);
  }

  // Load API keys from environment
  private loadApiKeys(): string[] {
    // Support single user key via FAFNIR_USER_API_KEY
    const keys = [];
    if (process.env.FAFNIR_USER_API_KEY) {
      keys.push(process.env.FAFNIR_USER_API_KEY);
    }
    if (process.env.API_KEYS) {
      keys.push(...process.env.API_KEYS.split(','));
    }
    // Try to load from config.json if env vars are not set
    if (keys.length === 0) {
      try {
        const configPath = path.join(process.cwd(), 'config.json');
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (config.userApiKey) {
            keys.push(config.userApiKey);
          }
          if (config.apiKeys && Array.isArray(config.apiKeys)) {
            keys.push(...config.apiKeys);
          }
        }
      } catch (err) {
        console.warn('⚠️  Could not load user API key from config.json:', err);
      }
    }
    if (keys.length === 0) {
      const defaultKey = this.generateApiKey();
      console.warn('⚠️  No API keys configured. Generated default key:', defaultKey);
      return [defaultKey];
    }
    return keys.map(key => key.trim());
  }

  // Load admin API keys from environment
  private loadAdminApiKeys(): string[] {
    // Support single admin key via FAFNIR_ADMIN_API_KEY
    const adminKeys = [];
    if (process.env.FAFNIR_ADMIN_API_KEY) {
      adminKeys.push(process.env.FAFNIR_ADMIN_API_KEY);
    }
    if (process.env.ADMIN_API_KEYS) {
      adminKeys.push(...process.env.ADMIN_API_KEYS.split(','));
    }
    // Try to load from config.json if env vars are not set
    if (adminKeys.length === 0) {
      try {
        const configPath = path.join(process.cwd(), 'config.json');
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (config.adminApiKey) {
            adminKeys.push(config.adminApiKey);
          }
          if (config.adminApiKeys && Array.isArray(config.adminApiKeys)) {
            adminKeys.push(...config.adminApiKeys);
          }
        }
      } catch (err) {
        console.warn('⚠️  Could not load admin API key from config.json:', err);
      }
    }
    if (adminKeys.length === 0) {
      const defaultAdminKey = this.generateApiKey();
      console.warn('⚠️  No admin API keys configured. Generated default admin key:', defaultAdminKey);
      return [defaultAdminKey];
    }
    return adminKeys.map(key => key.trim());
  }

  // Load CORS origins from environment
  private loadCorsOrigins(): string[] {
    const defaultOrigins = [
      'https://yuphix.io',
      'http://yuphix.io',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'file://' // Allow file:// protocol for local development
    ];
    const origins = process.env.CORS_ORIGINS?.split(',') || defaultOrigins;
    return origins.map(origin => origin.trim());
  }

  // Generate secure API key
  generateApiKey(): string {
    return 'fafnir_' + crypto.randomBytes(32).toString('hex');
  }

  // Generate session-based API key for authenticated wallet users
  generateSessionApiKey(walletAddress: string, duration: number = 24 * 60 * 60 * 1000): string {
    const sessionData = {
      wallet: walletAddress,
      created: Date.now(),
      expires: Date.now() + duration
    };

    // Create session API key
    const sessionKey = `session_${crypto.randomBytes(16).toString('hex')}_${walletAddress.slice(-6)}`;
    this.activeSessions.add(sessionKey);

    // Log session creation
    this.auditLog('SESSION_CREATED', 'system', {
      wallet: walletAddress,
      sessionKey: sessionKey.substring(0, 15) + '...',
      duration: duration
    });

    return sessionKey;
  }

  // Validate wallet-based session API key
  validateSessionApiKey(apiKey: string): boolean {
    if (!apiKey.startsWith('session_')) {
      return false;
    }

    return this.activeSessions.has(apiKey);
  }

  // Revoke session API key
  revokeSessionApiKey(apiKey: string): void {
    this.activeSessions.delete(apiKey);
    this.auditLog('SESSION_REVOKED', 'system', {
      sessionKey: apiKey.substring(0, 15) + '...'
    });
  }

  // Generate session secret
  private generateSecret(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  // API Key Authentication Middleware
  authenticateApiKey = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'] as string || req.query.api_key as string;

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required',
        code: 'MISSING_API_KEY'
      });
    }

    // Check if it's a session API key
    if (apiKey.startsWith('session_')) {
      if (!this.validateSessionApiKey(apiKey)) {
        console.warn(`🚨 Invalid session key attempt: ${apiKey.substring(0, 15)}...`);
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired session',
          code: 'INVALID_SESSION'
        });
      }
      // Session keys have user role by default
      (req as any).userRole = 'user';
      (req as any).apiKey = apiKey;
      (req as any).isSession = true;
    } else {
      // Regular API key validation
      if (!this.config.apiKeys.includes(apiKey) && !this.config.adminApiKeys.includes(apiKey)) {
        console.warn(`🚨 Invalid API key attempt: ${apiKey.substring(0, 10)}...`);
        return res.status(401).json({
          success: false,
          error: 'Invalid API key',
          code: 'INVALID_API_KEY'
        });
      }

      // Add user role to request
      (req as any).userRole = this.config.adminApiKeys.includes(apiKey) ? 'admin' : 'user';
      (req as any).apiKey = apiKey;
      (req as any).isSession = false;
    }

    next();
  };

  // Admin-only operations middleware
  requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if ((req as any).userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }
    next();
  };

  // Rate limiting middleware
  createRateLimiter() {
    return rateLimit({
      windowMs: this.config.rateLimitWindowMs,
      max: this.config.rateLimitMaxRequests,
      message: {
        success: false,
        error: 'Too many requests, please try again later',
        code: 'RATE_LIMIT_EXCEEDED'
      },
      standardHeaders: true,
      legacyHeaders: false,
            keyGenerator: (req: Request) => {
        // Use API key for rate limiting if available
        const apiKey = req.headers['x-api-key'] as string || req.query.api_key as string;
        if (apiKey) {
          return apiKey;
        }

        // Use express-rate-limit's secure IPv6-compatible IP generator
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        return ipKeyGenerator(ip);
      }
    });
  }

  // CORS configuration
  getCorsOptions() {
    return {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);

        if (this.config.corsOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.warn(`🚨 CORS blocked origin: ${origin}`);
          callback(new Error('Not allowed by CORS'), false);
        }
      },
      credentials: true,
      optionsSuccessStatus: 200
    };
  }

  // WebSocket authentication
  authenticateWebSocket(request: any): { authenticated: boolean; userRole?: string; apiKey?: string } {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const apiKey = url.searchParams.get('api_key') || request.headers['x-api-key'];

    if (!apiKey) {
      return { authenticated: false };
    }

    if (this.config.adminApiKeys.includes(apiKey)) {
      return { authenticated: true, userRole: 'admin', apiKey };
    }

    if (this.config.apiKeys.includes(apiKey)) {
      return { authenticated: true, userRole: 'user', apiKey };
    }

    return { authenticated: false };
  }

  // Security headers middleware
  securityHeaders = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'");

    if (this.config.enableHttps) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  };

  // Audit logging
  auditLog(action: string, user: string, details: any = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      action,
      user: user.substring(0, 10) + '...', // Partial API key for identification
      details,
      ip: details.ip || 'unknown'
    };

    console.log(`🔍 AUDIT: ${action} by ${logEntry.user}`, details);

  // Save to audit log file
  const auditLogPath = path.join(process.cwd(), 'logs', 'audit.log');

  fs.ensureDirSync(path.dirname(auditLogPath));
  fs.appendFileSync(auditLogPath, JSON.stringify(logEntry) + '\n');
  }

  // Validate configuration changes
  validateConfigChange(changes: any, userRole: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Admin-only settings
    const adminOnlySettings = ['dryRun', 'maxDailyLoss', 'maxPositionSize'];

    if (userRole !== 'admin') {
      for (const setting of adminOnlySettings) {
        if (changes.hasOwnProperty(setting)) {
          errors.push(`Only admins can modify ${setting}`);
        }
      }
    }

    // Safety limits for non-admin users
    if (userRole !== 'admin') {
      if (changes.minSwapAmount && changes.minSwapAmount > 50) {
        errors.push('Non-admin users cannot set minSwapAmount above $50');
      }
      if (changes.maxSwapAmount && changes.maxSwapAmount > 500) {
        errors.push('Non-admin users cannot set maxSwapAmount above $500');
      }
      if (changes.profitThreshold && changes.profitThreshold < 25) {
        errors.push('Non-admin users cannot set profit threshold below 25bps');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Generate new API key (admin only)
  generateNewApiKey(type: 'user' | 'admin' = 'user'): string {
    const newKey = this.generateApiKey();

    if (type === 'admin') {
      this.config.adminApiKeys.push(newKey);
    } else {
      this.config.apiKeys.push(newKey);
    }

    return newKey;
  }

  // Revoke API key
  revokeApiKey(apiKey: string): boolean {
    const userIndex = this.config.apiKeys.indexOf(apiKey);
    const adminIndex = this.config.adminApiKeys.indexOf(apiKey);

    if (userIndex !== -1) {
      this.config.apiKeys.splice(userIndex, 1);
      return true;
    }

    if (adminIndex !== -1) {
      this.config.adminApiKeys.splice(adminIndex, 1);
      return true;
    }

    return false;
  }
}

export const securityManager = new SecurityManager();
