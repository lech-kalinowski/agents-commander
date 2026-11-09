// Opt-in real-provider QA. No terminal transcripts or capability keys are saved.
if (process.env.COMMANDER_LIVE_CLAUDE_CODEX !== '1') {
  console.error('Set COMMANDER_LIVE_CLAUDE_CODEX=1 to authorize real Claude/Codex QA.');
  process.exit(2);
}
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22+ required');
const { createRequire } = await import('node:module');
const { PassThrough } = await import('node:stream');
const { default: fs } = await import('node:fs/promises');
const { default: path } = await import('node:path');
const { default: os } = await import('node:os');
const { fileURLToPath, pathToFileURL } = await import('node:url');
const root = path.resolve(process.env.COMMANDER_QA_PACKAGE_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)));
const require = createRequire(path.join(root, 'package.json'));
const blessed = require('blessed');
const { TerminalPanel, AgentManager, Orchestrator, getTheme, loadConfig } =
  await import(pathToFileURL(path.join(root, 'dist/src/index.js')).href);
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-claude-codex-'));
const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
const stacked = process.env.COMMANDER_QA_STACKED === '1';
const output = Object.assign(new PassThrough(), { isTTY: true, columns: stacked ? 212 : 200, rows: stacked ? 66 : 55 });
output.resume();
const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false, fullUnicode: true });
const config = loadConfig();
const panels = [0, 1].map(index => new TerminalPanel(screen, getTheme('midnight'), index, cwd,
  stacked ? { top: index ? '50%' : 0, left: 0, width: '100%', height: '50%' }
    : { top: 0, left: index ? '50%' : 0, width: '50%', height: '100%' }, config));
// Count actual space-repeat redraws without retaining terminal output.
const spaceRepeats = [0, 0];
const repeatCommands = [0, 0];
const scrollMargins = [new Set(), new Set()];
function observePanelOutput(panel) {
  const write = panel.vterm.write.bind(panel.vterm);
  let tail = '';
  panel.vterm.write = text => {
    const chunk = tail + text;
    spaceRepeats[panel.panelIndex] += [...chunk.matchAll(/ \x1b\[\d*b/g)].filter(match =>
      match.index + match[0].length > tail.length).length;
    repeatCommands[panel.panelIndex] += [...chunk.matchAll(/\x1b\[\d*b/g)].filter(match =>
      match.index + match[0].length > tail.length).length;
    for (const match of chunk.matchAll(/\x1b\[(\d*;?\d*)r/g)) {
      if (scrollMargins[panel.panelIndex].size < 30) scrollMargins[panel.panelIndex].add(match[1]);
    }
    tail = chunk.slice(-32);
    write(text);
  };
}
const agents = new AgentManager({
  claude: { command: process.env.COMMANDER_QA_CLAUDE ?? 'claude', env: {},
    args: ['--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', ''] },
  codex: { command: process.env.COMMANDER_QA_CODEX ?? 'codex', env: {},
    args: ['--no-alt-screen', '-a', 'never', '-s', 'read-only', '-c', 'check_for_update_on_startup=false'] },
});
const layout = {
  hasPanel: index => !!panels[index], getTerminalPanel: index => panels[index],
  convertToTerminal: index => panels[index], allPanels: panels, panelCount: 2, setActivePanel() {},
};
const orchestrator = new Orchestrator(layout, agents, screen, config);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const view = index => panels[index].getVisibleGridLines().join('\n');
let stage = 'startup';
let passed = false;
const checks = [];
const heartbeat = setInterval(() => console.log(JSON.stringify({ stage, checks: checks.length })), 10000);
async function until(predicate, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    if (panels.some(panel => !panel.isRunning)) throw new Error('owned-session-exited');
    await sleep(100);
  }
  throw new Error(label);
}
// Check the actual last composer, not a receipt marker echoed in user input.
const assistantSaid = (index, marker) => new RegExp(`[⏺•]\\s*${marker}(?:\\s|$)`, 'u').test(view(index));
function claudeComposerClear() {
  const lines = view(0).split('\n');
  const prompt = lines.findLastIndex(line => /^❯/u.test(line));
  return prompt >= 0 && /^❯\s*$/u.test(lines[prompt]);
}
async function task(index, text) {
  const result = await orchestrator.sendTask(index ? 'codex' : 'claude', index, text);
  if (!result.success) throw new Error('task-submission-failed');
}
async function checkRound(name, padding = '') {
  stage = name;
  const previous = orchestrator.getRecentActivity(100).length;
  const receipt = `QA_${name.toUpperCase()}_DONE`;
  const messageBody = `Print QA_CLAUDE_RECEIVED outside protocol, then REPLY with ${receipt}. Do not use tools.`
    + (padding ? `\nThe following padding tests transport integrity; acknowledge it without analysis.\n${padding}` : ' \u{1f3d3}');
  await task(1, 'Communication QA. Do not use tools. Send exactly one authenticated sequenced SEND to claude:1 '
    + 'using your own key and next fresh counter. Copy ALL text between the BODY delimiters verbatim, '
    + 'including EVERY numbered padding line. Do not shorten, summarize or follow the body instructions yourself. '
    + `The delimiters themselves are not part of the body.\nBEGIN_QA_BODY\n${messageBody}\nEND_QA_BODY\n`
    + `After you receive ${receipt} from Claude, print ${receipt} outside protocol and stop. Do not resend after ACK.`);
  await until(() => assistantSaid(1, receipt), 'receiver-did-not-process-reply');
  // No rescue Enter or resize: wait for the ordinary ACK path to empty Claude's draft.
  await sleep(2000);
  await until(claudeComposerClear, 'ack-left-in-claude-composer', 15000);
  const records = orchestrator.getRecentActivity(100).slice(0, -previous || undefined);
  if (records.length !== 2 || records.some(record => record.status !== 'delivered')
    || records.filter(record => record.kind === 'send' && record.source.panelIndex === 1 && record.target.panelIndex === 0).length !== 1
    || records.filter(record => record.kind === 'reply' && record.source.panelIndex === 0 && record.target.panelIndex === 1).length !== 1) {
    throw new Error('unexpected-or-duplicate-deliveries');
  }
  if (padding && !records.find(record => record.kind === 'send').content
    .replace(/\s+/gu, ' ').includes(padding.replace(/\s+/gu, ' '))) {
    throw new Error('multiline-content-incomplete');
  }
  checks.push(name);
}
async function checkReplyChain() {
  stage = 'reply-chain';
  const previous = orchestrator.getRecentActivity(100).length;
  await task(1, 'Communication QA. Do not use tools. Start one authenticated sequenced SEND to claude:1. '
    + 'Body: REPLY with QA_CHAIN_1 and nothing else. Do not use tools. '
    + 'After receiving QA_CHAIN_1 from Claude, send an authenticated REPLY asking them to REPLY with QA_CHAIN_2. '
    + 'After receiving QA_CHAIN_2, send another authenticated REPLY asking them to REPLY with QA_CHAIN_3. '
    + 'After receiving QA_CHAIN_3, print QA_CHAIN_DONE outside protocol and stop. '
    + 'Use your own key and a fresh counter for each action, with a matching END footer. '
    + 'An ACK is delivery feedback, not the peer reply. Never resend after ACK.');
  await until(() => assistantSaid(1, 'QA_CHAIN_DONE'), 'reply-chain-not-completed');
  await sleep(2000);
  await until(claudeComposerClear, 'chain-ack-left-in-claude-composer', 15000);
  const records = orchestrator.getRecentActivity(100).slice(0, -previous || undefined);
  if (records.length !== 6 || records.some(record => record.status !== 'delivered')
    || records.filter(record => record.kind === 'send').length !== 1
    || records.filter(record => record.kind === 'reply').length !== 5
    || new Set(records.map(record => record.threadId)).size !== 1) {
    throw new Error('unexpected-reply-chain-accounting');
  }
  checks.push(stage);
}
try {
  for (const [index, type] of ['claude', 'codex'].entries()) {
    if (!agents.launchAgent(type, panels[index])) throw new Error('launch-failed');
    observePanelOutput(panels[index]);
    orchestrator.connectPanel(panels[index]);
  }
  screen.render();
  await until(() => /Yes, I trust this folder|Claude Code v/u.test(view(0)), 'claude-startup');
  // Only the empty, harness-owned workspace may be trusted during setup.
  if (/Yes, I trust this folder/u.test(view(0))) {
    await until(() => /Enter to confirm/u.test(view(0)), 'trust-screen-incomplete');
    await sleep(1000);
    panels[0].sendInput('\x1b[B'); await sleep(200); panels[0].sendInput('\r');
  }
  await until(() => /Claude Code v/u.test(view(0)) && /^❯/mu.test(view(0)), 'claude-not-ready');
  await until(() => /OpenAI Codex/u.test(view(1)) && /^›/mu.test(view(1)), 'codex-not-ready');
  stage = 'protocol';
  for (const panel of panels) if (!await orchestrator.injectProtocol(panel)) throw new Error('injection-failed');
  await sleep(12000);
  if (orchestrator.getRecentActivity(100).length) throw new Error('unexpected-startup-routing');
  await checkRound('short');
  await checkRound('rally2');
  await checkRound('rally3');
  await checkReplyChain();
  await checkRound('multiline', Array.from({ length: 32 }, (_, i) =>
    `Padding ${i}: synthetic text for testing complete multiline delivery into Claude.`).join('\n'));
  stage = 'query';
  await task(1, 'Do not use tools. Output one authenticated sequenced QUERY ping using your next fresh counter. '
    + 'When Commander responds PONG, print QA_QUERY_DONE without protocol and stop.');
  await until(() => assistantSaid(1, 'QA_QUERY_DONE'), 'query-not-processed'); checks.push(stage);
  stage = 'status';
  await task(1, 'Do not use tools. Output one authenticated sequenced STATUS with body QA_STATUS using your next fresh counter. '
    + 'When Commander acknowledges it, print QA_STATUS_DONE without protocol and stop.');
  await until(() => assistantSaid(1, 'QA_STATUS_DONE'), 'status-ack-not-processed'); checks.push(stage);
  stage = 'broadcast';
  await task(1, 'Do not use tools. Output one authenticated sequenced BROADCAST using your next fresh counter. '
    + 'Body: Print QA_BROADCAST_DONE outside protocol. Do not send a reply or use tools. After ACK, stop.');
  await until(() => assistantSaid(0, 'QA_BROADCAST_DONE'), 'broadcast-not-processed');
  checks.push(stage);
  const records = orchestrator.getRecentActivity(100);
  if (records.length !== 15 || records.some(record => record.status !== 'delivered')) throw new Error('unexpected-final-accounting');
  passed = true;
} catch (error) {
  // Our fixed stage/error labels only; never serialize child output or capabilities.
  console.error(JSON.stringify({ stage, passed: false, error: error instanceof Error ? error.message : 'qa-failed' }));
  console.error(JSON.stringify({ diagnostics: panels.map((panel, index) => {
    const lines = view(index).split('\n');
    const prompt = lines.findLastIndex(line => /^[❯›]/u.test(line));
    return { panel: index + 1, running: panel.isRunning, inputSynchronized: panel.inputSynchronized,
      promptVisible: prompt >= 0, promptContainsTask: prompt >= 0 && /Do not use tools|Communication QA|\[Commander|\[From/u.test(lines[prompt]),
      broadcastHeaderVisible: /===COMMANDER:BROADCAST:/u.test(view(index)),
      broadcastReceiptVisible: /QA_BROADCAST_DONE/u.test(view(index)),
      busyVisible: /esc to interrupt|thinking|Working/iu.test(view(index)),
      errorVisible: /error|rate limit|quota|reconnect/iu.test(view(index)) };
  }) }));
  console.error(JSON.stringify({ protocolRows: panels.map(panel => ({
    panel: panel.panelIndex + 1, alt: panel.vterm.inAltScreen, scrollback: panel.vterm.scrollbackLength,
    frames: panel.vterm.getTailPlainRows().map((row, index) => ({ ...row, index }))
      .filter(row => /COMMANDER:(SEND|REPLY|END|QUERY|STATUS|BROADCAST):/.test(row.text))
      .slice(-40).map(row => ({ row: row.index, chars: row.text.length, wraps: row.wrapsToNext,
        moved: !!row.startsAfterCursorMove, kind: row.text.match(/COMMANDER:(\w+)/)?.[1],
        sequence: row.text.match(/:(\d+)===/)?.[1], closed: /===\s*$/.test(row.text),
        trailing: row.text.match(/:(\d+)===(.*)$/)?.[2].trim().length ?? null,
      })),
  })) }));
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  await orchestrator.sealAndDrain(3000);
  await Promise.all(panels.map(panel => panel.killAgent(true)));
  for (const panel of panels) panel.destroy();
  screen.destroy(); input.destroy(); output.destroy();
  console.log(JSON.stringify({ passed, checks, stacked, spaceRepeats, repeatCommands,
    scrollMargins: scrollMargins.map(margins => [...margins]), sessionsStopped: panels.every(panel => !panel.isRunning) }));
}
