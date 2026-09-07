import { describe, expect, it, vi } from 'vitest';
import { ProtocolScanner } from '../../src/orchestration/protocol.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('ProtocolScanner stream boundaries', () => {
  it('preserves a long logical line independently of PTY chunk boundaries', () => {
    const content = `prefix-${'x'.repeat(6200)}-🙂-suffix`;
    const frame = `===COMMANDER:SEND:generic:2===\n${content}\n===COMMANDER:END===\n`;
    const complete = vi.fn();
    new ProtocolScanner(0, 'Synthetic', complete).feed(frame);

    const fragmented = vi.fn();
    const scanner = new ProtocolScanner(0, 'Synthetic', fragmented);
    for (let offset = 0; offset < frame.length; offset += 100) {
      scanner.feed(frame.slice(offset, offset + 100));
    }

    expect(complete).toHaveBeenCalledOnce();
    expect(fragmented).toHaveBeenCalledOnce();
    expect(fragmented.mock.calls[0][0].content.length).toBe(content.length);
    expect(fragmented.mock.calls[0][0].content).toBe(content);
    expect(fragmented.mock.calls).toEqual(complete.mock.calls);
  });

  it('allows a fragmented footer after the complete body byte allowance is used', () => {
    const emitted = vi.fn();
    const scanner = new ProtocolScanner(0, 'Synthetic', emitted, { maxContentBytes: 9 });
    const capability = 'a'.repeat(43);
    scanner.feed(`===COMMANDER:SEND:generic:2:${capability}===\n🙂🙂\n`);
    const footer = `===COMMANDER:END:${capability}===\n`;
    for (const character of footer) scanner.feed(character);
    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted.mock.calls[0][0].content).toBe('🙂🙂');
  });

  it('drops over-budget content without emitting a partial frame and recovers at a real newline', () => {
    const emitted = vi.fn();
    const scanner = new ProtocolScanner(0, 'Synthetic', emitted, { maxContentBytes: 6000 });
    scanner.feed('===COMMANDER:SEND:generic:2===\n');
    scanner.feed('🙂'.repeat(1600));
    expect((scanner as any).bufferParts).toEqual([]);
    expect((scanner as any).contentLines).toEqual([]);
    // A marker-looking suffix of the rejected line must not become a header.
    scanner.feed('===COMMANDER:SEND:generic:2===\nnot a new frame\n===COMMANDER:END===\n');
    expect(emitted).not.toHaveBeenCalled();
    scanner.feed('===COMMANDER:SEND:generic:2===\nvalid\n===COMMANDER:END===\n');
    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted.mock.calls[0][0].content).toBe('valid');
  });

  it('bounds non-protocol unterminated output instead of treating a chunk edge as a line', () => {
    const emitted = vi.fn();
    const scanner = new ProtocolScanner(0, 'Synthetic', emitted);
    scanner.feed(`=== malformed ${'x'.repeat(5000)}`);
    for (let i = 0; i < 100; i++) scanner.feed('x'.repeat(1000));
    expect((scanner as any).bufferParts).toEqual([]);
    expect((scanner as any).contentLines).toEqual([]);
    scanner.feed('\n===COMMANDER:QUERY===\nping\n===COMMANDER:END===\n');
    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted.mock.calls[0][0].content).toBe('ping');
  });

  it('counts split UTF-16 surrogate pairs as their original UTF-8 bytes', () => {
    const emitted = vi.fn();
    const scanner = new ProtocolScanner(0, 'Synthetic', emitted, { maxContentBytes: 5 });
    scanner.feed('===COMMANDER:SEND:generic:2===\n\ud83d');
    scanner.feed('\ude42');
    expect((scanner as any).bufferBytes).toBe(4);
    scanner.feed('\n===COMMANDER:END===\n');
    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted.mock.calls[0][0].content).toBe('🙂');
  });

  it('counts only newly received bytes for adversarial one-character chunks', () => {
    const scanner = new ProtocolScanner(0, 'Synthetic', vi.fn());
    scanner.feed('===COMMANDER:SEND:generic:2===\n');
    const byteLength = vi.spyOn(Buffer, 'byteLength');
    try {
      for (let i = 0; i < 32768; i++) scanner.feed('x');
      expect((scanner as any).bufferBytes).toBe(32768);
      expect(byteLength.mock.calls.every(([text]) => typeof text === 'string' && text.length === 1)).toBe(true);
    } finally { byteLength.mockRestore(); }
  });
});
