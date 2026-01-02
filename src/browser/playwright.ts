/**
 * Playwright Browser Fallback
 * Uses real browser automation when HTTP scraping fails (CAPTCHA, JS-heavy pages)
 */

import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';
import type { BrowserSettings } from '../types/index.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

// Browser types
export type BrowserType = 'chromium' | 'firefox' | 'webkit';

// Search result from browser
export interface BrowserSearchResult {
  urls: string[];
  hasNextPage: boolean;
  blocked: boolean;
  captcha: boolean;
  error?: string;
}

// Browser pool configuration
export interface BrowserPoolConfig {
  browserType: BrowserType;
  headless: boolean;
  maxContexts: number;
  timeout: number;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
}

const DEFAULT_CONFIG: BrowserPoolConfig = {
  browserType: 'chromium',
  headless: true,
  maxContexts: 5,
  timeout: 60000,
};

// Stealth settings to avoid detection
const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-site-isolation-trials',
  '--disable-web-security',
  '--disable-features=BlockInsecurePrivateNetworkRequests',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--window-size=1920,1080',
];

// Viewport configurations
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
];

// User agents for browser
const BROWSER_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.2; rv:121.0) Gecko/20100101 Firefox/121.0',
];

/**
 * Browser Context Pool
 */
export class BrowserPool {
  private config: BrowserPoolConfig;
  private browser: Browser | null = null;
  private contexts: BrowserContext[] = [];
  private availableContexts: BrowserContext[] = [];
  private busyContexts: Set<BrowserContext> = new Set();
  private initialized: boolean = false;

  constructor(config: Partial<BrowserPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing browser pool', {
      type: this.config.browserType,
      headless: this.config.headless,
      maxContexts: this.config.maxContexts,
    });

    const launchOptions = {
      headless: this.config.headless,
      args: STEALTH_ARGS,
    };

    switch (this.config.browserType) {
      case 'firefox':
        this.browser = await firefox.launch(launchOptions);
        break;
      case 'webkit':
        this.browser = await webkit.launch(launchOptions);
        break;
      default:
        this.browser = await chromium.launch(launchOptions);
    }

    for (let i = 0; i < this.config.maxContexts; i++) {
      const context = await this.createContext();
      this.contexts.push(context);
      this.availableContexts.push(context);
    }

    this.initialized = true;
    logger.info('Browser pool initialized', { contexts: this.contexts.length });
  }

  private async createContext(): Promise<BrowserContext> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
    const userAgent = BROWSER_USER_AGENTS[Math.floor(Math.random() * BROWSER_USER_AGENTS.length)];

    const contextOptions: any = {
      viewport,
      userAgent,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      geolocation: { latitude: 40.7128, longitude: -74.0060 },
      permissions: ['geolocation'],
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
    };

    if (this.config.proxy) {
      contextOptions.proxy = this.config.proxy;
    }

    const context = await this.browser.newContext(contextOptions);

    // Add stealth scripts (these run in browser context)
    await context.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      window.chrome = { runtime: {} };
    `);

    return context;
  }

  async acquire(): Promise<BrowserContext> {
    if (!this.initialized) {
      await this.initialize();
    }

    while (this.availableContexts.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const context = this.availableContexts.pop()!;
    this.busyContexts.add(context);
    return context;
  }

  release(context: BrowserContext): void {
    if (this.busyContexts.has(context)) {
      this.busyContexts.delete(context);
      this.availableContexts.push(context);
    }
  }

  async destroy(): Promise<void> {
    for (const context of this.contexts) {
      await context.close();
    }
    this.contexts = [];
    this.availableContexts = [];
    this.busyContexts.clear();

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.initialized = false;
    logger.info('Browser pool destroyed');
  }

  getStats(): { total: number; available: number; busy: number } {
    return {
      total: this.contexts.length,
      available: this.availableContexts.length,
      busy: this.busyContexts.size,
    };
  }
}

/**
 * Browser Search Engine
 */
export class BrowserSearchEngine {
  private pool: BrowserPool;
  private timeout: number;

  constructor(pool: BrowserPool, timeout: number = 60000) {
    this.pool = pool;
    this.timeout = timeout;
  }

  async search(dork: string, page: number = 0): Promise<BrowserSearchResult> {
    const context = await this.pool.acquire();

    try {
      const browserPage = await context.newPage();
      browserPage.setDefaultTimeout(this.timeout);

      const result = await this.performSearch(browserPage, dork, page);

      await browserPage.close();
      return result;
    } catch (error) {
      logger.error('Browser search failed', { dork, page, error });
      return {
        urls: [],
        hasNextPage: false,
        blocked: false,
        captcha: false,
        error: (error as Error).message,
      };
    } finally {
      this.pool.release(context);
    }
  }

  private async performSearch(page: Page, dork: string, pageNum: number): Promise<BrowserSearchResult> {
    const start = pageNum * 10;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(dork)}&start=${start}&num=10`;

    await page.goto(searchUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000 + Math.random() * 2000);

    const captchaDetected = await this.detectCaptcha(page);
    if (captchaDetected) {
      return { urls: [], hasNextPage: false, blocked: false, captcha: true };
    }

    const blocked = await this.detectBlock(page);
    if (blocked) {
      return { urls: [], hasNextPage: false, blocked: true, captcha: false };
    }

    const urls = await this.extractUrls(page);
    const hasNextPage = await this.hasNextPage(page);

    return { urls, hasNextPage, blocked: false, captcha: false };
  }

  private async detectCaptcha(page: Page): Promise<boolean> {
    const captchaSelectors = ['#captcha', '.g-recaptcha', 'iframe[src*="recaptcha"]', '[data-sitekey]'];

    for (const selector of captchaSelectors) {
      const element = await page.$(selector);
      if (element) return true;
    }

    const content = await page.content();
    return content.includes('unusual traffic') || content.includes('captcha') || content.includes('robot');
  }

  private async detectBlock(page: Page): Promise<boolean> {
    const content = await page.content();
    return content.includes('blocked') || content.includes('forbidden') || content.includes('access denied');
  }

  private async extractUrls(page: Page): Promise<string[]> {
    const urls: string[] = [];
    const selectors = ['a[data-ved] h3', '.yuRUbf a', '#search a[href^="http"]', '.g a[href^="http"]'];

    for (const selector of selectors) {
      const elements = await page.$$(selector);
      
      for (const element of elements) {
        try {
          let href: string | null = null;
          const tagName = await element.evaluate(el => el.tagName.toLowerCase());
          
          if (tagName === 'a') {
            href = await element.getAttribute('href');
          } else {
            const parent = await element.$('xpath=ancestor::a');
            if (parent) {
              href = await parent.getAttribute('href');
            }
          }

          if (href && href.startsWith('http') && !href.includes('google.com')) {
            if (href.includes('/url?')) {
              const urlObj = new URL(href);
              const actualUrl = urlObj.searchParams.get('q') || urlObj.searchParams.get('url');
              if (actualUrl) href = actualUrl;
            }
            if (!urls.includes(href)) urls.push(href);
          }
        } catch {
          // Ignore extraction errors
        }
      }

      if (urls.length > 0) break;
    }

    return urls.slice(0, 20);
  }

  private async hasNextPage(page: Page): Promise<boolean> {
    const nextSelectors = ['#pnnext', 'a[aria-label="Next page"]', 'a:has-text("Next")'];
    for (const selector of nextSelectors) {
      const element = await page.$(selector);
      if (element) return true;
    }
    return false;
  }
}

/**
 * Browser Fallback Manager
 */
export class BrowserFallback {
  private pool: BrowserPool | null = null;
  private engine: BrowserSearchEngine | null = null;
  private settings: BrowserSettings;
  private initialized: boolean = false;

  constructor(settings: Partial<BrowserSettings> = {}) {
    this.settings = {
      enabled: true,
      fallbackOnly: true,
      headless: true,
      stealth: true,
      timeout: 60000,
      maxContexts: 5,
      ...settings,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized || !this.settings.enabled) return;

    this.pool = new BrowserPool({
      headless: this.settings.headless,
      maxContexts: this.settings.maxContexts,
      timeout: this.settings.timeout,
    });

    await this.pool.initialize();
    this.engine = new BrowserSearchEngine(this.pool, this.settings.timeout);
    this.initialized = true;
    logger.info('Browser fallback initialized');
  }

  async search(dork: string, page: number = 0): Promise<BrowserSearchResult> {
    if (!this.settings.enabled) {
      return { urls: [], hasNextPage: false, blocked: false, captcha: false, error: 'Browser fallback disabled' };
    }
    if (!this.initialized) await this.initialize();
    return this.engine!.search(dork, page);
  }

  isInitialized(): boolean { return this.initialized; }

  getStats(): { total: number; available: number; busy: number } | null {
    return this.pool?.getStats() || null;
  }

  async cleanup(): Promise<void> {
    if (this.pool) {
      await this.pool.destroy();
      this.pool = null;
      this.engine = null;
    }
    this.initialized = false;
    logger.info('Browser fallback cleaned up');
  }
}

let browserFallbackInstance: BrowserFallback | null = null;

export function getBrowserFallback(settings?: Partial<BrowserSettings>): BrowserFallback {
  if (!browserFallbackInstance) {
    browserFallbackInstance = new BrowserFallback(settings);
  }
  return browserFallbackInstance;
}

export async function resetBrowserFallback(): Promise<void> {
  if (browserFallbackInstance) {
    await browserFallbackInstance.cleanup();
    browserFallbackInstance = null;
  }
}

export default BrowserFallback;
