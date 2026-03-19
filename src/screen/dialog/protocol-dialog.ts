import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';

const GUIDE_TEXT = `
{bold}{cyan-fg}INTER-AGENT COMMUNICATION GUIDE{/cyan-fg}{/bold}

Agents Commander lets your AI agents talk to each other.
One agent can delegate tasks, request help, or share results
with another agent running in a different panel.


{bold}{yellow-fg}QUICK START{/yellow-fg}{/bold}

  {bold}1.{/bold} Launch agents in two or more panels
     Press {cyan-fg}F2{/cyan-fg}, pick an agent, pick a panel.
     Repeat for each agent you want.

  {bold}2.{/bold} Inject the protocol
     Focus a terminal panel and press {cyan-fg}Ctrl+P{/cyan-fg}.
     This teaches the agent it can talk to other agents.
     Do this for each agent you want to participate.

  {bold}3.{/bold} Give a collaborative task
     Type a prompt like:
       {green-fg}"Analyze this code for bugs, then send the
        results to Codex in Panel 2 to write fixes."{/green-fg}
     The agent uses the protocol markers to send the task.
     Commander intercepts and routes it automatically.


{bold}{yellow-fg}MANUAL ORCHESTRATION{/yellow-fg}{/bold}

  Press {cyan-fg}Ctrl+O{/cyan-fg} to open the Orchestrate dialog.
  You pick the target agent, the panel, and type the task.
  Commander launches the agent if needed and sends your task.


{bold}{yellow-fg}PROTOCOL COMMANDS{/yellow-fg}{/bold}

  All commands use {cyan-fg}===COMMANDER:END==={/cyan-fg} to close the block.

  {bold}1. SEND{/bold} — direct message to a specific agent:

    {cyan-fg}===COMMANDER:SEND:{/cyan-fg}{white-fg}agent_type{/white-fg}{cyan-fg}:{/cyan-fg}{white-fg}panel_number{/white-fg}{cyan-fg}==={/cyan-fg}
    {white-fg}your message or task{/white-fg}
    {cyan-fg}===COMMANDER:END==={/cyan-fg}

  {bold}2. REPLY{/bold} — respond to whoever last messaged you:

    {cyan-fg}===COMMANDER:REPLY==={/cyan-fg}
    {white-fg}your response{/white-fg}
    {cyan-fg}===COMMANDER:END==={/cyan-fg}

    No need to know the sender's panel number.
    Commander routes it back automatically.

  {bold}3. BROADCAST{/bold} — send to all connected agents:

    {cyan-fg}===COMMANDER:BROADCAST==={/cyan-fg}
    {white-fg}message for everyone{/white-fg}
    {cyan-fg}===COMMANDER:END==={/cyan-fg}

    Delivered to every panel except the sender.

  {bold}4. STATUS{/bold} — report progress (shown in UI and acknowledged in your panel):

    {cyan-fg}===COMMANDER:STATUS==={/cyan-fg}
    {white-fg}Processing file 5 of 10...{/white-fg}
    {cyan-fg}===COMMANDER:END==={/cyan-fg}

    Shows a toast notification in Commander and returns a local ACK.

  {bold}5. QUERY{/bold} — ask Commander for environment info:

    {cyan-fg}===COMMANDER:QUERY==={/cyan-fg}
    {white-fg}agents{/white-fg}
    {cyan-fg}===COMMANDER:END==={/cyan-fg}

    Queries: {cyan-fg}agents{/cyan-fg} (list running agents),
    {cyan-fg}panels{/cyan-fg} (panel layout info),
    {cyan-fg}status{/cyan-fg} (your status),
    {cyan-fg}help{/cyan-fg} (protocol command list),
    {cyan-fg}ping{/cyan-fg} (test responsiveness).


{bold}{yellow-fg}ACKNOWLEDGMENTS{/yellow-fg}{/bold}

  After SEND, REPLY, BROADCAST, or STATUS, the sender gets an ACK:
    {green-fg}[Commander] Message delivered to codex in Panel 2 (OK){/green-fg}

  Or on failure:
    {red-fg}[Commander] Failed to deliver to codex in Panel 2: reason{/red-fg}

  Agents should wait for the ACK before sending again.


{bold}{yellow-fg}AGENT TYPES{/yellow-fg}{/bold}

  Use these names in the SEND marker:

  {cyan-fg}claude{/cyan-fg}      Claude Code  (Anthropic)
  {cyan-fg}codex{/cyan-fg}       Codex CLI    (OpenAI)
  {cyan-fg}gemini{/cyan-fg}      Gemini CLI   (Google)
  {cyan-fg}aider{/cyan-fg}       Aider        (Paul Gauthier)
  {cyan-fg}cline{/cyan-fg}       Cline        (VS Code agent)
  {cyan-fg}opencode{/cyan-fg}    OpenCode     (Open source)
  {cyan-fg}goose{/cyan-fg}       Goose        (Block)
  {cyan-fg}kiro{/cyan-fg}        Kiro         (AWS)
  {cyan-fg}amp{/cyan-fg}         Amp          (Sourcegraph)
  {cyan-fg}generic{/cyan-fg}     Generic      (any CLI tool)

  Panels are numbered {cyan-fg}1{/cyan-fg} to {cyan-fg}4{/cyan-fg}.


{bold}{yellow-fg}EXAMPLE WORKFLOWS{/yellow-fg}{/bold}

  {bold}Code review pipeline:{/bold}
    Panel 1 (Claude): "Analyze src/ for bugs"
      Claude finds issues → SEND to Codex
    Panel 2 (Codex): receives issues, writes fixes
      Codex finishes → REPLY back to Claude
    Panel 1 (Claude): verifies fixes, reports summary

  {bold}Multi-perspective security audit:{/bold}
    Panel 1 (Claude):  BROADCAST "begin security audit"
    Panel 2 (Gemini):  Security analysis → REPLY results
    Panel 3 (Codex):   Writes patches → STATUS progress

  {bold}Divide and conquer:{/bold}
    "Split this refactor: SEND backend to Codex in Panel 2,
     SEND frontend to Gemini in Panel 3, then QUERY agents
     to check who's done."


{bold}{yellow-fg}KEYBOARD SHORTCUTS{/yellow-fg}{/bold}

  {cyan-fg}F2{/cyan-fg}          Launch agent in a panel
  {cyan-fg}Ctrl+O{/cyan-fg}      Orchestrate (send task to agent)
  {cyan-fg}Ctrl+P{/cyan-fg}      Inject protocol into active agent
  {cyan-fg}F12{/cyan-fg}         This guide
  {cyan-fg}Ctrl+K{/cyan-fg}      Kill running session on active panel
  {cyan-fg}Ctrl+T{/cyan-fg}      Toggle panel: file <-> terminal
  {cyan-fg}Ctrl+0{/cyan-fg}      Reset to default 2-panel view
  {cyan-fg}Tab{/cyan-fg}         Switch between panels


{bold}{yellow-fg}TIPS{/yellow-fg}{/bold}

  - Press Ctrl+P on each agent after launch. You only
    need to inject once per agent per session.
  - Use REPLY instead of SEND when responding — it's
    simpler and the agent doesn't need panel numbers.
  - Use BROADCAST for coordinator patterns where one
    agent needs to instruct all others at once.
  - STATUS is great for long tasks — you see progress
    in a toast without interrupting other agents.
  - Use QUERY to let agents discover who's available
    before deciding where to send work.
`.trim();

let guideOpen = false;

export function showProtocolGuide(screen: blessed.Widgets.Screen, theme: Theme): void {
  if (guideOpen) return;
  guideOpen = true;
  enterDialog();

  const dialog = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '85%',
    height: '90%',
    border: { type: 'line' },
    style: {
      bg: theme.dialog.bg,
      fg: theme.dialog.fg,
      border: { fg: 'cyan' },
    },
    tags: true,
    label: ' Inter-Agent Communication Guide (F12) ',
    shadow: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      style: { bg: 'cyan' },
    },
    mouse: true,
    content: GUIDE_TEXT,
  });

  blessed.text({
    parent: dialog,
    bottom: 0,
    left: 'center',
    content: ' Esc/Enter/q/F12 = Close    PgUp/PgDn = Scroll ',
    style: { bg: theme.dialog.bg, fg: 'cyan' },
  });

  dialog.key(['up'], () => { dialog.scroll(-1); screen.render(); });
  dialog.key(['down'], () => { dialog.scroll(1); screen.render(); });
  dialog.key(['pageup'], () => { dialog.scroll(-((dialog.height as number) - 4)); screen.render(); });
  dialog.key(['pagedown'], () => { dialog.scroll((dialog.height as number) - 4); screen.render(); });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    guideOpen = false;
    leaveDialog();
    screen.removeListener('keypress', onScreenKey);
    dialog.destroy();
    screen.render();
  };

  // Close on dialog-level keys
  dialog.key(['escape', 'enter', 'q', 'f12', 'C-g'], close);

  // Also listen on screen level as fallback (some blessed scrollable
  // boxes don't reliably route key events to dialog.key handlers)
  const onScreenKey = (_ch: any, key: any) => {
    if (!key) return;
    const name = key.full || key.name;
    if (name === 'escape' || name === 'enter' || name === 'q' || name === 'f12' || name === 'C-g') {
      close();
    }
  };
  screen.on('keypress', onScreenKey);

  dialog.focus();
  screen.render();
}
