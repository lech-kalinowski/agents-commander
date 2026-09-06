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
import { resolveCaptureLaunchOptions } from '../src/config/capture-launch-options.js';
import type { CaptureSink } from '../src/capture/types.js';

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
  capture?: string;
  captureProject?: string;
  captureDir?: string;
}

interface CliApp {
  run(): Promise<void>;
  dispose(): Promise<void>;
  refreshCaptureStatus(): void;
}

async function runDatasetCommand(action: () => Promise<unknown>): Promise<void> {
  try {
    process.stdout.write(`${JSON.stringify(await action(), null, 2)}\n`);
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error))
      .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').slice(0, 1500);
    process.stderr.write(`Dataset command failed: ${detail}\n`);
    process.exitCode = 1;
  }
}

// Dataset tools remain independent of the terminal UI and never launch agents.
const dataset = program.command('dataset').description('Inspect captures and create reviewed LoRA/SFT datasets offline');
dataset.command('inspect <capture-directory>')
  .description('Validate a capture and summarize candidate eligibility without exporting content')
  .action(async (directory: string) => runDatasetCommand(async () => {
    const { inspectCaptureDataset } = await import('../src/dataset/index.js');
    return inspectCaptureDataset(path.resolve(directory));
  }));
dataset.command('prepare <capture-directories...>')
  .description('Create candidate examples and unapproved review records in a new private directory')
  .requiredOption('-o, --out <directory>', 'New review directory (must not exist)')
  .action(async (directories: string[], options: { out: string }) => runDatasetCommand(async () => {
    const { prepareDataset } = await import('../src/dataset/index.js');
    return prepareDataset(directories.map((directory) => path.resolve(directory)), { out: path.resolve(options.out) });
  }));
dataset.command('export <review-directory>')
  .description('Export only explicitly approved candidates as conversational prompt/completion JSONL')
  .requiredOption('-o, --out <directory>', 'New dataset directory (must not exist)')
  .requiredOption('--seed <value>', 'Non-secret reproducibility seed; use the same seed across related exports')
  .action(async (directory: string, options: { out: string; seed: string }) => runDatasetCommand(async () => {
    const { exportDataset } = await import('../src/dataset/index.js');
    return exportDataset(path.resolve(directory), { out: path.resolve(options.out), seed: options.seed });
  }));
dataset.command('validate <dataset-directory>')
  .description('Verify exported schema, provenance, checksums, split isolation and protocol frames')
  .action(async (directory: string) => runDatasetCommand(async () => {
    const { validateDataset } = await import('../src/dataset/index.js');
    return validateDataset(path.resolve(directory));
  }));

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
  .option('--capture <mode>', 'Record this launch only: off (default), metadata, or protocol')
  .option('--capture-project <id>', 'Opaque project-family ID for leakage-safe dataset grouping')
  .option('--capture-dir <directory>', 'Private recording root outside the working project')
  .option('--codex-micro', 'Enable native Codex Micro controls for this launch')
  .option('--no-codex-micro', 'Disable Codex Micro controls for this launch')
  .option('--codex-micro-keyboard', 'Use unguarded legacy shortcuts; keep ChatGPT fully quit')
  .option('--codex-micro-decisions', 'Enable guarded approve/reject controls for this launch')
  .option('--no-codex-micro-decisions', 'Disable guarded approve/reject controls for this launch')
  .option('--codex-micro-test', 'Enable Codex Micro controls and open the input checklist')
  .action(async (directory: string, options: CliOptions, command: Command) => {
    const requestedWorkingDir = path.resolve(directory);
    let captureLaunch;
    try {
      captureLaunch = resolveCaptureLaunchOptions(options, requestedWorkingDir);
      if (options.doctor && captureLaunch.mode !== 'off') {
        throw new Error('--doctor does not record sessions; remove --capture to run diagnostics.');
      }
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
      return;
    }

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
    let capture: CaptureSink | null = null;
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
      if (captureLaunch.mode !== 'off') {
        const { createCaptureRecorder } = await import('../src/capture/index.js');
        capture = await createCaptureRecorder({
          ...captureLaunch,
          synthetic: options.demo === true,
          onStatus: () => app?.refreshCaptureStatus(),
        });
        process.stderr.write(`Recording ${captureLaunch.mode} locally: ${JSON.stringify(capture.snapshot().directory)}\n`);
        process.stderr.write('Redaction is best-effort. Review privacy, rights, context and quality before dataset export. No uploads.\n');
      }
      app = new App(workingDir, {
        capture: capture ?? undefined,
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
      capture?.markIncomplete('startup_failure');
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
      if (capture) await capture.close(false);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to start Agents Commander: ${message}`);
      process.exitCode = 1;
    }
  });

await program.parseAsync();
