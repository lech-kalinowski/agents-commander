import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  bindOverlayResize,
  calculateOverlayGeometry,
  truncateOverlayText,
} from '../../src/screen/dialog/geometry.js';

describe('overlay geometry', () => {
  it('keeps a preferred dialog inside an 80x24 terminal', () => {
    expect(calculateOverlayGeometry(80, 24, 80, 42)).toEqual({
      width: 78,
      height: 22,
      compact: true,
    });
  });

  it('degrades safely inside a 60x20 terminal', () => {
    const geometry = calculateOverlayGeometry(60, 20, 70, 28);
    expect(geometry.width).toBe(58);
    expect(geometry.height).toBe(18);
    expect(geometry.compact).toBe(true);
  });

  it('normalizes invalid dimensions and never returns zero', () => {
    const geometry = calculateOverlayGeometry(0, Number.NaN, 0, -4);
    expect(geometry.width).toBeGreaterThan(0);
    expect(geometry.height).toBeGreaterThan(0);
  });

  it('normalizes and bounds long overlay text', () => {
    expect(truncateOverlayText(' a   b  c ', 5)).toBe('a b c');
    expect(truncateOverlayText('abcdefgh', 5)).toBe('abcd…');
    expect(truncateOverlayText('safe\x1b[31m\ntext', 40)).toBe('safe [31m text');
  });

  it('updates active overlays and removes the resize listener on cleanup', () => {
    const screen = new EventEmitter() as any;
    screen.width = 80;
    screen.height = 24;
    const element: any = {};

    const unbind = bindOverlayResize(screen, element, 70, 28);
    expect(screen.listenerCount('resize')).toBe(1);
    expect(element).toMatchObject({ width: 70, height: 22 });

    screen.width = 60;
    screen.height = 20;
    screen.emit('resize');
    expect(element).toMatchObject({ width: 58, height: 18 });

    unbind();
    expect(screen.listenerCount('resize')).toBe(0);
  });
});
