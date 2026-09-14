// Opt-in real APEX acceptance. NEVER runs as part of offline verification.
// This harness never writes raw model/terminal content; output is metadata only.
// OpenCode itself retains its normal private history, which this opt-in test
// reads only for its own fresh CWD/sessions to independently prove receipt.
if (process.env.COMMANDER_LIVE_APEX !== '1') {
  console.error('Live APEX QA is disabled. Set COMMANDER_LIVE_APEX=1 only with provider-use authorization.');
  process.exit(2);
}
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error('Live APEX QA requires Node.js 22 or newer.');
  process.exit(2);
}
const { default: fs } = await import('node:fs/promises');
const { default: os } = await import('node:os');
const { default: path } = await import('node:path');
const { PassThrough } = await import('node:stream');
const { createHash } = await import('node:crypto');
const { execFile } = await import('node:child_process');
const { createRequire, syncBuiltinESMExports } = await import('node:module');
const { promisify } = await import('node:util');
const { fileURLToPath, pathToFileURL } = await import('node:url');
const { DatabaseSync } = await import('node:sqlite');

const root = fileURLToPath(new URL('../../', import.meta.url));
const packageRoot = process.env.COMMANDER_QA_PACKAGE_ROOT ? path.resolve(process.env.COMMANDER_QA_PACKAGE_ROOT) : root;
const require = createRequire(path.join(packageRoot, 'package.json'));
const childProcessModule = require('node:child_process');
const originalSpawn = childProcessModule.spawn;
const launchEnvironments = [];
let verifiedLaunches = 0;
let launchSafetyRejected = false;
childProcessModule.spawn = (command, args, options) => {
  if (args?.some(arg => typeof arg === 'string' && /(?:^|\/)pty-helper\.py$/u.test(arg))) {
    let plugins = [];
    let launchConfig;
    try { launchConfig = JSON.parse(options.env.OPENCODE_CONFIG_CONTENT ?? '{}'); plugins = launchConfig.plugin ?? []; }
    catch { launchSafetyRejected = true; throw new Error('profile-rejected'); }
    // A saved profile.env merges after process.env. Verify the FINAL real-child
    // environment rather than assuming our outer-process safety flags survive.
    if (!launchConfig.permission || typeof launchConfig.permission !== 'object' || Array.isArray(launchConfig.permission)
      || Object.keys(launchConfig.permission).length !== 1 || launchConfig.permission['*'] !== 'deny'
      || launchConfig.share !== 'disabled' || launchConfig.autoupdate !== false) {
      launchSafetyRejected = true; throw new Error('profile-rejected');
    }
    launchEnvironments.push({ pluginConfigured: Array.isArray(plugins) && plugins.some(item => typeof item === 'string'
      && item.startsWith('file:') && item.endsWith('/opencode-protocol-plugin.js')),
      tokenConfigured: /^[A-Za-z0-9_-]{43}$/u.test(options.env.AGENTS_COMMANDER_OPENCODE_TOKEN ?? ''),
      fdConfigured: options.env.AGENTS_COMMANDER_OPENCODE_FD === '4',
      fifthDescriptorConfigured: options.stdio?.length === 5 });
    const child = originalSpawn(command, args, options);
    if (child.pid) verifiedLaunches++;
    return child;
  }
  return originalSpawn(command, args, options);
};
syncBuiltinESMExports();
const blessed = require('blessed');
const { App, VTerm, loadConfig, discoverAgents, ProtocolScanner } = await import(pathToFileURL(path.join(packageRoot, 'dist/src/index.js')).href);
const execFileAsync = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (value, reason) => { if (!value) throw new Error(reason); };
const cols = 351, rows = 74, count = Number(process.env.COMMANDER_QA_PANEL_COUNT ?? 6);
check(count === 6 || count === 16, 'profile-rejected');
const expectNative = process.env.COMMANDER_QA_LEGACY_BASELINE !== '1';
const stressEnabled = process.env.COMMANDER_QA_STRESS === '1';
let baselinePassed = false, stressPassed = !stressEnabled;
const started = Date.now();
const workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'commander-apex-matrix-')));
await fs.chmod(workspace, 0o700);
const configPath = path.join(os.homedir(), '.agents-commander/config.json');
const configDigest = async () => createHash('sha256').update(await fs.readFile(configPath)).digest('hex');
const beforeDigest = await configDigest();
const config = loadConfig();
const agents = discoverAgents(config.agents, config.agentProfiles);
const profileIndex = agents.findIndex(agent => agent.profileId === 'opencode');
const profile = agents[profileIndex];
check(profile?.installed && profile.supported && profile.type === 'opencode'
  && /apex/iu.test(`${profile.profileLabel} ${profile.model ?? ''}`), 'profile-rejected');
check(!profile.args.some(arg => /^(?:--smoke|--print|--prompt|--resume|--continue|--session)(?:=|$)/u.test(arg))
  && !profile.args.includes('run'), 'profile-rejected');
process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { '*': 'deny' }, share: 'disabled', autoupdate: false });
const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
const output = Object.assign(new PassThrough(), { isTTY: true, columns: cols, rows });
const screenTerm = new VTerm(cols, rows);
output.on('data', bytes => screenTerm.write(bytes.toString('utf8')));
const originalScreen = blessed.screen;
blessed.screen = options => originalScreen({ ...options, input, output, terminal: 'xterm-256color' });
const app = new App(workspace, { panels: count, density: 'auto', codexMicro: false, codexMicroDecisions: false });
const db = new DatabaseSync(path.join(os.homedir(), '.local/share/opencode/opencode.db'), { readOnly: true });
const owned = new Map();
const sessionIds = new Map();
const sessionVersions = new Map();
const events = [];
const feedback = [];
const trials = [];
const wirePastes = new Map();
let naturalQuitPassed = false;
let stage = 'startup', failure = null, resizeEvents = 0, inputWrites = 0, trackingFailure = false, launchedCount = 0;
const view = () => screenTerm.getGridPlainLines().join('\n');
const panels = () => app.layout?.allPanels.filter(panel => panel.vterm) ?? [];
const activity = () => [...(app.orchestrator?.getRecentActivity(1000) ?? [])].reverse();
const body = panel => panel.vterm.getGridPlainLines().join('\n');
const ready = panel => /ctrl\+p commands/u.test(body(panel)) && !/esc[^\n]*interrupt/iu.test(body(panel));
const write = bytes => { inputWrites++; input.write(bytes); };
// Strictly reduce all evidence before logging; never accept arbitrary strings.
const stringEnums = new Set(['startup','welcome','dismiss-welcome','focus','picker','launch','prompt','protocol-picker',
  'protocol-selection','protocol-confirmation','protocol-submit','protocol-ready','session-map','trial-ready','trial-running',
  'cleanup','complete','heartbeat','trial','final','deadline','profile-rejected','picker-mismatch','session-map-failed',
  'unexpected-startup-route','tracking-failed','private-error-withheld','metadata-rejected',
  'send-short','reply-short','reply-long','broadcast-short','send-long','broadcast-long','send-markdown','broadcast-markdown',
  'query-ping','query-agents','query-panels','query-status','query-help','status-short','simultaneous',
  'reply-latest','reply-previous','broadcast-hidden','send-reordered','send-after-resize','reorder','fullscreen','resize','natural-quit',
  'send','reply','broadcast','status','query','queued','delivered','failed','timed_out','dropped',
  'SEND','REPLY','BROADCAST','STATUS','QUERY','END']);
const keys = new Set(['event','stage','elapsedSeconds','trial','passed','failure','panels','panel','columns','rows','running',
  'ready','layoutBlocked','alt','routeCount','events','kind','source','target','status','contentBytes','exactBody',
  'expectedTargets','deliveredTargets','sourceComplete','sourceFrames','sourceValid','sourceBodyExact','sourceFooterPresent',
  'headerVisible','footerVisible','renderedFrames','renderedBodyExact','newRoutes','newEvents','latencyMs','sameThread',
  'receivedByTarget','expectedReceiveCount','actualReceiveCount','sourceReadOnly','sourceOwnedOnly','resizeEvents','inputWrites','transportLatencyMs',
  'inputDuringPending','resizeDuringPending','captureOff','globalConfigUnchanged','ownedProcessesStopped','realAgentPTYs',
  'toolsDenied','rawOutputPrinted','rawOutputRecorded','trialResults','sourceMessages','replayedRoutes','liveTrialsCompleted',
  'sourceSequenceValid','sourceCapabilityValid','responseSubmitted','observedFeedback','expectedFeedback','generationErrors',
  'channelPresent','channelReady','channelBound','promptedBodyExact','promptedBodyBytes','promptedReplacementCharacters','sourceEqualsPromptedBody',
  'launchEnvironments','pluginConfigured','tokenConfigured','fdConfigured','fifthDescriptorConfigured',
  'channelConnecting','channelFailed','ownedDescriptorMetadata','processCount','fd4Open','directChild',
  'stressResults','baselinePassed','stressPassed','distinctThreads','stableIdentities','hiddenTargets','visiblePanels',
  'wireBodyExactCount','receiverAddedOneSpaceCount','receiverByteExactCount','knownOpenCodePasteBehavior','naturalQuitPassed','channelOpenBeforeQuit']);
function guard(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  if (typeof value === 'string') return stringEnums.has(value);
  if (Array.isArray(value)) return value.every(guard);
  return typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Object.entries(value).every(([key, item]) => keys.has(key) && guard(item));
}
function report(value) { check(guard(value), 'metadata-rejected'); console.log(JSON.stringify(value)); }
function panelMetadata() { return panels().map(panel => ({ panel: panel.panelIndex + 1, columns: panel.vterm.colCount,
  rows: panel.vterm.getGridPlainLines().length, running: panel.isRunning, ready: ready(panel), layoutBlocked: panel.protocolLayoutBlocked,
  alt: panel.vterm.inAltScreen, channelPresent: !!panel.openCodeChannel,
  channelReady: panel.getProtocolSetupError?.() === null,
  channelBound: !!panel.openCodeChannel?.sessionID && panel.openCodeChannel?.status === null,
  channelConnecting: panel.openCodeChannel?.status === 'connecting',
  channelFailed: panel.openCodeChannel?.closed === true })); }
async function processTable() {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart='], { timeout: 3000 });
  const table = new Map();
  for (const line of stdout.trim().split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/u);
    if (match) table.set(Number(match[1]), { pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), state: match[4], started: match[5] });
  }
  return table;
}
const same = (a, b) => a && b && a.pid === b.pid && a.started === b.started && a.group === b.group;
async function collectOwned() {
  const table = await processTable();
  const owners = new Set([process.pid, ...[...owned.values()].filter(row => same(row, table.get(row.pid))).map(row => row.pid)]);
  let changed;
  do { changed = false; for (const row of table.values()) if (!owners.has(row.pid) && owners.has(row.parent)) {
    owned.set(row.pid, row); owners.add(row.pid); changed = true;
  } } while (changed);
}
async function remainingOwned() {
  const table = await processTable();
  return [...owned.values()].filter(row => same(row, table.get(row.pid)) && !table.get(row.pid).state.startsWith('Z'));
}
let collecting = Promise.resolve();
const tracker = setInterval(() => { collecting = collecting.then(collectOwned).catch(() => { trackingFailure = true; }); }, 150);
const heartbeat = setInterval(() => report({ event: 'heartbeat', stage, elapsedSeconds: Math.round((Date.now() - started) / 1000),
  panels: panelMetadata(), routeCount: activity().length }), 15000);
async function waitFor(predicate, nextStage, timeout = 30000) {
  stage = nextStage;
  const deadline = Date.now() + timeout;
  while (!predicate()) { check(!trackingFailure, 'tracking-failed'); check(!launchSafetyRejected, 'profile-rejected');
    if (Date.now() >= deadline) throw new Error('deadline'); await delay(35); }
}
async function focus(index) {
  for (let attempt = 0; app.layout.activePanel.panelIndex !== index && attempt < count; attempt++) { write('\t'); await delay(80); }
  await waitFor(() => app.layout.activePanel.panelIndex === index, 'focus');
}
async function submit(index, text) {
  await focus(index); await waitFor(() => ready(panels().find(panel => panel.panelIndex === index)), 'trial-ready');
  write(`\x1b[200~${text}\x1b[201~\r`);
}
function ownedParts() {
  // The SQL predicate admits only sessions created for this exact mkdtemp CWD.
  return db.prepare(`SELECT p.session_id, p.message_id, s.version AS opencode_version, m.data AS message_data, p.data AS part_data, m.time_created
    FROM session s JOIN message m ON m.session_id=s.id JOIN part p ON p.message_id=m.id
    WHERE s.directory=? AND s.time_created>=? ORDER BY m.time_created,m.id,p.id`).all(workspace, started - 1000)
    .map(row => ({ ...row, message: JSON.parse(row.message_data), part: JSON.parse(row.part_data) }));
}
function mapSessions() {
  const records = ownedParts();
  for (const panel of panels()) {
    const matching = records.filter(row => row.message.role === 'user' && row.part.type === 'text'
      && row.part.text?.includes(panel.protocolCapability));
    const ids = new Set(matching.map(row => row.session_id));
    if (ids.size === 1) {
      sessionIds.set(panel.panelIndex, [...ids][0]);
      const versions = new Set(matching.map(row => row.opencode_version));
      if (versions.size === 1) sessionVersions.set(panel.panelIndex, [...versions][0]);
    }
  }
  return sessionIds.size === count;
}
function sourceMessages(index, since) {
  const grouped = new Map();
  for (const row of ownedParts()) if (row.session_id === sessionIds.get(index) && row.message.role === 'assistant' && row.time_created >= since) {
    const item = grouped.get(row.message_id) ?? { text: '', completed: !!row.message.time?.completed, errors: !!row.message.error };
    if (row.part.type === 'text') item.text += row.part.text ?? '';
    grouped.set(row.message_id, item);
  }
  return [...grouped.values()];
}
function parseSource(text, panel) {
  const parsed = [];
  const scanner = new ProtocolScanner(panel.panelIndex, 'opencode', message => parsed.push(message), { logPotentialMarkers: false });
  scanner.setProtocolCapability(panel.protocolCapability);
  scanner.feed(text + '\n');
  scanner.dispose?.();
  return parsed;
}
function storedUserText(part) {
  if (part.type === 'text') return typeof part.text === 'string' ? part.text : null;
  // Inline plaintext attachments are read in memory only. Never fetch a URL or
  // read a path supplied by a model/session record, even for this owned session.
  if (part.type === 'file' && part.mime === 'text/plain' && typeof part.url === 'string'
    && /^data:text\/plain;base64,[A-Za-z0-9+/]*={0,2}$/u.test(part.url) && part.url.length < 1024 * 1024) {
    const encoded = part.url.slice('data:text/plain;base64,'.length);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') === encoded) return bytes.toString('utf8');
  }
  return null;
}
function receiptEvidence(index, expected, since) {
  const wires = (wirePastes.get(index) ?? []).filter(record => record.at >= since
    && /^\[(?:From |Broadcast from )/u.test(record.text)
    && record.text.slice(record.text.indexOf(']: ') + 3) === expected);
  let exact = 0, separator = 0;
  for (const row of ownedParts()) {
    if (row.session_id !== sessionIds.get(index) || row.message.role !== 'user' || row.time_created < since) continue;
    const stored = storedUserText(row.part);
    if (stored === null) continue;
    if (wires.some(wire => stored === wire.text)) { exact++; continue; }
    // OpenCode 1.18.30 inserts a virtual paste-summary label plus ONE separator
    // space for >=3 lines or >150 chars. Submission expands the label without
    // removing its separator. Compare the COMPLETE real wire envelope/body; do
    // not trim, normalize internal whitespace, or accept this on other versions.
    // https://github.com/anomalyco/opencode/blob/v1.18.30/packages/tui/src/component/prompt/index.tsx#L1149-L1158
    // https://github.com/anomalyco/opencode/blob/v1.18.30/packages/tui/src/component/prompt/index.tsx#L1183-L1212
    // https://github.com/anomalyco/opencode/blob/v1.18.30/packages/tui/src/component/prompt/index.tsx#L1026-L1034
    // https://github.com/anomalyco/opencode/blob/v1.18.30/packages/tui/src/prompt/part.ts#L24-L28
    if (sessionVersions.get(index) === '1.18.30' && wires.some(wire =>
      (wire.text.split('\n').length >= 3 || wire.text.length > 150) && stored === wire.text + ' ')) separator++;
  }
  return { wire: wires.length, exact, separator, total: exact + separator };
}
function receivedExact(index, expected, since) { return receiptEvidence(index, expected, since).total; }
function installWireObserver(panel) {
  const writes = [];
  wirePastes.set(panel.panelIndex, writes);
  let pending = '';
  const original = panel.sendInput.bind(panel);
  panel.sendInput = (text, ...args) => {
    const accepted = original(text, ...args);
    if (!accepted || typeof text !== 'string') return accepted;
    pending += text;
    if (Buffer.byteLength(pending) > 1024 * 1024) { pending = ''; return accepted; }
    for (;;) {
      const start = pending.indexOf('\x1b[200~');
      if (start < 0) { pending = pending.slice(-5); break; }
      if (start > 0) pending = pending.slice(start);
      const end = pending.indexOf('\x1b[201~', 6);
      if (end < 0) break;
      writes.push({ at: Date.now(), text: pending.slice(6, end) });
      if (writes.length > 100) writes.shift();
      pending = pending.slice(end + 6);
    }
    return accepted;
  };
}
function wireExact(index, expected, since) {
  return (wirePastes.get(index) ?? []).filter(record => record.at >= since
    && /^\[(?:From |Broadcast from )/u.test(record.text)
    && record.text.slice(record.text.indexOf(']: ') + 3) === expected).length;
}
function matchesFeedback(spec, text) {
  if (!spec.feedback?.test(text)) return false;
  if (spec.id === 'query-agents') return Array.from({ length: count }, (_, index) => index + 1)
    .every(number => text.includes(`SEND address opencode:${number} — running`));
  if (spec.id === 'query-panels') return Array.from({ length: count }, (_, index) => index + 1)
    .every(number => text.includes(`Panel ${number}: opencode (running) — SEND address opencode:${number}`));
  if (spec.id === 'query-help') return ['SEND:<type>:<panel>', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY']
    .every(command => text.includes(command));
  if (spec.id === 'query-status') return text.includes(`[Panel ${spec.source + 1}]: running`);
  if (spec.id === 'status-short') return text.includes(`text="${spec.body}"`);
  return true;
}
function inspectTrial(spec, since, routeStart, eventStart, feedbackStart, sentAt, writesAt, resizesAt) {
  const panel = panels().find(item => item.panelIndex === spec.source);
  const messages = sourceMessages(spec.source, since);
  const texts = messages.map(item => item.text);
  const parsed = texts.flatMap(text => parseSource(text, panel)).filter(item => item.type === spec.kind);
  const routes = activity().slice(routeStart);
  const emitted = events.slice(eventStart).filter(item => item.type === spec.kind && item.sourcePanel === spec.source);
  const delivered = routes.filter(item => item.kind === spec.kind && item.status === 'delivered' && item.content === spec.body);
  const naturalFrameAt = emitted.find(item => item.content === spec.body)?.observedAt;
  const transportLatencyMs = naturalFrameAt !== undefined && delivered.length
    ? Math.max(0, ...delivered.map(item => item.updatedAt - naturalFrameAt)) : null;
  const evidence = spec.targets.map(index => receiptEvidence(index, spec.body, since));
  const received = evidence.map(item => item.total);
  const wireBodyExactCount = evidence.reduce((sum, item) => sum + item.wire, 0);
  const receiverAddedOneSpaceCount = evidence.reduce((sum, item) => sum + item.separator, 0);
  const receiverByteExactCount = evidence.reduce((sum, item) => sum + item.exact, 0);
  const feedbackMatches = feedback.slice(feedbackStart).filter(item => item.panel === spec.source && matchesFeedback(spec, item.text)).length;
  const feedbackReceived = spec.feedback ? ownedParts().some(row => row.session_id === sessionIds.get(spec.source)
    && row.message.role === 'user' && row.time_created >= since && row.part.type === 'text' && matchesFeedback(spec, row.part.text ?? '')) : false;
  const sourceComplete = messages.some(item => item.completed && item.text.includes('===COMMANDER:'));
  const sourceBodyExact = parsed.some(item => item.content === spec.body);
  const ownPrompt = ownedParts().find(row => row.session_id === sessionIds.get(spec.source) && row.message.role === 'user'
    && row.time_created >= since && row.part.type === 'text' && row.part.text?.includes('PAYLOAD_START\n'))?.part.text ?? '';
  const promptedBody = ownPrompt.split('PAYLOAD_START\n')[1]?.split('\nPAYLOAD_STOP')[0] ?? '';
  const priorSend = spec.kind === 'reply' ? activity().slice(0, routeStart).findLast(item => item.kind === 'send'
    && item.source.panelIndex === spec.targets[0] && item.target.panelIndex === spec.source) : null;
  const sameThread = spec.kind !== 'reply' || delivered.some(item => item.threadId === priorSend?.threadId
    && item.replyToMessageId === priorSend?.messageId);
  const expectedReceiveCount = spec.targets.length;
  const actualReceiveCount = received.reduce((sum, n) => sum + n, 0);
  const passed = sourceBodyExact && emitted.some(item => item.content === spec.body)
    && (expectedReceiveCount ? delivered.length === expectedReceiveCount && received.every(n => n === 1)
      && wireBodyExactCount === expectedReceiveCount : feedbackMatches >= 1 && feedbackReceived)
    && sameThread && inputWrites === writesAt && resizeEvents === resizesAt;
  return { event: 'trial', trial: spec.id, kind: spec.kind, source: spec.source + 1, passed,
    sourceComplete, sourceMessages: messages.length, sourceFrames: parsed.length, sourceBodyExact,
    promptedBodyExact: promptedBody === spec.body, promptedBodyBytes: Buffer.byteLength(promptedBody),
    promptedReplacementCharacters: [...promptedBody].filter(char => char === '\uFFFD').length,
    sourceEqualsPromptedBody: parsed.some(item => item.content === promptedBody),
    sourceFooterPresent: texts.some(text => text.includes('===COMMANDER:END:')),
    generationErrors: messages.filter(item => item.errors).length,
    headerVisible: body(panel).includes(`COMMANDER:${spec.kind.toUpperCase()}:`), footerVisible: body(panel).includes('COMMANDER:END:'),
    contentBytes: Buffer.byteLength(spec.body), newEvents: emitted.length, newRoutes: routes.length,
    expectedTargets: spec.targets.map(n => n + 1), deliveredTargets: delivered.map(item => item.target.panelIndex + 1),
    expectedReceiveCount, actualReceiveCount, wireBodyExactCount, receiverAddedOneSpaceCount, receiverByteExactCount,
    knownOpenCodePasteBehavior: spec.targets.every(index => sessionVersions.get(index) === '1.18.30'),
    receivedByTarget: received.map((n,index) => ({ target: spec.targets[index] + 1, actualReceiveCount: n })),
    observedFeedback: feedbackMatches, expectedFeedback: spec.feedback ? 1 : 0, responseSubmitted: feedbackReceived, sameThread,
    latencyMs: Date.now() - sentAt, transportLatencyMs,
    inputDuringPending: inputWrites - writesAt, resizeDuringPending: resizeEvents - resizesAt };
}
async function trial(spec) {
  await focus(spec.source);
  await waitFor(() => panels().every(ready), 'trial-ready', 45000);
  const since = Date.now(), routeStart = activity().length, eventStart = events.length, feedbackStart = feedback.length;
  const command = spec.kind === 'send' ? `SEND to exact adapter opencode in stable panel ${spec.targets[0] + 1}` : spec.kind.toUpperCase();
  const task = `Transport acceptance only. Emit exactly one Commander ${command} frame using your current capability and a NEW positive sequence, copied identically into header and END footer. The ENTIRE body is the content between PAYLOAD_START and PAYLOAD_STOP below; neither label belongs in the body. Copy every line byte-for-byte; do not summarize or reformat. No prose outside the frame. Do not use tools. Do not emit any subsequent protocol frame in response to ACK or a received message.\nPAYLOAD_START\n${spec.body}\nPAYLOAD_STOP`;
  write(`\x1b[200~${task}\x1b[201~\r`);
  const sentAt = Date.now(), writesAt = inputWrites, resizesAt = resizeEvents;
  stage = 'trial-running';
  let result;
  const deadline = sentAt + 90000;
  do {
    await delay(500);
    result = inspectTrial(spec, since, routeStart, eventStart, feedbackStart, sentAt, writesAt, resizesAt);
    if (result.passed) break;
    // A finished valid source frame without delivery remains untouched for a
    // bounded 15s evidence window; there is no resize, scroll or auto-repair.
    if (result.sourceComplete && Date.now() - sentAt > 20000 && panels().every(ready)) break;
  } while (Date.now() < deadline);
  trials.push(result); report(result);
  await delay(2500);
  return result;
}
const stressResults = [];
async function runStress(longBody) {
  await waitFor(() => panels().every(ready), 'trial-ready', 45000);
  const target = count - 1;
  const specs = [1,2].map(source => ({ source, body: `APEX_SIMULTANEOUS_FROM_P${source + 1}_EXACT_20260914` }));
  const since = Date.now(), routeStart = activity().length;
  for (const spec of specs) await submit(spec.source,
    `Send exactly one Commander SEND to exact adapter opencode in stable panel ${target + 1}. Entire body exactly ${spec.body}. Use current capability and NEW matching positive sequence in header and END. Do not use tools. After ACK or messages do not emit further protocol frames.`);
  const sentAt = Date.now(), writesAt = inputWrites, resizesAt = resizeEvents;
  let exactRoutes = [];
  let sourceValid = false;
  let actualReceiveCount = 0;
  let simultaneousReceipts = [];
  const deadline = sentAt + 90000;
  do {
    await delay(500);
    exactRoutes = activity().slice(routeStart).filter(record => record.status === 'delivered' && record.kind === 'send'
      && record.target.panelIndex === target && specs.some(spec => spec.source === record.source.panelIndex && spec.body === record.content));
    sourceValid = specs.every(spec => sourceMessages(spec.source, since)
      .flatMap(message => parseSource(message.text, panels().find(panel => panel.panelIndex === spec.source)))
      .some(message => message.type === 'send' && message.content === spec.body));
    simultaneousReceipts = specs.map(spec => receiptEvidence(target, spec.body, since));
    actualReceiveCount = simultaneousReceipts.reduce((sum, item) => sum + item.total, 0);
    if (exactRoutes.length === 2 && simultaneousReceipts.every(item => item.total === 1 && item.wire === 1) && sourceValid) break;
  } while (Date.now() < deadline);
  const simultaneous = { event: 'trial', trial: 'simultaneous', kind: 'send', source: [2,3],
    passed: exactRoutes.length === 2 && activity().length === routeStart + 2
      && simultaneousReceipts.every(item => item.total === 1 && item.wire === 1) && sourceValid
      && new Set(exactRoutes.map(record => record.threadId)).size === 2 && inputWrites === writesAt && resizeEvents === resizesAt,
    distinctThreads: new Set(exactRoutes.map(record => record.threadId)).size === 2, sourceValid,
    expectedReceiveCount: 2, actualReceiveCount, newRoutes: activity().length - routeStart,
    wireBodyExactCount: simultaneousReceipts.reduce((sum, item) => sum + item.wire, 0),
    receiverAddedOneSpaceCount: simultaneousReceipts.reduce((sum, item) => sum + item.separator, 0),
    receiverByteExactCount: simultaneousReceipts.reduce((sum, item) => sum + item.exact, 0),
    transportLatencyMs: exactRoutes.length === 2 ? Math.max(0, ...exactRoutes.map(record => record.updatedAt
      - (events.find(item => item.sourcePanel === record.source.panelIndex && item.content === record.content)?.observedAt ?? record.updatedAt))) : null,
    inputDuringPending: inputWrites - writesAt, resizeDuringPending: resizeEvents - resizesAt, latencyMs: Date.now() - sentAt };
  stressResults.push(simultaneous); report(simultaneous); if (!simultaneous.passed) return false;
  // Sender arrival order can differ; the last actually delivered message owns
  // the newest open reply window. Assert its original message/thread identity.
  const byDelivery = [...exactRoutes].sort((a,b) => a.updatedAt - b.updatedAt);
  for (const [index, original] of [...byDelivery].reverse().entries()) {
    const result = await trial({ id: index ? 'reply-previous' : 'reply-latest', kind: 'reply', source: target,
      targets: [original.source.panelIndex], body: `APEX_CONCURRENT_REPLY_${index + 1}_20260914` });
    if (!result.passed) return false;
  }
  await waitFor(() => panels().every(ready), 'trial-ready', 45000);
  const identities = new Map(panels().map(panel => [panel.panelIndex, { panel, pid: panel.proc?.pid, cap: panel.protocolCapability }]));
  const beforeMove = activity().length;
  await focus(1); write('\x1b[18~');
  await waitFor(() => view().includes('New position') && view().includes('Protocol ID stays P2'), 'reorder');
  write('\x7f'); write(String(count)); write('\r');
  await waitFor(() => app.layout.getWorkspacePosition(1) === count, 'reorder'); await delay(2500);
  const stableIdentities = panels().every(panel => identities.get(panel.panelIndex)?.panel === panel
    && identities.get(panel.panelIndex)?.pid === panel.proc?.pid && identities.get(panel.panelIndex)?.cap === panel.protocolCapability);
  const reordered = { event: 'trial', trial: 'reorder', passed: stableIdentities && activity().length === beforeMove,
    stableIdentities, replayedRoutes: activity().length - beforeMove };
  stressResults.push(reordered); report(reordered); if (!reordered.passed) return false;
  if (!(await trial({ id: 'send-reordered', kind: 'send', source: 0, targets: [1], body: 'APEX_STABLE_P2_AFTER_REORDER_20260914' })).passed) return false;
  await focus(0); const beforeFull = activity().length; write('\x1bOS');
  await waitFor(() => app.layout.visiblePanelIds.length === 1, 'fullscreen'); await delay(2500);
  const fullscreen = { event: 'trial', trial: 'fullscreen', passed: activity().length === beforeFull,
    visiblePanels: app.layout.visiblePanelIds.length, hiddenTargets: count - 1, replayedRoutes: activity().length - beforeFull };
  stressResults.push(fullscreen); report(fullscreen); if (!fullscreen.passed) return false;
  if (!(await trial({ id: 'broadcast-hidden', kind: 'broadcast', source: 0,
    targets: Array.from({ length: count - 1 }, (_, index) => index + 1), body: longBody + '\nHidden-recipient acceptance.' })).passed) return false;
  await waitFor(() => panels().every(ready), 'trial-ready', 45000);
  write('\x1bOS'); await delay(2500);
  const beforeResize = activity().length;
  for (const nextCols of [213,351]) { output.columns = nextCols; screenTerm.resize(nextCols, rows); output.emit('resize'); await delay(3500); }
  const resized = { event: 'trial', trial: 'resize', passed: activity().length === beforeResize,
    replayedRoutes: activity().length - beforeResize };
  stressResults.push(resized); report(resized); if (!resized.passed) return false;
  return (await trial({ id: 'send-after-resize', kind: 'send', source: 0, targets: [1], body: 'APEX_FRESH_AFTER_RESIZE_20260914' })).passed;
}
try {
  const startup = app.run();
  await waitFor(() => view().includes('Multi-Agent Terminal Manager'), 'welcome');
  write(' '); await waitFor(() => !view().includes('Multi-Agent Terminal Manager'), 'dismiss-welcome'); await startup;
  app.screen.on('resize', () => { resizeEvents++; });
  const originalFeedback = app.orchestrator.sendInfoToPanel.bind(app.orchestrator);
  app.orchestrator.sendInfoToPanel = (index, text, ...args) => { feedback.push({ panel: index, text }); return originalFeedback(index, text, ...args); };
  const originalHandleMessage = app.orchestrator.handlePanelAgentMessage.bind(app.orchestrator);
  app.orchestrator.handlePanelAgentMessage = (panel, message, ...args) => {
    events.push({ ...message, sourcePanel: panel.panelIndex, observedAt: Date.now() });
    return originalHandleMessage(panel, message, ...args);
  };
  for (let index = 0; index < count; index++) {
    await focus(index); write('\x1bOQ'); await waitFor(() => view().includes('Launch Agent (F2)'), 'picker');
    for (let cursor = 0; cursor < profileIndex; cursor++) { write('\x1b[B'); await delay(60); }
    check(app.screen.focused?.getItem?.(app.screen.focused.selected)?.getText?.().includes(profile.profileLabel), 'picker-mismatch');
    write('\r'); await waitFor(() => panels().length === index + 1, 'launch');
    const panel = panels().find(item => item.panelIndex === index);
    if (panel.proc?.pid) launchedCount++;
    installWireObserver(panel);
    await waitFor(() => panel.isRunning && ready(panel), 'prompt', 45000);
    if (expectNative) await waitFor(() => panel.openCodeChannel
      && panel.getProtocolSetupError() === null, 'prompt', 45000);
  }
  write('\x1bOQ'); await waitFor(() => view().includes('Launch Agent (F2)'), 'protocol-picker');
  write('p'); await waitFor(() => view().includes('Choose running sessions.'), 'protocol-selection');
  write('a'); await delay(100); write('\r'); await waitFor(() => view().includes('Enable Commander Protocol'), 'protocol-confirmation');
  write('\t'); await delay(80); write('\r');
  await waitFor(() => panels().every(panel => panel.protocolCapability), 'protocol-submit', 90000);
  await delay(10000); await waitFor(() => panels().every(ready), 'protocol-ready', 45000);
  if (expectNative) await waitFor(() => panels().every(panel => panel.openCodeChannel?.sessionID
    && panel.openCodeChannel.status === null), 'protocol-ready', 15000);
  await waitFor(mapSessions, 'session-map', 10000);
  check(activity().length === 0, 'unexpected-startup-route');
  for (let index = 0; index < count; index++) {
    await submit(index, `This is an isolated communication transport check, not a coding task. Never use tools. For all incoming Commander messages or broadcasts, say RECEIVED as ordinary text only; never send a protocol reply unless a later local user prompt explicitly asks for REPLY. Never emit a protocol frame to acknowledge Commander ACK, QUERY results, or setup. For this setup only say READY.`);
    await delay(1200);
  }
  await delay(6000); await waitFor(() => panels().every(ready), 'trial-ready', 45000);
  report({ event: 'heartbeat', stage, panels: panelMetadata(), sourceReadOnly: true, sourceOwnedOnly: true, captureOff: app.capture.mode === 'off' });
  const peers = Array.from({ length: count - 1 }, (_, index) => index + 1);
  await trial({ id: 'send-short', kind: 'send', source: 0, targets: [1], body: 'APEX_MATRIX_SHORT_SEND_20260914' });
  await trial({ id: 'reply-short', kind: 'reply', source: 1, targets: [0], body: 'APEX_MATRIX_SHORT_REPLY_20260914' });
  await trial({ id: 'broadcast-short', kind: 'broadcast', source: 0, targets: peers, body: 'APEX_MATRIX_SHORT_BROADCAST_20260914' });
  for (const query of ['ping','agents','panels','status','help']) {
    const patterns = { ping: /^\[Commander\] PONG$/u, agents: /Running agents:/u, panels: new RegExp(`Panel layout \\(${count} panels\\)`, 'u'),
      status: /Status for/u, help: /Available protocol commands:/u };
    await trial({ id: `query-${query}`, kind: 'query', source: 0, targets: [], body: query, feedback: patterns[query] });
  }
  await trial({ id: 'status-short', kind: 'status', source: 0, targets: [], body: 'APEX_MATRIX_STATUS_20260914', feedback: /kind=status status=accepted/u });
  const longBody = Array.from({ length: 42 }, (_, index) => `Line ${String(index + 1).padStart(2,'0')}: APEX transport acceptance payload; preserve every line exactly; no tools or files.`).join('\n');
  await trial({ id: 'send-long', kind: 'send', source: 0, targets: [1], body: longBody });
  await trial({ id: 'reply-long', kind: 'reply', source: 1, targets: [0], body: longBody });
  await trial({ id: 'broadcast-long', kind: 'broadcast', source: 0, targets: peers, body: longBody });
  const markdown = '# Matrix payload\n\n- Alpha\n- Beta\n\n```js\nconst greeting = "Zażółć gęślą jaźń — 你好 👋";\nconsole.log(greeting);\n```\n\n| Panel | Role |\n| --- | --- |\n| P2 | Receiver |\n\nEnd of exact payload.';
  await trial({ id: 'send-markdown', kind: 'send', source: 0, targets: [1], body: markdown });
  await trial({ id: 'broadcast-markdown', kind: 'broadcast', source: 0, targets: peers, body: markdown });
  baselinePassed = trials.length === 14 && trials.every(item => item.passed);
  if (stressEnabled && baselinePassed) stressPassed = await runStress(longBody);
  await waitFor(() => panels().every(ready), 'trial-ready', 45000);
  await focus(0);
  const exitingPanel = panels().find(panel => panel.panelIndex === 0);
  const exitingChild = exitingPanel.proc;
  const channelOpenBeforeQuit = !!exitingPanel.openCodeChannel && !exitingPanel.openCodeChannel.closed;
  let naturalClosed = false;
  exitingChild.once('close', () => { naturalClosed = true; });
  write('\x04');
  await waitFor(() => naturalClosed, 'natural-quit', 20000);
  naturalQuitPassed = naturalClosed && channelOpenBeforeQuit;
  report({ event: 'trial', trial: 'natural-quit', passed: naturalQuitPassed, channelOpenBeforeQuit });
  stage = 'complete';
} catch (error) {
  failure = stringEnums.has(error?.message) ? error.message : 'private-error-withheld';
  await collectOwned();
  const descriptorMetadata = [];
  for (const record of await remainingOwned()) {
    if (!same(record, (await processTable()).get(record.pid))) continue;
    try {
      const descriptor = await execFileAsync('/usr/sbin/lsof', ['-a', '-p', String(record.pid), '-d', '4', '-Fft'], { timeout: 3000 });
      descriptorMetadata.push({ fd4Open: descriptor.stdout.split('\n').some(line => line.startsWith('f4')),
        directChild: record.parent === process.pid });
    } catch { descriptorMetadata.push({ fd4Open: false, directChild: record.parent === process.pid }); }
  }
  report({ event: 'final', failure, stage, panels: panelMetadata(), trialResults: trials,
    launchEnvironments, ownedDescriptorMetadata: descriptorMetadata });
} finally {
  stage = 'cleanup'; clearInterval(heartbeat); await collectOwned(); await app.dispose(); clearInterval(tracker); await collecting;
  for (const signal of ['SIGTERM','SIGKILL']) {
    for (const record of (await remainingOwned()).reverse()) {
      if (!same(record, (await processTable()).get(record.pid))) continue;
      try { process.kill(record.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await delay(700); if (!(await remainingOwned()).length) break;
  }
  const ownedProcessesStopped = !(await remainingOwned()).length;
  const globalConfigUnchanged = await configDigest() === beforeDigest;
  db.close(); input.destroy(); output.destroy(); blessed.screen = originalScreen;
  childProcessModule.spawn = originalSpawn; syncBuiltinESMExports();
  report({ event: 'final', passed: !failure && baselinePassed && stressPassed && naturalQuitPassed && trials.every(item => item.passed) && ownedProcessesStopped && globalConfigUnchanged,
    failure, liveTrialsCompleted: trials.length, trialResults: trials, stressResults, baselinePassed, stressPassed,
    realAgentPTYs: launchedCount, ownedProcessesStopped, naturalQuitPassed,
    globalConfigUnchanged, toolsDenied: verifiedLaunches === launchedCount && launchedCount > 0,
    rawOutputPrinted: false, rawOutputRecorded: false, resizeEvents });
  process.exitCode = !failure && baselinePassed && stressPassed && naturalQuitPassed && trials.every(item => item.passed) && ownedProcessesStopped && globalConfigUnchanged ? 0 : 1;
}
