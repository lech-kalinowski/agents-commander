/**
 * Semantic actions emitted by the native and keyboard-fallback Codex Micro
 * integrations. The application decides which control surface is active for
 * a given launch.
 */
export type CodexMicroKeyboardAction =
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

export type CodexMicroAction =
  | CodexMicroKeyboardAction
  | 'focus-panel-1'
  | 'focus-panel-2'
  | 'focus-panel-3'
  | 'focus-panel-4'
  | 'focus-panel-5'
  | 'focus-panel-6'
  | 'add-panel'
  | 'cycle-density';

export interface CodexMicroBinding {
  /** Blessed key name emitted by the keyboard-HID chord. */
  readonly key: string;
  readonly action: CodexMicroKeyboardAction;
  readonly label: string;
  readonly description: string;
}

export type CodexMicroNativeInput =
  | 'AG00'
  | 'AG01'
  | 'AG02'
  | 'AG03'
  | 'AG04'
  | 'AG05'
  | 'ACT06'
  | 'ACT07'
  | 'ACT08'
  | 'ACT09'
  | 'ACT10'
  | 'ACT11'
  | 'ACT12'
  | 'ENC_CLK'
  | 'ENC_CW'
  | 'ENC_CC'
  | 'JOY_UP'
  | 'JOY_RIGHT'
  | 'JOY_DOWN'
  | 'JOY_LEFT';

export interface CodexMicroNativeBinding {
  readonly input: CodexMicroNativeInput;
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

/**
 * Factory-position mapping for the shipping Codex Micro vendor-HID protocol.
 *
 * The six frosted Agent Keys address the first six active workspace slots. The dial
 * and joystick remain useful with larger workspaces, while the factory
 * approve/reject positions retain their guarded meaning. ACT10 and ACT11 sit
 * under one double-width keycap and therefore intentionally share one action.
 */
export const CODEX_MICRO_NATIVE_BINDINGS = Object.freeze([
  { input: 'AG00', action: 'focus-panel-1', label: 'Workspace slot 1', description: 'Focus active workspace slot 1.' },
  { input: 'AG01', action: 'focus-panel-2', label: 'Workspace slot 2', description: 'Focus active workspace slot 2.' },
  { input: 'AG02', action: 'focus-panel-3', label: 'Workspace slot 3', description: 'Focus active workspace slot 3.' },
  { input: 'AG03', action: 'focus-panel-4', label: 'Workspace slot 4', description: 'Focus active workspace slot 4.' },
  { input: 'AG04', action: 'focus-panel-5', label: 'Workspace slot 5', description: 'Focus active workspace slot 5.' },
  { input: 'AG05', action: 'focus-panel-6', label: 'Workspace slot 6', description: 'Focus active workspace slot 6.' },
  { input: 'ACT06', action: 'cycle-density', label: 'View density', description: 'Cycle the visible panel density.' },
  { input: 'ACT07', action: 'approve', label: 'Approve once', description: 'Open the guarded one-time approval flow.' },
  { input: 'ACT08', action: 'reject', label: 'Reject', description: 'Open the guarded rejection flow.' },
  { input: 'ACT09', action: 'add-panel', label: 'Add panel', description: 'Add and focus a new workspace panel.' },
  { input: 'ACT10', action: 'open-activity', label: 'Activity', description: 'Open routed-message Activity.' },
  { input: 'ACT11', action: 'open-activity', label: 'Activity', description: 'Open routed-message Activity.' },
  { input: 'ACT12', action: 'open-navigator', label: 'Panel navigator', description: 'Open the panel navigator.' },
  { input: 'ENC_CLK', action: 'open-activity', label: 'Activity', description: 'Open routed-message Activity.' },
  { input: 'ENC_CW', action: 'next-panel', label: 'Next panel', description: 'Focus the next workspace panel.' },
  { input: 'ENC_CC', action: 'previous-panel', label: 'Previous panel', description: 'Focus the previous workspace panel.' },
  { input: 'JOY_UP', action: 'previous-page', label: 'Previous page', description: 'Show the previous panel page.' },
  { input: 'JOY_RIGHT', action: 'next-panel', label: 'Next panel', description: 'Focus the next workspace panel.' },
  { input: 'JOY_DOWN', action: 'next-page', label: 'Next page', description: 'Show the next panel page.' },
  { input: 'JOY_LEFT', action: 'previous-panel', label: 'Previous panel', description: 'Focus the previous workspace panel.' },
] as const satisfies readonly CodexMicroNativeBinding[]);

export type CodexMicroKey = typeof CODEX_MICRO_BINDINGS[number]['key'];

export const CODEX_MICRO_KEYS: readonly CodexMicroKey[] = Object.freeze(
  CODEX_MICRO_BINDINGS.map((binding) => binding.key),
);

const bindingByKey = new Map<string, CodexMicroBinding>(
  CODEX_MICRO_BINDINGS.map((binding) => [binding.key, binding]),
);
const keyByAction = new Map<CodexMicroKeyboardAction, CodexMicroKey>(
  CODEX_MICRO_BINDINGS.map((binding) => [binding.action, binding.key]),
);
const nativeBindingByInput = new Map<CodexMicroNativeInput, CodexMicroNativeBinding>(
  CODEX_MICRO_NATIVE_BINDINGS.map((binding) => [binding.input, binding]),
);

/** Return a mutable key list suitable for Blessed's `screen.key` API. */
export function getCodexMicroKeys(): CodexMicroKey[] {
  return [...CODEX_MICRO_KEYS];
}

export function getCodexMicroBinding(keyName: string): CodexMicroBinding | undefined {
  return bindingByKey.get(keyName);
}

export function getCodexMicroAction(keyName: string): CodexMicroKeyboardAction | undefined {
  return getCodexMicroBinding(keyName)?.action;
}

export function getCodexMicroKey(action: CodexMicroKeyboardAction): CodexMicroKey {
  // Keep the runtime guard for untyped JavaScript consumers.
  const key = keyByAction.get(action);
  if (!key) throw new Error(`No Codex Micro key is registered for action: ${action}`);
  return key;
}

export function isCodexMicroNativeInput(value: string): value is CodexMicroNativeInput {
  return nativeBindingByInput.has(value as CodexMicroNativeInput);
}

export function getCodexMicroNativeBinding(
  input: CodexMicroNativeInput,
): CodexMicroNativeBinding {
  const binding = nativeBindingByInput.get(input);
  if (!binding) throw new Error(`No Codex Micro native input is registered: ${input}`);
  return binding;
}

export function getCodexMicroNativeAction(
  input: CodexMicroNativeInput,
): CodexMicroAction {
  return getCodexMicroNativeBinding(input).action;
}

export function isCodexMicroKey(keyName: string): keyName is CodexMicroKey {
  return bindingByKey.has(keyName);
}
