/** Default emoji and explicit emoji presentation occupy two terminal cells. */
export function isWideEmoji(text: string): boolean {
  const codePoint = text.codePointAt(0);
  if (codePoint === undefined) return false;
  const base = String.fromCodePoint(codePoint);
  return /\p{Emoji_Presentation}/u.test(base)
    || (text.startsWith(base + '\uFE0F') && /\p{Extended_Pictographic}/u.test(base));
}
