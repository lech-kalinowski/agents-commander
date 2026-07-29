import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';

export const HELP_TEXT = `
{bold}{cyan-fg}AGENTS COMMANDER{/cyan-fg}{/bold}
Multi-panel AI Agent Manager & File Browser

{bold}{yellow-fg}FUNCTION KEYS{/yellow-fg}{/bold}

  F1   Help          F2   Launch Agent
  F3   Add panel     F4   View file
  F5   Edit file     F6   Copy
  F7   Move/Rename   F8   Mkdir
  F9   Delete        F10  Quit

{bold}{yellow-fg}NAVIGATION{/yellow-fg}{/bold}

  Tab         Switch active panel
  Up/Down     Move cursor
  Enter       Open directory / view file
  Backspace   Go to parent directory
  Home/End    Jump to first/last file
  PgUp/PgDn   Scroll page
  Insert      Select/deselect file

{bold}{yellow-fg}AGENTS{/yellow-fg}{/bold}

  F2          Launch agent in panel
  Ctrl+O      Orchestrate — send task to agent
  Ctrl+P      Send protocol instructions to active agent
  F12         Routed-message activity
  Shift+F12   Inter-agent protocol guide
  Ctrl+B      Browse 121 prompt templates
              (select → pick panel → sent to agent)
  Ctrl+T      Toggle panel: file <-> terminal
  Ctrl+K      Kill running session on active terminal
  Ctrl+C      Send interrupt to agent
  Ctrl+D      Send EOF to agent

  On a terminal panel, F-keys and shortcuts
  above work as app actions. Keys below
  pass through to the agent instead
  (use them from a file panel via Tab).

{bold}{yellow-fg}INTER-AGENT PROTOCOL{/yellow-fg}{/bold}

  5 commands (all end with {cyan-fg}===COMMANDER:END==={/cyan-fg}):

  {cyan-fg}SEND:agent:panel{/cyan-fg}  Direct message
  {cyan-fg}REPLY{/cyan-fg}             Reply to last sender
  {cyan-fg}BROADCAST{/cyan-fg}         Message all other agents
  {cyan-fg}STATUS{/cyan-fg}            Progress toast + local ACK
  {cyan-fg}QUERY{/cyan-fg}             Ask who's running

  Sender gets an ACK after delivery.
  F12 shows routed SEND/REPLY/BROADCAST history.
  Press {cyan-fg}Shift+F12{/cyan-fg} for the full guide.

{bold}{yellow-fg}LAYOUT & SYSTEM{/yellow-fg}{/bold}

  Ctrl+2/3/4  Switch to 2/3/4 panels
  Ctrl+W      Remove active panel (confirms live session)

  {bold}File panel only{/bold} (pass through to agents):
  Ctrl+E      Reset to default 2-panel view
  Ctrl+G      Edit selected file in Vim; otherwise guide
  Ctrl+H      Toggle hidden files
  Ctrl+R      Refresh panels
  Ctrl+L      View application logs

{bold}{yellow-fg}SUPPORTED ADAPTERS{/yellow-fg}{/bold}

  {green-fg}Claude Code{/green-fg}   Anthropic      {green-fg}Codex CLI{/green-fg}  OpenAI
  {green-fg}Gemini CLI{/green-fg}    Google         {green-fg}Shell{/green-fg}      Local/configured

{bold}{yellow-fg}CATALOGUED FUTURE PRESETS{/yellow-fg}{/bold}

  Aider · Cline · OpenCode · Goose · Kiro · Amp
  Listed in the selector, but not launchable yet.
`.trim();

let helpOpen = false;

export function showHelpDialog(screen: blessed.Widgets.Screen, theme: Theme): void {
  if (helpOpen) return;
  helpOpen = true;
  enterDialog();

  const dialog = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '80%',
    height: '85%',
    border: { type: 'line' },
    style: {
      bg: theme.dialog.bg,
      fg: theme.dialog.fg,
      border: theme.dialog.border,
    },
    tags: true,
    label: ' Help (F1) ',
    shadow: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      style: { bg: 'cyan' },
    },
    mouse: true,
    content: HELP_TEXT,
  });

  blessed.text({
    parent: dialog,
    bottom: 0,
    left: 'center',
    content: ' Press Esc, Enter, or q to close ',
    style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
  });

  // Manual scroll keys (since we removed keys:true/vi:true that swallow events)
  dialog.key(['up'], () => { dialog.scroll(-1); screen.render(); });
  dialog.key(['down'], () => { dialog.scroll(1); screen.render(); });
  dialog.key(['pageup'], () => { dialog.scroll(-((dialog.height as number) - 4)); screen.render(); });
  dialog.key(['pagedown'], () => { dialog.scroll((dialog.height as number) - 4); screen.render(); });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    helpOpen = false;
    leaveDialog();
    screen.removeListener('keypress', onScreenKey);
    dialog.destroy();
    screen.render();
  };

  // Close on dialog-level keys
  dialog.key(['escape', 'enter', 'q', 'f1'], close);

  // Also listen on screen level as fallback (some blessed scrollable
  // boxes don't reliably route key events to dialog.key handlers)
  const onScreenKey = (_ch: any, key: any) => {
    if (!key) return;
    const name = key.full || key.name;
    if (name === 'escape' || name === 'enter' || name === 'q' || name === 'f1') {
      close();
    }
  };
  screen.on('keypress', onScreenKey);

  dialog.focus();
  screen.render();
}
