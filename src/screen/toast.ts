import blessed from 'blessed';
import { bindOverlayResize, screenGeometry, truncateOverlayText } from './dialog/geometry.js';

/**
 * Show a brief notification message that auto-dismisses.
 */
export function showToast(
  screen: blessed.Widgets.Screen,
  message: string,
  durationMs = 2000,
): void {
  const safeMessage = truncateOverlayText(message, 240);
  const preferredWidth = Math.min(72, Math.max(20, safeMessage.length + 4));
  const geometry = screenGeometry(screen, preferredWidth, 3, { minWidth: 10, minHeight: 3 });
  const toast = blessed.box({
    parent: screen,
    top: 0,
    left: Math.max(0, (screen.width as number) - geometry.width),
    width: geometry.width,
    height: geometry.height,
    border: { type: 'line' },
    style: {
      bg: 'green',
      fg: 'black',
      border: { fg: 'green' },
    },
    tags: false,
    wrap: false,
    content: ` ${safeMessage} `,
  });
  const unbindResize = bindOverlayResize(
    screen,
    toast,
    preferredWidth,
    3,
    undefined,
    { minWidth: 10, minHeight: 3, position: 'top-right' },
  );

  screen.render();

  setTimeout(() => {
    unbindResize();
    toast.destroy();
    screen.render();
  }, durationMs);
}

export function showErrorToast(
  screen: blessed.Widgets.Screen,
  message: string,
  durationMs = 3000,
): void {
  const safeMessage = truncateOverlayText(message, 240);
  const preferredWidth = Math.min(72, Math.max(20, safeMessage.length + 4));
  const geometry = screenGeometry(screen, preferredWidth, 3, { minWidth: 10, minHeight: 3 });
  const toast = blessed.box({
    parent: screen,
    top: 0,
    left: Math.max(0, (screen.width as number) - geometry.width),
    width: geometry.width,
    height: geometry.height,
    border: { type: 'line' },
    style: {
      bg: 'red',
      fg: 'white',
      border: { fg: 'red' },
    },
    tags: false,
    wrap: false,
    content: ` ${safeMessage} `,
  });
  const unbindResize = bindOverlayResize(
    screen,
    toast,
    preferredWidth,
    3,
    undefined,
    { minWidth: 10, minHeight: 3, position: 'top-right' },
  );

  screen.render();

  setTimeout(() => {
    unbindResize();
    toast.destroy();
    screen.render();
  }, durationMs);
}
