#!/usr/bin/env node

/**
 * Google Dork Parser - Main Entry Point
 * High-performance dork parser with Go engine and TypeScript orchestration
 */

import { createProgram } from './cli/commands.js';
import { getLogger, resetLogger } from './utils/logger.js';
import { resetEngine } from './orchestrator/engine.js';
import { resetScheduler } from './orchestrator/scheduler.js';
import { resetTaskQueue } from './orchestrator/taskQueue.js';
import { resetFilterPipeline } from './filter/index.js';
import { resetStateManager } from './output/state.js';
import { resetBrowserFallback } from './browser/playwright.js';
import { resetDashboard } from './cli/dashboard.js';

const logger = getLogger();

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  console.error('Fatal error:', error.message);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
  console.error('Unhandled promise rejection:', reason);
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, cleaning up...');
  await cleanup();
  process.exit(0);
});

// Handle SIGTERM
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, cleaning up...');
  await cleanup();
  process.exit(0);
});

/**
 * Cleanup all resources
 */
async function cleanup(): Promise<void> {
  logger.info('Cleaning up resources...');

  try {
    // Stop scheduler first
    await resetScheduler();

    // Stop engine
    await resetEngine();

    // Reset other components
    resetTaskQueue();
    resetFilterPipeline();
    resetStateManager();
    await resetBrowserFallback();
    resetDashboard();
    resetLogger();
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const program = createProgram();
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error('Fatal error', { error });
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

// Run
main();

// Export for programmatic use
export * from './types/index.js';
export * from './orchestrator/engine.js';
export * from './orchestrator/scheduler.js';
export { TaskQueue, getTaskQueue, resetTaskQueue, TaskPriority } from './orchestrator/taskQueue.js';
export * from './filter/index.js';
export * from './output/state.js';
export * from './browser/playwright.js';
export * from './cli/commands.js';
export * from './cli/interactive.js';
export * from './cli/dashboard.js';
export * from './utils/logger.js';
export * from './utils/validator.js';
