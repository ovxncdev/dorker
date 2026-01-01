/**
 * Logger Utility
 * Structured logging with Winston
 */

import winston from 'winston';
import path from 'path';
import fs from 'fs';
import type { LoggingSettings } from '../types/index.js';

// Custom log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

// Colors for console output
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  trace: 'gray',
};

winston.addColors(colors);

// Custom format for console
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} ${level}: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Custom format for file (JSON)
const fileFormatJson = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Custom format for file (text)
const fileFormatText = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` | ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Logger class
class Logger {
  private logger: winston.Logger;
  private settings: LoggingSettings;
  private logDir: string;

  constructor(settings?: Partial<LoggingSettings>) {
    this.settings = {
      level: 'info',
      console: true,
      file: true,
      directory: './output/logs',
      maxFiles: 10,
      maxSize: '10m',
      format: 'json',
      ...settings,
    };

    this.logDir = this.settings.directory;
    this.ensureLogDir();
    this.logger = this.createLogger();
  }

  private ensureLogDir(): void {
    if (this.settings.file && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private createLogger(): winston.Logger {
    const transports: winston.transport[] = [];

    // Console transport
    if (this.settings.console) {
      transports.push(
        new winston.transports.Console({
          format: consoleFormat,
        })
      );
    }

    // File transports
    if (this.settings.file) {
      const fileFormat = this.settings.format === 'json' ? fileFormatJson : fileFormatText;
      const extension = this.settings.format === 'json' ? 'json' : 'log';

      // Combined log
      transports.push(
        new winston.transports.File({
          filename: path.join(this.logDir, `combined.${extension}`),
          format: fileFormat,
          maxsize: this.parseSize(this.settings.maxSize),
          maxFiles: this.settings.maxFiles,
          tailable: true,
        })
      );

      // Error log
      transports.push(
        new winston.transports.File({
          filename: path.join(this.logDir, `error.${extension}`),
          level: 'error',
          format: fileFormat,
          maxsize: this.parseSize(this.settings.maxSize),
          maxFiles: this.settings.maxFiles,
          tailable: true,
        })
      );
    }

    return winston.createLogger({
      levels,
      level: this.settings.level,
      transports,
      exitOnError: false,
    });
  }

  private parseSize(size: string): number {
    const match = size.match(/^(\d+)(k|m|g)?$/i);
    if (!match) return 10 * 1024 * 1024; // Default 10MB

    const num = parseInt(match[1], 10);
    const unit = (match[2] || '').toLowerCase();

    switch (unit) {
      case 'k':
        return num * 1024;
      case 'm':
        return num * 1024 * 1024;
      case 'g':
        return num * 1024 * 1024 * 1024;
      default:
        return num;
    }
  }

  // Log methods
  error(message: string, meta?: Record<string, unknown>): void {
    this.logger.error(message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.logger.info(message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.logger.debug(message, meta);
  }

  trace(message: string, meta?: Record<string, unknown>): void {
    this.logger.log('trace', message, meta);
  }

  // Specialized log methods
  taskStart(taskId: string, dork: string, page: number): void {
    this.debug('Task started', { taskId, dork, page });
  }

  taskComplete(taskId: string, urlCount: number, latency: number): void {
    this.info('Task completed', { taskId, urlCount, latency });
  }

  taskFailed(taskId: string, error: string): void {
    this.error('Task failed', { taskId, error });
  }

  taskBlocked(taskId: string, reason: string, proxy: string): void {
    this.warn('Task blocked', { taskId, reason, proxy });
  }

  proxyAlive(proxyId: string, latency: number): void {
    this.debug('Proxy alive', { proxyId, latency });
  }

  proxyDead(proxyId: string, error: string): void {
    this.warn('Proxy dead', { proxyId, error });
  }

  proxyQuarantined(proxyId: string, duration: number): void {
    this.warn('Proxy quarantined', { proxyId, duration });
  }

  searchResult(dork: string, page: number, urlCount: number): void {
    this.info('Search result', { dork, page, urlCount });
  }

  captchaDetected(proxy: string, dork: string): void {
    this.warn('CAPTCHA detected', { proxy, dork });
  }

  rateLimited(proxy: string): void {
    this.warn('Rate limited', { proxy });
  }

  engineReady(version: string, workers: number, proxies: number): void {
    this.info('Engine ready', { version, workers, proxies });
  }

  engineStopped(stats: Record<string, unknown>): void {
    this.info('Engine stopped', stats);
  }

  stats(stats: Record<string, unknown>): void {
    this.info('Statistics', stats);
  }

  // Change log level
  setLevel(level: string): void {
    this.logger.level = level;
    this.settings.level = level as LoggingSettings['level'];
  }

  // Get current level
  getLevel(): string {
    return this.logger.level;
  }

  // Silence all output
  silence(): void {
    this.logger.silent = true;
  }

  // Resume output
  unsilence(): void {
    this.logger.silent = false;
  }

  // Create child logger with default meta
  child(meta: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, meta);
  }

  // Get underlying winston logger
  getWinstonLogger(): winston.Logger {
    return this.logger;
  }
}

// Child logger with default metadata
class ChildLogger {
  constructor(
    private parent: Logger,
    private meta: Record<string, unknown>
  ) {}

  private mergeMeta(additional?: Record<string, unknown>): Record<string, unknown> {
    return { ...this.meta, ...additional };
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.parent.error(message, this.mergeMeta(meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.parent.warn(message, this.mergeMeta(meta));
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.parent.info(message, this.mergeMeta(meta));
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.parent.debug(message, this.mergeMeta(meta));
  }

  trace(message: string, meta?: Record<string, unknown>): void {
    this.parent.trace(message, this.mergeMeta(meta));
  }
}

// Singleton instance
let loggerInstance: Logger | null = null;

/**
 * Get or create logger instance
 */
export function getLogger(settings?: Partial<LoggingSettings>): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger(settings);
  }
  return loggerInstance;
}

/**
 * Create a new logger instance (non-singleton)
 */
export function createLogger(settings?: Partial<LoggingSettings>): Logger {
  return new Logger(settings);
}

/**
 * Reset the singleton logger
 */
export function resetLogger(): void {
  loggerInstance = null;
}

// Export types and class
export { Logger, ChildLogger };
export default getLogger;
