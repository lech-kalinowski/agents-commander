import { describe, expect, it } from 'vitest';
import { classicBlue, getTheme, midnight } from '../../src/config/themes.js';

describe('theme lookup', () => {
  it('resolves the supported themes', () => {
    expect(getTheme('classic-blue')).toBe(classicBlue);
    expect(getTheme('midnight')).toBe(midnight);
  });

  it.each(['missing-theme', '__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'falls back safely for an unknown theme: %s', (name) => {
      expect(getTheme(name)).toBe(classicBlue);
    },
  );
});
