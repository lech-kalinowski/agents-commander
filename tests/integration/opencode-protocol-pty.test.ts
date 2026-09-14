import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Duplex, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const capability = 'a'.repeat(43);
const token = 't'.repeat(43);
const sessionID = 'ses_owned_probe';
const commands = ['SEND:opencode:2', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY'];
const bunProbe = spawnSync('bun', ['--version'], { encoding: 'utf8', timeout: 2000 });
const bunAvailable = !bunProbe.error && bunProbe.status === 0;
const runtimes = [
  { name: 'Node', executable: process.execPath, evalArgs: ['--input-type=module', '-e'], available: true },
  { name: bunAvailable ? 'Bun' : 'Bun (skipped: Bun runtime is not available on PATH)',
    executable: 'bun', evalArgs: ['--eval'], available: bunAvailable },
];
const body = Array.from({ length: 48 }, (_, index) => (
  `line-${index}: Preserve this exact Unicode payload: 界 🚀 café; indentation:    and trailing spaces:  `
)).join('\n');

function textPart(command: string, sequence: number) {
  return `===COMMANDER:${command}:${capability}:${sequence}===\n${body}\n===COMMANDER:END:${capability}:${sequence}===`;
}

/** A real PTY/plugin transport test, without providers, credentials or disk capture. */
async function runProbe(mode: 'all-commands' | 'session-isolation', runtime: typeof runtimes[number]) {
  const pluginUrl = pathToFileURL(path.resolve('src/agents/opencode-protocol-plugin.js')).href;
  const expectedParts = commands.map((command, index) => textPart(command, index + 1));
  const instructionText = `[Agents Commander] You are Synthetic OpenCode in Panel 1.\n`
    + `Protocol capability: ${capability}. Include it on every protocol header and footer exactly as shown below.`;
  const script = `
    import assert from 'node:assert/strict';
    const plugin = (await import(${JSON.stringify(pluginUrl)})).default;
    const hooks = await plugin();
    const sessionID = ${JSON.stringify(sessionID)};
    const instructions = ${JSON.stringify(instructionText)};
    const parts = ${JSON.stringify(expectedParts)};
    async function chat(id, text, extra={}) {
      await hooks['chat.message']({sessionID:id}, {
        message:{role:'user',sessionID:id}, parts:[{type:'text',text,...extra}]
      });
    }
    async function complete(id, text, index) {
      const output = {text};
      await hooks['experimental.text.complete']({sessionID:id,messageID:'msg_probe',partID:'prt_'+index},output);
      assert.equal(output.text,text);
    }
    process.stdin.once('data', async () => {
      try {
        await chat(sessionID,instructions);
        if (${JSON.stringify(mode)} === 'all-commands') {
          for (const [index,text] of parts.entries()) await complete(sessionID,text,index);
        } else {
          await chat('ses_child','Inspect the sample code and report back.');
          await complete('ses_child',parts[0],0);
          await complete(sessionID,parts[1],1);
          await chat('ses_other',instructions,{synthetic:true});
          await complete(sessionID,parts[2],2);
          await chat('ses_other',instructions);
          await complete(sessionID,parts[3],3);
          await complete('ses_other',parts[4],4);
        }
        console.log('PROBE_DONE');
      } catch {
        console.log('PROBE_FAILED');
        process.exitCode = 1;
      } finally {
        await hooks.dispose();
        process.stdin.pause();
      }
    });
    console.log('PROBE_READY '+JSON.stringify({
      tty:Boolean(process.stdout.isTTY), columns:process.stdout.columns, rows:process.stdout.rows,
      tokenRemoved:process.env.AGENTS_COMMANDER_OPENCODE_TOKEN===undefined,
      fdRemoved:process.env.AGENTS_COMMANDER_OPENCODE_FD===undefined
    }));
  `;

  const child = spawn('python3', [path.resolve('src/agents/pty-helper.py'), '--',
    runtime.executable, ...runtime.evalArgs, script], {
    env: {
      ...process.env, COLUMNS: '114', LINES: '31',
      AGENTS_COMMANDER_OPENCODE_TOKEN: token, AGENTS_COMMANDER_OPENCODE_FD: '4',
    },
    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
  });
  const control = child.stdio[3] as Writable;
  const bridge = child.stdio[4] as Duplex;
  let stdout = '';
  let stderrBytes = 0;
  let pending = '';
  let transportBytes = 0;
  const decoder = new StringDecoder('utf8');
  const records: Array<Record<string, any>> = [];
  let armSent = false;
  let started = false;
  let timedOut = false;
  let failure: Error | null = null;
  const closed = once(child, 'close');
  control.on('error', () => {});
  bridge.on('error', () => {});
  child.stdin?.on('error', () => {});
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
    if (stdout.length > 16384) failure = new Error('Synthetic PTY output exceeded its bounded fixture budget');
  });
  child.stderr?.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; });
  bridge.on('data', (chunk: Buffer) => {
    transportBytes += chunk.length;
    if (transportBytes > 1024 * 1024) {
      failure = new Error('Synthetic bridge exceeded its bounded fixture budget');
      return;
    }
    pending += decoder.write(chunk);
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        if (message.v !== 1 || message.token !== token) throw new Error('Bridge authentication mismatch');
        records.push(message);
        if (message.type === 'hello' && !armSent) {
          armSent = true;
          const arm = JSON.stringify({ v: 1, type: 'arm', token, capability, epoch: 1 }) + '\n';
          // Exercise a parent command arriving in fragments through the actual
          // inherited duplex socket rather than assuming chunk/line alignment.
          bridge.write(arm.slice(0, 31));
          setImmediate(() => bridge.write(arm.slice(31)));
        }
        if (message.type === 'armed' && !started) {
          started = true;
          child.stdin?.write('GO\n');
        }
      } catch {
        failure = new Error('Malformed synthetic bridge record');
      }
    }
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    control.write('signal TERM\n');
    child.stdin?.end();
    child.kill('SIGTERM');
  }, 5000);

  try {
    const [exitCode, signal] = await closed;
    if (failure) throw failure;
    expect(timedOut).toBe(false);
    expect(exitCode).toBe(0);
    expect(signal).toBeNull();
    expect(stderrBytes).toBe(0);
    expect(pending).toBe('');
    const metadataMatch = stdout.match(/PROBE_READY (\{[^\r\n]+\})/);
    expect(metadataMatch).not.toBeNull();
    expect(JSON.parse(metadataMatch![1])).toEqual({
      tty: true, columns: 114, rows: 31, tokenRemoved: true, fdRemoved: true,
    });
    expect(stdout).toContain('PROBE_DONE');
    expect(stdout).not.toContain('PROBE_FAILED');
    // The tty keeps its own plain output/input echo; semantic payloads and
    // channel authority must never travel through the visible terminal stream.
    expect(stdout).not.toContain('COMMANDER');
    expect(stdout).not.toContain(capability);
    expect(stdout).not.toContain(token);
    expect(stdout).not.toContain('Preserve this exact Unicode');
    return { records, expectedParts };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) {
      control.write('signal TERM\n');
      child.stdin?.end();
      child.kill('SIGTERM');
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1500))]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    control.destroy();
    bridge.destroy();
  }
}

for (const runtime of runtimes) {
describe.skipIf(process.platform === 'win32' || !runtime.available)(`OpenCode semantic bridge through real PTY and ${runtime.name}`, () => {
  it('delivers all five long Unicode parts exactly while leaving terminal stdout unchanged', async () => {
    const { records, expectedParts } = await runProbe('all-commands', runtime);
    expect(records.map((record) => record.type)).toEqual(['hello', 'armed', 'bound', ...commands.map(() => 'text')]);
    expect(records[1]).toMatchObject({ type: 'armed', capability, epoch: 1 });
    expect(records[2]).toMatchObject({ type: 'bound', capability, epoch: 1, sessionID });
    expect(records.filter((record) => record.type === 'text')).toEqual(expectedParts.map((text, index) => ({
      v: 1, token, type: 'text', capability, epoch: 1, sessionID,
      messageID: 'msg_probe', partID: `prt_${index}`, text,
    })));
  }, 8000);

  it('isolates child sessions and disables an explicit wrong-session capability attempt', async () => {
    const { records, expectedParts } = await runProbe('session-isolation', runtime);
    expect(records.map((record) => record.type)).toEqual(['hello', 'armed', 'bound', 'text', 'text', 'error']);
    expect(records.filter((record) => record.type === 'text').map((record) => record.text))
      .toEqual([expectedParts[1], expectedParts[2]]);
    expect(records.filter((record) => record.type === 'text').every((record) => record.sessionID === sessionID)).toBe(true);
    expect(records.at(-1)).toEqual({ v: 1, token, type: 'error', code: 'session-mismatch', capability, epoch: 1 });
  }, 8000);
});
}
