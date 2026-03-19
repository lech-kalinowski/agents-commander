#!/usr/bin/env node

import { Command } from 'commander';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { App } from '../src/app.js';

// Read version from package.json so it stays in sync automatically
let version = '0.1.0';
try {
  const pkgDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
  version = pkg.version ?? version;
} catch { /* fallback to hardcoded */ }

const program = new Command();

program
  .name('agents-commander')
  .description('Terminal UI for managing multiple AI agent CLIs')
  .version(version)
  .argument('[directory]', 'Working directory', process.cwd())
  .option('-t, --theme <name>', 'Color theme (classic-blue, midnight)', 'classic-blue')
  .option('-p, --panels <count>', 'Number of panels (2, 3, or 4)', '2')
  .option('--show-hidden', 'Show hidden files by default')
  .action(async (directory: string, options: { theme: string; panels: string; showHidden: boolean }) => {
    const workingDir = path.resolve(directory);

    try {
      const app = new App(workingDir, {
        theme: options.theme,
        panels: parseInt(options.panels, 10),
        showHidden: options.showHidden,
      });
      await app.run();
    } catch (err) {
      console.error('Failed to start Agents Commander:', err);
      process.exit(1);
    }
  });

program.parse();
