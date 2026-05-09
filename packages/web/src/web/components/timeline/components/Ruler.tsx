import { useCallback, memo } from 'react';
import { fmtTime, pickTickInterval } from '../utils/time';

export const LABEL_W = 196;
export const RULER_H = 32;

interface RulerProps {
  pxPerSec: number;
  duration: number;
  currentTime: number;
  scrollLeft: number;
  containerWidth: number;
  onSeek: (t: number) => void;
}

export const Ruler = memo(function Ruler({
  pxPerSec, duration, currentTime, scrollLeft, containerWidth, onSeek,
}: RulerProps) {
  const { major, minor } = pickTickInterval(pxPerSec);

  // Only render ticks visible in the viewport
  const startT = Math.max(0, scrollLeft / pxPerSec - major);
  const endT   = (scrollLeft + containerWidth) / pxPerSec + major;

  const ticks: Array<{ t: number; isMajor: boolean }> = [];
  const firstT = Math.floor(startT / minor) * minor;
  for (let t = firstT; t <= endT + 0.0001; t = +(t + minor).toFixed(6)) {
    if (t < -0.0001) continue;
    const rounded = +t.toFixed(4);
    const mod = rounded % major;
    const isMajor = mod < major * 0.01 || mod > major * 0.99;
    ticks.push({ t: rounded, isMajor });
  }

  // Seek on ruler click/drag
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const doSeek = (clientX: number) => {
      const rect = el.getBoundingClientRect();
      // clientX relative to ruler left + scrollLeft = absolute canvas x
      const rawX = clientX - rect.left + scrollLeft;
      onSeek(Math.max(0, rawX / pxPerSec));
    };
    doSeek(e.clientX);
    const mm = (me: MouseEvent) => doSeek(me.clientX);
    const mu = () => {
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  }, [pxPerSec, scrollLeft, onSeek]);

  // Playhead x in ruler coords (relative to canvas scroll)
  const playheadX = currentTime * pxPerSec - scrollLeft;

  return (
    <div
      className="tl-ruler sticky top-0 z-30 select-none cursor-col-resize overflow-hidden"
      style={{
        height: RULER_H,
        background: '#f8f9fa',
        borderBottom: '1px solid #e5e7eb',
        position: 'sticky',
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Ticks — each placed at t * pxPerSec - scrollLeft */}
      {ticks.map(({ t, isMajor }) => {
        const x = t * pxPerSec - scrollLeft;
        if (x < -4 || x > containerWidth + 4) return null;
        return (
          <div key={t} className="absolute top-0" style={{ left: x }}>
            {isMajor ? (
              <>
                <div style={{ width: 1, height: 14, background: '#9ca3af' }} />
                <div
                  className="absolute font-mono whitespace-nowrap"
                  style={{
                    top: 15,
                    fontSize: 9,
                    color: '#6b7280',
                    fontWeight: 600,
                    transform: 'translateX(-50%)',
                  }}
                >
                  {fmtTime(t)}
                </div>
              </>
            ) : (
              <div style={{ width: 1, height: 7, background: '#d1d5db' }} />
            )}
          </div>
        );
      })}

      {/* Playhead indicator in ruler */}
      {playheadX >= -2 && playheadX <= containerWidth + 2 && (
        <div
          className="absolute top-0 pointer-events-none z-10"
          style={{ left: playheadX }}
        >
          <div style={{ width: 1, height: RULER_H, background: '#ef4444', opacity: 0.9 }} />
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: -5,
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '8px solid #ef4444',
            }}
          />
        </div>
      )}
    </div>
  );
});
