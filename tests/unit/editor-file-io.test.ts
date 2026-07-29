import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EditorFileError,
  EditorFileIO,
  MAX_EDITOR_FILE_BYTES,
} from '../../src/editor/editor-file-io.js';

const execFileAsync = promisify(execFile);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function expectEditorError(
  operation: Promise<unknown>,
  code: EditorFileError['code'],
): Promise<EditorFileError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(EditorFileError);
    expect((error as EditorFileError).code).toBe(code);
    return error as EditorFileError;
  }
  throw new Error(`Expected EditorFileError(${code})`);
}

describe('EditorFileIO', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-editor-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('loads a regular UTF-8 file as a Buffer-backed snapshot', async () => {
    const filePath = path.join(tempDir, 'note.md');
    const bytes = Buffer.from('\uFEFF# Title\r\nBody\r\n', 'utf8');
    await fs.writeFile(filePath, bytes);
    await fs.chmod(filePath, 0o640);

    const loaded = await new EditorFileIO().load(filePath);

    expect(loaded.content).toBe('# Title\nBody\n');
    expect(loaded.baseline).toEqual({
      contentHash: sha256(bytes),
      mode: 0o640,
      device: expect.any(Number),
      inode: expect.any(Number),
      userId: expect.any(Number),
      groupId: expect.any(Number),
      hasBom: true,
      lineEnding: '\r\n',
      hadFinalNewline: true,
    });
  });

  it('rejects symlinks and non-regular files', async () => {
    const targetPath = path.join(tempDir, 'target.md');
    const linkPath = path.join(tempDir, 'link.md');
    await fs.writeFile(targetPath, 'safe');
    await fs.symlink(targetPath, linkPath);

    const fileIO = new EditorFileIO();
    await expectEditorError(fileIO.load(linkPath), 'symlink');
    await expectEditorError(fileIO.load(tempDir), 'not-regular');
  });

  it('rejects oversized, NUL-containing, and invalid UTF-8 files', async () => {
    const fileIO = new EditorFileIO();
    const oversized = path.join(tempDir, 'oversized.md');
    const binary = path.join(tempDir, 'binary.md');
    const invalid = path.join(tempDir, 'invalid.md');
    await fs.writeFile(oversized, Buffer.alloc(MAX_EDITOR_FILE_BYTES + 1, 0x61));
    await fs.writeFile(binary, Buffer.from([0x61, 0x00, 0x62]));
    await fs.writeFile(invalid, Buffer.from([0xc3, 0x28]));

    await expectEditorError(fileIO.load(oversized), 'too-large');
    await expectEditorError(fileIO.load(binary), 'binary');
    await expectEditorError(fileIO.load(invalid), 'invalid-utf8');
  });

  it('accepts empty files and text exactly at the size limit', async () => {
    const empty = path.join(tempDir, 'empty.md');
    const boundary = path.join(tempDir, 'boundary.md');
    await fs.writeFile(empty, '');
    await fs.writeFile(boundary, Buffer.alloc(MAX_EDITOR_FILE_BYTES, 0x61));
    const fileIO = new EditorFileIO();

    expect((await fileIO.load(empty)).content).toBe('');
    expect((await fileIO.load(boundary)).content).toHaveLength(MAX_EDITOR_FILE_BYTES);
  });

  it('atomically saves while preserving BOM, line ending, final newline, and mode', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, Buffer.from('\uFEFFold\r\ntext\r\n', 'utf8'));
    await fs.chmod(filePath, 0o640);
    const fileIO = new EditorFileIO();
    const loaded = await fileIO.load(filePath);

    const nextBaseline = await fileIO.save(filePath, 'new\ntext\n', loaded.baseline);
    const saved = await fs.readFile(filePath);

    expect(saved).toEqual(Buffer.from('\uFEFFnew\r\ntext\r\n', 'utf8'));
    const savedStat = await fs.stat(filePath);
    expect(savedStat.mode & 0o7777).toBe(0o640);
    expect(nextBaseline.device).toBe(savedStat.dev);
    expect(nextBaseline.inode).toBe(savedStat.ino);
    expect(nextBaseline.contentHash).toBe(sha256(saved));
    expect(nextBaseline.hadFinalNewline).toBe(true);
    expect((await fs.readdir(tempDir)).filter((name) => name.includes('.tmp'))).toEqual([]);

    const finalBaseline = await fileIO.save(filePath, 'third\nversion\n', nextBaseline);
    const finalBytes = await fs.readFile(filePath);
    expect(finalBytes).toEqual(Buffer.from('\uFEFFthird\r\nversion\r\n', 'utf8'));
    expect(finalBaseline.contentHash).toBe(sha256(finalBytes));
  });

  it('preserves the absence of a final newline', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, 'old');
    const fileIO = new EditorFileIO();
    const loaded = await fileIO.load(filePath);

    const nextBaseline = await fileIO.save(filePath, 'new', loaded.baseline);

    expect(await fs.readFile(filePath, 'utf8')).toBe('new');
    expect(nextBaseline.hadFinalNewline).toBe(false);
  });

  it('rejects external content changes and removes only its owned temp file', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, 'baseline\n');
    const loaded = await new EditorFileIO().load(filePath);

    const collisionName = `.${path.basename(filePath)}.agents-commander-${process.pid}-collision.tmp`;
    const collisionPath = path.join(tempDir, collisionName);
    await fs.writeFile(collisionPath, 'do not remove');
    await fs.writeFile(filePath, 'external\n');

    const nonces = ['collision', 'owned'];
    const fileIO = new EditorFileIO({
      makeNonce: () => nonces.shift() ?? 'unexpected',
    });

    await expectEditorError(fileIO.save(filePath, 'editor\n', loaded.baseline), 'changed');

    expect(await fs.readFile(filePath, 'utf8')).toBe('external\n');
    expect(await fs.readFile(collisionPath, 'utf8')).toBe('do not remove');
    expect(await fs.readdir(tempDir)).toEqual([collisionName, 'note.md']);
  });

  it('rejects disappearance and cleans its owned temporary file', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, 'baseline');
    const fileIO = new EditorFileIO({ makeNonce: () => 'owned' });
    const loaded = await fileIO.load(filePath);
    await fs.unlink(filePath);

    await expectEditorError(fileIO.save(filePath, 'editor', loaded.baseline), 'changed');

    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('treats an external mode change as a save conflict', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, 'baseline');
    await fs.chmod(filePath, 0o600);
    const fileIO = new EditorFileIO();
    const loaded = await fileIO.load(filePath);
    await fs.chmod(filePath, 0o644);

    await expectEditorError(fileIO.save(filePath, 'editor', loaded.baseline), 'changed');

    expect(await fs.readFile(filePath, 'utf8')).toBe('baseline');
    expect((await fs.stat(filePath)).mode & 0o7777).toBe(0o644);
  });

  it('detects an atomic external replacement even when content and mode match', async () => {
    const filePath = path.join(tempDir, 'note.md');
    const replacementPath = path.join(tempDir, 'replacement.md');
    await fs.writeFile(filePath, 'baseline');
    await fs.chmod(filePath, 0o640);
    const fileIO = new EditorFileIO();
    const loaded = await fileIO.load(filePath);

    await fs.writeFile(replacementPath, 'baseline');
    await fs.chmod(replacementPath, 0o640);
    await fs.rename(replacementPath, filePath);

    await expectEditorError(fileIO.save(filePath, 'editor', loaded.baseline), 'changed');
    expect(await fs.readFile(filePath, 'utf8')).toBe('baseline');
  });

  it('serializes saves across EditorFileIO instances so a stale writer cannot win', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, 'baseline');
    const firstIO = new EditorFileIO();
    const secondIO = new EditorFileIO();
    const loaded = await firstIO.load(filePath);

    const results = await Promise.allSettled([
      firstIO.save(filePath, 'first', loaded.baseline),
      secondIO.save(filePath, 'second', loaded.baseline),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: 'changed' });
    expect(['first', 'second']).toContain(await fs.readFile(filePath, 'utf8'));
  });

  it('honors a lock held by another process and never removes its entry', async () => {
    const filePath = path.join(tempDir, 'note.md');
    const lockPath = path.join(tempDir, '.note.md.agents-commander.lock');
    await fs.writeFile(filePath, 'baseline');
    const loaded = await new EditorFileIO().load(filePath);
    const child = spawn(process.execPath, [
      '-e',
      `
        const fs = require('node:fs');
        const lockPath = process.argv[1];
        const fd = fs.openSync(lockPath, 'wx', 0o600);
        fs.writeSync(fd, 'child-owned-lock');
        process.stdout.write('ready\\n');
        setTimeout(() => {
          fs.unlinkSync(lockPath);
          fs.closeSync(fd);
        }, 200);
      `,
      lockPath,
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = once(child, 'exit');
    await once(child.stdout!, 'data');
    const fileIO = new EditorFileIO({ lockTimeoutMs: 30, lockRetryMs: 5 });

    await expectEditorError(fileIO.save(filePath, 'editor', loaded.baseline), 'changed');
    expect(await fs.readFile(lockPath, 'utf8')).toBe('child-owned-lock');

    await exited;
    await fileIO.save(filePath, 'editor', loaded.baseline);
    expect(await fs.readFile(filePath, 'utf8')).toBe('editor');
  });

  it('leaves an unrecognized stale-looking lock untouched', async () => {
    const filePath = path.join(tempDir, 'note.md');
    const lockPath = path.join(tempDir, '.note.md.agents-commander.lock');
    await fs.writeFile(filePath, 'baseline');
    await fs.writeFile(lockPath, '{"pid":999999,"createdAt":1,"foreign":true}');
    const loaded = await new EditorFileIO().load(filePath);
    const fileIO = new EditorFileIO({ lockTimeoutMs: 0 });

    await expectEditorError(fileIO.save(filePath, 'editor', loaded.baseline), 'changed');

    expect(await fs.readFile(lockPath, 'utf8')).toBe(
      '{"pid":999999,"createdAt":1,"foreign":true}',
    );
    expect(await fs.readFile(filePath, 'utf8')).toBe('baseline');
  });

  it('reclaims only a recognizable expired lock from a dead local process', async () => {
    const filePath = path.join(tempDir, 'note.md');
    const lockPath = path.join(tempDir, '.note.md.agents-commander.lock');
    await fs.writeFile(filePath, 'baseline');
    await fs.writeFile(lockPath, JSON.stringify({
      version: 1,
      pid: 2_147_483_647,
      hostname: os.hostname(),
      createdAt: Date.now() - 2000,
      token: '1234567890abcdef12345678',
    }), { mode: 0o600 });
    const loaded = await new EditorFileIO().load(filePath);
    const fileIO = new EditorFileIO({
      lockTimeoutMs: 50,
      lockRetryMs: 5,
      staleLockMs: 1000,
    });

    await fileIO.save(filePath, 'editor', loaded.baseline);

    expect(await fs.readFile(filePath, 'utf8')).toBe('editor');
    await expect(fs.lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not remove a foreign replacement of its save lock during cleanup', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, 'baseline');
    const loaded = await new EditorFileIO().load(filePath);
    let replacedLockPath = '';
    const fileIO = new EditorFileIO({
      beforeCommit: async (_tempPath, lockPath) => {
        replacedLockPath = lockPath;
        await fs.unlink(lockPath);
        await fs.writeFile(lockPath, 'foreign lock');
      },
    });

    await expectEditorError(fileIO.save(filePath, 'editor', loaded.baseline), 'changed');

    expect(await fs.readFile(filePath, 'utf8')).toBe('baseline');
    expect(await fs.readFile(replacedLockPath, 'utf8')).toBe('foreign lock');
  });

  it('rejects an atomic target replacement made immediately before commit', async () => {
    const filePath = path.join(tempDir, 'note.md');
    const replacementPath = path.join(tempDir, 'replacement.md');
    await fs.writeFile(filePath, 'baseline');
    await fs.writeFile(replacementPath, 'external replacement');
    const loaded = await new EditorFileIO().load(filePath);
    const fileIO = new EditorFileIO({
      beforeCommit: async () => {
        await fs.rename(replacementPath, filePath);
      },
    });

    await expectEditorError(fileIO.save(filePath, 'editor', loaded.baseline), 'changed');

    expect(await fs.readFile(filePath, 'utf8')).toBe('external replacement');
    await expect(fs.lstat(replacementPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to commit or remove a foreign replacement of its temporary path', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, 'baseline');
    const loaded = await new EditorFileIO().load(filePath);
    let replacedTempPath = '';
    const fileIO = new EditorFileIO({
      makeNonce: () => 'owned',
      beforeCommit: async (tempPath) => {
        replacedTempPath = tempPath;
        await fs.unlink(tempPath);
        await fs.writeFile(tempPath, 'foreign');
      },
    });

    await expectEditorError(fileIO.save(filePath, 'editor', loaded.baseline), 'changed');

    expect(await fs.readFile(filePath, 'utf8')).toBe('baseline');
    expect(await fs.readFile(replacedTempPath, 'utf8')).toBe('foreign');
  });

  it('never follows a replacement symlink while copying metadata', async () => {
    const filePath = path.join(tempDir, 'note.md');
    const victimPath = path.join(tempDir, 'victim.md');
    await fs.writeFile(filePath, 'baseline');
    await fs.writeFile(victimPath, 'do not overwrite');
    const loaded = await new EditorFileIO().load(filePath);
    let replacedTempPath = '';
    const fileIO = new EditorFileIO({
      makeNonce: () => 'owned',
      beforeMetadataCopy: async (tempPath) => {
        replacedTempPath = tempPath;
        await fs.unlink(tempPath);
        await fs.symlink(victimPath, tempPath);
      },
    });

    await expectEditorError(fileIO.save(filePath, 'editor', loaded.baseline), 'changed');

    expect(await fs.readFile(filePath, 'utf8')).toBe('baseline');
    expect(await fs.readFile(victimPath, 'utf8')).toBe('do not overwrite');
    expect((await fs.lstat(replacedTempPath)).isSymbolicLink()).toBe(true);
  });

  it('cancels the save when metadata cannot be copied safely', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, 'baseline');
    const loaded = await new EditorFileIO().load(filePath);
    const fileIO = new EditorFileIO({
      makeNonce: () => 'owned',
      copyMetadata: async () => {
        throw new Error('metadata tool failed');
      },
    });

    await expectEditorError(fileIO.save(filePath, 'editor', loaded.baseline), 'metadata');

    expect(await fs.readFile(filePath, 'utf8')).toBe('baseline');
    expect(await fs.readdir(tempDir)).toEqual(['note.md']);
  });

  it.skipIf(process.platform !== 'darwin')(
    'preserves macOS extended attributes during atomic replacement',
    async () => {
      const filePath = path.join(tempDir, 'note.md');
      const attribute = 'com.agents-commander.editor-test';
      await fs.writeFile(filePath, 'baseline');
      await execFileAsync('/usr/bin/xattr', ['-w', attribute, 'conference', filePath]);
      const fileIO = new EditorFileIO();
      const loaded = await fileIO.load(filePath);

      await fileIO.save(filePath, 'edited', loaded.baseline);

      const { stdout } = await execFileAsync('/usr/bin/xattr', ['-p', attribute, filePath]);
      expect(stdout.trim()).toBe('conference');
    },
  );

  it.skipIf(process.platform !== 'darwin')(
    'preserves macOS access-control entries during atomic replacement',
    async () => {
      const filePath = path.join(tempDir, 'note.md');
      await fs.writeFile(filePath, 'baseline');
      await execFileAsync('/bin/chmod', ['+a', 'everyone allow read', filePath]);
      const fileIO = new EditorFileIO();
      const loaded = await fileIO.load(filePath);

      await fileIO.save(filePath, 'edited', loaded.baseline);

      const { stdout } = await execFileAsync('/bin/ls', ['-le', filePath]);
      expect(stdout).toContain('group:everyone allow read');
    },
  );

  it('rejects oversized edited content before creating a temporary file', async () => {
    const filePath = path.join(tempDir, 'note.md');
    await fs.writeFile(filePath, 'baseline');
    const fileIO = new EditorFileIO();
    const loaded = await fileIO.load(filePath);

    await expectEditorError(
      fileIO.save(filePath, 'a'.repeat(MAX_EDITOR_FILE_BYTES + 1), loaded.baseline),
      'too-large',
    );

    expect(await fs.readFile(filePath, 'utf8')).toBe('baseline');
    expect(await fs.readdir(tempDir)).toEqual(['note.md']);
  });
});
