// Anti-public domains - common sites to filter out
const ANTI_PUBLIC_DOMAINS = new Set([
  // Social
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
  'pinterest.com', 'tiktok.com', 'reddit.com', 'tumblr.com',
  // Video
  'youtube.com', 'vimeo.com', 'dailymotion.com', 'twitch.tv',
  // Search
  'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'baidu.com',
  // Tech
  'github.com', 'gitlab.com', 'stackoverflow.com', 'microsoft.com', 'apple.com',
  // Cloud
  'amazonaws.com', 'cloudfront.net', 'azure.com', 'cloudflare.com',
  // Reference
  'wikipedia.org', 'wikimedia.org', 'medium.com', 'quora.com',
  // News
  'cnn.com', 'bbc.com', 'nytimes.com', 'reuters.com', 'forbes.com',
  // Shopping
  'amazon.com', 'ebay.com', 'alibaba.com', 'shopify.com',
  // Other
  'archive.org', 'dropbox.com', 't.co', 'bit.ly', 'goo.gl'
]);

export class FilterPipeline {
  constructor(options = {}) {
    this.options = {
      antiPublic: true,
      dedup: true,
      domainDedup: true,
      paramsOnly: false,
      cleanRedirects: true,
      ...options
    };

    this.seenUrls = new Set();
    this.seenDomains = new Set();
    this.customAntiPublic = new Set();

    this.stats = {
      input: 0,
      afterRedirect: 0,
      afterDedup: 0,
      afterAntiPublic: 0,
      afterDomainDedup: 0,
      afterParams: 0,
      output: 0
    };
  }

  loadAntiPublicDomains(domains) {
    domains.forEach(d => {
      const cleaned = d.trim().toLowerCase();
      if (cleaned && !cleaned.startsWith('#')) {
        this.customAntiPublic.add(cleaned);
      }
    });
  }

  extractDomain(url) {
    try {
      const u = new URL(url);
      const parts = u.hostname.toLowerCase().split('.');
      // Get root domain (last 2 parts, or 3 for .co.uk etc)
      if (parts.length >= 2) {
        const tld = parts[parts.length - 1];
        const sld = parts[parts.length - 2];
        // Handle .co.uk, .com.au, etc
        if (['co', 'com', 'org', 'net', 'gov', 'edu'].includes(sld) && parts.length >= 3) {
          return parts.slice(-3).join('.');
        }
        return parts.slice(-2).join('.');
      }
      return u.hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  cleanRedirectUrl(url) {
    try {
      // Google redirect
      if (url.includes('/url?') || url.includes('google.com/url')) {
        const u = new URL(url);
        const target = u.searchParams.get('q') || u.searchParams.get('url');
        if (target) return target;
      }

      // Common redirect patterns
      const patterns = [
        /[?&]url=([^&]+)/i,
        /[?&]u=([^&]+)/i,
        /[?&]redirect=([^&]+)/i,
        /[?&]goto=([^&]+)/i,
        /[?&]link=([^&]+)/i
      ];

      for (const pattern of patterns) {
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

  isAntiPublic(domain) {
    if (!domain) return false;
    
    // Check exact match
    if (ANTI_PUBLIC_DOMAINS.has(domain) || this.customAntiPublic.has(domain)) {
      return true;
    }

    // Check if subdomain of anti-public
    for (const blocked of ANTI_PUBLIC_DOMAINS) {
      if (domain.endsWith('.' + blocked)) return true;
    }
    for (const blocked of this.customAntiPublic) {
      if (domain.endsWith('.' + blocked)) return true;
    }

    return false;
  }

  hasParams(url) {
    try {
      const u = new URL(url);
      return u.search.length > 1; // More than just '?'
    } catch {
      return false;
    }
  }

  filterOne(url) {
    this.stats.input++;

    // Step 1: Clean redirects
    if (this.options.cleanRedirects) {
      url = this.cleanRedirectUrl(url);
    }
    if (!url) return null;
    this.stats.afterRedirect++;

    // Step 2: URL dedup
    if (this.options.dedup) {
      const normalized = url.toLowerCase();
      if (this.seenUrls.has(normalized)) return null;
      this.seenUrls.add(normalized);
    }
    this.stats.afterDedup++;

    // Step 3: Anti-public
    if (this.options.antiPublic) {
      const domain = this.extractDomain(url);
      if (this.isAntiPublic(domain)) return null;
    }
    this.stats.afterAntiPublic++;

    // Step 4: Domain dedup
    if (this.options.domainDedup) {
      const domain = this.extractDomain(url);
      if (!domain) return null;
      if (this.seenDomains.has(domain)) return null;
      this.seenDomains.add(domain);
    }
    this.stats.afterDomainDedup++;

    // Step 5: Params only
    if (this.options.paramsOnly) {
      if (!this.hasParams(url)) return null;
    }
    this.stats.afterParams++;

    this.stats.output++;
    return url;
  }

  filter(urls) {
    return urls.map(u => this.filterOne(u)).filter(u => u !== null);
  }

  getStats() {
    return {
      ...this.stats,
      uniqueDomains: this.seenDomains.size,
      uniqueUrls: this.seenUrls.size
    };
  }

  reset() {
    this.seenUrls.clear();
    this.seenDomains.clear();
    this.stats = {
      input: 0, afterRedirect: 0, afterDedup: 0,
      afterAntiPublic: 0, afterDomainDedup: 0, afterParams: 0, output: 0
    };
  }
}

export default FilterPipeline;
