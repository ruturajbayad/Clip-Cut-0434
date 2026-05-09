/**
 * VideoLayer — Persistent video DOM layer.
 *
 * All video clips are rendered as <video> elements here and NEVER unmounted.
 * Visibility is controlled imperatively by MediaEngine via wrapperEls.
 *
 * This component re-renders only when the list of video clips changes
 * (i.e. clip added/removed), NOT on every frame. That is the key to
 * smooth 4K playback — React is not involved in per-frame updates.
 *
 * Props:
 *  - videoClips: all Clip objects with type === 'video'
 *  - mediaLibrary: MediaItem[]
 *  - currentTime: for initial display check only (not subscribed for RAF)
 *  - onVideoRef: callback to register <video> element with MediaEngine
 *  - onWrapperRef: callback to register wrapper div with MediaEngine
 */

import { memo } from 'react';
import { Monitor } from 'lucide-react';
import type { Clip, MediaItem } from '../../store/editorStore';

interface VideoLayerProps {
  videoClips: Clip[];
  mediaLibrary: MediaItem[];
  currentTime: number;
  onVideoRef: (clipId: string, el: HTMLVideoElement | null) => void;
  onWrapperRef: (clipId: string, el: HTMLDivElement | null) => void;
}

/**
 * Single video wrapper — memoised so it only re-renders when clip identity changes,
 * not when other clips or currentTime changes.
 */
const VideoItem = memo(function VideoItem({
  clip,
  media,
  initVisible,
  onVideoRef,
  onWrapperRef,
}: {
  clip: Clip;
  media: MediaItem | undefined;
  initVisible: boolean;
  onVideoRef: (clipId: string, el: HTMLVideoElement | null) => void;
  onWrapperRef: (clipId: string, el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={(el) => onWrapperRef(clip.id, el)}
      style={{
        display: initVisible ? 'block' : 'none',
        position: 'absolute',
        inset: 0,
        zIndex: 10,
      }}
    >
      {media?.type === 'video' ? (
        <video
          ref={(el) => onVideoRef(clip.id, el)}
          src={media.src}
          className="w-full h-full object-cover"
          playsInline
          preload="auto"
          muted // starts muted; MediaEngine unmutes after user gesture
          style={{ display: 'block', pointerEvents: 'none' }}
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
  currentTime,
  onVideoRef,
  onWrapperRef,
}: VideoLayerProps) {
  return (
    <>
      {videoClips.map((clip) => {
        const media = clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId) : undefined;
        const initVisible = currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration;
        return (
          <VideoItem
            key={clip.id}
            clip={clip}
            media={media}
            initVisible={initVisible}
            onVideoRef={onVideoRef}
            onWrapperRef={onWrapperRef}
          />
        );
      })}
    </>
  );
});
