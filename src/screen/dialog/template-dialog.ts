import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import type { PromptTemplate } from '../../templates/types.js';
import { getTemplatesByCategory, refreshTemplates } from '../../templates/loader.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';
import { renderPanelBoxes } from './panel-picker.js';

export interface TemplateChoice {
  content: string;
  panelIndex: number;
  templateName: string;
}

type ListEntry =
  | { type: 'header'; label: string }
  | { type: 'template'; template: PromptTemplate };

let dialogOpen = false;

export function showTemplateDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  panelCount: number,
  activePanelIndex: number,
): Promise<TemplateChoice | null> {
  if (dialogOpen) return Promise.resolve(null);
  dialogOpen = true;
  enterDialog();

  return new Promise((resolve) => {
    refreshTemplates();
    const grouped = getTemplatesByCategory();

    // Build flat list with category headers + templates
    const listMapping: ListEntry[] = [];
    const listItems: string[] = [];

    // Show collaboration category first, then others
    const categories = Array.from(grouped.keys()).sort((a, b) => {
      if (a === 'collaboration') return -1;
      if (b === 'collaboration') return 1;
      return a.localeCompare(b);
    });

    for (const cat of categories) {
      const templates = grouped.get(cat)!;
      const label = cat.charAt(0).toUpperCase() + cat.slice(1);
      listMapping.push({ type: 'header', label });
      listItems.push(`{yellow-fg}── ${label} ──{/yellow-fg}`);

      for (const t of templates) {
        listMapping.push({ type: 'template', template: t });
        const panelHint = t.panels > 1 ? `(${t.panels})` : '   ';
        listItems.push(`  ${t.name.padEnd(32)} ${panelHint}`);
      }
    }

    if (listMapping.length === 0) {
      dialogOpen = false;
      leaveDialog();
      resolve(null);
      return;
    }

    // ── Main dialog container ──
    const dialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 80,
      height: 28,
      border: { type: 'line' },
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        border: theme.dialog.border,
      },
      tags: true,
      label: ' Prompt Templates (Ctrl+B) ',
      shadow: true,
    });

    // ── Left: template list ──
    const templateList = blessed.list({
      parent: dialog,
      top: 1,
      left: 1,
      width: '45%',
      height: '100%-4',
      tags: true,
      keys: false,
      mouse: true,
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        selected: { bg: 'cyan', fg: 'black' },
      },
      items: listItems as any,
    });

    // ── Right: preview pane ──
    const preview = blessed.box({
      parent: dialog,
      top: 1,
      right: 1,
      width: '50%',
      height: '100%-4',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: 'cyan' } },
      mouse: true,
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        border: { fg: 'cyan' },
      },
      border: { type: 'line' },
      label: ' Preview ',
      content: '',
    });

    // ── Panel picker (hidden initially, used in step 2) ──
    const panelBox = blessed.box({
      parent: dialog,
      top: 3,
      left: 2,
      width: '100%-6',
      height: 10,
      tags: true,
      hidden: true,
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    // ── Step indicator ──
    const stepBox = blessed.text({
      parent: dialog,
      top: 1,
      left: 2,
      tags: true,
      hidden: true,
      content: '',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    // ── Footer ──
    const footer = blessed.text({
      parent: dialog,
      bottom: 0,
      left: 'center',
      content: ' Up/Down=Browse  PgUp/PgDn=Scroll Preview  Enter=Select  Esc=Close ',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    // ── State ──
    let selectedTemplate: PromptTemplate | null = null;
    let selectedPanel = activePanelIndex;
    let inStep2 = false;

    // Forward-declared so cleanup can remove it
    let onScreenKey: (ch: any, key: any) => void;

    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      dialogOpen = false;
      leaveDialog();
      if (onScreenKey) screen.removeListener('keypress', onScreenKey);
      dialog.destroy();
      screen.render();
    };

    // ── Preview update ──
    function updatePreview(index: number): void {
      const entry = listMapping[index];
      if (!entry || entry.type === 'header') {
        preview.setContent('');
        screen.render();
        return;
      }
      const t = entry.template;
      let text = `{bold}{cyan-fg}${t.name}{/cyan-fg}{/bold}\n`;
      text += `${t.description}\n\n`;
      text += `{bold}Agents:{/bold} ${t.agents.join(', ')}\n`;
      text += `{bold}Panels:{/bold} ${t.panels}\n`;
      text += `{bold}Source:{/bold} ${t.source}\n`;
      text += `\n{yellow-fg}─── Content ───{/yellow-fg}\n\n`;
      // Wrap template content in {escape}...{/escape} so blessed doesn't parse tags
      text += `{escape}${t.content}{/escape}`;
      preview.setContent(text);
      preview.setScrollPerc(0);
      screen.render();
    }

    // ── Navigation — skip headers ──
    function findNextTemplate(from: number, direction: 1 | -1): number {
      let idx = from + direction;
      while (idx >= 0 && idx < listMapping.length) {
        if (listMapping[idx].type === 'template') return idx;
        idx += direction;
      }
      return from; // stay put if no template found
    }

    // Start on first template (skip header)
    const firstTemplate = findNextTemplate(-1, 1);
    if (firstTemplate >= 0) {
      (templateList as any).select(firstTemplate);
      updatePreview(firstTemplate);
    }

    templateList.key(['up'], () => {
      const current = (templateList as any).selected ?? 0;
      const next = findNextTemplate(current, -1);
      if (next !== current) {
        (templateList as any).select(next);
        updatePreview(next);
      }
    });

    templateList.key(['down'], () => {
      const current = (templateList as any).selected ?? 0;
      const next = findNextTemplate(current, 1);
      if (next !== current) {
        (templateList as any).select(next);
        updatePreview(next);
      }
    });

    // Scroll preview with PageUp/PageDown while browsing the list
    templateList.key(['pageup'], () => {
      preview.scroll(-((preview.height as number) - 2));
      screen.render();
    });
    templateList.key(['pagedown'], () => {
      preview.scroll((preview.height as number) - 2);
      screen.render();
    });

    // Mouse select
    templateList.on('select item', (_item: any, index: number) => {
      if (listMapping[index]?.type === 'template') {
        updatePreview(index);
      }
    });

    // ── STEP 1: Enter on template ──
    const handleSelect = (index: number) => {
      if (inStep2) return;
      const entry = listMapping[index];
      if (!entry || entry.type === 'header') return;
      selectedTemplate = entry.template;
      showStep2();
    };

    // Enter key
    templateList.key(['enter'], () => {
      handleSelect((templateList as any).selected ?? 0);
    });

    // Mouse double-click (blessed 'select' event)
    templateList.on('select', (_item: any, index: number) => {
      handleSelect(index);
    });

    templateList.key(['escape'], () => { cleanup(); resolve(null); });

    // Screen-level Esc fallback: blessed list/box widgets don't
    // always route key events to their own .key() handlers.
    onScreenKey = (_ch: any, key: any) => {
      if (!key) return;
      const name = key.full || key.name;
      if (name === 'escape') {
        if (inStep2) {
          inStep2 = false;
          panelBox.hide();
          stepBox.hide();
          templateList.show();
          preview.show();
          footer.setContent(' Up/Down=Browse  PgUp/PgDn=Scroll Preview  Enter=Select  Esc=Close ');
          templateList.focus();
          screen.render();
        } else {
          cleanup();
          resolve(null);
        }
      }
    };
    screen.on('keypress', onScreenKey);

    // ── STEP 2: Panel selection ──
    // Register panelBox handlers ONCE (not inside showStep2) to avoid stacking
    function renderPanelPicker(): void {
      const header = '  Select target panel:\n\n';
      panelBox.setContent(header + renderPanelBoxes(selectedPanel, panelCount));
    }

    panelBox.on('keypress', (ch: string | undefined, _key: any) => {
      if (!inStep2 || !ch) return;
      const n = parseInt(ch, 10);
      if (n >= 1 && n <= 4) {
        selectedPanel = n - 1;
        renderPanelPicker();
        screen.render();
      }
    });

    panelBox.key(['enter'], () => {
      if (!inStep2) return;
      cleanup();
      resolve({
        content: selectedTemplate!.content,
        panelIndex: selectedPanel,
        templateName: selectedTemplate!.name,
      });
    });

    panelBox.key(['escape'], () => {
      if (!inStep2) return;
      // Go back to step 1
      inStep2 = false;
      panelBox.hide();
      stepBox.hide();
      templateList.show();
      preview.show();
      footer.setContent(' Up/Down=Browse  PgUp/PgDn=Scroll Preview  Enter=Select  Esc=Close ');
      templateList.focus();
      screen.render();
    });

    function showStep2() {
      inStep2 = true;
      templateList.hide();
      preview.hide();

      stepBox.setContent(
        `{bold}Select panel for:{/bold} {cyan-fg}${selectedTemplate!.name}{/cyan-fg}`,
      );
      stepBox.show();
      renderPanelPicker();
      panelBox.show();
      footer.setContent(' 1-4=Panel  Enter=Confirm  Esc=Back ');
      panelBox.focus();
      screen.render();
    }

    templateList.focus();
    screen.render();
  });
}
