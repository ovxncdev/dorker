import { readFile, writeFile, access, constants, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { StatsData, DorkEntry } from './types.js';

export interface CheckpointData {
  version: string;
  createdAt: number;
  updatedAt: number;
  sessionId: string;
  
  // Configuration
  dorksFile: string;
  proxiesFile: string;
  outputDir: string;
  
  // Progress
  totalDorks: number;
  completedDorks: string[];
  failedDorks: string[];
  pendingDorks: string[];
  
  // Statistics
  stats: StatsData;
  
  // Results
  urlsFound: number;
  outputFiles: string[];
}

export class CheckpointManager {
  private checkpointPath: string;
  private data: CheckpointData | null = null;
  private saveInterval: NodeJS.Timeout | null = null;
  private dirty = false;
  private readonly SAVE_INTERVAL_MS = 10000;

  constructor(outputDir: string, sessionId?: string) {
    const id = sessionId || `session_${Date.now()}`;
    this.checkpointPath = path.join(outputDir, `.checkpoint_${id}.json`);
  }

  async init(
    dorksFile: string,
    proxiesFile: string,
    outputDir: string,
    allDorks: string[]
  ): Promise<void> {
    this.data = {
      version: '1.0.0',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: path.basename(this.checkpointPath, '.json'),
      dorksFile,
      proxiesFile,
      outputDir,
      totalDorks: allDorks.length,
      completedDorks: [],
      failedDorks: [],
      pendingDorks: [...allDorks],
      stats: {
        tasks_total: allDorks.length,
        tasks_completed: 0,
        tasks_failed: 0,
        tasks_pending: allDorks.length,
        urls_found: 0,
        captcha_count: 0,
        block_count: 0,
        proxies_alive: 0,
        proxies_dead: 0,
        requests_per_sec: 0,
        elapsed_ms: 0,
        eta_ms: 0,
      },
      urlsFound: 0,
      outputFiles: [],
    };

    await this.save();
    this.startAutoSave();
  }

  async load(): Promise<CheckpointData | null> {
    try {
      await access(this.checkpointPath, constants.R_OK);
      const content = await readFile(this.checkpointPath, 'utf-8');
      this.data = JSON.parse(content) as CheckpointData;
      this.startAutoSave();
      return this.data;
    } catch {
      return null;
    }
  }

  async save(): Promise<void> {
    if (!this.data) return;

    this.data.updatedAt = Date.now();
    const content = JSON.stringify(this.data, null, 2);
    await writeFile(this.checkpointPath, content, 'utf-8');
    this.dirty = false;
  }

  private startAutoSave(): void {
    if (this.saveInterval) return;

    this.saveInterval = setInterval(async () => {
      if (this.dirty) {
        await this.save();
      }
    }, this.SAVE_INTERVAL_MS);
  }

  stopAutoSave(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
  }

  markCompleted(dork: string, urlCount: number): void {
    if (!this.data) return;

    const index = this.data.pendingDorks.indexOf(dork);
    if (index !== -1) {
      this.data.pendingDorks.splice(index, 1);
    }

    if (!this.data.completedDorks.includes(dork)) {
      this.data.completedDorks.push(dork);
    }

    this.data.stats.tasks_completed++;
    this.data.stats.tasks_pending = this.data.pendingDorks.length;
    this.data.urlsFound += urlCount;
    this.dirty = true;
  }

  markFailed(dork: string): void {
    if (!this.data) return;

    const index = this.data.pendingDorks.indexOf(dork);
    if (index !== -1) {
      this.data.pendingDorks.splice(index, 1);
    }

    if (!this.data.failedDorks.includes(dork)) {
      this.data.failedDorks.push(dork);
    }

    this.data.stats.tasks_failed++;
    this.data.stats.tasks_pending = this.data.pendingDorks.length;
    this.dirty = true;
  }

  updateStats(stats: Partial<StatsData>): void {
    if (!this.data) return;

    this.data.stats = { ...this.data.stats, ...stats };
    this.dirty = true;
  }

  addOutputFile(filePath: string): void {
    if (!this.data) return;

    if (!this.data.outputFiles.includes(filePath)) {
      this.data.outputFiles.push(filePath);
      this.dirty = true;
    }
  }

  getPendingDorks(): string[] {
    return this.data?.pendingDorks || [];
  }

  getCompletedDorks(): string[] {
    return this.data?.completedDorks || [];
  }

  getFailedDorks(): string[] {
    return this.data?.failedDorks || [];
  }

  getStats(): StatsData | null {
    return this.data?.stats || null;
  }

  getData(): CheckpointData | null {
    return this.data;
  }

  getProgress(): { completed: number; failed: number; pending: number; total: number } {
    if (!this.data) {
      return { completed: 0, failed: 0, pending: 0, total: 0 };
    }

    return {
      completed: this.data.completedDorks.length,
      failed: this.data.failedDorks.length,
      pending: this.data.pendingDorks.length,
      total: this.data.totalDorks,
    };
  }

  async delete(): Promise<void> {
    this.stopAutoSave();
    try {
      await unlink(this.checkpointPath);
    } catch {
      // Ignore if file doesn't exist
    }
    this.data = null;
  }

  async finalize(): Promise<void> {
    this.stopAutoSave();
    await this.save();
  }

  getCheckpointPath(): string {
    return this.checkpointPath;
  }

  isLoaded(): boolean {
    return this.data !== null;
  }
}

export async function findExistingCheckpoints(outputDir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  
  try {
    const files = await readdir(outputDir);
    return files
      .filter((f) => f.startsWith('.checkpoint_') && f.endsWith('.json'))
      .map((f) => path.join(outputDir, f));
  } catch {
    return [];
  }
}

export async function loadCheckpoint(checkpointPath: string): Promise<CheckpointData | null> {
  try {
    const content = await readFile(checkpointPath, 'utf-8');
    return JSON.parse(content) as CheckpointData;
  } catch {
    return null;
  }
}

export function createCheckpointManager(outputDir: string, sessionId?: string): CheckpointManager {
  return new CheckpointManager(outputDir, sessionId);
}
