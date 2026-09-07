import { createHash } from 'node:crypto';
import { chmod, link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createCaptureRecorder } from '../../src/capture/recorder.js';
import { readCaptureDirectory } from '../../src/capture/reader.js';
import { CaptureRedactor } from '../../src/capture/redactor.js';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'commander-capture-reader-')); roots.push(root);
  const recorder = await createCaptureRecorder({ mode: 'protocol', rootDirectory: root, projectId: 'project-1', synthetic: true });
  recorder.record({ type: 'session.start', actor: { sessionId: 'local_1', panel: 1, agentType: 'codex' } });
  await recorder.close();
  const directory = recorder.directory!;
  const manifestFile = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const segmentFile = path.join(directory, manifest.segments[0].file);
  return { root, directory, manifest, manifestFile, segmentFile };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('strict capture reader', () => {
  it('rejects changed data and does not relax integrity for incomplete inspection', async () => {
    const { directory, segmentFile } = await fixture();
    await writeFile(segmentFile, 'tampered\n', { mode: 0o600 });
    for (const requireComplete of [true, false]) await expect(readCaptureDirectory(directory, { requireComplete })).rejects.toThrow('checksum');
  });

  it.each(['sequence', 'namespace', 'extra_field', 'partial', 'invalid_utf8'])('rejects %s even with recomputed checksums', async (mutation) => {
    const { directory, manifest, manifestFile, segmentFile } = await fixture();
    const event = JSON.parse(await readFile(segmentFile, 'utf8'));
    if (mutation === 'sequence') event.sequence = 999;
    if (mutation === 'namespace') event.actor.sessionId = `${manifest.captureId}:session_secret`;
    if (mutation === 'extra_field') event.credentials = 'not-allowed';
    const content = mutation === 'invalid_utf8' ? Buffer.from([255, 10]) : Buffer.from(JSON.stringify(event) + (mutation === 'partial' ? '' : '\n'));
    await writeFile(segmentFile, content, { mode: 0o600 });
    manifest.segments[0].bytes = content.length;
    manifest.counts.bytes = content.length;
    manifest.segments[0].sha256 = createHash('sha256').update(content).digest('hex');
    await writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
    await expect(readCaptureDirectory(directory)).rejects.toThrow();
  });

  it.each(['version', 'budget', 'filename', 'counts', 'status'])('rejects invalid manifest %s', async (mutation) => {
    const { directory, manifest, manifestFile } = await fixture();
    if (mutation === 'version') manifest.schemaVersion = 2;
    if (mutation === 'budget') manifest.limits.runBytes = Number.MAX_SAFE_INTEGER;
    if (mutation === 'filename') manifest.segments[0].file = '../secret.json';
    if (mutation === 'counts') manifest.counts.events = 200_000;
    if (mutation === 'status') manifest.status = 'recording';
    await writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
    await expect(readCaptureDirectory(directory)).rejects.toThrow();
  });

  it('rejects unexpected files, including symlink payloads', async () => {
    const { directory } = await fixture();
    await symlink('/etc/passwd', path.join(directory, 'unexpected'));
    await expect(readCaptureDirectory(directory)).rejects.toThrow('unexpected');
  });

  it('rejects private segment symlinks and hard links', async () => {
    for (const hard of [false, true]) {
      const { root, directory, segmentFile } = await fixture();
      const external = path.join(root, 'external');
      await writeFile(external, await readFile(segmentFile), { mode: 0o600 });
      await rm(segmentFile);
      if (hard) await link(external, segmentFile); else await symlink(external, segmentFile);
      await expect(readCaptureDirectory(directory)).rejects.toThrow();
    }
  });

  it('rejects symlink ancestors for both recording and reading', async () => {
    const { root, directory } = await fixture();
    const alias = path.join(root, 'alias'); await symlink(directory, alias);
    await expect(readCaptureDirectory(alias)).rejects.toThrow('symlink');
    await expect(createCaptureRecorder({ mode: 'protocol', rootDirectory: alias, projectId: 'safe' })).rejects.toThrow('symlink');
  });

  it('rejects non-private manifests', async () => {
    const { directory, manifestFile } = await fixture();
    await chmod(manifestFile, 0o644);
    await expect(readCaptureDirectory(directory)).rejects.toThrow('private permissions');
  });

  it('enforces caller budgets inside the validated read, not a separate preflight', async () => {
    const { directory, manifest, manifestFile } = await fixture();
    await expect(readCaptureDirectory(directory, { maxBytes: 1 })).rejects.toThrow('budget');
    await expect(readCaptureDirectory(directory, { maxEvents: 0 })).rejects.toThrow('budget');
    await expect(readCaptureDirectory(directory, { maxBytes: Number.MAX_SAFE_INTEGER })).rejects.toThrow('budget');
    manifest.counts.bytes = 0;
    await writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
    await expect(readCaptureDirectory(directory, { maxBytes: 1 })).rejects.toThrow('totals');
  });
});

describe('bounded literal capture redactor', () => {
  it('handles embedded unknown capabilities and truncated private keys', () => {
    const redactor = new CaptureRedactor();
    const key = 'z'.repeat(43);
    const text = `prefix ===COMMANDER:QUERY:${key}===\nagents\n===COMMANDER:END:${key}===\n-----BEGIN RSA PRIVATE KEY-----\nunclosed-sensitive-data`;
    const result = redactor.redact(text);
    expect(result.content).not.toContain(key);
    expect(result.content).not.toContain('unclosed-sensitive-data');
    expect(result.redactions).toMatchObject({ marker_capability: 2, private_key: 1 });
  });

  it('bounds adversarial marker/private-key matching without user regex', () => {
    const redactor = new CaptureRedactor(['(a+)+$']);
    const before = Date.now();
    redactor.redact('='.repeat(250_000));
    redactor.redact('-----BEGIN PRIVATE KEY-----'.repeat(9000));
    expect(Date.now() - before).toBeLessThan(1500);
    expect(redactor.redact('(a+)+$').content).toBe('[REDACTED:secret]');
  });

  it('does not rescan long near-matching literal prefixes at every character', () => {
    const redactor = new CaptureRedactor([`${'a'.repeat(511)}b`]);
    const before = Date.now();
    expect(redactor.redact('a'.repeat(500_000)).content).toHaveLength(500_000);
    expect(Date.now() - before).toBeLessThan(1000);
  });

  it('validates secret dictionary bounds before doing filesystem work', () => {
    expect(() => new CaptureRedactor(Array(65).fill('some-secret'))).toThrow('Too many');
    expect(() => new CaptureRedactor(['x'.repeat(513)])).toThrow('4–512');
  });
});
