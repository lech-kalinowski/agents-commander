import type { AgentType } from '../agents/types.js';
import { MAX_PANEL_NUMBER, isPanelNumber } from '../panel-limits.js';
import { logger } from '../utils/logger.js';
import { createHash, randomBytes } from 'node:crypto';

const VALID_AGENT_TYPES = new Set([
  'claude',
  'codex',
  'antigravity',
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
const OPTIONAL_SEQUENCE_SOURCE = '(?::(\\d+))?';
const CAPABILITY_SEND_RE = new RegExp(
  `^={3,}COMMANDER:SEND:(\\w+):(\\d+):(${CAPABILITY_SOURCE})${OPTIONAL_SEQUENCE_SOURCE}={3,}$`,
);
const CAPABILITY_REPLY_RE = new RegExp(
  `^={3,}COMMANDER:REPLY:(${CAPABILITY_SOURCE})${OPTIONAL_SEQUENCE_SOURCE}={3,}$`,
);
const CAPABILITY_BROADCAST_RE = new RegExp(
  `^={3,}COMMANDER:BROADCAST:(${CAPABILITY_SOURCE})${OPTIONAL_SEQUENCE_SOURCE}={3,}$`,
);
const CAPABILITY_STATUS_RE = new RegExp(
  `^={3,}COMMANDER:STATUS:(${CAPABILITY_SOURCE})${OPTIONAL_SEQUENCE_SOURCE}={3,}$`,
);
const CAPABILITY_QUERY_RE = new RegExp(
  `^={3,}COMMANDER:QUERY:(${CAPABILITY_SOURCE})${OPTIONAL_SEQUENCE_SOURCE}={3,}$`,
);
const CAPABILITY_END_RE = new RegExp(
  `^={3,}COMMANDER:END:(${CAPABILITY_SOURCE})${OPTIONAL_SEQUENCE_SOURCE}={3,}$`,
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
const MAX_PENDING_MARKER_BYTES = 5000;
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
  /** Positive per-session emission identity; unchanged when a CLI redraws history. */
  sequence?: number;
}

/** A complete authenticated SEND that must never enter the routing queue. */
export type RejectedCommanderMessage = Omit<CommanderMessage, 'type' | 'targetAgent'> & {
  type: 'send';
  targetAgent: string;
  rejection: 'unknown_agent_type';
};

export type ProtocolEvent = CommanderMessage | RejectedCommanderMessage;

export type ProtocolIssueCode = 'missing-header-delimiter' | 'missing-footer-delimiter'
  | 'missing-both-delimiters' | 'mismatched-sequence' | 'invalid-sequence'
  | 'invalid-panel' | 'invalid-header' | 'oversized-frame' | 'missing-footer';

/** Internal identity only. Never interpolate capability or model text into feedback. */
export interface ProtocolIssue {
  code: ProtocolIssueCode;
  capability: string;
  sequences: number[];
  /** Fixed-size digest of structural markers, never the message body. */
  fingerprint: string;
}

/** Bound diagnostic tokens; never treat model/profile labels as adapter aliases. */
export function isReportableUnknownAgentType(value: string): boolean {
  return /^\w{1,32}$/.test(value) && !isAgentType(value);
}

export interface ProtocolMarkerMatch {
  /** Null denotes the legacy, unarmed marker format. */
  capability: string | null;
  sequence?: number;
}

/** Physical output, not prompt text. Cursor provenance never grants authorization. */
export interface ProtocolTerminalRow {
  text: string;
  wrapsToNext: boolean;
  startsAfterCursorMove?: boolean;
  /** Only immutable primary scrollback may opt in; live grid rows are mutable. */
  finalized?: boolean;
}

/** Strict START eligibility shared by cursor-redraw recovery and the parser. */
function authenticatedStart(line: string, capability: string): ProtocolMarkerMatch | null {
  const send = matchSendStart(line);
  if (send && send[3] === capability && isPanelNumber(Number(send[2]))
    && (isAgentType(send[1]) || isReportableUnknownAgentType(send[1]))) {
    return { capability, ...(send[4] === undefined ? {} : { sequence: Number(send[4]) }) };
  }
  for (const match of [matchReplyMarker, matchBroadcastMarker, matchStatusMarker, matchQueryMarker]) {
    const marker = match(line);
    if (marker?.capability === capability) return marker;
  }
  return null;
}

/** Suppression only: quoted/inline prompt markers must not gain authorship on repaint. */
export function promptProtocolSequences(text: string, capability: string): number[] {
  const sequences = new Set<number>();
  let offset = 0;
  while ((offset = text.indexOf('===COMMANDER:', offset)) !== -1) {
    // Search the literal prefix once. The anchored body stops at '=' (also
    // the start of every next candidate), so candidates cannot repeatedly
    // traverse a shared suffix. Preserve accepted zero-padded panel fields.
    const token = text.slice(offset).match(/^===COMMANDER:[^\s=]+=*/)?.[0];
    offset += '===COMMANDER:'.length;
    if (!token) continue;
    const marker = authenticatedStart(token, capability) ?? matchEndMarker(token);
    if (marker?.capability === capability && marker.sequence !== undefined) sequences.add(marker.sequence);
    // Suppression is deliberately more conservative than execution: malformed
    // examples pasted into a CLI must not become eligible after a repaint.
    const malformed = inspectDiagnosticMarker(token, capability);
    if (malformed?.sequence !== undefined) sequences.add(malformed.sequence);
  }
  return [...sequences];
}

interface DiagnosticMarker {
  command: string;
  closed: boolean;
  sequence?: number;
  sequenceIdentity: string;
  issue?: ProtocolIssueCode;
  digest: string;
}

/** Anchored, capability-authenticated structural recognition; never authorization. */
function inspectDiagnosticMarker(line: string, capability: string): DiagnosticMarker | null {
  const normalized = normalizeMarkerLine(line);
  if (normalized.length > MAX_PENDING_MARKER_BYTES) return null;
  const match = normalized.match(/^={3,}COMMANDER:([A-Z]{1,32}):([^\s=]+)(=*)$/);
  if (!match) return null;
  const fields = match[2].split(':');
  const capabilityIndex = fields.indexOf(capability);
  if (capabilityIndex < 0 || fields.lastIndexOf(capability) !== capabilityIndex) return null;
  const sequenceToken = fields[capabilityIndex + 1];
  const sequence = sequenceToken === undefined ? null : parseProtocolSequence(sequenceToken);
  const command = match[1];
  let issue: ProtocolIssueCode | undefined;
  if (sequenceToken !== undefined && sequence === null) issue = 'invalid-sequence';
  const expectedCapabilityIndex = command === 'SEND' ? 2 : 0;
  if (!['SEND', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY', 'END'].includes(command)
    || capabilityIndex !== expectedCapabilityIndex
    || fields.length > capabilityIndex + 2) issue = 'invalid-header';
  if (command === 'SEND' && capabilityIndex === 2) {
    if (!/^\d+$/.test(fields[1]) || !isPanelNumber(Number(fields[1]))) issue = 'invalid-panel';
    if (!/^\w{1,32}$/.test(fields[0])) issue = 'invalid-header';
  }
  return {
    command, closed: match[3].length >= 3,
    sequenceIdentity: sequenceToken === undefined ? '' : createHash('sha256').update(sequenceToken).digest('hex'),
    ...(sequence === null ? {} : { sequence }), ...(issue ? { issue } : {}),
    digest: createHash('sha256').update(normalized).digest('hex'),
  };
}

interface DiagnosticFrame {
  header: DiagnosticMarker;
  sequences: Set<number>;
  nestedSequences: Set<string>;
  pendingFooter: DiagnosticMarker | null;
  lines: number;
  bytes: number;
  oversized: boolean;
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
  const capabilityMatch = normalized.match(CAPABILITY_SEND_RE);
  if (capabilityMatch) {
    if (capabilityMatch[4] !== undefined && parseProtocolSequence(capabilityMatch[4]) === null) return null;
    return capabilityMatch;
  }
  return normalized.match(CMD_START_RE);
}

/** Parse canonical positive decimal integers without lossy numeric coercion. */
function parseProtocolSequence(value: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(value)) return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) ? sequence : null;
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
  if (capabilityMatch) {
    if (capabilityMatch[2] === undefined) return { capability: capabilityMatch[1] };
    const sequence = parseProtocolSequence(capabilityMatch[2]);
    // Do not fall through to legacy REPLY:<type>:<panel> for a malformed
    // capability-bound sequence: that would silently downgrade its identity.
    return sequence === null ? null : { capability: capabilityMatch[1], sequence };
  }
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
 * carry exactly the same capability and sequence as its header. Omitting the
 * expected sequence permits only a non-sequenced footer in this comparison.
 * Passing null explicitly limits matching to the legacy marker format; calling
 * with only a line detects any valid footer without comparing a header.
 */
export function isEndMarker(
  line: string,
  expectedCapability?: string | null,
  expectedSequence?: number,
): boolean {
  const match = matchEndMarker(line);
  if (!match) return false;
  if (expectedCapability !== undefined && match.capability !== expectedCapability) return false;
  if (expectedCapability !== undefined || expectedSequence !== undefined) {
    return match.sequence === expectedSequence;
  }
  return true;
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

/** All scanner paths count each logical body line with its terminating LF. */
export function isWithinProtocolContentBudget(
  lineCount: number,
  byteCount: number,
  maxContentLines = 500,
  maxContentBytes = 262144,
): boolean {
  return lineCount <= maxContentLines && byteCount <= maxContentBytes;
}

/**
 * Stateful scanner that buffers stripped text from agent output
 * and detects COMMANDER protocol blocks.
 */
export class ProtocolScanner {
  private bufferParts: string[] = [];
  private bufferBytes = 0;
  private bufferEndsInHighSurrogate = false;
  private pendingFinalized = true;
  private discardingLine = false;
  private collecting = false;
  private collectType: MessageType = 'send';
  private collectCapability: string | null = null;
  private collectSequence: number | undefined;
  private expectedCapability: string | null = null;
  private target: { agent: string; panel: number } | null = null;
  private contentLines: string[] = [];
  private contentBytes = 0;
  private rawProbeTail = '';
  private repaintCandidate: { parts: string[]; bytes: number; finalized: boolean } | null = null;
  private diagnosticFrame: DiagnosticFrame | null = null;
  private diagnosticExhausted = false;
  private maxContentLines: number;
  private maxContentBytes: number;

  constructor(
    private sourcePanel: number,
    private sourceAgent: string,
    private onMessage: CommandCallback,
    private options?: {
      maxContentLines?: number;
      maxContentBytes?: number;
      onRejected?: (msg: RejectedCommanderMessage) => void;
      onMalformed?: (issue: ProtocolIssue) => void;
      logPotentialMarkers?: boolean;
    },
  ) {
    this.maxContentLines = options?.maxContentLines ?? 500;
    this.maxContentBytes = options?.maxContentBytes ?? 262144;
  }

  private mutedUntil = 0;

  /** Explicit key rotation discards partial old output, but preserves muting. */
  setProtocolCapability(capability: string): void {
    if (!isProtocolCapability(capability)) throw new Error('Invalid protocol capability');
    if (this.expectedCapability === capability) return;
    this.expectedCapability = capability;
    this.collecting = false;
    this.collectCapability = null;
    this.collectSequence = undefined;
    this.target = null;
    this.contentLines = [];
    this.contentBytes = 0;
    this.clearPendingLine();
    this.rawProbeTail = '';
    this.discardingLine = false;
    this.repaintCandidate = null;
    this.diagnosticFrame = null;
    this.diagnosticExhausted = false;
  }

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
  feedLine(line: string, finalized = true): void {
    if (Date.now() < this.mutedUntil) return;
    this.processLine(line, finalized);
  }

  /**
   * Recover an explicitly repainted header from a stale incoming wrap link.
   * Never split natural soft wraps, unauthenticated output or a nested frame.
   * Retained logical text is still parsed first so a wrapped outer header wins.
   */
  feedTerminalRow(row: ProtocolTerminalRow): void {
    if (this.isMuted) return;
    const finalized = row.finalized === true;
    if (this.repaintCandidate) {
      const candidate = this.repaintCandidate;
      candidate.parts.push(row.text);
      candidate.bytes += Buffer.byteLength(row.text, 'utf8');
      candidate.finalized &&= finalized;
      if (row.wrapsToNext && candidate.bytes <= MAX_PENDING_MARKER_BYTES) return;
      this.repaintCandidate = null;
      this.feedTerminalRow({ text: candidate.parts.join(''), wrapsToNext: row.wrapsToNext,
        startsAfterCursorMove: candidate.bytes <= MAX_PENDING_MARKER_BYTES, finalized: candidate.finalized });
      return;
    }
    if (this.bufferBytes === 0) this.rawProbeTail = '';
    const normalized = normalizeMarkerLine(row.text);
    if (row.startsAfterCursorMove && row.wrapsToNext && this.expectedCapability && !this.collecting && !this.diagnosticFrame
      && !this.discardingLine && !authenticatedStart(row.text, this.expectedCapability)
      && Buffer.byteLength(row.text, 'utf8') <= MAX_PENDING_MARKER_BYTES
      && (normalized.startsWith('===COMMANDER:') || (normalized.length > 0 && '===COMMANDER:'.startsWith(normalized)))) {
      this.repaintCandidate = { parts: [row.text], bytes: Buffer.byteLength(row.text, 'utf8'), finalized };
      return;
    }
    if (row.startsAfterCursorMove && this.expectedCapability && !this.collecting && !this.diagnosticFrame
      && !this.discardingLine && authenticatedStart(row.text, this.expectedCapability)?.sequence !== undefined) {
      const pending = this.bufferParts.join('');
      if (authenticatedStart(pending, this.expectedCapability)) {
        this.feed('\n', finalized);
      } else {
        this.clearPendingLine();
        this.rawProbeTail = '';
      }
    }
    if (row.wrapsToNext) {
      // Unlike raw chunks, this is known to begin a physical row. Preserve
      // ordinary prefix text too: dropping it could promote a wrapped example.
      if (this.discardingLine) return;
      this.appendPendingLine(row.text, finalized);
      this.feed('', finalized); // enforce the same pending-line byte budget
    } else {
      this.feed(`${row.text}\n`, finalized);
    }
  }

  /** Feed raw PTY data (may contain ANSI codes). */
  feed(raw: string, finalized = true): void {
    if (Date.now() < this.mutedUntil) return;
    if (this.discardingLine) {
      const newline = raw.indexOf('\n');
      if (newline < 0) return;
      raw = raw.slice(newline + 1);
      this.discardingLine = false;
    }
    const rawInput = (!this.collecting && !this.diagnosticFrame && this.bufferBytes === 0)
      ? `${this.rawProbeTail}${raw}`
      : raw;

    if (!this.collecting && !this.diagnosticFrame && this.bufferBytes === 0 && !this.mightContainMarker(rawInput)) {
      this.rawProbeTail = rawInput.slice(-RAW_LOOKBACK);
      return;
    }

    const clean = rawInput.includes('\x1b') ? stripAnsi(rawInput) : rawInput;
    this.rawProbeTail = '';
    // Search only this chunk. Join retained fragments once per actual newline,
    // not once per incoming character, to keep long-line processing linear.
    let offset = 0;
    let nlIdx = clean.indexOf('\n');
    while (nlIdx !== -1) {
      this.appendPendingLine(clean.slice(offset, nlIdx), finalized);
      // Strip carriage returns and other control chars that PTY output may contain
      const line = this.bufferParts.join('').replace(/[\r\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
      const lineFinalized = this.pendingFinalized && finalized;
      this.clearPendingLine();
      this.processLine(line, lineFinalized);
      offset = nlIdx + 1;
      nlIdx = clean.indexOf('\n', offset);
    }
    this.appendPendingLine(clean.slice(offset), finalized);
    // A PTY chunk boundary is not a logical newline. Preserve long wrapped
    // content until its real newline, but bound unfinished lines so malformed
    // output cannot retain an unbounded buffer. Reserve space for a footer even
    // when the current body has used its entire content allowance.
    // A malformed header is quarantined rather than routed, but its body has
    // the same byte allowance. Chunking/wrapping must not replace its actual
    // syntax error with a false "oversized" diagnosis at the marker limit.
    const pendingContentBytes = this.collecting ? this.contentBytes : this.diagnosticFrame?.bytes;
    const pendingLimit = pendingContentBytes === undefined
      ? MAX_PENDING_MARKER_BYTES
      : Math.max(MAX_PENDING_MARKER_BYTES, this.maxContentBytes - pendingContentBytes);
    if (this.bufferBytes > pendingLimit) {
      if (this.diagnosticFrame) this.diagnosticFrame.oversized = true;
      this.collecting = false;
      this.collectCapability = null;
      this.collectSequence = undefined;
      this.target = null;
      this.contentLines = [];
      this.contentBytes = 0;
      this.clearPendingLine();
      this.rawProbeTail = '';
      this.discardingLine = true;
      return;
    }

    if (!this.collecting && !this.diagnosticFrame && this.bufferBytes === 0) {
      this.rawProbeTail = rawInput.slice(-RAW_LOOKBACK);
    }
  }

  private appendPendingLine(fragment: string, finalized = true): void {
    if (!fragment) return;
    this.pendingFinalized &&= finalized;
    const firstCodeUnit = fragment.charCodeAt(0);
    const joinsSurrogatePair = this.bufferEndsInHighSurrogate
      && firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff;
    this.bufferBytes += Buffer.byteLength(fragment, 'utf8') - (joinsSurrogatePair ? 2 : 0);
    const lastCodeUnit = fragment.charCodeAt(fragment.length - 1);
    this.bufferEndsInHighSurrogate = lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff;
    this.bufferParts.push(fragment);
  }

  private clearPendingLine(): void {
    this.bufferParts = [];
    this.bufferBytes = 0;
    this.bufferEndsInHighSurrogate = false;
    this.pendingFinalized = true;
  }

  updateSource(panel: number, agent: string): void {
    this.sourcePanel = panel;
    this.sourceAgent = agent;
  }

  private processLine(line: string, finalized = true): void {
    if (this.diagnosticExhausted || this.inspectMalformedLine(line, finalized)) return;
    // Record marker-like activity without persisting agent-produced content.
    if (this.options?.logPotentialMarkers !== false && (line.includes('COMMANDER') || line.includes('==='))) {
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
        if (this.expectedCapability && startMatch[3] !== this.expectedCapability) return;
        if (!isAgentType(startMatch[1]) && !(this.options?.onRejected
          && this.expectedCapability && isReportableUnknownAgentType(startMatch[1]))) {
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
        this.collectSequence = startMatch[4] === undefined ? undefined : Number(startMatch[4]);
        this.target = { agent: startMatch[1], panel: panelNum };
        this.contentLines = [];
        this.contentBytes = 0;
        return;
      }

      // ── REPLY ──
      const replyMarker = matchReplyMarker(line);
      if (replyMarker) {
        if (this.expectedCapability && replyMarker.capability !== this.expectedCapability) return;
        this.collecting = true;
        this.collectType = 'reply';
        this.collectCapability = replyMarker.capability;
        this.collectSequence = replyMarker.sequence;
        this.target = null;
        this.contentLines = [];
        this.contentBytes = 0;
        return;
      }

      // ── BROADCAST ──
      const broadcastMarker = matchBroadcastMarker(line);
      if (broadcastMarker) {
        if (this.expectedCapability && broadcastMarker.capability !== this.expectedCapability) return;
        this.collecting = true;
        this.collectType = 'broadcast';
        this.collectCapability = broadcastMarker.capability;
        this.collectSequence = broadcastMarker.sequence;
        this.target = null;
        this.contentLines = [];
        this.contentBytes = 0;
        return;
      }

      // ── STATUS ──
      const statusMarker = matchStatusMarker(line);
      if (statusMarker) {
        if (this.expectedCapability && statusMarker.capability !== this.expectedCapability) return;
        this.collecting = true;
        this.collectType = 'status';
        this.collectCapability = statusMarker.capability;
        this.collectSequence = statusMarker.sequence;
        this.target = null;
        this.contentLines = [];
        this.contentBytes = 0;
        return;
      }

      // ── QUERY ──
      const queryMarker = matchQueryMarker(line);
      if (queryMarker) {
        if (this.expectedCapability && queryMarker.capability !== this.expectedCapability) return;
        this.collecting = true;
        this.collectType = 'query';
        this.collectCapability = queryMarker.capability;
        this.collectSequence = queryMarker.sequence;
        this.target = null;
        this.contentLines = [];
        this.contentBytes = 0;
        return;
      }
    }

    // Check for end marker (lenient: allow extra = signs, whitespace)
    if (this.collecting && isEndMarker(line, this.collectCapability, this.collectSequence)) {
      const content = this.contentLines.join('\n').trim();
      const common = {
        sourcePanel: this.sourcePanel,
        sourceAgent: this.sourceAgent,
        targetPanel: this.target?.panel ?? -1,
        content,
        ...(this.collectCapability ? { capability: this.collectCapability } : {}),
        ...(this.collectSequence !== undefined ? { sequence: this.collectSequence } : {}),
      };
      const agent = this.target?.agent ?? 'generic';
      if (isAgentType(agent)) {
        this.onMessage({ ...common, type: this.collectType, targetAgent: agent });
      } else if (this.collectType === 'send' && this.expectedCapability
        && this.collectCapability === this.expectedCapability) {
        this.options?.onRejected?.({
          ...common, type: 'send', targetAgent: agent, rejection: 'unknown_agent_type',
        });
      }
      this.collecting = false;
      this.collectType = 'send';
      this.collectCapability = null;
      this.collectSequence = undefined;
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
      if (!isWithinProtocolContentBudget(
        this.contentLines.length,
        this.contentBytes,
        this.maxContentLines,
        this.maxContentBytes,
      )) {
        this.collecting = false;
        this.collectCapability = null;
        this.collectSequence = undefined;
        this.target = null;
        this.contentLines = [];
        this.contentBytes = 0;
      }
    }
  }

  private mightContainMarker(raw: string): boolean {
    return raw.includes(MARKER_HINT) || raw.includes(MARKER_FALLBACK_HINT);
  }

  /**
   * An immutable assistant-text completion is an actual boundary. Never call
   * this for a quiet PTY, a grid snapshot, a resize, or a repaint.
   */
  finishCompletedPart(): void {
    if (!this.isMuted) {
      if (this.bufferBytes > 0) this.feed('\n');
      const frame = this.diagnosticFrame;
      if (frame) {
        const footer = frame.pendingFooter;
        const code = frame.oversized ? 'oversized-frame'
          : footer ? this.diagnosticCode(frame, footer) ?? 'missing-footer'
          : 'missing-footer';
        this.emitMalformed(code, footer);
      }
    }
    this.resetCollection();
    this.diagnosticFrame = null;
    this.clearPendingLine();
    this.rawProbeTail = '';
    this.discardingLine = false;
    this.repaintCandidate = null;
  }

  private resetCollection(): void {
    this.collecting = false;
    this.collectType = 'send';
    this.collectCapability = null;
    this.collectSequence = undefined;
    this.target = null;
    this.contentLines = [];
    this.contentBytes = 0;
  }

  /** Return true when a line belongs to a rejected/quarantined candidate. */
  private inspectMalformedLine(line: string, finalized: boolean): boolean {
    if (!this.options?.onMalformed || !this.expectedCapability) return false;
    const marker = inspectDiagnosticMarker(line, this.expectedCapability);
    let frame = this.diagnosticFrame;
    if (!frame) {
      if (this.collecting || !marker || marker.command === 'END') return false;
      frame = {
        header: marker, sequences: new Set(marker.sequence === undefined ? [] : [marker.sequence]),
        nestedSequences: new Set(), pendingFooter: null, lines: 0, bytes: 0, oversized: false,
      };
      this.diagnosticFrame = frame;
      return !!marker.issue || !marker.closed;
    }

    if (marker?.sequence !== undefined) {
      frame.sequences.add(marker.sequence);
      // No eviction can make an old counter eligible again. Stop this scanner
      // until explicit capability rotation rather than retain unbounded state.
      if (frame.sequences.size > 16384) {
        this.diagnosticExhausted = true;
        this.emitMalformed('oversized-frame', marker);
        return true;
      }
    }
    if (marker?.command === 'END') {
      const nestedFooter = marker.sequenceIdentity !== frame.header.sequenceIdentity
        && frame.nestedSequences.has(marker.sequenceIdentity);
      if (!nestedFooter) {
        frame.pendingFooter = marker;
        // A partially painted footer is not proof of a malformed emission.
        // Only immutable rows/parts may classify a missing closing delimiter.
        if (marker.closed || finalized) {
          const code = this.diagnosticCode(frame, marker);
          if (code) {
            this.emitMalformed(code, marker);
            return true;
          }
          this.diagnosticFrame = null;
          return false;
        }
      }
    } else if (marker) {
      // Keep nested examples under their original outer frame. A malformed
      // outer header must not promote an otherwise valid nested SEND.
      if (frame.nestedSequences.size < 16384) frame.nestedSequences.add(marker.sequenceIdentity);
    }
    frame.lines += 1;
    frame.bytes += Buffer.byteLength(line, 'utf8') + 1;
    if (!isWithinProtocolContentBudget(frame.lines, frame.bytes, this.maxContentLines, this.maxContentBytes)) {
      frame.oversized = true;
      this.resetCollection();
    }
    return !this.collecting;
  }

  private diagnosticCode(frame: DiagnosticFrame, footer: DiagnosticMarker): ProtocolIssueCode | null {
    if (frame.oversized) return 'oversized-frame';
    if (frame.header.issue) return frame.header.issue;
    if (footer.issue) return footer.issue === 'invalid-header' ? 'invalid-sequence' : footer.issue;
    if (frame.header.sequenceIdentity !== footer.sequenceIdentity) return 'mismatched-sequence';
    if (!frame.header.closed && !footer.closed) return 'missing-both-delimiters';
    if (!frame.header.closed) return 'missing-header-delimiter';
    if (!footer.closed) return 'missing-footer-delimiter';
    return null;
  }

  private emitMalformed(code: ProtocolIssueCode, footer: DiagnosticMarker | null): void {
    const frame = this.diagnosticFrame;
    if (!frame || !this.expectedCapability) return;
    const issue: ProtocolIssue = {
      code, capability: this.expectedCapability, sequences: [...frame.sequences],
      fingerprint: createHash('sha256').update(`${code}:${frame.header.digest}:${footer?.digest ?? ''}`).digest('hex'),
    };
    // Reset before notifying consumers, including callbacks that rotate keys.
    this.resetCollection();
    this.diagnosticFrame = null;
    this.options?.onMalformed?.(issue);
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
    ? otherAgents.map((a) => `  - P${a.panel + 1}: ${a.name}; SEND address ${a.type}:${a.panel + 1}`).join('\n')
    : '  (none currently running)';

  return [
    `[Agents Commander] You are ${myAgent} in Panel ${myPanel + 1}.`,
    `Other agents (snapshot at injection):\n${others}`,
    ``,
    `Use Commander protocol only when the user explicitly asks you to coordinate, or when Commander delivers [From ...] / [Broadcast from ...] to you.`,
    `Do not send startup broadcasts, self-check queries, or status pings on your own right after reading these instructions.`,
    `Protocol capability: ${effectiveCapability}. Include it on every protocol header and footer exactly as shown below.`,
    `For this capability, keep one positive integer counter n starting at 1, shared across SEND, REPLY, BROADCAST, STATUS, and QUERY.`,
    `Use the next counter for every new message and put the exact same n on its header and footer. Write canonical decimal digits only: no leading zero, sign, or decimal point.`,
    `Keep the original counter unchanged when retrying or redrawing an existing message; replaying it does not send it again. Never reuse a counter for a changed body, target, or command.`,
    `To intentionally send the same body again as a new action, use a new counter. Historical redraws must retain their original counters.`,
    `Commander keeps a 4096-number reorder window and rejects older counters, including counters never observed before. Do not jump ahead or reset your counter within this capability.`,
    `The largest counter is ${Number.MAX_SAFE_INTEGER}; restart the agent and inject fresh protocol instructions before exhausting it.`,
    ``,
    `To message another agent, output exactly 3 lines:`,
    `  1) header: three "=" + "COMMANDER:SEND:<type>:<panel>:${effectiveCapability}:<n>" + three "="`,
    `  2) body: your message text`,
    `  3) footer: three "=" + "COMMANDER:END:${effectiveCapability}:<n>" + three "="`,
    `Replace <n> with your current counter; do not print angle brackets. Even when a template shows an older marker format, include your counter on both output markers.`,
    `Quoted protocol blocks are examples; choose your own next counter for a new action rather than reusing their number.`,
    `Types: claude, codex, antigravity, gemini, aider, cline, opencode, goose, kiro, amp, generic. Panel numbers: 1-${MAX_PANEL_NUMBER}.`,
    `Use the exact SEND address from the current roster. The type is the CLI adapter, NOT the model or display name: APEX through OpenCode uses opencode; APEX through a generic/Pi profile uses generic. Never use apex as a type.`,
    `Panel numbers are stable P IDs, not grid position or an agent's ordinal. Templates may contain illustrative addresses; resolve their roles against the current roster before sending.`,
    `When explicitly asked to coordinate, QUERY agents if the destination is absent, ambiguous, or panels have changed. Wait for the roster response. Never guess a panel, replace an unrelated session, or redirect a rejected message without verifying the intended recipient.`,
    ``,
    `Other line-1 headers:`,
    `  REPLY     -> COMMANDER:REPLY:${effectiveCapability}:<n>        (claims your newest open reply window)`,
    `  BROADCAST -> COMMANDER:BROADCAST:${effectiveCapability}:<n>`,
    `  STATUS    -> COMMANDER:STATUS:${effectiveCapability}:<n>`,
    `  QUERY     -> COMMANDER:QUERY:${effectiveCapability}:<n>`,
    `Query values: agents, panels, status, help, ping`,
    ``,
    `SEND, REPLY, BROADCAST, and STATUS produce a Commander ACK in your panel. QUERY returns Commander info directly.`,
    `Wait for that ACK or response before sending another message.`,
    `A [Commander protocol error] describes a rejected frame, not a successful send. Correct only that frame's stated error and emit it once with a fresh counter; do not repeat other commands already acknowledged.`,
    `Commander sends at most 3 protocol-correction notices per capability. If the third correction still fails, stop and ask the user for help; do not loop, guess a recipient, or silently reset your counter.`,
    `When you receive [From ... | thread=... | msg=...], use REPLY to continue that thread.`,
    `Do NOT use protocol markers to acknowledge receipt unless you are sending a real reply.`,
  ].filter(Boolean).join('\n');
}
