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
 *
 * IMPORTANT: canvasW/canvasH must NOT be passed as props to VideoItem.
 * Passing them causes re-renders → inline ref callbacks fire null+el → MediaEngine
 * loses video element registration mid-playback → freeze/stutter/stuck symptoms.
 * Canvas size is read imperatively from the wrapper's parent element instead.
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
  if (clip.effect && EFFECT_FILTERS[clip.effect]) return EFFECT_FILTERS[clip.effect];
  if (clip.filterCss) return clip.filterCss;
  if (clip.brightness !== undefined && clip.brightness !== 100) parts.push(`brightness(${clip.brightness}%)`);
  if (clip.contrast   !== undefined && clip.contrast   !== 100) parts.push(`contrast(${clip.contrast}%)`);
  if (clip.saturation !== undefined && clip.saturation !== 100) parts.push(`saturate(${clip.saturation}%)`);
  if (clip.blur       !== undefined && clip.blur       !== 0)   parts.push(`blur(${clip.blur}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

/** Apply overlay position imperatively from clip data + canvas dimensions */
function applyOverlayPosition(el: HTMLElement, c: Clip, cw: number, ch: number) {
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

interface VideoLayerProps {
  videoClips: Clip[];
  mediaLibrary: MediaItem[];
  onVideoRef: (clipId: string, el: HTMLVideoElement | null) => void;
  onWrapperRef: (clipId: string, el: HTMLDivElement | null) => void;
  mainTrackId: string | undefined;
  /** Canvas pixel dimensions — passed as refs (not props) to avoid VideoItem re-renders */
  canvasSizeRef: React.MutableRefObject<{ w: number; h: number }>;
}

/**
 * Single video wrapper — memoised so it NEVER re-renders after mount.
 * All updates (filter, opacity, position) are applied imperatively via subscriptions.
 * onVideoRef/onWrapperRef callbacks must be stable (useCallback in parent).
 */
const VideoItem = memo(function VideoItem({
  clip,
  media,
  isOverlay,
  onVideoRef,
  onWrapperRef,
  canvasSizeRef,
}: {
  clip: Clip;
  media: MediaItem | undefined;
  isOverlay: boolean;
  onVideoRef: (clipId: string, el: HTMLVideoElement | null) => void;
  onWrapperRef: (clipId: string, el: HTMLDivElement | null) => void;
  canvasSizeRef: React.MutableRefObject<{ w: number; h: number }>;
}) {
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const applyToVideo = (c: Clip) => {
      const el = videoElRef.current;
      if (!el) return;
      el.style.filter  = buildFilter(c);
      el.style.opacity = String(c.opacity ?? 1);
    };

    const applyPosition = (c: Clip) => {
      const el = wrapperRef.current;
      if (!el || !isOverlay) return;
      const { w: cw, h: ch } = canvasSizeRef.current;
      if (cw && ch) applyOverlayPosition(el, c, cw, ch);
    };

    // Apply immediately on mount
    applyToVideo(clip);
    applyPosition(clip);

    // Subscribe to store — re-apply on any clip property change
    const unsub = useEditorStore.subscribe((state) => {
      const updated = state.project.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
      if (updated) {
        applyToVideo(updated);
        applyPosition(updated);
      }
    });
    return unsub;
  // clip.id + isOverlay are stable for the lifetime of this component
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, isOverlay]);

  return (
    <div
      ref={(el) => {
        wrapperRef.current = el;
        onWrapperRef(clip.id, el);
        // Apply initial overlay position imperatively on mount (before any subscription fires)
        if (el && isOverlay) {
          const { w: cw, h: ch } = canvasSizeRef.current;
          if (cw && ch) applyOverlayPosition(el, clip, cw, ch);
        }
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
        willChange: 'opacity, transform',
        transform: 'translateZ(0)',
        pointerEvents: 'none',
        overflow: isOverlay ? 'hidden' : undefined,
        borderRadius: isOverlay ? 4 : undefined,
      }}
    >
      {media?.type === 'video' ? (
        <video
          ref={(el) => {
            videoElRef.current = el;
            onVideoRef(clip.id, el);
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
          muted
        />
      ) : media?.type === 'image' ? (
        <img
          src={media.src}
          alt={clip.name}
          className="w-full h-full object-contain"
          style={{ pointerEvents: 'none' }}
        />
      ) : (
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
  canvasSizeRef,
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
            canvasSizeRef={canvasSizeRef}
          />
        );
      })}
    </>
  );
});
