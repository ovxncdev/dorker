import Conf from 'conf';
import { readFile, writeFile, access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { CLIConfig, FilterConfig, OutputConfig, DEFAULT_CONFIG } from './types.js';

// Schema for configuration validation
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
  recentFiles: {
    dorks: string[];
    proxies: string[];
  };
}

// Default configuration values
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
  recentFiles: {
    dorks: [],
    proxies: [],
  },
};

// Configuration manager using Conf
export class ConfigManager {
  private conf: Conf<ConfigSchema>;
  private projectConfigPath: string | null = null;

  constructor() {
    this.conf = new Conf<ConfigSchema>({
      projectName: 'dorker',
      defaults: DEFAULT_SCHEMA,
      schema: {
        workers: { type: 'number', minimum: 1, maximum: 500 },
        timeout: { type: 'number', minimum: 1000, maximum: 120000 },
        baseDelay: { type: 'number', minimum: 0, maximum: 60000 },
        minDelay: { type: 'number', minimum: 0, maximum: 60000 },
        maxDelay: { type: 'number', minimum: 0, maximum: 120000 },
        maxRetries: { type: 'number', minimum: 0, maximum: 10 },
        resultsPerPage: { type: 'number', minimum: 10, maximum: 100 },
      },
    });
  }

  // Get a configuration value
  get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] {
    return this.conf.get(key);
  }

  // Set a configuration value
  set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
    this.conf.set(key, value);
  }

  // Get all configuration
  getAll(): ConfigSchema {
    return this.conf.store;
  }

  // Reset to defaults
  reset(): void {
    this.conf.clear();
  }

  // Get config file path
  getConfigPath(): string {
    return this.conf.path;
  }

  // Load project-specific config from YAML file
  async loadProjectConfig(configPath: string): Promise<Partial<ConfigSchema>> {
    try {
      await access(configPath, constants.R_OK);
      const content = await readFile(configPath, 'utf-8');
      const config = YAML.parse(content) as Partial<ConfigSchema>;
      this.projectConfigPath = configPath;

      // Merge with existing config
      if (config.workers) this.set('workers', config.workers);
      if (config.timeout) this.set('timeout', config.timeout);
      if (config.baseDelay) this.set('baseDelay', config.baseDelay);
      if (config.minDelay) this.set('minDelay', config.minDelay);
      if (config.maxDelay) this.set('maxDelay', config.maxDelay);
      if (config.maxRetries) this.set('maxRetries', config.maxRetries);
      if (config.resultsPerPage) this.set('resultsPerPage', config.resultsPerPage);
      if (config.filters) this.set('filters', { ...this.get('filters'), ...config.filters });
      if (config.output) this.set('output', { ...this.get('output'), ...config.output });

      return config;
    } catch {
      return {};
    }
  }

  // Save project-specific config to YAML file
  async saveProjectConfig(configPath: string): Promise<void> {
    const config: Partial<ConfigSchema> = {
      workers: this.get('workers'),
      timeout: this.get('timeout'),
      baseDelay: this.get('baseDelay'),
      minDelay: this.get('minDelay'),
      maxDelay: this.get('maxDelay'),
      maxRetries: this.get('maxRetries'),
      resultsPerPage: this.get('resultsPerPage'),
      filters: this.get('filters'),
      output: this.get('output'),
    };

    const content = YAML.stringify(config);
    await writeFile(configPath, content, 'utf-8');
  }

  // Add recent file
  addRecentFile(type: 'dorks' | 'proxies', filePath: string): void {
    const recent = this.get('recentFiles');
    const list = recent[type];
    
    // Remove if already exists
    const index = list.indexOf(filePath);
    if (index !== -1) {
      list.splice(index, 1);
    }
    
    // Add to front
    list.unshift(filePath);
    
    // Keep only last 10
    if (list.length > 10) {
      list.pop();
    }

    this.set('recentFiles', recent);
  }

  // Get recent files
  getRecentFiles(type: 'dorks' | 'proxies'): string[] {
    return this.get('recentFiles')[type];
  }

  // Build CLI config from stored config
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

// Look for config file in current directory or parent directories
export async function findProjectConfig(): Promise<string | null> {
  const configNames = ['dorker.yml', 'dorker.yaml', '.dorkerrc', '.dorkerrc.yml'];
  let currentDir = process.cwd();
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    for (const name of configNames) {
      const configPath = path.join(currentDir, name);
      if (existsSync(configPath)) {
        return configPath;
      }
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

// Create sample configuration file
export async function createSampleConfig(outputPath: string): Promise<void> {
  const sampleConfig = `# Dorker Configuration
# See documentation for all available options

# Concurrency settings
workers: 10              # Number of concurrent workers
timeout: 30000           # Request timeout in ms
baseDelay: 8000          # Base delay between requests in ms
minDelay: 3000           # Minimum delay in ms
maxDelay: 15000          # Maximum delay in ms
maxRetries: 3            # Max retries per dork

# Search settings
resultsPerPage: 100      # Results per Google search page

# Filter settings
filters:
  antiPublic: true              # Filter out common public domains
  removeDuplicateDomains: true  # Keep only one URL per domain
  noRedirectUrls: true          # Clean redirect URLs
  urlParametersOnly: false      # Keep only URLs with parameters
  cleanTopDomains: false        # Extract just root domain
  keepUnfiltered: true          # Save unfiltered results separately

# Output settings
output:
  format: txt                   # Output format: txt, json, csv, jsonl
  directory: ./output           # Output directory
  prefix: dorker                # Output file prefix
  splitByDork: false            # Create separate file per dork
  includeMetadata: false        # Include metadata in output
`;

  await writeFile(outputPath, sampleConfig, 'utf-8');
}

// Parse environment variables for config
export function parseEnvConfig(): Partial<ConfigSchema> {
  const config: Partial<ConfigSchema> = {};

  if (process.env['DORKER_WORKERS']) {
    config.workers = parseInt(process.env['DORKER_WORKERS'], 10);
  }
  if (process.env['DORKER_TIMEOUT']) {
    config.timeout = parseInt(process.env['DORKER_TIMEOUT'], 10);
  }
  if (process.env['DORKER_BASE_DELAY']) {
    config.baseDelay = parseInt(process.env['DORKER_BASE_DELAY'], 10);
  }
  if (process.env['DORKER_MIN_DELAY']) {
    config.minDelay = parseInt(process.env['DORKER_MIN_DELAY'], 10);
  }
  if (process.env['DORKER_MAX_DELAY']) {
    config.maxDelay = parseInt(process.env['DORKER_MAX_DELAY'], 10);
  }
  if (process.env['DORKER_MAX_RETRIES']) {
    config.maxRetries = parseInt(process.env['DORKER_MAX_RETRIES'], 10);
  }
  if (process.env['DORKER_OUTPUT_DIR']) {
    config.output = {
      ...DEFAULT_SCHEMA.output,
      directory: process.env['DORKER_OUTPUT_DIR'],
    };
  }

  return config;
}

// Validate configuration values
export function validateConfig(config: Partial<ConfigSchema>): string[] {
  const errors: string[] = [];

  if (config.workers !== undefined) {
    if (config.workers < 1) {
      errors.push('workers must be at least 1');
    }
    if (config.workers > 500) {
      errors.push('workers must not exceed 500');
    }
  }

  if (config.timeout !== undefined) {
    if (config.timeout < 1000) {
      errors.push('timeout must be at least 1000ms');
    }
    if (config.timeout > 120000) {
      errors.push('timeout must not exceed 120000ms');
    }
  }

  if (config.minDelay !== undefined && config.maxDelay !== undefined) {
    if (config.minDelay > config.maxDelay) {
      errors.push('minDelay must not exceed maxDelay');
    }
  }

  if (config.resultsPerPage !== undefined) {
    if (config.resultsPerPage < 10) {
      errors.push('resultsPerPage must be at least 10');
    }
    if (config.resultsPerPage > 100) {
      errors.push('resultsPerPage must not exceed 100');
    }
  }

  return errors;
}

// Singleton instance
let configManagerInstance: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager();
  }
  return configManagerInstance;
}
