import { describe, expect, it, vi } from 'vitest';
import { buildShellLaunchSpec } from '../../src/utils/shell-launch.js';

describe('plain terminal shell selection', () => {
  it('starts the explicit shell interactively without commands or login flags', () => {
    expect(buildShellLaunchSpec('/bin/zsh', () => '/bin/bash', value => value)).toEqual({
      label: 'Shell (zsh)', command: '/bin/zsh', args: ['-i'],
    });
  });

  it.each(['bash', './shell', '/missing', '/bin/zsh -c echo', '/bin/sh\nwhoami'])(
    'falls back to the account shell for unusable SHELL %j', preferred => {
      const resolve = vi.fn(value => value === '/bin/bash' ? value : null);
      expect(buildShellLaunchSpec(preferred, () => '/bin/bash', resolve).command).toBe('/bin/bash');
      expect(resolve).not.toHaveBeenCalledWith('bash');
      expect(resolve).not.toHaveBeenCalledWith('./shell');
    },
  );

  it('uses /bin/sh when the account has no shell or passwd entry', () => {
    expect(buildShellLaunchSpec('', () => { throw new Error('missing'); }, value => value).command).toBe('/bin/sh');
    expect(buildShellLaunchSpec('', () => null, value => value).command).toBe('/bin/sh');
  });

  it('passes executable paths containing spaces as one argument, not shell code', () => {
    expect(buildShellLaunchSpec('/opt/My Shell/zsh', () => null, value => value).command).toBe('/opt/My Shell/zsh');
  });

  it('fails visibly if no shell exists', () => {
    expect(() => buildShellLaunchSpec('', () => null, () => null)).toThrow('No executable shell');
  });
});
