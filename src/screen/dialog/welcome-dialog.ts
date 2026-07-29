import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';
import { loadTemplates } from '../../templates/loader.js';
import { getPackageVersion } from '../../utils/package-info.js';
import { bindOverlayResize, type OverlayGeometry } from './geometry.js';

// Generated with: toilet -f future
const LOGO = `
{bold}{cyan-fg}                   ┏━┓┏━╸┏━╸┏┓╻╺┳╸┏━┓
                   ┣━┫┃╺┓┣╸ ┃┗┫ ┃ ┗━┓
                   ╹ ╹┗━┛┗━╸╹ ╹ ╹ ┗━┛
              ┏━╸┏━┓┏┳┓┏┳┓┏━┓┏┓╻╺┳┓┏━╸┏━┓
              ┃  ┃ ┃┃┃┃┃┃┃┣━┫┃┗┫ ┃┃┣╸ ┣┳┛
              ┗━╸┗━┛╹ ╹╹ ╹╹ ╹╹ ╹╺┻┛┗━╸╹┗╸{/cyan-fg}{/bold}

         {bold}v${getPackageVersion()}{/bold}  —  Multi-Agent Terminal Manager


  {bold}{yellow-fg}Run multiple AI agents side by side{/yellow-fg}{/bold}

  Launch {green-fg}Claude{/green-fg}, {green-fg}Codex{/green-fg}, and {green-fg}Gemini{/green-fg} in parallel panels.
  Agents talk to each other via the Commander protocol
  — one delegates, another executes, results flow back.

  {bold}{yellow-fg}Key Features{/yellow-fg}{/bold}

    {cyan-fg}F2{/cyan-fg}       Launch an AI agent in any panel
    {cyan-fg}Ctrl+O{/cyan-fg}   Send a task to any agent
    {cyan-fg}Ctrl+B{/cyan-fg}   Browse ${loadTemplates().length} prompt templates
    {cyan-fg}Ctrl+P{/cyan-fg}   Teach agents to collaborate
    {cyan-fg}F12{/cyan-fg}      Inter-agent communication guide

  {bold}{yellow-fg}File Manager{/yellow-fg}{/bold}

    Built-in dual-panel file browser with copy, move,
    delete, Markdown editor, and Vim ({cyan-fg}Ctrl+G{/cyan-fg}).

  {bold}{yellow-fg}Quick Start{/yellow-fg}{/bold}

    1. Navigate to your project folder
    2. Press {cyan-fg}F2{/cyan-fg} to launch an agent
    3. Type your task and press Enter
    4. Press {cyan-fg}Ctrl+B{/cyan-fg} for collaboration templates


       {bold}by Lech Kalinowski{/bold}  —  CC BY-NC 4.0

                Press any key to start...
`.trim();

const COMPACT_WELCOME = `
{bold}{cyan-fg}AGENTS COMMANDER{/cyan-fg}{/bold}
{bold}v${getPackageVersion()}{/bold} — Multi-Agent Terminal Manager

Run Claude, Codex, and Gemini side by side.
Agents coordinate through the visible Commander protocol.

{cyan-fg}F2{/cyan-fg}       Launch an agent
{cyan-fg}Ctrl+O{/cyan-fg}   Send a task
{cyan-fg}Ctrl+B{/cyan-fg}   Browse ${loadTemplates().length} templates
{cyan-fg}Ctrl+P{/cyan-fg}   Inject protocol instructions
{cyan-fg}F12{/cyan-fg}      Protocol guide

Use a disposable project when enabling automatic approvals.

Press any key to start...
`.trim();

export function showWelcomeDialog(screen: blessed.Widgets.Screen, theme: Theme): Promise<void> {
  return new Promise((resolve) => {
    enterDialog();

    const dialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 42,
      border: { type: 'line' },
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        border: { fg: 'cyan' },
      },
      tags: true,
      shadow: true,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      content: LOGO,
    });

    const updateContent = (geometry: OverlayGeometry) => {
      dialog.setContent(geometry.compact ? COMPACT_WELCOME : LOGO);
      dialog.setScrollPerc(0);
    };
    const unbindResize = bindOverlayResize(screen, dialog, 60, 42, updateContent);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      leaveDialog();
      unbindResize();
      screen.removeListener('keypress', onKey);
      screen.removeListener('mouse', onMouse);
      dialog.destroy();
      screen.render();
      resolve();
    };

    const onKey = () => { close(); };
    const onMouse = (data: any) => {
      if (data.action === 'mousedown') close();
    };

    screen.on('keypress', onKey);
    screen.on('mouse', onMouse);

    dialog.focus();
    screen.render();
  });
}
