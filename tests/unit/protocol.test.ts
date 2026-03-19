import { describe, it, expect, vi } from 'vitest';
import {
  ProtocolScanner,
  stripAnsi,
  buildProtocolInstructions,
  looksLikeInstructionEcho,
  normalizeMarkerLine,
  isReplyMarker,
  isEndMarker,
} from '../../src/orchestration/protocol.js';

describe('stripAnsi', () => {
  it('removes CSI color codes', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
  });

  it('removes cursor movement', () => {
    expect(stripAnsi('\x1b[5;10Hworld')).toBe('world');
  });

  it('removes OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text');
  });

  it('passes clean text through', () => {
    expect(stripAnsi('no escapes here')).toBe('no escapes here');
  });
});

describe('ProtocolScanner', () => {
  it('detects a complete SEND block', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Codex CLI', cb);

    scanner.feed(
      'Some agent output\n' +
      '===COMMANDER:SEND:claude:2===\n' +
      'Please review this code\n' +
      '===COMMANDER:END===\n' +
      'More output\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({
      type: 'send',
      sourcePanel: 0,
      sourceAgent: 'Codex CLI',
      targetAgent: 'claude',
      targetPanel: 1, // 2 in protocol → 1 internal (0-based)
      content: 'Please review this code',
    });
  });

  it('handles multi-line content', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(1, 'Claude Code', cb);

    scanner.feed(
      '===COMMANDER:SEND:codex:1===\n' +
      'Line 1\n' +
      'Line 2\n' +
      'Line 3\n' +
      '===COMMANDER:END===\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].content).toBe('Line 1\nLine 2\nLine 3');
    expect(cb.mock.calls[0][0].targetAgent).toBe('codex');
    expect(cb.mock.calls[0][0].targetPanel).toBe(0);
  });

  it('handles streamed chunks (data split across feeds)', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.feed('===COMMANDER:SEND:gemini:3===\n');
    scanner.feed('task part 1\n');
    scanner.feed('task part 2\n');
    scanner.feed('===COMMANDER:END===\n');

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].content).toBe('task part 1\ntask part 2');
    expect(cb.mock.calls[0][0].targetAgent).toBe('gemini');
    expect(cb.mock.calls[0][0].targetPanel).toBe(2);
  });

  it('detects a start marker split across chunk boundaries', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    // Marker must be on its own line (anchored regex), but chunks can split mid-marker
    scanner.feed('normal output\n');
    scanner.feed('===COMMAND');
    scanner.feed('ER:SEND:claude:2===\n');
    scanner.feed('review this\n');
    scanner.feed('===COMMANDER:END===\n');

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].targetAgent).toBe('claude');
    expect(cb.mock.calls[0][0].targetPanel).toBe(1);
    expect(cb.mock.calls[0][0].content).toBe('review this');
  });

  it('ignores text outside protocol blocks', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.feed('regular output\nmore output\n');

    expect(cb).not.toHaveBeenCalled();
  });

  it('handles ANSI codes mixed with protocol markers', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.feed(
      '\x1b[32m===COMMANDER:SEND:claude:1===\x1b[0m\n' +
      '\x1b[1mdo something\x1b[0m\n' +
      '\x1b[32m===COMMANDER:END===\x1b[0m\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].content).toBe('do something');
  });

  it('detects multiple blocks in sequence', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.feed(
      '===COMMANDER:SEND:claude:1===\ntask 1\n===COMMANDER:END===\n' +
      'gap\n' +
      '===COMMANDER:SEND:codex:2===\ntask 2\n===COMMANDER:END===\n',
    );

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[0][0].targetAgent).toBe('claude');
    expect(cb.mock.calls[0][0].content).toBe('task 1');
    expect(cb.mock.calls[1][0].targetAgent).toBe('codex');
    expect(cb.mock.calls[1][0].content).toBe('task 2');
  });

  it('ignores unknown agent types', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.feed(
      '===COMMANDER:SEND:not-an-agent:1===\n' +
      'task\n' +
      '===COMMANDER:END===\n',
    );

    expect(cb).not.toHaveBeenCalled();
  });

  it('detects a REPLY block', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(1, 'Codex CLI', cb);

    scanner.feed(
      '===COMMANDER:REPLY===\n' +
      'Here are the results\n' +
      '===COMMANDER:END===\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].type).toBe('reply');
    expect(cb.mock.calls[0][0].sourcePanel).toBe(1);
    expect(cb.mock.calls[0][0].content).toBe('Here are the results');
  });

  it('detects marker lines prefixed by an agent UI bullet', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(1, 'Codex CLI', cb);

    scanner.feed(
      '●===COMMANDER:REPLY===\n' +
      'Reply body\n' +
      '●===COMMANDER:END===\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0]).toMatchObject({
      type: 'reply',
      sourcePanel: 1,
      sourceAgent: 'Codex CLI',
      content: 'Reply body',
    });
  });

  it('detects marker lines prefixed by Gemini-style sparkle bullets', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(2, 'Gemini CLI', cb);

    scanner.feed(
      '✦ ===COMMANDER:REPLY===\n' +
      'GEMINI_SMOKE_OK\n' +
      '✦ ===COMMANDER:END===\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0]).toMatchObject({
      type: 'reply',
      sourcePanel: 2,
      sourceAgent: 'Gemini CLI',
      content: 'GEMINI_SMOKE_OK',
    });
  });

  it('detects marker lines with a short stray wrapped capital before the marker', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Claude Code', cb);

    scanner.feed(
      '⏺T===COMMANDER:QUERY===\n' +
      'agents\n' +
      '⏺T===COMMANDER:END===\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0]).toMatchObject({
      type: 'query',
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      content: 'agents',
    });
  });

  it('detects a BROADCAST block', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Claude Code', cb);

    scanner.feed(
      '===COMMANDER:BROADCAST===\n' +
      'Everyone begin phase 2\n' +
      '===COMMANDER:END===\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].type).toBe('broadcast');
    expect(cb.mock.calls[0][0].content).toBe('Everyone begin phase 2');
  });

  it('detects a STATUS block', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Claude Code', cb);

    scanner.feed(
      '===COMMANDER:STATUS===\n' +
      'Analyzing file 5 of 10\n' +
      '===COMMANDER:END===\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].type).toBe('status');
    expect(cb.mock.calls[0][0].content).toBe('Analyzing file 5 of 10');
  });

  it('detects a QUERY block', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Claude Code', cb);

    scanner.feed(
      '===COMMANDER:QUERY===\n' +
      'agents\n' +
      '===COMMANDER:END===\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].type).toBe('query');
    expect(cb.mock.calls[0][0].content).toBe('agents');
  });
});

describe('marker helpers', () => {
  it('removes supported UI prefixes before matching markers', () => {
    expect(normalizeMarkerLine('  ●===COMMANDER:QUERY===')).toBe('===COMMANDER:QUERY===');
    expect(normalizeMarkerLine('│ ===COMMANDER:QUERY===')).toBe('===COMMANDER:QUERY===');
    expect(normalizeMarkerLine('┃ ===COMMANDER:QUERY===')).toBe('===COMMANDER:QUERY===');
    expect(isReplyMarker('• ===COMMANDER:REPLY===')).toBe(true);
    expect(isReplyMarker('║ ===COMMANDER:REPLY===')).toBe(true);
    expect(isReplyMarker('✦ ===COMMANDER:REPLY===')).toBe(true);
    expect(isEndMarker('▸ ===COMMANDER:END===')).toBe(true);
    expect(isEndMarker('╽ ===COMMANDER:END===')).toBe(true);
    expect(isEndMarker('✦ ===COMMANDER:END===')).toBe(true);
  });

  it('does not treat markdown blockquotes as marker prefixes', () => {
    expect(normalizeMarkerLine('> ===COMMANDER:QUERY===')).toBe('> ===COMMANDER:QUERY===');
    expect(isReplyMarker('> ===COMMANDER:REPLY===')).toBe(false);
    expect(isEndMarker('> ===COMMANDER:END===')).toBe(false);
  });

  it('does not treat markdown bullets as prefixes', () => {
    expect(normalizeMarkerLine('* ===COMMANDER:SEND:claude:1===')).toBe('* ===COMMANDER:SEND:claude:1===');
    expect(normalizeMarkerLine('- ===COMMANDER:END===')).toBe('- ===COMMANDER:END===');
  });
});

describe('ProtocolScanner mute/unmute', () => {
  it('mute() extends but does not shorten an active mute', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    // Long mute first
    scanner.mute(10000);
    expect(scanner.isMuted).toBe(true);

    // Shorter mute should NOT shorten the existing one
    scanner.mute(1);
    expect(scanner.isMuted).toBe(true);

    // Feed should still be suppressed
    scanner.feed('===COMMANDER:SEND:claude:1===\nhello\n===COMMANDER:END===\n');
    expect(cb).not.toHaveBeenCalled();
  });

  it('unmute() force-cancels any active mute', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.mute(60000); // mute for 60s
    expect(scanner.isMuted).toBe(true);

    scanner.unmute(); // force cancel
    expect(scanner.isMuted).toBe(false);

    // Should now detect messages
    scanner.feed('===COMMANDER:SEND:claude:1===\nhello\n===COMMANDER:END===\n');
    expect(cb).toHaveBeenCalledOnce();
  });

  it('mute(0) does not shorten an existing mute', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.mute(10000);
    scanner.mute(0); // should NOT unmute — mute() is extend-only
    expect(scanner.isMuted).toBe(true);

    scanner.feed('===COMMANDER:SEND:claude:1===\nhello\n===COMMANDER:END===\n');
    expect(cb).not.toHaveBeenCalled();
  });

  it('feedLine() respects mute', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.mute(10000);
    scanner.feedLine('===COMMANDER:SEND:claude:1===');
    scanner.feedLine('hello');
    scanner.feedLine('===COMMANDER:END===');
    expect(cb).not.toHaveBeenCalled();

    scanner.unmute();
    scanner.feedLine('===COMMANDER:SEND:claude:1===');
    scanner.feedLine('hello');
    scanner.feedLine('===COMMANDER:END===');
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe('ProtocolScanner edge cases', () => {
  it('ignores incomplete blocks (no END marker)', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.feed('===COMMANDER:SEND:claude:1===\nhello\n');
    // No END marker — should not emit

    expect(cb).not.toHaveBeenCalled();
  });

  it('handles empty content between markers', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.feed('===COMMANDER:SEND:claude:1===\n===COMMANDER:END===\n');

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].content).toBe('');
  });

  it('rejects invalid panel numbers', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    // Panel 0 (zero-based would be -1) and panel 5 (> max 4)
    scanner.feed('===COMMANDER:SEND:claude:0===\nhello\n===COMMANDER:END===\n');
    scanner.feed('===COMMANDER:SEND:claude:5===\nhello\n===COMMANDER:END===\n');

    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores nested start markers inside a collecting block', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.feed(
      '===COMMANDER:SEND:claude:1===\n' +
      'Use this format:\n' +
      '===COMMANDER:SEND:codex:2===\n' +  // nested — treated as content
      'Example message\n' +
      '===COMMANDER:END===\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    // The nested start marker becomes content, first END closes the outer block
    expect(cb.mock.calls[0][0].targetAgent).toBe('claude');
    expect(cb.mock.calls[0][0].content).toContain('===COMMANDER:SEND:codex:2===');
  });

  it('handles markers with extra = signs (lenient parsing)', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.feed(
      '=====COMMANDER:SEND:claude:1=====\n' +
      'lenient\n' +
      '=====COMMANDER:END=====\n',
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].content).toBe('lenient');
  });

  it('ignores markers with surrounding prose', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.feed(
      'Okay, sending now: ===COMMANDER:SEND:claude:1===\n' +
      'content here\n' +
      'Done! ===COMMANDER:END===\n',
    );

    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores markers wrapped in markdown emphasis', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    scanner.feed(
      '**===COMMANDER:SEND:claude:1===**\n' +
      'bold content\n' +
      '**===COMMANDER:END===**\n',
    );

    expect(cb).not.toHaveBeenCalled();
  });

  it('drops collection after 500 lines (safety limit)', () => {
    const cb = vi.fn();
    const scanner = new ProtocolScanner(0, 'Test', cb);

    let payload = '===COMMANDER:SEND:claude:1===\n';
    for (let i = 0; i < 501; i++) {
      payload += `line ${i}\n`;
    }
    payload += '===COMMANDER:END===\n';

    scanner.feed(payload);

    // Should NOT emit — collection was abandoned at 500 lines
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('buildProtocolInstructions', () => {
  it('includes agent name and panel', () => {
    const text = buildProtocolInstructions(0, 'Claude Code', []);
    expect(text).toContain('Claude Code');
    expect(text).toContain('Panel 1');
  });

  it('lists other running agents', () => {
    const text = buildProtocolInstructions(0, 'Claude Code', [
      { name: 'Codex CLI', type: 'codex', panel: 1 },
    ]);
    expect(text).toContain('Codex CLI');
    expect(text).toContain('Panel 2');
  });

  it('does not include literal parseable protocol markers in the instructions', () => {
    const text = buildProtocolInstructions(0, 'Claude Code', []);
    expect(text).not.toContain('===COMMANDER:SEND:');
    expect(text).not.toContain('===COMMANDER:REPLY===');
    expect(text).not.toContain('===COMMANDER:BROADCAST===');
    expect(text).not.toContain('===COMMANDER:STATUS===');
    expect(text).not.toContain('===COMMANDER:QUERY===');
    expect(text).not.toContain('===COMMANDER:END===');
    expect(text).toContain('three "=" + "COMMANDER:SEND:<type>:<panel>" + three "="');
  });
});

describe('looksLikeInstructionEcho', () => {
  it('detects echoed Commander instruction text', () => {
    expect(looksLikeInstructionEcho(
      `[Agents Commander] You are Gemini CLI in Panel 3.\n` +
      `To message another agent, output a 3-line block.\n` +
      `===COMMANDER:QUERY===\n` +
      `Query values: agents, panels, status, help, ping\n`,
    )).toBe(true);
  });

  it('does not flag ordinary collaboration text', () => {
    expect(looksLikeInstructionEcho('Reply with GEMINI_SMOKE_OK using REPLY only.')).toBe(false);
  });
});
