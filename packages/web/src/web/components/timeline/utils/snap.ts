import type { Clip } from '../../../store/editorStore';

export const SNAP_THRESHOLD_PX = 8;

export function computeSnapTargets(
  allClips: Clip[],
  excludeId: string,
  currentTime: number,
): number[] {
  const times = new Set<number>();
  times.add(0);
  times.add(currentTime);
  for (const c of allClips) {
    if (c.id === excludeId) continue;
    times.add(c.startTime);
    times.add(c.startTime + c.duration);
  }
  return [...times];
}

export function snapToTargets(
  time: number,
  targets: number[],
  pxPerSec: number,
): { snapped: number; snapLine: number | null } {
  const thresholdSec = SNAP_THRESHOLD_PX / pxPerSec;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const d = Math.abs(time - t);
    if (d < thresholdSec && d < bestDist) { bestDist = d; best = t; }
  }
  return best !== null
    ? { snapped: best, snapLine: best }
    : { snapped: time, snapLine: null };
}
