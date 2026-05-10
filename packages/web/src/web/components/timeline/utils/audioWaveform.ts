import { useEffect, useState } from 'react';

const waveformCache = new Map<string, number[]>();
let audioCtx: AudioContext | null = null;

/**
 * Decodes the actual PCM data of an audio file and downsamples it into a standard number of peaks.
 */
export async function getAudioWaveform(src: string, numSamples = 300): Promise<number[]> {
  if (waveformCache.has(src)) {
    return waveformCache.get(src)!;
  }

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const response = await fetch(src);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);

    const blockSize = Math.floor(channelData.length / numSamples);
    const peaks: number[] = [];

    for (let i = 0; i < numSamples; i++) {
      const start = i * blockSize;
      let max = 0;
      for (let j = 0; j < blockSize; j++) {
        const val = Math.abs(channelData[start + j]);
        if (val > max) max = val;
      }
      peaks.push(max);
    }

    // Normalize peaks so the maximum peak is 1.0
    const maxPeak = Math.max(...peaks);
    const normalized = maxPeak > 0 ? peaks.map(p => p / maxPeak) : peaks;

    waveformCache.set(src, normalized);
    return normalized;
  } catch (err) {
    console.error("Failed to decode audio waveform", err);
    throw err;
  }
}

/**
 * Resamples an array of peak numbers to a target length.
 */
export function resamplePeaks(peaks: number[], targetCount: number): number[] {
  if (peaks.length === 0) return [];
  if (peaks.length === targetCount) return peaks;

  const result: number[] = [];
  const step = peaks.length / targetCount;
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * step);
    const end = Math.min(peaks.length, Math.floor((i + 1) * step));
    let max = 0;
    for (let j = start; j < end; j++) {
      if (peaks[j] > max) max = peaks[j];
    }
    result.push(max);
  }
  return result;
}

/**
 * Generates an organic, highly realistic audio waveform simulating rhythmic drum beats (Kick, Snare, Hi-Hats) deterministically.
 */
export function getDeterministicFallbackPeaks(clipId: string, targetCount: number, duration = 23): number[] {
  const result: number[] = [];
  
  // Stable hash from clipId
  let seed = 0;
  for (let i = 0; i < clipId.length; i++) {
    seed = (seed << 5) - seed + clipId.charCodeAt(i);
    seed |= 0;
  }

  const lcg = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };

  // Randomized stable tempo (e.g. 110 to 135 BPM)
  const bpm = 110 + Math.floor(lcg() * 25);
  const bps = bpm / 60; // Beats per second

  for (let i = 0; i < targetCount; i++) {
    const fraction = i / targetCount;
    const time = fraction * duration;
    
    // Position in beat cycle
    const beatTime = time * bps;
    const beatIndex = Math.floor(beatTime);
    const beatFraction = beatTime - beatIndex;

    // 1. Kick Drum (4-on-the-floor: powerful spikes at start of beats)
    const kick = Math.exp(-beatFraction * 7.5) * 0.8;

    // 2. Snare Drum on even beat indices (backbeats)
    const isSnare = beatIndex % 2 === 1;
    const snare = isSnare ? Math.exp(-beatFraction * 4.5) * (0.45 + lcg() * 0.15) : 0;

    // 3. Hi-Hat transients on the off-beats
    const offBeatFraction = Math.abs(beatFraction - 0.5);
    const hat = Math.exp(-offBeatFraction * 14.0) * (0.2 + lcg() * 0.1);

    // 4. Low-frequency melodic synth bassline
    const melody = (Math.sin(time * 0.7) * 0.12) + (Math.sin(time * 0.25) * 0.08) + 0.1;

    // 5. Random ambient crackle/details
    const noise = lcg() < 0.06 ? lcg() * 0.15 : 0;

    // Combine features
    const h = kick + snare + hat + melody + noise;

    // Soft fade-in and fade-out envelopes
    const startFade = Math.min(1.0, time / 0.6);
    const endFade = Math.min(1.0, (duration - time) / 0.8);

    const finalH = Math.max(0.04, Math.min(0.96, h * startFade * endFade));
    result.push(finalH);
  }

  // Normalize heights to make the waveform perfectly balanced
  const maxVal = Math.max(...result);
  return maxVal > 0 ? result.map(v => v / maxVal) : result;
}

/**
 * Hook to load and cached actual audio waveform peaks or return fallback peaks gracefully.
 */
export function useAudioPeaks(src: string | undefined, clipId: string, targetCount: number, duration = 10): number[] {
  const [realPeaks, setRealPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    if (!src) {
      setRealPeaks(null);
      return;
    }

    let active = true;
    getAudioWaveform(src)
      .then((peaks) => {
        if (active) {
          setRealPeaks(peaks);
        }
      })
      .catch(() => {
        if (active) {
          setRealPeaks(null);
        }
      });

    return () => {
      active = false;
    };
  }, [src]);

  // If real PCM peaks are available, resample them to targetCount; otherwise use deterministic fallback peaks
  if (realPeaks) {
    return resamplePeaks(realPeaks, targetCount);
  }

  return getDeterministicFallbackPeaks(clipId, targetCount, duration);
}
