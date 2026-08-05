import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProtocolScanner,
  type CommanderMessage,
} from '../../src/orchestration/protocol.js';

const scriptPath = path.resolve('src/demo/demo-agent.js');
const children = new Set<ReturnType<typeof spawn>>();

function startRole(role: 'coordinator' | 'reviewer', capability?: string) {
  const child = spawn(process.execPath, [
    scriptPath,
    '--role',
    role,
    '--delay',
    '0',
    ...(capability ? ['--protocol-capability', capability] : []),
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG ?? 'C',
    },
  });
  children.add(child);

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function waitForOutput(
  read: () => string,
  expected: string,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  while (!read().includes(expected)) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${JSON.stringify(expected)} in ${read()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  await Promise.all(
    [...children].map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) {
        await once(child, 'exit');
      }
    }),
  );
  children.clear();
});

describe('offline demo agent', () => {
  it('carries the supplied session capability on every production marker', async () => {
    const capability = 'a'.repeat(43);
    const coordinator = startRole('coordinator', capability);
    await waitForOutput(coordinator.stdout, 'Type START');
    coordinator.child.stdin.write('START\n');
    await waitForOutput(coordinator.stdout, `===COMMANDER:END:${capability}===`);

    expect(coordinator.stdout()).toContain(
      `===COMMANDER:SEND:generic:2:${capability}===`,
    );
    expect(coordinator.stdout()).not.toContain('===COMMANDER:END===');
  });

  it('emits no protocol before an explicit START and then emits one fixed SEND', async () => {
    const coordinator = startRole('coordinator');
    await waitForOutput(coordinator.stdout, 'Type START');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(coordinator.stdout()).not.toContain('COMMANDER:');

    coordinator.child.stdin.write('ignored\n');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(coordinator.stdout()).not.toContain('COMMANDER:');

    coordinator.child.stdin.write('START\n');
    await waitForOutput(coordinator.stdout, '===COMMANDER:END===');
    expect(coordinator.stdout()).toContain([
      '===COMMANDER:SEND:generic:2===',
      'Review brief.md and confirm that the deterministic total is 42.',
      '===COMMANDER:END===',
    ].join('\n'));
    expect(coordinator.stdout().match(/COMMANDER:SEND/g)).toHaveLength(1);
  });

  it('emits the fixed STATUS then REPLY flow and exits successfully', async () => {
    const reviewer = startRole('reviewer');
    await waitForOutput(reviewer.stdout, 'Waiting for the coordinator');
    expect(reviewer.stdout()).not.toContain('COMMANDER:');

    reviewer.child.stdin.write(
      '\u001b[200~[From Demo Coordinator in Panel 1 | thread=t1 | msg=m1]: '
      + 'Review brief.md and confirm that the determinist\n'
      + 'ic total is 42.'
      + '\u001b[201~\r',
    );

    const [code] = await once(reviewer.child, 'exit');
    expect(code).toBe(0);
    expect(reviewer.stderr()).toBe('');
    expect(reviewer.stdout()).toContain([
      '===COMMANDER:STATUS===',
      'Demo Reviewer checked the seeded workspace: total is 42.',
      '===COMMANDER:END===',
    ].join('\n'));
    expect(reviewer.stdout()).toContain([
      '===COMMANDER:REPLY===',
      'Deterministic review passed: calculateTotal([19, 23]) equals 42.',
      '===COMMANDER:END===',
    ].join('\n'));
    expect(reviewer.stdout().indexOf('COMMANDER:STATUS'))
      .toBeLessThan(reviewer.stdout().indexOf('COMMANDER:REPLY'));
  });

  it('emits the deterministic completion status after the routed reply', async () => {
    const coordinator = startRole('coordinator');
    await waitForOutput(coordinator.stdout, 'Type START');
    coordinator.child.stdin.write('START\n');
    await waitForOutput(coordinator.stdout, 'COMMANDER:SEND');
    coordinator.child.stdin.write(
      '\u001b[200~[From Demo Reviewer in Panel 2 | thread=t1 | msg=m2]: '
      + 'Determinis\n'
      + 'tic review passed: calculat\n'
      + 'eTotal([19, 23]) equals 42.'
      + '\u001b[201~\r',
    );

    const [code] = await once(coordinator.child, 'exit');
    expect(code).toBe(0);
    expect(coordinator.stdout()).toContain([
      '===COMMANDER:STATUS===',
      'Conference demo complete: SEND, STATUS, and REPLY verified.',
      '===COMMANDER:END===',
    ].join('\n'));
  });

  it('has no network or credential access in the executable asset', async () => {
    const source = await fs.readFile(scriptPath, 'utf8');
    expect(source).not.toMatch(/node:(?:http|https|net|tls|dns|dgram)/u);
    expect(source).not.toContain('process.env');
    expect(source).not.toMatch(/API_KEY|TOKEN|CREDENTIAL|PASSWORD|SECRET/u);
  });

  it('rejects unknown roles without starting a session', async () => {
    const child = spawn(process.execPath, [scriptPath, '--role', 'unknown'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const [code] = await once(child, 'exit');
    expect(code).toBe(2);
    expect(stderr).toContain('--role must be coordinator or reviewer');
  });

  it('delivers both production-timed reviewer markers through a real PTY scanner', async () => {
    const helperPath = path.resolve('src/agents/pty-helper.py');
    const child = spawn(
      'python3',
      [
        helperPath,
        '--cwd',
        process.cwd(),
        '--',
        process.execPath,
        scriptPath,
        '--role',
        'reviewer',
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: process.env.LANG ?? 'C',
          TERM: 'xterm-256color',
          COLUMNS: '100',
          LINES: '30',
        },
      },
    );
    children.add(child);
    const messages: CommanderMessage[] = [];
    const scanner = new ProtocolScanner(1, 'Demo Reviewer', (message) => {
      messages.push(message);
    });
    let output = '';
    let taskSent = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      scanner.feed(chunk);
      if (!taskSent && output.includes('Waiting for the coordinator')) {
        taskSent = true;
        child.stdin.write(
          '\u001b[200~[From Demo Coordinator in Panel 1 | thread=t1 | msg=m1]: '
          + 'Review brief.md and confirm that the deterministic total is 42.'
          + '\u001b[201~\r',
        );
      }
    });

    const [code] = await once(child, 'exit');
    expect(code).toBe(0);
    expect(messages.map(({ type }) => type)).toEqual(['status', 'reply']);
    expect(messages[0].content)
      .toBe('Demo Reviewer checked the seeded workspace: total is 42.');
    expect(messages[1].content)
      .toBe('Deterministic review passed: calculateTotal([19, 23]) equals 42.');
    expect(output).toContain('Offline demo role complete.');
  }, 5_000);
});
