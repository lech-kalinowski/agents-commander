import type { AgentType } from '../agents/types.js';
import { logger } from '../utils/logger.js';

const VALID_AGENT_TYPES = new Set([
  'claude',
  'codex',
  'gemini',
  'aider',
  'cline',
  'opencode',
  'goose',
  'kiro',
  'amp',
  'generic',
]);

export function isAgentType(value: string): value is AgentType {
  return VALID_AGENT_TYPES.has(value);
}

// ── Protocol markers ──────────────────────────────────────────────
// Marker lines must remain strict, but we allow a narrow set of terminal/UI
// prefixes that some agent CLIs render before user-authored content.
export const CMD_START_RE = /^={3,}COMMANDER:SEND:(\w+):(\d+)={3,}$/;
export const CMD_REPLY_RE = /^={3,}COMMANDER:REPLY(?::\w+:\d+)?={3,}$/;
export const CMD_BROADCAST_RE = /^={3,}COMMANDER:BROADCAST={3,}$/;
export const CMD_STATUS_RE = /^={3,}COMMANDER:STATUS={3,}$/;
export const CMD_QUERY_RE = /^={3,}COMMANDER:QUERY={3,}$/;
export const CMD_END_MARKER = '===COMMANDER:END===';
const UI_PREFIX_RE = /^\s*(?:[•●◦▪▌◆▶▸▹▻➜➤│┃┆┇┊┋║╽╿╎╏✦✧★☆⏺⏵⏷⏶]+\s*)+/;
const MARKER_HINT = 'COMMANDER';
const MARKER_FALLBACK_HINT = '===';
const RAW_LOOKBACK = 64;
const INSTRUCTION_ECHO_HINTS = [
  '[agents commander] you are',
  'to message another agent, output a 3-line block',
  'other commands (same 3-line format',
  'query values: agents, panels, status, help, ping',
  'structured ack with msg/thread ids',
  'do not use protocol markers to acknowledge receipt',
];

// ── Types ─────────────────────────────────────────────────────────
export type MessageType = 'send' | 'reply' | 'broadcast' | 'status' | 'query';

export interface CommanderMessage {
  type: MessageType;
  sourcePanel: number;
  sourceAgent: string;
  targetAgent: AgentType;
  targetPanel: number;
  content: string;
}

export function normalizeMarkerLine(line: string): string {
  const normalized = line.replace(UI_PREFIX_RE, '').trim();
  const markerIndex = normalized.indexOf('===COMMANDER:');
  if (markerIndex > 0) {
    const prefix = normalized.slice(0, markerIndex);
    if (/^[A-Z]{1,2}$/.test(prefix)) {
      return normalized.slice(markerIndex).trim();
    }
  }
  return normalized;
}

export function matchSendStart(line: string): RegExpMatchArray | null {
  return normalizeMarkerLine(line).match(CMD_START_RE);
}

export function isReplyMarker(line: string): boolean {
  return CMD_REPLY_RE.test(normalizeMarkerLine(line));
}

export function isBroadcastMarker(line: string): boolean {
  return CMD_BROADCAST_RE.test(normalizeMarkerLine(line));
}

export function isStatusMarker(line: string): boolean {
  return CMD_STATUS_RE.test(normalizeMarkerLine(line));
}

export function isQueryMarker(line: string): boolean {
  return CMD_QUERY_RE.test(normalizeMarkerLine(line));
}

export function isEndMarker(line: string): boolean {
  return /^={3,}COMMANDER:END={3,}$/.test(normalizeMarkerLine(line));
}

export function looksLikeInstructionEcho(content: string): boolean {
  const normalized = content.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;

  const markerMentions = (normalized.match(/commander:/g) ?? []).length;
  if (markerMentions >= 2) return true;

  const matchedHints = INSTRUCTION_ECHO_HINTS.filter((hint) => normalized.includes(hint)).length;
  if (matchedHints >= 1 && markerMentions >= 1) return true;
  if (matchedHints >= 2) return true;

  return false;
}

// ── ANSI stripper (for scanning raw PTY data) ─────────────────────
export function stripAnsi(text: string): string {
  return text
    // CSI sequences: ESC [ ... letter
    .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, '')
    // OSC sequences: ESC ] ... (BEL or ST)
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    // Character set: ESC ( X, ESC ) X
    .replace(/\x1b[()][A-Z0-9]/g, '')
    // Simple escapes: ESC =, ESC >, ESC c, ESC M, etc.
    .replace(/\x1b[=>cMNO78]/g, '')
    // SS2/SS3
    .replace(/\x1b[NO]./g, '');
}

// ── Output scanner ────────────────────────────────────────────────
export type CommandCallback = (msg: CommanderMessage) => void;

/**
 * Stateful scanner that buffers stripped text from agent output
 * and detects COMMANDER protocol blocks.
 */
export class ProtocolScanner {
  private buffer = '';
  private collecting = false;
  private collectType: MessageType = 'send';
  private target: { agent: AgentType; panel: number } | null = null;
  private contentLines: string[] = [];
  private rawProbeTail = '';
  private maxContentLines: number;

  constructor(
    private sourcePanel: number,
    private sourceAgent: string,
    private onMessage: CommandCallback,
    options?: { maxContentLines?: number },
  ) {
    this.maxContentLines = options?.maxContentLines ?? 500;
  }

  private mutedUntil = 0;

  /**
   * Extend the mute window.  If the new deadline is earlier than an
   * existing mute, the call is a no-op — this prevents a short mute
   * (e.g. from an ACK) from accidentally shortening a longer mute
   * (e.g. from task execution).
   */
  mute(durationMs: number): void {
    const newEnd = Date.now() + durationMs;
    if (newEnd > this.mutedUntil) {
      this.mutedUntil = newEnd;
    }
  }

  /** Force-unmute regardless of remaining mute duration. */
  unmute(): void {
    this.mutedUntil = 0;
  }

  /** True if the scanner is currently muted. */
  get isMuted(): boolean {
    return Date.now() < this.mutedUntil;
  }

  /** Feed a single pre-cleaned line (no ANSI, no splitting needed). */
  feedLine(line: string): void {
    if (Date.now() < this.mutedUntil) return;
    this.processLine(line);
  }

  /** Feed raw PTY data (may contain ANSI codes). */
  feed(raw: string): void {
    if (Date.now() < this.mutedUntil) return;
    const rawInput = (!this.collecting && this.buffer.length === 0)
      ? `${this.rawProbeTail}${raw}`
      : raw;

    if (!this.collecting && this.buffer.length === 0 && !this.mightContainMarker(rawInput)) {
      this.rawProbeTail = rawInput.slice(-RAW_LOOKBACK);
      return;
    }

    const clean = rawInput.includes('\x1b') ? stripAnsi(rawInput) : rawInput;
    this.rawProbeTail = '';
    this.buffer += clean;

    // Process line by line (keep incomplete last line in buffer)
    let nlIdx: number;
    while ((nlIdx = this.buffer.indexOf('\n')) !== -1) {
      // Strip carriage returns and other control chars that PTY output may contain
      const line = this.buffer.slice(0, nlIdx).replace(/[\r\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
      this.buffer = this.buffer.slice(nlIdx + 1);
      this.processLine(line);
    }
    // Also check buffer for markers without trailing newline
    if (this.buffer.length > 5000) {
      this.processLine(this.buffer);
      this.buffer = '';
    }

    if (!this.collecting && this.buffer.length === 0) {
      this.rawProbeTail = rawInput.slice(-RAW_LOOKBACK);
    }
  }

  updateSource(panel: number, agent: string): void {
    this.sourcePanel = panel;
    this.sourceAgent = agent;
  }

  private processLine(line: string): void {
    // Log lines that look like they might be Commander markers (for debugging)
    if (line.includes('COMMANDER') || line.includes('===')) {
      logger.debug(`Scanner[${this.sourcePanel}] potential marker line: ${JSON.stringify(line.slice(0, 120))}`);
    }

    // Check for start markers — only when NOT already collecting.
    // Nested START markers inside a block are treated as content,
    // not as a new collection (prevents template examples from
    // hijacking an in-progress message).
    if (!this.collecting) {
      // ── SEND:agent:panel ──
      const startMatch = matchSendStart(line);
      if (startMatch) {
        if (!isAgentType(startMatch[1])) {
          logger.debug(`Scanner[${this.sourcePanel}] ignoring unknown agent type: ${startMatch[1]}`);
          return;
        }
        const panelNum = parseInt(startMatch[2], 10) - 1;
        if (panelNum < 0 || panelNum > 3) {
          logger.debug(`Scanner[${this.sourcePanel}] ignoring invalid panel number: ${startMatch[2]}`);
          return;
        }
        this.collecting = true;
        this.collectType = 'send';
        this.target = { agent: startMatch[1], panel: panelNum };
        this.contentLines = [];
        return;
      }

      // ── REPLY ──
      if (isReplyMarker(line)) {
        this.collecting = true;
        this.collectType = 'reply';
        this.target = null;
        this.contentLines = [];
        return;
      }

      // ── BROADCAST ──
      if (isBroadcastMarker(line)) {
        this.collecting = true;
        this.collectType = 'broadcast';
        this.target = null;
        this.contentLines = [];
        return;
      }

      // ── STATUS ──
      if (isStatusMarker(line)) {
        this.collecting = true;
        this.collectType = 'status';
        this.target = null;
        this.contentLines = [];
        return;
      }

      // ── QUERY ──
      if (isQueryMarker(line)) {
        this.collecting = true;
        this.collectType = 'query';
        this.target = null;
        this.contentLines = [];
        return;
      }
    }

    // Check for end marker (lenient: allow extra = signs, whitespace)
    if (this.collecting && isEndMarker(line)) {
      const content = this.contentLines.join('\n').trim();
      this.onMessage({
        type: this.collectType,
        sourcePanel: this.sourcePanel,
        sourceAgent: this.sourceAgent,
        targetAgent: this.target?.agent as AgentType ?? 'generic',
        targetPanel: this.target?.panel ?? -1,
        content,
      });
      this.collecting = false;
      this.collectType = 'send';
      this.target = null;
      this.contentLines = [];
      return;
    }

    // Collect content lines
    if (this.collecting) {
      this.contentLines.push(line);
      // Safety: don't collect forever
      if (this.contentLines.length > this.maxContentLines) {
        this.collecting = false;
        this.target = null;
        this.contentLines = [];
      }
    }
  }

  private mightContainMarker(raw: string): boolean {
    return raw.includes(MARKER_HINT) || raw.includes(MARKER_FALLBACK_HINT);
  }
}

// ── Protocol instructions template ────────────────────────────────
export function buildProtocolInstructions(
  myPanel: number,
  myAgent: string,
  otherAgents: { name: string; type: string; panel: number }[],
): string {
  const others = otherAgents.length > 0
    ? otherAgents.map((a) => `  - ${a.name} in Panel ${a.panel + 1} (${a.type})`).join('\n')
    : '  (none currently running)';

  return [
    `[Agents Commander] You are ${myAgent} in Panel ${myPanel + 1}.`,
    others.includes('none') ? '' : `Other agents:\n${others}`,
    ``,
    `Use Commander protocol only when the user explicitly asks you to coordinate, or when Commander delivers [From ...] / [Broadcast from ...] to you.`,
    `Do not send startup broadcasts, self-check queries, or status pings on your own right after reading these instructions.`,
    ``,
    `To message another agent, output exactly 3 lines:`,
    `  1) header: three "=" + "COMMANDER:SEND:<type>:<panel>" + three "="`,
    `  2) body: your message text`,
    `  3) footer: three "=" + "COMMANDER:END" + three "="`,
    `Types: claude, codex, gemini, aider, cline, opencode, goose, kiro, amp, generic. Panels: 1-4.`,
    ``,
    `Other line-1 headers (no :type:panel — just the keyword between "=" signs):`,
    `  REPLY     -> COMMANDER:REPLY        (auto-routes to whoever messaged you)`,
    `  BROADCAST -> COMMANDER:BROADCAST`,
    `  STATUS    -> COMMANDER:STATUS`,
    `  QUERY     -> COMMANDER:QUERY`,
    `Query values: agents, panels, status, help, ping`,
    ``,
    `SEND, REPLY, BROADCAST, and STATUS produce a Commander ACK in your panel. QUERY returns Commander info directly.`,
    `Wait for that ACK or response before sending another message.`,
    `When you receive [From ... | thread=... | msg=...], use REPLY to continue that thread.`,
    `Do NOT use protocol markers to acknowledge receipt unless you are sending a real reply.`,
  ].filter(Boolean).join('\n');
}
