import { describe, expect, it, vi } from 'vitest';
import { ProtocolScanner } from '../../src/orchestration/protocol.js';
import {
  OpenCodeRegionDetector,
  projectOpenCodeRows,
  type OpenCodeRegionCell,
  type OpenCodeRegionRow,
} from '../../src/panels/opencode-region.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const capability = 'a'.repeat(43); // Public synthetic fixture, never a captured capability.
const header = `===COMMANDER:REPLY:${capability}:1===`;
const footer = `===COMMANDER:END:${capability}:1===`;
const columns = 211;
const sidebarStart = columns - 42;
type Row = { cells: OpenCodeRegionCell[]; wrapsToNext: boolean; startsAfterCursorMove?: boolean };

function grid(width = columns, height = 24): Row[] {
  return Array.from({ length: height }, () => ({
    cells: Array.from({ length: width }, () => ({ char: ' ', bg: 0 })),
    wrapsToNext: false,
  }));
}

function put(rows: Row[], y: number, x: number, text: string) {
  for (const char of text) {
    rows[y].cells[x] = { ...rows[y].cells[x], char };
    x++;
  }
}

function sidebarGrid(width = columns) {
  const rows = grid(width);
  const start = width - 42;
  for (const row of rows) {
    for (let x = start; x < width; x++) row.cells[x] = { char: ' ', bg: 16 };
  }
  put(rows, 1, start + 2, 'Commander protocol setup');
  put(rows, 4, start + 2, 'Context');
  put(rows, 5, start + 2, '9,646 tokens');
  put(rows, 9, start + 2, 'LSP');
  put(rows, 10, start + 2, 'LSPs are disabled');
  put(rows, rows.length - 2, start + 2, '• OpenCode 1.18.30');
  return rows;
}

function addFrame(rows: Row[], body = 'Hello Panel 1!', y = 10) {
  put(rows, y, 2, header);
  put(rows, y + 1, 2, body);
  put(rows, y + 2, 2, footer);
}

function scan(rows: readonly OpenCodeRegionRow[], width = columns) {
  const detector = new OpenCodeRegionDetector();
  const region = detector.detect(rows, width);
  const projected = projectOpenCodeRows(rows, region);
  const received = vi.fn();
  const scanner = new ProtocolScanner(1, 'OpenCode', received);
  scanner.setProtocolCapability(capability);
  for (const row of projected ?? []) scanner.feed(`${row.text}\n`);
  return { region, projected, received };
}

describe('OpenCode protocol conversation region', () => {
  it('detects the sidebar when LSP text occupies the REPLY header row', () => {
    const rows = sidebarGrid();
    addFrame(rows);
    const result = scan(rows);
    expect(result.region).toEqual({ kind: 'sidebar', endColumn: sidebarStart });
    expect(result.received).toHaveBeenCalledOnce();
    expect(result.received.mock.calls[0][0].content).toBe('Hello Panel 1!');
  });

  it('excludes sidebar title, context and footer from the exact routed body', () => {
    const rows = sidebarGrid();
    addFrame(rows, 'hello !', 0);
    const result = scan(rows);
    expect(result.received).toHaveBeenCalledOnce();
    expect(result.received.mock.calls[0][0].content).toBe('hello !');
    expect(result.projected?.[1].text).toBe('  hello !');
  });

  it('projects END suffixes as well as headers and bodies', () => {
    const rows = sidebarGrid();
    addFrame(rows, 'done', 8);
    const result = scan(rows);
    expect(result.received).toHaveBeenCalledOnce();
    expect(result.projected?.[10].text).toBe(`  ${footer}`);
  });

  it('does not enable parsing of inline marker suffixes in the actual conversation', () => {
    const rows = sidebarGrid();
    addFrame(rows);
    put(rows, 10, 2 + header.length, ' not a marker');
    expect(scan(rows).received).not.toHaveBeenCalled();
  });

  it('leaves a full-width conversation intact after positive prompt-footer evidence', () => {
    const rows = grid();
    addFrame(rows, 'x'.repeat(190));
    put(rows, 22, columns - 'ctrl+p commands  '.length, 'ctrl+p commands');
    const result = scan(rows);
    expect(result.region).toEqual({ kind: 'full', endColumn: columns });
    expect(result.received.mock.calls[0][0].content).toBe('x'.repeat(190));
  });

  it('recognizes non-default short command-palette key bindings', () => {
    const rows = grid();
    put(rows, 22, columns - 'ctrl+shift+p commands  '.length, 'ctrl+shift+p commands');
    expect(new OpenCodeRegionDetector().detect(rows, columns).kind).toBe('full');
  });

  it('defers a wide frame painted before sidebar chrome instead of leaking body text', () => {
    const rows = sidebarGrid();
    addFrame(rows, 'hello !', 0);
    put(rows, 22, sidebarStart + 2, ' '.repeat(17));
    const result = scan(rows);
    expect(result.region.kind).toBe('ambiguous');
    expect(result.projected).toBeNull();
    expect(result.received).not.toHaveBeenCalled();
  });

  it('does not infer a sidebar from arbitrary text aligned 42 columns from the edge', () => {
    const rows = grid();
    addFrame(rows);
    put(rows, 22, sidebarStart + 2, '• OpenCode 1.18.30');
    expect(scan(rows).region.kind).toBe('ambiguous');
  });

  it('defers inconsistent sidebar backgrounds during incremental repaint', () => {
    const rows = sidebarGrid();
    rows[7].cells[columns - 4] = { char: ' ', bg: 0 };
    expect(scan(rows).region.kind).toBe('ambiguous');
  });

  it('defers a missing conversation/sidebar gutter rather than truncating body cells', () => {
    const rows = sidebarGrid();
    put(rows, 8, sidebarStart - 1, 'X');
    expect(scan(rows).region.kind).toBe('ambiguous');
  });

  it('defers contradictory full-width and sidebar footer evidence while toggling', () => {
    const rows = sidebarGrid();
    put(rows, 21, columns - 'ctrl+p commands  '.length, 'ctrl+p commands');
    expect(scan(rows).region.kind).toBe('ambiguous');
  });

  it('never crops narrow overlay sidebars into apparently complete messages', () => {
    const rows = sidebarGrid(110);
    expect(scan(rows, 110).region).toEqual({ kind: 'ambiguous', reason: 'sidebar-overlay' });
  });

  it('keeps a previously detected overlay blocked while its footer is being erased', () => {
    const detector = new OpenCodeRegionDetector();
    expect(detector.detect(sidebarGrid(110), 110).kind).toBe('ambiguous');
    expect(detector.detect(grid(110), 110)).toEqual({ kind: 'ambiguous', reason: 'sidebar-overlay' });
    const full = grid(110);
    put(full, 22, 110 - 'ctrl+p commands  '.length, 'ctrl+p commands');
    expect(detector.detect(full, 110)).toEqual({ kind: 'full', endColumn: 110 });
  });

  it('resets overlay state when the owner starts a new child session', () => {
    const detector = new OpenCodeRegionDetector();
    detector.detect(sidebarGrid(110), 110);
    detector.reset();
    expect(detector.detect(grid(110), 110)).toEqual({ kind: 'full', endColumn: 110 });
  });

  it('waits for fresh chrome after resizing rather than reading clipped old content', () => {
    const detector = new OpenCodeRegionDetector();
    const original = sidebarGrid();
    addFrame(original);
    expect(detector.detect(original, columns).kind).toBe('sidebar');
    const clipped = original.map((row) => ({ ...row, cells: row.cells.slice(0, 110) }));
    expect(detector.detect(clipped, 110).kind).toBe('ambiguous');
    const fresh = grid(110);
    put(fresh, 22, 110 - 'ctrl+p commands  '.length, 'ctrl+p commands');
    expect(detector.detect(fresh, 110).kind).toBe('full');
  });

  it('does not alter ordinary narrow output without an overlay', () => {
    const rows = grid(110);
    addFrame(rows);
    const result = scan(rows, 110);
    expect(result.region).toEqual({ kind: 'full', endColumn: 110 });
    expect(result.received).toHaveBeenCalledOnce();
  });

  it('uses physical columns, not JS string offsets, for wide and combined glyphs', () => {
    const rows = sidebarGrid();
    addFrame(rows);
    rows[11].cells[2] = { char: '界', bg: 0 };
    rows[11].cells[3] = { char: '', bg: 0 };
    rows[11].cells[4] = { char: 'e\u0301', bg: 0 };
    const result = scan(rows);
    expect(result.projected?.[11].text).toBe('  界e\u0301lo Panel 1!');
    expect(result.projected?.[11].text).not.toContain('Commander protocol');
  });

  it('preserves positioned-row provenance but not sidebar-edge DEC wrap', () => {
    const rows = sidebarGrid();
    rows[1].wrapsToNext = true;
    rows[1].startsAfterCursorMove = true;
    const result = scan(rows);
    expect(result.projected?.[1]).toEqual({ text: '', wrapsToNext: false, startsAfterCursorMove: true });
  });

  it('preserves full-width DEC wrap spaces for the shared logical-line scanner', () => {
    const rows = grid(80);
    put(rows, 0, 0, 'abc');
    rows[0].wrapsToNext = true;
    const result = scan(rows, 80);
    expect(result.projected?.[0]).toEqual({ text: 'abc' + ' '.repeat(77), wrapsToNext: true });
  });

  it.each([0, -1, 3.5, Number.NaN])('rejects invalid column count %s', (width) => {
    expect(new OpenCodeRegionDetector().detect(grid(), width).kind).toBe('ambiguous');
  });

  it('rejects partial cell rows and refuses unverified projection', () => {
    const rows = grid();
    rows[2].cells.pop();
    expect(scan(rows).projected).toBeNull();
    expect(projectOpenCodeRows(rows, { kind: 'full', endColumn: columns })).toBeNull();
    expect(projectOpenCodeRows(grid(), { kind: 'full', endColumn: -1 })).toBeNull();
  });
});
