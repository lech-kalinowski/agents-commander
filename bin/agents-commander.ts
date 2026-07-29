#!/usr/bin/env node

import { Command } from 'commander';
import path from 'node:path';
import { statSync } from 'node:fs';
import { App } from '../src/app.js';
import { getPackageVersion } from '../src/utils/package-info.js';

const program = new Command();

program
  .name('agents-commander')
  .description('Terminal UI for managing multiple AI agent CLIs')
  .version(getPackageVersion())
  .argument('[directory]', 'Working directory', process.cwd())
  .option('-t, --theme <name>', 'Color theme (classic-blue, midnight)')
  .option('-p, --panels <count>', 'Number of panels (2, 3, or 4)')
  .option('--show-hidden', 'Show hidden files by default')
  .action(async (directory: string, options: { theme?: string; panels?: string; showHidden?: boolean }) => {
    const workingDir = path.resolve(directory);

    try {
      if (options.panels !== undefined && !/^[234]$/.test(options.panels)) {
        throw new Error(`Invalid panel count "${options.panels}". Expected 2, 3, or 4.`);
      }
      if (!statSync(workingDir).isDirectory()) {
        throw new Error(`Not a directory: ${workingDir}`);
      }
      const app = new App(workingDir, {
        theme: options.theme,
        panels: options.panels === undefined ? undefined : parseInt(options.panels, 10),
        showHidden: options.showHidden,
      });
      await app.run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to start Agents Commander: ${message}`);
      process.exit(1);
    }
  });

program.parse();
