/**
 * useMediaEngine — React hook that owns a MediaEngine instance.
 *
 * Bridges the imperative MediaEngine with React/Zustand:
 *  - Creates one engine per component mount
 *  - Keeps engine's project/library in sync with store
 *  - Connects play/pause/seek actions to the engine
 *  - Propagates engine's onTimeUpdate → store.setCurrentTime
 *  - Loop: engine loops by default; onEnded is only called in non-loop mode
 */

import { useEffect, useRef } from 'react';
import { MediaEngine } from './MediaEngine';
import { useEditorStore } from '../../store/editorStore';

export function useMediaEngine() {
  const engineRef = useRef<MediaEngine | null>(null);

  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setIsPlaying   = useEditorStore((s) => s.setIsPlaying);

  // Create engine once — loop: true by default
  if (!engineRef.current) {
    engineRef.current = new MediaEngine({
      loop: true,
      onTimeUpdate: (t) => setCurrentTime(t),
      onEnded: () => {
        // Only fires when loop=false
        setIsPlaying(false);
        setCurrentTime(0);
      },
      onError: (clipId, err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.warn(`[MediaEngine] clip ${clipId} error:`, err);
      },
    });
  }

  // Sync project + library to engine
  const project      = useEditorStore((s) => s.project);
  const mediaLibrary = useEditorStore((s) => s.mediaLibrary);
  useEffect(() => {
    engineRef.current?.setProject(project, mediaLibrary);
  }, [project, mediaLibrary]);

  // Sync isPlaying → engine.play/pause
  const isPlaying = useEditorStore((s) => s.isPlaying);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (isPlaying) engine.play();
    else engine.pause();
  }, [isPlaying]);

  // Sync currentTime → engine.seek (only when paused)
  const currentTime    = useEditorStore((s) => s.currentTime);
  const isPlayingRef   = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => {
    if (!isPlayingRef.current) {
      engineRef.current?.seek(currentTime);
    }
  }, [currentTime]);

  // Cleanup
  useEffect(() => {
    return () => { engineRef.current?.destroy(); };
  }, []);

  return engineRef;
}
