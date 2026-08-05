import { describe, expect, it } from 'vitest';
import {
  CODEX_MICRO_BINDINGS,
  CODEX_MICRO_KEYS,
  getCodexMicroAction,
  getCodexMicroBinding,
  getCodexMicroKey,
  getCodexMicroKeys,
  isCodexMicroKey,
} from '../../src/hardware/codex-micro.js';

const EXPECTED_BINDINGS = [
  ['C-S-pageup', 'previous-panel'],
  ['C-S-pagedown', 'next-panel'],
  ['C-S-home', 'previous-page'],
  ['C-S-end', 'next-page'],
  ['C-S-f5', 'focus-slot-1'],
  ['C-S-f6', 'focus-slot-2'],
  ['C-S-f7', 'focus-slot-3'],
  ['C-S-f8', 'focus-slot-4'],
  ['C-S-f9', 'open-navigator'],
  ['C-S-f10', 'open-activity'],
  ['C-S-f11', 'approve'],
  ['C-S-f12', 'reject'],
  ['C-S-insert', 'open-test-overlay'],
] as const;

describe('Codex Micro keyboard-HID mapping', () => {
  it('defines the complete, collision-free 13-control mapping', () => {
    expect(CODEX_MICRO_BINDINGS.map(({ key, action }) => [key, action])).toEqual(
      EXPECTED_BINDINGS,
    );
    expect(new Set(CODEX_MICRO_KEYS).size).toBe(13);
    expect(new Set(CODEX_MICRO_BINDINGS.map(({ action }) => action)).size).toBe(13);
    expect(CODEX_MICRO_BINDINGS.every(({ label, description }) => (
      label.length > 0 && description.length > 0
    ))).toBe(true);
  });

  it('looks up actions, bindings, and keys in both directions', () => {
    for (const [key, action] of EXPECTED_BINDINGS) {
      expect(isCodexMicroKey(key)).toBe(true);
      expect(getCodexMicroAction(key)).toBe(action);
      expect(getCodexMicroBinding(key)).toMatchObject({ key, action });
      expect(getCodexMicroKey(action)).toBe(key);
    }

    expect(isCodexMicroKey('f11')).toBe(false);
    expect(getCodexMicroAction('f11')).toBeUndefined();
    expect(getCodexMicroBinding('C-S-f13')).toBeUndefined();
  });

  it('returns a fresh mutable key array without changing the canonical map', () => {
    const first = getCodexMicroKeys();
    first.pop();

    expect(first).toHaveLength(12);
    expect(getCodexMicroKeys()).toEqual(CODEX_MICRO_KEYS);
    expect(CODEX_MICRO_KEYS).toHaveLength(13);
    expect(Object.isFrozen(CODEX_MICRO_KEYS)).toBe(true);
  });
});
