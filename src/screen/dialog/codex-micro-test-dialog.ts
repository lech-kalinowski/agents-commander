import blessed from 'blessed';
import type { CodexMicroInputMode, Theme } from '../../config/types.js';
import {
  CODEX_MICRO_BINDINGS,
  CODEX_MICRO_NATIVE_BINDINGS,
  getCodexMicroAction,
  getCodexMicroNativeBinding,
  isCodexMicroNativeInput,
  type CodexMicroAction,
  type CodexMicroNativeInput,
} from '../../hardware/codex-micro.js';
import type { CodexMicroDeviceStatus } from '../../hardware/codex-micro-native.js';
import {
  enterDialog,
  leaveDialog,
  registerDialogCancellation,
} from '../../utils/dialog-state.js';
import { bindOverlayResize } from './geometry.js';

const CODEX_MICRO_ACTIONS = new Set<CodexMicroAction>(
  CODEX_MICRO_BINDINGS.map((binding) => binding.action),
);
const CODEX_MICRO_NATIVE_ACTIONS = new Set<CodexMicroAction>(
  CODEX_MICRO_NATIVE_BINDINGS.map((binding) => binding.action),
);

interface NativeControlRow {
  readonly inputs: readonly CodexMicroNativeInput[];
  readonly control: string;
}

/**
 * ACT10 and ACT11 sit under one wide factory keycap. Treating them as one
 * physical control keeps the rehearsal checklist achievable regardless of
 * which half of the key reports first.
 */
const NATIVE_CONTROL_ROWS: readonly NativeControlRow[] = Object.freeze([
  { inputs: ['AG00'], control: 'Agent key 1' },
  { inputs: ['AG01'], control: 'Agent key 2' },
  { inputs: ['AG02'], control: 'Agent key 3' },
  { inputs: ['AG03'], control: 'Agent key 4' },
  { inputs: ['AG04'], control: 'Agent key 5' },
  { inputs: ['AG05'], control: 'Agent key 6' },
  { inputs: ['ACT06'], control: 'Fast key' },
  { inputs: ['ACT07'], control: 'Approve key' },
  { inputs: ['ACT08'], control: 'Reject key' },
  { inputs: ['ACT09'], control: 'Split key' },
  { inputs: ['ACT10', 'ACT11'], control: 'Mic wide key' },
  { inputs: ['ACT12'], control: 'Codex key' },
  { inputs: ['ENC_CLK'], control: 'Dial press' },
  { inputs: ['ENC_CW'], control: 'Dial clockwise' },
  { inputs: ['ENC_CC'], control: 'Dial counter-clockwise' },
  { inputs: ['JOY_UP'], control: 'Joystick up' },
  { inputs: ['JOY_RIGHT'], control: 'Joystick right' },
  { inputs: ['JOY_DOWN'], control: 'Joystick down' },
  { inputs: ['JOY_LEFT'], control: 'Joystick left' },
]);

const DEFAULT_DEVICE_STATUS: CodexMicroDeviceStatus = Object.freeze({
  state: 'starting',
  transport: 'unknown',
  connectionEpoch: null,
});

export interface CodexMicroTestContentOptions {
  inputMode?: CodexMicroInputMode;
  decisionControls?: boolean;
  deviceStatus?: CodexMicroDeviceStatus;
  testedInputs?: ReadonlySet<CodexMicroNativeInput>;
  lastHardwareInput?: {
    readonly input: CodexMicroNativeInput;
    readonly action: CodexMicroAction;
  } | null;
}

export interface CodexMicroTestDialogOptions {
  /** Native vendor-HID input is the runtime default; omitted preserves the legacy API. */
  inputMode?: CodexMicroInputMode;
  initialStatus?: CodexMicroDeviceStatus;
  decisionControls?: boolean;
}

function displayKey(key: string): string {
  const parts = key.split('-');
  return parts.map((part) => {
    if (part === 'C') return 'Ctrl';
    if (part === 'S') return 'Shift';
    if (part === 'pageup') return 'Page Up';
    if (part === 'pagedown') return 'Page Down';
    if (/^f\d+$/i.test(part)) return part.toUpperCase();
    return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
  }).join('+');
}

function safeInline(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f{}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1)}…`;
}

function formatDeviceStatus(status: CodexMicroDeviceStatus): string[] {
  const state = status.state;
  const stateText = state === 'connected'
    ? '{green-fg}Connected{/green-fg}'
    : state === 'starting'
      ? '{yellow-fg}Starting…{/yellow-fg}'
      : state === 'disconnected'
        ? '{yellow-fg}Waiting for device{/yellow-fg}'
        : state === 'permission-denied'
          ? '{red-fg}Input Monitoring permission needed{/red-fg}'
          : state === 'unavailable'
            ? '{red-fg}Native input unavailable{/red-fg}'
            : '{red-fg}Bridge error{/red-fg}';
  const transport = status.transport === 'usb'
    ? 'USB'
    : status.transport === 'bluetooth'
      ? 'Bluetooth'
      : 'transport unknown';
  const metadata: string[] = [transport];
  const firmware = safeInline(status.firmware, 32);
  if (firmware) metadata.push(`firmware ${firmware}`);
  if (typeof status.battery === 'number' && Number.isFinite(status.battery)) {
    const battery = Math.max(0, Math.min(100, Math.round(status.battery)));
    metadata.push(`battery ${battery}%${status.charging ? ' (charging)' : ''}`);
  }
  const rows = [`{bold}Device:{/bold} ${stateText} · ${metadata.join(' · ')}`];
  const detail = safeInline(status.detail);
  if (detail) rows.push(`  {gray-fg}${detail}{/gray-fg}`);
  return rows;
}

function formatKeyboardContent(testedActions: ReadonlySet<CodexMicroAction>): string {
  const testedCount = CODEX_MICRO_BINDINGS.reduce(
    (count, binding) => count + Number(testedActions.has(binding.action)),
    0,
  );
  const status = testedCount === CODEX_MICRO_BINDINGS.length
    ? '{bold}{green-fg}All controls detected — ready for rehearsal.{/green-fg}{/bold}'
    : `{bold}Detected ${testedCount}/${CODEX_MICRO_BINDINGS.length} controls{/bold}`;
  const rows = CODEX_MICRO_BINDINGS.map((binding) => {
    const marker = testedActions.has(binding.action)
      ? '{green-fg}[✓]{/green-fg}'
      : '{gray-fg}[ ]{/gray-fg}';
    return `  ${marker} ${displayKey(binding.key).padEnd(22)} ${binding.label}`;
  });

  return [
    '{bold}{cyan-fg}CODEX MICRO CONTROL TEST{/cyan-fg}{/bold}',
    'Mode: programmed keyboard shortcuts (legacy fallback).',
    'Press each programmed control. This mode cannot verify the physical device connection.',
    '',
    status,
    '',
    ...rows,
  ].join('\n');
}

function formatNativeContent(
  testedInputs: ReadonlySet<CodexMicroNativeInput>,
  deviceStatus: CodexMicroDeviceStatus,
  lastHardwareInput: CodexMicroTestContentOptions['lastHardwareInput'],
  decisionControls: boolean,
): string {
  const testedCount = NATIVE_CONTROL_ROWS.reduce(
    (count, row) => count + Number(row.inputs.some((input) => testedInputs.has(input))),
    0,
  );
  const status = testedCount === NATIVE_CONTROL_ROWS.length
    ? decisionControls
      ? '{bold}{green-fg}All physical controls detected — ready for rehearsal.{/green-fg}{/bold}'
      : '{bold}{green-fg}All physical controls detected — hardware input is ready.{/green-fg}{/bold}'
    : `{bold}Detected ${testedCount}/${NATIVE_CONTROL_ROWS.length} physical controls{/bold}`;
  const decisionStatus = decisionControls
    ? '{green-fg}Decision actions: enabled (second matching press required).{/green-fg}'
    : '{yellow-fg}Decision actions: disabled; Approve/Reject are input-test only.{/yellow-fg}';
  const rows = NATIVE_CONTROL_ROWS.map((row) => {
    const detected = row.inputs.some((input) => testedInputs.has(input));
    const marker = detected ? '{green-fg}[✓]{/green-fg}' : '{gray-fg}[ ]{/gray-fg}';
    const inputLabel = row.inputs.join('/');
    const binding = getCodexMicroNativeBinding(row.inputs[0]);
    return `  ${marker} ${row.control.padEnd(22)} ${inputLabel.padEnd(11)} ${binding.label}`;
  });
  const lastInput = lastHardwareInput
    ? `Last input: ${lastHardwareInput.input} → ${getCodexMicroNativeBinding(lastHardwareInput.input).label}`
    : 'Last input: none yet';

  return [
    '{bold}{cyan-fg}CODEX MICRO — DIRECT HARDWARE TEST{/cyan-fg}{/bold}',
    ...formatDeviceStatus(deviceStatus),
    'Press each physical control. A check means its vendor-HID event reached Commander.',
    '',
    status,
    decisionStatus,
    `{gray-fg}${lastInput}{/gray-fg}`,
    '',
    ...rows,
  ].join('\n');
}

export function formatCodexMicroTestContent(
  testedActions: ReadonlySet<CodexMicroAction>,
  options: CodexMicroTestContentOptions = {},
): string {
  if ((options.inputMode ?? 'keyboard') === 'keyboard') {
    return formatKeyboardContent(testedActions);
  }
  return formatNativeContent(
    options.testedInputs ?? new Set<CodexMicroNativeInput>(),
    options.deviceStatus ?? DEFAULT_DEVICE_STATUS,
    options.lastHardwareInput ?? null,
    options.decisionControls === true,
  );
}

export interface CodexMicroTestDialogHandle {
  /** Mark one semantic action as received while the checklist is open. */
  recordAction(action: CodexMicroAction): boolean;
  /** Mark one validated vendor-HID control event while the native checklist is open. */
  recordHardwareInput(input: CodexMicroNativeInput, action: CodexMicroAction): boolean;
  /** Refresh the live, non-identifying device metadata displayed by the native checklist. */
  setDeviceStatus(status: CodexMicroDeviceStatus): void;
  reset(): void;
  close(): void;
  isOpen(): boolean;
  testedActions(): readonly CodexMicroAction[];
  testedInputs(): readonly CodexMicroNativeInput[];
}

let activeDialog: CodexMicroTestDialogHandle | null = null;

export function showCodexMicroTestDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  options: CodexMicroTestDialogOptions = {},
): CodexMicroTestDialogHandle {
  if (activeDialog?.isOpen()) return activeDialog;

  const inputMode = options.inputMode ?? 'keyboard';
  const tested = new Set<CodexMicroAction>();
  const testedInputs = new Set<CodexMicroNativeInput>();
  let deviceStatus: CodexMicroDeviceStatus = {
    ...(options.initialStatus ?? DEFAULT_DEVICE_STATUS),
  };
  let lastHardwareInput: CodexMicroTestContentOptions['lastHardwareInput'] = null;
  let dialog: blessed.Widgets.BoxElement | null = null;
  let unbindResize: (() => void) | null = null;
  let screenKeyAttached = false;
  let dialogStateEntered = false;
  let unregisterCancellation = () => {};
  let closed = false;

  const renderContent = () => {
    if (closed || !dialog) return;
    const previousScroll = dialog.getScroll();
    dialog.setContent(formatCodexMicroTestContent(tested, {
      inputMode,
      deviceStatus,
      testedInputs,
      lastHardwareInput,
      decisionControls: options.decisionControls,
    }));
    dialog.setScroll(previousScroll);
    screen.render();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (activeDialog === handle) activeDialog = null;
    unregisterCancellation();

    const cleanupErrors: unknown[] = [];
    const cleanupStep = (step: () => void) => {
      try {
        step();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };

    if (screenKeyAttached) {
      cleanupStep(() => screen.removeListener('keypress', onScreenKey));
      screenKeyAttached = false;
    }
    if (unbindResize) {
      cleanupStep(unbindResize);
      unbindResize = null;
    }
    if (dialog) {
      cleanupStep(() => dialog!.destroy());
      dialog = null;
    }
    if (dialogStateEntered) {
      cleanupStep(() => leaveDialog(screen));
      dialogStateEntered = false;
    }
    cleanupStep(() => screen.render());

    if (cleanupErrors.length > 0) throw cleanupErrors[0];
  };

  const reset = () => {
    if (closed) return;
    tested.clear();
    testedInputs.clear();
    lastHardwareInput = null;
    if (dialog) dialog.setScroll(0);
    renderContent();
  };

  const recordAction = (action: CodexMicroAction): boolean => {
    const acceptedActions = inputMode === 'native'
      ? CODEX_MICRO_NATIVE_ACTIONS
      : CODEX_MICRO_ACTIONS;
    if (closed || !acceptedActions.has(action)) return false;
    tested.add(action);
    renderContent();
    return true;
  };

  const recordHardwareInput = (
    input: CodexMicroNativeInput,
    action: CodexMicroAction,
  ): boolean => {
    if (
      closed
      || inputMode !== 'native'
      || !isCodexMicroNativeInput(input)
      || getCodexMicroNativeBinding(input).action !== action
    ) return false;
    testedInputs.add(input);
    tested.add(action);
    lastHardwareInput = { input, action };
    const controlIndex = NATIVE_CONTROL_ROWS.findIndex((row) => row.inputs.includes(input));
    if (dialog && controlIndex >= 0) dialog.setScroll(Math.max(0, controlIndex - 5));
    renderContent();
    return true;
  };

  const setDeviceStatus = (status: CodexMicroDeviceStatus): void => {
    if (closed) return;
    deviceStatus = { ...status };
    renderContent();
  };

  const handle: CodexMicroTestDialogHandle = {
    recordAction,
    recordHardwareInput,
    setDeviceStatus,
    reset,
    close,
    isOpen: () => !closed,
    testedActions: () => (inputMode === 'native'
      ? CODEX_MICRO_NATIVE_BINDINGS.map((binding) => binding.action)
      : CODEX_MICRO_BINDINGS.map((binding) => binding.action) as CodexMicroAction[])
      .filter((action, index, actions) => actions.indexOf(action) === index && tested.has(action)),
    testedInputs: () => CODEX_MICRO_NATIVE_BINDINGS
      .map((binding) => binding.input)
      .filter((input) => testedInputs.has(input)),
  };

  const onScreenKey = (_ch: unknown, key: any) => {
    if (!key) return;
    const name = key.full || key.name;
    const action = inputMode === 'keyboard' && typeof name === 'string'
      ? getCodexMicroAction(name)
      : undefined;
    if (action) {
      recordAction(action);
    } else if (
      name === 'escape'
      || name === 'q'
      || name === 'Q'
      || name === 'S-q'
      || (key.name === 'q' && key.shift)
    ) {
      close();
    } else if (
      name === 'r'
      || name === 'R'
      || name === 'S-r'
      || (key.name === 'r' && key.shift)
    ) {
      reset();
    }
  };

  try {
    enterDialog(screen);
    dialogStateEntered = true;
    unregisterCancellation = registerDialogCancellation(screen, close);

    dialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 92,
      height: inputMode === 'native' ? 30 : 24,
      border: { type: 'line' },
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        border: { fg: 'cyan' },
      },
      tags: true,
      label: ' Codex Micro — Interactive Control Test ',
      shadow: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: 'cyan' } },
      mouse: true,
      content: '',
    });

    blessed.text({
      parent: dialog,
      bottom: 0,
      left: 'center',
      tags: false,
      content: inputMode === 'native'
        ? ' ↑/↓ = Scroll    R = Reset    Esc/Q = Close    Press Codex Micro controls '
        : ' R = Reset    Esc/Q = Close    Programmed keyboard-shortcut fallback ',
      style: { bg: theme.dialog.bg, fg: 'cyan' },
    });

    const currentDialog = dialog;
    currentDialog.key(['up'], () => { currentDialog.scroll(-1); screen.render(); });
    currentDialog.key(['down'], () => { currentDialog.scroll(1); screen.render(); });
    currentDialog.key(['pageup'], () => {
      currentDialog.scroll(-Math.max(1, (currentDialog.height as number) - 4));
      screen.render();
    });
    currentDialog.key(['pagedown'], () => {
      currentDialog.scroll(Math.max(1, (currentDialog.height as number) - 4));
      screen.render();
    });
    currentDialog.key(['r', 'R'], reset);
    currentDialog.key(['escape', 'q', 'Q'], close);

    unbindResize = bindOverlayResize(
      screen,
      currentDialog,
      92,
      inputMode === 'native' ? 30 : 24,
      undefined,
      { minWidth: 44, minHeight: 12 },
    );
    screen.on('keypress', onScreenKey);
    screenKeyAttached = true;
    activeDialog = handle;
    renderContent();
    currentDialog.focus();

    return handle;
  } catch (error) {
    try {
      close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Codex Micro test dialog setup failed and cleanup also reported an error',
      );
    }
    throw error;
  }
}
