import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * Drag-to-resize state for a side panel. The hook only owns the width; the
 * host decides where the handle lives and how the grid consumes the value.
 */
export function useResizableWidth(
  initial: number,
  min: number,
  max: number,
  direction: 'left' | 'right' = 'left',
) {
  const [width, setWidth] = useState(initial);
  const drag = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      drag.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current) return;
      const delta = event.clientX - current.x;
      setWidth(
        Math.min(max, Math.max(min, current.width + (direction === 'left' ? delta : -delta))),
      );
    },
    [direction, max, min],
  );

  const end = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return {
    width,
    setWidth,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}
