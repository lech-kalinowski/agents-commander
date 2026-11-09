import { describe, expect, it, vi } from 'vitest';
import {
  ProtocolScanner, promptProtocolSequences, buildProtocolInstructions,
} from '../../src/orchestration/protocol.js';

vi.mock('../../src/utils/logger.js', () => ({ logger: {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
} }));

const capability = 'a'.repeat(43);
const otherCapability = 'b'.repeat(43);
const marker = (command: string, n: number | string = 1, closing = '===', key = capability) =>
  `===COMMANDER:${command}:${key}:${n}${closing}`;
const frame = (header = marker('SEND:codex:2'), footer = marker('END'), body = 'Hi') =>
  `${header}\n${body}\n${footer}\n`;

function fixture(options: { maxContentBytes?: number; maxContentLines?: number } = {}) {
  const received = vi.fn();
  const rejected = vi.fn();
  const malformed = vi.fn();
  const scanner = new ProtocolScanner(0, 'Synthetic', received, {
    ...options, onRejected: rejected, onMalformed: malformed, logPotentialMarkers: false,
  });
  scanner.setProtocolCapability(capability);
  return { scanner, received, rejected, malformed };
}

describe('authenticated malformed protocol diagnostics', () => {
  it.each([
    ['missing-header-delimiter', marker('SEND:codex:2', 1, ''), marker('END')],
    ['missing-footer-delimiter', marker('SEND:codex:2'), marker('END', 1, '')],
    ['missing-both-delimiters', marker('SEND:codex:2', 1, ''), marker('END', 1, '')],
    ['missing-both-delimiters', marker('SEND:codex:2', 1, '=='), marker('END', 1, '=')],
    ['mismatched-sequence', marker('SEND:codex:2'), marker('END', 2)],
    ['invalid-sequence', marker('SEND:codex:2', '01'), marker('END', '01')],
    ['invalid-sequence', marker('REPLY', '0'), marker('END', 1)],
    ['invalid-sequence', marker('QUERY'), marker('END', '-1')],
    ['invalid-sequence', marker('STATUS', '9007199254740992'), marker('END', 2)],
    ['invalid-panel', marker('SEND:codex:0'), marker('END')],
    ['invalid-panel', marker('SEND:codex:nope'), marker('END')],
    ['invalid-panel', marker('SEND:codex:1000001'), marker('END')],
    ['invalid-header', marker('SEND:codex'), marker('END')],
    ['invalid-header', marker('SEND:bad-type:2'), marker('END')],
    ['invalid-header', marker('UNKNOWN'), marker('END')],
  ] as const)('reports %s without routing or copying content', (code, header, footer) => {
    const { scanner, received, rejected, malformed } = fixture();
    scanner.feed(frame(header, footer, 'private body which must not enter feedback'));
    scanner.finishCompletedPart();
    expect(received).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
    expect(malformed).toHaveBeenCalledOnce();
    const issue = malformed.mock.calls[0][0];
    expect(issue).toEqual({ code, capability, sequences: expect.any(Array), fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(issue)).not.toContain('private body');
  });

  it.each(['SEND:codex:2', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY'])('supports %s and preserves correction order', (command) => {
    const { scanner, received, malformed } = fixture();
    const observed: string[] = [];
    received.mockImplementation((msg) => observed.push(`valid:${msg.sequence}`));
    malformed.mockImplementation((issue) => observed.push(`invalid:${issue.sequences.join(',')}`));
    scanner.feed(frame(marker(command, 1, ''), marker('END', 1, '')));
    scanner.feed(frame(marker(command, 2), marker('END', 2)));
    scanner.feed(frame(marker(command, 3), marker('END', 4)));
    scanner.finishCompletedPart();
    expect(observed).toEqual(['invalid:1', 'valid:2', 'invalid:3,4']);
  });

  it('does not route a nested valid SEND under a malformed header', () => {
    const { scanner, received, malformed } = fixture();
    scanner.feed([
      marker('REPLY', 1, ''), 'outer body', marker('SEND:codex:2', 2),
      'nested body', marker('END', 2), marker('END', 1), '',
    ].join('\n'));
    expect(received).not.toHaveBeenCalled();
    expect(malformed).toHaveBeenCalledOnce();
    expect(malformed.mock.calls[0][0]).toMatchObject({ code: 'missing-header-delimiter', sequences: [1, 2] });
  });

  it('preserves valid outer collection when nested examples have their own footer', () => {
    const { scanner, received, malformed } = fixture();
    scanner.feed([
      marker('REPLY', 1), 'outer body', marker('SEND:codex:2', 2),
      'nested body', marker('END', 2), marker('END', 1), '',
    ].join('\n'));
    expect(malformed).not.toHaveBeenCalled();
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0]).toMatchObject({ type: 'reply', sequence: 1 });
  });

  it('does not issue diagnostics for foreign, legacy, quoted, inline or unanchored candidates', () => {
    const { scanner, received, malformed } = fixture();
    for (const header of [
      marker('REPLY', 1, '', otherCapability), '===COMMANDER:REPLY',
      `Example: ${marker('REPLY', 1, '')}`, `\`${marker('REPLY', 1, '')}\``,
      marker('REPLY', 1, '').slice(3), `${marker('REPLY', 1, '')} extra`,
    ]) {
      scanner.feed(frame(header, marker('END', 1, '')));
      scanner.finishCompletedPart();
    }
    expect(received).not.toHaveBeenCalled();
    expect(malformed).not.toHaveBeenCalled();
  });

  it('keeps authenticated unknown-adapter rejection separate from malformed syntax', () => {
    const { scanner, received, rejected, malformed } = fixture();
    scanner.feed(frame(marker('SEND:apex:2'), marker('END')));
    expect(received).not.toHaveBeenCalled();
    expect(malformed).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledOnce();
    expect(rejected.mock.calls[0][0]).toMatchObject({ rejection: 'unknown_agent_type', targetAgent: 'apex' });
  });

  it('hashes only structural identity, not body text, with bounded diagnostic payload', () => {
    const first = fixture();
    const second = fixture();
    first.scanner.feed(frame(marker('REPLY', 1, ''), marker('END'), 'first private body'));
    second.scanner.feed(frame(marker('REPLY', 1, ''), marker('END'), 'different body'));
    expect(first.malformed.mock.calls[0][0]).toEqual(second.malformed.mock.calls[0][0]);
    expect(JSON.stringify(first.malformed.mock.calls[0][0]).length).toBeLessThan(300);
  });

  it.each([{ maxContentLines: 1 }, { maxContentBytes: 5 }])('quarantines oversized content until its footer: %j', (options) => {
    const { scanner, received, malformed } = fixture(options);
    scanner.feed(`${marker('BROADCAST')}\nlong body\nsecond line\n`);
    expect(malformed).not.toHaveBeenCalled();
    scanner.feed(`${marker('END')}\n`);
    expect(received).not.toHaveBeenCalled();
    expect(malformed).toHaveBeenCalledOnce();
    expect(malformed.mock.calls[0][0]).toMatchObject({ code: 'oversized-frame', sequences: [1] });
    scanner.feed(frame(marker('QUERY', 2), marker('END', 2), 'ok'));
    expect(received).toHaveBeenCalledOnce();
  });

  it('reports oversized unbroken content without retaining the whole unfinished line', () => {
    const { scanner, received, malformed } = fixture({ maxContentBytes: 5 });
    scanner.feed(`${marker('REPLY')}\n`);
    scanner.feed('x'.repeat(20000));
    expect((scanner as any).bufferBytes).toBe(0);
    scanner.feed(`\n${marker('END')}\n`);
    expect(received).not.toHaveBeenCalled();
    expect(malformed.mock.calls[0][0]).toMatchObject({ code: 'oversized-frame' });
  });

  it.each(['whole', 'chunk', 'row'] as const)('preserves malformed-header diagnosis for a valid-size long body via %s', (mode) => {
    const { scanner, received, malformed } = fixture();
    const header = marker('REPLY', 1, '');
    const footer = marker('END');
    const body = 'x'.repeat(6000);
    if (mode === 'whole') scanner.feed(frame(header, footer, body));
    else if (mode === 'chunk') {
      scanner.feed(`${header}\n`);
      for (let offset = 0; offset < body.length; offset += 200) scanner.feed(body.slice(offset, offset + 200));
      scanner.feed(`\n${footer}\n`);
    } else {
      scanner.feedTerminalRow({ text: header, wrapsToNext: false });
      for (let offset = 0; offset < body.length; offset += 200) {
        scanner.feedTerminalRow({ text: body.slice(offset, offset + 200), wrapsToNext: offset + 200 < body.length });
      }
      scanner.feedTerminalRow({ text: footer, wrapsToNext: false });
    }
    scanner.finishCompletedPart();
    expect(received).not.toHaveBeenCalled();
    expect(malformed).toHaveBeenCalledOnce();
    expect(malformed.mock.calls[0][0]).toMatchObject({ code: 'missing-header-delimiter', sequences: [1] });
  });

  it.each(['chunk', 'row'] as const)('counts exact content allowance including LF for quarantined %s bodies', (mode) => {
    for (const extraByte of [0, 1]) {
      const { scanner, received, malformed } = fixture({ maxContentBytes: 6000 });
      const header = marker('REPLY', 1, '');
      const footer = marker('END');
      // The first logical line costs 301 bytes including its LF. Exactly
      // 5698 further body bytes + LF use the remaining 5699-byte allowance.
      const body = 'x'.repeat(5698 + extraByte);
      scanner.feed(`${header}\n${'y'.repeat(300)}\n`);
      for (let offset = 0; offset < body.length; offset += 200) {
        const text = body.slice(offset, offset + 200);
        if (mode === 'chunk') scanner.feed(text);
        else scanner.feedTerminalRow({ text, wrapsToNext: offset + 200 < body.length });
      }
      if (mode === 'chunk') scanner.feed('\n');
      scanner.feedLine(footer);
      expect(received).not.toHaveBeenCalled();
      expect(malformed).toHaveBeenCalledOnce();
      expect(malformed.mock.calls[0][0].code).toBe(extraByte ? 'oversized-frame' : 'missing-header-delimiter');
    }
  });

  it('fails closed rather than evict identities when malformed nested markers flood a candidate', () => {
    const { scanner, received, malformed } = fixture();
    scanner.feedLine(marker('REPLY', 1, ''));
    for (let sequence = 2; sequence <= 16385; sequence++) scanner.feedLine(marker('REPLY', sequence));
    expect(malformed).toHaveBeenCalledOnce();
    expect(malformed.mock.calls[0][0]).toMatchObject({ code: 'oversized-frame' });
    expect(malformed.mock.calls[0][0].sequences).toHaveLength(16385);
    expect((scanner as any).diagnosticFrame).toBeNull();
    scanner.feed(frame(marker('REPLY', 16386), marker('END', 16386)));
    scanner.finishCompletedPart();
    expect(received).not.toHaveBeenCalled();
    scanner.setProtocolCapability(otherCapability);
    scanner.feed(frame(marker('REPLY', 1, '===', otherCapability), marker('END', 1, '===', otherCapability)));
    expect(received).toHaveBeenCalledOnce();
  });

  it('does not poison a fresh capability rotated synchronously from overflow feedback', () => {
    const { scanner, received, malformed } = fixture();
    malformed.mockImplementation(() => scanner.setProtocolCapability(otherCapability));
    scanner.feedLine(marker('REPLY', 1, ''));
    for (let sequence = 2; sequence <= 16385; sequence++) scanner.feedLine(marker('REPLY', sequence));
    expect(malformed).toHaveBeenCalledOnce();
    scanner.feed(frame(marker('QUERY', 1, '===', otherCapability), marker('END', 1, '===', otherCapability), 'ping'));
    expect(received).toHaveBeenCalledOnce();
  });
});

describe('completion and mutable terminal boundaries', () => {
  it('never diagnoses a missing footer from an idle or partially painted grid', () => {
    const { scanner, received, malformed } = fixture();
    scanner.feedTerminalRow({ text: marker('REPLY'), wrapsToNext: false });
    scanner.feedTerminalRow({ text: 'body', wrapsToNext: false });
    scanner.feedTerminalRow({ text: marker('END', 1, ''), wrapsToNext: true });
    scanner.feed('\n'); // even a default-finalized flush cannot upgrade a mutable fragment
    expect(received).not.toHaveBeenCalled();
    expect(malformed).not.toHaveBeenCalled();
  });

  it('allows closed-footer proof of a malformed header in mutable grid rows', () => {
    const { scanner, received, malformed } = fixture();
    for (const text of [marker('REPLY', 1, ''), 'body', marker('END')]) {
      scanner.feedTerminalRow({ text, wrapsToNext: false });
    }
    expect(received).not.toHaveBeenCalled();
    expect(malformed.mock.calls[0][0]).toMatchObject({ code: 'missing-header-delimiter' });
  });

  it('reassembles hard-wrapped rows with supported CLI prefixes before diagnosis', () => {
    const { scanner, received, malformed } = fixture();
    const header = `● AB${marker('SEND:codex:2', 15, '')}`;
    const footer = `✦ ${marker('END', 15)}`;
    for (const text of [header, 'Hi', footer]) {
      for (let offset = 0; offset < text.length; offset += 23) {
        scanner.feedTerminalRow({ text: text.slice(offset, offset + 23), wrapsToNext: offset + 23 < text.length });
      }
    }
    expect(received).not.toHaveBeenCalled();
    expect(malformed.mock.calls[0][0]).toMatchObject({ code: 'missing-header-delimiter', sequences: [15] });
  });

  it('allows finalized scrollback to prove a missing footer delimiter', () => {
    const { scanner, received, malformed } = fixture();
    for (const text of [marker('REPLY'), 'body', marker('END', 1, '')]) {
      scanner.feedTerminalRow({ text, wrapsToNext: false, finalized: true });
    }
    expect(received).not.toHaveBeenCalled();
    expect(malformed.mock.calls[0][0]).toMatchObject({ code: 'missing-footer-delimiter' });
  });

  it('flushes completed native parts without a final newline and does not stitch parts', () => {
    const { scanner, received, malformed } = fixture();
    scanner.feed(`${marker('REPLY')}\nbody`);
    expect(malformed).not.toHaveBeenCalled();
    scanner.finishCompletedPart();
    expect(malformed.mock.calls[0][0]).toMatchObject({ code: 'missing-footer', sequences: [1] });
    scanner.feed(marker('END'));
    scanner.finishCompletedPart();
    expect(received).not.toHaveBeenCalled();
    expect(malformed).toHaveBeenCalledOnce();
    scanner.feed(frame(marker('REPLY', 2), marker('END', 2)).trimEnd());
    scanner.finishCompletedPart();
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0].sequence).toBe(2);
  });

  it('does not carry candidate state across mute or explicit capability rotation', () => {
    const { scanner, malformed } = fixture();
    scanner.feed(`${marker('REPLY', 1, '')}\nbody\n`);
    scanner.mute(10000);
    scanner.finishCompletedPart();
    scanner.unmute();
    scanner.feed(`${marker('END')}\n`);
    scanner.setProtocolCapability(otherCapability);
    scanner.feed(frame(marker('REPLY', 2, ''), marker('END', 2)));
    scanner.finishCompletedPart();
    expect(malformed).not.toHaveBeenCalled();
  });

  it.each([1, 2, 7, 31])('keeps diagnostics invariant across native input chunk width %i', (width) => {
    const { scanner, malformed } = fixture();
    const text = frame(marker('REPLY', 23, ''), marker('END', 24, ''), '🙂 Unicode');
    for (let offset = 0; offset < text.length; offset += width) scanner.feed(text.slice(offset, offset + width));
    scanner.finishCompletedPart();
    expect(malformed).toHaveBeenCalledOnce();
    expect(malformed.mock.calls[0][0]).toMatchObject({ code: 'mismatched-sequence', sequences: [23, 24] });
  });
});

describe('malformed prompt identity suppression', () => {
  it('teaches bounded, frame-specific corrections without executable examples', () => {
    const text = buildProtocolInstructions(0, 'Synthetic', [], capability);
    expect(text).toContain("Correct only that frame's stated error");
    expect(text).toContain('fresh counter');
    expect(text).toContain('at most 3 protocol-correction notices per capability');
    expect(text).toContain('do not repeat other commands already acknowledged');
    expect(promptProtocolSequences(text, capability)).toEqual([]);
  });

  it('reserves canonical counters in malformed headers and footer examples, including inline text', () => {
    const text = [
      `Inline ${marker('SEND:codex:bad', 3, '')}`,
      marker('REPLY', 4, ''), marker('END', 5, '=='),
      marker('SEND:codex', 6, ''), marker('UNKNOWN', 7, ''),
    ].join('\n');
    expect(promptProtocolSequences(text, capability)).toEqual([3, 4, 5, 6, 7]);
  });

  it('never assigns a canonical identity to invalid counter spellings or foreign capabilities', () => {
    const text = [marker('REPLY', '01', ''), marker('END', '-2', ''), marker('QUERY', 3, '', otherCapability)].join('\n');
    expect(promptProtocolSequences(text, capability)).toEqual([]);
  });
});
