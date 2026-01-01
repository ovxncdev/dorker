/**
 * Core Type Definitions for Google Dork Parser
 */

// ============================================
// MESSAGE TYPES (Go <-> TypeScript Communication)
// ============================================

export type MessageType =
  | 'init'
  | 'task'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'health'
  | 'add_proxy'
  | 'del_proxy'
  | 'ready'
  | 'result'
  | 'error'
  | 'blocked'
  | 'progress'
  | 'proxy_status'
  | 'stats'
  | 'done';

export type BlockReason =
  | 'captcha'
  | 'rate_limit'
  | 'banned'
  | 'timeout'
  | 'proxy_dead'
  | 'empty_page'
  | 'unknown';

export type ProxyStatus = 'unknown' | 'alive' | 'dead' | 'slow' | 'quarantined' | 'banned';

export type EngineType = 'google' | 'bing' | 'yahoo' | 'duckduckgo' | 'yandex' | 'ask';

export interface BaseMessage {
  type: MessageType;
  timestamp: number;
  id?: string;
}

// Outgoing messages (to Go)
export interface InitMessage extends BaseMessage {
  type: 'init';
  config: EngineConfig;
}

export interface TaskMessage extends BaseMessage {
  type: 'task';
  task_id: string;
  dork: string;
  proxy?: string;
  page: number;
}

export interface ProxyMessage extends BaseMessage {
  type: 'add_proxy' | 'del_proxy';
  proxy: string;
  protocol: string;
}

// Incoming messages (from Go)
export interface ReadyMessage extends BaseMessage {
  type: 'ready';
  version: string;
  go_version: string;
  max_workers: number;
  proxy_count: number;
}

export interface ResultMessage extends BaseMessage {
  type: 'result';
  task_id: string;
  dork: string;
  page: number;
  urls: string[];
  raw_urls: string[];
  has_next_page: boolean;
  time_taken_ms: number;
  proxy_used: string;
}

export interface ErrorMessage extends BaseMessage {
  type: 'error';
  task_id?: string;
  code: string;
  message: string;
  fatal: boolean;
}

export interface BlockedMessage extends BaseMessage {
  type: 'blocked';
  task_id: string;
  dork: string;
  proxy: string;
  reason: BlockReason;
  detail?: string;
}

export interface ProgressMessage extends BaseMessage {
  type: 'progress';
  completed: number;
  total: number;
  urls_found: number;
  active_tasks: number;
}

export interface ProxyStatusMessage extends BaseMessage {
  type: 'proxy_status';
  proxy: string;
  status: ProxyStatus;
  latency_ms: number;
  success_rate: number;
  last_used: number;
  fail_count: number;
}

export interface StatsMessage extends BaseMessage {
  type: 'stats';
  uptime_ms: number;
  total_requests: number;
  success_requests: number;
  failed_requests: number;
  total_urls: number;
  unique_urls: number;
  requests_per_min: number;
  urls_per_min: number;
  avg_latency_ms: number;
  active_proxies: number;
  dead_proxies: number;
  memory_usage_bytes: number;
}

export interface DoneMessage extends BaseMessage {
  type: 'done';
  task_id: string;
  total_urls: number;
  time_taken_ms: number;
}

export type IncomingMessage =
  | ReadyMessage
  | ResultMessage
  | ErrorMessage
  | BlockedMessage
  | ProgressMessage
  | ProxyStatusMessage
  | StatsMessage
  | DoneMessage;

// ============================================
// CONFIGURATION TYPES
// ============================================

export interface EngineConfig {
  engine: EngineType;
  workers: number;
  pages_per_dork: number;
  timeout_ms: number;
  delay_min_ms: number;
  delay_max_ms: number;
  retry_attempts: number;
  proxy_rotate_after: number;
  user_agents: string[];
  google_domains: string[];
}

export interface Settings {
  version: string;
  engine: EngineSettings;
  proxy: ProxySettings;
  stealth: StealthSettings;
  filter: FilterSettings;
  output: OutputSettings;
  antiPublic: AntiPublicSettings;
  browser: BrowserSettings;
  notifications: NotificationSettings;
  logging: LoggingSettings;
  state: StateSettings;
  cli: CliSettings;
  limits: LimitSettings;
  advanced: AdvancedSettings;
}

export interface EngineSettings {
  type: EngineType;
  workers: number;
  pagesPerDork: number;
  resultsPerPage: number;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface ProxySettings {
  rotateAfter: number;
  rotationStrategy: 'round_robin' | 'random' | 'least_used' | 'least_latency' | 'weighted';
  healthCheckOnStart: boolean;
  healthCheckInterval: number;
  quarantineDuration: number;
  maxFailCount: number;
  protocols: string[];
}

export interface StealthSettings {
  profile: 'aggressive' | 'normal' | 'cautious' | 'stealth';
  delayMin: number;
  delayMax: number;
  burstSize: number;
  burstPause: number;
  sessionMaxRequests: number;
  sessionCooldown: number;
  jitterPercent: number;
  rotateUserAgent: boolean;
  rotateGoogleDomain: boolean;
}

export interface FilterSettings {
  cleanDomains: boolean;
  removeRedirects: boolean;
  removeDuplicates: boolean;
  urlParamsOnly: boolean;
  antiPublic: boolean;
  localAntiPublic: boolean;
  tldWhitelist: string[];
  tldBlacklist: string[];
  domainBlacklist: string[];
  keywordInclude: string[];
  keywordExclude: string[];
  minUrlLength: number;
  maxUrlLength: number;
}

export interface OutputSettings {
  directory: string;
  formats: ('txt' | 'json' | 'csv' | 'sqlite')[];
  separateByDork: boolean;
  includeRaw: boolean;
  includeFiltered: boolean;
  includeDomains: boolean;
  includeStats: boolean;
  realTimeWrite: boolean;
  timestampFolders: boolean;
}

export interface AntiPublicSettings {
  enabled: boolean;
  domains: string[];
}

export interface BrowserSettings {
  enabled: boolean;
  fallbackOnly: boolean;
  headless: boolean;
  stealth: boolean;
  timeout: number;
  maxContexts: number;
}

export interface NotificationSettings {
  discord: {
    enabled: boolean;
    webhookUrl: string;
    notifyOnComplete: boolean;
    notifyOnError: boolean;
    notifyOnMilestone: boolean;
    milestoneInterval: number;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
    notifyOnComplete: boolean;
    notifyOnError: boolean;
  };
}

export interface LoggingSettings {
  level: 'debug' | 'info' | 'warn' | 'error';
  console: boolean;
  file: boolean;
  directory: string;
  maxFiles: number;
  maxSize: string;
  format: 'json' | 'text';
}

export interface StateSettings {
  saveProgress: boolean;
  saveInterval: number;
  stateFile: string;
  historyDb: string;
}

export interface CliSettings {
  showBanner: boolean;
  showProgress: boolean;
  showStats: boolean;
  showActivity: boolean;
  refreshInterval: number;
  colors: boolean;
}

export interface LimitSettings {
  maxDorks: number;
  maxUrls: number;
  maxDomains: number;
  maxTime: number;
  maxMemory: number;
}

export interface AdvancedSettings {
  bloomFilterSize: number;
  bloomFilterErrorRate: number;
  streamBufferSize: number;
  maxConcurrentWrites: number;
  gcInterval: number;
}

// ============================================
// PROXY TYPES
// ============================================

export interface Proxy {
  id: string;
  host: string;
  port: string;
  username?: string;
  password?: string;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  status: ProxyStatus;
  latency: number;
  lastCheck: Date | null;
  lastUsed: Date | null;
  successCount: number;
  failCount: number;
  captchaCount: number;
  banCount: number;
  quarantineUntil: Date | null;
}

export interface ProxyStats {
  total: number;
  alive: number;
  dead: number;
  slow: number;
  quarantined: number;
  avgLatency: number;
  successRate: number;
}

// ============================================
// TASK TYPES
// ============================================

export interface Task {
  id: string;
  dork: string;
  page: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  proxy?: string;
  retryCount: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  urls: string[];
}

export interface TaskQueue {
  pending: Task[];
  running: Task[];
  completed: Task[];
  failed: Task[];
}

// ============================================
// RESULT TYPES
// ============================================

export interface SearchResult {
  dork: string;
  page: number;
  urls: string[];
  rawUrls: string[];
  domains: string[];
  hasNextPage: boolean;
  timestamp: Date;
  latency: number;
  proxy: string;
}

export interface FilteredResult {
  original: string;
  cleaned: string;
  domain: string;
  topDomain: string;
  hasParams: boolean;
  params: Record<string, string>;
  extension: string;
  filtered: boolean;
  filterReason?: string;
}

export interface OutputStats {
  totalDorks: number;
  completedDorks: number;
  totalPages: number;
  totalUrls: number;
  uniqueUrls: number;
  uniqueDomains: number;
  filteredUrls: number;
  startTime: Date;
  endTime?: Date;
  duration: number;
  requestsPerMin: number;
  urlsPerMin: number;
  successRate: number;
}

// ============================================
// CLI TYPES
// ============================================

export interface CliOptions {
  dorks: string;
  proxies: string;
  output: string;
  threads: number;
  pages: number;
  timeout: number;
  delay: string;
  format: string;
  resume: boolean;
  validate: boolean;
  checkProxies: boolean;
  estimate: boolean;
  config: string;
  verbose: boolean;
  quiet: boolean;
}

export interface ProgressState {
  completed: number;
  total: number;
  urlsFound: number;
  uniqueDomains: number;
  activeWorkers: number;
  requestsPerMin: number;
  eta: string;
  elapsed: string;
  successRate: number;
}

export interface ActivityLogEntry {
  timestamp: Date;
  type: 'success' | 'error' | 'warning' | 'info';
  dork: string;
  message: string;
  urlCount?: number;
}

// ============================================
// STATE TYPES
// ============================================

export interface SavedState {
  version: string;
  timestamp: Date;
  completedDorks: string[];
  pendingDorks: string[];
  failedDorks: string[];
  stats: OutputStats;
  lastProxy: string;
  lastDork: string;
}

// ============================================
// UTILITY TYPES
// ============================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export interface AsyncResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
