import { createHash } from 'node:crypto';

export type CodexDecisionAction = 'approve' | 'reject';

export interface CodexDecisionDetection {
  readonly action: CodexDecisionAction;
  readonly fingerprint: string;
  /** Zero-based physical row in the supplied visible grid. */
  readonly promptLineIndex: number;
  /** Zero-based physical row in the supplied visible grid. */
  readonly selectedLineIndex: number;
  readonly selectedOption: number;
  readonly selectedLabel: string;
}

type VisibleGrid = string | readonly string[];

interface PromptOption {
  readonly lineIndex: number;
  readonly number: number;
  readonly label: string;
  readonly selected: boolean;
}

const GRID_FINGERPRINT_DOMAIN = 'agents-commander:codex-visible-grid:v1\0';
const MAX_VISIBLE_ROWS = 500;
const MAX_VISIBLE_ROW_LENGTH = 16_384;
const MAX_SELECTED_DISTANCE_FROM_BOTTOM = 12;
const TERMINAL_CHROME_RE = /^\s*(?:[│┃║┆┇┊┋╎╏▌]\s*)+/u;
const OPTION_RE = /^\s*(?:(?<marker>[›❯>])\s+)?(?<number>[1-9]\d*)[.)]\s+(?<label>\S.*)$/u;
const SELECTED_MARKER_RE = /^\s*[›❯>]\s+/u;
const UNSAFE_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const KEY_HINT_RE = /\s+(?:\((?:y|n|esc|enter|return)\)|\[(?:y|n|esc|enter|return)\])\s*$/iu;

// Deliberately narrow: these questions describe one command or one concrete
// edit operation. Trust, workspace, session, and full-access prompts are not
// approval candidates even when their selected answer happens to say "Yes".
const ONE_TIME_PROMPT_RES = [
  /^(?:would you like to|do you want to) (?:run|execute) (?:the following|this) command\?$/iu,
  /^(?:would you like to|do you want to) (?:make|apply) (?:the following|this|these) (?:edit|edits|change|changes|patch)\?$/iu,
];

const PERSISTENT_APPROVAL_RE = /(?:always|full\s+access|don['’]t\s+ask\s+again|do\s+not\s+ask\s+again|remember|for\s+(?:this|the)\s+session|trust|workspace|folder|allow\s+all)/iu;
const POSITIVE_APPROVAL_PREFIX_RE = /^(?:yes|approve|allow|run|proceed|continue)\b/iu;
const ONE_TIME_APPROVAL_RE = /^(?:yes(?:,\s*(?:proceed|approve|allow once|run once|continue))?|proceed|approve(?: once)?|allow once|run once|continue)[.!]?$/iu;
const CONFIRMATION_FOOTER_RE = /^Press enter to confirm or esc to cancel$/iu;
const REJECTION_RES = [
  /^no[.!]?$/iu,
  /^no,?\s+(?:and\s+)?tell codex what to do differently[.!]?$/iu,
  /^(?:cancel|reject|deny|stop)[.!]?$/iu,
];

function visibleGridLines(grid: VisibleGrid): string[] {
  if (typeof grid !== 'string') return [...grid];
  return grid.replace(/\r\n?/gu, '\n').split('\n');
}

/**
 * Hash the complete visible terminal grid, including blank rows and trailing
 * spaces. Equivalent string and line-array representations produce the same
 * digest. The domain prefix permits future canonicalization changes safely.
 */
export function fingerprintCodexVisibleGrid(grid: VisibleGrid): string {
  const lines = visibleGridLines(grid);
  const hash = createHash('sha256');
  hash.update(GRID_FINGERPRINT_DOMAIN, 'utf8');
  hash.update(JSON.stringify(lines), 'utf8');
  return hash.digest('hex');
}

function normalizedGridLine(line: string): string {
  return line.replace(TERMINAL_CHROME_RE, '').trim();
}

function promptLineMatches(line: string): boolean {
  return ONE_TIME_PROMPT_RES.some((pattern) => pattern.test(line));
}

function parseOption(line: string, lineIndex: number): PromptOption | null {
  const normalized = line.replace(TERMINAL_CHROME_RE, '');
  const match = OPTION_RE.exec(normalized);
  if (!match?.groups) return null;

  const number = Number(match.groups.number);
  if (!Number.isSafeInteger(number)) return null;

  return {
    lineIndex,
    number,
    label: match.groups.label.trim(),
    selected: match.groups.marker !== undefined,
  };
}

function labelWithoutKeyHint(label: string): string {
  let normalized = label.trim();
  let previous: string;
  do {
    previous = normalized;
    normalized = normalized.replace(KEY_HINT_RE, '').trim();
  } while (normalized !== previous);
  return normalized;
}

function isOneTimeApproval(label: string): boolean {
  const normalized = labelWithoutKeyHint(label);
  return !PERSISTENT_APPROVAL_RE.test(normalized) && ONE_TIME_APPROVAL_RE.test(normalized);
}

function isRejection(label: string): boolean {
  const normalized = labelWithoutKeyHint(label);
  return REJECTION_RES.some((pattern) => pattern.test(normalized));
}

function isPersistentApproval(label: string): boolean {
  const normalized = labelWithoutKeyHint(label);
  return POSITIVE_APPROVAL_PREFIX_RE.test(normalized) && PERSISTENT_APPROVAL_RE.test(normalized);
}

function hasCanonicalOptionShape(options: readonly PromptOption[]): boolean {
  if (options.length !== 2 && options.length !== 3) return false;
  const first = options[0];
  const last = options.at(-1);
  if (!first || !last || !isOneTimeApproval(first.label) || !isRejection(last.label)) return false;
  return options.length === 2 || isPersistentApproval(options[1]?.label ?? '');
}

function hasSafeGridShape(lines: readonly string[]): boolean {
  if (lines.length === 0 || lines.length > MAX_VISIBLE_ROWS) return false;
  return lines.every((line) => (
    line.length <= MAX_VISIBLE_ROW_LENGTH
    && !line.includes('\n')
    && !line.includes('\r')
    && !UNSAFE_CONTROL_RE.test(line)
  ));
}

/**
 * Detect whether the currently selected option in a visible Codex CLI
 * confirmation prompt exactly matches the requested decision.
 *
 * This intentionally fails closed. It accepts only numbered Codex-style
 * option lists under a narrowly recognized one-operation prompt, with exactly
 * one selection marker and a complete, monotonically numbered option set.
 */
export function detectCodexDecision(
  grid: VisibleGrid,
  requestedAction: CodexDecisionAction,
): CodexDecisionDetection | null {
  if (requestedAction !== 'approve' && requestedAction !== 'reject') return null;
  const lines = visibleGridLines(grid);
  if (!hasSafeGridShape(lines)) return null;

  let lastNonEmptyLineIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.trim()) {
      lastNonEmptyLineIndex = index;
      break;
    }
  }
  if (lastNonEmptyLineIndex < 0) return null;

  let promptLineIndex = -1;
  for (let index = lastNonEmptyLineIndex; index >= 0; index -= 1) {
    if (promptLineMatches(normalizedGridLine(lines[index] ?? ''))) {
      promptLineIndex = index;
      break;
    }
  }
  if (promptLineIndex < 0) return null;

  const options: PromptOption[] = [];
  for (let index = promptLineIndex + 1; index <= lastNonEmptyLineIndex; index += 1) {
    const line = lines[index] ?? '';
    const option = parseOption(line, index);
    if (option) {
      options.push(option);
    } else if (SELECTED_MARKER_RE.test(line.replace(TERMINAL_CHROME_RE, ''))) {
      // A selected-looking row that does not have the exact numbered option
      // syntax makes the visible prompt ambiguous.
      return null;
    }
  }

  if (options.length < 2) return null;
  if (options.some((option, index) => option.number !== index + 1)) return null;
  if (!hasCanonicalOptionShape(options)) return null;

  const firstOption = options[0];
  const lastOption = options.at(-1);
  if (!firstOption || !lastOption) return null;
  for (let index = promptLineIndex; index < firstOption.lineIndex; index += 1) {
    if (PERSISTENT_APPROVAL_RE.test(normalizedGridLine(lines[index] ?? ''))) {
      // Persistent scope can be described above otherwise innocuous Yes/No
      // labels. Treat the complete prompt context as part of the safety gate.
      return null;
    }
  }
  for (let index = firstOption.lineIndex; index <= lastOption.lineIndex; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() && !parseOption(line, index)) {
      // Once the option menu starts, accept no wrapped prose or unrelated
      // output between numbered options.
      return null;
    }
  }
  for (let index = lastOption.lineIndex + 1; index < lastNonEmptyLineIndex; index += 1) {
    if ((lines[index] ?? '').trim()) return null;
  }
  if (
    lastNonEmptyLineIndex !== lastOption.lineIndex
    && !CONFIRMATION_FOOTER_RE.test(normalizedGridLine(lines[lastNonEmptyLineIndex] ?? ''))
  ) {
    // Codex 0.122 emits this exact footer beneath approval menus. Keep the
    // allowlist deliberately exact and reject all other post-menu output.
    return null;
  }

  const selectedOptions = options.filter((option) => option.selected);
  if (selectedOptions.length !== 1) return null;
  const selected = selectedOptions[0];
  if (!selected) return null;

  if (lastNonEmptyLineIndex - selected.lineIndex > MAX_SELECTED_DISTANCE_FROM_BOTTOM) return null;

  // A real decision list must expose both a one-time positive path and a
  // negative path. This excludes unrelated numbered menus that merely occur
  // beneath similar prose.
  const selectedMatches = requestedAction === 'approve'
    ? isOneTimeApproval(selected.label)
    : isRejection(selected.label);
  if (!selectedMatches) return null;

  return {
    action: requestedAction,
    fingerprint: fingerprintCodexVisibleGrid(lines),
    promptLineIndex,
    selectedLineIndex: selected.lineIndex,
    selectedOption: selected.number,
    selectedLabel: selected.label,
  };
}
