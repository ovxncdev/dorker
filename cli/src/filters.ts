import { parse as parseUrl } from 'node:url';
import { parse as parseDomain, type ParsedDomain } from 'tldts';
import { BloomFilter } from 'bloom-filters';
import type { SearchResult, FilterConfig } from './types.js';

// Anti-public domains list (common public domains to filter out)
const DEFAULT_ANTI_PUBLIC_DOMAINS = new Set([
  // Social media
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'linkedin.com',
  'pinterest.com',
  'tiktok.com',
  'snapchat.com',
  'reddit.com',
  'tumblr.com',
  'flickr.com',
  'vk.com',
  'weibo.com',

  // Video platforms
  'youtube.com',
  'vimeo.com',
  'dailymotion.com',
  'twitch.tv',

  // Search engines
  'google.com',
  'bing.com',
  'yahoo.com',
  'duckduckgo.com',
  'baidu.com',
  'yandex.com',
  'yandex.ru',

  // Major tech
  'microsoft.com',
  'apple.com',
  'amazon.com',
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'stackoverflow.com',
  'stackexchange.com',

  // Knowledge/Reference
  'wikipedia.org',
  'wikimedia.org',
  'wiktionary.org',
  'wikihow.com',
  'quora.com',
  'medium.com',

  // Cloud providers
  'amazonaws.com',
  'cloudfront.net',
  'googleusercontent.com',
  'googleapis.com',
  'azure.com',
  'azurewebsites.net',
  'cloudflare.com',
  'akamai.com',
  'fastly.net',

  // CDNs and static content
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'bootstrapcdn.com',

  // URL shorteners
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',

  // News/Media
  'cnn.com',
  'bbc.com',
  'bbc.co.uk',
  'nytimes.com',
  'theguardian.com',
  'washingtonpost.com',
  'reuters.com',
  'forbes.com',
  'bloomberg.com',

  // E-commerce
  'ebay.com',
  'alibaba.com',
  'aliexpress.com',
  'shopify.com',
  'etsy.com',

  // Others
  'archive.org',
  'web.archive.org',
  'slideshare.net',
  'scribd.com',
  'issuu.com',
  'dropbox.com',
  'drive.google.com',
  'docs.google.com',
  'onedrive.live.com',
]);

export class FilterPipeline {
  private config: FilterConfig;
  private antiPublicDomains: Set<string>;
  private seenUrls: BloomFilter;
  private seenDomains: BloomFilter;
  private stats: FilterStats;

  constructor(config: FilterConfig) {
    this.config = config;
    this.antiPublicDomains = new Set(DEFAULT_ANTI_PUBLIC_DOMAINS);
    
    // Initialize bloom filters for deduplication
    // Size for ~10M items with 0.1% false positive rate
    this.seenUrls = BloomFilter.create(10_000_000, 0.001);
    this.seenDomains = BloomFilter.create(1_000_000, 0.001);
    
    this.stats = {
      totalInput: 0,
      afterRedirectClean: 0,
      afterDedup: 0,
      afterAntiPublic: 0,
      afterDomainDedup: 0,
      finalOutput: 0,
      uniqueDomains: 0,
    };
  }

  // Load additional anti-public domains from file content
  loadAntiPublicDomains(domains: string[]): void {
    for (const domain of domains) {
      const cleaned = domain.trim().toLowerCase();
      if (cleaned && !cleaned.startsWith('#')) {
        this.antiPublicDomains.add(cleaned);
      }
    }
  }

  // Main filter function
  filter(results: SearchResult[]): SearchResult[] {
    this.stats.totalInput += results.length;

    let filtered = results;

    // Step 1: Clean redirect URLs
    if (this.config.noRedirectUrls) {
      filtered = filtered
        .map((r) => ({ ...r, url: this.cleanRedirectUrl(r.url) }))
        .filter((r) => r.url !== '');
    }
    this.stats.afterRedirectClean = filtered.length;

    // Step 2: URL deduplication
    filtered = filtered.filter((r) => {
      const normalized = this.normalizeUrl(r.url);
      if (this.seenUrls.has(normalized)) {
        return false;
      }
      this.seenUrls.add(normalized);
      return true;
    });
    this.stats.afterDedup = filtered.length;

    // Step 3: Anti-public filter
    if (this.config.antiPublic) {
      filtered = filtered.filter((r) => !this.isPublicDomain(r.url));
    }
    this.stats.afterAntiPublic = filtered.length;

    // Step 4: Domain deduplication
    if (this.config.removeDuplicateDomains) {
      filtered = filtered.filter((r) => {
        const domain = this.extractDomain(r.url);
        if (!domain) return false;
        if (this.seenDomains.has(domain)) {
          return false;
        }
        this.seenDomains.add(domain);
        this.stats.uniqueDomains++;
        return true;
      });
    }
    this.stats.afterDomainDedup = filtered.length;

    // Step 5: URL parameters only filter
    if (this.config.urlParametersOnly) {
      filtered = filtered.filter((r) => this.hasParameters(r.url));
    }

    // Step 6: Clean top domains (extract root domain only)
    if (this.config.cleanTopDomains) {
      filtered = filtered.map((r) => ({
        ...r,
        url: this.cleanToTopDomain(r.url),
      }));
    }

    this.stats.finalOutput = filtered.length;

    return filtered;
  }

  // Filter single URL (for streaming)
  filterSingle(result: SearchResult): SearchResult | null {
    this.stats.totalInput++;

    let url = result.url;

    // Step 1: Clean redirect URLs
    if (this.config.noRedirectUrls) {
      url = this.cleanRedirectUrl(url);
      if (!url) return null;
    }

    // Step 2: URL deduplication
    const normalized = this.normalizeUrl(url);
    if (this.seenUrls.has(normalized)) {
      return null;
    }
    this.seenUrls.add(normalized);

    // Step 3: Anti-public filter
    if (this.config.antiPublic && this.isPublicDomain(url)) {
      return null;
    }

    // Step 4: Domain deduplication
    if (this.config.removeDuplicateDomains) {
      const domain = this.extractDomain(url);
      if (!domain) return null;
      if (this.seenDomains.has(domain)) {
        return null;
      }
      this.seenDomains.add(domain);
      this.stats.uniqueDomains++;
    }

    // Step 5: URL parameters only filter
    if (this.config.urlParametersOnly && !this.hasParameters(url)) {
      return null;
    }

    // Step 6: Clean top domains
    if (this.config.cleanTopDomains) {
      url = this.cleanToTopDomain(url);
    }

    this.stats.finalOutput++;

    return { ...result, url };
  }

  // Clean Google redirect URLs
  private cleanRedirectUrl(url: string): string {
    try {
      // Handle Google redirect URLs
      if (url.includes('/url?') || url.includes('google.com/url')) {
        const parsed = parseUrl(url, true);
        const targetUrl = parsed.query?.['q'] || parsed.query?.['url'];
        if (typeof targetUrl === 'string') {
          return targetUrl;
        }
      }

      // Handle other common redirects
      const redirectPatterns = [
        /[?&]url=([^&]+)/i,
        /[?&]u=([^&]+)/i,
        /[?&]redirect=([^&]+)/i,
        /[?&]goto=([^&]+)/i,
        /[?&]target=([^&]+)/i,
      ];

      for (const pattern of redirectPatterns) {
        const match = url.match(pattern);
        if (match?.[1]) {
          try {
            return decodeURIComponent(match[1]);
          } catch {
            return match[1];
          }
        }
      }

      return url;
    } catch {
      return url;
    }
  }

  // Normalize URL for deduplication
  private normalizeUrl(url: string): string {
    try {
      const parsed = parseUrl(url);
      
      // Remove trailing slashes, lowercase host
      let normalized = `${parsed.protocol}//${parsed.host?.toLowerCase() || ''}${parsed.pathname?.replace(/\/+$/, '') || ''}`;
      
      // Sort query parameters for consistency
      if (parsed.query && typeof parsed.query === 'string') {
        const params = new URLSearchParams(parsed.query);
        const sortedParams = Array.from(params.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join('&');
        if (sortedParams) {
          normalized += `?${sortedParams}`;
        }
      }

      return normalized;
    } catch {
      return url.toLowerCase();
    }
  }

  // Extract domain from URL
  private extractDomain(url: string): string | null {
    try {
      const parsed: ParsedDomain = parseDomain(url);
      return parsed.domain || null;
    } catch {
      return null;
    }
  }

  // Check if URL belongs to a public domain
  private isPublicDomain(url: string): boolean {
    try {
      const parsed: ParsedDomain = parseDomain(url);
      const domain = parsed.domain?.toLowerCase();
      
      if (!domain) return false;

      // Check exact match
      if (this.antiPublicDomains.has(domain)) {
        return true;
      }

      // Check hostname match (for subdomains)
      const hostname = parsed.hostname?.toLowerCase();
      if (hostname) {
        for (const publicDomain of this.antiPublicDomains) {
          if (hostname === publicDomain || hostname.endsWith(`.${publicDomain}`)) {
            return true;
          }
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  // Check if URL has query parameters
  private hasParameters(url: string): boolean {
    try {
      const parsed = parseUrl(url);
      return Boolean(parsed.query && parsed.query.length > 0);
    } catch {
      return false;
    }
  }

  // Clean URL to top-level domain only
  private cleanToTopDomain(url: string): string {
    try {
      const parsed = parseUrl(url);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return url;
    }
  }

  // Get filter statistics
  getStats(): FilterStats {
    return { ...this.stats };
  }

  // Reset statistics
  resetStats(): void {
    this.stats = {
      totalInput: 0,
      afterRedirectClean: 0,
      afterDedup: 0,
      afterAntiPublic: 0,
      afterDomainDedup: 0,
      finalOutput: 0,
      uniqueDomains: 0,
    };
  }

  // Reset bloom filters (for new session)
  reset(): void {
    this.seenUrls = BloomFilter.create(10_000_000, 0.001);
    this.seenDomains = BloomFilter.create(1_000_000, 0.001);
    this.resetStats();
  }
}

export interface FilterStats {
  totalInput: number;
  afterRedirectClean: number;
  afterDedup: number;
  afterAntiPublic: number;
  afterDomainDedup: number;
  finalOutput: number;
  uniqueDomains: number;
}

// Utility function to create filter from config
export function createFilter(config: FilterConfig): FilterPipeline {
  return new FilterPipeline(config);
}

// Utility function to extract just domains from URLs
export function extractDomains(urls: string[]): string[] {
  const domains = new Set<string>();
  
  for (const url of urls) {
    try {
      const parsed: ParsedDomain = parseDomain(url);
      if (parsed.domain) {
        domains.add(parsed.domain);
      }
    } catch {
      // Skip invalid URLs
    }
  }

  return Array.from(domains);
}

// Utility function to group URLs by domain
export function groupByDomain(urls: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const url of urls) {
    try {
      const parsed: ParsedDomain = parseDomain(url);
      const domain = parsed.domain || 'unknown';
      
      const existing = groups.get(domain) || [];
      existing.push(url);
      groups.set(domain, existing);
    } catch {
      const existing = groups.get('unknown') || [];
      existing.push(url);
      groups.set('unknown', existing);
    }
  }

  return groups;
}
