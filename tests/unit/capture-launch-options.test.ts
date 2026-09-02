import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCaptureLaunchOptions } from '../../src/config/capture-launch-options.js';

describe('launch-only capture consent', () => {
  it('defaults to off and accepts explicit off without any filesystem access', () => {
    expect(resolveCaptureLaunchOptions({}, '/project')).toEqual({ mode: 'off', projectId: 'disabled' });
    expect(resolveCaptureLaunchOptions({ capture: 'off' }, '/project').mode).toBe('off');
  });

  it('requires an explicit mode and opaque, reusable project grouping', () => {
    expect(() => resolveCaptureLaunchOptions({ captureProject: 'p1' }, '/project')).toThrow('require --capture');
    for (const capture of ['true', 'transcript', 'all', 'Protocol']) {
      expect(() => resolveCaptureLaunchOptions({ capture }, '/project')).toThrow('Invalid capture mode');
    }
    for (const captureProject of [undefined, '', '/private/repo', '../p1', 'x'.repeat(65), 'my project']) {
      expect(() => resolveCaptureLaunchOptions({ capture: 'protocol', captureProject }, '/project')).toThrow('opaque project-family');
    }
    expect(resolveCaptureLaunchOptions({ capture: 'protocol', captureProject: 'p_01' }, '/project'))
      .toEqual({ mode: 'protocol', projectId: 'p_01', rootDirectory: undefined });
  });

  it('keeps explicit capture roots outside the working project', () => {
    for (const captureDir of ['/project', '/project/captures', '/project/x/../captures']) {
      expect(() => resolveCaptureLaunchOptions({ capture: 'metadata', captureProject: 'p1', captureDir }, '/project'))
        .toThrow('outside the working project');
    }
    expect(resolveCaptureLaunchOptions({ capture: 'protocol', captureProject: 'p1', captureDir: '/recordings' }, '/project').rootDirectory)
      .toBe('/recordings');
  });

  it('checks real checkout locations and the effective default capture root', () => {
    const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'commander-capture-launch-')));
    try {
      const project = path.join(temporary, 'project');
      const alias = path.join(temporary, 'alias');
      fs.mkdirSync(project);
      fs.symlinkSync(project, alias, 'dir');
      expect(() => resolveCaptureLaunchOptions({ capture: 'protocol', captureProject: 'p1', captureDir: path.join(project, 'private') }, alias))
        .toThrow('outside the working project');
      const homeLookup = vi.spyOn(os, 'homedir').mockReturnValue(project);
      try {
        expect(() => resolveCaptureLaunchOptions({ capture: 'protocol', captureProject: 'p1' }, project))
          .toThrow('outside the working project');
      } finally { homeLookup.mockRestore(); }
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});
