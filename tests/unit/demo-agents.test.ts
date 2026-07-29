import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDemoAgentLaunchSpec,
  DEMO_AGENT_ROLES,
  DEMO_AGENT_ROLE_ORDER,
} from '../../src/demo/demo-agents.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => (
      fs.rm(directory, { recursive: true, force: true })
    )),
  );
});

describe('demo agent launch specs', () => {
  it('resolves the source-layout asset with two stable role names', () => {
    expect(DEMO_AGENT_ROLE_ORDER).toEqual(['coordinator', 'reviewer']);
    expect(DEMO_AGENT_ROLES.coordinator.name).toBe('Demo Coordinator');
    expect(DEMO_AGENT_ROLES.reviewer.name).toBe('Demo Reviewer');

    const coordinator = createDemoAgentLaunchSpec('coordinator', {
      mode: 'source',
      sourceRoot: process.cwd(),
    });
    expect(coordinator).toEqual({
      name: 'Demo Coordinator',
      command: process.execPath,
      args: [
        path.resolve('src/demo/demo-agent.js'),
        '--role',
        'coordinator',
      ],
    });
  });

  it('resolves the installed dist asset layout', async () => {
    const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-assets-'));
    temporaryDirectories.push(packageRoot);
    const modulePath = path.join(packageRoot, 'dist', 'src', 'index.js');
    const assetPath = path.join(packageRoot, 'dist', 'demo', 'demo-agent.js');
    await fs.mkdir(path.dirname(modulePath), { recursive: true });
    await fs.mkdir(path.dirname(assetPath), { recursive: true });
    await fs.writeFile(modulePath, '');
    await fs.writeFile(assetPath, '#!/usr/bin/env node\n');

    const spec = createDemoAgentLaunchSpec('reviewer', {
      mode: 'installed',
      packageRoot,
    });
    expect(spec.args).toEqual([assetPath, '--role', 'reviewer']);
    expect(spec.name).toBe('Demo Reviewer');
  });

  it('fails closed when the bundled demo asset is unavailable', () => {
    expect(() => createDemoAgentLaunchSpec('coordinator', {
      mode: 'installed',
      packageRoot: path.join(os.tmpdir(), 'agents-commander-missing-package'),
    })).toThrow('Offline demo agent asset was not found');
  });
});
