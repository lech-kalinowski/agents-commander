import type { AgentType } from '../agents/types.js';
import { MAX_PANEL_NUMBER, isPanelNumber } from '../panel-limits.js';
import { logger } from '../utils/logger.js';
import { randomBytes } from 'node:crypto';

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
const CAPABILITY_SOURCE = '[A-Za-z0-9_-]{32,64}';
const CAPABILITY_RE = new RegExp(`^${CAPABILITY_SOURCE}$`);
const CAPABILITY_SEND_RE = new RegExp(
  `^={3,}COMMANDER:SEND:(\\w+):(\\d+):(${CAPABILITY_SOURCE})={3,}$`,
);
const CAPABILITY_REPLY_RE = new RegExp(
  `^={3,}COMMANDER:REPLY:(${CAPABILITY_SOURCE})={3,}$`,
);
const CAPABILITY_BROADCAST_RE = new RegExp(
  `^={3,}COMMANDER:BROADCAST:(${CAPABILITY_SOURCE})={3,}$`,
);
const CAPABILITY_STATUS_RE = new RegExp(
  `^={3,}COMMANDER:STATUS:(${CAPABILITY_SOURCE})={3,}$`,
);
const CAPABILITY_QUERY_RE = new RegExp(
  `^={3,}COMMANDER:QUERY:(${CAPABILITY_SOURCE})={3,}$`,
);
const CAPABILITY_END_RE = new RegExp(
  `^={3,}COMMANDER:END:(${CAPABILITY_SOURCE})={3,}$`,
);
const LEGACY_TEMPLATE_MARKER_BODY = String.raw`={3,}COMMANDER:(?:SEND:[^:\s=]+:[^:\s=]+|REPLY(?::[^:\s=]+:[^:\s=]+)?|BROADCAST|STATUS|QUERY|END)`;
const LEGACY_TEMPLATE_MARKER_SOURCE = `${LEGACY_TEMPLATE_MARKER_BODY}={3,}`;
const LEGACY_TEMPLATE_MARKER_RE = new RegExp(LEGACY_TEMPLATE_MARKER_SOURCE);
const LEGACY_TEMPLATE_MARKER_GLOBAL_RE = new RegExp(
  `(${LEGACY_TEMPLATE_MARKER_BODY})(={3,})`,
  'g',
);
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
  /** Per-managed-session authorization issued when Commander protocol is armed. */
  capability?: string;
}

export interface ProtocolMarkerMatch {
  /** Null denotes the legacy, unarmed marker format. */
  capability: string | null;
}

/** Generate a 256-bit, URL-safe capability for one managed agent session. */
export function generateProtocolCapability(): string {
  return randomBytes(32).toString('base64url');
}

export function isProtocolCapability(value: string): boolean {
  return CAPABILITY_RE.test(value);
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
  const normalized = normalizeMarkerLine(line);
  return normalized.match(CAPABILITY_SEND_RE) ?? normalized.match(CMD_START_RE);
}

export function isReplyMarker(line: string): boolean {
  return matchReplyMarker(line) !== null;
}

export function isBroadcastMarker(line: string): boolean {
  return matchBroadcastMarker(line) !== null;
}

export function isStatusMarker(line: string): boolean {
  return matchStatusMarker(line) !== null;
}

export function isQueryMarker(line: string): boolean {
  return matchQueryMarker(line) !== null;
}

function matchSimpleMarker(
  line: string,
  capabilityPattern: RegExp,
  legacyPattern: RegExp,
): ProtocolMarkerMatch | null {
  const normalized = normalizeMarkerLine(line);
  const capabilityMatch = normalized.match(capabilityPattern);
  if (capabilityMatch) return { capability: capabilityMatch[1] };
  return legacyPattern.test(normalized) ? { capability: null } : null;
}

export function matchReplyMarker(line: string): ProtocolMarkerMatch | null {
  return matchSimpleMarker(line, CAPABILITY_REPLY_RE, CMD_REPLY_RE);
}

export function matchBroadcastMarker(line: string): ProtocolMarkerMatch | null {
  return matchSimpleMarker(line, CAPABILITY_BROADCAST_RE, CMD_BROADCAST_RE);
}

export function matchStatusMarker(line: string): ProtocolMarkerMatch | null {
  return matchSimpleMarker(line, CAPABILITY_STATUS_RE, CMD_STATUS_RE);
}

export function matchQueryMarker(line: string): ProtocolMarkerMatch | null {
  return matchSimpleMarker(line, CAPABILITY_QUERY_RE, CMD_QUERY_RE);
}

export function matchEndMarker(line: string): ProtocolMarkerMatch | null {
  return matchSimpleMarker(line, CAPABILITY_END_RE, /^={3,}COMMANDER:END={3,}$/);
}

/**
 * Match a footer. When an expected capability is supplied, the footer must
 * carry exactly the same capability as its header. Passing null explicitly
 * limits matching to the legacy marker format.
 */
export function isEndMarker(
  line: string,
  expectedCapability?: string | null,
): boolean {
  const match = matchEndMarker(line);
  if (!match) return false;
  if (expectedCapability === undefined) return true;
  return match.capability === expectedCapability;
}

/**
 * Detect actionable legacy marker tokens in an explicitly selected template.
 * Tokens may be complete lines, inline instructions, or SEND placeholders such
 * as `<type>:<panel>`.
 */
export function hasLegacyProtocolMarkers(text: string): boolean {
  return LEGACY_TEMPLATE_MARKER_RE.test(text);
}

/**
 * Bind legacy marker lines in an explicitly selected prompt template to the
 * current session capability. Arbitrary tasks never pass through this helper.
 */
export function bindTemplateProtocolCapability(text: string, capability: string): string {
  if (!isProtocolCapability(capability)) {
    throw new Error('Commander protocol capability is invalid');
  }
  return text
    .replaceAll('<session-key>', capability)
    .replace(
      LEGACY_TEMPLATE_MARKER_GLOBAL_RE,
      (_match, marker: string, suffix: string) => {
        const canonicalMarker = marker.replace(
          /COMMANDER:REPLY:[^:\s=]+:[^:\s=]+$/u,
          'COMMANDER:REPLY',
        );
        return `${canonicalMarker}:${capability}${suffix}`;
      },
    );
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
  private collectCapability: string | null = null;
  private target: { agent: AgentType; panel: number } | null = null;
  private contentLines: string[] = [];
  private contentBytes = 0;
  private rawProbeTail = '';
  private maxContentLines: number;
  private maxContentBytes: number;

  constructor(
    private sourcePanel: number,
    private sourceAgent: string,
    private onMessage: CommandCallback,
    options?: { maxContentLines?: number; maxContentBytes?: number },
  ) {
    this.maxContentLines = options?.maxContentLines ?? 500;
    this.maxContentBytes = options?.maxContentBytes ?? 262144;
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
    // Record marker-like activity without persisting agent-produced content.
    if (line.includes('COMMANDER') || line.includes('===')) {
      logger.debug(`Scanner[${this.sourcePanel}] potential marker line (${Buffer.byteLength(line, 'utf8')} bytes)`);
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
          logger.debug(`Scanner[${this.sourcePanel}] ignoring marker with unknown agent type`);
          return;
        }
        const panelNumber = Number(startMatch[2]);
        if (!isPanelNumber(panelNumber)) {
          logger.debug(`Scanner[${this.sourcePanel}] ignoring marker with invalid panel number`);
          return;
        }
        const panelNum = panelNumber - 1;
        this.collecting = true;
        this.collectType = 'send';
        this.collectCapability = startMatch[3] ?? null;
        this.target = { agent: startMatch[1], panel: panelNum };
        this.contentLines = [];
        this.contentBytes = 0;
        return;
      }

      // ── REPLY ──
      const replyMarker = matchReplyMarker(line);
      if (replyMarker) {
        this.collecting = true;
        this.collectType = 'reply';
        this.collectCapability = replyMarker.capability;
        this.target = null;
        this.contentLines = [];
        this.contentBytes = 0;
        return;
      }

      // ── BROADCAST ──
      const broadcastMarker = matchBroadcastMarker(line);
      if (broadcastMarker) {
        this.collecting = true;
        this.collectType = 'broadcast';
        this.collectCapability = broadcastMarker.capability;
        this.target = null;
        this.contentLines = [];
        this.contentBytes = 0;
        return;
      }

      // ── STATUS ──
      const statusMarker = matchStatusMarker(line);
      if (statusMarker) {
        this.collecting = true;
        this.collectType = 'status';
        this.collectCapability = statusMarker.capability;
        this.target = null;
        this.contentLines = [];
        this.contentBytes = 0;
        return;
      }

      // ── QUERY ──
      const queryMarker = matchQueryMarker(line);
      if (queryMarker) {
        this.collecting = true;
        this.collectType = 'query';
        this.collectCapability = queryMarker.capability;
        this.target = null;
        this.contentLines = [];
        this.contentBytes = 0;
        return;
      }
    }

    // Check for end marker (lenient: allow extra = signs, whitespace)
    if (this.collecting && isEndMarker(line, this.collectCapability)) {
      const content = this.contentLines.join('\n').trim();
      this.onMessage({
        type: this.collectType,
        sourcePanel: this.sourcePanel,
        sourceAgent: this.sourceAgent,
        targetAgent: this.target?.agent as AgentType ?? 'generic',
        targetPanel: this.target?.panel ?? -1,
        content,
        ...(this.collectCapability ? { capability: this.collectCapability } : {}),
      });
      this.collecting = false;
      this.collectType = 'send';
      this.collectCapability = null;
      this.target = null;
      this.contentLines = [];
      this.contentBytes = 0;
      return;
    }

    // Collect content lines
    if (this.collecting) {
      this.contentLines.push(line);
      this.contentBytes += Buffer.byteLength(line, 'utf8') + 1;
      // Safety: don't collect forever or retain an unbounded payload.
      if (
        this.contentLines.length > this.maxContentLines
        || this.contentBytes > this.maxContentBytes
      ) {
        this.collecting = false;
        this.collectCapability = null;
        this.target = null;
        this.contentLines = [];
        this.contentBytes = 0;
      }
    }
  }

  private mightContainMarker(raw: string): boolean {
    return raw.includes(MARKER_HINT) || raw.includes(MARKER_FALLBACK_HINT);
  }
}

// ── Protocol instructions template ────────────────────────────────
/**
 * @deprecated Pass an explicit session capability as the fourth argument so
 * the caller can bind these instructions to the session it arms. This
 * compatibility overload still emits capability-bound instructions using a
 * newly generated capability; it never falls back to legacy static markers.
 */
export function buildProtocolInstructions(
  myPanel: number,
  myAgent: string,
  otherAgents: { name: string; type: string; panel: number }[],
): string;

/** Build Commander instructions bound to an explicit managed-session capability. */
export function buildProtocolInstructions(
  myPanel: number,
  myAgent: string,
  otherAgents: { name: string; type: string; panel: number }[],
  capability: string,
): string;

export function buildProtocolInstructions(
  myPanel: number,
  myAgent: string,
  otherAgents: { name: string; type: string; panel: number }[],
  capability?: string,
): string {
  const effectiveCapability = capability === undefined
    ? generateProtocolCapability()
    : capability;
  if (!isProtocolCapability(effectiveCapability)) {
    throw new Error('Commander protocol capability is invalid');
  }
  const others = otherAgents.length > 0
    ? otherAgents.map((a) => `  - ${a.name} in Panel ${a.panel + 1} (${a.type})`).join('\n')
    : '  (none currently running)';

  return [
    `[Agents Commander] You are ${myAgent} in Panel ${myPanel + 1}.`,
    others.includes('none') ? '' : `Other agents:\n${others}`,
    ``,
    `Use Commander protocol only when the user explicitly asks you to coordinate, or when Commander delivers [From ...] / [Broadcast from ...] to you.`,
    `Do not send startup broadcasts, self-check queries, or status pings on your own right after reading these instructions.`,
    `Protocol capability: ${effectiveCapability}. Include it on every protocol header and footer exactly as shown below.`,
    ``,
    `To message another agent, output exactly 3 lines:`,
    `  1) header: three "=" + "COMMANDER:SEND:<type>:<panel>:${effectiveCapability}" + three "="`,
    `  2) body: your message text`,
    `  3) footer: three "=" + "COMMANDER:END:${effectiveCapability}" + three "="`,
    `Types: claude, codex, gemini, aider, cline, opencode, goose, kiro, amp, generic. Panel numbers: 1-${MAX_PANEL_NUMBER}.`,
    ``,
    `Other line-1 headers:`,
    `  REPLY     -> COMMANDER:REPLY:${effectiveCapability}        (auto-routes to whoever messaged you)`,
    `  BROADCAST -> COMMANDER:BROADCAST:${effectiveCapability}`,
    `  STATUS    -> COMMANDER:STATUS:${effectiveCapability}`,
    `  QUERY     -> COMMANDER:QUERY:${effectiveCapability}`,
    `Query values: agents, panels, status, help, ping`,
    ``,
    `SEND, REPLY, BROADCAST, and STATUS produce a Commander ACK in your panel. QUERY returns Commander info directly.`,
    `Wait for that ACK or response before sending another message.`,
    `When you receive [From ... | thread=... | msg=...], use REPLY to continue that thread.`,
    `Do NOT use protocol markers to acknowledge receipt unless you are sending a real reply.`,
  ].filter(Boolean).join('\n');
}
