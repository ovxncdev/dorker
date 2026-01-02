import { createWriteStream, mkdirSync, existsSync, type WriteStream } from 'node:fs';
import { writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { SearchResult, OutputConfig, OutputFormat, StatsData } from './types.js';
import type { FilterStats } from './filters.js';

export class OutputWriter {
  private config: OutputConfig;
  private streams: Map<string, WriteStream> = new Map();
  private buffers: Map<string, string[]> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private totalWritten = 0;
  private readonly BUFFER_SIZE = 1000;
  private readonly FLUSH_INTERVAL_MS = 5000;

  constructor(config: OutputConfig) {
    this.config = config;
    this.ensureDirectory();
    this.startFlushInterval();
  }

  private ensureDirectory(): void {
    if (!existsSync(this.config.directory)) {
      mkdirSync(this.config.directory, { recursive: true });
    }
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flushAllBuffers();
    }, this.FLUSH_INTERVAL_MS);
  }

  private getFilePath(suffix: string, extension?: string): string {
    const ext = extension || this.getExtension();
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${this.config.prefix}_${suffix}_${timestamp}${ext}`;
    return path.join(this.config.directory, filename);
  }

  private getExtension(): string {
    switch (this.config.format) {
      case 'json':
        return '.json';
      case 'jsonl':
        return '.jsonl';
      case 'csv':
        return '.csv';
      case 'txt':
      default:
        return '.txt';
    }
  }

  private getOrCreateStream(key: string): WriteStream {
    let stream = this.streams.get(key);
    if (!stream) {
      const filePath = this.getFilePath(key);
      stream = createWriteStream(filePath, { flags: 'a' });
      this.streams.set(key, stream);

      // Write CSV header if needed
      if (this.config.format === 'csv') {
        stream.write('url,dork,timestamp\n');
      }
    }
    return stream;
  }

  private getOrCreateBuffer(key: string): string[] {
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = [];
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  private formatResult(result: SearchResult): string {
    switch (this.config.format) {
      case 'json':
        return JSON.stringify(result);
      
      case 'jsonl':
        return JSON.stringify(result);
      
      case 'csv': {
        const url = this.escapeCSV(result.url);
        const dork = this.escapeCSV(result.dork);
        return `${url},${dork},${result.timestamp}`;
      }
      
      case 'txt':
      default:
        return result.url;
    }
  }

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  // Write a single result
  write(result: SearchResult): void {
    const key = this.config.splitByDork ? this.sanitizeFilename(result.dork) : 'results';
    const buffer = this.getOrCreateBuffer(key);
    const formatted = this.formatResult(result);
    
    buffer.push(formatted);
    this.totalWritten++;

    if (buffer.length >= this.BUFFER_SIZE) {
      this.flushBuffer(key);
    }
  }

  // Write multiple results
  writeMany(results: SearchResult[]): void {
    for (const result of results) {
      this.write(result);
    }
  }

  // Write URLs only (simple format)
  writeUrls(urls: string[], dork: string): void {
    const timestamp = Date.now();
    for (const url of urls) {
      this.write({
        url,
        dork,
        timestamp,
      });
    }
  }

  private flushBuffer(key: string): void {
    const buffer = this.buffers.get(key);
    if (!buffer || buffer.length === 0) return;

    const stream = this.getOrCreateStream(key);
    const content = buffer.join('\n') + '\n';
    stream.write(content);

    buffer.length = 0;
  }

  private flushAllBuffers(): void {
    for (const key of this.buffers.keys()) {
      this.flushBuffer(key);
    }
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 50);
  }

  // Write unfiltered results to separate file
  async writeUnfiltered(urls: string[]): Promise<string> {
    const filePath = this.getFilePath('unfiltered', '.txt');
    const content = urls.join('\n') + '\n';
    await appendFile(filePath, content);
    return filePath;
  }

  // Write domains list
  async writeDomains(domains: string[]): Promise<string> {
    const filePath = this.getFilePath('domains', '.txt');
    const content = domains.join('\n') + '\n';
    await writeFile(filePath, content);
    return filePath;
  }

  // Write URLs with parameters only
  async writeUrlsWithParams(urls: string[]): Promise<string> {
    const filePath = this.getFilePath('urls_with_params', '.txt');
    const content = urls.join('\n') + '\n';
    await writeFile(filePath, content);
    return filePath;
  }

  // Write summary report
  async writeSummary(
    stats: StatsData,
    filterStats: FilterStats,
    duration: number,
    outputFiles: string[]
  ): Promise<string> {
    const filePath = this.getFilePath('summary', '.json');
    
    const summary = {
      generated_at: new Date().toISOString(),
      duration_seconds: Math.round(duration / 1000),
      
      processing: {
        total_dorks: stats.tasks_total,
        completed: stats.tasks_completed,
        failed: stats.tasks_failed,
        captchas: stats.captcha_count,
        blocks: stats.block_count,
        requests_per_second: stats.requests_per_sec.toFixed(2),
      },
      
      results: {
        total_urls_found: stats.urls_found,
        after_redirect_clean: filterStats.afterRedirectClean,
        after_deduplication: filterStats.afterDedup,
        after_anti_public: filterStats.afterAntiPublic,
        after_domain_dedup: filterStats.afterDomainDedup,
        final_output: filterStats.finalOutput,
        unique_domains: filterStats.uniqueDomains,
      },
      
      proxies: {
        alive: stats.proxies_alive,
        dead: stats.proxies_dead,
      },
      
      output_files: outputFiles,
    };

    await writeFile(filePath, JSON.stringify(summary, null, 2));
    return filePath;
  }

  // Write failed dorks for retry
  async writeFailedDorks(dorks: string[]): Promise<string> {
    const filePath = this.getFilePath('failed_dorks', '.txt');
    const content = dorks.join('\n') + '\n';
    await writeFile(filePath, content);
    return filePath;
  }

  // Get total written count
  getTotalWritten(): number {
    return this.totalWritten;
  }

  // Get all output file paths
  getOutputFiles(): string[] {
    const files: string[] = [];
    for (const key of this.streams.keys()) {
      files.push(this.getFilePath(key));
    }
    return files;
  }

  // Close all streams and flush buffers
  async close(): Promise<void> {
    // Stop flush interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Flush all remaining buffers
    this.flushAllBuffers();

    // Close all streams
    const closePromises: Promise<void>[] = [];
    
    for (const [key, stream] of this.streams) {
      closePromises.push(
        new Promise((resolve, reject) => {
          stream.end((err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        })
      );
    }

    await Promise.all(closePromises);
    this.streams.clear();
    this.buffers.clear();
  }
}

// Create output writer from config
export function createOutputWriter(config: Partial<OutputConfig> = {}): OutputWriter {
  const defaultConfig: OutputConfig = {
    format: 'txt',
    directory: './output',
    prefix: 'dorker',
    splitByDork: false,
    includeMetadata: false,
  };

  return new OutputWriter({ ...defaultConfig, ...config });
}

// Format duration for display
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Format number with commas
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

// Format bytes
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
