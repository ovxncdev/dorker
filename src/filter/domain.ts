/**
 * Domain Utilities
 * Domain extraction, normalization, and manipulation
 */

// Common second-level TLDs
const SECOND_LEVEL_TLDS = new Set([
  'co.uk', 'org.uk', 'me.uk', 'net.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'school.nz', 'geek.nz', 'gen.nz',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'art.br', 'blog.br',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'ad.jp', 'ed.jp', 'go.jp', 'gr.jp', 'lg.jp',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 're.kr', 'pe.kr', 'ac.kr', 'ms.kr', 'hs.kr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'mil.cn',
  'com.tw', 'net.tw', 'org.tw', 'gov.tw', 'edu.tw', 'club.tw', 'ebiz.tw', 'game.tw',
  'com.hk', 'net.hk', 'org.hk', 'gov.hk', 'edu.hk', 'idv.hk',
  'com.sg', 'net.sg', 'org.sg', 'gov.sg', 'edu.sg', 'per.sg',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'res.in', 'gen.in', 'firm.in', 'ind.in',
  'co.id', 'or.id', 'web.id', 'net.id', 'go.id', 'ac.id', 'sch.id', 'mil.id',
  'co.th', 'in.th', 'or.th', 'ac.th', 'go.th', 'mi.th', 'net.th',
  'com.my', 'net.my', 'org.my', 'gov.my', 'edu.my', 'mil.my', 'name.my',
  'com.ph', 'net.ph', 'org.ph', 'gov.ph', 'edu.ph', 'mil.ph', 'ngo.ph',
  'com.vn', 'net.vn', 'org.vn', 'gov.vn', 'edu.vn', 'int.vn', 'ac.vn', 'biz.vn', 'info.vn',
  'co.za', 'net.za', 'org.za', 'gov.za', 'edu.za', 'ac.za', 'web.za',
  'com.mx', 'net.mx', 'org.mx', 'gob.mx', 'edu.mx',
  'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'edu.ar', 'int.ar', 'mil.ar', 'tur.ar',
  'com.co', 'net.co', 'org.co', 'gov.co', 'edu.co', 'mil.co', 'nom.co',
  'com.pe', 'net.pe', 'org.pe', 'gob.pe', 'edu.pe', 'mil.pe', 'nom.pe',
  'co.il', 'net.il', 'org.il', 'ac.il', 'gov.il', 'muni.il', 'idf.il',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr', 'bel.tr', 'pol.tr', 'mil.tr', 'bbs.tr', 'k12.tr', 'av.tr', 'dr.tr',
  'com.ua', 'net.ua', 'org.ua', 'gov.ua', 'edu.ua', 'in.ua', 'kiev.ua', 'kharkov.ua',
  'com.ru', 'net.ru', 'org.ru', 'gov.ru', 'edu.ru', 'int.ru', 'mil.ru', 'ac.ru', 'pp.ru',
  'com.pl', 'net.pl', 'org.pl', 'gov.pl', 'edu.pl', 'info.pl', 'biz.pl', 'waw.pl', 'krakow.pl',
  'co.at', 'or.at', 'gv.at', 'ac.at', 'priv.at',
  'com.eg', 'net.eg', 'org.eg', 'gov.eg', 'edu.eg', 'sci.eg', 'eun.eg',
  'com.sa', 'net.sa', 'org.sa', 'gov.sa', 'edu.sa', 'sch.sa', 'med.sa', 'pub.sa',
  'com.ae', 'net.ae', 'org.ae', 'gov.ae', 'ac.ae', 'sch.ae', 'mil.ae',
  'com.pk', 'net.pk', 'org.pk', 'gov.pk', 'edu.pk', 'fam.pk', 'biz.pk', 'web.pk',
  'com.bd', 'net.bd', 'org.bd', 'gov.bd', 'edu.bd', 'ac.bd', 'mil.bd',
  'com.ng', 'net.ng', 'org.ng', 'gov.ng', 'edu.ng', 'name.ng', 'sch.ng', 'mobi.ng',
  'com.gh', 'net.gh', 'org.gh', 'gov.gh', 'edu.gh', 'mil.gh',
  'com.ke', 'net.ke', 'org.ke', 'go.ke', 'ac.ke', 'sc.ke', 'ne.ke', 'or.ke', 'me.ke', 'mobi.ke', 'info.ke',
]);

// IP address regex
const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_REGEX = /^\[?([a-fA-F0-9:]+)\]?$/;

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    // Handle URLs without protocol
    let urlToParse = url.trim();
    if (!urlToParse.includes('://')) {
      urlToParse = 'http://' + urlToParse;
    }

    const parsed = new URL(urlToParse);
    let host = parsed.hostname.toLowerCase();

    // Remove port if present (shouldn't be in hostname but just in case)
    const colonIndex = host.lastIndexOf(':');
    if (colonIndex !== -1 && !host.includes('[')) {
      host = host.substring(0, colonIndex);
    }

    return host || null;
  } catch {
    return null;
  }
}

/**
 * Extract top-level domain (removes subdomains)
 */
export function extractTopDomain(url: string): string | null {
  const domain = extractDomain(url);
  if (!domain) {
    return null;
  }

  return getTopDomain(domain);
}

/**
 * Get top-level domain from a hostname
 */
export function getTopDomain(host: string): string {
  // Handle IP addresses
  if (IP_REGEX.test(host) || IPV6_REGEX.test(host)) {
    return host;
  }

  const parts = host.split('.');

  if (parts.length <= 2) {
    return host;
  }

  // Check for second-level TLDs
  if (parts.length >= 3) {
    const possibleSecondLevel = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (SECOND_LEVEL_TLDS.has(possibleSecondLevel)) {
      if (parts.length >= 3) {
        return `${parts[parts.length - 3]}.${possibleSecondLevel}`;
      }
      return possibleSecondLevel;
    }
  }

  // Return last two parts
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

/**
 * Extract TLD from domain
 */
export function extractTld(domain: string): string {
  const parts = domain.split('.');
  
  if (parts.length < 2) {
    return domain;
  }

  // Check for second-level TLD
  if (parts.length >= 2) {
    const possibleSecondLevel = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (SECOND_LEVEL_TLDS.has(possibleSecondLevel)) {
      return possibleSecondLevel;
    }
  }

  return parts[parts.length - 1];
}

/**
 * Check if domain is an IP address
 */
export function isIpAddress(domain: string): boolean {
  return IP_REGEX.test(domain) || IPV6_REGEX.test(domain.replace(/^\[|\]$/g, ''));
}

/**
 * Normalize domain (lowercase, remove www)
 */
export function normalizeDomain(domain: string, removeWww: boolean = true): string {
  let normalized = domain.toLowerCase().trim();

  if (removeWww && normalized.startsWith('www.')) {
    normalized = normalized.substring(4);
  }

  return normalized;
}

/**
 * Get subdomain from full domain
 */
export function getSubdomain(domain: string): string | null {
  const topDomain = getTopDomain(domain);
  
  if (domain === topDomain) {
    return null;
  }

  const subdomain = domain.substring(0, domain.length - topDomain.length - 1);
  return subdomain || null;
}

/**
 * Check if domain is a subdomain of another
 */
export function isSubdomainOf(domain: string, parent: string): boolean {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedParent = normalizeDomain(parent);

  if (normalizedDomain === normalizedParent) {
    return false;
  }

  return normalizedDomain.endsWith('.' + normalizedParent);
}

/**
 * Get all domain levels
 */
export function getDomainLevels(domain: string): string[] {
  const parts = domain.split('.');
  const levels: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    levels.push(parts.slice(i).join('.'));
  }

  return levels;
}

/**
 * Compare domains for sorting
 */
export function compareDomains(a: string, b: string): number {
  const partsA = a.split('.').reverse();
  const partsB = b.split('.').reverse();

  for (let i = 0; i < Math.min(partsA.length, partsB.length); i++) {
    const cmp = partsA[i].localeCompare(partsB[i]);
    if (cmp !== 0) {
      return cmp;
    }
  }

  return partsA.length - partsB.length;
}

/**
 * Group URLs by domain
 */
export function groupByDomain(urls: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const url of urls) {
    const domain = extractDomain(url);
    if (!domain) continue;

    const existing = groups.get(domain) || [];
    existing.push(url);
    groups.set(domain, existing);
  }

  return groups;
}

/**
 * Group URLs by top domain
 */
export function groupByTopDomain(urls: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const url of urls) {
    const topDomain = extractTopDomain(url);
    if (!topDomain) continue;

    const existing = groups.get(topDomain) || [];
    existing.push(url);
    groups.set(topDomain, existing);
  }

  return groups;
}

/**
 * Extract unique domains from URLs
 */
export function extractUniqueDomains(urls: string[]): string[] {
  const domains = new Set<string>();

  for (const url of urls) {
    const domain = extractDomain(url);
    if (domain) {
      domains.add(domain);
    }
  }

  return [...domains].sort(compareDomains);
}

/**
 * Extract unique top domains from URLs
 */
export function extractUniqueTopDomains(urls: string[]): string[] {
  const domains = new Set<string>();

  for (const url of urls) {
    const topDomain = extractTopDomain(url);
    if (topDomain) {
      domains.add(topDomain);
    }
  }

  return [...domains].sort(compareDomains);
}

/**
 * Check if domain matches pattern (supports wildcards)
 */
export function matchesDomainPattern(domain: string, pattern: string): boolean {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedPattern = normalizeDomain(pattern);

  // Exact match
  if (normalizedDomain === normalizedPattern) {
    return true;
  }

  // Wildcard pattern (*.example.com)
  if (normalizedPattern.startsWith('*.')) {
    const baseDomain = normalizedPattern.substring(2);
    return normalizedDomain === baseDomain || normalizedDomain.endsWith('.' + baseDomain);
  }

  // Suffix match (.example.com)
  if (normalizedPattern.startsWith('.')) {
    return normalizedDomain.endsWith(normalizedPattern);
  }

  return false;
}

/**
 * Filter domains by patterns
 */
export function filterDomainsByPatterns(
  domains: string[],
  patterns: string[],
  mode: 'include' | 'exclude'
): string[] {
  return domains.filter(domain => {
    const matches = patterns.some(pattern => matchesDomainPattern(domain, pattern));
    return mode === 'include' ? matches : !matches;
  });
}

/**
 * Check if domain is valid
 */
export function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > 253) {
    return false;
  }

  // IP address is valid
  if (isIpAddress(domain)) {
    return true;
  }

  // Check domain format
  const parts = domain.split('.');
  
  if (parts.length < 2) {
    return false;
  }

  for (const part of parts) {
    if (part.length === 0 || part.length > 63) {
      return false;
    }

    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(part)) {
      return false;
    }
  }

  return true;
}

export default {
  extractDomain,
  extractTopDomain,
  getTopDomain,
  extractTld,
  isIpAddress,
  normalizeDomain,
  getSubdomain,
  isSubdomainOf,
  getDomainLevels,
  compareDomains,
  groupByDomain,
  groupByTopDomain,
  extractUniqueDomains,
  extractUniqueTopDomains,
  matchesDomainPattern,
  filterDomainsByPatterns,
  isValidDomain,
};
