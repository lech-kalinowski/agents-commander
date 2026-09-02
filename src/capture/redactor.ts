// A default 256 KiB protocol body gains a Commander forwarding envelope on input.
export const MAX_CAPTURE_CONTENT_BYTES = 512 * 1024;
const MAX_LITERALS = 512;
const MAX_LITERAL_BYTES = 64 * 1024;

interface Match { length: number; replacement: string; rule: string }
interface TrieNode { next: Map<string, TrieNode>; terminal?: Match; output?: Match; failure?: TrieNode }

/** Bounded literal trie: no user-supplied regular expressions are evaluated. */
export class CaptureRedactor {
  private root: TrieNode = { next: new Map() };
  private literals = new Set<string>();
  private literalBytes = 0;
  private prepared = false;

  constructor(secrets: readonly string[] = []) {
    if (!Array.isArray(secrets) || secrets.length > 64) throw new Error('Too many capture redaction literals');
    for (const secret of secrets) this.addLiteral(secret, '[REDACTED:secret]', 'known_secret');
  }

  addLiteral(value: string, replacement: string, rule: string): void {
    if (typeof value !== 'string' || value.length < 4 || value.length > 512) {
      throw new Error('Capture redaction literals must contain 4–512 characters');
    }
    if (this.literals.has(value)) return;
    const bytes = Buffer.byteLength(value);
    if (this.literals.size >= MAX_LITERALS || this.literalBytes + bytes > MAX_LITERAL_BYTES) {
      throw new Error('Capture redaction dictionary is full');
    }
    this.literals.add(value);
    this.literalBytes += bytes;
    let node = this.root;
    for (const character of value) {
      let child = node.next.get(character);
      if (!child) { child = { next: new Map() }; node.next.set(character, child); }
      node = child;
    }
    node.terminal = { length: [...value].length, replacement, rule };
    this.prepared = false;
  }

  private prepare(): void {
    if (this.prepared) return;
    // Aho-Corasick failure links avoid rescanning 512-character near-matches
    // at every character. Stop at the first complete literal and resume after
    // it: overlapping secrets may be partly replaced, but no full match survives.
    const queue: TrieNode[] = [];
    this.root.failure = this.root;
    for (const child of this.root.next.values()) { child.failure = this.root; child.output = child.terminal; queue.push(child); }
    for (let index = 0; index < queue.length; index++) {
      const parent = queue[index];
      for (const [character, child] of parent.next) {
        let fallback = parent.failure!;
        while (fallback !== this.root && !fallback.next.has(character)) fallback = fallback.failure!;
        child.failure = fallback.next.get(character) ?? this.root;
        child.output = child.terminal ?? child.failure.output;
        queue.push(child);
      }
    }
    this.prepared = true;
  }

  redact(content: string): { content: string; redactions: Record<string, number> } {
    if (content.length > MAX_CAPTURE_CONTENT_BYTES || Buffer.byteLength(content) > MAX_CAPTURE_CONTENT_BYTES) {
      throw new Error('Capture content exceeds its limit');
    }
    const redactions: Record<string, number> = {};
    const count = (rule: string) => { redactions[rule] = (redactions[rule] ?? 0) + 1; };
    const characters = [...content];
    const output: string[] = [];
    this.prepare();
    let node = this.root;
    let unflushed = 0;
    for (let i = 0; i < characters.length; i++) {
      while (node !== this.root && !node.next.has(characters[i])) node = node.failure!;
      node = node.next.get(characters[i]) ?? this.root;
      if (node.output) {
        const start = i + 1 - node.output.length;
        output.push(characters.slice(unflushed, start).join(''), node.output.replacement);
        count(node.output.rule); unflushed = i + 1; node = this.root;
      }
    }
    output.push(characters.slice(unflushed).join(''));
    let text = output.join('');
    const replace = (pattern: RegExp, replacement: string, rule: string) => {
      text = text.replace(pattern, () => { count(rule); return replacement; });
    };
    // Covers capability-bearing headers/footers even if the key was not bound here.
    text = text.replace(/(COMMANDER:(?:SEND:[A-Za-z0-9_]{1,32}:[0-9]{1,16}|REPLY|BROADCAST|STATUS|QUERY|END):)([A-Za-z0-9_-]{32,64})(={3})/gu,
      (_match, prefix: string, _key: string, suffix: string) => {
        count('marker_capability'); return `${prefix}[REDACTED:capability]${suffix}`;
      });
    // Avoid an unbounded lazy regex: repeated unterminated BEGIN lines must
    // not turn redaction into quadratic work on the terminal routing thread.
    const privateHeader = /-----BEGIN ([A-Z0-9 ]{0,32})PRIVATE KEY-----/gu;
    let header: RegExpExecArray | null;
    let previousEnd = 0;
    const privateParts: string[] = [];
    while ((header = privateHeader.exec(text))) {
      privateParts.push(text.slice(previousEnd, header.index), '[REDACTED:private_key]');
      count('private_key');
      const footer = `-----END ${header[1]}PRIVATE KEY-----`;
      const footerStart = text.indexOf(footer, privateHeader.lastIndex);
      previousEnd = footerStart < 0 ? text.length : footerStart + footer.length;
      privateHeader.lastIndex = previousEnd;
      if (footerStart < 0) break;
    }
    if (privateParts.length) text = privateParts.join('') + text.slice(previousEnd);
    replace(/\b(?:sk-[A-Za-z0-9_-]{16,256}|gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|AKIA[A-Z0-9]{16})\b/gu, '[REDACTED:token]', 'token');
    replace(/\bBearer[ \t]+[A-Za-z0-9._~+/-]{8,512}={0,2}/giu, 'Bearer [REDACTED:token]', 'bearer');
    text = text.replace(/\b(password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)[ \t]*[:=][ \t]*["']?[^\s"',;]{1,512}/giu,
      (_match, label: string) => { count('credential_assignment'); return `${label}=[REDACTED:secret]`; });
    replace(/\/(?:Users|home)\/[^\s/]{1,128}(?:\/[^\s"'<>]{0,512})?/gu, '[REDACTED:home_path]', 'home_path');
    replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, '[CONTROL]', 'terminal_control');
    return { content: text, redactions };
  }
}
