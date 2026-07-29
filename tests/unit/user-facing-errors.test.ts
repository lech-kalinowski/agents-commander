import { describe, expect, it } from 'vitest';
import { formatUserError, sanitizeUserText } from '../../src/utils/user-facing-errors.js';

describe('sanitizeUserText', () => {
  it('removes terminal control characters and bounds output', () => {
    const result = sanitizeUserText(`bad\x1b[31m\n${'x'.repeat(250)}`, 30);

    expect(result).not.toContain('\x1b');
    expect(result).not.toContain('\n');
    expect(result.length).toBeLessThanOrEqual(30);
  });
});

describe('formatUserError', () => {
  it.each([
    ['EEXIST', 'destination already exists'],
    ['EACCES', 'permission denied'],
    ['EPERM', 'permission denied'],
    ['ENOENT', 'no longer exists'],
    ['ENOSPC', 'not enough disk space'],
    ['EXDEV', 'cross-filesystem move canceled because metadata cannot be preserved'],
  ])('maps %s to a concise message', (code, expected) => {
    expect(formatUserError('Copy', { code })).toContain(expected);
  });

  it('includes bounded partial batch progress', () => {
    const message = formatUserError('Move', {
      code: 'EIO',
      message: 'disk failure',
      completed: 2,
      total: 5,
    });

    expect(message).toBe('Move failed (2/5 completed): disk failure');
  });

  it('shows a bounded recovery path even when the error code has a friendly mapping', () => {
    const recoveryPath = `/workspace/.agents-commander-move-safe/${'x'.repeat(300)}`;
    const message = formatUserError('Move', {
      code: 'EEXIST',
      recoveryPath,
    });

    expect(message).toContain('destination already exists');
    expect(message).toContain('Original retained at: /workspace/.agents-commander-move-safe/');
    expect(message.length).toBeLessThanOrEqual(420);
  });
});
