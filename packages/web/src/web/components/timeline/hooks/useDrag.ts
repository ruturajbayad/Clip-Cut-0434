import { useCallback, useRef } from 'react';

interface DragOptions {
  onMove: (dx: number, dy: number, clientX: number, clientY: number) => void;
  onEnd?: () => void;
  onStart?: () => void;
}

export function useDrag(options: DragOptions) {
  const opts = useRef(options);
  opts.current = options;

  return useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    opts.current.onStart?.();

    const onMove = (me: MouseEvent) => {
      opts.current.onMove(me.clientX - sx, me.clientY - sy, me.clientX, me.clientY);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      opts.current.onEnd?.();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);
}
