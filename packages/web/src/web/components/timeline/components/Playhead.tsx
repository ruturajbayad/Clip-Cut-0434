/**
 * Playhead — performance-optimised.
 *
 * During playback the MediaEngine fires onTimeUpdate at ~15fps which calls
 * setCurrentTime in Zustand — that would re-render the entire Timeline tree
 * every 66ms if we just read currentTime as React state.
 *
 * Instead, this component exposes a DOM ref + an imperative `moveTo(x)` call
 * so the parent can update the playhead position directly via style mutation,
 * completely skipping React reconciliation during playback.
 *
 * The component still re-renders on mount / unmount and when the user scrubs.
 */

import { useCallback, useImperativeHandle, forwardRef, useRef } from 'react';
import { fmtTimecode } from '../utils/time';
import { RULER_H } from './Ruler';

export interface PlayheadHandle {
  /** Move the playhead to pixel offset x (already accounts for scrollLeft). */
  moveTo: (x: number, time: number) => void;
}

interface PlayheadProps {
  currentTime: number;
  pxPerSec: number;
  scrollLeft: number;
  totalHeight: number;
  onSeek: (t: number) => void;
}

export const Playhead = forwardRef<PlayheadHandle, PlayheadProps>(function Playhead(
  { currentTime, pxPerSec, scrollLeft, totalHeight, onSeek },
  ref,
) {
  const wrapRef    = useRef<HTMLDivElement>(null);
  const labelRef   = useRef<HTMLDivElement>(null);

  const x = currentTime * pxPerSec - scrollLeft;

  // Expose imperative handle so Timeline can move us without re-render
  useImperativeHandle(ref, () => ({
    moveTo(px: number, t: number) {
      const el = wrapRef.current;
      if (!el) return;
      el.style.left    = `${px}px`;
      el.style.display = (px < -20 || px > 9999) ? 'none' : 'block';
      if (labelRef.current) labelRef.current.textContent = fmtTimecode(t);
    },
  }), []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startT = currentTime;
    const mm = (me: MouseEvent) => {
      onSeek(Math.max(0, startT + (me.clientX - startX) / pxPerSec));
    };
    const mu = () => {
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  }, [currentTime, pxPerSec, onSeek]);

  return (
    <div
      ref={wrapRef}
      className="absolute pointer-events-none z-50"
      style={{
        left: x,
        top: 0,
        width: 1,
        height: totalHeight,
        display: (x < -20 || x > 9999) ? 'none' : 'block',
      }}
    >
      {/* Vertical line */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: 2,
          background: '#ef4444',
          opacity: 0.9,
          boxShadow: '0 0 6px rgba(239,68,68,0.5)',
        }}
      />

      {/* Draggable cap in ruler */}
      <div
        className="absolute pointer-events-auto cursor-ew-resize"
        style={{ top: 0, left: -8, width: 16, height: RULER_H }}
        onMouseDown={handleMouseDown}
      >
        {/* Triangle */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '10px solid #ef4444',
          }}
        />
        {/* Timecode badge */}
        <div
          ref={labelRef}
          className="absolute font-mono text-white font-bold whitespace-nowrap rounded select-none"
          style={{
            fontSize: 8,
            bottom: 'calc(100% + 14px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#ef4444',
            padding: '1px 4px',
            pointerEvents: 'none',
          }}
        >
          {fmtTimecode(currentTime)}
        </div>
      </div>
    </div>
  );
});
