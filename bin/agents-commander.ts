#!/usr/bin/env node

import { Command } from 'commander';
import path from 'node:path';
import { statSync } from 'node:fs';
import {
  doctorExitCode,
  formatDoctorReport,
  runDoctor,
} from '../src/doctor/doctor.js';
import type { DemoWorkspace } from '../src/demo/demo-workspace.js';
import { getPackageVersion } from '../src/utils/package-info.js';
import {
  parseActivePanelCount,
  parsePanelDensity,
} from '../src/panel-limits.js';

const program = new Command();

interface CliOptions {
  theme?: string;
  panels?: string;
  density?: string;
  showHidden?: boolean;
  doctor?: boolean;
  conference?: boolean;
  demo?: boolean;
  codexMicro?: boolean;
  codexMicroKeyboard?: boolean;
  codexMicroDecisions?: boolean;
  codexMicroTest?: boolean;
}

interface CliApp {
  run(): Promise<void>;
  dispose(): Promise<void>;
}

program
  .name('agents-commander')
  .description('Terminal UI for managing multiple AI agent CLIs')
  .version(getPackageVersion())
  .argument('[directory]', 'Working directory', process.cwd())
  .option('-t, --theme <name>', 'Color theme (classic-blue, midnight)')
  .option('-p, --panels <count>', 'Initial workspace panel count (1-100)')
  .option('--density <preset>', 'View density (auto, 2, 3, or 4)')
  .option('--show-hidden', 'Show hidden files by default')
  .option('--doctor', 'Run startup diagnostics and exit')
  .option('--conference', 'Use presentation-safe Conference Mode defaults')
  .option('--demo', 'Launch the deterministic offline conference demo')
  .option('--codex-micro', 'Enable native Codex Micro controls for this launch')
  .option('--no-codex-micro', 'Disable Codex Micro controls for this launch')
  .option('--codex-micro-keyboard', 'Use legacy programmed keyboard shortcuts instead of native input')
  .option('--codex-micro-decisions', 'Enable guarded approve/reject controls for this launch')
  .option('--no-codex-micro-decisions', 'Disable guarded approve/reject controls for this launch')
  .option('--codex-micro-test', 'Enable Codex Micro controls and open the input checklist')
  .action(async (directory: string, options: CliOptions, command: Command) => {
    const requestedWorkingDir = path.resolve(directory);

    if (options.doctor) {
      try {
        const { loadConfig } = await import('../src/config/loader.js');
        const config = loadConfig();
        if (command.getOptionValueSource('codexMicro') === 'cli') {
          config.hardware.codexMicro.enabled = options.codexMicro === true;
          if (options.codexMicro) config.hardware.codexMicro.inputMode = 'native';
        }
        if (options.codexMicroTest) {
          config.hardware.codexMicro.enabled = true;
          if (!options.codexMicroKeyboard) config.hardware.codexMicro.inputMode = 'native';
        }
        if (options.codexMicroKeyboard && options.codexMicro !== false) {
          config.hardware.codexMicro.enabled = true;
          config.hardware.codexMicro.inputMode = 'keyboard';
        }
        if (command.getOptionValueSource('codexMicroDecisions') === 'cli') {
          config.hardware.codexMicro.decisionControls = options.codexMicroDecisions === true;
        }
        const report = await runDoctor({ workingDirectory: requestedWorkingDir, config });
        process.stdout.write(`${formatDoctorReport(report)}\n`);
        process.exitCode = doctorExitCode(report);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Agents Commander Doctor failed: ${message}\n`);
        process.exitCode = 1;
      }
      return;
    }

    let demoWorkspace: DemoWorkspace | null = null;
    let app: CliApp | null = null;
    try {
      const panels = options.panels === undefined
        ? undefined
        : parseActivePanelCount(options.panels);
      if (panels === null) {
        throw new Error(`Invalid panel count "${options.panels}". Expected an integer from 1 to 100.`);
      }
      const density = options.density === undefined
        ? undefined
        : parsePanelDensity(options.density);
      if (density === null) {
        throw new Error(`Invalid density "${options.density}". Expected auto, 2, 3, or 4.`);
      }
      const showHidden = command.getOptionValueSource('showHidden') === 'cli'
        ? options.showHidden
        : undefined;
      const codexMicro = command.getOptionValueSource('codexMicro') === 'cli'
        ? options.codexMicro
        : undefined;

      let workingDir = requestedWorkingDir;
      if (options.demo) {
        const { createDemoWorkspace } = await import('../src/demo/demo-workspace.js');
        demoWorkspace = await createDemoWorkspace();
        workingDir = demoWorkspace.path;
      } else if (!statSync(workingDir).isDirectory()) {
        throw new Error(`Not a directory: ${workingDir}`);
      }

      const { App } = await import('../src/app.js');
      app = new App(workingDir, {
        theme: options.theme,
        panels,
        density,
        showHidden,
        conference: options.conference,
        demo: options.demo,
        codexMicro,
        codexMicroKeyboard: codexMicro === false ? false : options.codexMicroKeyboard,
        codexMicroDecisions: command.getOptionValueSource('codexMicroDecisions') === 'cli'
          ? options.codexMicroDecisions
          : undefined,
        codexMicroTest: options.codexMicroTest,
        onShutdown: demoWorkspace?.cleanup,
        onSignalOwnership: demoWorkspace
          ? () => {
            demoWorkspace?.transferSignalOwnership();
            demoWorkspace = null;
          }
          : undefined,
      });
      await app.run();
    } catch (err) {
      if (app) {
        try {
          await app.dispose();
        } catch (rollbackError) {
          const detail = rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError);
          console.error(`Failed to roll back Agents Commander startup: ${detail}`);
        }
      }
      if (demoWorkspace) {
        try {
          await demoWorkspace.cleanup();
        } catch (cleanupError) {
          const detail = cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
          console.error(`Failed to clean the offline demo workspace: ${detail}`);
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to start Agents Commander: ${message}`);
      process.exitCode = 1;
    }
  });

await program.parseAsync();
