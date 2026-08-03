import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../src/config/defaults.js';
import {
  doctorExitCode,
  formatDoctorReport,
  runDoctor,
} from '../../src/doctor/doctor.js';
import type { ProcessProbeResult } from '../../src/doctor/process-probe.js';
import type { DoctorReport } from '../../src/doctor/types.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-commander-doctor-'));
  temporaryDirectories.push(directory);
  return directory;
}

function successfulProbe(stdout: string): ProcessProbeResult {
  return {
    ok: true,
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false,
    truncated: false,
  };
}

function createInstalledLayout(root: string): {
  moduleUrl: string;
  helperPath: string;
} {
  const entryPath = path.join(root, 'dist', 'bin', 'agents-commander.js');
  const helperPath = path.join(root, 'dist', 'agents', 'pty-helper.py');
  const templatesPath = path.join(root, 'dist', 'templates');
  const demoPath = path.join(root, 'dist', 'demo', 'demo-agent.mjs');
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.mkdirSync(path.dirname(helperPath), { recursive: true });
  fs.mkdirSync(templatesPath, { recursive: true });
  fs.mkdirSync(path.dirname(demoPath), { recursive: true });
  fs.writeFileSync(entryPath, '');
  fs.writeFileSync(helperPath, '#!/usr/bin/env python3\n');
  fs.writeFileSync(demoPath, '#!/usr/bin/env node\n');
  for (let index = 0; index < 100; index += 1) {
    fs.writeFileSync(path.join(templatesPath, `template-${index}.md`), `# ${index}\n`);
  }
  return { moduleUrl: pathToFileURL(entryPath).href, helperPath };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Agents Commander Doctor', () => {
  it('reports a healthy installed layout and never launches an agent CLI', async () => {
    const root = temporaryDirectory();
    const layout = createInstalledLayout(root);
    const probe = vi.fn(async (
      _command: string,
      args: readonly string[],
    ): Promise<ProcessProbeResult> => (
      args.length === 1 && args[0] === '--version'
        ? successfulProbe('Python 3.12.4\n')
        : successfulProbe('pty-ok')
    ));
    const resolveExecutable = vi.fn((_command: string) => process.execPath);

    const report = await runDoctor({
      workingDirectory: root,
      environment: {
        nodeVersion: '22.19.0',
        platform: 'linux',
        stdinIsTTY: true,
        stdoutIsTTY: true,
        columns: 120,
        rows: 30,
      },
      config: structuredClone(defaultConfig),
      assetLookup: {
        mode: 'installed',
        packageRoot: root,
      },
      resolveExecutable,
      probe,
    });

    expect(report.failures).toBe(0);
    expect(report.warnings).toBe(0);
    expect(doctorExitCode(report)).toBe(0);
    expect(report.rows.find((entry) => entry.id === 'pty-helper')).toMatchObject({
      status: 'pass',
      summary: layout.helperPath,
    });
    expect(report.rows.find((entry) => entry.id === 'agent-opencode')).toMatchObject({
      label: 'OpenCode',
      status: 'pass',
      summary: process.execPath,
    });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe.mock.calls[0]?.[1]).toEqual(['--version']);
    expect(probe.mock.calls[1]?.[1]).toContain(layout.helperPath);
    expect(probe.mock.calls[1]?.[2]).toMatchObject({ keepStdinOpen: true });
  });

  it('keeps optional agent and terminal warnings non-fatal', async () => {
    const root = temporaryDirectory();
    const layout = createInstalledLayout(root);
    const probe = vi.fn(async (
      _command: string,
      args: readonly string[],
    ): Promise<ProcessProbeResult> => (
      args[0] === '--version'
        ? successfulProbe('Python 3.11.9')
        : successfulProbe('pty-ok')
    ));

    const report = await runDoctor({
      workingDirectory: root,
      environment: {
        nodeVersion: '22.0.0',
        platform: 'darwin',
        stdinIsTTY: false,
        stdoutIsTTY: false,
        columns: 80,
        rows: 20,
      },
      config: structuredClone(defaultConfig),
      assetLookup: { mode: 'installed', packageRoot: root },
      resolveExecutable: (command) => command === 'python3' ? process.execPath : null,
      probe,
    });

    expect(report.failures).toBe(0);
    expect(report.warnings).toBeGreaterThan(0);
    expect(report.rows.find((entry) => entry.id === 'tty')?.status).toBe('warn');
    expect(report.rows.find((entry) => entry.id === 'agent-claude')?.status).toBe('warn');
    expect(doctorExitCode(report)).toBe(0);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('marks required runtime failures as fatal', async () => {
    const root = temporaryDirectory();
    const report = await runDoctor({
      workingDirectory: root,
      environment: {
        nodeVersion: '20.20.0',
        platform: 'win32',
        stdinIsTTY: false,
        stdoutIsTTY: false,
        columns: 70,
        rows: 18,
      },
      config: structuredClone(defaultConfig),
      assetLookup: {
        mode: 'installed',
        packageRoot: root,
      },
      resolveExecutable: () => null,
    });

    expect(report.rows.find((entry) => entry.id === 'node')?.status).toBe('fail');
    expect(report.rows.find((entry) => entry.id === 'node')?.summary).toBe(
      'Node.js 22 or newer is required',
    );
    expect(report.rows.find((entry) => entry.id === 'platform')?.status).toBe('fail');
    expect(report.rows.find((entry) => entry.id === 'python')?.status).toBe('fail');
    expect(report.rows.find((entry) => entry.id === 'pty-helper')?.status).toBe('fail');
    expect(report.rows.find((entry) => entry.id === 'templates')?.status).toBe('fail');
    expect(report.rows.find((entry) => entry.id === 'demo-agent')?.status).toBe('warn');
    expect(doctorExitCode(report)).toBe(1);
  });

  it('validates OpenCode profiles without executing the OpenCode CLI', async () => {
    const root = temporaryDirectory();
    createInstalledLayout(root);
    const config = structuredClone(defaultConfig);
    config.agentProfiles = [{
      id: 'broken-opencode',
      label: 'Broken OpenCode',
      adapter: 'opencode',
      model: 'missing-provider-prefix',
      command: process.execPath,
    }];
    const probe = vi.fn(async (
      _command: string,
      args: readonly string[],
    ): Promise<ProcessProbeResult> => (
      args[0] === '--version'
        ? successfulProbe('Python 3.12.4')
        : successfulProbe('pty-ok')
    ));

    const report = await runDoctor({
      workingDirectory: root,
      environment: {
        nodeVersion: '22.19.0',
        platform: 'linux',
        stdinIsTTY: true,
        stdoutIsTTY: true,
        columns: 120,
        rows: 30,
      },
      config,
      assetLookup: { mode: 'installed', packageRoot: root },
      resolveExecutable: () => process.execPath,
      probe,
    });

    expect(report.rows.find((entry) => entry.id === 'agent-broken-opencode'))
      .toMatchObject({
        label: 'Broken OpenCode',
        status: 'warn',
        summary: 'Invalid profile configuration',
        detail: expect.stringContaining('provider/model'),
      });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('formats deterministic plain output and sanitizes control characters', () => {
    const report: DoctorReport = {
      rows: [{
        id: 'sample',
        label: 'Sample',
        status: 'warn',
        summary: 'line\u001b[31m\nbreak',
        detail: 'detail\tvalue',
      }],
      passed: 0,
      warnings: 1,
      failures: 0,
    };

    expect(formatDoctorReport(report)).toBe([
      'Agents Commander Doctor',
      '',
      '[WARN] Sample: line [31m break',
      '       detail value',
      '',
      'Result: WARN (0 passed, 1 warnings, 0 failures)',
    ].join('\n'));
  });

  it('keeps the Doctor branch ahead of the lazy UI import', () => {
    const cliSource = fs.readFileSync(path.resolve('bin/agents-commander.ts'), 'utf8');
    const doctorBranch = cliSource.indexOf('if (options.doctor)');
    const appImport = cliSource.indexOf("await import('../src/app.js')");

    expect(cliSource).not.toMatch(/^import\s+\{\s*App\s*\}/m);
    expect(doctorBranch).toBeGreaterThanOrEqual(0);
    expect(appImport).toBeGreaterThan(doctorBranch);
  });
});
