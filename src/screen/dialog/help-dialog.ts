import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import {
  enterDialog,
  leaveDialog,
  registerDialogCancellation,
} from '../../utils/dialog-state.js';

export const HELP_TEXT = `
{bold}{cyan-fg}AGENTS COMMANDER{/cyan-fg}{/bold}
Multi-panel AI Agent Manager & File Browser

{bold}{yellow-fg}FUNCTION KEYS{/yellow-fg}{/bold}

  F1   Help          F2   Launch Agent
  F3   Add panel     F4   Fullscreen / Back
  F5   Edit file     F6   Clone panel
  F7   Panel order   F8   Mkdir
  F9   Close panel   F10  Quit

  F4 again restores the panel grid (Full changes to Back).
  F6 opens a panel at the same directory, with a fresh agent
  when managed; it does not clone conversations or running process state.
  Unmanaged commands become idle terminals; demo roles cannot clone.
  Press Ctrl+P in a new agent to enable its protocol session.
  F7 chooses workspace position; protocol P IDs stay stable.
  F9 closes a panel, never a file; live sessions need consent.

{bold}{yellow-fg}NAVIGATION{/yellow-fg}{/bold}

  Tab         Switch active panel
  Up/Down     Move cursor
  Enter       Open directory / view file
  Backspace   Go to parent directory
  Home/End    Jump to first/last file
  PgUp/PgDn   Scroll page
  Insert      Select/deselect file

  File operations (file panels only):
  Shift+F6    Copy selected files
  Shift+F7    Move / rename selected files
  Shift+F9    Delete selected files (with confirmation)

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

  F1–F10 remain app controls on terminal panels.
  File-only actions require a file panel (Tab to switch).
  Ctrl+C / Ctrl+D are forwarded to the running agent.

{bold}{yellow-fg}INTER-AGENT PROTOCOL{/yellow-fg}{/bold}

  Ctrl+P gives the current agent a private {cyan-fg}<session-key>{/cyan-fg}.
  Every header and footer must include that same key:

  {cyan-fg}SEND:agent:panel:<session-key>{/cyan-fg}  Direct message
  {cyan-fg}REPLY:<session-key>{/cyan-fg}             Latest open reply window
  {cyan-fg}BROADCAST:<session-key>{/cyan-fg}         Message all other agents
  {cyan-fg}STATUS:<session-key>{/cyan-fg}            Progress toast + local ACK
  {cyan-fg}QUERY:<session-key>{/cyan-fg}             Ask who's running
  Footer: {cyan-fg}===COMMANDER:END:<session-key>==={/cyan-fg}

  REPLY claims the newest open window for this session.
  A failed delivery restores it if both sessions remain active.
  SEND/REPLY status=delivered confirms PTY input submission.
  It does not confirm task completion; status=failed reports an error.
  BROADCAST reports queue admission; STATUS reports acceptance.
  F12 shows routed SEND/REPLY/BROADCAST history.
  History is bounded and in-memory; STATUS/QUERY are not in Activity.
  Ctrl+L opens a rotating diagnostic log, not a conversation archive.
  Opt-in capture: --capture protocol --capture-project <opaque-id>.
  Dataset export requires human review; see docs/datasets.md.
  No raw keyboard recording, automatic training or uploads.
  Press {cyan-fg}Shift+F12{/cyan-fg} for the full guide.

{bold}{yellow-fg}LAYOUT & SYSTEM{/yellow-fg}{/bold}

  Up to 100 active panels share a paged workspace.
  Tab follows focus across pages; terminal sessions on
  hidden pages keep running.
  Panel numbers stay stable (protocol P IDs).
  Gaps after removal are normal.
  Workspace positions change when panels are reordered.

  F11         Search/jump to any panel by number or metadata
  Shift+F4    Cycle Auto / 2 / 3 / 4 visible density
  Ctrl+0      Auto-fit (terminal-dependent direct alias)
  Ctrl+2/3/4  Direct density aliases when terminal supports them
  Ctrl+W      Close active panel (same as F9; confirms live session)

  CLI: --panels 1-100 sets the initial workspace size.
       --density auto|2|3|4 sets visible density.

{bold}{yellow-fg}CODEX MICRO (EXPERIMENTAL){/yellow-fg}{/bold}

  Native macOS input reads the shipping controls directly;
  no Work Louder reprogramming is required. Allow the launch
  terminal in Privacy & Security > Input Monitoring.

  Native input uses a sole-reader conflict guard. This is not an
  OS-enforced exclusive lock. If another active reader is found,
  {yellow-fg}MICRO:BUSY{/yellow-fg} appears and Commander discards device input.
  Fully quit ChatGPT, or disable its Input Monitoring and restart
  it; keep the launch terminal permitted, then rerun Doctor.
  Never use sudo. On firmware 0.4.1, Layer 2 did not isolate events.

  Factory labels are swappable; fixed AG/ACT positions are used.
  Agent keys 1–6   Focus active workspace slots 1–6
  Fast / Split     Cycle density / add panel
  Codex key        Panel navigator (same destination as F11)
  Dial turn/press  Previous/next panel / routed Activity
  Joystick         Panel/page navigation
  Approve/Reject   Guarded decisions; disabled by default

  Verify: {cyan-fg}agents-commander --doctor --codex-micro{/cyan-fg}
  Test:   {cyan-fg}agents-commander --codex-micro-test{/cyan-fg}
  Run:    {cyan-fg}agents-commander --codex-micro{/cyan-fg}
  Decisions require {cyan-fg}--codex-micro-decisions{/cyan-fg} and a
  second matching press within five seconds.

  {cyan-fg}--codex-micro-keyboard{/cyan-fg} is the explicit fallback for
  a layer programmed with legacy shortcuts. Its guard is unavailable;
  decisions are disabled. Keep ChatGPT quit for the entire session.
  Conference and Demo modes do not enable hardware automatically.

  {bold}File panel only{/bold} (pass through to agents):
  Ctrl+E      Reset to default 2-panel view
  Ctrl+G      Edit selected file in Vim; otherwise guide
  Ctrl+H      Toggle hidden files
  Ctrl+R      Refresh panels
  Ctrl+L      View application logs

{bold}{yellow-fg}SUPPORTED ADAPTERS{/yellow-fg}{/bold}

  {green-fg}Claude Code{/green-fg}   Anthropic      {green-fg}Codex CLI{/green-fg}  OpenAI
  {green-fg}Gemini CLI{/green-fg}    Google         {green-fg}OpenCode{/green-fg}   Multi-provider
  {green-fg}Shell{/green-fg}         Local/configured

{bold}{yellow-fg}CATALOGUED FUTURE PRESETS{/yellow-fg}{/bold}

  Aider · Cline · Goose · Kiro · Amp
  Listed in the selector, but not launchable yet.
`.trim();

let helpOpen = false;

export function showHelpDialog(screen: blessed.Widgets.Screen, theme: Theme): void {
  if (helpOpen) return;
  helpOpen = true;
  enterDialog(screen);

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
  let unregisterCancellation = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    helpOpen = false;
    unregisterCancellation();
    leaveDialog(screen);
    screen.removeListener('keypress', onScreenKey);
    dialog.destroy();
    screen.render();
  };
  unregisterCancellation = registerDialogCancellation(screen, close);

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
