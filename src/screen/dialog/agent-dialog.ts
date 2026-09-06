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

function escapeTaggedText(value: unknown, maxLength: number): string {
  const escape = (blessed as unknown as { escape(text: string): string }).escape;
  return escape(sanitizeUserText(value, maxLength));
}

export interface AgentLaunchChoice {
  agentType: AgentType;
  profileId: string;
  panelIndex: number;
}

let agentDialogOpen = false;

export function showAgentDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  panelSource: PanelPickerSource,
  activePanelIndex: number,
  agentOverrides?: Record<string, AgentCommandConfig>,
  agentProfiles?: readonly AgentProfile[],
): Promise<AgentLaunchChoice | null> {
  if (agentDialogOpen) return Promise.resolve(null);
  const panelIds = normalizePanelIds(panelSource);
  const firstPanelId = initialPanelId(panelIds, activePanelIndex);
  if (firstPanelId === null) return Promise.resolve(null);
  agentDialogOpen = true;
  enterDialog(screen);

  return new Promise((resolve) => {
    const agents = discoverAgents(agentOverrides, agentProfiles);
    const preferredHeight = agents.length + 14;
    const geometry = screenGeometry(screen, 64, preferredHeight);
    const listHeight = Math.max(3, Math.min(agents.length, geometry.height - 13));

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
      height: 6,
      tags: true,
      content: '',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    let selectedPanel = firstPanelId;
    let pickerWidth = Math.max(12, geometry.width - 8);
    const numberInput = new PanelNumberInputBuffer(panelIds, () => {
      updatePanelDisplay();
      screen.render();
    });

    function updatePanelDisplay(): void {
      const header = '{bold}Target panel:{/bold}  (arrows or type P-number)\n\n';
      panelLabel.setContent(
        header + renderPanelBoxes(selectedPanel, panelIds, 4, pickerWidth, numberInput.digits),
      );
    }
    updatePanelDisplay();

    blessed.text({
      parent: dialog,
      bottom: 0,
      left: 'center',
      content: ' Enter=Launch  Left/Right=Panel  0-9=Type P#  Esc=Cancel ',
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
        const nextListHeight = Math.max(3, Math.min(agents.length, nextGeometry.height - 13));
        list.height = nextListHeight;
        panelLabel.top = nextListHeight + 4;
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

    const finish = (choice: AgentLaunchChoice | null) => {
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

    for (let n = 0; n <= 9; n++) {
      list.key([String(n)], () => {
        if (resolved || pending) return;
        const panelId = numberInput.acceptDigit(String(n));
        if (panelId !== null) selectedPanel = panelId;
        updatePanelDisplay();
        screen.render();
      });
    }

    const handleSelect = (index: number) => {
      if (resolved || pending) return;
      if (!numberInput.canConfirm) {
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
