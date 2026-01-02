import Conf from 'conf';
import { readFile, writeFile, access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { CLIConfig, FilterConfig, OutputConfig } from './types.js';

interface ConfigSchema {
  workers: number;
  timeout: number;
  baseDelay: number;
  minDelay: number;
  maxDelay: number;
  maxRetries: number;
  resultsPerPage: number;
  filters: FilterConfig;
  output: OutputConfig;
  recentFiles: { dorks: string[]; proxies: string[] };
}

const DEFAULT_SCHEMA: ConfigSchema = {
  workers: 10,
  timeout: 30000,
  baseDelay: 8000,
  minDelay: 3000,
  maxDelay: 15000,
  maxRetries: 3,
  resultsPerPage: 100,
  filters: {
    cleanTopDomains: false,
    urlParametersOnly: false,
    noRedirectUrls: true,
    removeDuplicateDomains: true,
    antiPublic: true,
    keepUnfiltered: true,
  },
  output: {
    format: 'txt',
    directory: './output',
    prefix: 'dorker',
    splitByDork: false,
    includeMetadata: false,
  },
  recentFiles: { dorks: [], proxies: [] },
};

export class ConfigManager {
  private conf: Conf<ConfigSchema>;

  constructor() {
    this.conf = new Conf<ConfigSchema>({
      projectName: 'dorker',
      defaults: DEFAULT_SCHEMA,
    });
  }

  get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] {
    return this.conf.get(key);
  }

  set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
    this.conf.set(key, value);
  }

  getAll(): ConfigSchema { return this.conf.store; }
  reset(): void { this.conf.clear(); }
  getConfigPath(): string { return this.conf.path; }

  async loadProjectConfig(configPath: string): Promise<Partial<ConfigSchema>> {
    try {
      await access(configPath, constants.R_OK);
      const content = await readFile(configPath, 'utf-8');
      return YAML.parse(content) as Partial<ConfigSchema>;
    } catch { return {}; }
  }

  async saveProjectConfig(configPath: string): Promise<void> {
    const config = {
      workers: this.get('workers'),
      timeout: this.get('timeout'),
      baseDelay: this.get('baseDelay'),
      filters: this.get('filters'),
      output: this.get('output'),
    };
    await writeFile(configPath, YAML.stringify(config), 'utf-8');
  }

  buildCLIConfig(dorksFile: string, proxiesFile: string): CLIConfig {
    return {
      dorksFile,
      proxiesFile,
      outputDir: this.get('output').directory,
      workers: this.get('workers'),
      timeout: this.get('timeout'),
      baseDelay: this.get('baseDelay'),
      minDelay: this.get('minDelay'),
      maxDelay: this.get('maxDelay'),
      maxRetries: this.get('maxRetries'),
      resultsPerPage: this.get('resultsPerPage'),
      filters: this.get('filters'),
    };
  }
}

export async function findProjectConfig(): Promise<string | null> {
  const names = ['dorker.yml', 'dorker.yaml', '.dorkerrc'];
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    for (const name of names) {
      const p = path.join(dir, name);
      if (existsSync(p)) return p;
    }
    dir = path.dirname(dir);
  }
  return null;
}

export async function createSampleConfig(outputPath: string): Promise<void> {
  const sample = `workers: 10\ntimeout: 30000\nbaseDelay: 8000\n`;
  await writeFile(outputPath, sample, 'utf-8');
}

export function parseEnvConfig(): Partial<ConfigSchema> {
  const config: Partial<ConfigSchema> = {};
  if (process.env['DORKER_WORKERS']) config.workers = parseInt(process.env['DORKER_WORKERS'], 10);
  if (process.env['DORKER_TIMEOUT']) config.timeout = parseInt(process.env['DORKER_TIMEOUT'], 10);
  return config;
}

export function validateConfig(config: Partial<ConfigSchema>): string[] {
  const errors: string[] = [];
  if (config.workers !== undefined && (config.workers < 1 || config.workers > 500)) {
    errors.push('workers must be between 1 and 500');
  }
  return errors;
}

let instance: ConfigManager | null = null;
export function getConfigManager(): ConfigManager {
  if (!instance) instance = new ConfigManager();
  return instance;
}
