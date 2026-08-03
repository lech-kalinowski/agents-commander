import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/types.js';
import { loadConfig } from '../config/loader.js';
import { discoverAgentsWithResolver } from '../agents/agent-registry.js';
import { resolveExecutablePath } from '../utils/command-resolution.js';
import {
  listBuiltinTemplateFiles,
  resolveBuiltinTemplateDirectory,
  resolveDemoAgentPath,
  resolvePtyHelperPath,
  runtimeAssetLookupForModule,
  type RuntimeAssetLookupOptions,
} from '../utils/runtime-assets.js';
import {
  runBoundedProcess,
  type ProcessProbeOptions,
  type ProcessProbeResult,
} from './process-probe.js';
import type { DoctorReport, DoctorRow } from './types.js';

const RECOMMENDED_COLUMNS = 100;
const RECOMMENDED_ROWS = 24;
const EXPECTED_TEMPLATE_FLOOR = 100;
const MINIMUM_NODE_MAJOR = 22;

export interface DoctorEnvironment {
  nodeVersion: string;
  platform: NodeJS.Platform;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  columns?: number;
  rows?: number;
}

export interface RunDoctorOptions {
  workingDirectory: string;
  environment?: Partial<DoctorEnvironment>;
  config?: AppConfig;
  assetLookup?: RuntimeAssetLookupOptions;
  resolveExecutable?: (command: string) => string | null;
  probe?: (
    command: string,
    args: readonly string[],
    options?: ProcessProbeOptions,
  ) => Promise<ProcessProbeResult>;
}

function row(
  id: string,
  label: string,
  status: DoctorRow['status'],
  summary: string,
  detail?: string,
): DoctorRow {
  return { id, label, status, summary, ...(detail ? { detail } : {}) };
}

function plainDetail(value: string, limit = 300): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function buildReport(rows: DoctorRow[]): DoctorReport {
  return {
    rows,
    passed: rows.filter((entry) => entry.status === 'pass').length,
    warnings: rows.filter((entry) => entry.status === 'warn').length,
    failures: rows.filter((entry) => entry.status === 'fail').length,
  };
}

function runtimeEnvironment(overrides: Partial<DoctorEnvironment> = {}): DoctorEnvironment {
  return {
    nodeVersion: overrides.nodeVersion ?? process.versions.node,
    platform: overrides.platform ?? process.platform,
    stdinIsTTY: overrides.stdinIsTTY ?? Boolean(process.stdin.isTTY),
    stdoutIsTTY: overrides.stdoutIsTTY ?? Boolean(process.stdout.isTTY),
    columns: overrides.columns ?? process.stdout.columns,
    rows: overrides.rows ?? process.stdout.rows,
  };
}

export async function runDoctor(options: RunDoctorOptions): Promise<DoctorReport> {
  const rows: DoctorRow[] = [];
  const environment = runtimeEnvironment(options.environment);
  const resolveExecutable = options.resolveExecutable ?? resolveExecutablePath;
  const probe = options.probe ?? runBoundedProcess;
  const config = options.config ?? loadConfig();
  const assetLookup = options.assetLookup ?? runtimeAssetLookupForModule(import.meta.url);
  const workingDirectory = path.resolve(options.workingDirectory);

  const nodeMajor = Number.parseInt(environment.nodeVersion.split('.')[0] ?? '', 10);
  rows.push(Number.isFinite(nodeMajor) && nodeMajor >= MINIMUM_NODE_MAJOR
    ? row('node', 'Node.js', 'pass', `v${environment.nodeVersion}`)
    : row(
      'node',
      'Node.js',
      'fail',
      `Node.js ${MINIMUM_NODE_MAJOR} or newer is required`,
      `Found v${environment.nodeVersion}`,
    ));

  rows.push(environment.platform === 'darwin' || environment.platform === 'linux'
    ? row('platform', 'Platform', 'pass', environment.platform)
    : row('platform', 'Platform', 'fail', 'Only macOS and Linux are supported', environment.platform));

  let isDirectory = false;
  try {
    isDirectory = (await fs.stat(workingDirectory)).isDirectory();
    rows.push(isDirectory
      ? row('working-directory', 'Working directory', 'pass', workingDirectory)
      : row('working-directory', 'Working directory', 'fail', 'Path is not a directory', workingDirectory));
  } catch (error) {
    rows.push(row(
      'working-directory',
      'Working directory',
      'fail',
      'Directory is unavailable',
      plainDetail(error instanceof Error ? error.message : String(error)),
    ));
  }

  for (const accessCheck of [
    { id: 'directory-readable', label: 'Directory readable', mode: fsConstants.R_OK },
    { id: 'directory-writable', label: 'Directory writable', mode: fsConstants.W_OK },
  ]) {
    if (!isDirectory) {
      rows.push(row(accessCheck.id, accessCheck.label, 'fail', 'Working directory is unavailable'));
      continue;
    }
    try {
      await fs.access(workingDirectory, accessCheck.mode);
      rows.push(row(accessCheck.id, accessCheck.label, 'pass', workingDirectory));
    } catch (error) {
      rows.push(row(
        accessCheck.id,
        accessCheck.label,
        'fail',
        'Access denied',
        plainDetail(error instanceof Error ? error.message : String(error)),
      ));
    }
  }

  rows.push(environment.stdinIsTTY && environment.stdoutIsTTY
    ? row('tty', 'Interactive terminal', 'pass', 'stdin and stdout are TTYs')
    : row('tty', 'Interactive terminal', 'warn', 'stdin or stdout is not a TTY'));

  const columns = environment.columns;
  const terminalRows = environment.rows;
  if (columns === undefined || terminalRows === undefined) {
    rows.push(row('terminal-size', 'Terminal size', 'warn', 'Dimensions are unavailable'));
  } else if (columns < RECOMMENDED_COLUMNS || terminalRows < RECOMMENDED_ROWS) {
    rows.push(row(
      'terminal-size',
      'Terminal size',
      'warn',
      `${columns}x${terminalRows}; ${RECOMMENDED_COLUMNS}x${RECOMMENDED_ROWS} recommended`,
    ));
  } else {
    rows.push(row('terminal-size', 'Terminal size', 'pass', `${columns}x${terminalRows}`));
  }

  const pythonPath = resolveExecutable('python3');
  if (!pythonPath || !path.isAbsolute(pythonPath)) {
    rows.push(row('python', 'Python 3', 'fail', 'python3 executable was not found'));
  } else {
    const result = await probe(pythonPath, ['--version'], {
      timeoutMs: 1500,
      maxOutputBytes: 4096,
    });
    const versionText = plainDetail(result.stdout || result.stderr || result.error || '');
    if (result.timedOut) {
      rows.push(row('python', 'Python 3', 'fail', 'Version probe timed out', pythonPath));
    } else if (!result.ok) {
      rows.push(row('python', 'Python 3', 'fail', 'Version probe failed', versionText || pythonPath));
    } else if (!/^Python 3(?:\.|\s|$)/i.test(versionText)) {
      rows.push(row('python', 'Python 3', 'fail', 'Python 3 is required', versionText || pythonPath));
    } else {
      rows.push(row('python', 'Python 3', 'pass', versionText || 'Available', pythonPath));
    }
  }

  const helperPath = resolvePtyHelperPath(assetLookup);
  rows.push(helperPath
    ? row('pty-helper', 'PTY helper', 'pass', helperPath)
    : row('pty-helper', 'PTY helper', 'fail', 'Packaged pty-helper.py was not found or is unreadable'));

  if (pythonPath && path.isAbsolute(pythonPath) && helperPath) {
    const ptyProbe = await probe(
      pythonPath,
      [helperPath, '--', process.execPath, '-e', 'process.stdout.write("pty-ok")'],
      {
        timeoutMs: 2000,
        maxOutputBytes: 4096,
        keepStdinOpen: true,
        // The helper maps SIGUSR1 to a hard kill of the PTY child's process
        // group, preventing a timed-out diagnostic descendant from surviving.
        timeoutSignal: 'SIGUSR1',
      },
    );
    rows.push(ptyProbe.ok && ptyProbe.stdout.includes('pty-ok')
      ? row('pty-runtime', 'PTY runtime', 'pass', 'Pseudo-terminal launch succeeded')
      : row(
        'pty-runtime',
        'PTY runtime',
        'fail',
        ptyProbe.timedOut ? 'Pseudo-terminal probe timed out' : 'Pseudo-terminal probe failed',
        plainDetail(ptyProbe.stderr || ptyProbe.stdout || ptyProbe.error || ''),
      ));
  } else {
    rows.push(row('pty-runtime', 'PTY runtime', 'fail', 'Python 3 and the PTY helper are required'));
  }

  const templateDirectory = resolveBuiltinTemplateDirectory(assetLookup);
  if (!templateDirectory) {
    rows.push(row('templates', 'Built-in templates', 'fail', 'Template directory was not found'));
  } else {
    const templateCount = listBuiltinTemplateFiles(templateDirectory).length;
    const status = templateCount === 0
      ? 'fail'
      : templateCount < EXPECTED_TEMPLATE_FLOOR ? 'warn' : 'pass';
    rows.push(row(
      'templates',
      'Built-in templates',
      status,
      `${templateCount} Markdown template${templateCount === 1 ? '' : 's'}`,
      templateDirectory,
    ));
  }

  const demoAgentPath = resolveDemoAgentPath(assetLookup);
  rows.push(demoAgentPath
    ? row('demo-agent', 'Offline demo agent', 'pass', demoAgentPath)
    : row('demo-agent', 'Offline demo agent', 'warn', 'Demo asset is not installed yet'));

  const agentProfiles = discoverAgentsWithResolver(
    config.agents,
    config.agentProfiles,
    resolveExecutable,
  );
  for (const agent of agentProfiles) {
    const id = `agent-${agent.profileId}`;
    const safeProfileLabel = plainDetail(agent.profileLabel, 120);
    const label = agent.supported
      ? safeProfileLabel
      : `${safeProfileLabel} (catalogued)`;
    if (agent.configurationError) {
      rows.push(row(id, label, 'warn', 'Invalid profile configuration', agent.configurationError));
      continue;
    }

    if (agent.type === 'opencode' && agent.env.OPENCODE_CONFIG) {
      const configuredPath = path.isAbsolute(agent.env.OPENCODE_CONFIG)
        ? agent.env.OPENCODE_CONFIG
        : path.resolve(workingDirectory, agent.env.OPENCODE_CONFIG);
      try {
        await fs.access(configuredPath, fsConstants.R_OK);
      } catch {
        rows.push(row(id, label, 'warn', 'Configured OpenCode file is not readable'));
        continue;
      }
    }

    rows.push(agent.installed
      ? agent.supported
        ? row(
          id,
          label,
          'pass',
          agent.command,
          agent.model ? `Model: ${agent.model}` : undefined,
        )
        : row(id, label, 'pass', 'Found; not launchable yet', agent.command)
      : row(
        id,
        label,
        'warn',
        agent.supported
          ? `Not found (${agent.command})`
          : `Not found; not launchable yet (${agent.command})`,
      ));
  }

  return buildReport(rows);
}

export function doctorExitCode(report: DoctorReport): number {
  return report.failures > 0 ? 1 : 0;
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ['Agents Commander Doctor', ''];
  for (const entry of report.rows) {
    lines.push(
      `[${entry.status.toUpperCase()}] ${plainDetail(entry.label, 120)}: ${plainDetail(entry.summary)}`,
    );
    if (entry.detail) lines.push(`       ${plainDetail(entry.detail)}`);
  }
  lines.push('');
  const result = report.failures > 0 ? 'FAIL' : report.warnings > 0 ? 'WARN' : 'PASS';
  lines.push(
    `Result: ${result} (${report.passed} passed, ${report.warnings} warnings, ${report.failures} failures)`,
  );
  return lines.join('\n');
}
