import blessed from 'blessed';

/**
 * Show a brief notification message that auto-dismisses.
 */
export function showToast(
  screen: blessed.Widgets.Screen,
  message: string,
  durationMs = 2000,
): void {
  const toast = blessed.box({
    parent: screen,
    top: 0,
    right: 0,
    width: message.length + 4,
    height: 3,
    border: { type: 'line' },
    style: {
      bg: 'green',
      fg: 'black',
      border: { fg: 'green' },
    },
    tags: true,
    content: ` ${message} `,
  });

  screen.render();

  setTimeout(() => {
    toast.destroy();
    screen.render();
  }, durationMs);
}

export function showErrorToast(
  screen: blessed.Widgets.Screen,
  message: string,
  durationMs = 3000,
): void {
  const toast = blessed.box({
    parent: screen,
    top: 0,
    right: 0,
    width: message.length + 4,
    height: 3,
    border: { type: 'line' },
    style: {
      bg: 'red',
      fg: 'white',
      border: { fg: 'red' },
    },
    tags: true,
    content: ` ${message} `,
  });

  screen.render();

  setTimeout(() => {
    toast.destroy();
    screen.render();
  }, durationMs);
}
