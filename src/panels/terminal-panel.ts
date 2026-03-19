import blessed from 'blessed';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import type { Theme, AppConfig, OrchestrationConfig } from '../config/types.js';
import type { AgentType } from '../agents/types.js';
import { VTerm } from './vterm.js';
import {
  ProtocolScanner,
  isAgentType,
  matchSendStart,
  isReplyMarker,
  isBroadcastMarker,
  isStatusMarker,
  isQueryMarker,
  isEndMarker,
  looksLikeInstructionEcho,
  type CommandCallback,
  type CommanderMessage,
  type MessageType,
} from '../orchestration/protocol.js';
import { resolveExecutablePath } from '../utils/command-resolution.js';
import { logger } from '../utils/logger.js';

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
  'C-q',        // quit
  'C-w',        // remove panel
  'C-o',        // orchestrate
  'C-p',        // inject protocol
  'C-b',        // template browser
  'pageup',     // scroll output
  'pagedown',   // scroll output
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
]);

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

interface ProtocolReservation {
  remaining: number;
  expiresAt: number;
}

const COMMANDER_ACTIVITY_MS = 10000;

export class TerminalPanel {
  public box: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  private outputBox: blessed.Widgets.BoxElement;
  private screen: blessed.Widgets.Screen;
  private theme: Theme;
  private config: AppConfig;
  private orchConfig: OrchestrationConfig;
  public panelIndex: number;
  private _focused = false;

  private proc: ChildProcess | null = null;
  private stdoutDecoder: StringDecoder | null = null;
  private stderrDecoder: StringDecoder | null = null;
  private vterm!: VTerm;
  private agentType: AgentType | null = null;
  private agentName = '';
  private _status: 'idle' | 'running' | 'exited' | 'error' = 'idle';
  private cwd: string;
  // renderTimer/renderPending removed — rendering is now coalesced globally via static scheduleScreenRender
  private scanner: ProtocolScanner | null = null;
  private exitHandler: (() => void) | null = null;

  // ── VTerm-based protocol scanning ────────────────────────────
  private scannerEnabled = false;
  private lastScrollbackIndex = 0;
  private gridScanTimer: ReturnType<typeof setTimeout> | null = null;
  private activeGridProtocolKeys = new Set<string>();
  private activeTailReplyKeys = new Set<string>();
  /** Recent emission keys — shared dedup between grid scan and scrollback scanner. Maps key → expiry time. */
  private recentEmissions = new Map<string, number>();
  /** Outgoing prompt blocks that should allow one real matching protocol message through, then suppress repeats. */
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
  public onExit: ((code: number | null, signal: string | null) => void) | null = null;

  /** Called when the user clicks anywhere on this panel (for focus switching). */
  public onMouseClick: (() => void) | null = null;

  /** Called when real user keystrokes are forwarded to the agent process. */
  public onUserInput: (() => void) | null = null;

  get focused(): boolean { return this._focused; }
  get status(): string { return this._status; }
  get isRunning(): boolean { return this._status === 'running'; }
  get cols(): number { return this.vterm.colCount; }
  get sessionName(): string | null { return this.agentName || null; }
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
      content: ' No agent running  |  F9=Launch',
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

  private initVTerm(): void {
    const cols = Math.max(40, (this.outputBox.width as number) - 1);
    const rows = Math.max(10, (this.outputBox.height as number) - 1);
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
      if (!this.proc?.stdin?.writable) return;
      if (!key) return;

      // Don't forward keys reserved for the UI
      const keyId = key.full || key.name;
      if (keyId && RESERVED_KEYS.has(keyId)) return;

      const data = this.keyToAnsi(ch, key);
      if (data) {
        this.proc.stdin.write(data);
        this.onUserInput?.();
        logger.debug(`Key forwarded to ${this.agentName}: ${JSON.stringify(keyId)} -> ${data.length} bytes`);
      }
    });
  }

  private setupMouse(): void {
    // Click to focus — notify parent layout
    this.box.on('click', () => {
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
      this.proc?.stdin?.write(seq);
      logger.debug(`Mouse forwarded to ${this.agentName}: ${data.action} -> ${seq.length} bytes`);
    });
  }

  /** Map a blessed keypress event to the ANSI byte sequence a real terminal would send. */
  private keyToAnsi(ch: string | undefined, key: BlessedKeyEvent): string | null {
    // Regular printable character (no ctrl/meta modifier)
    if (ch && ch.length === 1 && !key.ctrl && !key.meta) {
      return ch;
    }

    const name: string = key.name || '';

    // Enter / Return
    if (name === 'enter' || name === 'return') return '\r';
    // Backspace
    if (name === 'backspace') return '\x7f';
    // Escape (only if not part of a reserved combo)
    if (name === 'escape') return '\x1b';
    // Delete
    if (name === 'delete') return '\x1b[3~';
    // Insert
    if (name === 'insert') return '\x1b[2~';

    // Arrow keys
    if (name === 'up') return '\x1b[A';
    if (name === 'down') return '\x1b[B';
    if (name === 'right') return '\x1b[C';
    if (name === 'left') return '\x1b[D';

    // Home / End
    if (name === 'home') return '\x1b[H';
    if (name === 'end') return '\x1b[F';

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

  launchAgent(
    agentType: AgentType,
    agentName: string,
    command: string,
    args: string[] = [],
    env: Record<string, string> = {},
  ): boolean {
    if (this.proc) this.killAgent();

    this.agentType = agentType;
    this.agentName = agentName;
    this._status = 'running';
    this.initVTerm();
    this.exitHandler = null;
    this.userScrolled = false;

    return this.launchSession(command, args, env, true);
  }

  launchCommand(
    label: string,
    command: string,
    args: string[] = [],
    env: Record<string, string> = {},
    options?: { onExit?: () => void },
  ): boolean {
    if (this.proc) this.killAgent(true);

    this.agentType = null;
    this.agentName = label;
    this._status = 'running';
    this.initVTerm();
    this.exitHandler = options?.onExit ?? null;
    this.userScrolled = false;

    return this.launchSession(command, args, env, false);
  }

  private launchSession(
    command: string,
    args: string[],
    env: Record<string, string>,
    enableProtocolScanner: boolean,
  ): boolean {
    const cols = Math.max(40, (this.outputBox.width as number) - 1);
    const rows = Math.max(10, (this.outputBox.height as number) - 1);

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

    const spawnEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) spawnEnv[k] = v;
    }
    Object.assign(spawnEnv, env);
    spawnEnv['TERM'] = 'xterm-256color';
    spawnEnv['FORCE_COLOR'] = '1';
    spawnEnv['COLUMNS'] = String(cols);
    spawnEnv['LINES'] = String(rows);
    spawnEnv['PWD'] = this.cwd;

    try {
      const helperPath = this.findPtyHelper();

      this.proc = spawn('python3', [helperPath, '--cwd', this.cwd, '--', resolvedPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: spawnEnv,
      });
      this.stdoutDecoder = new StringDecoder('utf8');
      this.stderrDecoder = new StringDecoder('utf8');

      logger.info(`Terminal session launched: ${this.agentName} pid=${this.proc.pid}`);

      this.proc.stdin?.on('error', (err: Error) => {
        logger.error(`stdin pipe error for ${this.agentName}: ${err.message}`);
      });

      // Protocol scanning now reads from VTerm (clean grid/scrollback)
      // instead of raw PTY data, avoiding TUI rendering artifacts.
      this.scannerEnabled = enableProtocolScanner;
      this.lastScrollbackIndex = 0;
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
            this.emitDeduped(msg);
          },
          { maxContentLines: this.orchConfig.maxContentLines },
        )
        : null;

      this.proc.stdout?.on('data', (data: Buffer) => {
        const text = this.decodePtyChunk(this.stdoutDecoder, data);
        if (!text) return;
        this.vterm.write(text);
        this.feedScannerFromVTerm(true); // aggressive scan on new data
        this.scheduleRender();
      });

      this.proc.stderr?.on('data', (data: Buffer) => {
        const text = this.decodePtyChunk(this.stderrDecoder, data);
        if (!text) return;
        this.vterm.write(text);
        this.feedScannerFromVTerm(true);
        this.scheduleRender();
      });

      this.proc.on('error', (err: Error) => {
        this._status = 'error';
        this.vterm.write(`\r\nProcess error: ${err.message}\r\n`);
        this.updateHeader();
        this.proc = null;
        this.scheduleRender();
        logger.error(`Terminal session error: ${this.agentName}`, err);
      });

      // Capture the current process reference so the close handler only
      // cleans up if THIS process is still the active one.  Without this
      // guard, killing an agent and immediately launching a new one causes
      // the old process's close event to null out the NEW scanner.
      const thisProc = this.proc;
      this.proc.on('close', (code: number | null, signal: string | null) => {
        if (this.proc === thisProc) {
          this.flushDecodedPtyStreams();
          this._status = code === 0 ? 'exited' : 'error';
          this.vterm.write(`\r\n--- ${this.agentName} exited (code=${code}, signal=${signal ?? 'none'}) ---\r\n`);
          this.updateHeader();
          this.proc = null;
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
          if (this.onExit) this.onExit(code, signal);
          this.runExitHandler();
        }
        logger.info(`Terminal session exited: ${this.agentName} code=${code} signal=${signal}`);
      });

      this.updateHeader();
      return true;
    } catch (err) {
      this._status = 'error';
      this.vterm.write(`\r\nFAILED: ${(err as Error).message}\r\n`);
      this.updateHeader();
      this.scheduleRender();
      logger.error(`Terminal launch exception: ${this.agentName}`, err as Error);
      return false;
    }
  }

  // ── VTerm-based protocol scanning ─────────────────────────────

  /**
   * Unified dedup for messages detected by BOTH the scrollback scanner
   * and the grid scan.  A message visible on the grid gets detected by
   * the grid scan first; when it later scrolls into scrollback the
   * ProtocolScanner would detect it again.  This gate prevents the
   * duplicate from reaching the Orchestrator.
   */
  private emitDeduped(msg: CommanderMessage): void {
    if (!this.onCommanderMessage) return;
    if (Date.now() < this.instructionEchoGuardUntil && looksLikeInstructionEcho(msg.content)) {
      logger.info(`Dedup[${this.panelIndex}]: suppressed echoed ${msg.type} block from protocol instructions`);
      return;
    }
    const canonical = TerminalPanel.canonicalizeContent(msg.content);
    const key = this.buildEmissionKey(msg.type, msg.targetAgent, msg.targetPanel, canonical);
    const now = Date.now();
    this.pruneExpiredEmissionKeys(now);
    this.pruneExpiredProtocolReservations(now);

    const reservation = this.protocolReservations.get(key);
    if (reservation) {
      reservation.remaining -= 1;
      if (reservation.remaining <= 0) {
        this.protocolReservations.delete(key);
      }
      this.rememberEmissionKey(
        key,
        Math.max(this.orchConfig.ackTimeout, this.orchConfig.dedupWindow * 4, this.orchConfig.injectionGrace),
      );
      this.onCommanderMessage(msg);
      return;
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
    const sbLen = this.vterm.scrollbackLength;
    while (this.lastScrollbackIndex < sbLen) {
      const plain = this.vterm.getScrollbackPlain(this.lastScrollbackIndex);
      this.scanner.feedLine(plain);
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

    const lines = this.vterm.getGridPlainLines();
    const visibleKeys = new Set<string>();
    let startIdx = -1;
    let msgType: MessageType = 'send';
    let target: { agent: string; panel: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Only look for start markers when not already collecting
      if (startIdx < 0) {
        // ── SEND:agent:panel ──
        const startMatch = matchSendStart(line);
        if (startMatch && isAgentType(startMatch[1])) {
          const panelNum = parseInt(startMatch[2], 10) - 1;
          if (panelNum >= 0 && panelNum <= 3) {
            startIdx = i;
            msgType = 'send';
            target = { agent: startMatch[1], panel: panelNum };
          }
          continue;
        }

        // ── REPLY ──
        if (isReplyMarker(line)) {
          startIdx = i;
          msgType = 'reply';
          target = null;
          continue;
        }

        // ── BROADCAST ──
        if (isBroadcastMarker(line)) {
          startIdx = i;
          msgType = 'broadcast';
          target = null;
          continue;
        }

        // ── STATUS ──
        if (isStatusMarker(line)) {
          startIdx = i;
          msgType = 'status';
          target = null;
          continue;
        }

        // ── QUERY ──
        if (isQueryMarker(line)) {
          startIdx = i;
          msgType = 'query';
          target = null;
          continue;
        }
      }

      if (startIdx >= 0 && isEndMarker(line)) {
        const content = lines.slice(startIdx + 1, i).join('\n').trim();
        const canonical = TerminalPanel.canonicalizeContent(content);
        const key = this.buildEmissionKey(
          msgType,
          (target?.agent as any) ?? 'generic',
          target?.panel ?? -1,
          canonical,
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
          });
        } else {
          this.rememberEmissionKey(key, this.orchConfig.dedupWindow);
        }

        startIdx = -1;
        target = null;
      }
    }

    this.activeGridProtocolKeys = visibleKeys;
    this.scanRenderedTailForReplies();
  }

  /** Throttled render — max 15fps to keep UI responsive. */
  private scheduleRender(): void {
    // Update this panel's content immediately (cheap — just sets DOM text)
    this.updateContent();
    // Coalesce screen.render() calls through a single global timer
    // so multiple panels don't each trigger independent full repaints
    TerminalPanel.scheduleScreenRender(this.screen);
  }

  private updateContent(): void {
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

  private findPtyHelper(): string {
    const candidates = [
      path.join(process.cwd(), 'src', 'agents', 'pty-helper.py'),
      path.join(process.cwd(), 'dist', 'agents', 'pty-helper.py'),
    ];
    try {
      const thisDir = path.dirname(fileURLToPath(import.meta.url));
      candidates.push(path.join(thisDir, '..', 'src', 'agents', 'pty-helper.py'));
      candidates.push(path.join(thisDir, '..', '..', 'src', 'agents', 'pty-helper.py'));
    } catch { /* ignore */ }

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    const fallback = path.join(os.homedir(), '.agents-commander', 'pty-helper.py');
    if (fs.existsSync(fallback)) return fallback;
    logger.error('pty-helper.py not found');
    return candidates[0];
  }

  private resolveFullPath(command: string): string | null {
    return resolveExecutablePath(command);
  }

  private updateHeader(): void {
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
    this.headerBox.setContent(` ${icon} ${this.agentName}  [${this._status}]${pid}${activity}`);
  }

  killAgent(suppressExitHandler = false): void {
    if (suppressExitHandler) {
      this.exitHandler = null;
    }
    if (this.proc) {
      const p = this.proc;
      try {
        // 1. Try SIGINT (Ctrl+C) first for graceful exit
        p.kill('SIGINT');

        // 2. Escalation sequence
        setTimeout(() => {
          if (p.exitCode === null && p.signalCode === null) {
            logger.info(`Terminal: escalating to SIGTERM for ${this.agentName}`);
            try { p.kill('SIGTERM'); } catch {}

            setTimeout(() => {
              if (p.exitCode === null && p.signalCode === null) {
                logger.info(`Terminal: escalating to SIGKILL for ${this.agentName}`);
                try { p.kill('SIGKILL'); } catch {}
              }
            }, 1000);
          }
        }, 500);
      } catch (err) {
        logger.error(`Terminal: error killing agent ${this.agentName}`, err);
      }
      this.proc = null;
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
    this.box.setLabel(` Terminal [${panelIndex + 1}] `);
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
   * Reserve complete protocol blocks in outgoing prompt text so the first real
   * matching message is allowed through, while later scrollback/grid replays
   * are still suppressed for a longer window.
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

    const lines = this.vterm.getGridPlainLines();

    // Fast path: skip regex matching if no potential markers on grid
    if (!lines.some((l) => l.includes('COMMANDER'))) {
      this.activeGridProtocolKeys.clear();
      this.activeTailReplyKeys.clear();
      return;
    }

    this.activeGridProtocolKeys = this.markProtocolLinesAsProcessed(lines, this.orchConfig.dedupWindow);
    this.activeTailReplyKeys = this.markTailRepliesAsProcessed(this.vterm.getTail(120), this.orchConfig.dedupWindow);
  }

  private markProtocolLinesAsProcessed(lines: string[], ttlMs: number): Set<string> {
    const visibleKeys = new Set<string>();
    if (!this.scannerEnabled) return visibleKeys;

    let startIdx = -1;
    let msgType: MessageType = 'send';
    let target: { agent: string; panel: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (startIdx < 0) {
        const startMatch = matchSendStart(line);
        if (startMatch && isAgentType(startMatch[1])) {
          const panelNum = parseInt(startMatch[2], 10) - 1;
          if (panelNum >= 0 && panelNum <= 3) {
            startIdx = i;
            msgType = 'send';
            target = { agent: startMatch[1], panel: panelNum };
          }
          continue;
        }
        if (isReplyMarker(line)) { startIdx = i; msgType = 'reply'; target = null; continue; }
        if (isBroadcastMarker(line)) { startIdx = i; msgType = 'broadcast'; target = null; continue; }
        if (isStatusMarker(line)) { startIdx = i; msgType = 'status'; target = null; continue; }
        if (isQueryMarker(line)) { startIdx = i; msgType = 'query'; target = null; continue; }
      }

      if (startIdx >= 0 && isEndMarker(line)) {
        const content = lines.slice(startIdx + 1, i).join('\n').trim();
        const canonical = TerminalPanel.canonicalizeContent(content);
        const key = this.buildEmissionKey(
          msgType,
          (target?.agent as any) ?? 'generic',
          target?.panel ?? -1,
          canonical,
        );
        visibleKeys.add(key);
        this.rememberEmissionKey(key, ttlMs);

        logger.debug(`Snapshot[${this.panelIndex}]: marked existing ${msgType} block as processed`);
        startIdx = -1;
        target = null;
      }
    }

    return visibleKeys;
  }

  private reserveProtocolLinesForEcho(lines: string[], ttlMs: number): void {
    if (!this.scannerEnabled) return;

    let startIdx = -1;
    let msgType: MessageType = 'send';
    let target: { agent: string; panel: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (startIdx < 0) {
        const startMatch = matchSendStart(line);
        if (startMatch && isAgentType(startMatch[1])) {
          const panelNum = parseInt(startMatch[2], 10) - 1;
          if (panelNum >= 0 && panelNum <= 3) {
            startIdx = i;
            msgType = 'send';
            target = { agent: startMatch[1], panel: panelNum };
          }
          continue;
        }
        if (isReplyMarker(line)) { startIdx = i; msgType = 'reply'; target = null; continue; }
        if (isBroadcastMarker(line)) { startIdx = i; msgType = 'broadcast'; target = null; continue; }
        if (isStatusMarker(line)) { startIdx = i; msgType = 'status'; target = null; continue; }
        if (isQueryMarker(line)) { startIdx = i; msgType = 'query'; target = null; continue; }
      }

      if (startIdx >= 0 && isEndMarker(line)) {
        const content = lines.slice(startIdx + 1, i).join('\n').trim();
        const canonical = TerminalPanel.canonicalizeContent(content);
        const key = this.buildEmissionKey(
          msgType,
          (target?.agent as any) ?? 'generic',
          target?.panel ?? -1,
          canonical,
        );
        this.rememberProtocolReservation(key, ttlMs);
        startIdx = -1;
        target = null;
      }
    }
  }

  private scanRenderedTailForReplies(): void {
    if (!this.onCommanderMessage) return;
    if (this.scanner?.isMuted) return;

    const tailLines = this.vterm.getTail(120);
    const visibleKeys = new Set<string>();
    let startIdx = -1;

    for (let i = 0; i < tailLines.length; i++) {
      const line = tailLines[i].replace(/\x1b\[[0-9;]*m/g, '');

      if (startIdx < 0) {
        if (isReplyMarker(line)) {
          startIdx = i;
        }
        continue;
      }

      if (isEndMarker(line)) {
        const content = tailLines
          .slice(startIdx + 1, i)
          .map((tailLine) => tailLine.replace(/\x1b\[[0-9;]*m/g, ''))
          .join('\n')
          .trim();
        const canonical = TerminalPanel.canonicalizeContent(content);
        const key = this.buildEmissionKey('reply', 'generic', -1, canonical);
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
          });
        } else {
          this.rememberEmissionKey(key, this.orchConfig.dedupWindow);
        }

        startIdx = -1;
      }
    }

    this.activeTailReplyKeys = visibleKeys;
  }

  private markTailRepliesAsProcessed(lines: string[], ttlMs: number): Set<string> {
    const visibleKeys = new Set<string>();
    let startIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\x1b\[[0-9;]*m/g, '');

      if (startIdx < 0) {
        if (isReplyMarker(line)) {
          startIdx = i;
        }
        continue;
      }

      if (isEndMarker(line)) {
        const content = lines
          .slice(startIdx + 1, i)
          .map((tailLine) => tailLine.replace(/\x1b\[[0-9;]*m/g, ''))
          .join('\n')
          .trim();
        const canonical = TerminalPanel.canonicalizeContent(content);
        const key = this.buildEmissionKey('reply', 'generic', -1, canonical);
        visibleKeys.add(key);
        this.rememberEmissionKey(key, ttlMs);
        startIdx = -1;
      }
    }

    return visibleKeys;
  }

  private static canonicalizeContent(content: string): string {
    return content.replace(/\s+/g, ' ').trim();
  }

  private buildEmissionKey(type: MessageType, targetAgent: string, targetPanel: number, canonical: string): string {
    return `${type}:${targetAgent}:${targetPanel}:${canonical.length}:${canonical.slice(0, 160)}`;
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
    const existing = this.protocolReservations.get(key);
    if (existing && existing.expiresAt > now) {
      existing.remaining += 1;
      if (expiryAt > existing.expiresAt) {
        existing.expiresAt = expiryAt;
      }
      return;
    }
    this.protocolReservations.set(key, { remaining: 1, expiresAt: expiryAt });
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
      if (reservation.expiresAt <= now || reservation.remaining <= 0) {
        this.protocolReservations.delete(key);
      }
    }
  }

  private schedulePendingReplyEmission(msg: CommanderMessage): void {
    if (!this.onCommanderMessage) return;
    const canonical = TerminalPanel.canonicalizeContent(msg.content);
    const key = this.buildEmissionKey(msg.type, msg.targetAgent, msg.targetPanel, canonical);
    const existing = this.pendingReplyEmissions.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const delayMs = Math.max(150, this.orchConfig.gridScanDelay * 2);
    const timer = setTimeout(() => {
      this.pendingReplyEmissions.delete(key);
      logger.debug(`ReplyFallback[${this.panelIndex}]: emitting scrollback reply after ${delayMs}ms`);
      this.emitDeduped(msg);
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

  sendInput(text: string): void {
    if (this.proc?.stdin?.writable) this.proc.stdin.write(text);
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

  setFocus(focused: boolean): void {
    this._focused = focused;
    this.box.style.border = focused ? this.theme.panel.borderFocus : this.theme.panel.border;
    if (focused) this.outputBox.focus();
    this.screen.render();
  }

  resize(position: { top: number | string; left: number | string; width: number | string; height: number | string }): void {
    this.box.top = position.top;
    this.box.left = position.left;
    this.box.width = position.width;
    this.box.height = position.height;
    const cols = Math.max(40, (this.outputBox.width as number) - 1);
    const rows = Math.max(10, (this.outputBox.height as number) - 1);
    this.vterm.resize(cols, rows);
    this.screen.render();
  }

  destroy(): void {
    this.killAgent(true);
    this.clearCommanderActivity();
    this.box.destroy();
  }
}
