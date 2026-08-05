import blessed from 'blessed';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { Theme, AppConfig, OrchestrationConfig } from '../config/types.js';
import type { AgentType } from '../agents/types.js';
import { VTerm } from './vterm.js';
import {
  ProtocolScanner,
  isAgentType,
  matchSendStart,
  matchReplyMarker,
  matchBroadcastMarker,
  matchStatusMarker,
  matchQueryMarker,
  isEndMarker,
  looksLikeInstructionEcho,
  type CommandCallback,
  type CommanderMessage,
  type MessageType,
} from '../orchestration/protocol.js';
import { resolveExecutablePath } from '../utils/command-resolution.js';
import { logger } from '../utils/logger.js';
import {
  resolvePtyHelperPath,
  runtimeAssetLookupForModule,
} from '../utils/runtime-assets.js';
import { sanitizeUserText } from '../utils/user-facing-errors.js';
import { isPanelNumber } from '../panel-limits.js';
import { isDialogActive } from '../utils/dialog-state.js';
import { isCodexMicroKey } from '../hardware/codex-micro.js';

/**
 * Keys reserved for the UI — never forwarded to the agent process.
 * Only keys that are always app-level actions go here.
 * Keys that use termGuard (C-g, C-h, C-r, C-l, C-e) are intentionally
 * NOT listed so they pass through to the agent (vim, bash, etc.).
 */
const RESERVED_KEYS = new Set([
  'tab',        // panel switch
  'C-t',        // toggle terminal
  'C-k',        // kill agent
  'C-w',        // remove panel
  'C-o',        // orchestrate
  'C-p',        // inject protocol
  'C-b',        // template browser
  'pageup',     // scroll output
  'pagedown',   // scroll output
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
  'S-f4', 'S-f12',
]);

const MODIFIED_FUNCTION_KEY_CODES: Readonly<Record<string, number>> = Object.freeze({
  f5: 15,
  f6: 17,
  f7: 18,
  f8: 19,
  f9: 20,
  f10: 21,
  f11: 23,
  f12: 24,
});

interface BlessedKeyEvent {
  name?: string;
  full?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

type BlessedMouseAction = 'mousedown' | 'mouseup' | 'wheelup' | 'wheeldown';

interface BlessedMouseEvent {
  action?: BlessedMouseAction | string;
  button?: 'left' | 'middle' | 'right' | string;
  x?: number;
  y?: number;
}

interface PendingReplyEmission {
  msg: CommanderMessage;
  timer: ReturnType<typeof setTimeout>;
}

type ProtocolScannerOrigin = 'scrollback' | 'grid' | 'tail';

interface ProtocolReservation {
  /** Number of identical outgoing occurrences Commander wrote into the prompt. */
  expectedOccurrences: number;
  /** Echoes are independently observed by the streaming, grid, and tail paths. */
  suppressedByOrigin: Map<ProtocolScannerOrigin, number>;
  expiresAt: number;
}

interface ChildCloseObserver {
  closed: boolean;
  onClose: () => void;
}

const COMMANDER_ACTIVITY_MS = 10000;
const TERMINAL_INPUT_SETTLE_MS = 75;
const TERMINAL_SIGINT_GRACE_MS = 500;
const TERMINAL_SIGTERM_GRACE_MS = 1000;
const TERMINAL_SIGKILL_GRACE_MS = 500;

function parseProtocolPanelId(value: string): number | null {
  const panelNumber = Number(value);
  return isPanelNumber(panelNumber) ? panelNumber - 1 : null;
}

type TerminalEnvironmentPolicy = 'inherit' | 'internal';

export interface TerminalShutdownOptions {
  sigintGraceMs?: number;
  sigtermGraceMs?: number;
  sigkillGraceMs?: number;
}

export type TerminalProcessExitReason = 'process-exit' | 'spawn-error';

const INTERNAL_ENVIRONMENT_KEYS = new Set([
  'PATH',
  'HOME',
  'LANG',
  'TERM',
  'COLORTERM',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
]);
const SENSITIVE_ENVIRONMENT_KEY = /(?:^|_)(?:API(?:_?KEY)?|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|ACCESS_KEY|AUTH)(?:_|$)/iu;

function isAllowedInternalEnvironmentKey(key: string): boolean {
  return !SENSITIVE_ENVIRONMENT_KEY.test(key)
    && (INTERNAL_ENVIRONMENT_KEYS.has(key) || key.startsWith('LC_'));
}

export function buildTerminalSpawnEnvironment(
  inherited: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string>>,
  options: {
    policy: TerminalEnvironmentPolicy;
    cwd: string;
    cols: number;
    rows: number;
  },
): Record<string, string> {
  const spawnEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value === undefined) continue;
    if (options.policy === 'internal' && !isAllowedInternalEnvironmentKey(key)) {
      continue;
    }
    spawnEnv[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (options.policy === 'internal' && !isAllowedInternalEnvironmentKey(key)) {
      continue;
    }
    spawnEnv[key] = value;
  }
  spawnEnv.TERM = 'xterm-256color';
  spawnEnv.FORCE_COLOR = '1';
  spawnEnv.COLUMNS = String(options.cols);
  spawnEnv.LINES = String(options.rows);
  spawnEnv.PWD = options.cwd;
  return spawnEnv;
}

export class TerminalPanel {
  private static pendingChildTerminations = new Set<Promise<void>>();

  public box: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  private outputBox: blessed.Widgets.BoxElement;
  private screen: blessed.Widgets.Screen;
  private theme: Theme;
  private config: AppConfig;
  private orchConfig: OrchestrationConfig;
  public panelIndex: number;
  private _focused = false;
  private _visible = true;
  private destroyed = false;

  private proc: ChildProcess | null = null;
  /** Dedicated fd 3 pipe used only for framed PTY control messages. */
  private resizeControl: Writable | null = null;
  private lastPtySize: string | null = null;
  private stdoutDecoder: StringDecoder | null = null;
  private stderrDecoder: StringDecoder | null = null;
  private vterm!: VTerm;
  private agentType: AgentType | null = null;
  private agentName = '';
  private _status: 'idle' | 'running' | 'exited' | 'error' = 'idle';
  /** Monotonic identity for successful child-process launch attempts. */
  private _sessionGeneration = 0;
  /** Monotonic count of all user and Commander writes to the active PTY. */
  private _inputGeneration = 0n;
  /** Latest input generation followed by process output applied to VTerm. */
  private _outputObservedInputGeneration = 0n;
  private lastInputAt = Number.NEGATIVE_INFINITY;
  private cwd: string;
  // renderTimer/renderPending removed — rendering is now coalesced globally via static scheduleScreenRender
  private scanner: ProtocolScanner | null = null;
  private exitHandler: (() => void) | null = null;
  private pendingTerminations = new Set<Promise<void>>();
  private shutdownPromise: Promise<void> | null = null;
  private launchSealed = false;

  // ── VTerm-based protocol scanning ────────────────────────────
  private scannerEnabled = false;
  private lastScrollbackIndex = 0;
  private gridScanTimer: ReturnType<typeof setTimeout> | null = null;
  private activeGridProtocolKeys = new Set<string>();
  private activeTailReplyKeys = new Set<string>();
  /** Recent emission keys — shared dedup between grid scan and scrollback scanner. Maps key → expiry time. */
  private recentEmissions = new Map<string, number>();
  /** Exact outgoing prompt blocks whose terminal echoes must not become commands. */
  private protocolReservations = new Map<string, ProtocolReservation>();
  /** Scrollback-detected replies wait briefly so grid scan can win when both see the same block. */
  private pendingReplyEmissions = new Map<string, PendingReplyEmission>();
  /** While active, suppress echoed protocol-instruction blocks before they reach the orchestrator. */
  private instructionEchoGuardUntil = 0;
  /** When true, user has scrolled up — don't auto-scroll to bottom on new output. */
  private userScrolled = false;
  /** Short-lived header note for routed Commander activity. */
  private commanderActivityLabel: string | null = null;
  private commanderActivityTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set by the Orchestrator to receive inter-agent messages. */
  public onCommanderMessage: CommandCallback | null = null;

  /** Called when the process exits. Useful for AgentManager to track lifecycle. */
  public onExit: ((
    code: number | null,
    signal: string | null,
    reason: TerminalProcessExitReason,
  ) => void) | null = null;

  /** Called when the user clicks anywhere on this panel (for focus switching). */
  public onMouseClick: (() => void) | null = null;

  /** Called when real user keystrokes are forwarded to the agent process. */
  public onUserInput: (() => void) | null = null;

  get focused(): boolean { return this._focused; }
  get isVisible(): boolean { return this._visible; }
  get status(): string { return this._status; }
  get isRunning(): boolean { return this._status === 'running'; }
  get cols(): number { return this.vterm.colCount; }
  get sessionName(): string | null { return this.agentName || null; }
  get sessionGeneration(): number { return this._sessionGeneration; }
  get inputGeneration(): bigint { return this._inputGeneration; }
  get inputSynchronized(): boolean {
    return this._inputGeneration === this._outputObservedInputGeneration
      && Date.now() - this.lastInputAt >= TERMINAL_INPUT_SETTLE_MS;
  }
  get workingDir(): string { return this.cwd; }

  constructor(
    screen: blessed.Widgets.Screen,
    theme: Theme,
    panelIndex: number,
    cwd: string,
    position: { top: number | string; left: number | string; width: number | string; height: number | string },
    config: AppConfig,
  ) {
    this.screen = screen;
    this.theme = theme;
    this.panelIndex = panelIndex;
    this.cwd = cwd;
    this.config = config;

    // Merge defaults with user-provided partial config
    this.orchConfig = {
      gridScanDelay: 200,
      injectionGrace: 2500,
      initDelay: 3000,
      claudeSubmitDelay: 2500,
      ackTimeout: 60000,
      dedupWindow: 15000,
      maxContentLines: 500,
      maxContentBytes: 262144,
      ...config.orchestration,
    };

    this.box = blessed.box({
      parent: screen,
      top: position.top,
      left: position.left,
      width: position.width,
      height: position.height,
      border: { type: 'line' },
      style: { bg: 'black', fg: 'white', border: theme.panel.border },
      tags: true,
      label: ` Terminal [${panelIndex + 1}] `,
    });

    this.headerBox = blessed.box({
      parent: this.box,
      top: 0, left: 0, width: '100%-2', height: 1,
      tags: true,
      style: { bg: 'cyan', fg: 'black' },
      content: ' No agent running  |  F2=Launch',
    });

    this.outputBox = blessed.box({
      parent: this.box,
      top: 1, left: 0, width: '100%-2', height: '100%-4',
      tags: false,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: 'cyan' } },
      keys: false,    // we handle keys ourselves
      mouse: true,
      style: { bg: 'black', fg: 'white' },
    });

    this.initVTerm();
    this.setupKeys();
    this.setupMouse();
  }

  private getTerminalDimensions(): { cols: number; rows: number } {
    const width = typeof this.outputBox.width === 'number' ? this.outputBox.width : 1;
    const height = typeof this.outputBox.height === 'number' ? this.outputBox.height : 1;
    // Reserve one column for the scrollbar and one row for Blessed's edge.
    return {
      cols: Math.max(1, Math.floor(width) - 1),
      rows: Math.max(1, Math.floor(height) - 1),
    };
  }

  private initVTerm(): void {
    const { cols, rows } = this.getTerminalDimensions();
    this.vterm = new VTerm(cols, rows);
  }

  private setupKeys(): void {
    // PageUp / PageDown — scroll output (UI only, not forwarded)
    this.outputBox.key(['pageup'], () => {
      this.userScrolled = true;
      this.outputBox.scroll(-((this.outputBox.height as number) - 2));
      this.screen.render();
    });
    this.outputBox.key(['pagedown'], () => {
      this.outputBox.scroll((this.outputBox.height as number) - 2);
      // If we've scrolled back to the bottom, resume auto-scroll
      const scrollHeight = this.outputBox.getScrollHeight();
      const visibleHeight = (this.outputBox.height as number) - 2;
      const scrollTop = this.outputBox.getScroll();
      if (scrollTop + visibleHeight >= scrollHeight - 1) {
        this.userScrolled = false;
      }
      this.screen.render();
    });

    // Forward all other keypresses directly to the agent process
    this.outputBox.on('keypress', (ch: string | undefined, key: BlessedKeyEvent | undefined) => {
      if (isDialogActive()) return;
      if (!this.proc?.stdin?.writable) return;
      if (!key) return;

      // Don't forward keys reserved for the UI
      const keyId = key.full || key.name;
      if (
        keyId
        && (
          RESERVED_KEYS.has(keyId)
          || (
            this.config.hardware?.codexMicro.enabled
            && this.config.hardware.codexMicro.inputMode === 'keyboard'
            && isCodexMicroKey(keyId)
          )
        )
      ) return;

      const data = this.keyToAnsi(ch, key);
      if (data) {
        this.proc.stdin.write(data);
        this.recordUserInput();
      }
    });
  }

  private setupMouse(): void {
    // Click to focus — notify parent layout
    this.box.on('click', () => {
      if (isDialogActive()) return;
      if (this.onMouseClick) this.onMouseClick();
    });

    // Track mouse wheel scrolling for userScrolled state
    this.outputBox.on('wheelup' as any, () => {
      if (this.vterm.mouseEnabled) return; // agent handles it
      this.userScrolled = true;
    });
    this.outputBox.on('wheeldown' as any, () => {
      if (this.vterm.mouseEnabled) return;
      const scrollHeight = this.outputBox.getScrollHeight();
      const visibleHeight = (this.outputBox.height as number) - 2;
      const scrollTop = this.outputBox.getScroll();
      if (scrollTop + visibleHeight >= scrollHeight - 1) {
        this.userScrolled = false;
      }
    });

    // Forward mouse events to agent process when agent has mouse mode enabled
    this.outputBox.on('mouse', (data: BlessedMouseEvent) => {
      if (isDialogActive()) return;
      if (!this.proc?.stdin?.writable) return;
      if (!this.vterm.mouseEnabled) return;
      if (typeof data.x !== 'number' || typeof data.y !== 'number') return;

      // Calculate coordinates relative to the terminal area (1-based)
      const boxAbsLeft = (this.outputBox.aleft as number) || 0;
      const boxAbsTop = (this.outputBox.atop as number) || 0;
      const col = data.x - boxAbsLeft + 1;
      const row = data.y - boxAbsTop + 1;

      if (col < 1 || row < 1) return;

      let button: number;
      let suffix: string;

      switch (data.action) {
        case 'mousedown':
          button = data.button === 'left' ? 0 : data.button === 'middle' ? 1 : 2;
          suffix = 'M';
          break;
        case 'mouseup':
          button = data.button === 'left' ? 0 : data.button === 'middle' ? 1 : 2;
          suffix = 'm';
          break;
        case 'wheelup':
          button = 64;
          suffix = 'M';
          break;
        case 'wheeldown':
          button = 65;
          suffix = 'M';
          break;
        default:
          return;
      }

      // SGR extended mouse format: \x1b[<button;col;row;M/m
      const seq = `\x1b[<${button};${col};${row}${suffix}`;
      this.proc.stdin.write(seq);
      this.recordUserInput();
    });
  }

  /** Map a blessed keypress event to the ANSI byte sequence a real terminal would send. */
  private keyToAnsi(ch: string | undefined, key: BlessedKeyEvent): string | null {
    // Regular printable character (no ctrl/meta modifier)
    if (ch && ch.length === 1 && !key.ctrl && !key.meta) {
      return ch;
    }

    const name: string = key.name || '';
    const modifier = 1
      + (key.shift ? 1 : 0)
      + (key.meta ? 2 : 0)
      + (key.ctrl ? 4 : 0);

    // Enter / Return
    if (name === 'enter' || name === 'return') return '\r';
    // Backspace
    if (name === 'backspace') return '\x7f';
    // Escape (only if not part of a reserved combo)
    if (name === 'escape') return '\x1b';
    // Delete
    if (name === 'delete') return modifier === 1 ? '\x1b[3~' : `\x1b[3;${modifier}~`;
    // Insert
    if (name === 'insert') return modifier === 1 ? '\x1b[2~' : `\x1b[2;${modifier}~`;
    // Page navigation (unmodified variants are intercepted by panel scrolling).
    if (name === 'pageup') return modifier === 1 ? '\x1b[5~' : `\x1b[5;${modifier}~`;
    if (name === 'pagedown') return modifier === 1 ? '\x1b[6~' : `\x1b[6;${modifier}~`;

    // Arrow keys
    if (name === 'up') return modifier === 1 ? '\x1b[A' : `\x1b[1;${modifier}A`;
    if (name === 'down') return modifier === 1 ? '\x1b[B' : `\x1b[1;${modifier}B`;
    if (name === 'right') return modifier === 1 ? '\x1b[C' : `\x1b[1;${modifier}C`;
    if (name === 'left') return modifier === 1 ? '\x1b[D' : `\x1b[1;${modifier}D`;

    // Home / End
    if (name === 'home') return modifier === 1 ? '\x1b[H' : `\x1b[1;${modifier}H`;
    if (name === 'end') return modifier === 1 ? '\x1b[F' : `\x1b[1;${modifier}F`;

    // Modified function keys can be emitted by programmable HID devices.
    // Unmodified F-keys remain app-reserved before this conversion runs.
    const functionCode = MODIFIED_FUNCTION_KEY_CODES[name];
    if (functionCode !== undefined && modifier > 1) {
      return `\x1b[${functionCode};${modifier}~`;
    }

    // Space (sometimes comes as key.name='space' without ch)
    if (name === 'space') return ' ';
    // Tab sent to agent (note: 'tab' key.full is reserved, but we might want it)
    // Tab is reserved for panel switching so we skip it.

    // Ctrl+letter combos (send the control character)
    if (key.ctrl && name && name.length === 1) {
      const code = name.toLowerCase().charCodeAt(0) - 96; // a=1 … z=26
      if (code >= 1 && code <= 26) return String.fromCharCode(code);
    }

    return null;
  }

  private canLaunchSession(label: string): boolean {
    if (!this.launchSealed) return true;
    logger.warn(`Terminal: refusing to launch ${label}; panel shutdown has begun`);
    return false;
  }

  launchAgent(
    agentType: AgentType,
    agentName: string,
    command: string,
    args: string[] = [],
    env: Record<string, string> = {},
  ): boolean {
    if (!this.canLaunchSession(agentName)) return false;
    if (this.proc) this.killAgent();

    this.agentType = agentType;
    this.agentName = agentName;
    this._status = 'running';
    this.initVTerm();
    this.exitHandler = null;
    this.userScrolled = false;

    return this.launchSession(command, args, env, true, 'inherit');
  }

  launchInternalAgent(
    agentName: string,
    command: string,
    args: string[] = [],
    env: Record<string, string> = {},
  ): boolean {
    if (!this.canLaunchSession(agentName)) return false;
    if (this.proc) this.killAgent();

    this.agentType = 'generic';
    this.agentName = agentName;
    this._status = 'running';
    this.initVTerm();
    this.exitHandler = null;
    this.userScrolled = false;

    return this.launchSession(command, args, env, true, 'internal');
  }

  launchCommand(
    label: string,
    command: string,
    args: string[] = [],
    env: Record<string, string> = {},
    options?: { onExit?: () => void },
  ): boolean {
    if (!this.canLaunchSession(label)) return false;
    if (this.proc) this.killAgent(true);

    this.agentType = null;
    this.agentName = label;
    this._status = 'running';
    this.initVTerm();
    this.exitHandler = options?.onExit ?? null;
    this.userScrolled = false;

    return this.launchSession(command, args, env, false, 'inherit');
  }

  private launchSession(
    command: string,
    args: string[],
    env: Record<string, string>,
    enableProtocolScanner: boolean,
    environmentPolicy: TerminalEnvironmentPolicy,
  ): boolean {
    if (this.launchSealed) return false;
    const { cols, rows } = this.getTerminalDimensions();

    const resolvedPath = this.resolveFullPath(command);
    if (!resolvedPath) {
      this._status = 'error';
      this.vterm.write(`ERROR: Command not found: ${command}\r\n`);
      this.scheduleRender();
      this.updateHeader();
      logger.error(`Terminal launch failed: command not found: ${command}`);
      return false;
    }

    this.vterm.write(`--- Launching ${this.agentName} ---\r\n`);
    this.vterm.write(`  Binary:  ${resolvedPath}\r\n`);
    this.vterm.write(`  CWD:     ${this.cwd}\r\n---\r\n\r\n`);
    this.scheduleRender();

    const spawnEnv = buildTerminalSpawnEnvironment(process.env, env, {
      policy: environmentPolicy,
      cwd: this.cwd,
      cols,
      rows,
    });

    try {
      const helperPath = resolvePtyHelperPath(runtimeAssetLookupForModule(import.meta.url));
      const pythonPath = this.resolveFullPath('python3');
      if (!helperPath) {
        throw new Error('pty-helper.py not found in the installed package');
      }
      if (!pythonPath) {
        throw new Error('python3 is required to launch terminal sessions');
      }

      this.proc = spawn(pythonPath, [helperPath, '--cwd', this.cwd, '--', resolvedPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        env: spawnEnv,
      });
      this._sessionGeneration += 1;
      this._inputGeneration = 0n;
      this._outputObservedInputGeneration = 0n;
      this.lastInputAt = Number.NEGATIVE_INFINITY;
      const thisProc = this.proc;
      const resizeControl = this.proc.stdio[3] as Writable | null;
      this.resizeControl = resizeControl;
      this.lastPtySize = resizeControl ? `${cols}x${rows}` : null;
      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');
      this.stdoutDecoder = stdoutDecoder;
      this.stderrDecoder = stderrDecoder;

      logger.info(`Terminal session launched: ${this.agentName} pid=${this.proc.pid}`);

      this.proc.stdin?.on('error', (err: Error) => {
        logger.error(`stdin pipe error for ${this.agentName}: ${err.message}`);
      });
      resizeControl?.on('error', (err: Error) => {
        if (this.resizeControl === resizeControl) {
          this.resizeControl = null;
          this.lastPtySize = null;
        }
        logger.error(`resize control pipe error for ${this.agentName}: ${err.message}`);
      });

      // Protocol scanning now reads from VTerm (clean grid/scrollback)
      // instead of raw PTY data, avoiding TUI rendering artifacts.
      this.scannerEnabled = enableProtocolScanner;
      this.lastScrollbackIndex = this.vterm.primaryScrollbackStartIndex;
      this.activeGridProtocolKeys.clear();
      this.activeTailReplyKeys.clear();
      this.recentEmissions.clear();
      this.protocolReservations.clear();
      this.clearCommanderActivity();
      this.clearPendingReplyEmissions();
      this.scanner = enableProtocolScanner
        ? new ProtocolScanner(
          this.panelIndex,
          this.agentName,
          (msg) => {
            if (msg.type === 'reply') {
              this.schedulePendingReplyEmission(msg);
              return;
            }
            this.emitDeduped(msg, 'scrollback');
          },
          {
            maxContentLines: this.orchConfig.maxContentLines,
            maxContentBytes: this.orchConfig.maxContentBytes,
          },
        )
        : null;

      this.proc.stdout?.on('data', (data: Buffer) => {
        this.handleProcessData(thisProc, stdoutDecoder, data);
      });

      this.proc.stderr?.on('data', (data: Buffer) => {
        this.handleProcessData(thisProc, stderrDecoder, data);
      });

      this.proc.on('error', (err: Error) => {
        if (this.proc === thisProc) {
          this._status = 'error';
          this.vterm.write(`\r\nProcess error: ${err.message}\r\n`);
          this.updateHeader();
          this.proc = null;
          this.closeResizeControl();
          this.stdoutDecoder = null;
          this.stderrDecoder = null;
          this.scanner = null;
          this.scannerEnabled = false;
          this.onExit?.(null, null, 'spawn-error');
          this.runExitHandler();
          this.scheduleRender();
        }
        logger.error(`Terminal session error: ${this.agentName}`, err);
      });

      // Capture the current process reference so the close handler only
      // cleans up if THIS process is still the active one.  Without this
      // guard, killing an agent and immediately launching a new one causes
      // the old process's close event to null out the NEW scanner.
      this.proc.on('close', (code: number | null, signal: string | null) => {
        if (this.proc === thisProc) {
          this.flushDecodedPtyStreams();
          this._status = code === 0 ? 'exited' : 'error';
          this.vterm.write(`\r\n--- ${this.agentName} exited (code=${code}, signal=${signal ?? 'none'}) ---\r\n`);
          this.updateHeader();
          this.proc = null;
          this.closeResizeControl();
          this.stdoutDecoder = null;
          this.stderrDecoder = null;
          this.scanner = null;
          this.scannerEnabled = false;
          this.instructionEchoGuardUntil = 0;
          this.activeGridProtocolKeys.clear();
          this.activeTailReplyKeys.clear();
          this.protocolReservations.clear();
          this.clearCommanderActivity();
          this.clearPendingReplyEmissions();
          if (this.gridScanTimer) { clearTimeout(this.gridScanTimer); this.gridScanTimer = null; }
          this.scheduleRender();

          // Call unified exit handlers
          if (this.onExit) this.onExit(code, signal, 'process-exit');
          this.runExitHandler();
        }
        logger.info(`Terminal session exited: ${this.agentName} code=${code} signal=${signal}`);
      });

      this.updateHeader();
      return true;
    } catch (err) {
      this.closeResizeControl();
      this._status = 'error';
      this.vterm.write(`\r\nFAILED: ${(err as Error).message}\r\n`);
      this.updateHeader();
      this.scheduleRender();
      logger.error(`Terminal launch exception: ${this.agentName}`, err as Error);
      return false;
    }
  }

  /** Drop late output from a child that has already been replaced. */
  private handleProcessData(
    child: ChildProcess,
    decoder: StringDecoder,
    data: Buffer,
  ): void {
    if (this.proc !== child) return;
    const text = this.decodePtyChunk(decoder, data);
    if (!text) return;
    this.vterm.write(text);
    // Record only after the decoded process output has reached VTerm. Any
    // later input (including one triggered while scanning this output) gets a
    // newer generation and remains unsettled.
    this._outputObservedInputGeneration = this._inputGeneration;
    this.feedScannerFromVTerm(true);
    this.scheduleRender();
  }

  // ── VTerm-based protocol scanning ─────────────────────────────

  /**
   * Unified dedup for messages detected by BOTH the scrollback scanner
   * and the grid scan.  A message visible on the grid gets detected by
   * the grid scan first; when it later scrolls into scrollback the
   * ProtocolScanner would detect it again.  This gate prevents the
   * duplicate from reaching the Orchestrator.
   */
  private emitDeduped(msg: CommanderMessage, origin: ProtocolScannerOrigin): void {
    if (!this.onCommanderMessage) return;
    if (Date.now() < this.instructionEchoGuardUntil && looksLikeInstructionEcho(msg.content)) {
      logger.info(`Dedup[${this.panelIndex}]: suppressed echoed ${msg.type} block from protocol instructions`);
      return;
    }
    const canonical = TerminalPanel.canonicalizeContent(msg.content);
    const key = this.buildEmissionKey(
      msg.type,
      msg.targetAgent,
      msg.targetPanel,
      canonical,
      msg.capability ?? null,
    );
    const now = Date.now();
    this.pruneExpiredEmissionKeys(now);
    this.pruneExpiredProtocolReservations(now);

    const reservation = this.protocolReservations.get(key);
    if (reservation) {
      const suppressed = reservation.suppressedByOrigin.get(origin) ?? 0;
      if (suppressed < reservation.expectedOccurrences) {
        reservation.suppressedByOrigin.set(origin, suppressed + 1);
        // This is the exact capability-bound block Commander just wrote into
        // the agent prompt. Terminal UIs commonly render pasted input back into
        // their output, and the same physical echo can be observed independently
        // by the scrollback, grid, and tail scanners. Each path suppresses up to
        // the known number of outgoing occurrences.
        logger.info(
          `Dedup[${this.panelIndex}]: suppressed outgoing ${msg.type} prompt echo (${origin})`,
        );
        return;
      }

      // The N+1 occurrence on one scanner path is agent-authored. End the
      // reservation without inheriting an older dedup entry so it can route;
      // its normal recentEmissions entry then suppresses replays on every path.
      this.protocolReservations.delete(key);
      this.recentEmissions.delete(key);
    }

    const expiryAt = this.recentEmissions.get(key) ?? 0;
    if (expiryAt > now) {
      logger.debug(`Dedup[${this.panelIndex}]: suppressed duplicate ${msg.type} → ${msg.targetAgent}:${msg.targetPanel + 1}`);
      return;
    }
    this.rememberEmissionKey(key, this.orchConfig.dedupWindow);
    this.onCommanderMessage(msg);
  }

  /**
   * Feed the protocol scanner from VTerm's clean output rather than
   * raw PTY data.  This avoids TUI rendering artifacts (status bars,
   * cursor positioning, box-drawing) being mixed into the content.
   *
   * Two mechanisms:
   *  1. Scrollback lines — finalized rows that scrolled off the grid
   *     (only works in normal mode; alt-screen disables scrollback).
   *  2. Grid scan — periodic scan of the visible grid for complete
   *     SEND…END blocks (handles alt-screen / TUI agents).
   */
  private feedScannerFromVTerm(newData = false): void {
    if (!this.scannerEnabled || !this.scanner) return;

    // 1. Feed new scrollback lines (non-TUI / normal scroll)
    const sbStart = this.vterm.primaryScrollbackStartIndex;
    const sbEnd = this.vterm.primaryScrollbackEndIndex;
    this.lastScrollbackIndex = Math.max(this.lastScrollbackIndex, sbStart);
    while (this.lastScrollbackIndex < sbEnd) {
      const row = this.vterm.getPrimaryScrollbackPlainRowAt(this.lastScrollbackIndex);
      if (!row) {
        this.lastScrollbackIndex = this.vterm.primaryScrollbackStartIndex;
        continue;
      }
      this.scanner.feed(`${row.text}${row.wrapsToNext ? '' : '\n'}`);
      this.lastScrollbackIndex++;
    }

    // 2. Always schedule a debounced grid scan — TUI agents may use
    //    scroll regions or other mechanisms besides standard alt-screen,
    //    so we cannot rely on inAltScreen alone.
    this.scheduleGridScan(newData);
  }

  private scheduleGridScan(fast = false): void {
    if (this.gridScanTimer) {
      if (!fast) return;
      return;
    }
    const delay = fast ? Math.max(50, this.orchConfig.gridScanDelay / 4) : this.orchConfig.gridScanDelay;
    this.gridScanTimer = setTimeout(() => {
      this.gridScanTimer = null;
      this.scanGridForProtocol();
    }, delay);
  }

  /**
   * Scan the VTerm visible grid for complete ===COMMANDER:…END=== blocks.
   * This is a non-stateful scan (independent of the streaming ProtocolScanner)
   * specifically for TUI agents whose output never enters scrollback.
   * Detects SEND, REPLY, BROADCAST, STATUS, and QUERY markers.
   */
  private scanGridForProtocol(): void {
    if (!this.onCommanderMessage) return;
    if (this.scanner?.isMuted) return;

    const lines = this.vterm.getGridLogicalLines();
    const visibleKeys = new Set<string>();
    let startIdx = -1;
    let msgType: MessageType = 'send';
    let capability: string | null = null;
    let target: { agent: string; panel: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Only look for start markers when not already collecting
      if (startIdx < 0) {
        // ── SEND:agent:panel ──
        const startMatch = matchSendStart(line);
        if (startMatch && isAgentType(startMatch[1])) {
          const panelNum = parseProtocolPanelId(startMatch[2]);
          if (panelNum !== null) {
            startIdx = i;
            msgType = 'send';
            capability = startMatch[3] ?? null;
            target = { agent: startMatch[1], panel: panelNum };
          }
          continue;
        }

        // ── REPLY ──
        const replyMarker = matchReplyMarker(line);
        if (replyMarker) {
          startIdx = i;
          msgType = 'reply';
          capability = replyMarker.capability;
          target = null;
          continue;
        }

        // ── BROADCAST ──
        const broadcastMarker = matchBroadcastMarker(line);
        if (broadcastMarker) {
          startIdx = i;
          msgType = 'broadcast';
          capability = broadcastMarker.capability;
          target = null;
          continue;
        }

        // ── STATUS ──
        const statusMarker = matchStatusMarker(line);
        if (statusMarker) {
          startIdx = i;
          msgType = 'status';
          capability = statusMarker.capability;
          target = null;
          continue;
        }

        // ── QUERY ──
        const queryMarker = matchQueryMarker(line);
        if (queryMarker) {
          startIdx = i;
          msgType = 'query';
          capability = queryMarker.capability;
          target = null;
          continue;
        }
      }

      if (startIdx >= 0 && isEndMarker(line, capability)) {
        const content = lines.slice(startIdx + 1, i).join('\n').trim();
        const canonical = TerminalPanel.canonicalizeContent(content);
        const key = this.buildEmissionKey(
          msgType,
          (target?.agent as any) ?? 'generic',
          target?.panel ?? -1,
          canonical,
          capability,
        );
        visibleKeys.add(key);
        if (msgType === 'reply') {
          this.cancelPendingReplyEmission(key);
        }

        logger.info(
          `GridScan[${this.panelIndex}]: detected ${msgType}` +
          (target ? ` ${target.agent}:${target.panel + 1}` : '') +
          ` (${content.length} chars)`,
        );

        if (!this.activeGridProtocolKeys.has(key)) {
          this.emitDeduped({
            type: msgType,
            sourcePanel: this.panelIndex,
            sourceAgent: this.agentName,
            targetAgent: (target?.agent as any) ?? 'generic',
            targetPanel: target?.panel ?? -1,
            content,
            ...(capability ? { capability } : {}),
          }, 'grid');
        } else if (!this.protocolReservations.has(key)) {
          this.rememberEmissionKey(key, this.orchConfig.dedupWindow);
        }

        startIdx = -1;
        capability = null;
        target = null;
      }
    }

    this.activeGridProtocolKeys = visibleKeys;
    this.scanRenderedTailForReplies();
  }

  /** Throttled render — max 15fps to keep UI responsive. */
  private scheduleRender(): void {
    if (this.destroyed || !this._visible) return;
    // Update this panel's content immediately (cheap — just sets DOM text)
    this.updateContent();
    // Coalesce screen.render() calls through a single global timer
    // so multiple panels don't each trigger independent full repaints
    TerminalPanel.scheduleScreenRender(this.screen);
  }

  private updateContent(): void {
    if (this.destroyed || !this._visible) return;
    // Show cursor when this panel is focused and an agent is running
    const showCursor = this._focused && this._status === 'running';
    const lines = this.vterm.getLines(showCursor);
    this.outputBox.setContent(lines.join('\n'));
    // In alternate screen (TUI) mode, show from top (fixed-size grid).
    // In normal mode, auto-scroll to bottom — unless user has scrolled up.
    if (this.vterm.inAltScreen) {
      this.outputBox.setScrollPerc(0);
    } else if (!this.userScrolled) {
      this.outputBox.setScrollPerc(100);
    }
  }

  /** Global render coalescing — one screen.render() for all panels. */
  private static globalRenderTimer: ReturnType<typeof setTimeout> | null = null;
  private static scheduleScreenRender(screen: blessed.Widgets.Screen): void {
    if (TerminalPanel.globalRenderTimer) return;
    TerminalPanel.globalRenderTimer = setTimeout(() => {
      TerminalPanel.globalRenderTimer = null;
      try {
        screen.render();
      } catch {
        // Suppress blessed render errors (orphaned children etc.)
      }
    }, 50); // ~20fps, single repaint for all panels
  }

  private resolveFullPath(command: string): string | null {
    return resolveExecutablePath(command);
  }

  private updateHeader(): void {
    if (this.destroyed || !this._visible) return;
    if (!this.agentName) {
      this.headerBox.setContent(' No agent running  |  F2=Launch');
      return;
    }
    const icon = this._status === 'running' ? '{green-fg}*{/green-fg}'
      : this._status === 'exited' ? '{yellow-fg}-{/yellow-fg}'
      : '{red-fg}!{/red-fg}';
    const pid = this.proc ? ` pid=${this.proc.pid}` : '';
    const activity = this.commanderActivityLabel
      ? `  |  {yellow-fg}${this.commanderActivityLabel}{/yellow-fg}`
      : '  |  Type directly  ^C=Int';
    const escape = (blessed as unknown as { escape(text: string): string }).escape;
    const safeAgentName = escape(sanitizeUserText(this.agentName, 120));
    this.headerBox.setContent(` ${icon} ${safeAgentName}  [${this._status}]${pid}${activity}`);
  }

  private static boundedGracePeriod(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(30_000, Math.trunc(value)));
  }

  private static childHasExited(child: ChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null;
  }

  private static waitForChildClose(
    child: ChildProcess,
    observer: ChildCloseObserver,
    timeoutMs: number,
  ): Promise<boolean> {
    if (observer.closed) return Promise.resolve(true);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (closed: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('close', onClose);
        resolve(closed);
      };
      const onClose = () => { finish(true); };
      const timer = setTimeout(() => { finish(observer.closed); }, timeoutMs);
      child.once('close', onClose);

      // Cover a close that raced with listener registration.
      if (observer.closed) {
        queueMicrotask(() => { finish(true); });
      }
    });
  }

  private async terminateChildProcess(
    child: ChildProcess,
    control: Writable | null,
    closeObserver: ChildCloseObserver,
    sessionName: string,
    options: TerminalShutdownOptions,
  ): Promise<void> {
    const stages: ReadonlyArray<{
      signal: NodeJS.Signals;
      graceMs: number;
      escalationLabel?: string;
    }> = [
      {
        signal: 'SIGINT',
        graceMs: TerminalPanel.boundedGracePeriod(
          options.sigintGraceMs,
          TERMINAL_SIGINT_GRACE_MS,
        ),
      },
      {
        signal: 'SIGTERM',
        graceMs: TerminalPanel.boundedGracePeriod(
          options.sigtermGraceMs,
          TERMINAL_SIGTERM_GRACE_MS,
        ),
        escalationLabel: 'SIGTERM',
      },
      {
        signal: 'SIGKILL',
        graceMs: TerminalPanel.boundedGracePeriod(
          options.sigkillGraceMs,
          TERMINAL_SIGKILL_GRACE_MS,
        ),
        escalationLabel: 'SIGKILL',
      },
    ];

    for (const stage of stages) {
      if (closeObserver.closed) return;
      if (TerminalPanel.childHasExited(child)) {
        if (await TerminalPanel.waitForChildClose(child, closeObserver, stage.graceMs)) return;
        continue;
      }
      if (stage.escalationLabel) {
        logger.info(`Terminal: escalating to ${stage.escalationLabel} for ${sessionName}`);
      }
      this.signalAgentProcessGroup(
        child,
        control,
        stage.signal,
        sessionName,
      );
      if (await TerminalPanel.waitForChildClose(
        child,
        closeObserver,
        stage.graceMs,
      )) return;
    }

    // The control command targets the PTY child's process group. If the helper
    // itself failed to observe the child's death, terminate that wrapper too
    // after the group has had its full SIGKILL grace period.
    if (!closeObserver.closed) {
      logger.info(`Terminal: force-closing PTY helper for ${sessionName}`);
      try {
        child.kill('SIGKILL');
      } catch (error) {
        logger.error(`Terminal: unable to force-close PTY helper for ${sessionName}`, error);
      }
      await TerminalPanel.waitForChildClose(
        child,
        closeObserver,
        TerminalPanel.boundedGracePeriod(
          options.sigkillGraceMs,
          TERMINAL_SIGKILL_GRACE_MS,
        ),
      );
    }

    if (!closeObserver.closed) {
      logger.error(`Terminal: process for ${sessionName} did not close after SIGKILL`);
    }
  }

  private signalAgentProcessGroup(
    child: ChildProcess,
    control: Writable | null,
    signal: NodeJS.Signals,
    sessionName: string,
  ): boolean {
    let controlRequested = false;
    if (control?.writable && !control.destroyed && !control.writableEnded) {
      try {
        control.write(`signal ${signal.slice(3)}\n`);
        controlRequested = true;
      } catch (error) {
        logger.error(`Terminal: unable to request ${signal} for ${sessionName}`, error);
      }
    }

    if (signal === 'SIGKILL') {
      try {
        // Redundant with fd 3 by design: stream write failures may surface
        // asynchronously, while SIGUSR1 is a dedicated helper command that
        // force-kills the PTY child's entire process group.
        const helperNotified = child.kill('SIGUSR1');
        return controlRequested || helperNotified;
      } catch (error) {
        logger.error(`Terminal: unable to request SIGKILL for ${sessionName}`, error);
        return controlRequested;
      }
    }

    if (controlRequested) return true;
    try {
      // SIGINT/SIGTERM are forwarded by the helper to the PTY process group.
      child.kill(signal);
      return false;
    } catch (error) {
      logger.error(`Terminal: unable to send ${signal} to ${sessionName}`, error);
      return false;
    }
  }

  private static closeDetachedControl(control: Writable | null): void {
    if (!control || control.destroyed || control.writableEnded) return;
    try {
      control.end();
    } catch {
      // The helper may have closed fd 3 while processing the final signal.
    }
  }

  private trackTermination(
    child: ChildProcess,
    control: Writable | null,
    sessionName: string,
    options: TerminalShutdownOptions,
  ): Promise<void> {
    let closeObserver!: ChildCloseObserver;
    closeObserver = {
      closed: false,
      onClose: () => {
        closeObserver.closed = true;
      },
    };
    child.once('close', closeObserver.onClose);

    let tracked!: Promise<void>;
    tracked = this.terminateChildProcess(
      child,
      control,
      closeObserver,
      sessionName,
      options,
    )
      .catch((error) => {
        logger.error(`Terminal: bounded shutdown failed for ${sessionName}`, error);
      })
      .finally(() => {
        child.removeListener('close', closeObserver.onClose);
        TerminalPanel.closeDetachedControl(control);
        this.pendingTerminations.delete(tracked);
        TerminalPanel.pendingChildTerminations.delete(tracked);
      });
    this.pendingTerminations.add(tracked);
    TerminalPanel.pendingChildTerminations.add(tracked);
    return tracked;
  }

  /**
   * Wait for terminations owned by panels that may already have been removed
   * from their layout or AgentManager. App disposal drains this global set
   * before restoring the terminal and exiting the process.
   */
  static async waitForPendingTerminations(): Promise<void> {
    while (TerminalPanel.pendingChildTerminations.size > 0) {
      await Promise.allSettled([...TerminalPanel.pendingChildTerminations]);
    }
  }

  private beginAgentTermination(
    suppressExitHandler: boolean,
    options: TerminalShutdownOptions,
  ): Promise<void> {
    if (suppressExitHandler) {
      this.exitHandler = null;
    }
    let termination = Promise.resolve();
    if (this.proc) {
      const child = this.proc;
      const control = this.detachResizeControl();
      const sessionName = this.agentName;
      this.proc = null;
      termination = this.trackTermination(child, control, sessionName, options);
    } else {
      this.closeResizeControl();
    }
    this.stdoutDecoder = null;
    this.stderrDecoder = null;
    this.scannerEnabled = false;
    this.instructionEchoGuardUntil = 0;
    this.activeGridProtocolKeys.clear();
    this.activeTailReplyKeys.clear();
    this.protocolReservations.clear();
    this.clearCommanderActivity();
    this.clearPendingReplyEmissions();
    if (this.gridScanTimer) { clearTimeout(this.gridScanTimer); this.gridScanTimer = null; }
    this._status = 'exited';
    this.updateHeader();
    return termination;
  }

  killAgent(suppressExitHandler = false): Promise<void> {
    this.beginAgentTermination(suppressExitHandler, {});
    return Promise.allSettled([...this.pendingTerminations]).then(() => undefined);
  }

  /**
   * Stop the active process and wait for every in-flight panel termination.
   * The returned promise is stable across repeated calls and always settles
   * within the configured SIGINT → SIGTERM → SIGKILL grace periods.
   */
  shutdownAgent(options: TerminalShutdownOptions = {}): Promise<void> {
    this.launchSealed = true;
    if (this.shutdownPromise) return this.shutdownPromise;

    this.beginAgentTermination(true, options);
    const pending = [...this.pendingTerminations];
    this.shutdownPromise = Promise.allSettled(pending).then(() => undefined);
    return this.shutdownPromise;
  }

  private runExitHandler(): void {
    const handler = this.exitHandler;
    this.exitHandler = null;
    if (handler) {
      handler();
    }
  }

  /** Mute the protocol scanner for the given duration (ms). */
  muteScanner(durationMs: number): void {
    this.scanner?.mute(durationMs);
  }

  /** Cancel any active scanner mute. */
  unmuteScanner(): void {
    // Before unmuting, mark everything currently on the grid as "already seen"
    // so stale template/protocol text that's still visible isn't falsely detected.
    this.snapshotGridAsProcessed();
    this.scanner?.unmute();
  }

  /** Keep the scanner's source identity in sync after panel reindexing. */
  updatePanelIndex(panelIndex: number): void {
    this.panelIndex = panelIndex;
    if (this._visible) this.box.setLabel(` Terminal [${panelIndex + 1}] `);
    this.scanner?.updateSource(panelIndex, this.agentName);
  }

  /**
   * Pre-mark complete protocol blocks in outgoing text so an echoed template
   * or injected task is deduped without muting the scanner and losing fast replies.
   */
  markProtocolTextAsProcessed(text: string): void {
    if (!this.scannerEnabled || !text.includes('COMMANDER')) return;
    if (text.includes('[Agents Commander]')) {
      this.instructionEchoGuardUntil = Math.max(
        this.instructionEchoGuardUntil,
        Date.now() + Math.max(30000, this.orchConfig.dedupWindow * 2),
      );
    }
    this.markProtocolLinesAsProcessed(
      text.split(/\r?\n/),
      Math.max(this.orchConfig.ackTimeout, this.orchConfig.dedupWindow * 4, this.orchConfig.injectionGrace),
    );
  }

  /**
   * Reserve complete protocol blocks in outgoing prompt text so their exact
   * terminal echoes are suppressed. The reservation is consumed without
   * entering the normal dedup window, allowing a later identical block that
   * the agent intentionally emits to route once.
   */
  reserveProtocolTextForEcho(text: string): void {
    if (!this.scannerEnabled || !text.includes('COMMANDER')) return;
    this.reserveProtocolLinesForEcho(
      text.split(/\r?\n/),
      Math.max(this.orchConfig.ackTimeout, this.orchConfig.dedupWindow * 4, this.orchConfig.injectionGrace),
    );
  }

  /** Mark currently visible protocol text as processed without muting the scanner. */
  snapshotVisibleProtocolAsProcessed(): void {
    this.snapshotGridAsProcessed();
  }

  /**
   * Scan the grid for protocol blocks and add them to the dedup set WITHOUT
   * emitting them.  This prevents stale content (echoed templates, protocol
   * instructions) that's still visible on screen from being detected as new
   * commands when the scanner unmutes.
   */
  private snapshotGridAsProcessed(): void {
    if (!this.scannerEnabled) return;

    const lines = this.vterm.getGridLogicalLines();

    // Fast path: skip regex matching if no potential markers on grid
    if (!lines.some((l) => l.includes('COMMANDER'))) {
      this.activeGridProtocolKeys.clear();
      this.activeTailReplyKeys.clear();
      return;
    }

    this.activeGridProtocolKeys = this.markProtocolLinesAsProcessed(lines, this.orchConfig.dedupWindow);
    this.activeTailReplyKeys = this.markTailRepliesAsProcessed(
      this.vterm.getTailLogicalLines(120),
      this.orchConfig.dedupWindow,
    );
  }

  private markProtocolLinesAsProcessed(lines: string[], ttlMs: number): Set<string> {
    const visibleKeys = new Set<string>();
    if (!this.scannerEnabled) return visibleKeys;

    let startIdx = -1;
    let msgType: MessageType = 'send';
    let capability: string | null = null;
    let target: { agent: string; panel: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (startIdx < 0) {
        const startMatch = matchSendStart(line);
        if (startMatch && isAgentType(startMatch[1])) {
          const panelNum = parseProtocolPanelId(startMatch[2]);
          if (panelNum !== null) {
            startIdx = i;
            msgType = 'send';
            capability = startMatch[3] ?? null;
            target = { agent: startMatch[1], panel: panelNum };
          }
          continue;
        }
        const replyMarker = matchReplyMarker(line);
        if (replyMarker) { startIdx = i; msgType = 'reply'; capability = replyMarker.capability; target = null; continue; }
        const broadcastMarker = matchBroadcastMarker(line);
        if (broadcastMarker) { startIdx = i; msgType = 'broadcast'; capability = broadcastMarker.capability; target = null; continue; }
        const statusMarker = matchStatusMarker(line);
        if (statusMarker) { startIdx = i; msgType = 'status'; capability = statusMarker.capability; target = null; continue; }
        const queryMarker = matchQueryMarker(line);
        if (queryMarker) { startIdx = i; msgType = 'query'; capability = queryMarker.capability; target = null; continue; }
      }

      if (startIdx >= 0 && isEndMarker(line, capability)) {
        const content = lines.slice(startIdx + 1, i).join('\n').trim();
        const canonical = TerminalPanel.canonicalizeContent(content);
        const key = this.buildEmissionKey(
          msgType,
          (target?.agent as any) ?? 'generic',
          target?.panel ?? -1,
          canonical,
          capability,
        );
        visibleKeys.add(key);
        if (!this.protocolReservations.has(key)) {
          this.rememberEmissionKey(key, ttlMs);
        }

        logger.debug(`Snapshot[${this.panelIndex}]: marked existing ${msgType} block as processed`);
        startIdx = -1;
        capability = null;
        target = null;
      }
    }

    return visibleKeys;
  }

  private reserveProtocolLinesForEcho(lines: string[], ttlMs: number): void {
    if (!this.scannerEnabled) return;

    let startIdx = -1;
    let msgType: MessageType = 'send';
    let capability: string | null = null;
    let target: { agent: string; panel: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (startIdx < 0) {
        const startMatch = matchSendStart(line);
        if (startMatch && isAgentType(startMatch[1])) {
          const panelNum = parseProtocolPanelId(startMatch[2]);
          if (panelNum !== null) {
            startIdx = i;
            msgType = 'send';
            capability = startMatch[3] ?? null;
            target = { agent: startMatch[1], panel: panelNum };
          }
          continue;
        }
        const replyMarker = matchReplyMarker(line);
        if (replyMarker) { startIdx = i; msgType = 'reply'; capability = replyMarker.capability; target = null; continue; }
        const broadcastMarker = matchBroadcastMarker(line);
        if (broadcastMarker) { startIdx = i; msgType = 'broadcast'; capability = broadcastMarker.capability; target = null; continue; }
        const statusMarker = matchStatusMarker(line);
        if (statusMarker) { startIdx = i; msgType = 'status'; capability = statusMarker.capability; target = null; continue; }
        const queryMarker = matchQueryMarker(line);
        if (queryMarker) { startIdx = i; msgType = 'query'; capability = queryMarker.capability; target = null; continue; }
      }

      if (startIdx >= 0 && isEndMarker(line, capability)) {
        const content = lines.slice(startIdx + 1, i).join('\n').trim();
        const canonical = TerminalPanel.canonicalizeContent(content);
        const key = this.buildEmissionKey(
          msgType,
          (target?.agent as any) ?? 'generic',
          target?.panel ?? -1,
          canonical,
          capability,
        );
        this.rememberProtocolReservation(key, ttlMs);
        startIdx = -1;
        capability = null;
        target = null;
      }
    }
  }

  private scanRenderedTailForReplies(): void {
    if (!this.onCommanderMessage) return;
    if (this.scanner?.isMuted) return;

    const tailLines = this.vterm.getTailLogicalLines(120);
    const visibleKeys = new Set<string>();
    let startIdx = -1;
    let capability: string | null = null;

    for (let i = 0; i < tailLines.length; i++) {
      const line = tailLines[i].replace(/\x1b\[[0-9;]*m/g, '');

      if (startIdx < 0) {
        const replyMarker = matchReplyMarker(line);
        if (replyMarker) {
          startIdx = i;
          capability = replyMarker.capability;
        }
        continue;
      }

      if (isEndMarker(line, capability)) {
        const content = tailLines
          .slice(startIdx + 1, i)
          .map((tailLine) => tailLine.replace(/\x1b\[[0-9;]*m/g, ''))
          .join('\n')
          .trim();
        const canonical = TerminalPanel.canonicalizeContent(content);
        const key = this.buildEmissionKey('reply', 'generic', -1, canonical, capability);
        visibleKeys.add(key);
        this.cancelPendingReplyEmission(key);

        logger.info(`TailScan[${this.panelIndex}]: detected reply (${content.length} chars)`);

        if (!this.activeTailReplyKeys.has(key) && !this.activeGridProtocolKeys.has(key)) {
          this.emitDeduped({
            type: 'reply',
            sourcePanel: this.panelIndex,
            sourceAgent: this.agentName,
            targetAgent: 'generic',
            targetPanel: -1,
            content,
            ...(capability ? { capability } : {}),
          }, 'tail');
        } else if (!this.protocolReservations.has(key)) {
          this.rememberEmissionKey(key, this.orchConfig.dedupWindow);
        }

        startIdx = -1;
        capability = null;
      }
    }

    this.activeTailReplyKeys = visibleKeys;
  }

  private markTailRepliesAsProcessed(lines: string[], ttlMs: number): Set<string> {
    const visibleKeys = new Set<string>();
    let startIdx = -1;
    let capability: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\x1b\[[0-9;]*m/g, '');

      if (startIdx < 0) {
        const replyMarker = matchReplyMarker(line);
        if (replyMarker) {
          startIdx = i;
          capability = replyMarker.capability;
        }
        continue;
      }

      if (isEndMarker(line, capability)) {
        const content = lines
          .slice(startIdx + 1, i)
          .map((tailLine) => tailLine.replace(/\x1b\[[0-9;]*m/g, ''))
          .join('\n')
          .trim();
        const canonical = TerminalPanel.canonicalizeContent(content);
        const key = this.buildEmissionKey('reply', 'generic', -1, canonical, capability);
        visibleKeys.add(key);
        if (!this.protocolReservations.has(key)) {
          this.rememberEmissionKey(key, ttlMs);
        }
        startIdx = -1;
        capability = null;
      }
    }

    return visibleKeys;
  }

  private static canonicalizeContent(content: string): string {
    // Preserve indentation and line structure: they can change the meaning of
    // code and task bodies. Scanner paths already strip ANSI and trim their
    // envelope; only normalize platform line endings for transport identity.
    return content.replace(/\r\n?/g, '\n');
  }

  private buildEmissionKey(
    type: MessageType,
    targetAgent: string,
    targetPanel: number,
    canonical: string,
    capability: string | null = null,
  ): string {
    const contentDigest = createHash('sha256').update(canonical, 'utf8').digest('base64url');
    return `${capability ?? 'legacy'}:${type}:${targetAgent}:${targetPanel}:${contentDigest}`;
  }

  private rememberEmissionKey(key: string, ttlMs: number): void {
    const now = Date.now();
    const expiryAt = now + ttlMs;
    const existing = this.recentEmissions.get(key) ?? 0;
    if (expiryAt > existing) {
      this.recentEmissions.set(key, expiryAt);
    }
  }

  private rememberProtocolReservation(key: string, ttlMs: number): void {
    const now = Date.now();
    const expiryAt = now + ttlMs;
    // An explicitly outgoing prompt starts a new interaction even if its exact
    // block matched a recently routed message.
    this.recentEmissions.delete(key);
    const existing = this.protocolReservations.get(key);
    if (existing && existing.expiresAt > now) {
      existing.expectedOccurrences += 1;
      if (expiryAt > existing.expiresAt) {
        existing.expiresAt = expiryAt;
      }
      return;
    }
    this.protocolReservations.set(key, {
      expectedOccurrences: 1,
      suppressedByOrigin: new Map(),
      expiresAt: expiryAt,
    });
  }

  private pruneExpiredEmissionKeys(now: number): void {
    for (const [key, expiryAt] of this.recentEmissions) {
      if (expiryAt <= now) {
        this.recentEmissions.delete(key);
      }
    }
  }

  private pruneExpiredProtocolReservations(now: number): void {
    for (const [key, reservation] of this.protocolReservations) {
      if (reservation.expiresAt <= now) {
        this.protocolReservations.delete(key);
      }
    }
  }

  private schedulePendingReplyEmission(msg: CommanderMessage): void {
    if (!this.onCommanderMessage) return;
    const canonical = TerminalPanel.canonicalizeContent(msg.content);
    const key = this.buildEmissionKey(
      msg.type,
      msg.targetAgent,
      msg.targetPanel,
      canonical,
      msg.capability ?? null,
    );
    const existing = this.pendingReplyEmissions.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const delayMs = Math.max(150, this.orchConfig.gridScanDelay * 2);
    const timer = setTimeout(() => {
      this.pendingReplyEmissions.delete(key);
      logger.debug(`ReplyFallback[${this.panelIndex}]: emitting scrollback reply after ${delayMs}ms`);
      this.emitDeduped(msg, 'scrollback');
    }, delayMs);

    this.pendingReplyEmissions.set(key, { msg, timer });
  }

  private cancelPendingReplyEmission(key: string): void {
    const pending = this.pendingReplyEmissions.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingReplyEmissions.delete(key);
  }

  private clearPendingReplyEmissions(): void {
    for (const pending of this.pendingReplyEmissions.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingReplyEmissions.clear();
  }

  sendInput(text: string): boolean {
    const stdin = this.proc?.stdin;
    if (!stdin?.writable || stdin.destroyed || stdin.writableEnded) return false;
    try {
      stdin.write(text);
      this.recordTerminalInput();
      return true;
    } catch (error) {
      logger.error(`Unable to send input to terminal session ${this.agentName}`, error);
      return false;
    }
  }

  private recordUserInput(): void {
    this.recordTerminalInput();
    this.onUserInput?.();
  }

  private recordTerminalInput(): void {
    this._inputGeneration += 1n;
    this.lastInputAt = Date.now();
  }

  /** Detached snapshot of every currently visible physical terminal row. */
  getVisibleGridLines(): string[] {
    return [...this.vterm.getGridPlainLines()];
  }

  private sendPtyResize(cols: number, rows: number): void {
    const safeCols = Math.max(1, Math.floor(cols));
    const safeRows = Math.max(1, Math.floor(rows));
    const sizeKey = `${safeCols}x${safeRows}`;
    const control = this.resizeControl;
    if (!control?.writable || control.destroyed || this.lastPtySize === sizeKey) return;

    try {
      control.write(`resize ${safeCols} ${safeRows}\n`);
      this.lastPtySize = sizeKey;
    } catch (err) {
      logger.error(`Unable to resize terminal session ${this.agentName}`, err);
      this.closeResizeControl();
    }
  }

  private closeResizeControl(): void {
    TerminalPanel.closeDetachedControl(this.detachResizeControl());
  }

  private detachResizeControl(): Writable | null {
    const control = this.resizeControl;
    this.resizeControl = null;
    this.lastPtySize = null;
    return control;
  }

  showCommanderActivity(label = 'Commander task received', durationMs = COMMANDER_ACTIVITY_MS): void {
    this.commanderActivityLabel = label;
    if (this.commanderActivityTimer) {
      clearTimeout(this.commanderActivityTimer);
    }
    this.updateHeader();
    this.scheduleRender();
    this.commanderActivityTimer = setTimeout(() => {
      this.commanderActivityTimer = null;
      this.commanderActivityLabel = null;
      this.updateHeader();
      this.scheduleRender();
    }, durationMs);
  }

  private clearCommanderActivity(): void {
    if (this.commanderActivityTimer) {
      clearTimeout(this.commanderActivityTimer);
      this.commanderActivityTimer = null;
    }
    this.commanderActivityLabel = null;
  }

  private decodePtyChunk(decoder: StringDecoder | null, data: Buffer): string {
    return decoder ? decoder.write(data) : data.toString('utf8');
  }

  private flushDecodedPtyStreams(): void {
    const pendingStdout = this.stdoutDecoder?.end() ?? '';
    if (pendingStdout) {
      this.vterm.write(pendingStdout);
    }
    const pendingStderr = this.stderrDecoder?.end() ?? '';
    if (pendingStderr) {
      this.vterm.write(pendingStderr);
    }
  }

  setVisible(visible: boolean): void {
    if (this.destroyed || this._visible === visible) return;
    this._visible = visible;

    if (!visible) {
      const focusedChild = this.screen.focused === this.outputBox;
      this.box.hide();
      if (focusedChild && this.screen.focused === this.outputBox) {
        this.screen.rewindFocus();
      }
      TerminalPanel.scheduleScreenRender(this.screen);
      return;
    }

    this.box.show();
    this.box.setLabel(` Terminal [${this.panelIndex + 1}] `);
    this.box.style.border = this._focused
      ? this.theme.panel.borderFocus
      : this.theme.panel.border;
    this.updateHeader();
    this.updateContent();
    if (this._focused) this.outputBox.focus();
    TerminalPanel.scheduleScreenRender(this.screen);
  }

  setFocus(focused: boolean): void {
    this._focused = focused;
    this.box.style.border = focused ? this.theme.panel.borderFocus : this.theme.panel.border;
    if (!this._visible) return;
    if (focused) this.outputBox.focus();
    this.screen.render();
  }

  resize(position: { top: number | string; left: number | string; width: number | string; height: number | string }): void {
    this.box.top = position.top;
    this.box.left = position.left;
    this.box.width = position.width;
    this.box.height = position.height;
    const { cols, rows } = this.getTerminalDimensions();
    this.vterm.resize(cols, rows);
    this.sendPtyResize(cols, rows);
    this.scheduleRender();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this._visible = false;
    void this.shutdownAgent();
    this.clearCommanderActivity();
    this.box.destroy();
  }
}
