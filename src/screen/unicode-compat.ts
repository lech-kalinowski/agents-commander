import blessed from 'blessed';
import { isWideEmoji } from '../utils/emoji-width.js';

const installed = Symbol.for('agents-commander.blessed-emoji-width');
interface BlessedUnicode {
  charWidth: (text: string | number, index?: number) => number;
  chars: { all: RegExp; wide: RegExp };
  [installed]?: boolean;
}

/** Keep Blessed's cell allocation and incremental paint cursor in agreement. */
export function ensureBlessedEmojiWidth(): void {
  const unicode = (blessed as unknown as { unicode?: BlessedUnicode }).unicode;
  if (!unicode?.chars?.wide || unicode[installed]) return;
  const originalWidth = unicode.charWidth;
  unicode.charWidth = (text, index = 0) => {
    const suffix = typeof text === 'number' ? String.fromCodePoint(text) : text.slice(index);
    return isWideEmoji(suffix) ? 2 : originalWidth(text, index);
  };
  // Blessed inserts a continuation cell with $1. Unicode-mode matching needs
  // code-point CJK ranges rather than its original UTF-16 surrogate regex.
  unicode.chars.all = new RegExp(`(${unicode.chars.wide.source}`
    + '|[\\u{20000}-\\u{2fffd}\\u{30000}-\\u{3fffd}]'
    + '|\\p{Extended_Pictographic}\\uFE0F|\\p{Emoji_Presentation})', 'gu');
  unicode[installed] = true;
}
