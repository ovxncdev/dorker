/**
 * Validator Utility
 * Input validation for dorks, proxies, URLs, and configuration
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { Proxy, Settings } from '../types/index.js';

// ============================================
// PROXY VALIDATION
// ============================================

// Proxy format patterns
const proxyPatterns = {
  // ip:port
  ipPort: /^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/,
  // ip:port:user:pass
  ipPortUserPass: /^(\d{1,3}\.){3}\d{1,3}:\d{1,5}:.+:.+$/,
  // user:pass@ip:port
  userPassAtIpPort: /^.+:.+@(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/,
  // protocol://ip:port
  protocolIpPort: /^(https?|socks[45]):\/\/(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/,
  // protocol://user:pass@ip:port
  protocolUserPassIpPort: /^(https?|socks[45]):\/\/.+:.+@(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/,
  // domain:port
  domainPort: /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+:\d{1,5}$/,
};

/**
 * Validate a single proxy string
 */
export function validateProxy(proxy: string): { valid: boolean; error?: string } {
  const trimmed = proxy.trim();
  
  if (!trimmed) {
    return { valid: false, error: 'Empty proxy string' };
  }

  // Check against all patterns
  const isValid = Object.values(proxyPatterns).some(pattern => pattern.test(trimmed));
  
  if (!isValid) {
    return { valid: false, error: `Invalid proxy format: ${trimmed}` };
  }

  // Extract and validate port
  const portMatch = trimmed.match(/:(\d{1,5})(?::|$|\/)/);
  if (portMatch) {
    const port = parseInt(portMatch[1], 10);
    if (port < 1 || port > 65535) {
      return { valid: false, error: `Invalid port number: ${port}` };
    }
  }

  // Validate IP octets if present
  const ipMatch = trimmed.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/);
  if (ipMatch) {
    const octets = [ipMatch[1], ipMatch[2], ipMatch[3], ipMatch[4]].map(Number);
    for (const octet of octets) {
      if (octet < 0 || octet > 255) {
        return { valid: false, error: `Invalid IP octet: ${octet}` };
      }
    }
  }

  return { valid: true };
}

/**
 * Validate proxies from file
 */
export function validateProxyFile(filePath: string): {
  valid: string[];
  invalid: Array<{ line: number; proxy: string; error: string }>;
  total: number;
} {
  const result = {
    valid: [] as string[],
    invalid: [] as Array<{ line: number; proxy: string; error: string }>,
    total: 0,
  };

  if (!fs.existsSync(filePath)) {
    throw new Error(`Proxy file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    result.total++;
    const validation = validateProxy(trimmed);

    if (validation.valid) {
      result.valid.push(trimmed);
    } else {
      result.invalid.push({
        line: index + 1,
        proxy: trimmed,
        error: validation.error || 'Unknown error',
      });
    }
  });

  return result;
}

// ============================================
// DORK VALIDATION
// ============================================

/**
 * Validate a single dork
 */
export function validateDork(dork: string): { valid: boolean; error?: string; warnings?: string[] } {
  const trimmed = dork.trim();
  const warnings: string[] = [];

  if (!trimmed) {
    return { valid: false, error: 'Empty dork string' };
  }

  if (trimmed.length < 3) {
    return { valid: false, error: 'Dork too short (minimum 3 characters)' };
  }

  if (trimmed.length > 500) {
    return { valid: false, error: 'Dork too long (maximum 500 characters)' };
  }

  // Check for common issues
  if (trimmed.includes('  ')) {
    warnings.push('Contains multiple consecutive spaces');
  }

  // Check for unbalanced quotes
  const doubleQuotes = (trimmed.match(/"/g) || []).length;
  if (doubleQuotes % 2 !== 0) {
    warnings.push('Unbalanced double quotes');
  }

  // Check for unbalanced parentheses
  const openParens = (trimmed.match(/\(/g) || []).length;
  const closeParens = (trimmed.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    warnings.push('Unbalanced parentheses');
  }

  // Check for common Google dork operators
  const hasOperator = /\b(site:|inurl:|intitle:|intext:|filetype:|ext:|cache:|link:|related:|info:|define:|stocks:|phonebook:|maps:|book:|scholar:|blogs:|news:|video:|image:)/i.test(trimmed);
  
  if (!hasOperator) {
    warnings.push('No Google dork operator detected (this might just be a keyword search)');
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Validate dorks from file
 */
export function validateDorkFile(filePath: string): {
  valid: string[];
  invalid: Array<{ line: number; dork: string; error: string }>;
  warnings: Array<{ line: number; dork: string; warnings: string[] }>;
  total: number;
} {
  const result = {
    valid: [] as string[],
    invalid: [] as Array<{ line: number; dork: string; error: string }>,
    warnings: [] as Array<{ line: number; dork: string; warnings: string[] }>,
    total: 0,
  };

  if (!fs.existsSync(filePath)) {
    throw new Error(`Dork file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    result.total++;
    const validation = validateDork(trimmed);

    if (validation.valid) {
      result.valid.push(trimmed);
      if (validation.warnings) {
        result.warnings.push({
          line: index + 1,
          dork: trimmed,
          warnings: validation.warnings,
        });
      }
    } else {
      result.invalid.push({
        line: index + 1,
        dork: trimmed,
        error: validation.error || 'Unknown error',
      });
    }
  });

  return result;
}

// ============================================
// URL VALIDATION
// ============================================

/**
 * Validate a URL
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  const trimmed = url.trim();

  if (!trimmed) {
    return { valid: false, error: 'Empty URL' };
  }

  try {
    const parsed = new URL(trimmed);
    
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Invalid protocol (must be http or https)' };
    }

    if (!parsed.hostname) {
      return { valid: false, error: 'Missing hostname' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

// ============================================
// CONFIGURATION VALIDATION
// ============================================

// Zod schemas for configuration
const EngineSettingsSchema = z.object({
  type: z.enum(['google', 'bing', 'yahoo', 'duckduckgo', 'yandex', 'ask']),
  workers: z.number().min(1).max(1000),
  pagesPerDork: z.number().min(1).max(100),
  resultsPerPage: z.number().min(1).max(100),
  timeout: z.number().min(1000).max(120000),
  retryAttempts: z.number().min(0).max(10),
  retryDelay: z.number().min(0).max(60000),
});

const ProxySettingsSchema = z.object({
  rotateAfter: z.number().min(1).max(100),
  rotationStrategy: z.enum(['round_robin', 'random', 'least_used', 'least_latency', 'weighted']),
  healthCheckOnStart: z.boolean(),
  healthCheckInterval: z.number().min(0),
  quarantineDuration: z.number().min(0),
  maxFailCount: z.number().min(1).max(100),
  protocols: z.array(z.string()),
});

const StealthSettingsSchema = z.object({
  profile: z.enum(['aggressive', 'normal', 'cautious', 'stealth']),
  delayMin: z.number().min(0),
  delayMax: z.number().min(0),
  burstSize: z.number().min(1),
  burstPause: z.number().min(0),
  sessionMaxRequests: z.number().min(1),
  sessionCooldown: z.number().min(0),
  jitterPercent: z.number().min(0).max(1),
  rotateUserAgent: z.boolean(),
  rotateGoogleDomain: z.boolean(),
});

const FilterSettingsSchema = z.object({
  cleanDomains: z.boolean(),
  removeRedirects: z.boolean(),
  removeDuplicates: z.boolean(),
  urlParamsOnly: z.boolean(),
  antiPublic: z.boolean(),
  localAntiPublic: z.boolean(),
  tldWhitelist: z.array(z.string()),
  tldBlacklist: z.array(z.string()),
  domainBlacklist: z.array(z.string()),
  keywordInclude: z.array(z.string()),
  keywordExclude: z.array(z.string()),
  minUrlLength: z.number().min(1),
  maxUrlLength: z.number().min(1),
});

const OutputSettingsSchema = z.object({
  directory: z.string(),
  formats: z.array(z.enum(['txt', 'json', 'csv', 'sqlite'])),
  separateByDork: z.boolean(),
  includeRaw: z.boolean(),
  includeFiltered: z.boolean(),
  includeDomains: z.boolean(),
  includeStats: z.boolean(),
  realTimeWrite: z.boolean(),
  timestampFolders: z.boolean(),
});

const SettingsSchema = z.object({
  version: z.string(),
  engine: EngineSettingsSchema,
  proxy: ProxySettingsSchema,
  stealth: StealthSettingsSchema,
  filter: FilterSettingsSchema,
  output: OutputSettingsSchema,
  // Add more schemas as needed
}).passthrough(); // Allow additional properties

/**
 * Validate settings object
 */
export function validateSettings(settings: unknown): { valid: boolean; errors?: z.ZodError } {
  const result = SettingsSchema.safeParse(settings);
  
  if (result.success) {
    return { valid: true };
  }
  
  return { valid: false, errors: result.error };
}

/**
 * Validate settings file
 */
export function validateSettingsFile(filePath: string): { valid: boolean; settings?: Settings; errors?: string[] } {
  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: [`Settings file not found: ${filePath}`] };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const settings = JSON.parse(content);
    const validation = validateSettings(settings);

    if (validation.valid) {
      return { valid: true, settings };
    }

    const errors = validation.errors?.errors.map(
      e => `${e.path.join('.')}: ${e.message}`
    );

    return { valid: false, errors };
  } catch (error) {
    return { valid: false, errors: [`Failed to parse settings: ${error}`] };
  }
}

// ============================================
// FILE VALIDATION
// ============================================

/**
 * Validate file exists and is readable
 */
export function validateFileExists(filePath: string): { valid: boolean; error?: string } {
  try {
    const resolvedPath = path.resolve(filePath);
    
    if (!fs.existsSync(resolvedPath)) {
      return { valid: false, error: `File not found: ${filePath}` };
    }

    const stats = fs.statSync(resolvedPath);
    
    if (!stats.isFile()) {
      return { valid: false, error: `Not a file: ${filePath}` };
    }

    // Check if readable
    fs.accessSync(resolvedPath, fs.constants.R_OK);

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Cannot access file: ${error}` };
  }
}

/**
 * Validate directory exists or can be created
 */
export function validateDirectory(dirPath: string, create: boolean = false): { valid: boolean; error?: string } {
  try {
    const resolvedPath = path.resolve(dirPath);

    if (fs.existsSync(resolvedPath)) {
      const stats = fs.statSync(resolvedPath);
      if (!stats.isDirectory()) {
        return { valid: false, error: `Path exists but is not a directory: ${dirPath}` };
      }
      return { valid: true };
    }

    if (create) {
      fs.mkdirSync(resolvedPath, { recursive: true });
      return { valid: true };
    }

    return { valid: false, error: `Directory not found: ${dirPath}` };
  } catch (error) {
    return { valid: false, error: `Cannot access directory: ${error}` };
  }
}

// ============================================
// SUMMARY VALIDATION
// ============================================

export interface ValidationSummary {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    dorks: { total: number; valid: number; invalid: number };
    proxies: { total: number; valid: number; invalid: number };
  };
}

/**
 * Validate all inputs for a run
 */
export function validateAll(options: {
  dorksFile?: string;
  proxiesFile?: string;
  outputDir?: string;
  settingsFile?: string;
}): ValidationSummary {
  const summary: ValidationSummary = {
    valid: true,
    errors: [],
    warnings: [],
    stats: {
      dorks: { total: 0, valid: 0, invalid: 0 },
      proxies: { total: 0, valid: 0, invalid: 0 },
    },
  };

  // Validate dorks file
  if (options.dorksFile) {
    const fileCheck = validateFileExists(options.dorksFile);
    if (!fileCheck.valid) {
      summary.errors.push(fileCheck.error!);
      summary.valid = false;
    } else {
      const dorksValidation = validateDorkFile(options.dorksFile);
      summary.stats.dorks = {
        total: dorksValidation.total,
        valid: dorksValidation.valid.length,
        invalid: dorksValidation.invalid.length,
      };

      if (dorksValidation.invalid.length > 0) {
        summary.warnings.push(`${dorksValidation.invalid.length} invalid dorks found`);
      }

      if (dorksValidation.valid.length === 0) {
        summary.errors.push('No valid dorks found');
        summary.valid = false;
      }
    }
  }

  // Validate proxies file
  if (options.proxiesFile) {
    const fileCheck = validateFileExists(options.proxiesFile);
    if (!fileCheck.valid) {
      summary.errors.push(fileCheck.error!);
      summary.valid = false;
    } else {
      const proxiesValidation = validateProxyFile(options.proxiesFile);
      summary.stats.proxies = {
        total: proxiesValidation.total,
        valid: proxiesValidation.valid.length,
        invalid: proxiesValidation.invalid.length,
      };

      if (proxiesValidation.invalid.length > 0) {
        summary.warnings.push(`${proxiesValidation.invalid.length} invalid proxies found`);
      }

      if (proxiesValidation.valid.length === 0) {
        summary.errors.push('No valid proxies found');
        summary.valid = false;
      }
    }
  }

  // Validate output directory
  if (options.outputDir) {
    const dirCheck = validateDirectory(options.outputDir, true);
    if (!dirCheck.valid) {
      summary.errors.push(dirCheck.error!);
      summary.valid = false;
    }
  }

  // Validate settings file
  if (options.settingsFile) {
    const settingsCheck = validateSettingsFile(options.settingsFile);
    if (!settingsCheck.valid) {
      settingsCheck.errors?.forEach(e => summary.errors.push(e));
      summary.valid = false;
    }
  }

  return summary;
}

export default {
  validateProxy,
  validateProxyFile,
  validateDork,
  validateDorkFile,
  validateUrl,
  validateSettings,
  validateSettingsFile,
  validateFileExists,
  validateDirectory,
  validateAll,
};
