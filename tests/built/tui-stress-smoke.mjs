#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { pathToFileURL } from 'node:url';

// Only called with the packed-install runner's private, disposable home.
const [packageRoot, fixtureHome] = process.argv.slice(2).map(value => path.resolve(value));
assert.equal(path.resolve(process.env.HOME), fixtureHome, 'Use only the owned packed-test home');
const { VTerm } = await import(pathToFileURL(path.join(packageRoot, 'dist/src/index.js')).href);
const workspace = path.join(fixtureHome, 'stress-workspace');
await fs.mkdir(workspace);
await fs.writeFile(path.join(workspace, 'synthetic.txt'), 'Synthetic stress fixture\n');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launch(args, exercise) {
  const term = new VTerm(160, 54);
  const decoder = new StringDecoder('utf8');
  let stderr = '';
  let processError;
  const child = spawn('python3', [path.join(packageRoot, 'dist/agents/pty-helper.py'), '--',
    process.execPath, path.join(packageRoot, 'dist/bin/agents-commander.js'), ...args], {
    cwd: workspace,
    env: { ...process.env, TERM: 'xterm-256color', COLUMNS: '160', LINES: '54' },
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => term.write(decoder.write(data)));
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-8192); });
  child.once('error', error => { processError = error; });
  child.stdin.on('error', error => { processError = error; });
  child.stdio[3].on('error', () => {});
  const closed = once(child, 'close');
  // Handle early spawn failure before the normal close await is reached.
  void closed.catch(() => {});
  const screen = () => term.getGridPlainLines().join('\n');
  async function waitFor(predicate, label, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (!await predicate()) {
      assert.equal(processError, undefined, `${label}: ${processError?.message}`);
      assert.equal(child.exitCode, null, `CLI exited during ${label}`);
      assert.ok(Date.now() < deadline, `${label} timed out\n${screen()}\n${stderr}`);
      await delay(25);
    }
  }
  async function key(bytes, predicate, label) {
    child.stdin.write(bytes);
    await waitFor(predicate, label);
  }
  async function navigate(number) {
    await key('\x1b[23~', () => screen().includes('Panel Navigator (F11)'), 'navigator opens');
    await key(`P${number}\r`, () => !screen().includes('Panel Navigator (F11)')
      && new RegExp(`P${number}\\s+\\|`).test(screen()), `jump to P${number}`);
  }
  async function resize(cols, rows) {
    term.resize(cols, rows);
    child.stdio[3].write(`resize ${cols} ${rows}\n`);
    // Round trip through a modal proves input and repaint both survived resize.
    await key('\x1b[23~', () => screen().includes('Panel Navigator (F11)'), 'navigator after resize');
    await key('\x1b', () => !screen().includes('Panel Navigator (F11)'), 'close resized navigator');
  }
  try {
    await waitFor(() => screen().includes('Multi-Agent Terminal Manager'), 'normal welcome');
    await key(' ', () => !screen().includes('Multi-Agent Terminal Manager'), 'dismiss welcome');
    await exercise({ screen, key, waitFor, navigate, resize, child });
    await key('\x1b[21~', () => /Exit Agents Commander\?|Exit anyway\?/u.test(screen()), 'quit confirmation');
    // Default No must leave the application running and responsive.
    await key('\r', () => !/Exit Agents Commander\?|Exit anyway\?/u.test(screen()), 'default-No cancels quit');
    await key('\x1b[21~', () => /Exit Agents Commander\?|Exit anyway\?/u.test(screen()), 'reopen quit');
    child.stdin.write('y');
    const result = await Promise.race([closed, delay(10000).then(() => { throw new Error('Stress CLI quit timed out'); })]);
    assert.equal(result[0], 0, stderr);
    assert.doesNotMatch(stderr, /EMFILE|ENOSPC|Unhandled|uncaught/iu);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([closed.catch(() => {}), delay(2000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.stdio[3].write('signal KILL\n');
        child.stdin.end();
        await Promise.race([closed.catch(() => {}), delay(2000)]);
      }
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }
}

for (const theme of ['classic-blue', 'midnight']) {
  await launch(['--panels', '100', '--theme', theme], async ({ screen, key, navigate, resize }) => {
    assert.match(screen(), /100 panels/u);
    await navigate(100);
    await key('\x1bOS', () => screen().includes('F4 Back'), 'P100 fullscreen');
    await resize(80, 24);
    await key('\x1bOS', () => !screen().includes('F4 Back'), 'restore dense grid');
    await resize(200, 60);
    await navigate(50);
    await key('\x1b[20~', () => /99 panels/u.test(screen()), 'F9 closes P50');
    await navigate(100);
    assert.match(screen(), /Position #99/u, 'Closing P50 must not renumber P100');
    await key('\x1bOR', () => {
      const view = screen();
      // P101 is in the bottom-right cell; text after its header includes later
      // rows of neighbouring panels. Count all visible, loaded fixture lists
      // instead of mistaking a neighbour's contents for P101 readiness.
      // Each panel has one fixture file; the status selection remains '..'.
      const visible = [...view.matchAll(/#\d+ P\d+ /gu)].length;
      const loaded = [...view.matchAll(/synthetic\.txt/gu)].length;
      return view.includes('#100 P101') && visible > 0 && loaded === visible;
    }, 'F3 creates and loads fresh P101');
    await key('\x1bOS', () => screen().includes('F4 Back'), 'new P101 fullscreen');
    await key('\x1bOS', () => !screen().includes('F4 Back'), 'new P101 back');
  });
  console.log(`Packed stress passed: ${theme}, 100 panels, P100 jump, resize, close/stable IDs, P101 add, fullscreen and default-No quit.`);
}

const receipts = path.join(workspace, 'receipts');
await fs.mkdir(receipts);
const stopFile = path.join(receipts, 'stop-owned-agents');
const configDirectory = path.join(fixtureHome, '.agents-commander');
await fs.mkdir(configDirectory, { recursive: true });
const configPath = path.join(configDirectory, 'config.json');
let originalConfig;
try { originalConfig = await fs.readFile(configPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const script = [
  'const fs = require("node:fs");',
  'const path = require("node:path");',
  'let input = ""; let protocol = 0; let unexpected = 0;',
  'const receipt = path.join(process.argv[1], process.pid + ".json");',
  // Even when testing a broken shutdown, fixture children cannot live forever.
  'setTimeout(() => process.exit(0), 120000).unref();',
  'setInterval(() => { if (fs.existsSync(path.join(process.argv[1], "stop-owned-agents"))) process.exit(0); }, 100).unref();',
  'const save = () => fs.writeFileSync(receipt, JSON.stringify({pid:process.pid,protocol,unexpected,pendingBytes:input.length}));',
  'process.stdin.setRawMode(true); process.stdin.setEncoding("utf8");',
  'process.stdin.on("data", chunk => { input += chunk; let end;',
  'while ((end = input.indexOf("\\r")) >= 0) { const frame = input.slice(0,end); input = input.slice(end+1);',
  'if (/^\\x1b\\[200~[\\s\\S]*Protocol capability: [A-Za-z0-9_-]{43}\\.[\\s\\S]*\\x1b\\[201~$/.test(frame)) { protocol++; save(); console.log("PROTOCOL_OK"); }',
  'else { unexpected++; console.log("UNEXPECTED_INPUT"); } } save(); });',
  'save(); console.log("SYNTHETIC_READY"); process.stdin.resume();',
].join('');
const config = Buffer.from(JSON.stringify({
  agentProfiles: [{ id: 'claude', adapter: 'generic', label: 'Synthetic packed QA', command: process.execPath, args: ['-e', script, receipts] }],
  orchestration: { initDelay: 0, injectionGrace: 0, claudeSubmitDelay: 0 },
}));
async function readReceipts() {
  const files = (await fs.readdir(receipts)).filter(name => /^\d+\.json$/u.test(name));
  return Promise.all(files.map(async name => {
    try {
      const row = JSON.parse(await fs.readFile(path.join(receipts, name), 'utf8'));
      assert.equal(row.pid, Number(name.slice(0, -5)));
      assert.ok(Number.isSafeInteger(row.pid) && row.pid > 1);
      return row;
    } catch { return null; } // Retry a concurrent synthetic receipt rewrite.
  }));
}
const isAlive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
try {
  await fs.writeFile(configPath, config);
  let ownedPids = [];
  await launch(['--density', '2'], async ({ screen, key, waitFor, navigate }) => {
    await key('\x1bOQ', () => screen().includes('Launch Agent (F2)'), 'open bulk picker');
    assert.match(screen(), /Synthetic packed QA/u);
    await key('n20\r', () => /Start 20 copies/u.test(screen()), 'confirm twenty new agents');
    assert.match(screen(), /Start 20 copies of profile claude\?/u, 'Only the overridden synthetic profile may be launched');
    await key('y', () => /22 panels/u.test(screen()), 'launch twenty new agents');
    await waitFor(async () => {
      const rows = await readReceipts();
      return rows.length === 20 && rows.every(row => row && row.protocol === 0 && row.unexpected === 0 && row.pendingBytes === 0);
    }, 'twenty real local children ready', 20000);
    ownedPids = (await readReceipts()).map(row => row.pid);
    assert.equal(new Set(ownedPids).size, 20);
    await navigate(22);
    await key('\x1bOQ', () => screen().includes('Launch Agent (F2)'), 'protocol picker entry');
    await key('p', () => /Commander Protocol.*0 selected/u.test(screen()), 'open bulk protocol setup');
    await key('a\r', () => /Inject into 20 selected agents/u.test(screen()), 'confirm selected protocol recipients');
    await key('y', () => !/Inject into 20 selected agents/u.test(screen()), 'start protocol injection');
    await waitFor(async () => {
      const rows = await readReceipts();
      return rows.length === 20 && rows.every(row => row && row.protocol === 1 && row.unexpected === 0 && row.pendingBytes === 0);
    }, 'twenty hidden/visible agents receive exactly one protocol', 30000);
    // A child can acknowledge the paste while Commander still owns its final
    // submission lane. Wait for the actual completion summary before keys.
    await waitFor(() => /Protocol: 20 submitted/u.test(screen()), 'bulk protocol workflow completed');
    await navigate(3);
    assert.doesNotMatch(screen(), /UNEXPECTED_INPUT/u, 'Modal keys must not reach background agents');
  });
  for (const pid of ownedPids) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `Owned agent ${pid} survived quit`);
  }
  for (const row of await readReceipts()) {
    assert.ok(row && row.protocol === 1 && row.unexpected === 0 && row.pendingBytes === 0,
      'No modal, navigator or quit input may leak to any of the twenty agents');
  }
  assert.deepEqual(await fs.readFile(configPath), config, 'Normal launch must not rewrite saved settings');
  console.log('Packed stress passed: twenty new local PTYs, twenty explicit protocol injections, hidden-panel navigation, default-No quit and complete child cleanup. No providers or hardware used.');
} finally {
  try {
    // Collect partial launches too. Cooperative fixture-only shutdown avoids
    // signaling a recycled PID; the success assertion above still detects an
    // application cleanup regression before this independent safety net runs.
    await fs.writeFile(stopFile, 'stop\n');
    const deadline = Date.now() + 5000;
    while (true) {
      const rows = await readReceipts();
      if (rows.every(row => row && !isAlive(row.pid))) break;
      assert.ok(Date.now() < deadline, 'Owned synthetic agents did not stop after fixture cleanup');
      await delay(50);
    }
  } finally {
    if (originalConfig) await fs.writeFile(configPath, originalConfig);
    else await fs.unlink(configPath);
  }
}
