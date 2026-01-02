/**
 * CLI Commands
 * Command handlers for all CLI operations
 */

import fs from 'fs';
import { Command } from 'commander';
import chalk from 'chalk';
import type { CliOptions, EngineConfig, Settings } from '../types/index.js';
import { getScheduler } from '../orchestrator/scheduler.js';
import { getFilterPipeline } from '../filter/index.js';
import { getStateManager } from '../output/state.js';
import { validateAll, validateProxyFile, validateDorkFile } from '../utils/validator.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

// Default settings
const DEFAULT_SETTINGS: Partial<Settings> = {
  engine: {
    type: 'google',
    workers: 100,
    pagesPerDork: 5,
    resultsPerPage: 10,
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 5000,
  },
  proxy: {
    rotateAfter: 1,
    rotationStrategy: 'round_robin',
    healthCheckOnStart: true,
    healthCheckInterval: 300000,
    quarantineDuration: 300000,
    maxFailCount: 5,
    protocols: ['http', 'https', 'socks4', 'socks5'],
  },
  stealth: {
    profile: 'normal',
    delayMin: 1000,
    delayMax: 3000,
    burstSize: 10,
    burstPause: 5000,
    sessionMaxRequests: 100,
    sessionCooldown: 60000,
    jitterPercent: 0.3,
    rotateUserAgent: true,
    rotateGoogleDomain: true,
  },
};

function loadSettings(configPath?: string): Settings {
  const settingsPath = configPath || './config/settings.json';
  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(content) as Settings;
    } catch {
      logger.warn('Failed to load settings, using defaults');
    }
  }
  return DEFAULT_SETTINGS as Settings;
}

function loadFileLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
}

function calculateEstimate(
  dorkCount: number,
  proxyCount: number,
  pagesPerDork: number,
  requestsPerProxyPerHour: number = 20
): { totalRequests: number; estimatedTime: string; requestsPerMin: number } {
  const totalRequests = dorkCount * pagesPerDork;
  const effectiveProxies = Math.max(1, Math.floor(proxyCount * 0.5));
  const requestsPerMin = (effectiveProxies * requestsPerProxyPerHour) / 60;
  const totalMinutes = totalRequests / requestsPerMin;

  let estimatedTime: string;
  if (totalMinutes < 60) {
    estimatedTime = `${Math.ceil(totalMinutes)} minutes`;
  } else {
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.ceil(totalMinutes % 60);
    estimatedTime = `${hours}h ${mins}m`;
  }

  return { totalRequests, estimatedTime, requestsPerMin: Math.round(requestsPerMin) };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export async function runCommand(options: CliOptions): Promise<void> {
  const ora = (await import('ora')).default;
  const boxen = (await import('boxen')).default;
  
  try {
    if (!options.quiet) {
      console.log(chalk.cyan('\n  DORKER - Google Dork Parser v1.0.0\n'));
    }

    const settings = loadSettings(options.config);

    const spinner = ora('Validating inputs...').start();
    const validation = validateAll({
      dorksFile: options.dorks,
      proxiesFile: options.proxies,
      outputDir: options.output,
    });

    if (!validation.valid) {
      spinner.fail('Validation failed');
      for (const error of validation.errors) {
        console.log(chalk.red(`  ✖ ${error}`));
      }
      process.exit(1);
    }

    for (const warning of validation.warnings) {
      console.log(chalk.yellow(`  ⚠ ${warning}`));
    }

    spinner.succeed('Inputs validated');

    const dorks = loadFileLines(options.dorks);
    const proxies = loadFileLines(options.proxies);

    const workers = options.threads || settings.engine?.workers || 100;
    const pagesPerDork = options.pages || settings.engine?.pagesPerDork || 5;

    console.log(boxen(
      [
        `${chalk.bold('Dorks:')}         ${chalk.yellow(dorks.length.toLocaleString())}`,
        `${chalk.bold('Proxies:')}       ${chalk.yellow(proxies.length.toLocaleString())}`,
        `${chalk.bold('Workers:')}       ${chalk.yellow(workers.toLocaleString())}`,
        `${chalk.bold('Pages/Dork:')}    ${chalk.yellow(pagesPerDork)}`,
        `${chalk.bold('Output:')}        ${chalk.gray(options.output || './output')}`,
      ].join('\n'),
      { title: '⚙️  Configuration', padding: 1, borderStyle: 'round', borderColor: 'cyan' }
    ));

    const estimate = calculateEstimate(dorks.length, proxies.length, pagesPerDork);
    console.log(boxen(
      [
        `${chalk.bold('Total Requests:')}    ${chalk.yellow(estimate.totalRequests.toLocaleString())}`,
        `${chalk.bold('Est. Time:')}         ${chalk.green(estimate.estimatedTime)}`,
        `${chalk.bold('Rate:')}              ${chalk.gray(`~${estimate.requestsPerMin} req/min`)}`,
      ].join('\n'),
      { title: '📊 Estimate', padding: 1, borderStyle: 'round', borderColor: 'yellow' }
    ));

    const stateManager = getStateManager();
    if (options.resume && stateManager.canResume()) {
      const resumeInfo = stateManager.getResumeInfo();
      if (resumeInfo) {
        console.log(chalk.blue(`ℹ  Resuming previous session: ${resumeInfo.completed} completed, ${resumeInfo.pending} pending`));
        stateManager.load();
      }
    }

    const filterPipeline = getFilterPipeline({
      ...settings.filter,
      removeDuplicates: true,
      antiPublic: true,
    });

    const engineConfig: EngineConfig = {
      engine: 'google',
      workers,
      pages_per_dork: pagesPerDork,
      timeout_ms: options.timeout || settings.engine?.timeout || 30000,
      delay_min_ms: settings.stealth?.delayMin || 1000,
      delay_max_ms: settings.stealth?.delayMax || 3000,
      retry_attempts: settings.engine?.retryAttempts || 3,
      proxy_rotate_after: settings.proxy?.rotateAfter || 1,
      user_agents: [],
      google_domains: [],
    };

    const scheduler = getScheduler({
      initialConcurrency: workers,
      pagesPerDork,
      maxRetries: settings.engine?.retryAttempts || 3,
    });

    scheduler.on('progress', (stats) => {
      const percent = ((stats.completedDorks / stats.totalDorks) * 100).toFixed(1);
      process.stdout.write(`\r  Progress: ${stats.completedDorks}/${stats.totalDorks} (${percent}%) | URLs: ${stats.totalUrls} | ETA: ${stats.eta}    `);
    });

    scheduler.on('result', (dork: string, urls: string[]) => {
      filterPipeline.filter(urls);
      stateManager.addCompletedDork(dork);
      stateManager.updateStats({
        totalUrls: filterPipeline.getStats().passed,
        uniqueUrls: filterPipeline.getStats().passed,
        uniqueDomains: filterPipeline.getStats().uniqueDomains,
      });
    });

    scheduler.on('error', (dork: string, error: string) => {
      if (options.verbose) {
        console.log(chalk.red(`\n  ✖ ${dork}: ${error}`));
      }
    });

    scheduler.on('blocked', (dork: string, reason: string) => {
      if (options.verbose) {
        console.log(chalk.yellow(`\n  ⚠ ${dork}: Blocked - ${reason}`));
      }
    });

    scheduler.on('complete', async (stats) => {
      console.log('\n');
      console.log(boxen(
        [
          chalk.bold.green('✓ Scraping Complete!'),
          '',
          `${chalk.bold('Total Dorks:')}      ${stats.totalDorks.toLocaleString()}`,
          `${chalk.bold('Completed:')}        ${chalk.green(stats.completedDorks.toLocaleString())}`,
          `${chalk.bold('Failed:')}           ${chalk.red(stats.failedDorks.toLocaleString())}`,
          '',
          `${chalk.bold('URLs Found:')}       ${chalk.cyan(stats.totalUrls.toLocaleString())}`,
          `${chalk.bold('Unique URLs:')}      ${chalk.cyan(stats.uniqueUrls.toLocaleString())}`,
          '',
          `${chalk.bold('Duration:')}         ${formatDuration(stats.elapsed)}`,
          `${chalk.bold('Success Rate:')}     ${stats.successRate.toFixed(1)}%`,
        ].join('\n'),
        { padding: 1, margin: 1, borderStyle: 'double', borderColor: 'green' }
      ));
      stateManager.clear();
    });

    stateManager.setPendingDorks(dorks);
    stateManager.setConfig({ pagesPerDork, workers, engine: 'google' });
    stateManager.startAutoSave();

    console.log(chalk.cyan('\n  Starting scan...\n'));

    await scheduler.start(dorks, engineConfig);

    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\n  Received SIGINT, shutting down gracefully...'));
      await scheduler.stop();
      stateManager.save();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log(chalk.yellow('\n\n  Received SIGTERM, shutting down gracefully...'));
      await scheduler.stop();
      stateManager.save();
      process.exit(0);
    });

  } catch (error) {
    console.log(chalk.red(`\n  ✖ Error: ${(error as Error).message}`));
    logger.error('Run command failed', { error });
    process.exit(1);
  }
}

export async function validateCommand(options: { dorks?: string; proxies?: string }): Promise<void> {
  const ora = (await import('ora')).default;
  console.log(chalk.cyan('\n  DORKER - Validate Files\n'));

  try {
    if (options.dorks) {
      const spinner = ora('Validating dorks...').start();
      const dorkResult = validateDorkFile(options.dorks);
      spinner.succeed(`Dorks: ${dorkResult.valid.length} valid, ${dorkResult.invalid.length} invalid`);

      if (dorkResult.invalid.length > 0) {
        console.log(chalk.yellow('\nInvalid dorks:'));
        for (const inv of dorkResult.invalid.slice(0, 10)) {
          console.log(chalk.red(`  Line ${inv.line}: ${inv.error}`));
        }
        if (dorkResult.invalid.length > 10) {
          console.log(chalk.gray(`  ... and ${dorkResult.invalid.length - 10} more`));
        }
      }
    }

    if (options.proxies) {
      const spinner = ora('Validating proxies...').start();
      const proxyResult = validateProxyFile(options.proxies);
      spinner.succeed(`Proxies: ${proxyResult.valid.length} valid, ${proxyResult.invalid.length} invalid`);

      if (proxyResult.invalid.length > 0) {
        console.log(chalk.yellow('\nInvalid proxies:'));
        for (const inv of proxyResult.invalid.slice(0, 10)) {
          console.log(chalk.red(`  Line ${inv.line}: ${inv.error}`));
        }
        if (proxyResult.invalid.length > 10) {
          console.log(chalk.gray(`  ... and ${proxyResult.invalid.length - 10} more`));
        }
      }
    }
  } catch (error) {
    console.log(chalk.red(`\n  ✖ Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

export async function checkProxiesCommand(options: { proxies: string; timeout?: number; workers?: number }): Promise<void> {
  const ora = (await import('ora')).default;
  console.log(chalk.cyan('\n  DORKER - Check Proxies\n'));

  try {
    const proxies = loadFileLines(options.proxies);
    console.log(chalk.blue(`ℹ  Loaded ${proxies.length} proxies`));

    const spinner = ora('Checking proxies...').start();
    const validation = validateProxyFile(options.proxies);
    spinner.succeed('Proxy check complete');

    console.log('');
    console.log(chalk.bold('Results:'));
    console.log(`  ${chalk.green('Valid:')}   ${validation.valid.length}`);
    console.log(`  ${chalk.red('Invalid:')} ${validation.invalid.length}`);

    if (validation.valid.length > 0) {
      const outputPath = options.proxies.replace('.txt', '_working.txt');
      fs.writeFileSync(outputPath, validation.valid.join('\n'));
      console.log(chalk.green(`\n✓ Working proxies saved to: ${outputPath}`));
    }
  } catch (error) {
    console.log(chalk.red(`\n  ✖ Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

export async function estimateCommand(options: { dorks: string; proxies: string; pages?: number }): Promise<void> {
  const boxen = (await import('boxen')).default;
  console.log(chalk.cyan('\n  DORKER - Time Estimate\n'));

  try {
    const dorks = loadFileLines(options.dorks);
    const proxies = loadFileLines(options.proxies);
    const pagesPerDork = options.pages || 5;

    console.log(boxen(
      [
        `${chalk.bold('Dorks:')}         ${chalk.yellow(dorks.length.toLocaleString())}`,
        `${chalk.bold('Proxies:')}       ${chalk.yellow(proxies.length.toLocaleString())}`,
        `${chalk.bold('Pages/Dork:')}    ${chalk.yellow(pagesPerDork)}`,
      ].join('\n'),
      { title: '⚙️  Configuration', padding: 1, borderStyle: 'round', borderColor: 'cyan' }
    ));

    console.log('');
    console.log(chalk.bold('Estimated completion times:'));
    console.log('');

    const scenarios = [
      { name: 'Aggressive', reqPerHour: 30 },
      { name: 'Normal', reqPerHour: 20 },
      { name: 'Cautious', reqPerHour: 10 },
      { name: 'Stealth', reqPerHour: 5 },
    ];

    for (const scenario of scenarios) {
      const estimate = calculateEstimate(dorks.length, proxies.length, pagesPerDork, scenario.reqPerHour);
      console.log(`  ${chalk.cyan(scenario.name.padEnd(12))} ${chalk.yellow(estimate.estimatedTime.padEnd(12))} (${estimate.requestsPerMin} req/min)`);
    }

    console.log('');
    console.log(chalk.gray('Note: Estimates assume 50% proxy success rate'));
  } catch (error) {
    console.log(chalk.red(`\n  ✖ Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

export async function resumeCommand(options: CliOptions): Promise<void> {
  console.log(chalk.cyan('\n  DORKER - Resume Session\n'));

  const stateManager = getStateManager();

  if (!stateManager.canResume()) {
    console.log(chalk.red('✖ No previous session found to resume'));
    process.exit(1);
  }

  const resumeInfo = stateManager.getResumeInfo();
  if (resumeInfo) {
    console.log(chalk.bold('Previous Session:'));
    console.log(`  ${chalk.bold('Session ID:')}   ${resumeInfo.sessionId}`);
    console.log(`  ${chalk.bold('Last Update:')}  ${resumeInfo.lastUpdate}`);
    console.log(`  ${chalk.bold('Completed:')}    ${chalk.green(resumeInfo.completed.toLocaleString())}`);
    console.log(`  ${chalk.bold('Pending:')}      ${chalk.yellow(resumeInfo.pending.toLocaleString())}`);
    console.log(`  ${chalk.bold('Failed:')}       ${chalk.red(resumeInfo.failed.toLocaleString())}`);
    console.log(`  ${chalk.bold('URLs Found:')}   ${chalk.cyan(resumeInfo.urls.toLocaleString())}`);
    console.log('');

    options.resume = true;
    await runCommand(options);
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('dorker')
    .description('High-performance Google dork parser')
    .version('1.0.0');

  program
    .command('interactive', { isDefault: true })
    .alias('i')
    .description('Start interactive mode with menus')
    .action(async () => {
      const { startInteractive } = await import('./interactive.js');
      await startInteractive();
    });

  program
    .command('run')
    .description('Run the dork parser')
    .requiredOption('-d, --dorks <file>', 'Path to dorks file')
    .requiredOption('-p, --proxies <file>', 'Path to proxies file')
    .option('-o, --output <dir>', 'Output directory', './output')
    .option('-t, --threads <number>', 'Number of workers', parseInt)
    .option('--pages <number>', 'Pages per dork', parseInt)
    .option('--timeout <ms>', 'Request timeout in ms', parseInt)
    .option('--delay <range>', 'Delay range (e.g., 1000-3000)')
    .option('-f, --format <formats>', 'Output formats (comma-separated)', 'txt,json')
    .option('-r, --resume', 'Resume previous session')
    .option('-c, --config <file>', 'Path to config file')
    .option('-v, --verbose', 'Verbose output')
    .option('-q, --quiet', 'Minimal output')
    .action(runCommand);

  program
    .command('validate')
    .description('Validate dorks and proxies files')
    .option('-d, --dorks <file>', 'Path to dorks file')
    .option('-p, --proxies <file>', 'Path to proxies file')
    .action(validateCommand);

  program
    .command('check-proxies')
    .description('Check proxy health')
    .requiredOption('-p, --proxies <file>', 'Path to proxies file')
    .option('--timeout <ms>', 'Timeout per proxy', parseInt)
    .option('--workers <number>', 'Concurrent checks', parseInt)
    .action(checkProxiesCommand);

  program
    .command('estimate')
    .description('Estimate completion time')
    .requiredOption('-d, --dorks <file>', 'Path to dorks file')
    .requiredOption('-p, --proxies <file>', 'Path to proxies file')
    .option('--pages <number>', 'Pages per dork', parseInt)
    .action(estimateCommand);

  program
    .command('resume')
    .description('Resume previous session')
    .option('-d, --dorks <file>', 'Path to dorks file (optional)')
    .option('-p, --proxies <file>', 'Path to proxies file (optional)')
    .option('-o, --output <dir>', 'Output directory')
    .action(resumeCommand);

  return program;
}

export default createProgram;
