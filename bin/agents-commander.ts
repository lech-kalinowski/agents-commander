#!/usr/bin/env node

import { Command } from 'commander';
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { App } from '../src/app.js';

// Read version from package.json so it stays in sync automatically
let version = '0.1.0';
try {
  const binDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(binDir, '..', 'package.json'),
    path.resolve(binDir, '..', '..', 'package.json'),
  ];
  for (const packagePath of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
      if (typeof pkg.version === 'string') {
        version = pkg.version;
        break;
      }
    } catch {
      // Try the next source/build layout.
    }
  }
} catch { /* fallback to hardcoded */ }

const program = new Command();

program
  .name('agents-commander')
  .description('Terminal UI for managing multiple AI agent CLIs')
  .version(version)
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
