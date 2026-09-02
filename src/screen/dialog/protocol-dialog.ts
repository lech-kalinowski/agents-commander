import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import {
  enterDialog,
  leaveDialog,
  registerDialogCancellation,
} from '../../utils/dialog-state.js';

export const GUIDE_TEXT = `
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
     This teaches the agent how to talk to other agents and
     gives this one session a private routing capability.
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

  Ctrl+P supplies the real {white-fg}<session-key>{/white-fg} to the agent.
  Static markers without that key are intentionally inert.
  All headers and footers must use the same session key.

  {bold}1. SEND{/bold} — direct message to a specific agent:

    {cyan-fg}===COMMANDER:SEND:{/cyan-fg}{white-fg}agent_type{/white-fg}{cyan-fg}:{/cyan-fg}{white-fg}panel_number{/white-fg}{cyan-fg}:{/cyan-fg}{white-fg}<session-key>{/white-fg}{cyan-fg}==={/cyan-fg}
    {white-fg}your message or task{/white-fg}
    {cyan-fg}===COMMANDER:END:{/cyan-fg}{white-fg}<session-key>{/white-fg}{cyan-fg}==={/cyan-fg}

  {bold}2. REPLY{/bold} — continue your newest open reply window:

    {cyan-fg}===COMMANDER:REPLY:{/cyan-fg}{white-fg}<session-key>{/white-fg}{cyan-fg}==={/cyan-fg}
    {white-fg}your response{/white-fg}
    {cyan-fg}===COMMANDER:END:{/cyan-fg}{white-fg}<session-key>{/white-fg}{cyan-fg}==={/cyan-fg}

    Commander claims the newest open window for this session
    and resolves its return session, thread and prior message.
    A claimed window is consumed; a failed delivery restores it
    only while both sessions remain active. No window means no route.

  {bold}3. BROADCAST{/bold} — send to all other connected agents:

    {cyan-fg}===COMMANDER:BROADCAST:{/cyan-fg}{white-fg}<session-key>{/white-fg}{cyan-fg}==={/cyan-fg}
    {white-fg}message for everyone{/white-fg}
    {cyan-fg}===COMMANDER:END:{/cyan-fg}{white-fg}<session-key>{/white-fg}{cyan-fg}==={/cyan-fg}

    Queued for other connected running agents, not file panels.
    Each target is checked independently; no agent is auto-launched.

  {bold}4. STATUS{/bold} — report progress (shown in UI and acknowledged in your panel):

    {cyan-fg}===COMMANDER:STATUS:{/cyan-fg}{white-fg}<session-key>{/white-fg}{cyan-fg}==={/cyan-fg}
    {white-fg}Processing file 5 of 10...{/white-fg}
    {cyan-fg}===COMMANDER:END:{/cyan-fg}{white-fg}<session-key>{/white-fg}{cyan-fg}==={/cyan-fg}

    Shows a toast notification in Commander and returns a local ACK.

  {bold}5. QUERY{/bold} — ask Commander for environment info:

    {cyan-fg}===COMMANDER:QUERY:{/cyan-fg}{white-fg}<session-key>{/white-fg}{cyan-fg}==={/cyan-fg}
    {white-fg}agents{/white-fg}
    {cyan-fg}===COMMANDER:END:{/cyan-fg}{white-fg}<session-key>{/white-fg}{cyan-fg}==={/cyan-fg}

    Queries: {cyan-fg}agents{/cyan-fg} (list running agents),
    {cyan-fg}panels{/cyan-fg} (panel layout info),
    {cyan-fg}status{/cyan-fg} (your status),
    {cyan-fg}help{/cyan-fg} (protocol command list),
    {cyan-fg}ping{/cyan-fg} (test responsiveness).


{bold}{yellow-fg}ACKNOWLEDGMENTS{/yellow-fg}{/bold}

  SEND/REPLY report the routed message's delivery result:
    {green-fg}[Commander ACK] status=delivered msg=msg_000001 thread=thr_000001 target="Codex CLI" panel=2{/green-fg}

  Or, if that delivery fails:
    {red-fg}[Commander ACK] status=failed msg=msg_000001 thread=thr_000001 target="Codex CLI" panel=2 error="reason"{/red-fg}

  Delivered means PTY input submitted, not task completed.
  It does not prove the model accepted or acted on the task.

  BROADCAST sends one combined queue-admission ACK, not
  per-target delivery ACKs. Check each delivery in F12 Activity:
    {green-fg}[Commander ACK] kind=broadcast queued=1 targets=Codex CLI in Panel 2{/green-fg}
  Capacity rejection adds status=partial or status=failed,
  rejected counts, rejectedTargets and an error.

  STATUS accepts a progress update, not a completed task:
    {green-fg}[Commander ACK] kind=status status=accepted text="Processing file 5 of 10..."{/green-fg}

  QUERY returns environment text, such as [Commander] PONG.
  Rejected, unarmed or orphaned frames may have no ACK.
  Feedback may be shortened for a CLI's input UI.
  Use REPLY to report work results; do not infer completion from ACKs.


{bold}{yellow-fg}ACTIVITY AND LOGGING{/yellow-fg}{/bold}

  F12 shows the latest 100 routed-message summaries.
  The in-memory ledger defaults to 1,000 records / 8 MiB,
  with 256 KiB per-record content; older history is evicted.
  STATUS and QUERY are live-only, not ledger history.
  Ctrl+L (from a file panel) opens a rotating diagnostic log,
  not a complete conversation archive.
  Durable capture and dataset export are proposed, not implemented.
  See docs/session-capture-plan.md in the source repository.


{bold}{yellow-fg}SUPPORTED SEND TARGETS{/yellow-fg}{/bold}

  Use these names in the SEND marker:

  {cyan-fg}claude{/cyan-fg}      Claude Code  (Anthropic)
  {cyan-fg}codex{/cyan-fg}       Codex CLI    (OpenAI)
  {cyan-fg}gemini{/cyan-fg}      Gemini CLI   (Google)
  {cyan-fg}opencode{/cyan-fg}    OpenCode     (multi-provider)
  {cyan-fg}generic{/cyan-fg}     Generic      (any CLI tool)

  Aider, Cline, Goose, Kiro, and Amp are
  catalogued future presets, not valid SEND targets yet.

  Use the stable panel number shown in Commander.


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
     SEND frontend to Gemini in Panel 3. Ask each to REPLY
     with results; QUERY agents only checks who's running."


{bold}{yellow-fg}KEYBOARD SHORTCUTS{/yellow-fg}{/bold}

  {cyan-fg}F2{/cyan-fg}          Launch agent in a panel
  {cyan-fg}Ctrl+O{/cyan-fg}      Orchestrate (send task to agent)
  {cyan-fg}Ctrl+P{/cyan-fg}      Inject protocol into active agent
  {cyan-fg}F12{/cyan-fg}         Routed-message activity
  {cyan-fg}Shift+F12{/cyan-fg}   This guide
  {cyan-fg}Ctrl+K{/cyan-fg}      Kill running session on active panel
  {cyan-fg}Ctrl+T{/cyan-fg}      Toggle panel: file <-> terminal
  {cyan-fg}Ctrl+E{/cyan-fg}      Reset to 2-panel view (from a file panel)
  {cyan-fg}Tab{/cyan-fg}         Switch between panels


{bold}{yellow-fg}TIPS{/yellow-fg}{/bold}

  - Press Ctrl+P on each agent after launch. You only
    need to inject once per agent per session.
  - Use REPLY for the newest open reply window. Use SEND
    for an explicit target when no suitable window is open.
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
  enterDialog(screen);

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
    label: ' Inter-Agent Communication Guide (Shift+F12) ',
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
    content: ' Esc/Enter/q/Shift+F12/Ctrl+G = Close    PgUp/PgDn = Scroll ',
    style: { bg: theme.dialog.bg, fg: 'cyan' },
  });

  dialog.key(['up'], () => { dialog.scroll(-1); screen.render(); });
  dialog.key(['down'], () => { dialog.scroll(1); screen.render(); });
  dialog.key(['pageup'], () => { dialog.scroll(-((dialog.height as number) - 4)); screen.render(); });
  dialog.key(['pagedown'], () => { dialog.scroll((dialog.height as number) - 4); screen.render(); });

  let closed = false;
  let unregisterCancellation = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    guideOpen = false;
    unregisterCancellation();
    leaveDialog(screen);
    screen.removeListener('keypress', onScreenKey);
    dialog.destroy();
    screen.render();
  };
  unregisterCancellation = registerDialogCancellation(screen, close);

  // Close on dialog-level keys
  dialog.key(['escape', 'enter', 'q', 'S-f12', 'C-g'], close);

  // Also listen on screen level as fallback (some blessed scrollable
  // boxes don't reliably route key events to dialog.key handlers)
  const onScreenKey = (_ch: any, key: any) => {
    if (!key) return;
    const name = key.full || key.name;
    if (name === 'escape' || name === 'enter' || name === 'q') {
      close();
    } else if (
      name === 'C-g' ||
      name === 'S-f12' ||
      (key.name === 'f12' && key.shift)
    ) {
      queueMicrotask(close);
    }
  };
  screen.on('keypress', onScreenKey);

  dialog.focus();
  screen.render();
}
