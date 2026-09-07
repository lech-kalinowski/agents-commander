import blessed from 'blessed';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, openSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { EditorFileError, EditorFileIO } from '../../src/editor/editor-file-io.js';
import { getTheme } from '../../src/config/themes.js';
import { PreviewPanel } from '../../src/panels/preview-panel.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// A failed regression must release its blocked reader before returning. This
// keeps the old implementation reproducible without leaving a libuv worker hung.
async function settlesWithoutWriter(operation: Promise<unknown>, fifoPath: string) {
  let settled = false;
  const observed = operation.then(
    (value) => { settled = true; return value; },
    (error: unknown) => { settled = true; return error; },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      observed,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 500); }),
    ]);
    const withoutWriter = settled;
    if (!settled) {
      const writer = openSync(fifoPath, constants.O_WRONLY | constants.O_NONBLOCK);
      closeSync(writer);
    }
    return { withoutWriter, result: await observed };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe.skipIf(process.platform === 'win32')('nonblocking regular-file guards', () => {
  it('rejects a FIFO preview without waiting for another process to open a writer', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-preview-fifo-'));
    const fifo = path.join(root, 'named-pipe');
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
    output.resume();
    const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
    const panel = new PreviewPanel(screen, getTheme('commander'), {
      top: 0, left: 0, width: 80, height: 24,
    });
    try {
      execFileSync('mkfifo', [fifo]);
      const result = await settlesWithoutWriter(panel.loadFile(fifo), fifo);
      expect(result.withoutWriter).toBe(true);
      expect((await fs.lstat(fifo)).isFIFO()).toBe(true);
      expect((panel as any).content.getContent()).toContain('Only regular files');
    } finally {
      panel.close();
      screen.destroy();
      input.destroy();
      output.destroy();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('honors the editor save-lock deadline when the existing lock is a FIFO', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-editor-fifo-'));
    const file = path.join(root, 'note.md');
    const lock = path.join(root, '.note.md.agents-commander.lock');
    try {
      await fs.writeFile(file, 'original');
      const editor = new EditorFileIO({ lockTimeoutMs: 30, lockRetryMs: 5 });
      const loaded = await editor.load(file);
      execFileSync('mkfifo', [lock]);
      const result = await settlesWithoutWriter(editor.save(file, 'changed', loaded.baseline), lock);
      expect(result.withoutWriter).toBe(true);
      expect(result.result).toBeInstanceOf(EditorFileError);
      expect((result.result as EditorFileError).code).toBe('changed');
      expect(await fs.readFile(file, 'utf8')).toBe('original');
      expect((await fs.lstat(lock)).isFIFO()).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
