/**
 * AudioLayer — Persistent audio DOM layer.
 *
 * All audio clips mounted as <audio> elements, always present in DOM.
 * MediaEngine controls play/pause/seek imperatively.
 * This component only re-renders when clip list changes.
 */

import { memo } from 'react';
import type { Clip, MediaItem } from '../../store/editorStore';

interface AudioLayerProps {
  audioClips: Clip[];
  mediaLibrary: MediaItem[];
  onAudioRef: (clipId: string, el: HTMLAudioElement | null) => void;
}

export const AudioLayer = memo(function AudioLayer({
  audioClips,
  mediaLibrary,
  onAudioRef,
}: AudioLayerProps) {
  return (
    <>
      {audioClips.map((clip) => {
        const media = clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId) : undefined;
        if (!media?.src) return null;
        return (
          <audio
            key={clip.id}
            ref={(el) => onAudioRef(clip.id, el)}
            src={media.src}
            preload="auto"
            style={{ display: 'none' }}
          />
        );
      })}
    </>
  );
});
