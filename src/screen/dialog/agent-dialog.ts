import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import type { AgentType } from '../../agents/types.js';
import { discoverAgents } from '../../agents/agent-registry.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';
import { renderPanelBoxes } from './panel-picker.js';

export interface AgentLaunchChoice {
  agentType: AgentType;
  panelIndex: number;
}

let agentDialogOpen = false;

export function showAgentDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  panelCount: number,
  activePanelIndex: number,
): Promise<AgentLaunchChoice | null> {
  if (agentDialogOpen) return Promise.resolve(null);
  agentDialogOpen = true;
  enterDialog();

  return new Promise((resolve) => {
    const agents = discoverAgents();

    const dialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 64,
      height: agents.length + 14,
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
      const status = a.installed
        ? (a.supported ? '{green-fg}[OK]{/green-fg}' : '{yellow-fg}[..]{/yellow-fg}')
        : '{red-fg}[--]{/red-fg}';
      const tag = !a.supported ? ' {yellow-fg}(future){/yellow-fg}' : '';
      return `${status} ${a.name.padEnd(18)} ${a.description}${tag}`;
    });

    const list = blessed.list({
      parent: dialog,
      top: 3,
      left: 2,
      width: 58,
      height: agents.length,
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
    const panelLine = agents.length + 4;
    const panelLabel = blessed.box({
      parent: dialog,
      top: panelLine,
      left: 1,
      width: 60,
      height: 6,
      tags: true,
      content: '',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    let selectedPanel = activePanelIndex;

    function updatePanelDisplay(): void {
      const header = '{bold}Target panel:{/bold}  (press 1-' + panelCount + ' to change)\n\n';
      panelLabel.setContent(header + renderPanelBoxes(selectedPanel, panelCount, panelCount));
    }
    updatePanelDisplay();

    blessed.text({
      parent: dialog,
      bottom: 0,
      left: 'center',
      content: ' Enter=Launch  1-4=Panel  Esc=Cancel ',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      agentDialogOpen = false;
      leaveDialog();
      dialog.destroy();
      screen.render();
    };

    // Number keys to select panel
    for (let n = 1; n <= panelCount; n++) {
      list.key([String(n)], () => {
        selectedPanel = n - 1;
        updatePanelDisplay();
        screen.render();
      });
    }

    const handleSelect = (index: number) => {
      const agent = agents[index];
      cleanup();
      if (agent && agent.installed && agent.supported) {
        resolve({ agentType: agent.type, panelIndex: selectedPanel });
      } else if (agent && !agent.installed) {
        const msg = blessed.message({
          parent: screen,
          top: 'center',
          left: 'center',
          width: 50,
          height: 5,
          border: { type: 'line' },
          style: { bg: theme.dialog.bg, fg: theme.dialog.fg, border: theme.dialog.border },
          tags: true,
        });
        msg.display(`Not installed. Run:\n${agent.installCommand}`, 4, () => {
          screen.render();
        });
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
