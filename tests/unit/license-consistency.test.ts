import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => (
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
);

const mitTerms = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

describe('MIT source license', () => {
  it('includes the complete license and preserves the project copyright', () => {
    expect(read('LICENSE')).toBe(
      `MIT License\n\nCopyright (c) 2026 Lech Kalinowski\n\n${mitTerms}\n`,
    );
  });

  it('keeps root package metadata and distributable notices synchronized', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    expect(pkg.license).toBe('MIT');
    expect(lock.packages[''].license).toBe(pkg.license);
    expect(pkg.files).toContain('LICENSE');
    expect(pkg.files).toContain('THIRD_PARTY_NOTICES.md');
  });

  it.each([
    'README.md',
    'CONTRIBUTING.md',
    'docs/README.md',
    'docs/commander-protocol-commercial.md',
    'docs/commander-protocol-uniqueness-and-originality.md',
    'landing-page/index.html',
    'src/screen/dialog/welcome-dialog.ts',
  ])('identifies %s as current MIT source without commercial restrictions', (path) => {
    const content = read(path);
    expect(content).toContain('MIT License');
    expect(content).not.toMatch(/CC[- ]BY[- ]NC|source-available|NonCommercial/iu);
    expect(content).not.toContain('explicit written permission from the author');
  });

  it('distinguishes earlier releases and historical audits from current source', () => {
    const packageVersion = JSON.parse(read('package.json')).version as string;
    expect(read('README.md')).toContain(`Version ${packageVersion} uses MIT.`);
    expect(read('README.md')).toContain('Earlier published packages retain the license');
    expect(read('README.md')).toContain('does not relicense older artifacts');
    const audit = read('docs/documentation-audit-2026-09-02.md');
    expect(audit).toContain('License findings below also describe that historical baseline');
    expect(audit).toContain('[MIT License](../LICENSE)');
  });

  it('retains the FreeMicro attribution and complete third-party license', () => {
    const notices = read('THIRD_PARTY_NOTICES.md');
    const bridge = read('src/hardware/codex-micro-bridge.py');
    for (const content of [notices, bridge]) {
      expect(content).toContain('Copyright (c) 2026 Eli Benveniste');
      expect(content).toContain(mitTerms);
    }
    expect(notices).toContain('64258eb6cc3312a43f9f9f86d87e55e0b609ccc5');
  });
});
