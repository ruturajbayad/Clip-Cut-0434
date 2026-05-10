/**
 * PreviewCanvas — Thin orchestration shell.
 *
 * All heavy lifting is in the /player module:
 *  - MediaEngine.ts   → framework-agnostic RAF + DOM playback engine
 *  - useMediaEngine.ts → React hook that owns the engine
 *  - VideoLayer.tsx   → persistent <video> elements (never unmounted)
 *  - AudioLayer.tsx   → persistent <audio> elements
 *  - OverlayLayer.tsx → draggable/resizable overlay elements (text, overlay clips)
 *  - TransitionOverlay.tsx → visual transition effects
 *
 * THIS component is responsible only for:
 *  1. Canvas sizing / aspect ratio
 *  2. Wiring ref callbacks from VideoLayer/AudioLayer → MediaEngine
 *  3. Computing which clips are active (for OverlayLayer) at UI refresh rate
 *  4. Grid / safe-zone helpers
 *  5. Bottom toolbar (aspect ratio, grid, safe zones)
 *
 * Rules:
 *  - NEVER subscribe to currentTime here for per-frame rendering — RAF handles that
 *  - currentTime is read from store only for overlay/text active-clip computation (15fps)
 *  - Main video track (track index 0) is NOT moveable — fills canvas
 *  - All other video tracks = overlays (moveable, resizable)
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Grid3X3, AlignCenter, RotateCcw, Maximize2, Monitor } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { useMediaEngine } from '../player/useMediaEngine';
import { VideoLayer } from '../player/VideoLayer';
import { AudioLayer } from '../player/AudioLayer';
import { OverlayLayer } from '../player/OverlayLayer';
import { TransitionOverlay, TRANSITION_DURATION } from '../player/TransitionOverlay';

const ASPECT_RATIOS = [
  { label: '16:9', w: 16, h: 9 },
  { label: '9:16', w: 9, h: 16 },
  { label: '1:1',  w: 1,  h: 1  },
  { label: '4:3',  w: 4,  h: 3  },
];

export default function PreviewCanvas() {
  // ── Store selectors ─────────────────────────────────────────────────────────
  // NOTE: currentTime subscription here is only for the overlay layer / timecode
  // at 15fps. The video/audio elements are driven by MediaEngine imperatively.
  const currentTime     = useEditorStore((s) => s.currentTime);
  const setCurrentTime  = useEditorStore((s) => s.setCurrentTime);
  const isPlaying       = useEditorStore((s) => s.isPlaying);
  const setIsPlaying    = useEditorStore((s) => s.setIsPlaying);
  const project         = useEditorStore((s) => s.project);
  const mediaLibrary    = useEditorStore((s) => s.mediaLibrary);
  const selectedClipId  = useEditorStore((s) => s.selectedClipId);
  const setSelectedClip = useEditorStore((s) => s.setSelectedClip);

  // ── MediaEngine ──────────────────────────────────────────────────────────────
  const engineRef = useMediaEngine();

  // ── Canvas sizing ────────────────────────────────────────────────────────────
  const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIOS[0]);
  const [showGrid, setShowGrid] = useState(false);
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 640, h: 360 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const el = containerRef.current; if (!el) return;
      const maxW = el.clientWidth - 32;
      const maxH = el.clientHeight - 32;
      const ratio = aspectRatio.h / aspectRatio.w;
      let w = maxW, h = w * ratio;
      if (h > maxH) { h = maxH; w = h / ratio; }
      setCanvasSize({ w: Math.floor(w), h: Math.floor(h) });
    };
    update();
    const obs = new ResizeObserver(update);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [aspectRatio]);

  // ── Clip categorisation ──────────────────────────────────────────────────────
  const allClips = useMemo(() => project.tracks.flatMap((t) => t.clips), [project]);

  // All video clips (for persistent VideoLayer — never changes on frame)
  const videoClips = useMemo(
    () => allClips.filter((c) => c.type === 'video'),
    [allClips]
  );

  // All audio clips (for persistent AudioLayer)
  const audioClips = useMemo(
    () => allClips.filter((c) => c.type === 'audio'),
    [allClips]
  );

  // Overlay video clips = clips NOT on the first (main) video track
  const mainVideoTrack = useMemo(
    () => project.tracks.find((t) => t.type === 'video'),
    [project]
  );
  const overlayVideoClips = useMemo(
    () => videoClips.filter((c) => c.trackId !== mainVideoTrack?.id),
    [videoClips, mainVideoTrack]
  );

  // Active clips at current UI time (updated at 15fps via currentTime)
  const activeVideoClips = useMemo(
    () => videoClips.filter((c) => currentTime >= c.startTime && currentTime < c.startTime + c.duration),
    [videoClips, currentTime]
  );
  const activeTextClips = useMemo(
    () => allClips.filter((c) => c.type === 'text' && currentTime >= c.startTime && currentTime < c.startTime + c.duration),
    [allClips, currentTime]
  );
  // Image clips are fully managed in OverlayLayer (moveable/resizable)
  const activeImageClips = useMemo(
    () => allClips.filter((c) => c.type === 'image' && currentTime >= c.startTime && currentTime < c.startTime + c.duration),
    [allClips, currentTime]
  );
  const hasActiveVideo = activeVideoClips.length > 0;

  // Compute active transition (straddles the cut point: 0.25s before and 0.25s after)
  const activeTransition = useMemo(() => {
    for (const clip of videoClips) {
      if (clip.transition) {
        const cutTime = clip.startTime + clip.duration;
        const tStart = cutTime - TRANSITION_DURATION / 2;
        const tEnd = cutTime + TRANSITION_DURATION / 2;
        if (currentTime >= tStart && currentTime <= tEnd) {
          return {
            type: clip.transition,
            progress: (currentTime - tStart) / TRANSITION_DURATION,
          };
        }
      }
    }
    return null;
  }, [videoClips, currentTime]);

  // ── MediaEngine element registration callbacks ───────────────────────────────
  // Stable callbacks — never recreated, so VideoLayer never re-renders unnecessarily

  const onVideoRef = useCallback((clipId: string, el: HTMLVideoElement | null) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (el) engine.registerVideo(clipId, el);
    else engine.unregisterVideo(clipId);
  }, [engineRef]);

  const onAudioRef = useCallback((clipId: string, el: HTMLAudioElement | null) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (el) engine.registerAudio(clipId, el);
    else engine.unregisterAudio(clipId);
  }, [engineRef]);

  const onWrapperRef = useCallback((clipId: string, el: HTMLDivElement | null) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (el) engine.registerWrapper(clipId, el);
    else engine.unregisterWrapper(clipId);
  }, [engineRef]);

  // ── Timecode formatter ────────────────────────────────────────────────────────
  const fmt = (t: number) => {
    const m = Math.floor(t / 60).toString().padStart(2, '0');
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    const f = Math.floor((t % 1) * project.fps).toString().padStart(2, '0');
    return `${m}:${s}:${f}`;
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-100">

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center p-4 min-h-0 overflow-hidden"
      >
        <div
          className="relative bg-black shadow-2xl border border-gray-300"
          style={{ width: canvasSize.w, height: canvasSize.h, borderRadius: 8, overflow: 'visible' }}
          onClick={() => setSelectedClip(null)}
        >
          {/* Clipping mask — data attr used by ExportModal to locate video elements */}
          <div className="absolute inset-0 overflow-hidden" data-preview-canvas="root" style={{ borderRadius: 8 }}>

            {/* Empty state */}
            {!hasActiveVideo && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 z-0">
                <div className="text-center opacity-30">
                  <Monitor size={36} className="text-white mx-auto mb-2" />
                  <div className="text-white text-xs">No clip at this time</div>
                </div>
              </div>
            )}

            {/*
              ── PERSISTENT VIDEO LAYER ────────────────────────────────────────
              All <video> elements live here. MediaEngine controls them via DOM.
              React does NOT re-render this on every frame.
            */}
            <VideoLayer
              videoClips={videoClips}
              mediaLibrary={mediaLibrary}
              onVideoRef={onVideoRef}
              onWrapperRef={onWrapperRef}
              mainTrackId={mainVideoTrack?.id}
            />

            {/*
              ── OVERLAY INTERACTION LAYER ─────────────────────────────────────
              Transparent hit areas for selecting/moving active clips.
              Text clips are rendered here (not in VideoLayer).
              Re-renders at ~15fps — acceptable.
            */}
            <OverlayLayer
              activeVideoClips={activeVideoClips}
              activeTextClips={activeTextClips}
              activeImageClips={activeImageClips}
              overlayVideoClips={overlayVideoClips}
              currentTime={currentTime}
              canvasW={canvasSize.w}
              canvasH={canvasSize.h}
              selectedClipId={selectedClipId}
              onSelect={setSelectedClip}
              mediaLibrary={mediaLibrary}
            />

            {/*
              ── PERSISTENT AUDIO LAYER ────────────────────────────────────────
              All <audio> elements. MediaEngine controls play/pause/seek.
            */}
            <AudioLayer
              audioClips={audioClips}
              mediaLibrary={mediaLibrary}
              onAudioRef={onAudioRef}
            />

            {/* Grid overlay */}
            {showGrid && (
              <div className="absolute inset-0 pointer-events-none z-40">
                <svg width="100%" height="100%" className="opacity-20">
                  <defs>
                    <pattern id="grid" width="10%" height="10%" patternUnits="objectBoundingBox">
                      <path d="M 100 0 L 0 0 0 100" fill="none" stroke="white" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />
                </svg>
              </div>
            )}

            {/* Safe zones */}
            {showSafeZones && (
              <div className="absolute inset-0 pointer-events-none z-40">
                <div className="absolute border border-white/30" style={{ inset: '5%' }} />
                <div className="absolute border border-white/15" style={{ inset: '10%' }} />
              </div>
            )}

            {/* Timecode */}
            {activeTransition && (
              <TransitionOverlay
                type={activeTransition.type}
                progress={activeTransition.progress}
              />
            )}

            {/* Timecode */}
            <div className="absolute bottom-2 right-2 font-mono text-[10px] text-white/80 bg-black/40 rounded px-1.5 py-0.5 select-none pointer-events-none z-50">
              {fmt(currentTime)}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="h-10 flex items-center justify-between px-4 border-t border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-1">
          {ASPECT_RATIOS.map((ar) => (
            <button
              key={ar.label}
              onClick={() => setAspectRatio(ar)}
              className={`text-[10px] font-medium px-2 py-1 rounded transition-colors ${
                aspectRatio.label === ar.label
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {ar.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`p-1.5 rounded transition-colors ${showGrid ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-100'}`}
            title="Grid"
          >
            <Grid3X3 size={13} />
          </button>
          <button
            onClick={() => setShowSafeZones(!showSafeZones)}
            className={`p-1.5 rounded transition-colors ${showSafeZones ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-100'}`}
            title="Safe Zones"
          >
            <AlignCenter size={13} />
          </button>
          <button
            onClick={() => { setCurrentTime(0); setIsPlaying(false); }}
            className="p-1.5 rounded text-gray-400 hover:bg-gray-100 transition-colors"
            title="Reset to start"
          >
            <RotateCcw size={13} />
          </button>
          <button
            className="p-1.5 rounded text-gray-400 hover:bg-gray-100 transition-colors"
            title="Fullscreen"
            onClick={() => {
              const el = containerRef.current;
              if (el?.requestFullscreen) el.requestFullscreen();
            }}
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
