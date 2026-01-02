import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { DEFAULT_STATS, DEFAULT_PROGRESS, DEFAULT_PROXY_INFO } from './types.js';
import { formatDuration, formatNumber } from './output.js';

export class TerminalUI {
  constructor() {
    this.state = {
      isRunning: false,
      isPaused: false,
      stats: { ...DEFAULT_STATS },
      progress: { ...DEFAULT_PROGRESS },
      proxyInfo: { ...DEFAULT_PROXY_INFO },
      recentActivity: [],
    };
    this.throughputHistory = [];
    this.MAX_HISTORY = 60;

    this.screen = blessed.screen({ smartCSR: true, title: 'Dorker' });
    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    this.progressBar = this.grid.set(0, 0, 2, 12, contrib.gauge, {
      label: ' Progress ',
      stroke: 'green',
      fill: 'white',
    });

    this.statsLcd = this.grid.set(2, 0, 2, 3, contrib.lcd, {
      label: ' Req/s ',
      elements: 5,
      display: '0',
      color: 'green',
    });

    this.sparkline = this.grid.set(2, 3, 2, 5, contrib.sparkline, {
      label: ' Throughput ',
      tags: true,
    });

    this.proxyDonut = this.grid.set(2, 8, 2, 4, contrib.donut, {
      label: ' Proxies ',
      radius: 8,
      arcWidth: 3,
    });

    this.statsTable = this.grid.set(4, 0, 3, 4, contrib.table, {
      label: ' Statistics ',
      columnWidth: [14, 10],
    });

    this.logBox = this.grid.set(4, 4, 4, 8, contrib.log, {
      label: ' Activity ',
      tags: true,
    });

    this.controlsBox = this.grid.set(7, 0, 1, 4, blessed.box, {
      label: ' Controls ',
      content: '[P] Pause  [Q] Quit',
    });

    this.setupKeys();
  }

  setupKeys() {
    this.screen.key(['escape', 'q', 'C-c'], () => {
      if (this.onQuit) this.onQuit();
      else process.exit(0);
    });
    this.screen.key(['p'], () => {
      if (this.state.isPaused) { if (this.onResume) this.onResume(); }
      else { if (this.onPause) this.onPause(); }
    });
  }

  setCallbacks(callbacks) {
    this.onPause = callbacks.onPause;
    this.onResume = callbacks.onResume;
    this.onQuit = callbacks.onQuit;
  }

  updateStats(stats) {
    this.state.stats = stats;
    this.statsLcd.setDisplay(String(Math.round(stats.requests_per_sec)).padStart(5));
    this.throughputHistory.push(stats.requests_per_sec);
    if (this.throughputHistory.length > this.MAX_HISTORY) this.throughputHistory.shift();
    this.sparkline.setData(['req/s'], [this.throughputHistory]);
    this.statsTable.setData({
      headers: ['Metric', 'Value'],
      data: [
        ['Dorks', formatNumber(stats.tasks_total)],
        ['Completed', formatNumber(stats.tasks_completed)],
        ['Failed', formatNumber(stats.tasks_failed)],
        ['URLs', formatNumber(stats.urls_found)],
        ['CAPTCHAs', formatNumber(stats.captcha_count)],
        ['Elapsed', formatDuration(stats.elapsed_ms)],
        ['ETA', formatDuration(stats.eta_ms)],
      ],
    });
    this.render();
  }

  updateProgress(progress) {
    this.state.progress = progress;
    const pct = Math.min(100, Math.max(0, progress.percentage));
    this.progressBar.setPercent(pct);
    this.progressBar.setLabel(` Progress: ${formatNumber(progress.current)}/${formatNumber(progress.total)} (${pct.toFixed(1)}%) `);
    this.render();
  }

  updateProxyInfo(info) {
    this.state.proxyInfo = info;
    const total = info.total || 1;
    this.proxyDonut.setData([
      { label: `Alive:${info.alive}`, percent: String(Math.round((info.alive / total) * 100)), color: 'green' },
      { label: `Dead:${info.dead}`, percent: String(Math.round((info.dead / total) * 100)), color: 'red' },
    ]);
    this.render();
  }

  addActivity(entry) {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    let color = 'white';
    if (entry.type === 'success') color = 'green';
    else if (entry.type === 'error') color = 'red';
    else if (entry.type === 'warning') color = 'yellow';
    const urls = entry.urls !== undefined ? ` → ${entry.urls} URLs` : '';
    this.logBox.log(`{${color}-fg}${time}{/} ${entry.message}${urls}`);
    this.render();
  }

  log(message, type = 'info') {
    this.addActivity({ timestamp: Date.now(), type, message });
  }

  setPaused(paused) {
    this.state.isPaused = paused;
    this.controlsBox.setContent(paused ? '{yellow-fg}PAUSED{/} [P] Resume [Q] Quit' : '[P] Pause [Q] Quit');
    this.render();
  }

  setRunning(running) { this.state.isRunning = running; }

  showComplete(stats, duration) {
    blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 50,
      height: 10,
      label: ' Complete ',
      content: `\n  Completed: ${stats.tasks_completed} dorks\n  URLs: ${formatNumber(stats.urls_found)}\n  Duration: ${formatDuration(duration)}\n\n  Press any key to exit...`,
      border: { type: 'line' },
      style: { border: { fg: 'green' } },
    });
    this.screen.once('keypress', () => process.exit(0));
    this.render();
  }

  render() { this.screen.render(); }
  destroy() { this.screen.destroy(); }
}

export function showBanner() {
  console.log('\x1b[36m');
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                         DORKER v1.0.0                             ║');
  console.log('║                   Google Dork Parser                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');
}
