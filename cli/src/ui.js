
import blessed from 'blessed';
import contrib from 'blessed-contrib';

export class DorkerUI {
  constructor() {
    this.screen = null;
    this.grid = null;
    this.widgets = {};
    this.state = {
      phase: 'init', // init, running, paused, complete
      dorks: { total: 0, completed: 0, failed: 0 },
      urls: { raw: 0, filtered: 0, domains: 0 },
      proxies: { total: 0, alive: 0, dead: 0, quarantined: 0 },
      timing: { started: null, elapsed: 0, eta: 0 },
      throughput: [],
      activity: [],
      stats: { requestsPerMin: 0, successRate: 0 }
    };
    this.callbacks = {};
  }

  init() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Dorker - Google Dork Parser',
      fullUnicode: true,
    });

    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen
    });

    this.createWidgets();
    this.setupKeys();
    this.render();
  }

  createWidgets() {
    // Banner/Logo (row 0-2, col 0-12)
    this.widgets.banner = this.grid.set(0, 0, 2, 12, blessed.box, {
      content: this.getBanner(),
      tags: true,
      style: {
        fg: 'cyan',
        border: { fg: 'cyan' }
      }
    });

    // Progress bar (row 2-3, col 0-12)
    this.widgets.progress = this.grid.set(2, 0, 2, 12, blessed.box, {
      label: ' PROGRESS ',
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: 'white' } }
    });

    // Live stats (row 4-6, col 0-6)
    this.widgets.stats = this.grid.set(4, 0, 3, 6, blessed.box, {
      label: ' LIVE STATS ',
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: 'green' } }
    });

    // Throughput sparkline (row 4-6, col 6-12)
    this.widgets.throughput = this.grid.set(4, 6, 3, 6, contrib.sparkline, {
      label: ' THROUGHPUT (req/sec) ',
      tags: true,
      style: { fg: 'cyan', border: { fg: 'cyan' } }
    });

    // Proxy status (row 7-8, col 0-4)
    this.widgets.proxies = this.grid.set(7, 0, 2, 4, contrib.donut, {
      label: ' PROXIES ',
      radius: 6,
      arcWidth: 2,
      remainColor: 'black',
      yPadding: 1,
    });

    // Results summary (row 7-8, col 4-8)
    this.widgets.results = this.grid.set(7, 4, 2, 4, blessed.box, {
      label: ' RESULTS ',
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: 'yellow' } }
    });

    // Controls (row 7-8, col 8-12)
    this.widgets.controls = this.grid.set(7, 8, 2, 4, blessed.box, {
      label: ' CONTROLS ',
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: 'magenta' } },
      content: '\n {bold}[P]{/} Pause  {bold}[R]{/} Resume\n {bold}[+/-]{/} Speed  {bold}[Q]{/} Quit'
    });

    // Activity log (row 9-12, col 0-12)
    this.widgets.activity = this.grid.set(9, 0, 3, 12, contrib.log, {
      label: ' RECENT ACTIVITY ',
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: 'white' } }
    });
  }

  getBanner() {
    return `{center}{cyan-fg}{bold}
██████╗  ██████╗ ██████╗ ██╗  ██╗███████╗██████╗ 
██╔══██╗██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝██╔══██╗
██║  ██║██║   ██║██████╔╝█████╔╝ █████╗  ██████╔╝
██║  ██║██║   ██║██╔══██╗██╔═██╗ ██╔══╝  ██╔══██╗
██████╔╝╚██████╔╝██║  ██║██║  ██╗███████╗██║  ██║
╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
                 v1.0.0 - Google Dork Parser{/}{/}{/center}`;
  }

  setupKeys() {
    this.screen.key(['escape', 'q', 'C-c'], () => {
      if (this.callbacks.onQuit) this.callbacks.onQuit();
      else this.exit();
    });

    this.screen.key(['p'], () => {
      if (this.state.phase === 'running' && this.callbacks.onPause) {
        this.callbacks.onPause();
      }
    });

    this.screen.key(['r'], () => {
      if (this.state.phase === 'paused' && this.callbacks.onResume) {
        this.callbacks.onResume();
      }
    });

    this.screen.key(['+', '='], () => {
      if (this.callbacks.onSpeedUp) this.callbacks.onSpeedUp();
    });

    this.screen.key(['-', '_'], () => {
      if (this.callbacks.onSpeedDown) this.callbacks.onSpeedDown();
    });
  }

  setCallbacks(callbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // ─────────────────────────────────────────────────────────────
  // Update methods
  // ─────────────────────────────────────────────────────────────

  updateProgress(current, total) {
    this.state.dorks.completed = current;
    this.state.dorks.total = total;
    
    const pct = total > 0 ? (current / total) * 100 : 0;
    const filled = Math.floor(pct / 2);
    const empty = 50 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    
    const elapsed = this.formatDuration(this.state.timing.elapsed);
    const eta = this.formatDuration(this.state.timing.eta);
    const etaTime = this.state.timing.eta > 0 
      ? new Date(Date.now() + this.state.timing.eta).toLocaleTimeString()
      : '--:--:--';

    this.widgets.progress.setContent(
      `\n  {green-fg}${bar}{/}  ${pct.toFixed(1)}%\n` +
      `  {bold}${this.formatNumber(current)}{/} / ${this.formatNumber(total)} dorks\n\n` +
      `  Elapsed: {yellow-fg}${elapsed}{/}    Remaining: {cyan-fg}~${eta}{/}    ETA: {white-fg}${etaTime}{/}`
    );
    this.render();
  }

  updateStats(stats) {
    this.state.stats = { ...this.state.stats, ...stats };
    
    const content = `
  Requests/min:  {cyan-fg}${this.formatNumber(stats.requestsPerMin || 0)}{/}
  Success rate:  {green-fg}${(stats.successRate || 0).toFixed(1)}%{/}
  Active proxies: {yellow-fg}${stats.activeProxies || 0}{/}
  
  URLs found:     {bold}${this.formatNumber(stats.urlsFound || 0)}{/}
  Unique domains: {bold}${this.formatNumber(stats.uniqueDomains || 0)}{/}`;
    
    this.widgets.stats.setContent(content);
    this.render();
  }

  updateThroughput(value) {
    this.state.throughput.push(value);
    if (this.state.throughput.length > 60) {
      this.state.throughput.shift();
    }
    this.widgets.throughput.setData(['req/s'], [this.state.throughput]);
    this.render();
  }

  updateProxies(alive, dead, quarantined) {
    this.state.proxies = { 
      total: alive + dead + quarantined,
      alive, dead, quarantined 
    };

    const data = [
      { label: `Alive: ${alive}`, percent: alive, color: 'green' },
      { label: `Dead: ${dead}`, percent: dead, color: 'red' },
      { label: `Quar: ${quarantined}`, percent: quarantined, color: 'yellow' },
    ].filter(d => d.percent > 0);

    if (data.length > 0) {
      // Convert to percentages for donut
      const total = alive + dead + quarantined;
      data.forEach(d => d.percent = String(Math.round((d.percent / total) * 100)));
      this.widgets.proxies.setData(data);
    }
    this.render();
  }

  updateResults(raw, filtered, domains) {
    this.state.urls = { raw, filtered, domains };
    
    this.widgets.results.setContent(
      `\n  Raw URLs:      {white-fg}${this.formatNumber(raw)}{/}\n` +
      `  Filtered:      {green-fg}${this.formatNumber(filtered)}{/}\n` +
      `  Domains:       {cyan-fg}${this.formatNumber(domains)}{/}`
    );
    this.render();
  }

  updateTiming(elapsed, eta) {
    this.state.timing.elapsed = elapsed;
    this.state.timing.eta = eta;
  }

  addActivity(type, dork, result) {
    const time = new Date().toLocaleTimeString();
    const icon = type === 'success' ? '{green-fg}✔{/}' 
               : type === 'warning' ? '{yellow-fg}⚠{/}'
               : type === 'error' ? '{red-fg}✖{/}'
               : '{white-fg}ℹ{/}';
    
    const dorkShort = dork.length > 35 ? dork.substring(0, 32) + '...' : dork;
    const line = `{gray-fg}${time}{/}  ${icon}  ${dorkShort.padEnd(35)}  ${result}`;
    
    this.widgets.activity.log(line);
    this.render();
  }

  // ─────────────────────────────────────────────────────────────
  // Phase screens
  // ─────────────────────────────────────────────────────────────

  showInitPhase() {
    this.state.phase = 'init';
    this.widgets.progress.setLabel(' INITIALIZATION ');
    this.widgets.progress.setContent('\n  Loading configuration...');
    this.render();
  }

  showProxyReport(total, alive, dead, slow) {
    const alivePct = ((alive / total) * 100).toFixed(1);
    const barFilled = Math.floor((alive / total) * 30);
    const bar = '{green-fg}' + '█'.repeat(barFilled) + '{/}' + '░'.repeat(30 - barFilled);

    this.widgets.progress.setLabel(' PROXY HEALTH REPORT ');
    this.widgets.progress.setContent(
      `\n  Total:      ${this.formatNumber(total)}\n` +
      `  {green-fg}✔ Alive:{/}    ${this.formatNumber(alive)}  (${alivePct}%)   ${bar}\n` +
      `  {red-fg}✖ Dead:{/}     ${this.formatNumber(dead)}  (${((dead/total)*100).toFixed(1)}%)\n` +
      `  {yellow-fg}⚠ Slow:{/}     ${this.formatNumber(slow)}  (${((slow/total)*100).toFixed(1)}%)\n\n` +
      `  Recommended workers: {cyan-fg}${Math.floor(alive / 10)}{/}\n` +
      `  {gray-fg}Press ENTER to start or CTRL+C to abort...{/}`
    );
    this.render();
  }

  showRunning() {
    this.state.phase = 'running';
    this.state.timing.started = Date.now();
    this.widgets.progress.setLabel(' PROGRESS ');
    this.widgets.controls.setContent('\n {bold}[P]{/} Pause  {bold}[R]{/} Resume\n {bold}[+/-]{/} Speed  {bold}[Q]{/} Quit');
    this.render();
  }

  showPaused() {
    this.state.phase = 'paused';
    this.widgets.controls.setContent('\n {yellow-fg}{bold}⏸ PAUSED{/}\n\n {bold}[R]{/} Resume  {bold}[Q]{/} Save & Quit');
    this.render();
  }

  showWarning(message) {
    const box = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 7,
      label: ' ⚠ WARNING ',
      content: `\n  ${message}`,
      tags: true,
      border: { type: 'line' },
      style: { 
        border: { fg: 'yellow' },
        bg: 'black'
      }
    });

    this.render();
    setTimeout(() => {
      box.destroy();
      this.render();
    }, 5000);
  }

  showCritical(message, options = ['Continue', 'Quit']) {
    return new Promise((resolve) => {
      const box = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: 65,
        height: 10,
        label: ' 🔴 CRITICAL ',
        content: `\n  ${message}\n\n  ${options.map((o, i) => `{bold}[${i + 1}]{/} ${o}`).join('    ')}`,
        tags: true,
        border: { type: 'line' },
        style: { 
          border: { fg: 'red' },
          bg: 'black'
        }
      });

      this.render();

      const handler = (ch, key) => {
        const num = parseInt(ch);
        if (num >= 1 && num <= options.length) {
          this.screen.removeListener('keypress', handler);
          box.destroy();
          this.render();
          resolve(options[num - 1]);
        }
      };

      this.screen.on('keypress', handler);
    });
  }

  showComplete(stats) {
    this.state.phase = 'complete';
    
    // Hide other widgets content
    this.widgets.throughput.setData([''], [[]]);
    
    const duration = this.formatDuration(stats.duration);
    
    this.widgets.progress.setLabel(' ✔ COMPLETE ');
    this.widgets.progress.setContent(
      `\n  {green-fg}All ${this.formatNumber(stats.totalDorks)} dorks processed{/}\n\n` +
      `  Duration:        {yellow-fg}${duration}{/}\n` +
      `  Total requests:  ${this.formatNumber(stats.totalRequests)}\n` +
      `  Success rate:    {green-fg}${stats.successRate.toFixed(1)}%{/}`
    );

    this.widgets.stats.setLabel(' RESULTS ');
    this.widgets.stats.setContent(
      `\n  Raw URLs:           {white-fg}${this.formatNumber(stats.rawUrls)}{/}\n` +
      `  After dedup:        {cyan-fg}${this.formatNumber(stats.afterDedup)}{/}\n` +
      `  After anti-public:  {green-fg}${this.formatNumber(stats.afterFilter)}{/}\n` +
      `  Final domains:      {bold}${this.formatNumber(stats.finalDomains)}{/}`
    );

    this.widgets.results.setLabel(' OUTPUT FILES ');
    this.widgets.results.setContent(
      `\n  {cyan-fg}${stats.outputDir}{/}\n` +
      `  └── results.txt`
    );

    this.widgets.controls.setContent('\n\n  {gray-fg}Press any key to exit...{/}');

    this.render();

    this.screen.once('keypress', () => {
      this.exit();
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────

  formatNumber(num) {
    return num.toLocaleString();
  }

  formatDuration(ms) {
    if (!ms || ms < 0) return '0s';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  render() {
    if (this.screen) {
      this.screen.render();
    }
  }

  exit() {
    if (this.screen) {
      this.screen.destroy();
    }
    process.exit(0);
  }
}

// ─────────────────────────────────────────────────────────────
// Simple console banner for non-TTY
// ─────────────────────────────────────────────────────────────

export function showBanner() {
  console.log('\x1b[36m');
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║     ██████╗  ██████╗ ██████╗ ██╗  ██╗███████╗██████╗              ║');
  console.log('║     ██╔══██╗██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝██╔══██╗             ║');
  console.log('║     ██║  ██║██║   ██║██████╔╝█████╔╝ █████╗  ██████╔╝             ║');
  console.log('║     ██║  ██║██║   ██║██╔══██╗██╔═██╗ ██╔══╝  ██╔══██╗             ║');
  console.log('║     ██████╔╝╚██████╔╝██║  ██║██║  ██╗███████╗██║  ██║             ║');
  console.log('║     ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝             ║');
  console.log('║                                                                   ║');
  console.log('║                  Google Dork Parser v1.0.0                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');
}
