import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HELP_TEXT } from '../../src/screen/dialog/help-dialog.js';

describe('Panel controls documentation', () => {
  it('explains panel-first controls and the fullscreen return key in Help', () => {
    expect(HELP_TEXT).toMatch(/F4\s+Fullscreen \/ Back/u);
    expect(HELP_TEXT).toMatch(/F6\s+Clone panel/u);
    expect(HELP_TEXT).toMatch(/F7\s+Panel order/u);
    expect(HELP_TEXT).toMatch(/F9\s+Close panel/u);
    expect(HELP_TEXT).toContain('F4 again restores the panel grid');
    expect(HELP_TEXT).toContain('does not clone conversations or running process state');
    expect(HELP_TEXT).toContain('protocol P IDs stay stable');
    expect(HELP_TEXT).toContain('F9 closes a panel, never a file');
  });

  it('keeps file preview and shifted file operations discoverable', () => {
    expect(HELP_TEXT).toMatch(/Enter\s+Open directory \/ view file/u);
    expect(HELP_TEXT).toMatch(/Shift\+F6\s+Copy selected files/u);
    expect(HELP_TEXT).toMatch(/Shift\+F7\s+Move \/ rename selected files/u);
    expect(HELP_TEXT).toMatch(/Shift\+F9\s+Delete selected files/u);
    expect(HELP_TEXT).toMatch(/Ctrl\+W\s+Close active panel \(same as F9/u);
    expect(HELP_TEXT).toMatch(/Shift\+F4\s+Cycle Auto/u);
  });

  it('keeps the README key table aligned with the live controls', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('| `F4` | Fullscreen active panel / restore grid');
    expect(readme).toContain('| `F6` | Clone panel at the same directory');
    expect(readme).toContain('| `F7` | Change panel workspace position; keep its protocol ID');
    expect(readme).toContain('| `F9` | Close panel; confirm before stopping a live session');
    expect(readme).toContain('| `Shift+F6` | Copy selected files');
    expect(readme).toContain('| `Shift+F7` | Move / rename selected files');
    expect(readme).toContain('| `Shift+F9` | Delete selected files');
  });
});
