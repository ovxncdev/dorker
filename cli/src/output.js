import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export class OutputWriter {
  constructor(config) {
    this.config = {
      format: 'txt',
      directory: './output',
      prefix: 'dorker',
      splitByDork: false,
      ...config,
    };
    this.streams = new Map();
    this.buffer = [];
    this.totalWritten = 0;
    this.outputFiles = [];

    if (!existsSync(this.config.directory)) {
      mkdirSync(this.config.directory, { recursive: true });
    }
  }

  getStream(suffix = 'results') {
    if (this.streams.has(suffix)) return this.streams.get(suffix);

    const date = new Date().toISOString().split('T')[0];
    const ext = this.config.format === 'jsonl' ? 'jsonl' : this.config.format;
    const filename = `${this.config.prefix}_${suffix}_${date}.${ext}`;
    const filepath = path.join(this.config.directory, filename);

    const stream = createWriteStream(filepath, { flags: 'a' });
    this.streams.set(suffix, stream);
    this.outputFiles.push(filepath);
    return stream;
  }

  formatResult(result) {
    switch (this.config.format) {
      case 'json':
      case 'jsonl':
        return JSON.stringify(result);
      case 'csv':
        return `"${result.url}","${result.dork || ''}","${result.timestamp || ''}"`;
      default:
        return result.url;
    }
  }

  write(result) {
    const stream = this.getStream();
    stream.write(this.formatResult(result) + '\n');
    this.totalWritten++;
  }

  writeMany(results) {
    results.forEach(r => this.write(r));
  }

  async writeFailedDorks(dorks) {
    const date = new Date().toISOString().split('T')[0];
    const filepath = path.join(this.config.directory, `${this.config.prefix}_failed_${date}.txt`);
    await writeFile(filepath, dorks.join('\n'), 'utf-8');
    this.outputFiles.push(filepath);
  }

  async writeSummary(stats, filterStats, duration, files) {
    const summary = { stats, filterStats, duration, files, timestamp: new Date().toISOString() };
    const date = new Date().toISOString().split('T')[0];
    const filepath = path.join(this.config.directory, `${this.config.prefix}_summary_${date}.json`);
    await writeFile(filepath, JSON.stringify(summary, null, 2), 'utf-8');
  }

  async close() {
    for (const stream of this.streams.values()) {
      await new Promise(resolve => stream.end(resolve));
    }
  }

  getTotalWritten() { return this.totalWritten; }
  getOutputFiles() { return this.outputFiles; }
}

export function createOutputWriter(config) {
  return new OutputWriter(config);
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

export function formatNumber(num) {
  return num.toLocaleString();
}
