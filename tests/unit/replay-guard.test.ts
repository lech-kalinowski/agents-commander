import { describe, expect, it } from 'vitest';
import {
  ProtocolReplayGuard, PROTOCOL_SEQUENCE_WINDOW,
  MAX_LEGACY_PROTOCOL_FRAMES, MAX_PROTOCOL_CAPABILITY_SCOPES,
} from '../../src/orchestration/replay-guard.js';

const capability = 'a'.repeat(43);
const key = (n: number, scope = capability) => `seq:${scope}:${n}`;

describe('bounded protocol replay ledger', () => {
  it('retains legacy identities indefinitely and fails closed instead of evicting at capacity', () => {
    const guard = new ProtocolReplayGuard();
    for (let i = 0; i < MAX_LEGACY_PROTOCOL_FRAMES; i++) expect(guard.claim(`legacy:${i}`)).toBe(true);
    expect(guard.claim('legacy:0')).toBe(false);
    expect(guard.saturated).toBe(false);
    expect(guard.claim('legacy:overflow')).toBe(false);
    expect(guard.saturated).toBe(true);
    expect(guard.claim('legacy:0')).toBe(false);
    expect(guard.claim(key(1))).toBe(false);
  });

  it('bounds sequence memory without making forgotten IDs eligible again', () => {
    const guard = new ProtocolReplayGuard();
    for (let i = 1; i <= PROTOCOL_SEQUENCE_WINDOW * 3; i++) expect(guard.claim(key(i))).toBe(true);
    expect(guard.claim(key(1))).toBe(false);
    expect(guard.claim(key(PROTOCOL_SEQUENCE_WINDOW * 2))).toBe(false);
    expect(guard.claim(key(PROTOCOL_SEQUENCE_WINDOW * 3))).toBe(false);
    expect(guard.saturated).toBe(false);
    const windows = (guard as any).sequences as Map<string, { seen: Set<number> }>;
    expect(windows.get(capability)?.seen.size).toBe(PROTOCOL_SEQUENCE_WINDOW);
  });

  it('permits unseen out-of-order IDs only inside its window', () => {
    const guard = new ProtocolReplayGuard();
    expect(guard.claim(key(5000))).toBe(true);
    expect(guard.claim(key(5000 - PROTOCOL_SEQUENCE_WINDOW))).toBe(false);
    expect(guard.claim(key(5001 - PROTOCOL_SEQUENCE_WINDOW))).toBe(true);
    expect(guard.claim(key(4999))).toBe(true);
    expect(guard.claim(key(4999))).toBe(false);
    expect(guard.claim(key(Number.MAX_SAFE_INTEGER))).toBe(true);
    expect(guard.claim(key(5000))).toBe(false);
  });

  it('limits capability namespaces and never evicts them into replay eligibility', () => {
    const guard = new ProtocolReplayGuard();
    for (let i = 0; i < MAX_PROTOCOL_CAPABILITY_SCOPES; i++) expect(guard.claim(key(1, String(i).padStart(43, 'a')))).toBe(true);
    expect(guard.claim(key(1, 'z'.repeat(43)))).toBe(false);
    expect(guard.saturated).toBe(true);
    expect(guard.claim(key(1, String(0).padStart(43, 'a')))).toBe(false);
  });

  it.each(['0', '-1', '01', '1.5', '1e2', '9007199254740992', '', '<n>'])(
    'rejects invalid sequence %s without consuming capacity', (sequence) => {
      const guard = new ProtocolReplayGuard();
      expect(guard.claim(`seq:${capability}:${sequence}`)).toBe(false);
      expect(guard.saturated).toBe(false);
      expect(guard.claim(key(1))).toBe(true);
    },
  );
});
