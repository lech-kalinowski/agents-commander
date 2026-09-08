import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KNOWN_AGENTS } from '../../src/agents/types.js';
import { MAX_ACTIVE_PANELS } from '../../src/panel-limits.js';

const repositoryUrl = new URL('../../', import.meta.url);
const read = (relativePath: string): string => (
  fs.readFileSync(new URL(relativePath, repositoryUrl), 'utf8')
);
const readme = read('README.md');
const landing = read('landing-page/index.html');
const agentGuide = read('AGENTS.md');
const claudeGuide = read('CLAUDE.md');
const datasetGuide = read('docs/datasets.md');
const packageVersion = JSON.parse(read('package.json')).version as string;

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&mdash;', '—')
    .replaceAll('&nbsp;', ' ');
}

describe('versioned product documentation', () => {
  it('documents explicit source-only batch protocol setup separately from launch and active Ctrl+P', () => {
    expect(readme).toContain('### Enable protocol in many agents (source checkout)');
    expect(readme).toContain('F2 → P is a source addition after npm 0.1.5');
    expect(readme).toContain('Ctrl+P remains active-only');
    expect(readme).toContain('Already-enabled sessions are skipped without rotating their keys');
    expect(readme).toContain('empty, ready input prompt');
    expect(readme).toContain('Bulk launch does not send a task, bootstrap the protocol, or enable recording.');
    for (const guide of [agentGuide, claudeGuide, read('src/screen/dialog/help-dialog.ts'), read('src/screen/dialog/protocol-dialog.ts')]) {
      expect(guide).toContain('F2 then P');
      expect(guide).toContain('Ctrl+P');
    }
    expect(datasetGuide).toContain('never enables\n   capture itself');
  });

  it('documents the selected version and its install command separately from the legacy baseline', () => {
    for (const document of [readme, visibleText(landing), agentGuide, claudeGuide, datasetGuide]) {
      expect(document).toContain(packageVersion);
      expect(document).toContain('0.1.4');
      expect(document).toContain(`npm install -g agents-commander@${packageVersion}`);
      expect(document).toContain('Node.js 22+');
      expect(document).toContain('Python 3');
      expect(document).not.toContain('npm install -g agents-commander@0.1.4');
    }
    expect(readme).toContain('### Upgrading from 0.1.4');
    expect(visibleText(landing)).toContain('Upgrading from 0.1.4?');
    for (const document of [readme, visibleText(landing)]) {
      expect(document).not.toMatch(/(?:public npm is|release is still|npm latest[^\n]*)[^\n]*0\.1\.4/iu);
      expect(document).toContain('Node.js 18+');
      expect(document).toContain('MIT License');
      expect(document).toContain('F4 toggles fullscreen');
      expect(document).toContain('F9 closes a panel');
    }
  });

  it('keeps installed CLI and source-build launch instructions available', () => {
    expect(readme).toContain('### Current source version');
    expect(readme).toContain('node dist/bin/agents-commander.js --doctor .');
    expect(readme).toContain('node dist/bin/agents-commander.js --demo');
    expect(readme).toContain('npm run build');
    expect(visibleText(landing)).toContain('npm start -- --doctor .');
    expect(readme).toContain("BROADCAST's ACK reports queue admission only;");
    expect(readme).toContain('subsequent per-target delivery outcomes appear in F12 Activity.');
    expect(visibleText(landing)).not.toContain('respond to last sender');
    expect(visibleText(landing)).toContain('BROADCAST ACK reports queue admission');
    expect(visibleText(landing)).not.toContain('Sender gets ACK after delivery');
    for (const document of [readme, visibleText(landing)]) {
      expect(document).toContain('agents-commander --version');
      expect(document).toContain('agents-commander --doctor .');
      expect(document).toContain('agents-commander --demo');
    }
  });

  it('makes the packaged dataset guide usable without a source checkout', () => {
    for (const command of ['inspect', 'prepare', 'export', 'validate']) {
      expect(datasetGuide).toContain(`agents-commander dataset ${command} `);
      expect(datasetGuide).not.toContain(`npm start -- dataset ${command}`);
    }
    expect(datasetGuide).toContain('agents-commander --capture protocol --capture-project project-01');
    expect(datasetGuide).toContain('agents-commander --demo --capture protocol');
    expect(datasetGuide).toContain('node dist/bin/agents-commander.js');
    expect(datasetGuide).toContain('does **not** start recording by default');
    expect(datasetGuide).toContain('Do not bulk-approve real data without');
  });

  it('lists exactly the supported source adapters and keeps OpenCode out of future presets', () => {
    const supported = KNOWN_AGENTS.filter((agent) => agent.supported);
    expect(landing).toContain(`<h3>${supported.length} Supported Adapters</h3>`);
    const card = landing.match(/<h3>\d+ Supported Adapters<\/h3>\s*<p>([\s\S]*?)<\/p>/)?.[1];
    expect(card).toBeDefined();
    for (const agent of supported) expect(card).toContain(agent.name);
    const futurePresets = card?.split('additional presets')[1];
    expect(futurePresets).toBeDefined();
    expect(futurePresets).not.toContain('OpenCode');
    expect(futurePresets).toContain('Aider, Cline, Goose, Kiro, and Amp');
  });

  it('includes the same session capability in both landing-page format markers', () => {
    const format = landing.match(/<div class="flow-message-format">([\s\S]*?)<\/div>/)?.[1];
    expect(format).toBeDefined();
    const text = visibleText(format ?? '');
    expect(text).toContain('===COMMANDER:SEND:{target_agent}:{panel_number}:{session_key}===');
    expect(text).toContain('===COMMANDER:END:{session_key}===');
    expect(text).toContain('Ctrl+P');
    expect(text).toContain('Static or stale keys do not route');
  });

  it('keeps template totals aligned with the bundled files and category table', () => {
    const count = fs.readdirSync(new URL('src/templates/builtin/', repositoryUrl))
      .filter((file) => file.endsWith('.md')).length;
    expect(readme).toContain(`${count} built-in prompt templates`);
    expect(landing).toContain(`${count} Prompt Templates`);
    const categoryTotal = [...readme.matchAll(/^\| \*\*[^|]+\*\* \| (\d+) \|/gm)]
      .reduce((total, match) => total + Number(match[1]), 0);
    expect(categoryTotal).toBe(count);
    for (const document of [agentGuide, claudeGuide]) {
      expect(document).toContain(`${count} built-in prompt templates`);
    }
  });

  it('documents paged panel density, current navigation and the complete verification gate', () => {
    for (const document of [agentGuide, claudeGuide]) {
      expect(document).toContain(`${MAX_ACTIVE_PANELS} active panels`);
      expect(document).toContain('Shift+F4');
      expect(document).toContain('auto/2/3/4');
      expect(document).toContain('F11');
      expect(document).toContain('Shift+F12');
      expect(document).toContain('npm run verify');
      expect(document).not.toContain('Dual-panel terminal');
    }
  });

  it('distinguishes bounded diagnostics from opt-in capture and describes open reply windows', () => {
    expect(readme).toContain('latest open reply thread');
    expect(readme).toContain('newest open reply window');
    expect(readme).toContain('not a persistent archive');
    expect(readme).toContain('debug.log');
    expect(readme).toContain('**not implemented**');
    expect(landing).toContain('latest open reply window');
    expect(landing).toContain('not implemented');
    for (const document of [readme, landing, agentGuide, claudeGuide]) {
      expect(document).toContain('session-capture-plan.md');
      expect(document).toContain('datasets.md');
      expect(document).toMatch(/propos(?:al|ed)/i);
      expect(document).toContain('in-memory');
    }
  });

  it('ships QA guidance without claiming offline checks prove live providers or hardware', () => {
    const qa = read('docs/qa.md');
    const metadata = JSON.parse(read('package.json'));
    expect(metadata.files).toContain('docs/qa.md');
    expect(metadata.files).toContain('docs/README.md');
    expect(metadata.scripts.verify).toContain('npm run test:dev');
    expect(readme).toContain('docs/qa.md');
    expect(read('docs/README.md')).toContain('(qa.md)');
    expect(qa).toContain('not in npm 0.1.5');
    expect(qa).toContain('Manual acceptance');
    expect(qa).toContain('not real provider credentials or private captures');
    expect(qa).toContain('Existing captures/exports are **not**');
    expect(qa).toContain('physical USB/Bluetooth operation');
  });
});
