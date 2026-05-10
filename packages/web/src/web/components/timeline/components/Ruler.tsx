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

  // Only generate ticks visible in the viewport (use scrollLeft for culling only)
  const startT = Math.max(0, scrollLeft / pxPerSec - major);
  const endT   = Math.min(duration + major, (scrollLeft + containerWidth) / pxPerSec + major);

  const ticks: Array<{ t: number; isMajor: boolean }> = [];
  const firstT = Math.floor(startT / minor) * minor;
  for (let t = firstT; t <= endT + 0.0001; t = +(t + minor).toFixed(6)) {
    if (t < -0.0001) continue;
    const rounded = +t.toFixed(4);
    const mod = rounded % major;
    const isMajor = mod < major * 0.01 || mod > major * 0.99;
    ticks.push({ t: rounded, isMajor });
  }

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    console.log("Ruler onMouseDown", e.clientX);
    const el = e.currentTarget as HTMLElement;
    const doSeek = (clientX: number) => {
      const rect = el.getBoundingClientRect();
      const rawX = clientX - rect.left;
      console.log("Ruler doSeek rawX:", rawX, "pxPerSec:", pxPerSec, "time:", rawX / pxPerSec);
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
  }, [pxPerSec, onSeek]);

  // Playhead x in absolute canvas coordinates (ruler is scrolled by JS so we use abs pos)
  const playheadCanvasX = currentTime * pxPerSec;
  const playheadVisible = playheadCanvasX >= scrollLeft - 2 && playheadCanvasX <= scrollLeft + containerWidth + 2;

  return (
    <div
      className="tl-ruler select-none cursor-col-resize"
      style={{
        height: RULER_H,
        width: '100%',
        background: '#f8f9fa',
        borderBottom: '1px solid #e5e7eb',
        position: 'relative',
        overflow: 'visible',
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Ticks at absolute canvas positions (no scrollLeft subtraction — parent is scrolled by JS) */}
      {ticks.map(({ t, isMajor }) => {
        const x = t * pxPerSec; // absolute canvas position
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

      {/* Playhead indicator in ruler at absolute canvas position */}
      {playheadVisible && (
        <div
          className="absolute top-0 pointer-events-none z-10"
          style={{ left: playheadCanvasX }}
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
