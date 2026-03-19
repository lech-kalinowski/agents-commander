/**
 * Shared panel picker rendering — provides a visually prominent
 * panel selection UI used across agent, template, and orchestrate dialogs.
 *
 * Renders horizontal panel boxes with double-line borders:
 *   ╔═════════╗  ┌─────────┐  ┌─────────┐  ┌─────────┐
 *   ║  > 1 <  ║  │    2    │  │    3    │  │    4    │
 *   ╚═════════╝  └─────────┘  └─────────┘  └─────────┘
 *     Panel 1      Panel 2      Panel 3      Panel 4
 *
 * Selected panel gets double-line cyan border with highlighted number.
 */

export function renderPanelBoxes(
  selected: number,
  panelCount: number,
  maxPanels = 4,
): string {
  const boxes: string[][] = [];

  for (let i = 0; i < maxPanels; i++) {
    const isSel = i === selected;
    const isNew = i >= panelCount;
    const num = String(i + 1);

    if (isSel) {
      boxes.push([
        '{cyan-fg}{bold}╔═══════════╗{/bold}{/cyan-fg}',
        `{cyan-fg}{bold}║{/bold}{/cyan-fg} {black-fg}{cyan-bg}  > ${num} <  {/cyan-bg}{/black-fg} {cyan-fg}{bold}║{/bold}{/cyan-fg}`,
        '{cyan-fg}{bold}╚═══════════╝{/bold}{/cyan-fg}',
        `{cyan-fg}{bold}   Panel ${num}  {/bold}{/cyan-fg}`,
      ]);
    } else {
      const dim = isNew ? '{yellow-fg}' : '';
      const dimEnd = isNew ? '{/yellow-fg}' : '';
      const tag = isNew ? '(new)' : '     ';
      boxes.push([
        `${dim}┌───────────┐${dimEnd}`,
        `${dim}│     ${num}     │${dimEnd}`,
        `${dim}└───────────┘${dimEnd}`,
        `${dim}  Panel ${num} ${tag}${dimEnd}`,
      ]);
    }
  }

  // Join horizontally with spacing
  const lines: string[] = [];
  for (let row = 0; row < 4; row++) {
    lines.push('  ' + boxes.map((b) => b[row]).join(' '));
  }

  return lines.join('\n');
}
