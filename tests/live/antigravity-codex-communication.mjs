// Explicit opt-in; real providers, temporary workspace, no saved terminal transcripts.
if (process.env.COMMANDER_LIVE_ANTIGRAVITY !== '1') {
  console.error('Set COMMANDER_LIVE_ANTIGRAVITY=1 to authorize real Antigravity/Codex QA.');
  process.exit(2);
}
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(process.env.COMMANDER_QA_PACKAGE_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)));
const require = createRequire(path.join(root, 'package.json'));
const blessed = require('blessed');
const { TerminalPanel, AgentManager, Orchestrator, getTheme, loadConfig } =
  await import(pathToFileURL(path.join(root, 'dist/src/index.js')).href);
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-agy-codex-'));
const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
const output = Object.assign(new PassThrough(), { isTTY: true, columns: 220, rows: 55 });
output.resume();
const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false, fullUnicode: true });
const config = loadConfig();
const types = ['antigravity', 'codex'];
const panels = types.map((_, index) => new TerminalPanel(screen, getTheme('midnight'), index, cwd,
  { top: 0, left: index ? '50%' : 0, width: '50%', height: '100%' }, config));
const agents = new AgentManager({
  antigravity: { command: process.env.COMMANDER_QA_AGY ?? 'agy', args: ['--mode', 'plan', '--sandbox'], env: {} },
  codex: { command: process.env.COMMANDER_QA_CODEX ?? 'codex', env: {},
    args: ['--no-alt-screen', '-a', 'never', '-s', 'read-only', '-c', 'check_for_update_on_startup=false'] },
});
const layout = { hasPanel: i => !!panels[i], getTerminalPanel: i => panels[i], convertToTerminal: i => panels[i],
  allPanels: panels, panelCount: 2, setActivePanel() {} };
const orchestrator = new Orchestrator(layout, agents, screen, config);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const view = i => panels[i].getVisibleGridLines().join('\n');
// Standalone assistant receipts, not marker strings inside the echoed task.
const receipt = (i, marker) => view(i).split('\n').some(line =>
  new RegExp(`^\\s*(?:[•▸]\\s*)?${marker}\\s*$`, 'u').test(line));
let stage = 'startup';
let passed = false;
const checks = [];
const heartbeat = setInterval(() => console.log(JSON.stringify({ stage, checks: checks.length })), 10000);
async function until(predicate, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(panels.every(panel => panel.isRunning), 'owned-session-exited');
    assert.ok(Date.now() < deadline, label);
    await sleep(100);
  }
}
async function task(i, text) {
  assert.equal((await orchestrator.sendTask(types[i], i, text)).success, true, 'task-submission');
}
async function round(i, name) {
  stage = name;
  const before = orchestrator.getRecentActivity(100).length;
  const peer = 1 - i;
  const marker = `QA_${name.toUpperCase()}_DONE`;
  await task(i, 'Transport QA only. Do not use tools or read files. Send exactly one authenticated sequenced SEND '
    + `to ${types[peer]}:${peer + 1} with body: Do not use tools. REPLY with exactly ${marker}. `
    + `After you receive the peer reply, print ${marker} on its own line outside protocol and stop. `
    + 'Use your own key and fresh counter. ACK is not a peer reply. Do not resend after ACK.');
  await until(() => receipt(i, marker), 'reply-not-processed');
  await sleep(2500);
  const rows = orchestrator.getRecentActivity(100).slice(0, -before || undefined);
  assert.equal(rows.length, 2, 'exactly-two-deliveries');
  assert.ok(rows.every(row => row.status === 'delivered'), 'delivered-status');
  assert.equal(rows.filter(row => row.kind === 'send' && row.source.panelIndex === i && row.target.panelIndex === peer).length, 1);
  assert.equal(rows.filter(row => row.kind === 'reply' && row.source.panelIndex === peer && row.target.panelIndex === i).length, 1);
  checks.push(name);
}
try {
  for (const [i, type] of types.entries()) {
    assert.ok(agents.launchAgent(type, panels[i]), 'launch-failed');
    orchestrator.connectPanel(panels[i]);
  }
  screen.render();
  await until(() => /Yes, I trust this folder|Antigravity CLI \d/u.test(view(0)), 'agy-startup');
  if (/Yes, I trust this folder/u.test(view(0))) {
    // Only authorize the newly created, empty harness-owned workspace.
    assert.ok(view(0).includes(path.basename(cwd)), 'trust-target-mismatch');
    await until(() => /> Yes, I trust this folder/u.test(view(0)) && /enter Confirm/u.test(view(0)), 'trust-prompt');
    panels[0].sendInput('\r');
  }
  await until(() => /Antigravity CLI \d/u.test(view(0)) && /^>/mu.test(view(0)), 'agy-ready');
  await until(() => /OpenAI Codex/u.test(view(1)) && /^›/mu.test(view(1)), 'codex-ready');
  stage = 'protocol';
  for (const panel of panels) assert.ok(await orchestrator.injectProtocol(panel), 'protocol-injection');
  await sleep(15000);
  assert.equal(orchestrator.getRecentActivity(100).length, 0, 'no-startup-routing');
  await round(0, 'agy_to_codex');
  await round(1, 'codex_to_agy');
  await round(0, 'agy_repeat');
  stage = 'query';
  await task(0, 'Do not use tools. Emit one authenticated sequenced QUERY with body ping and your next fresh counter. '
    + 'After Commander responds PONG, print QA_AGY_QUERY_DONE alone outside protocol and stop.');
  await until(() => receipt(0, 'QA_AGY_QUERY_DONE'), 'query-not-processed');
  checks.push(stage);
  stage = 'status';
  await task(0, 'Do not use tools. Emit one authenticated sequenced STATUS with body QA_AGY_STATUS and your next fresh counter. '
    + 'After Commander ACK, print QA_AGY_STATUS_DONE alone outside protocol and stop.');
  await until(() => receipt(0, 'QA_AGY_STATUS_DONE'), 'status-ack-not-processed');
  checks.push(stage);
  assert.equal(orchestrator.getRecentActivity(100).length, 6, 'no-extra-deliveries');
  passed = true;
} catch {
  // Do not serialize child output, account details or capability keys on failure.
  console.error(JSON.stringify({ passed: false, stage }));
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  await orchestrator.sealAndDrain(3000);
  agents.prepareForShutdown();
  await Promise.all(panels.map(panel => panel.killAgent(true)));
  for (const panel of panels) panel.destroy();
  screen.destroy(); input.destroy(); output.destroy();
  console.log(JSON.stringify({ passed, checks, sessionsStopped: panels.every(panel => !panel.isRunning) }));
}
