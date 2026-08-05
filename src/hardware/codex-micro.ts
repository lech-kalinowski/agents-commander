/**
 * Semantic actions emitted by a Codex Micro configured as a keyboard HID.
 *
 * These bindings are deliberately opt-in. The module only describes the
 * control surface; the application decides whether to reserve and dispatch
 * the shortcuts for a given launch.
 */
export type CodexMicroAction =
  | 'previous-panel'
  | 'next-panel'
  | 'previous-page'
  | 'next-page'
  | 'focus-slot-1'
  | 'focus-slot-2'
  | 'focus-slot-3'
  | 'focus-slot-4'
  | 'open-navigator'
  | 'open-activity'
  | 'approve'
  | 'reject'
  | 'open-test-overlay';

export interface CodexMicroBinding {
  /** Blessed key name emitted by the keyboard-HID chord. */
  readonly key: string;
  readonly action: CodexMicroAction;
  readonly label: string;
  readonly description: string;
}

export const CODEX_MICRO_BINDINGS = Object.freeze([
  {
    key: 'C-S-pageup',
    action: 'previous-panel',
    label: 'Previous panel',
    description: 'Focus the previous panel in the workspace.',
  },
  {
    key: 'C-S-pagedown',
    action: 'next-panel',
    label: 'Next panel',
    description: 'Focus the next panel in the workspace.',
  },
  {
    key: 'C-S-home',
    action: 'previous-page',
    label: 'Previous page',
    description: 'Show the previous page of visible panels.',
  },
  {
    key: 'C-S-end',
    action: 'next-page',
    label: 'Next page',
    description: 'Show the next page of visible panels.',
  },
  {
    key: 'C-S-f5',
    action: 'focus-slot-1',
    label: 'Visible panel 1',
    description: 'Focus the first visible panel slot.',
  },
  {
    key: 'C-S-f6',
    action: 'focus-slot-2',
    label: 'Visible panel 2',
    description: 'Focus the second visible panel slot.',
  },
  {
    key: 'C-S-f7',
    action: 'focus-slot-3',
    label: 'Visible panel 3',
    description: 'Focus the third visible panel slot.',
  },
  {
    key: 'C-S-f8',
    action: 'focus-slot-4',
    label: 'Visible panel 4',
    description: 'Focus the fourth visible panel slot.',
  },
  {
    key: 'C-S-f9',
    action: 'open-navigator',
    label: 'Panel navigator',
    description: 'Open the panel navigator.',
  },
  {
    key: 'C-S-f10',
    action: 'open-activity',
    label: 'Activity',
    description: 'Open routed-message Activity.',
  },
  {
    key: 'C-S-f11',
    action: 'approve',
    label: 'Approve once',
    description: 'Request guarded approval of the selected one-time Codex action.',
  },
  {
    key: 'C-S-f12',
    action: 'reject',
    label: 'Reject',
    description: 'Request guarded rejection of the selected Codex action.',
  },
  {
    key: 'C-S-insert',
    action: 'open-test-overlay',
    label: 'Test controls',
    description: 'Open the Codex Micro input checklist.',
  },
] as const satisfies readonly CodexMicroBinding[]);

export type CodexMicroKey = typeof CODEX_MICRO_BINDINGS[number]['key'];

export const CODEX_MICRO_KEYS: readonly CodexMicroKey[] = Object.freeze(
  CODEX_MICRO_BINDINGS.map((binding) => binding.key),
);

const bindingByKey = new Map<string, CodexMicroBinding>(
  CODEX_MICRO_BINDINGS.map((binding) => [binding.key, binding]),
);
const keyByAction = new Map<CodexMicroAction, CodexMicroKey>(
  CODEX_MICRO_BINDINGS.map((binding) => [binding.action, binding.key]),
);

/** Return a mutable key list suitable for Blessed's `screen.key` API. */
export function getCodexMicroKeys(): CodexMicroKey[] {
  return [...CODEX_MICRO_KEYS];
}

export function getCodexMicroBinding(keyName: string): CodexMicroBinding | undefined {
  return bindingByKey.get(keyName);
}

export function getCodexMicroAction(keyName: string): CodexMicroAction | undefined {
  return getCodexMicroBinding(keyName)?.action;
}

export function getCodexMicroKey(action: CodexMicroAction): CodexMicroKey {
  // CODEX_MICRO_BINDINGS is exhaustive for CodexMicroAction, so this is an
  // invariant failure rather than a user-facing unknown value.
  const key = keyByAction.get(action);
  if (!key) throw new Error(`No Codex Micro key is registered for action: ${action}`);
  return key;
}

export function isCodexMicroKey(keyName: string): keyName is CodexMicroKey {
  return bindingByKey.has(keyName);
}
