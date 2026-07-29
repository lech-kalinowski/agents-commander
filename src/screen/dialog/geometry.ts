import type blessed from 'blessed';

export interface OverlayGeometry {
  width: number;
  height: number;
  compact: boolean;
}

interface GeometryOptions {
  margin?: number;
  minWidth?: number;
  minHeight?: number;
  position?: 'center' | 'top-right';
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
}

export function calculateOverlayGeometry(
  screenWidth: number,
  screenHeight: number,
  preferredWidth: number,
  preferredHeight: number,
  options: GeometryOptions = {},
): OverlayGeometry {
  const margin = Math.max(0, Math.floor(options.margin ?? 1));
  const availableWidth = Math.max(1, positiveInteger(screenWidth, 80) - margin * 2);
  const availableHeight = Math.max(1, positiveInteger(screenHeight, 24) - margin * 2);
  const minimumWidth = Math.min(availableWidth, positiveInteger(options.minWidth, 20));
  const minimumHeight = Math.min(availableHeight, positiveInteger(options.minHeight, 5));
  const width = Math.max(minimumWidth, Math.min(positiveInteger(preferredWidth, availableWidth), availableWidth));
  const height = Math.max(minimumHeight, Math.min(positiveInteger(preferredHeight, availableHeight), availableHeight));

  return {
    width,
    height,
    compact: width < preferredWidth || height < preferredHeight,
  };
}

export function screenGeometry(
  screen: blessed.Widgets.Screen,
  preferredWidth: number,
  preferredHeight: number,
  options?: GeometryOptions,
): OverlayGeometry {
  return calculateOverlayGeometry(
    positiveInteger(screen.width, 80),
    positiveInteger(screen.height, 24),
    preferredWidth,
    preferredHeight,
    options,
  );
}

export function bindOverlayResize(
  screen: blessed.Widgets.Screen,
  element: blessed.Widgets.BoxElement,
  preferredWidth: number,
  preferredHeight: number,
  onResize?: (geometry: OverlayGeometry) => void,
  options?: GeometryOptions,
): () => void {
  const update = () => {
    const geometry = screenGeometry(screen, preferredWidth, preferredHeight, options);
    element.width = geometry.width;
    element.height = geometry.height;
    if (options?.position === 'top-right') {
      element.top = 0;
      element.left = Math.max(0, positiveInteger(screen.width, 80) - geometry.width);
    } else {
      element.top = 'center';
      element.left = 'center';
    }
    onResize?.(geometry);
  };

  update();
  screen.on('resize', update);
  return () => {
    screen.removeListener('resize', update);
  };
}

export function truncateOverlayText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}
