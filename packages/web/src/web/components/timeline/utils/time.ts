/** Format seconds to M:SS.ff */
export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  const f = Math.floor((t % 1) * 100).toString().padStart(2, '0');
  return `${m}:${s}.${f}`;
}

/** Format seconds to M:SS */
export function fmtTimecode(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  const frames = Math.floor((t % 1) * 30).toString().padStart(2, '0');
  return `${m}:${s}:${frames}`;
}

/** Pick best ruler tick interval for current pxPerSec */
export function pickTickInterval(pxPerSec: number): { major: number; minor: number } {
  const intervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const targetPx = 80;
  let best = intervals[intervals.length - 1];
  for (const iv of intervals) {
    if (iv * pxPerSec >= targetPx) { best = iv; break; }
  }
  return { major: best, minor: best / 5 };
}
