import blessed from 'blessed';
import contrib from 'blessed-contrib';
import type {
  StatsData,
  ProgressData,
  ProxyInfo,
  ActivityEntry,
  UIState,
  DEFAULT_STATS,
  DEFAULT_PROGRESS,
  DEFAULT_PROXY_INFO,
} from './types.js';
import { formatDuration, formatNumber } from './output.js';

export class TerminalUI {
  private screen: blessed.Widgets.Screen;
  private grid: contrib.grid;
  
  // Widgets
  private progressBar: contrib.Widgets.GaugeElement;
  private statsLcd: contrib.Widgets.LcdElement;
  private sparkline: contrib.Widgets.SparklineElement;
  private logBox: contrib.Widgets.LogElement;
  private proxyDonut: contrib.Widgets.DonutElement;
  private statsTable: contrib.Widgets.TableElement;
  private controlsBox: blessed.Widgets.BoxElement;

  // State
  private state: UIState;
  private throughputHistory: number[] = [];
  private readonly MAX_HISTORY = 60;

  // Callbacks
  private onPause?: () => void;
  private onResume?: () => void;
  private onQuit?: () => void;
  private onSpeedUp?: () => void;
  private onSpeedDown?: () => void;

  constructor() {
    this.state = {
      isRunning: false,
      isPaused: false,
      stats: { ...DEFAULT_STATS } as StatsData,
      progress: { ...DEFAULT_PROGRESS } as ProgressData,
      proxyInfo: { ...DEFAULT_PROXY_INFO } as ProxyInfo,
      recentActivity: [],
      throughputHistory: [],
    };

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Dorker - Google Dork Parser',
      cursor: {
        artificial: true,
        shape: 'line',
        blink: true,
        color: null,
      },
    });

    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen,
    });

    this.progressBar = this.createProgressBar();
    this.statsLcd = this.createStatsLcd();
    this.sparkline = this.createSparkline();
    this.logBox = this.createLogBox();
    this.proxyDonut = this.createProxyDonut();
    this.statsTable = this.createStatsTable();
    this.controlsBox = this.createControlsBox();

    this.setupKeyBindings();
  }

  private createProgressBar(): contrib.Widgets.GaugeElement {
    return this.grid.set(0, 0, 2, 12, contrib.gauge, {
      label: ' Progress ',
      stroke: 'green',
      fill: 'white',
      border: { type: 'line', fg: 'cyan' },
    }) as contrib.Widgets.GaugeElement;
  }

  private createStatsLcd(): contrib.Widgets.LcdElement {
    return this.grid.set(2, 0, 2, 3, contrib.lcd, {
      label: ' Requests/sec ',
      segmentWidth: 0.06,
      segmentInterval: 0.11,
      strokeWidth: 0.1,
      elements: 5,
      display: '0',
      elementSpacing: 4,
      elementPadding: 2,
      color: 'green',
      border: { type: 'line', fg: 'cyan' },
    }) as contrib.Widgets.LcdElement;
  }

  private createSparkline(): contrib.Widgets.SparklineElement {
    return this.grid.set(2, 3, 2, 5, contrib.sparkline, {
      label: ' Throughput (last 60s) ',
      tags: true,
      style: { fg: 'blue', titleFg: 'white' },
      border: { type: 'line', fg: 'cyan' },
    }) as contrib.Widgets.SparklineElement;
  }

  private createProxyDonut(): contrib.Widgets.DonutElement {
    return this.grid.set(2, 8, 2, 4, contrib.donut, {
      label: ' Proxies ',
      radius: 8,
      arcWidth: 3,
      remainColor: 'black',
      yPadding: 2,
      border: { type: 'line', fg: 'cyan' },
    }) as contrib.Widgets.DonutElement;
  }

  private createStatsTable(): contrib.Widgets.TableElement {
    return this.grid.set(4, 0, 3, 4, contrib.table, {
      label: ' Statistics ',
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      interactive: false,
      columnSpacing: 2,
      columnWidth: [16, 12],
      border: { type: 'line', fg: 'cyan' },
    }) as contrib.Widgets.TableElement;
  }

  private createLogBox(): contrib.Widgets.LogElement {
    return this.grid.set(4, 4, 4, 8, contrib.log, {
      label: ' Activity ',
      fg: 'green',
      selectedFg: 'green',
      tags: true,
      border: { type: 'line', fg: 'cyan' },
      scrollbar: {
        fg: 'blue',
        ch: ' ',
      },
    }) as contrib.Widgets.LogElement;
  }

  private createControlsBox(): blessed.Widgets.BoxElement {
    return this.grid.set(7, 0, 1, 4, blessed.box, {
      label: ' Controls ',
      content: '{cyan-fg}[P]{/} Pause  {cyan-fg}[Q]{/} Quit  {cyan-fg}[+/-]{/} Speed',
      tags: true,
      border: { type: 'line', fg: 'cyan' },
      style: {
        fg: 'white',
      },
    }) as blessed.Widgets.BoxElement;
  }

  private setupKeyBindings(): void {
    // Quit
    this.screen.key(['escape', 'q', 'C-c'], () => {
      if (this.onQuit) {
        this.onQuit();
      } else {
        this.destroy();
        process.exit(0);
      }
    });

    // Pause/Resume
    this.screen.key(['p'], () => {
      if (this.state.isPaused) {
        if (this.onResume) this.onResume();
      } else {
        if (this.onPause) this.onPause();
      }
    });

    // Speed controls
    this.screen.key(['+', '='], () => {
      if (this.onSpeedUp) this.onSpeedUp();
    });

    this.screen.key(['-', '_'], () => {
      if (this.onSpeedDown) this.onSpeedDown();
    });

    // Help
    this.screen.key(['h', '?'], () => {
      this.showHelp();
    });
  }

  private showHelp(): void {
    const helpBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 50,
      height: 15,
      label: ' Help ',
      content: `
  Keyboard Shortcuts:
  
  {cyan-fg}P{/}        - Pause/Resume
  {cyan-fg}Q / Esc{/}  - Quit (saves progress)
  {cyan-fg}+ / -{/}    - Adjust speed
  {cyan-fg}H / ?{/}    - Show this help
  
  Press any key to close...
      `,
      tags: true,
      border: { type: 'line', fg: 'yellow' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'yellow' },
      },
    });

    this.screen.once('keypress', () => {
      helpBox.destroy();
      this.screen.render();
    });

    this.screen.render();
  }

  // Public methods

  setCallbacks(callbacks: {
    onPause?: () => void;
    onResume?: () => void;
    onQuit?: () => void;
    onSpeedUp?: () => void;
    onSpeedDown?: () => void;
  }): void {
    this.onPause = callbacks.onPause;
    this.onResume = callbacks.onResume;
    this.onQuit = callbacks.onQuit;
    this.onSpeedUp = callbacks.onSpeedUp;
    this.onSpeedDown = callbacks.onSpeedDown;
  }

  updateStats(stats: StatsData): void {
    this.state.stats = stats;

    // Update LCD
    const rps = Math.round(stats.requests_per_sec);
    this.statsLcd.setDisplay(rps.toString().padStart(5, ' '));

    // Update sparkline
    this.throughputHistory.push(stats.requests_per_sec);
    if (this.throughputHistory.length > this.MAX_HISTORY) {
      this.throughputHistory.shift();
    }
    this.sparkline.setData(['req/s'], [this.throughputHistory]);

    // Update stats table
    const tableData = [
      ['Dorks Total', formatNumber(stats.tasks_total)],
      ['Completed', formatNumber(stats.tasks_completed)],
      ['Failed', formatNumber(stats.tasks_failed)],
      ['URLs Found', formatNumber(stats.urls_found)],
      ['CAPTCHAs', formatNumber(stats.captcha_count)],
      ['Blocks', formatNumber(stats.block_count)],
      ['Elapsed', formatDuration(stats.elapsed_ms)],
      ['ETA', formatDuration(stats.eta_ms)],
    ];
    this.statsTable.setData({
      headers: ['Metric', 'Value'],
      data: tableData,
    });

    this.render();
  }

  updateProgress(progress: ProgressData): void {
    this.state.progress = progress;

    // Update progress bar
    const percent = Math.min(100, Math.max(0, progress.percentage));
    this.progressBar.setPercent(percent);
    
    // Update label with details
    const label = ` Progress: ${formatNumber(progress.current)} / ${formatNumber(progress.total)} (${percent.toFixed(1)}%) `;
    this.progressBar.setLabel(label);

    this.render();
  }

  updateProxyInfo(info: ProxyInfo): void {
    this.state.proxyInfo = info;

    const data = [
      { label: `Alive: ${info.alive}`, percent: info.total > 0 ? (info.alive / info.total) * 100 : 0, color: 'green' },
      { label: `Dead: ${info.dead}`, percent: info.total > 0 ? (info.dead / info.total) * 100 : 0, color: 'red' },
      { label: `Quarantine: ${info.quarantined}`, percent: info.total > 0 ? (info.quarantined / info.total) * 100 : 0, color: 'yellow' },
    ];

    this.proxyDonut.setData(data);
    this.render();
  }

  addActivity(entry: ActivityEntry): void {
    this.state.recentActivity.unshift(entry);
    if (this.state.recentActivity.length > 100) {
      this.state.recentActivity.pop();
    }

    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    let color = 'white';
    let symbol = '•';

    switch (entry.type) {
      case 'success':
        color = 'green';
        symbol = '✓';
        break;
      case 'error':
        color = 'red';
        symbol = '✗';
        break;
      case 'warning':
        color = 'yellow';
        symbol = '⚠';
        break;
      case 'info':
        color = 'cyan';
        symbol = 'ℹ';
        break;
    }

    const urlInfo = entry.urls !== undefined ? ` → ${entry.urls} URLs` : '';
    const message = `{${color}-fg}${symbol}{/} ${timestamp}  ${entry.message}${urlInfo}`;

    this.logBox.log(message);
    this.render();
  }

  log(message: string, type: ActivityEntry['type'] = 'info'): void {
    this.addActivity({
      timestamp: Date.now(),
      type,
      dork: '',
      message,
    });
  }

  setPaused(paused: boolean): void {
    this.state.isPaused = paused;
    
    if (paused) {
      this.controlsBox.setContent('{yellow-fg}PAUSED{/} - {cyan-fg}[P]{/} Resume  {cyan-fg}[Q]{/} Quit');
    } else {
      this.controlsBox.setContent('{cyan-fg}[P]{/} Pause  {cyan-fg}[Q]{/} Quit  {cyan-fg}[+/-]{/} Speed');
    }
    
    this.render();
  }

  setRunning(running: boolean): void {
    this.state.isRunning = running;
  }

  showWarning(message: string): void {
    const warningBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: 'center',
      width: 60,
      height: 5,
      label: ' ⚠ WARNING ',
      content: `\n  ${message}`,
      tags: true,
      border: { type: 'line', fg: 'yellow' },
      style: {
        fg: 'yellow',
        bg: 'black',
        border: { fg: 'yellow' },
      },
    });

    setTimeout(() => {
      warningBox.destroy();
      this.screen.render();
    }, 5000);

    this.screen.render();
  }

  showError(message: string): void {
    const errorBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 7,
      label: ' 🔴 ERROR ',
      content: `\n  ${message}\n\n  Press any key to continue...`,
      tags: true,
      border: { type: 'line', fg: 'red' },
      style: {
        fg: 'red',
        bg: 'black',
        border: { fg: 'red' },
      },
    });

    this.screen.once('keypress', () => {
      errorBox.destroy();
      this.screen.render();
    });

    this.screen.render();
  }

  showComplete(stats: StatsData, duration: number): void {
    const completeBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 18,
      label: ' ✓ COMPLETE ',
      content: `
  {green-fg}All dorks processed successfully!{/}

  {bold}Results:{/}
    Total Dorks:     ${formatNumber(stats.tasks_total)}
    Completed:       ${formatNumber(stats.tasks_completed)}
    Failed:          ${formatNumber(stats.tasks_failed)}
    URLs Found:      ${formatNumber(stats.urls_found)}

  {bold}Performance:{/}
    Duration:        ${formatDuration(duration)}
    Avg Speed:       ${stats.requests_per_sec.toFixed(1)} req/s
    CAPTCHAs:        ${formatNumber(stats.captcha_count)}
    Blocks:          ${formatNumber(stats.block_count)}

  Press any key to exit...
      `,
      tags: true,
      border: { type: 'line', fg: 'green' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'green' },
      },
    });

    this.screen.once('keypress', () => {
      this.destroy();
      process.exit(0);
    });

    this.screen.render();
  }

  render(): void {
    this.screen.render();
  }

  destroy(): void {
    this.screen.destroy();
  }

  getScreen(): blessed.Widgets.Screen {
    return this.screen;
  }
}

// Create and show startup banner
export function showBanner(): void {
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
  console.log('║                                                                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');
}
