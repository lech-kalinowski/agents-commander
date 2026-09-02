import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('brand assets', () => {
  for (const name of ['logo.png', 'logo-wordmark.png']) {
    it(`keeps the standalone landing-page copy of ${name} synchronized`, () => {
      const source = readFileSync(new URL(`../../assets/${name}`, import.meta.url));
      const landing = readFileSync(new URL(`../../landing-page/${name}`, import.meta.url));
      expect(source.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(landing.equals(source)).toBe(true);
    });
  }

  it('uses the local current mark and includes it in future packages', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(readme).toContain('src="assets/logo.png"');
    expect(readme).not.toContain('blob/main/assets/logo.png');
    expect(pkg.files).toContain('assets/logo.png');
    expect(pkg.files).toContain('assets/logo-wordmark.png');
  });

  it('uses the standalone local mark for the favicon, navigation and hero', () => {
    const landing = readFileSync(new URL('../../landing-page/index.html', import.meta.url), 'utf8');
    expect(landing).toMatch(/<link\s+rel="icon"\s+type="image\/png"\s+href="logo\.png"\s*>/u);
    const marks = landing.match(/<img\b[^>]*\bsrc="logo\.png"[^>]*>/gu) ?? [];
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(mark).toContain('class="commander-mark"');
      expect(mark).toMatch(/\balt="Agents Commander[^"]*"/u);
    }
    expect(landing).toMatch(/\.commander-mark\s*\{\s*image-rendering:\s*pixelated;/u);
    expect(landing).not.toContain('../assets/logo.png');
  });
});
