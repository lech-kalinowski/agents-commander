import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import type { AgentType } from '../../agents/types.js';
import { discoverAgents } from '../../agents/agent-registry.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';
import { renderPanelBoxes } from './panel-picker.js';

export interface OrchestrateChoice {
  agentType: AgentType;
  panelIndex: number;
  task: string;
}

let dialogOpen = false;

export function showOrchestrateDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  panelCount: number,
  activePanelIndex: number,
): Promise<OrchestrateChoice | null> {
  if (dialogOpen) return Promise.resolve(null);
  dialogOpen = true;
  enterDialog();

  return new Promise((resolve) => {
    const agents = discoverAgents().filter((a) => a.installed && a.supported);

    if (agents.length === 0) {
      dialogOpen = false;
      leaveDialog();
      resolve(null);
      return;
    }

    const dialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 70,
      height: 22,
      border: { type: 'line' },
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        border: theme.dialog.border,
      },
      tags: true,
      label: ' Orchestrate — Send Task to Agent (Ctrl+O) ',
      shadow: true,
    });

    // ── Step indicator ──
    const stepBox = blessed.text({
      parent: dialog,
      top: 1,
      left: 2,
      tags: true,
      content: '{bold}Step 1/3:{/bold} Select target agent',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    // ── Agent list ──
    const agentItems = agents.map((a) => `  ${a.name.padEnd(20)} ${a.description}`);
    const agentList = blessed.list({
      parent: dialog,
      top: 3,
      left: 2,
      width: 64,
      height: agents.length + 1,
      tags: true,
      keys: false,
      mouse: true,
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        selected: { bg: 'cyan', fg: 'black' },
      },
      items: agentItems as any,
    });

    // Manual navigation (keys:false means we handle up/down/enter ourselves)
    agentList.key(['up'], () => { agentList.up(1); screen.render(); });
    agentList.key(['down'], () => { agentList.down(1); screen.render(); });

    // ── Panel picker (hidden initially) ──
    const panelBox = blessed.box({
      parent: dialog,
      top: 3,
      left: 2,
      width: 64,
      height: 8,
      tags: true,
      hidden: true,
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    // ── Task input (hidden initially) ──
    const taskLabel = blessed.text({
      parent: dialog,
      top: 3,
      left: 2,
      tags: true,
      hidden: true,
      content: '',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    const taskInput = blessed.textbox({
      parent: dialog,
      top: 5,
      left: 2,
      width: 64,
      height: 3,
      border: { type: 'line' },
      style: {
        bg: 'black',
        fg: 'white',
        border: { fg: 'cyan' },
        focus: { bg: 'black', fg: 'white' },
      },
      inputOnFocus: false,
      hidden: true,
    });

    const taskHint = blessed.text({
      parent: dialog,
      top: 9,
      left: 2,
      tags: true,
      hidden: true,
      content: '{bold}Tip:{/bold} Describe the task for the agent. Press Enter to send.',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    // ── Footer ──
    const footer = blessed.text({
      parent: dialog,
      bottom: 0,
      left: 'center',
      content: ' Enter=Select  Esc=Cancel ',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    // ── State ──
    let selectedAgent: (typeof agents)[0] | null = null;
    let selectedPanel = activePanelIndex;

    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      dialogOpen = false;
      leaveDialog();
      dialog.destroy();
      screen.render();
    };

    // ── STEP 1: Agent selection ──
    const handleAgentSelect = (index: number) => {
      selectedAgent = agents[index];
      if (!selectedAgent) return;
      showStep2();
    };

    // Enter key for agent list (keys:false means 'select' event won't fire from keyboard)
    agentList.key(['enter'], () => {
      const index = (agentList as any).selected ?? 0;
      handleAgentSelect(index);
    });

    // Mouse click
    agentList.on('select', (_item: any, index: number) => {
      handleAgentSelect(index);
    });

    agentList.key(['escape'], () => { cleanup(); resolve(null); });

    // ── STEP 2: Panel selection ──
    function renderPanelContent(): void {
      const header = '  Select target panel:\n\n';
      panelBox.setContent(header + renderPanelBoxes(selectedPanel, panelCount));
    }

    function showStep2() {
      agentList.hide();
      stepBox.setContent(`{bold}Step 2/3:{/bold} Select target panel for {cyan-fg}${selectedAgent!.name}{/cyan-fg}`);

      renderPanelContent();
      panelBox.show();
      footer.setContent(' 1-4=Panel  Enter=Confirm  Esc=Back ');
      panelBox.focus();
      screen.render();

      panelBox.on('keypress', (ch: string | undefined, _key: any) => {
        if (!ch) return;
        const n = parseInt(ch, 10);
        if (n >= 1 && n <= 4) {
          selectedPanel = n - 1;
          renderPanelContent();
          screen.render();
        }
      });

      panelBox.key(['enter'], () => {
        showStep3();
      });

      panelBox.key(['escape'], () => {
        // Go back to step 1
        panelBox.hide();
        agentList.show();
        stepBox.setContent('{bold}Step 1/3:{/bold} Select target agent');
        footer.setContent(' Enter=Select  Esc=Cancel ');
        agentList.focus();
        screen.render();
      });
    }

    // ── STEP 3: Task input ──
    function showStep3() {
      panelBox.hide();
      stepBox.setContent(
        `{bold}Step 3/3:{/bold} Type task for {cyan-fg}${selectedAgent!.name}{/cyan-fg} in Panel ${selectedPanel + 1}`,
      );
      taskLabel.setContent(`{bold}Task:{/bold}`);
      taskLabel.show();
      taskInput.show();
      taskHint.show();
      footer.setContent(' Enter=Send  Esc=Back ');
      screen.render();

      taskInput.readInput((_err: Error | null, value: string | undefined) => {
        if (value != null && value.trim().length > 0) {
          cleanup();
          resolve({
            agentType: selectedAgent!.type,
            panelIndex: selectedPanel,
            task: value.trim(),
          });
        } else {
          // Go back to step 2
          taskLabel.hide();
          taskInput.hide();
          taskHint.hide();
          taskInput.clearValue();
          showStep2();
        }
      });
    }

    agentList.focus();
    screen.render();
  });
}
