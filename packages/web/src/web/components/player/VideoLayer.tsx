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
 */

import { memo } from 'react';
import { Monitor } from 'lucide-react';
import type { Clip, MediaItem } from '../../store/editorStore';

interface VideoLayerProps {
  videoClips: Clip[];
  mediaLibrary: MediaItem[];
  onVideoRef: (clipId: string, el: HTMLVideoElement | null) => void;
  onWrapperRef: (clipId: string, el: HTMLDivElement | null) => void;
  mainTrackId: string | undefined;
}

/**
 * Single video wrapper — memoised so it only re-renders when clip identity changes.
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
          ref={(el) => onVideoRef(clip.id, el)}
          src={media.src}
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
