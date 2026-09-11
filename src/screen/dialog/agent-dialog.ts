import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import type { AgentProfile, AgentType } from '../../agents/types.js';
import { discoverAgents } from '../../agents/agent-registry.js';
import {
  enterDialog,
  leaveDialog,
  registerDialogCancellation,
} from '../../utils/dialog-state.js';
import {
  adjacentPanelId,
  initialPanelId,
  normalizePanelIds,
  PanelNumberInputBuffer,
  renderPanelBoxes,
  type PanelPickerSource,
} from './panel-picker.js';
import type { AgentCommandConfig } from '../../config/types.js';
import { bindOverlayResize, screenGeometry } from './geometry.js';
import { sanitizeUserText } from '../../utils/user-facing-errors.js';
import { MAX_ACTIVE_PANELS } from '../../panel-limits.js';

function escapeTaggedText(value: unknown, maxLength: number): string {
  const escape = (blessed as unknown as { escape(text: string): string }).escape;
  return escape(sanitizeUserText(value, maxLength));
}

export interface AgentLaunchChoice {
  agentType: AgentType;
  profileId: string;
  panelIndex: number;
  /** Create this many new terminals using panelIndex as the source directory. */
  newPanelCount?: number;
}

export type AgentDialogChoice = AgentLaunchChoice | { action: 'protocol-batch' } | null;

let agentDialogOpen = false;

export function showAgentDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  panelSource: PanelPickerSource,
  activePanelIndex: number,
  agentOverrides?: Record<string, AgentCommandConfig>,
  agentProfiles?: readonly AgentProfile[],
  options: { maxNewPanels?: number; enableProtocolBatch?: boolean } = {},
): Promise<AgentDialogChoice> {
  if (agentDialogOpen) return Promise.resolve(null);
  const panelIds = normalizePanelIds(panelSource);
  const firstPanelId = initialPanelId(panelIds, activePanelIndex);
  if (firstPanelId === null) return Promise.resolve(null);
  const batchEnabled = options.maxNewPanels !== undefined;
  const protocolBatchEnabled = options.enableProtocolBatch === true;
  const availableNewPanels = Number.isSafeInteger(options.maxNewPanels)
    && (options.maxNewPanels ?? -1) >= 0
    ? Math.min(options.maxNewPanels!, MAX_ACTIVE_PANELS - panelIds.length)
    : 0;
  agentDialogOpen = true;
  enterDialog(screen);

  return new Promise((resolve) => {
    const agents = discoverAgents(agentOverrides, agentProfiles);
    const preferredHeight = agents.length + 14;
    const geometry = screenGeometry(screen, 64, preferredHeight);
    const listHeight = Math.max(1, Math.min(agents.length, geometry.height - 13));

    const dialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: geometry.width,
      height: geometry.height,
      border: { type: 'line' },
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        border: theme.dialog.border,
      },
      tags: true,
      label: ' Launch Agent (F2) ',
      shadow: true,
    });

    blessed.text({
      parent: dialog,
      top: 1,
      left: 2,
      tags: true,
      content: '{bold}Select AI Agent CLI:{/bold}',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    const items = agents.map((a) => {
      const status = a.configurationError
        ? '{red-fg}[!!]{/red-fg}'
        : a.installed
        ? (a.supported ? '{green-fg}[OK]{/green-fg}' : '{yellow-fg}[..]{/yellow-fg}')
        : '{red-fg}[--]{/red-fg}';
      const tag = !a.supported ? ' {yellow-fg}(future){/yellow-fg}' : '';
      const safeLabel = escapeTaggedText(a.profileLabel, 120);
      const safeDescription = escapeTaggedText(a.description, 180);
      const model = a.model
        ? ` {cyan-fg}${escapeTaggedText(a.model, 180)}{/cyan-fg}`
        : '';
      const invalid = a.configurationError ? ' {red-fg}(invalid profile){/red-fg}' : '';
      return `${status} ${safeLabel.padEnd(18)} ${safeDescription}${model}${tag}${invalid}`;
    });

    const list = blessed.list({
      parent: dialog,
      top: 3,
      left: 2,
      width: '100%-6',
      height: listHeight,
      tags: true,
      keys: false,
      mouse: true,
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        selected: { bg: 'cyan', fg: 'black' },
      },
      items: items as any,
    });

    // Manual navigation (keys:true swallows escape/enter)
    list.key(['up'], () => {
      if (resolved || pending) return;
      list.up(1);
      screen.render();
    });
    list.key(['down'], () => {
      if (resolved || pending) return;
      list.down(1);
      screen.render();
    });

    // Panel picker
    const panelLine = listHeight + 4;
    const panelLabel = blessed.box({
      parent: dialog,
      top: panelLine,
      left: 1,
      width: '100%-4',
      height: Math.max(1, Math.min(6, geometry.height - panelLine - 3)),
      tags: true,
      content: '',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    let selectedPanel = firstPanelId;
    let batchMode = false;
    let batchDigits = String(Math.min(16, availableNewPanels));
    let replaceBatchDigits = true;
    let pickerWidth = Math.max(12, geometry.width - 8);
    const numberInput = new PanelNumberInputBuffer(panelIds, () => {
      updatePanelDisplay();
      screen.render();
    });

    function batchCount(): number | null {
      if (!/^[1-9]\d{0,2}$/u.test(batchDigits)) return null;
      const count = Number(batchDigits);
      return count <= availableNewPanels ? count : null;
    }

    function updatePanelDisplay(): void {
      if (batchMode) {
        const validation = availableNewPanels === 0
          ? 'No capacity. N returns to single-panel launch.'
          : batchCount() === null
            ? `Invalid: enter a whole count from 1 to ${availableNewPanels}.`
            : `Type 1-${availableNewPanels}; first digit replaces the count.`;
        panelLabel.setContent(
          `{bold}NEW terminals: [${escapeTaggedText(batchDigits || ' ', 16)}]{/bold}`
          + `  Capacity: ${availableNewPanels}\n`
          + 'Existing panels unchanged\n'
          + `Directory from P${selectedPanel + 1} (Left/Right)\n\n`
          + (batchCount() === null ? `{red-fg}${validation}{/red-fg}` : validation),
        );
        return;
      }
      const header = '{bold}Target panel:{/bold}  (arrows or type P-number)\n\n';
      panelLabel.setContent(
        header + renderPanelBoxes(selectedPanel, panelIds, 4, pickerWidth, numberInput.digits),
      );
    }
    updatePanelDisplay();

    function footerContent(): string {
      if (protocolBatchEnabled) {
        return batchMode
          ? ' Enter=Create N=Single P=Protocol 0-9=Count Esc=Cancel '
          : batchEnabled
            ? ' Enter=Launch N=New panels P=Protocol Esc=Cancel '
            : ' Enter=Launch P=Protocol Left/Right=Panel Esc=Cancel ';
      }
      return batchMode
        ? ' Enter=Create  N=Single  0-9=Count  Backspace=Edit  Esc=Cancel '
        : batchEnabled
          ? ' Enter=Launch  N=New panels  Left/Right=Panel  Esc=Cancel '
          : ' Enter=Launch  Left/Right=Panel  0-9=Type P#  Esc=Cancel ';
    }

    const footer = blessed.text({
      parent: dialog,
      bottom: 0,
      left: 1,
      width: '100%-4',
      height: 1,
      content: footerContent(),
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    let resolved = false;
    let pending = false;
    let unregisterCancellation = () => {};
    let notice: blessed.Widgets.BoxElement | null = null;
    let noticeTimer: NodeJS.Timeout | null = null;
    const unbindResize = bindOverlayResize(
      screen,
      dialog,
      64,
      preferredHeight,
      (nextGeometry) => {
        const nextListHeight = Math.max(1, Math.min(agents.length, nextGeometry.height - 13));
        list.height = nextListHeight;
        panelLabel.top = nextListHeight + 4;
        panelLabel.height = Math.max(1, Math.min(6, nextGeometry.height - nextListHeight - 7));
        pickerWidth = Math.max(12, nextGeometry.width - 8);
        updatePanelDisplay();
      },
    );
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      agentDialogOpen = false;
      numberInput.dispose();
      if (noticeTimer) clearTimeout(noticeTimer);
      noticeTimer = null;
      notice?.destroy();
      notice = null;
      unregisterCancellation();
      leaveDialog(screen);
      unbindResize();
      dialog.destroy();
      screen.render();
    };
    unregisterCancellation = registerDialogCancellation(screen, () => {
      try {
        cleanup();
      } finally {
        resolve(null);
      }
    });

    const finish = (choice: AgentDialogChoice) => {
      if (resolved || pending) return;
      pending = true;
      // Keep the modal shield until Blessed dispatches both enter and return.
      // Screen teardown may still cancel this queued choice before it commits.
      queueMicrotask(() => {
        if (resolved) return;
        try {
          cleanup();
        } finally {
          resolve(choice);
        }
      });
    };
    const finishNotice = () => finish(null);

    if (protocolBatchEnabled) {
      const protocolButton = blessed.box({
        parent: dialog,
        top: 1,
        right: 1,
        width: 13,
        height: 1,
        tags: false,
        mouse: true,
        clickable: true,
        autoFocus: false,
        content: ' P=Protocol ',
        style: { bg: 'cyan', fg: 'black' },
      });
      const chooseProtocol = () => finish({ action: 'protocol-batch' });
      list.key(['p', 'S-p'], chooseProtocol);
      protocolButton.on('click', (event: { button?: string }) => {
        if (event.button === 'left') chooseProtocol();
      });
    }

    const showNotice = (
      content: string,
      preferredWidth: number,
      preferredHeight: number,
      timeoutMs: number,
    ) => {
      if (notice || resolved || pending) return;
      const noticeGeometry = screenGeometry(
        screen,
        preferredWidth,
        preferredHeight,
        { minWidth: 20, minHeight: 5 },
      );
      dialog.hide();
      notice = blessed.box({
        parent: screen,
        top: 'center',
        left: 'center',
        width: noticeGeometry.width,
        height: noticeGeometry.height,
        border: { type: 'line' },
        style: { bg: theme.dialog.bg, fg: theme.dialog.fg, border: theme.dialog.border },
        tags: true,
        keys: true,
        mouse: true,
        content,
        label: ' Agent unavailable ',
      });
      notice.key(['escape', 'enter', 'q'], finishNotice);
      notice.focus();
      noticeTimer = setTimeout(finishNotice, timeoutMs);
      noticeTimer.unref?.();
      screen.render();
    };

    const moveSelection = (direction: -1 | 1) => {
      if (resolved || pending) return;
      numberInput.reset();
      selectedPanel = adjacentPanelId(panelIds, selectedPanel, direction) ?? selectedPanel;
      updatePanelDisplay();
      screen.render();
    };
    list.key(['left'], () => moveSelection(-1));
    list.key(['right'], () => moveSelection(1));

    if (batchEnabled) {
      list.key(['n', 'S-n'], () => {
        if (resolved || pending) return;
        batchMode = !batchMode;
        replaceBatchDigits = true;
        numberInput.reset();
        footer.setContent(footerContent());
        updatePanelDisplay();
        screen.render();
      });
      list.key(['backspace'], () => {
        if (resolved || pending || !batchMode) return;
        batchDigits = batchDigits.slice(0, -1);
        replaceBatchDigits = false;
        updatePanelDisplay();
        screen.render();
      });
      // Preserve invalid printable input so e.g. "1.5" cannot silently become
      // an accepted count of 15. Navigation and modal controls remain separate.
      list.on('keypress', (character, key) => {
        if (resolved || pending || !batchMode || !character || key.ctrl || key.meta) return;
        if (!/^[ -~]$/u.test(character) || /^[0-9nN]$/u.test(character)) return;
        if (protocolBatchEnabled && /^[pP]$/u.test(character)) return;
        appendBatchDigit(character);
      });
    }

    function appendBatchDigit(character: string): void {
      batchDigits = (replaceBatchDigits ? character : batchDigits + character).slice(0, 16);
      replaceBatchDigits = false;
      updatePanelDisplay();
      screen.render();
    }

    for (let n = 0; n <= 9; n++) {
      list.key([String(n)], () => {
        if (resolved || pending) return;
        if (batchMode) {
          appendBatchDigit(String(n));
          return;
        }
        const panelId = numberInput.acceptDigit(String(n));
        if (panelId !== null) selectedPanel = panelId;
        updatePanelDisplay();
        screen.render();
      });
    }

    const handleSelect = (index: number) => {
      if (resolved || pending) return;
      if (batchMode ? batchCount() === null : !numberInput.canConfirm) {
        updatePanelDisplay();
        screen.render();
        return;
      }
      const agent = agents[index];
      if (agent && agent.installed && agent.supported && !agent.configurationError) {
        finish({
          agentType: agent.type,
          profileId: agent.profileId,
          panelIndex: selectedPanel,
          ...(batchMode ? { newPanelCount: batchCount()! } : {}),
        });
      } else if (agent && !agent.installed) {
        showNotice(
          `Not installed. Run:\n${escapeTaggedText(agent.installCommand, 300)}\n\nPress Enter or Esc to close.`,
          50,
          7,
          4000,
        );
      } else if (agent?.configurationError) {
        showNotice(
          `Invalid profile “${escapeTaggedText(agent.profileLabel, 120)}”:\n` +
          `${escapeTaggedText(agent.configurationError, 280)}\n\nPress Enter or Esc to close.`,
          58,
          8,
          5000,
        );
      } else {
        finish(null);
      }
    };

    // Enter key — manually trigger selection (keys:false means 'select' event won't fire)
    list.key(['enter'], () => {
      const index = (list as any).selected ?? 0;
      handleSelect(index);
    });

    // Mouse click selection
    list.on('select', (_item: any, index: number) => {
      handleSelect(index);
    });

    list.key(['escape'], () => {
      cleanup();
      resolve(null);
    });

    list.focus();
    screen.render();
  });
}
