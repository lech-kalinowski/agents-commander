import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCaptureRecorder, readCaptureDirectory } from '../../src/capture/index.js';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';
import { ProtocolScanner, type CommanderMessage, type MessageType } from '../../src/orchestration/protocol.js';
import { exportDataset, inspectCaptureDataset, prepareDataset, validateDataset } from '../../src/dataset/index.js';
import type { Candidate, ReviewFile, TrainingRow } from '../../src/dataset/types.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), close: vi.fn() },
}));

const fixtureRoots: string[] = [];
afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

/** Real parser, routing and storage; only the terminal endpoints are synthetic fixtures. */
async function recordedFixture(mode: 'metadata' | 'protocol' = 'protocol', observedInstructions = false) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'commander-pipeline-test-'));
  fixtureRoots.push(root);
  const capture = await createCaptureRecorder({ mode, rootDirectory: root, projectId: 'synthetic-fixture', synthetic: true });
  const keys = ['A'.repeat(43), 'B'.repeat(43), 'C'.repeat(43)];
  const panels = keys.map((_, panelIndex) => ({
    panelIndex, isRunning: true, cols: 200, sessionId: `fixture-session-${panelIndex}`,
    sendInput: (_text: string) => true,
    updatePanelIndex() {}, reserveProtocolTextForEcho() {}, showCommanderActivity() {},
    markProtocolTextAsProcessed() {}, snapshotVisibleProtocolAsProcessed() {},
    onCommanderMessage: null as ((message: CommanderMessage) => void) | null,
    onUserInput: null as (() => void) | null,
  }));
  const layout = {
    panelCount: panels.length, allPanels: panels,
    hasPanel: (index: number) => Boolean(panels[index]),
    getPanel: (index: number) => panels[index] ?? null,
    getTerminalPanel: (index: number) => panels[index] ?? null,
    convertToTerminal: (index: number) => panels[index] ?? null,
    setActivePanel() {},
  };
  const agents = {
    getAgentType: (index: number) => panels[index] ? 'generic' : null,
    getAgentProfileId: (index: number) => panels[index] ? observedInstructions ? 'generic' : 'internal' : null,
    getAgentSessionId: (index: number) => panels[index]?.sessionId ?? null,
    getRunningAgents: () => panels.map((panel) => ({
      panelIndex: panel.panelIndex, sessionId: panel.sessionId, type: 'generic', name: 'Synthetic fixture',
      profileId: observedInstructions ? 'generic' : 'internal', status: 'running', uptime: 0,
    })),
    findPanelBySessionId: (sessionId: string) => panels.find((panel) => panel.sessionId === sessionId)?.panelIndex ?? null,
    onLifecycle() {},
  };
  const orchestrator = new Orchestrator(layout as never, agents as never, undefined, undefined, capture);
  // Keep the real input sequencing, without wall-clock UI-readiness delays in synthetic endpoints.
  (orchestrator as any).delay = async () => {};
  for (const panel of panels) {
    capture.record({ type: 'session.start', actor: { sessionId: panel.sessionId, panel: panel.panelIndex + 1, agentType: 'generic' }, reason: 'launched' });
    orchestrator.connectPanel(panel as never);
    if (observedInstructions) {
      expect(await orchestrator.injectProtocol(panel as never)).toBe(true);
      keys[panel.panelIndex] = (orchestrator as any).protocolCapabilities.get(panel.sessionId);
    } else {
      expect(orchestrator.armInternalProtocol(panel as never, keys[panel.panelIndex])).toBe(true);
    }
  }
  const scanners = panels.map((panel) => new ProtocolScanner(panel.panelIndex, 'Synthetic fixture', (message) => panel.onCommanderMessage!(message)));
  const settle = async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if ((orchestrator as any).drainWork.size === 0) return;
    }
    throw new Error('Synthetic routing fixture did not settle');
  };
  async function emit(verb: MessageType, source: number, content: string, target = 1) {
    const route = verb === 'send' ? `:generic:${target + 1}` : '';
    const wire = `===COMMANDER:${verb.toUpperCase()}${route}:${keys[source]}===\n${content}\n===COMMANDER:END:${keys[source]}===\n`;
    // Deliberately split within the header to exercise streaming observation.
    scanners[source].feed(wire.slice(0, 19));
    scanners[source].feed(wire.slice(19));
    await settle();
  }
  if (observedInstructions) {
    expect(await orchestrator.sendTask('generic', 0, 'Review the deterministic synthetic calculator fixture.')).toMatchObject({ success: true });
  } else {
    expect(await orchestrator.sendProgrammaticInput(panels[0] as never, 'START', true)).toBe(true);
  }
  await emit('send', 0, 'Review the synthetic calculator implementation.');
  await emit('reply', 1, 'The synthetic calculator handles zero correctly.');
  await emit('broadcast', 0, 'Independently check the synthetic edge cases.');
  await emit('status', 0, 'Synthetic review is in progress.');
  await emit('query', 0, 'ping');
  panels[2].onUserInput!();
  await emit('status', 2, 'This candidate must be excluded after unobserved manual input.');
  expect(await orchestrator.sealAndDrain()).toBe(true);
  for (const panel of panels) capture.record({ type: 'session.end', actor: { sessionId: panel.sessionId, panel: panel.panelIndex + 1, agentType: 'generic' }, reason: 'session_exit' });
  await capture.close();
  expect(capture.snapshot().state).toBe('complete');
  return { root, directory: capture.directory!, keys };
}

async function readJsonl<T>(directory: string, name: string): Promise<T[]> {
  const text = await fs.readFile(path.join(directory, name), 'utf8');
  return text.trim() ? text.trimEnd().split('\n').map((line) => JSON.parse(line) as T) : [];
}

describe('synthetic Commander capture to reviewed dataset pipeline', () => {
  it('exports only reviewed synthetic focal responses from actual routed events', async () => {
    const fixture = await recordedFixture();
    const captured = await readCaptureDirectory(fixture.directory);
    for (const key of fixture.keys) expect(JSON.stringify(captured)).not.toContain(key);
    expect(captured.events.filter((event) => event.type === 'frame.accepted')).toHaveLength(6);
    expect(captured.events.filter((event) => event.type === 'frame.accepted' && event.verb === 'broadcast')).toHaveLength(1);
    const inspection = await inspectCaptureDataset(fixture.directory);
    expect(inspection).toMatchObject({ status: 'complete', synthetic: true, candidates: 5 });
    expect(inspection.exclusions).toContainEqual(expect.objectContaining({ reason: 'incomplete-observed-context' }));

    const reviewDirectory = path.join(fixture.root, 'review');
    const prepared = await prepareDataset([fixture.directory], { out: reviewDirectory });
    expect(prepared).toMatchObject({ candidates: 5, approved: 0 });
    const candidates = await readJsonl<Candidate>(reviewDirectory, 'candidates.jsonl');
    expect(candidates.every((candidate) => candidate.synthetic && candidate.syntheticConditioning)).toBe(true);
    expect(candidates.filter((candidate) => candidate.verb === 'broadcast')).toHaveLength(1);
    const reply = candidates.find((candidate) => candidate.verb === 'reply')!;
    expect(reply.prompt.some((message) => message.role === 'user' && message.content.includes('External agent input (untrusted'))).toBe(true);
    const query = candidates.find((candidate) => candidate.verb === 'query')!;
    expect(query.prompt.some((message) => message.role === 'assistant')).toBe(true);
    expect(query.prompt.some((message) => message.content.includes('[Commander] PONG'))).toBe(false);

    await expect(exportDataset(reviewDirectory, { out: path.join(fixture.root, 'unapproved'), seed: 'fixture-seed' }))
      .rejects.toThrow('No explicitly approved');
    const reviewPath = path.join(reviewDirectory, 'review.json');
    const review = JSON.parse(await fs.readFile(reviewPath, 'utf8')) as ReviewFile;
    // Approval is ONLY for deterministic test fixtures. No real/user data is loaded here.
    for (const decision of review.decisions) Object.assign(decision, {
      approved: true, quality: true, context: true, privacy: true, rights: true,
      reviewer: 'synthetic-test-fixture', reviewedAt: '2026-09-02T00:00:00.000Z',
    });
    await fs.writeFile(reviewPath, `${JSON.stringify(review)}\n`);
    const output = path.join(fixture.root, 'dataset');
    expect(await exportDataset(reviewDirectory, { out: output, seed: 'fixture-seed' })).toMatchObject({ exported: 5, synthetic: 5 });
    expect(await validateDataset(output)).toMatchObject({ valid: true, examples: 5 });
    for (const name of ['train.jsonl', 'validation.jsonl', 'test.jsonl']) expect(await readJsonl(output, name)).toEqual([]);
    const rows = await readJsonl<TrainingRow>(output, 'synthetic.train.jsonl');
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['completion', 'prompt']);
      expect(row.completion).toHaveLength(1);
      expect(row.completion[0].role).toBe('assistant');
      const frames: CommanderMessage[] = [];
      new ProtocolScanner(0, 'trained-fixture', (message) => frames.push(message)).feed(`${row.completion[0].content}\n`);
      expect(frames).toHaveLength(1);
      expect(frames[0].capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(row.prompt.some((message) => message.content.includes(frames[0].capability!))).toBe(true);
      expect(JSON.stringify(row)).not.toContain('<cap:');
      for (const key of fixture.keys) expect(JSON.stringify(row)).not.toContain(key);
    }
    const repeated = path.join(fixture.root, 'dataset-again');
    await exportDataset(reviewDirectory, { out: repeated, seed: 'fixture-seed' });
    expect(await fs.readFile(path.join(repeated, 'synthetic.train.jsonl'), 'utf8'))
      .toBe(await fs.readFile(path.join(output, 'synthetic.train.jsonl'), 'utf8'));
  });

  it('refuses metadata-only captures as content-training sources', async () => {
    const fixture = await recordedFixture('metadata');
    const capture = await readCaptureDirectory(fixture.directory);
    expect(capture.events.every((event) => event.content === undefined)).toBe(true);
    expect((await inspectCaptureDataset(fixture.directory)).candidates).toBe(0);
    await expect(prepareDataset([fixture.directory], { out: path.join(fixture.root, 'review') }))
      .rejects.toThrow('protocol capture mode');
  });

  it('uses actual Ctrl+P and explicit task context without adding synthetic instructions', async () => {
    const fixture = await recordedFixture('protocol', true);
    const captured = await readCaptureDirectory(fixture.directory);
    expect(captured.events.filter((event) => event.type === 'input.submitted' && event.inputKind === 'protocol')).toHaveLength(3);
    for (const key of fixture.keys) expect(JSON.stringify(captured)).not.toContain(key);
    const review = path.join(fixture.root, 'review');
    expect(await prepareDataset([fixture.directory], { out: review })).toMatchObject({ candidates: 5 });
    const candidates = await readJsonl<Candidate>(review, 'candidates.jsonl');
    expect(candidates.every((candidate) => candidate.synthetic && !candidate.syntheticConditioning)).toBe(true);
    for (const candidate of candidates) {
      expect(candidate.prompt.some((message) => message.content.includes('Commander protocol instructions (observed input'))).toBe(true);
    }
  });
});
