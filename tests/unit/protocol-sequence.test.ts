import { describe, expect, it } from 'vitest';
import {
  ProtocolScanner,
  buildProtocolInstructions,
  isEndMarker,
  matchBroadcastMarker,
  matchEndMarker,
  matchQueryMarker,
  matchReplyMarker,
  matchSendStart,
  matchStatusMarker,
  type CommanderMessage,
} from '../../src/orchestration/protocol.js';

const capability = 'a'.repeat(43);
const otherCapability = 'b'.repeat(43);
const simpleMarkers = [
  ['REPLY', matchReplyMarker],
  ['BROADCAST', matchBroadcastMarker],
  ['STATUS', matchStatusMarker],
  ['QUERY', matchQueryMarker],
  ['END', matchEndMarker],
] as const;

function marker(type: string, sequence?: string, key = capability): string {
  return `===COMMANDER:${type}:${key}${sequence === undefined ? '' : `:${sequence}`}===`;
}

function frame(type: string, sequence?: string, content = 'message'): string {
  return `${marker(type, sequence)}\r\n${content}\r\n${marker('END', sequence)}\r\n`;
}

function scanner(options?: { maxContentLines?: number; maxContentBytes?: number }) {
  const emitted: CommanderMessage[] = [];
  return {
    emitted,
    scanner: new ProtocolScanner(0, 'Test agent', (msg) => emitted.push(msg), options),
  };
}

describe('Commander protocol sequence markers', () => {
  it.each(['1', '42', String(Number.MAX_SAFE_INTEGER)])('accepts canonical sequence %s', (sequence) => {
    const send = matchSendStart(marker('SEND:generic:2', sequence));
    expect(send?.slice(1)).toEqual(['generic', '2', capability, sequence]);
    for (const [type, match] of simpleMarkers) {
      expect(match(marker(type, sequence))).toEqual({ capability, sequence: Number(sequence) });
    }
  });

  it.each([
    '0', '00', '01', '-1', '+1', '1.0', '1e2', 'Infinity', 'NaN',
    '9007199254740992', '99999999999999999999999999', ' 1', '1 ', '',
  ])('rejects malformed or unsafe sequence %j without a legacy downgrade', (sequence) => {
    expect(matchSendStart(marker('SEND:generic:2', sequence))).toBeNull();
    for (const [type, match] of simpleMarkers) {
      expect(match(marker(type, sequence)), type).toBeNull();
    }
  });

  it('retains unsequenced capability and legacy marker compatibility', () => {
    expect(matchSendStart(marker('SEND:generic:2'))?.[4]).toBeUndefined();
    expect(matchSendStart('===COMMANDER:SEND:generic:2===')?.[3]).toBeUndefined();
    for (const [type, match] of simpleMarkers) {
      expect(match(marker(type))).toEqual({ capability });
      expect(match(`===COMMANDER:${type}===`)).toEqual({ capability: null });
    }
    expect(matchReplyMarker('===COMMANDER:REPLY:generic:2===')).toEqual({ capability: null });
  });

  it('requires a capability before a sequence suffix', () => {
    expect(matchSendStart('===COMMANDER:SEND:generic:2:1===')).toBeNull();
    for (const [type, match] of simpleMarkers) {
      expect(match(`===COMMANDER:${type}:1===`)).toBeNull();
    }
  });

  it('matches both footer capability and sequence without upgrade or downgrade', () => {
    expect(isEndMarker(marker('END', '7'), capability, 7)).toBe(true);
    expect(isEndMarker(marker('END', '8'), capability, 7)).toBe(false);
    expect(isEndMarker(marker('END', '7', otherCapability), capability, 7)).toBe(false);
    expect(isEndMarker(marker('END'), capability, 7)).toBe(false);
    expect(isEndMarker('===COMMANDER:END===', capability, 7)).toBe(false);
    expect(isEndMarker(marker('END', '7'), capability)).toBe(false);
    expect(isEndMarker(marker('END', '7'), null)).toBe(false);
    expect(isEndMarker(marker('END', '7'))).toBe(true);
    expect(isEndMarker(marker('END'), capability)).toBe(true);
  });

  it('keeps the supported terminal marker prefixes', () => {
    expect(matchSendStart(`│ AB${marker('SEND:generic:2', '3')}`)?.[4]).toBe('3');
    expect(matchReplyMarker(`✦ ${marker('REPLY', '3')}`)).toEqual({ capability, sequence: 3 });
  });
});

describe('ProtocolScanner sequence propagation and recovery', () => {
  it.each([
    ['SEND:generic:2', 'send'], ['REPLY', 'reply'], ['BROADCAST', 'broadcast'],
    ['STATUS', 'status'], ['QUERY', 'query'],
  ] as const)('propagates the %s identity across arbitrary chunks and ANSI decoration', (header, type) => {
    const fixture = scanner();
    // Feed complete ANSI tokens; all remaining character/chunk boundaries,
    // including the UTF-16 surrogate pair, are intentionally split.
    fixture.scanner.feed('\x1b[32m');
    for (const part of marker(header, '17')) fixture.scanner.feed(part);
    fixture.scanner.feed('\x1b[0m');
    const rest = `\r\nUnicode 🙂 body\r\n${marker('END', '17')}\r\n`;
    for (const part of rest.split('')) fixture.scanner.feed(part);
    expect(fixture.emitted).toHaveLength(1);
    expect(fixture.emitted[0]).toMatchObject({ type, capability, sequence: 17, content: 'Unicode 🙂 body' });
  });

  it('does not terminate a sequenced frame with a mismatched footer', () => {
    const fixture = scanner();
    fixture.scanner.feed(`${marker('SEND:generic:2', '2')}\nbody\n`);
    for (const footer of [marker('END'), marker('END', '3'), marker('END', '2', otherCapability)]) {
      fixture.scanner.feed(`${footer}\n`);
      expect(fixture.emitted).toEqual([]);
    }
    fixture.scanner.feed(`${marker('END', '2')}\n`);
    expect(fixture.emitted).toHaveLength(1);
    expect(fixture.emitted[0].sequence).toBe(2);
  });

  it('does not let a nested sequence hijack the outer collection', () => {
    const fixture = scanner();
    fixture.scanner.feed([
      marker('SEND:generic:2', '5'), 'Outer body',
      marker('REPLY', '6'), 'Nested example', marker('END', '6'), marker('END', '5'), '',
    ].join('\n'));
    expect(fixture.emitted).toHaveLength(1);
    expect(fixture.emitted[0]).toMatchObject({ type: 'send', sequence: 5 });
    expect(fixture.emitted[0].content).toContain(marker('REPLY', '6'));
  });

  it('clears sequence state before later legacy and capability-only frames', () => {
    const fixture = scanner();
    fixture.scanner.feed(frame('REPLY', '8'));
    fixture.scanner.feed(frame('QUERY', undefined, 'ping'));
    fixture.scanner.feed('===COMMANDER:STATUS===\nready\n===COMMANDER:END===\n');
    expect(fixture.emitted.map((msg) => msg.sequence)).toEqual([8, undefined, undefined]);
    expect(fixture.emitted[1]).not.toHaveProperty('sequence');
    expect(fixture.emitted[2]).not.toHaveProperty('sequence');
  });

  it.each([
    { maxContentLines: 1 }, { maxContentBytes: 3 },
  ])('resets sequenced collection after exceeding %j', (options) => {
    const fixture = scanner(options);
    fixture.scanner.feed(`${marker('REPLY', '4')}\nline one\nline two\n`);
    fixture.scanner.feed(frame('QUERY', undefined, 'ok'));
    expect(fixture.emitted).toEqual([expect.objectContaining({ type: 'query', content: 'ok' })]);
    expect(fixture.emitted[0]).not.toHaveProperty('sequence');
  });

  it('resets sequence after discarding a bounded unfinished line and recovers', () => {
    const fixture = scanner({ maxContentBytes: 10 });
    fixture.scanner.feed(`${marker('SEND:generic:2', '4')}\n`);
    fixture.scanner.feed('x'.repeat(5001));
    fixture.scanner.feed(`discarded suffix\n${frame('QUERY', undefined, 'ok')}`);
    expect(fixture.emitted).toEqual([expect.objectContaining({ type: 'query', content: 'ok' })]);
    expect(fixture.emitted[0]).not.toHaveProperty('sequence');
  });

  it('leaves replay policy to the transport and preserves intentional new identities', () => {
    const fixture = scanner();
    fixture.scanner.feed(frame('SEND:generic:2', '1'));
    fixture.scanner.feed(frame('SEND:generic:2', '1'));
    fixture.scanner.feed(frame('SEND:generic:2', '2'));
    expect(fixture.emitted.map((msg) => msg.sequence)).toEqual([1, 1, 2]);
  });
});

describe('Sequenced protocol injection instructions', () => {
  it('teaches one shared counter, stable redraw identities, intentional repeats, and bounds', () => {
    const text = buildProtocolInstructions(0, 'Test agent', [], capability);
    expect(text).toContain(`Protocol capability: ${capability}.`);
    expect(text).toContain('counter n starting at 1, shared across SEND, REPLY, BROADCAST, STATUS, and QUERY');
    expect(text).toContain('exact same n on its header and footer');
    expect(text).toContain('no leading zero, sign, or decimal point');
    expect(text).toContain('Keep the original counter unchanged when retrying or redrawing');
    expect(text).toContain('Never reuse a counter for a changed body, target, or command');
    expect(text).toContain('intentionally send the same body again as a new action, use a new counter');
    expect(text).toContain('4096-number reorder window');
    expect(text).toContain('rejects older counters, including counters never observed before');
    expect(text).toContain(String(Number.MAX_SAFE_INTEGER));
    expect(text).toContain('restart the agent and inject fresh protocol instructions before exhausting it');
    for (const verb of ['SEND:<type>:<panel>', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY', 'END']) {
      expect(text).toContain(`COMMANDER:${verb}:${capability}:<n>`);
    }
  });

  it('does not emit parseable command examples that could execute as prompt echoes', () => {
    const fixture = scanner();
    fixture.scanner.feed(`${buildProtocolInstructions(0, 'Test agent', [], capability)}\n`);
    expect(fixture.emitted).toEqual([]);
  });
});
