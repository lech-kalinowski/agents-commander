import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('opt-in live APEX acceptance guard', () => {
  it.each([undefined, '', '0', 'true'])('does not import the app or start providers without exact consent: %s', (consent) => {
    const env = { ...process.env, COMMANDER_QA_PACKAGE_ROOT: '/nonexistent/never-import-this-package' };
    delete env.COMMANDER_LIVE_APEX;
    if (consent !== undefined) env.COMMANDER_LIVE_APEX = consent;
    const result = spawnSync(process.execPath, [path.resolve('tests/live/opencode-communication.mjs')], {
      env, encoding: 'utf8', timeout: 5000,
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe('Live APEX QA is disabled. Set COMMANDER_LIVE_APEX=1 only with provider-use authorization.');
  });
});
