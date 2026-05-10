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
}: {
  clip: Clip;
  media: MediaItem | undefined;
  isOverlay: boolean;
  onVideoRef: (clipId: string, el: HTMLVideoElement | null) => void;
  onWrapperRef: (clipId: string, el: HTMLDivElement | null) => void;
}) {
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  // Subscribe to filter/opacity-relevant clip props and apply them imperatively
  // so we don't trigger full React re-renders on every slider move.
  useEffect(() => {
    const apply = (c: Clip) => {
      const el = videoElRef.current;
      if (el) {
        el.style.filter = buildFilter(c);
        // Apply clip opacity to the video element itself.
        // The wrapper opacity is controlled by MediaEngine (0=hidden, 1=visible).
        el.style.opacity = String(c.opacity ?? 1);
      }
    };
    // Apply immediately on mount
    apply(clip);
    // Subscribe to store changes and re-apply whenever THIS clip changes
    const unsub = useEditorStore.subscribe((state) => {
      const updated = state.project.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
      if (updated) apply(updated);
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  return (
    <div
      ref={(el) => onWrapperRef(clip.id, el)}
      style={{
        // IMPORTANT: Start hidden via opacity, NOT display:none.
        // display:none destroys the GPU compositor layer → flash when re-shown.
        // opacity:0 + visibility:hidden keeps the element on the GPU tree at all times.
        display: 'block',
        opacity: 0,
        visibility: 'hidden',
        position: 'absolute',
        inset: 0,
        zIndex: isOverlay ? 12 : 10,
        // Force GPU compositor layer promotion immediately on mount.
        // Eliminates the layout+paint+GPU-upload cost when we switch opacity.
        willChange: 'opacity, transform',
        transform: 'translateZ(0)',
        pointerEvents: 'none',
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
          />
        );
      })}
    </>
  );
});
