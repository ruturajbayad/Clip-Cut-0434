/**
 * VideoLayer — Persistent video DOM layer.
 *
 * All video clips are rendered as <video> elements here and NEVER unmounted.
 * Visibility is controlled imperatively by MediaEngine via wrapperEls.
 *
 * Main track (first video track) videos fill the entire canvas (object-cover).
 * Overlay track videos use object-contain and their wrapper is sized/positioned
 * by OverlayLayer's CanvasElement drag/resize — so the <video> just fills its parent.
 *
 * Image clips are NOT rendered here — they are rendered directly in OverlayLayer.
 *
 * CSS filters (brightness/contrast/saturation/blur) are applied reactively via
 * a Zustand subscription so VideoItem doesn't need to re-render on every playback frame.
 */

import { memo, useEffect, useRef } from 'react';
import { Monitor } from 'lucide-react';
import { useEditorStore, type Clip, type MediaItem } from '../../store/editorStore';

/** CSS filter strings for named effects */
const EFFECT_FILTERS: Record<string, string> = {
  blur:       'blur(4px)',
  vhs:        'saturate(1.3) contrast(1.1) sepia(0.15) hue-rotate(-5deg)',
  glitch:     'hue-rotate(90deg) saturate(2) contrast(1.5)',
  bw:         'grayscale(1)',
  cinematic:  'contrast(1.2) saturate(0.85) brightness(0.9) sepia(0.15)',
  bloom:      'brightness(1.3) contrast(0.9) saturate(1.2) blur(0.5px)',
  grain:      'contrast(1.1) saturate(0.9) brightness(1.05)',
  chromatic:  'hue-rotate(5deg) saturate(1.5) contrast(1.1)',
};

/** Build a CSS filter string from clip adjustment properties and effect/filterCss */
function buildFilter(clip: Clip): string {
  const parts: string[] = [];
  // Named effect takes priority
  if (clip.effect && EFFECT_FILTERS[clip.effect]) {
    return EFFECT_FILTERS[clip.effect];
  }
  // Filter preset (raw CSS string from filter panel)
  if (clip.filterCss) return clip.filterCss;
  // Manual adjustments
  if (clip.brightness !== undefined && clip.brightness !== 100) parts.push(`brightness(${clip.brightness}%)`);
  if (clip.contrast   !== undefined && clip.contrast   !== 100) parts.push(`contrast(${clip.contrast}%)`);
  if (clip.saturation !== undefined && clip.saturation !== 100) parts.push(`saturate(${clip.saturation}%)`);
  if (clip.blur       !== undefined && clip.blur       !== 0)   parts.push(`blur(${clip.blur}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

interface VideoLayerProps {
  videoClips: Clip[];
  mediaLibrary: MediaItem[];
  onVideoRef: (clipId: string, el: HTMLVideoElement | null) => void;
  onWrapperRef: (clipId: string, el: HTMLDivElement | null) => void;
  mainTrackId: string | undefined;
  canvasW?: number;
  canvasH?: number;
}

/**
 * Single video wrapper — memoised so it only re-renders when clip identity or filter changes.
 * CSS filters are subscribed reactively so a playing video doesn't force React re-renders.
 */
const VideoItem = memo(function VideoItem({
  clip,
  media,
  isOverlay,
  onVideoRef,
  onWrapperRef,
  canvasW,
  canvasH,
}: {
  clip: Clip;
  media: MediaItem | undefined;
  isOverlay: boolean;
  onVideoRef: (clipId: string, el: HTMLVideoElement | null) => void;
  onWrapperRef: (clipId: string, el: HTMLDivElement | null) => void;
  canvasW?: number;
  canvasH?: number;
}) {
  const videoElRef  = useRef<HTMLVideoElement | null>(null);
  const wrapperRef  = useRef<HTMLDivElement | null>(null);

  // Subscribe to filter/opacity/position changes and apply them imperatively.
  // This avoids React re-renders on every slider move or drag update.
  useEffect(() => {
    const applyToVideo = (c: Clip) => {
      const el = videoElRef.current;
      if (el) {
        el.style.filter  = buildFilter(c);
        el.style.opacity = String(c.opacity ?? 1);
      }
    };

    const applyToWrapper = (c: Clip, cw: number, ch: number) => {
      const el = wrapperRef.current;
      if (!el) return;
      if (isOverlay) {
        // Position the wrapper to match CanvasElement geometry
        const cx  = (c.x ?? 0.5) * cw;
        const cy  = (c.y ?? 0.5) * ch;
        const sw  = (c.scaleX ?? 1.0) * cw;
        const sh  = (c.scaleY ?? 1.0) * ch;
        const rot = c.rotation ?? 0;
        el.style.inset     = 'unset';
        el.style.left      = `${cx - sw / 2}px`;
        el.style.top       = `${cy - sh / 2}px`;
        el.style.width     = `${sw}px`;
        el.style.height    = `${sh}px`;
        el.style.transform = `rotate(${rot}deg) translateZ(0)`;
      }
      // Main track always inset:0 (no repositioning)
    };

    applyToVideo(clip);
    if (canvasW && canvasH) applyToWrapper(clip, canvasW, canvasH);

    const unsub = useEditorStore.subscribe((state) => {
      const updated = state.project.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
      if (updated) {
        applyToVideo(updated);
        const cw = canvasW ?? wrapperRef.current?.parentElement?.clientWidth ?? 0;
        const ch = canvasH ?? wrapperRef.current?.parentElement?.clientHeight ?? 0;
        if (cw && ch) applyToWrapper(updated, cw, ch);
      }
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, isOverlay]);

  return (
    <div
      ref={(el) => {
        wrapperRef.current = el;
        onWrapperRef(clip.id, el);
      }}
      style={{
        // IMPORTANT: Start hidden via opacity, NOT display:none.
        // display:none destroys the GPU compositor layer → flash when re-shown.
        // opacity:0 + visibility:hidden keeps the element on the GPU tree at all times.
        display: 'block',
        opacity: 0,
        visibility: 'hidden',
        position: 'absolute',
        // Main-track: fill canvas. Overlay: positioned dynamically via subscription above.
        ...(isOverlay ? {} : { inset: 0 }),
        zIndex: isOverlay ? 12 : 10,
        // Force GPU compositor layer promotion immediately on mount.
        willChange: 'opacity, transform',
        transform: 'translateZ(0)',
        pointerEvents: 'none',
        // Overflow hidden so video doesn't bleed outside bounds
        overflow: isOverlay ? 'hidden' : undefined,
        borderRadius: isOverlay ? 4 : undefined,
      }}
    >
      {media?.type === 'video' ? (
        <video
          ref={(el) => {
            videoElRef.current = el;
            onVideoRef(clip.id, el);
            // Apply filter immediately on ref assignment
            if (el) el.style.filter = buildFilter(clip);
          }}
          src={`${media.src}#${clip.id}`}
          data-clip-id={clip.id}
          className="w-full h-full"
          style={{
            objectFit: isOverlay ? 'contain' : 'cover',
            display: 'block',
            pointerEvents: 'none',
          }}
          playsInline
          preload="auto"
          muted // starts muted; MediaEngine unmutes after user gesture
        />
      ) : media?.type === 'image' ? (
        <img
          src={media.src}
          alt={clip.name}
          className="w-full h-full object-contain"
          style={{ pointerEvents: 'none' }}
        />
      ) : (
        /* No media yet — placeholder */
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${clip.thumbnailColor || '#818CF8'}55, ${clip.thumbnailColor || '#818CF8'}11)`,
          }}
        >
          <Monitor size={24} className="text-white opacity-40" />
        </div>
      )}
    </div>
  );
});

export const VideoLayer = memo(function VideoLayer({
  videoClips,
  mediaLibrary,
  onVideoRef,
  onWrapperRef,
  mainTrackId,
  canvasW,
  canvasH,
}: VideoLayerProps) {
  return (
    <>
      {videoClips.map((clip) => {
        const media = clip.mediaId
          ? mediaLibrary.find((m) => m.id === clip.mediaId)
          : clip.src
          ? ({ id: clip.id, name: clip.name, type: 'video' as const, src: clip.src } as MediaItem)
          : undefined;

        const isOverlay = clip.trackId !== mainTrackId;
        return (
          <VideoItem
            key={clip.id}
            clip={clip}
            media={media}
            isOverlay={isOverlay}
            onVideoRef={onVideoRef}
            onWrapperRef={onWrapperRef}
            canvasW={canvasW}
            canvasH={canvasH}
          />
        );
      })}
    </>
  );
});
