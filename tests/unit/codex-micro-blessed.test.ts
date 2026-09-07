import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CODEX_MICRO_KEYS } from '../../src/hardware/codex-micro.js';

interface ParsedBlessedKey {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

const require = createRequire(import.meta.url);
const blessedKeys = require('blessed/lib/keys.js') as {
  emitKeypressEvents(stream: PassThrough): void;
};

function fullKeyName(key: ParsedBlessedKey): string {
  return `${key.ctrl ? 'C-' : ''}${key.meta ? 'M-' : ''}${key.shift ? 'S-' : ''}${key.name ?? ''}`;
}

describe('Codex Micro Blessed key compatibility', () => {
  it('parses every documented xterm HID sequence as its canonical binding', () => {
    const input = new PassThrough();
    const parsed: string[] = [];
    input.on('keypress', (_character, key: ParsedBlessedKey | undefined) => {
      if (key) parsed.push(fullKeyName(key));
    });
    blessedKeys.emitKeypressEvents(input);

    const sequences = [
      '\x1b[5;6~',
      '\x1b[6;6~',
      '\x1b[1;6H',
      '\x1b[1;6F',
      '\x1b[15;6~',
      '\x1b[17;6~',
      '\x1b[18;6~',
      '\x1b[19;6~',
      '\x1b[20;6~',
      '\x1b[21;6~',
      '\x1b[23;6~',
      '\x1b[24;6~',
      '\x1b[2;6~',
    ];
    for (const sequence of sequences) input.write(sequence);
    input.end();

    expect(parsed).toEqual(CODEX_MICRO_KEYS);
  });
});
