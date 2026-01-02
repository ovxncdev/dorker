
import { BloomFilter } from 'bloom-filters';

const DEFAULT_ANTI_PUBLIC = new Set([
  'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com',
  'youtube.com', 'google.com', 'bing.com', 'yahoo.com',
  'wikipedia.org', 'amazon.com', 'github.com', 'reddit.com',
  'microsoft.com', 'apple.com', 'cloudflare.com', 'amazonaws.com',
]);

export class FilterPipeline {
  constructor(config) {
    this.config = config;
    this.antiPublic = new Set(DEFAULT_ANTI_PUBLIC);
    this.seenUrls = BloomFilter.create(10_000_000, 0.001);
    this.seenDomains = BloomFilter.create(1_000_000, 0.001);
    this.stats = { totalInput: 0, finalOutput: 0, uniqueDomains: 0 };
  }

  loadAntiPublicDomains(domains) {
    domains.forEach(d => {
      const cleaned = d.trim().toLowerCase();
      if (cleaned && !cleaned.startsWith('#')) this.antiPublic.add(cleaned);
    });
  }

  extractDomain(url) {
    try {
      const u = new URL(url);
      const parts = u.hostname.split('.');
      if (parts.length >= 2) {
        return parts.slice(-2).join('.');
      }
      return u.hostname;
    } catch { return null; }
  }

  filterSingle(result) {
    this.stats.totalInput++;
    let url = result.url;

    const normalized = url.toLowerCase();
    if (this.seenUrls.has(normalized)) return null;
    this.seenUrls.add(normalized);

    if (this.config.antiPublic) {
      const domain = this.extractDomain(url);
      if (domain && this.antiPublic.has(domain)) return null;
    }

    if (this.config.removeDuplicateDomains) {
      const domain = this.extractDomain(url);
      if (!domain) return null;
      if (this.seenDomains.has(domain)) return null;
      this.seenDomains.add(domain);
      this.stats.uniqueDomains++;
    }

    if (this.config.urlParametersOnly) {
      try {
        const u = new URL(url);
        if (!u.search) return null;
      } catch { return null; }
    }

    this.stats.finalOutput++;
    return { ...result, url };
  }

  filter(results) {
    return results.map(r => this.filterSingle(r)).filter(r => r !== null);
  }

  getStats() { return { ...this.stats }; }
  reset() {
    this.seenUrls = BloomFilter.create(10_000_000, 0.001);
    this.seenDomains = BloomFilter.create(1_000_000, 0.001);
    this.stats = { totalInput: 0, finalOutput: 0, uniqueDomains: 0 };
  }
}

export function createFilter(config) {
  return new FilterPipeline(config);
}
