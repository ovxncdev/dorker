import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import crypto from 'node:crypto';

/**
 * Read file line by line with streaming (memory efficient for large files)
 */
export async function* readLines(filePath: string): AsyncGenerator<string> {
  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      yield trimmed;
    }
  }
}

/**
 * Count lines in a file efficiently
 */
export async function countLines(filePath: string): Promise<number> {
  let count = 0;
  for await (const _ of readLines(filePath)) {
    count++;
  }
  return count;
}

/**
 * Load all lines from a file into array
 */
export async function loadLines(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * Chunk array into smaller arrays
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate unique ID
 */
export function generateId(prefix = ''): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format number with thousand separators
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Format percentage
 */
export function formatPercent(value: number, total: number): string {
  if (total === 0) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * Truncate string to specified length
 */
export function truncate(str: string, length: number, suffix = '...'): string {
  if (str.length <= length) return str;
  return str.substring(0, length - suffix.length) + suffix;
}

/**
 * Sanitize filename (remove invalid characters)
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 200);
}

/**
 * Parse proxy string into components
 */
export interface ParsedProxy {
  host: string;
  port: string;
  username?: string;
  password?: string;
  type: 'http' | 'https' | 'socks4' | 'socks5';
}

export function parseProxy(proxyString: string): ParsedProxy | null {
  const trimmed = proxyString.trim();
  if (!trimmed) return null;

  // Pattern for protocol://user:pass@host:port or protocol://host:port
  const urlPattern = /^(https?|socks[45]):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/i;
  
  // Pattern for user:pass@host:port
  const authPattern = /^([^:]+):([^@]+)@([^:]+):(\d+)$/;
  
  // Pattern for host:port:user:pass
  const colonPattern = /^([^:]+):(\d+):([^:]+):(.+)$/;
  
  // Pattern for host:port
  const simplePattern = /^([^:]+):(\d+)$/;

  let match: RegExpMatchArray | null;

  // Try URL pattern
  match = trimmed.match(urlPattern);
  if (match) {
    return {
      type: match[1]!.toLowerCase() as ParsedProxy['type'],
      username: match[2],
      password: match[3],
      host: match[4]!,
      port: match[5]!,
    };
  }

  // Try auth pattern
  match = trimmed.match(authPattern);
  if (match) {
    return {
      type: 'http',
      username: match[1],
      password: match[2],
      host: match[3]!,
      port: match[4]!,
    };
  }

  // Try colon pattern
  match = trimmed.match(colonPattern);
  if (match) {
    return {
      type: 'http',
      host: match[1]!,
      port: match[2]!,
      username: match[3],
      password: match[4],
    };
  }

  // Try simple pattern
  match = trimmed.match(simplePattern);
  if (match) {
    return {
      type: 'http',
      host: match[1]!,
      port: match[2]!,
    };
  }

  return null;
}

/**
 * Validate URL format
 */
export function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extract domain from URL
 */
export function extractDomain(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    return url.hostname;
  } catch {
    return null;
  }
}

/**
 * Retry async function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries) {
        await sleep(delay);
        delay = Math.min(delay * backoffFactor, maxDelay);
      }
    }
  }

  throw lastError;
}

/**
 * Create a deferred promise
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Rate limiter
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }

    const waitTime = ((1 - this.tokens) / this.refillRate) * 1000;
    await sleep(waitTime);
    this.tokens = 0;
  }

  tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens--;
      return true;
    }

    return false;
  }
}

/**
 * Simple event throttler
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): T {
  let lastCall = 0;
  let timeout: NodeJS.Timeout | null = null;
  let lastArgs: Parameters<T> | null = null;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = limit - (now - lastCall);

    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      lastCall = now;
      return fn(...args);
    } else {
      lastArgs = args;
      if (!timeout) {
        timeout = setTimeout(() => {
          lastCall = Date.now();
          timeout = null;
          if (lastArgs) {
            fn(...lastArgs);
          }
        }, remaining);
      }
    }
  }) as T;
}

/**
 * Simple debouncer
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  wait: number
): T {
  let timeout: NodeJS.Timeout | null = null;

  return ((...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      fn(...args);
    }, wait);
  }) as T;
}

/**
 * Get file size
 */
export async function getFileSize(filePath: string): Promise<number> {
  const stats = await stat(filePath);
  return stats.size;
}

/**
 * Check if file exists and is readable
 */
export async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Calculate ETA based on progress
 */
export function calculateETA(
  completed: number,
  total: number,
  elapsedMs: number
): number {
  if (completed === 0) return 0;
  const rate = completed / elapsedMs;
  const remaining = total - completed;
  return remaining / rate;
}

/**
 * Moving average calculator
 */
export class MovingAverage {
  private values: number[] = [];
  private readonly windowSize: number;

  constructor(windowSize: number) {
    this.windowSize = windowSize;
  }

  push(value: number): void {
    this.values.push(value);
    if (this.values.length > this.windowSize) {
      this.values.shift();
    }
  }

  get average(): number {
    if (this.values.length === 0) return 0;
    const sum = this.values.reduce((a, b) => a + b, 0);
    return sum / this.values.length;
  }

  get count(): number {
    return this.values.length;
  }

  reset(): void {
    this.values = [];
  }
}
