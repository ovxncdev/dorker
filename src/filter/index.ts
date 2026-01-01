/**
 * Filter Pipeline
 * Combines all filters into a unified filtering system
 */

import {
  extractDomain,
  extractTopDomain,
  extractTld,
  normalizeDomain,
  isValidDomain,
  matchesDomainPattern,
} from './domain.js';
import {
  UrlDeduplicator,
  DomainDeduplicator,
  DedupOptions,
} from './dedup.js';
import {
  AntiPublicFilter,
  AntiPublicOptions,
  getAntiPublicFilter,
} from './antiPublic.js';
import type { FilterSettings, FilteredResult } from '../types/index.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

// Re-export sub-modules
export * from './domain.js';
export * from './dedup.js';
export * from './antiPublic.js';

// Filter result
export interface FilterResult {
  url: string;
  domain: string;
  topDomain: string;
  passed: boolean;
  reasons: string[];
}

// Pipeline statistics
export interface FilterStats {
  total: number;
  passed: number;
  filtered: number;
  byReason: Record<string, number>;
  uniqueDomains: number;
  uniqueTopDomains: number;
  newDomains: number;
}

// Pipeline options (extends FilterSettings)
export interface FilterPipelineOptions extends FilterSettings {
  expectedUrls?: number;
  bloomErrorRate?: number;
}

const DEFAULT_OPTIONS: FilterPipelineOptions = {
  cleanDomains: true,
  removeRedirects: true,
  removeDuplicates: true,
  urlParamsOnly: false,
  antiPublic: true,
  localAntiPublic: true,
  tldWhitelist: [],
  tldBlacklist: ['xyz', 'top', 'loan', 'work', 'click', 'gq', 'ml', 'ga', 'cf', 'tk'],
  domainBlacklist: [],
  keywordInclude: [],
  keywordExclude: [],
  minUrlLength: 10,
  maxUrlLength: 2000,
  expectedUrls: 1000000,
  bloomErrorRate: 0.01,
};

/**
 * URL Filter Pipeline
 * Processes URLs through multiple filter stages
 */
export class FilterPipeline {
  private options: FilterPipelineOptions;
  private urlDedup: UrlDeduplicator;
  private domainDedup: DomainDeduplicator;
  private antiPublic: AntiPublicFilter | null;
  private tldWhitelist: Set<string>;
  private tldBlacklist: Set<string>;
  private domainBlacklist: Set<string>;
  private keywordInclude: RegExp[];
  private keywordExclude: RegExp[];
  private stats: FilterStats;

  constructor(options: Partial<FilterPipelineOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Initialize deduplicators
    const dedupOptions: Partial<DedupOptions> = {
      mode: 'normalized',
      removeWww: true,
      removeTrailingSlash: true,
      removeFragment: true,
      removeTrackingParams: true,
    };

    this.urlDedup = new UrlDeduplicator(
      this.options.expectedUrls,
      this.options.bloomErrorRate,
      dedupOptions
    );

    this.domainDedup = new DomainDeduplicator(true);

    // Initialize anti-public filter
    if (this.options.antiPublic) {
      this.antiPublic = getAntiPublicFilter({
        enabled: true,
        localDb: this.options.localAntiPublic,
      });
    } else {
      this.antiPublic = null;
    }

    // Initialize TLD filters
    this.tldWhitelist = new Set(this.options.tldWhitelist.map(t => t.toLowerCase()));
    this.tldBlacklist = new Set(this.options.tldBlacklist.map(t => t.toLowerCase()));

    // Initialize domain blacklist
    this.domainBlacklist = new Set(this.options.domainBlacklist.map(d => normalizeDomain(d)));

    // Initialize keyword filters
    this.keywordInclude = this.options.keywordInclude.map(k => new RegExp(k, 'i'));
    this.keywordExclude = this.options.keywordExclude.map(k => new RegExp(k, 'i'));

    // Initialize stats
    this.stats = this.createEmptyStats();

    logger.debug('Filter pipeline initialized', {
      tldWhitelist: this.tldWhitelist.size,
      tldBlacklist: this.tldBlacklist.size,
      domainBlacklist: this.domainBlacklist.size,
      keywordInclude: this.keywordInclude.length,
      keywordExclude: this.keywordExclude.length,
    });
  }

  /**
   * Create empty stats object
   */
  private createEmptyStats(): FilterStats {
    return {
      total: 0,
      passed: 0,
      filtered: 0,
      byReason: {},
      uniqueDomains: 0,
      uniqueTopDomains: 0,
      newDomains: 0,
    };
  }

  /**
   * Record a filter reason
   */
  private recordReason(reason: string): void {
    this.stats.byReason[reason] = (this.stats.byReason[reason] || 0) + 1;
  }

  /**
   * Filter a single URL through the pipeline
   */
  filterUrl(url: string): FilterResult {
    const reasons: string[] = [];
    let passed = true;

    this.stats.total++;

    // 1. Basic validation
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      reasons.push('empty');
      passed = false;
    }

    // 2. Length check
    if (passed && this.options.minUrlLength > 0 && trimmedUrl.length < this.options.minUrlLength) {
      reasons.push('too_short');
      passed = false;
    }

    if (passed && this.options.maxUrlLength > 0 && trimmedUrl.length > this.options.maxUrlLength) {
      reasons.push('too_long');
      passed = false;
    }

    // 3. Extract domain
    const domain = extractDomain(trimmedUrl);
    const topDomain = extractTopDomain(trimmedUrl) || '';

    if (passed && !domain) {
      reasons.push('invalid_domain');
      passed = false;
    }

    // 4. Domain validation
    if (passed && domain && !isValidDomain(domain)) {
      reasons.push('invalid_domain_format');
      passed = false;
    }

    // 5. URL parameters check
    if (passed && this.options.urlParamsOnly) {
      try {
        const parsedUrl = new URL(trimmedUrl.includes('://') ? trimmedUrl : 'http://' + trimmedUrl);
        if (!parsedUrl.search || parsedUrl.search === '?') {
          reasons.push('no_params');
          passed = false;
        }
      } catch {
        reasons.push('parse_error');
        passed = false;
      }
    }

    // 6. TLD whitelist check
    if (passed && domain && this.tldWhitelist.size > 0) {
      const tld = extractTld(domain).toLowerCase();
      if (!this.tldWhitelist.has(tld)) {
        reasons.push('tld_not_whitelisted');
        passed = false;
      }
    }

    // 7. TLD blacklist check
    if (passed && domain && this.tldBlacklist.size > 0) {
      const tld = extractTld(domain).toLowerCase();
      if (this.tldBlacklist.has(tld)) {
        reasons.push('tld_blacklisted');
        passed = false;
      }
    }

    // 8. Domain blacklist check
    if (passed && domain) {
      const normalizedDomain = normalizeDomain(domain);
      const normalizedTop = normalizeDomain(topDomain);

      for (const blacklisted of this.domainBlacklist) {
        if (
          normalizedDomain === blacklisted ||
          normalizedTop === blacklisted ||
          matchesDomainPattern(normalizedDomain, '*.' + blacklisted)
        ) {
          reasons.push('domain_blacklisted');
          passed = false;
          break;
        }
      }
    }

    // 9. Keyword include check (URL must contain at least one)
    if (passed && this.keywordInclude.length > 0) {
      const hasKeyword = this.keywordInclude.some(re => re.test(trimmedUrl));
      if (!hasKeyword) {
        reasons.push('missing_required_keyword');
        passed = false;
      }
    }

    // 10. Keyword exclude check (URL must not contain any)
    if (passed && this.keywordExclude.length > 0) {
      const hasExcluded = this.keywordExclude.some(re => re.test(trimmedUrl));
      if (hasExcluded) {
        reasons.push('contains_excluded_keyword');
        passed = false;
      }
    }

    // 11. Anti-public check
    if (passed && this.antiPublic && domain) {
      const antiResult = this.antiPublic.filterUrl(trimmedUrl);
      if (!antiResult.passed) {
        reasons.push('public_domain');
        passed = false;
      } else if (antiResult.isNew) {
        this.stats.newDomains++;
      }
    }

    // 12. Deduplication
    if (passed && this.options.removeDuplicates) {
      const { isNew } = this.urlDedup.checkAndAdd(trimmedUrl);
      if (!isNew) {
        reasons.push('duplicate');
        passed = false;
      }
    }

    // Track domains
    if (passed && domain) {
      this.domainDedup.addFromUrl(trimmedUrl);
    }

    // Record stats
    if (passed) {
      this.stats.passed++;
    } else {
      this.stats.filtered++;
      for (const reason of reasons) {
        this.recordReason(reason);
      }
    }

    return {
      url: trimmedUrl,
      domain: domain || '',
      topDomain,
      passed,
      reasons,
    };
  }

  /**
   * Filter multiple URLs
   */
  filterUrls(urls: string[]): {
    passed: FilterResult[];
    filtered: FilterResult[];
    stats: FilterStats;
  } {
    const passed: FilterResult[] = [];
    const filtered: FilterResult[] = [];

    for (const url of urls) {
      const result = this.filterUrl(url);
      if (result.passed) {
        passed.push(result);
      } else {
        filtered.push(result);
      }
    }

    // Update domain counts
    const domainCounts = this.domainDedup.getCounts();
    this.stats.uniqueDomains = domainCounts.domains;
    this.stats.uniqueTopDomains = domainCounts.topDomains;

    return {
      passed,
      filtered,
      stats: { ...this.stats },
    };
  }

  /**
   * Quick filter - returns only passed URLs as strings
   */
  filter(urls: string[]): string[] {
    return urls
      .map(url => this.filterUrl(url))
      .filter(result => result.passed)
      .map(result => result.url);
  }

  /**
   * Process URL and return detailed result
   */
  process(url: string): FilteredResult {
    const result = this.filterUrl(url);
    let params: Record<string, string> = {};
    let extension = '';

    try {
      const parsed = new URL(url.includes('://') ? url : 'http://' + url);
      
      // Extract params
      parsed.searchParams.forEach((value, key) => {
        params[key] = value;
      });

      // Extract extension
      const pathParts = parsed.pathname.split('.');
      if (pathParts.length > 1) {
        extension = pathParts[pathParts.length - 1].split('/')[0].toLowerCase();
      }
    } catch {
      // Ignore parse errors
    }

    return {
      original: url,
      cleaned: this.urlDedup.normalizeUrl(url),
      domain: result.domain,
      topDomain: result.topDomain,
      hasParams: Object.keys(params).length > 0,
      params,
      extension,
      filtered: !result.passed,
      filterReason: result.reasons.join(', ') || undefined,
    };
  }

  /**
   * Get current statistics
   */
  getStats(): FilterStats {
    const domainCounts = this.domainDedup.getCounts();
    return {
      ...this.stats,
      uniqueDomains: domainCounts.domains,
      uniqueTopDomains: domainCounts.topDomains,
    };
  }

  /**
   * Get unique domains
   */
  getUniqueDomains(): string[] {
    return this.domainDedup.getDomains();
  }

  /**
   * Get unique top domains
   */
  getUniqueTopDomains(): string[] {
    return this.domainDedup.getTopDomains();
  }

  /**
   * Reset the pipeline
   */
  reset(): void {
    this.urlDedup.clear();
    this.domainDedup.clear();
    this.stats = this.createEmptyStats();
    logger.debug('Filter pipeline reset');
  }

  /**
   * Add domain to blacklist
   */
  addToBlacklist(domain: string): void {
    this.domainBlacklist.add(normalizeDomain(domain));
  }

  /**
   * Add TLD to blacklist
   */
  addTldToBlacklist(tld: string): void {
    this.tldBlacklist.add(tld.toLowerCase());
  }

  /**
   * Check if URL would pass filters (without recording)
   */
  wouldPass(url: string): boolean {
    // Create a temporary instance for checking
    const tempPipeline = new FilterPipeline({
      ...this.options,
      removeDuplicates: false, // Don't affect dedup state
    });
    return tempPipeline.filterUrl(url).passed;
  }

  /**
   * Export state for persistence
   */
  exportState(): object {
    return {
      stats: this.stats,
      dedup: this.urlDedup.export(),
      domains: this.domainDedup.getDomains(),
      topDomains: this.domainDedup.getTopDomains(),
    };
  }
}

// Singleton instance
let pipelineInstance: FilterPipeline | null = null;

/**
 * Get or create pipeline instance
 */
export function getFilterPipeline(options?: Partial<FilterPipelineOptions>): FilterPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new FilterPipeline(options);
  }
  return pipelineInstance;
}

/**
 * Reset pipeline instance
 */
export function resetFilterPipeline(): void {
  if (pipelineInstance) {
    pipelineInstance.reset();
    pipelineInstance = null;
  }
}

/**
 * Quick filter function
 */
export function filterUrls(
  urls: string[],
  options?: Partial<FilterPipelineOptions>
): string[] {
  const pipeline = new FilterPipeline(options);
  return pipeline.filter(urls);
}

export default FilterPipeline;
