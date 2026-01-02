/**
 * Task Scheduler
 * Coordinates dork processing with adaptive concurrency
 */

import { EventEmitter } from 'events';
import { getEngine, Engine } from './engine.js';
import { getTaskQueue, TaskQueue, TaskPriority } from './taskQueue.js';
import { getLogger } from '../utils/logger.js';
import type { EngineConfig, ResultMessage, ErrorMessage, StatusMessage } from '../types/index.js';

const logger = getLogger();

// Scheduler options
export interface SchedulerOptions {
  initialConcurrency: number;
  minConcurrency: number;
  maxConcurrency: number;
  pagesPerDork: number;
  maxRetries: number;
  adaptiveConcurrency: boolean;
  blockThreshold: number;
  captchaThreshold: number;
}

const DEFAULT_OPTIONS: SchedulerOptions = {
  initialConcurrency: 100,
  minConcurrency: 10,
  maxConcurrency: 500,
  pagesPerDork: 5,
  maxRetries: 3,
  adaptiveConcurrency: true,
  blockThreshold: 0.1,
  captchaThreshold: 0.05,
};

// Scheduler statistics
export interface SchedulerStats {
  totalDorks: number;
  completedDorks: number;
  failedDorks: number;
  totalUrls: number;
  uniqueUrls: number;
  requestsPerMin: number;
  urlsPerMin: number;
  successRate: number;
  currentConcurrency: number;
  blockCount: number;
  captchaCount: number;
  elapsed: number;
  eta: string;
  startTime: Date;
}

// Dork state
interface DorkState {
  dork: string;
  currentPage: number;
  maxPages: number;
  urls: string[];
  retries: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

export class Scheduler extends EventEmitter {
  private options: SchedulerOptions;
  private engine: Engine;
  private queue: TaskQueue;
  private dorkStates: Map<string, DorkState> = new Map();
  private stats: SchedulerStats;
  private running: boolean = false;
  private paused: boolean = false;
  private startTime: Date | null = null;
  private recentRequests: number[] = [];
  private recentUrls: number[] = [];

  constructor(options: Partial<SchedulerOptions> = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.engine = getEngine();
    this.queue = getTaskQueue();
    this.stats = this.initStats();
  }

  private initStats(): SchedulerStats {
    return {
      totalDorks: 0,
      completedDorks: 0,
      failedDorks: 0,
      totalUrls: 0,
      uniqueUrls: 0,
      requestsPerMin: 0,
      urlsPerMin: 0,
      successRate: 0,
      currentConcurrency: this.options.initialConcurrency,
      blockCount: 0,
      captchaCount: 0,
      elapsed: 0,
      eta: 'calculating...',
      startTime: new Date(),
    };
  }

  /**
   * Start processing dorks
   */
  async start(dorks: string[], config: EngineConfig): Promise<void> {
    if (this.running) {
      throw new Error('Scheduler already running');
    }

    this.running = true;
    this.paused = false;
    this.startTime = new Date();
    this.stats = this.initStats();
    this.stats.totalDorks = dorks.length;
    this.stats.startTime = this.startTime;

    logger.info('Scheduler starting', {
      dorks: dorks.length,
      concurrency: this.options.initialConcurrency,
      pagesPerDork: this.options.pagesPerDork,
    });

    // Initialize dork states
    for (const dork of dorks) {
      this.dorkStates.set(dork, {
        dork,
        currentPage: 0,
        maxPages: this.options.pagesPerDork,
        urls: [],
        retries: 0,
        status: 'pending',
      });
    }

    // Start engine
    try {
      await this.engine.start(config);
    } catch (error) {
      this.running = false;
      throw error;
    }

    // Setup engine event handlers
    this.setupEngineHandlers();

    // Start processing
    this.processQueue(dorks);

    // Start stats update interval
    this.startStatsInterval();
  }

  /**
   * Setup engine event handlers
   */
  private setupEngineHandlers(): void {
    this.engine.on('result', (result: ResultMessage) => {
      this.handleResult(result);
    });

    this.engine.on('error', (error: ErrorMessage) => {
      this.handleError(error);
    });

    this.engine.on('status', (status: StatusMessage) => {
      this.handleStatus(status);
    });

    this.engine.on('exit', () => {
      if (this.running) {
        logger.error('Engine exited unexpectedly');
        this.emit('engineExit');
      }
    });
  }

  /**
   * Process the queue
   */
  private async processQueue(dorks: string[]): Promise<void> {
    // Add initial dorks to queue
    for (const dork of dorks) {
      this.queue.add({
        id: `${dork}:0`,
        dork,
        page: 0,
        priority: TaskPriority.NORMAL,
        retries: 0,
      });
    }

    // Process until complete
    while (this.running && !this.isComplete()) {
      if (this.paused) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      const task = this.queue.next();
      if (!task) {
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }

      // Send to engine
      const state = this.dorkStates.get(task.dork);
      if (state) {
        state.status = 'running';
      }

      this.engine.search(task.id, task.dork, task.page);
      this.recentRequests.push(Date.now());
    }

    // Complete
    this.running = false;
    this.emit('complete', this.stats);
    logger.info('Scheduler completed', { stats: JSON.stringify(this.stats) });
  }

  /**
   * Handle search result
   */
  private handleResult(result: ResultMessage): void {
    const [dork, pageStr] = result.id.split(':');
    const page = parseInt(pageStr, 10);
    const state = this.dorkStates.get(dork);

    if (!state) {
      logger.warn('Result for unknown dork', { id: result.id });
      return;
    }

    // Add URLs
    if (result.urls && result.urls.length > 0) {
      state.urls.push(...result.urls);
      this.stats.totalUrls += result.urls.length;
      this.recentUrls.push(Date.now());
      this.emit('result', dork, result.urls);
    }

    // Check if more pages needed
    if (result.has_next && page + 1 < state.maxPages) {
      // Queue next page
      this.queue.add({
        id: `${dork}:${page + 1}`,
        dork,
        page: page + 1,
        priority: TaskPriority.HIGH, // Prioritize continuation
        retries: 0,
      });
      state.currentPage = page + 1;
    } else {
      // Dork complete
      state.status = 'completed';
      this.stats.completedDorks++;
      this.stats.uniqueUrls += state.urls.length;
      this.emit('dorkComplete', dork, state.urls);
    }

    this.updateStats();
    this.emitProgress();
  }

  /**
   * Handle error
   */
  private handleError(error: ErrorMessage): void {
    const [dork, pageStr] = error.id.split(':');
    const page = parseInt(pageStr, 10);
    const state = this.dorkStates.get(dork);

    if (!state) {
      logger.warn('Error for unknown dork', { id: error.id });
      return;
    }

    logger.debug('Search error', { dork, page, error: error.error });

    // Check error type
    if (error.error.includes('blocked') || error.error.includes('429')) {
      this.stats.blockCount++;
      this.emit('blocked', dork, error.error);
      this.adjustConcurrency('block');
    } else if (error.error.includes('captcha') || error.error.includes('unusual traffic')) {
      this.stats.captchaCount++;
      this.emit('captcha', dork, error.error);
      this.adjustConcurrency('captcha');
    }

    // Retry logic
    if (state.retries < this.options.maxRetries) {
      state.retries++;
      this.queue.add({
        id: `${dork}:${page}`,
        dork,
        page,
        priority: TaskPriority.LOW, // Lower priority for retries
        retries: state.retries,
      });
    } else {
      // Max retries reached
      state.status = 'failed';
      state.error = error.error;
      this.stats.failedDorks++;
      this.emit('dorkFailed', dork, error.error);
    }

    this.emit('error', dork, error.error);
    this.updateStats();
    this.emitProgress();
  }

  /**
   * Handle status update
   */
  private handleStatus(status: StatusMessage): void {
    if (status.proxy_stats) {
      this.emit('proxyStatus', status.proxy_stats);
    }
  }

  /**
   * Adjust concurrency based on errors
   */
  private adjustConcurrency(reason: 'block' | 'captcha'): void {
    if (!this.options.adaptiveConcurrency) return;

    const reduction = reason === 'captcha' ? 0.3 : 0.1;
    const newConcurrency = Math.max(
      this.options.minConcurrency,
      Math.floor(this.stats.currentConcurrency * (1 - reduction))
    );

    if (newConcurrency !== this.stats.currentConcurrency) {
      logger.info('Adjusting concurrency', {
        reason,
        from: this.stats.currentConcurrency,
        to: newConcurrency,
      });
      this.stats.currentConcurrency = newConcurrency;
      this.emit('concurrencyChange', newConcurrency);
    }
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Clean old entries
    this.recentRequests = this.recentRequests.filter(t => t > oneMinuteAgo);
    this.recentUrls = this.recentUrls.filter(t => t > oneMinuteAgo);

    // Calculate rates
    this.stats.requestsPerMin = this.recentRequests.length;
    this.stats.urlsPerMin = this.recentUrls.length;

    // Calculate success rate
    const totalProcessed = this.stats.completedDorks + this.stats.failedDorks;
    this.stats.successRate = totalProcessed > 0
      ? (this.stats.completedDorks / totalProcessed) * 100
      : 0;

    // Calculate elapsed and ETA
    if (this.startTime) {
      this.stats.elapsed = now - this.startTime.getTime();

      if (this.stats.completedDorks > 0 && this.stats.requestsPerMin > 0) {
        const remaining = this.stats.totalDorks - this.stats.completedDorks;
        const avgTimePerDork = this.stats.elapsed / this.stats.completedDorks;
        const etaMs = remaining * avgTimePerDork;
        this.stats.eta = this.formatDuration(etaMs);
      }
    }
  }

  /**
   * Format duration
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Emit progress event
   */
  private emitProgress(): void {
    this.emit('progress', { ...this.stats });
  }

  /**
   * Start stats update interval
   */
  private startStatsInterval(): void {
    const interval = setInterval(() => {
      if (!this.running) {
        clearInterval(interval);
        return;
      }
      this.updateStats();
      this.emitProgress();
    }, 1000);
  }

  /**
   * Check if processing is complete
   */
  private isComplete(): boolean {
    if (this.queue.size() > 0) return false;

    for (const state of this.dorkStates.values()) {
      if (state.status === 'pending' || state.status === 'running') {
        return false;
      }
    }

    return true;
  }

  /**
   * Pause processing
   */
  pause(): void {
    this.paused = true;
    this.engine.pause();
    this.emit('paused');
    logger.info('Scheduler paused');
  }

  /**
   * Resume processing
   */
  resume(): void {
    this.paused = false;
    this.engine.resume();
    this.emit('resumed');
    logger.info('Scheduler resumed');
  }

  /**
   * Stop processing
   */
  async stop(): Promise<void> {
    this.running = false;
    await this.engine.stop();
    this.emit('stopped', this.stats);
    logger.info('Scheduler stopped');
  }

  /**
   * Get current stats
   */
  getStats(): SchedulerStats {
    return { ...this.stats };
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Check if paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Get pending dorks
   */
  getPendingDorks(): string[] {
    const pending: string[] = [];
    for (const [dork, state] of this.dorkStates) {
      if (state.status === 'pending' || state.status === 'running') {
        pending.push(dork);
      }
    }
    return pending;
  }

  /**
   * Get completed dorks
   */
  getCompletedDorks(): string[] {
    const completed: string[] = [];
    for (const [dork, state] of this.dorkStates) {
      if (state.status === 'completed') {
        completed.push(dork);
      }
    }
    return completed;
  }

  /**
   * Get failed dorks
   */
  getFailedDorks(): Array<{ dork: string; error: string }> {
    const failed: Array<{ dork: string; error: string }> = [];
    for (const [dork, state] of this.dorkStates) {
      if (state.status === 'failed') {
        failed.push({ dork, error: state.error || 'Unknown error' });
      }
    }
    return failed;
  }
}

// Singleton instance
let schedulerInstance: Scheduler | null = null;

export function getScheduler(options?: Partial<SchedulerOptions>): Scheduler {
  if (!schedulerInstance) {
    schedulerInstance = new Scheduler(options);
  }
  return schedulerInstance;
}

export async function resetScheduler(): Promise<void> {
  if (schedulerInstance) {
    if (schedulerInstance.isRunning()) {
      await schedulerInstance.stop();
    }
    schedulerInstance = null;
  }
}

export default Scheduler;
