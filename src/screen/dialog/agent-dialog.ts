import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import type { AgentProfile, AgentType } from '../../agents/types.js';
import { discoverAgents } from '../../agents/agent-registry.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';
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
  enterDialog();

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
    list.key(['up'], () => { list.up(1); screen.render(); });
    list.key(['down'], () => { list.down(1); screen.render(); });

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
      leaveDialog();
      unbindResize();
      dialog.destroy();
      screen.render();
    };

    const moveSelection = (direction: -1 | 1) => {
      numberInput.reset();
      selectedPanel = adjacentPanelId(panelIds, selectedPanel, direction) ?? selectedPanel;
      updatePanelDisplay();
      screen.render();
    };
    list.key(['left'], () => moveSelection(-1));
    list.key(['right'], () => moveSelection(1));

    for (let n = 0; n <= 9; n++) {
      list.key([String(n)], () => {
        const panelId = numberInput.acceptDigit(String(n));
        if (panelId !== null) selectedPanel = panelId;
        updatePanelDisplay();
        screen.render();
      });
    }

    const handleSelect = (index: number) => {
      if (!numberInput.canConfirm) {
        updatePanelDisplay();
        screen.render();
        return;
      }
      const agent = agents[index];
      cleanup();
      if (agent && agent.installed && agent.supported && !agent.configurationError) {
        resolve({
          agentType: agent.type,
          profileId: agent.profileId,
          panelIndex: selectedPanel,
        });
      } else if (agent && !agent.installed) {
        const messageGeometry = screenGeometry(screen, 50, 5, { minWidth: 20, minHeight: 5 });
        const msg = blessed.message({
          parent: screen,
          top: 'center',
          left: 'center',
          width: messageGeometry.width,
          height: messageGeometry.height,
          border: { type: 'line' },
          style: { bg: theme.dialog.bg, fg: theme.dialog.fg, border: theme.dialog.border },
          tags: true,
        });
        msg.display(`Not installed. Run:\n${agent.installCommand}`, 4, () => {
          screen.render();
        });
        resolve(null);
      } else if (agent?.configurationError) {
        const messageGeometry = screenGeometry(screen, 58, 6, { minWidth: 24, minHeight: 5 });
        const msg = blessed.message({
          parent: screen,
          top: 'center',
          left: 'center',
          width: messageGeometry.width,
          height: messageGeometry.height,
          border: { type: 'line' },
          style: { bg: theme.dialog.bg, fg: theme.dialog.fg, border: theme.dialog.border },
          tags: true,
        });
        msg.display(
          `Invalid profile “${escapeTaggedText(agent.profileLabel, 120)}”:\n` +
          escapeTaggedText(agent.configurationError, 280),
          5,
          () => {
          screen.render();
          },
        );
        resolve(null);
      } else {
        resolve(null);
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
