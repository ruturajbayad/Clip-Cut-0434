/**
 * Professional Timeline — CapCut / Premiere Pro style
 *
 * Performance notes:
 *  - Playhead position is updated via imperative DOM mutation (PlayheadHandle.moveTo)
 *    so it doesn't trigger React re-renders during playback.
 *  - currentTime from Zustand is only read in useEffect (not in render) during playback.
 *  - Ruler ticks are virtualised — only ticks in the viewport are rendered.
 */

import {
  useRef, useState, useCallback, useEffect, useMemo, memo,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { motion } from 'framer-motion';
import {
  Plus, Maximize2, Video, Music, Type, ImageIcon,
} from 'lucide-react';
import { useEditorStore, type Track, type Clip } from '../../store/editorStore';
import { Ruler, LABEL_W, RULER_H } from './components/Ruler';
import { Playhead, type PlayheadHandle } from './components/Playhead';
import { ClipBlock } from './components/ClipBlock';
import { TrackPanel } from './components/TrackPanel';
import { TransitionDropZone } from './components/TransitionDropZone';
import { fmtTime } from './utils/time';

// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_PANEL_H    = 120;
const MAX_PANEL_H    = 600;
const DEFAULT_PANEL_H = 260;
const MINIBAR_H      = 10;
const TOOLBAR_H      = 32;

const TRACK_COLORS: Record<string, string> = {
  video: '#6366f1', audio: '#10b981', text: '#f59e0b', effects: '#ec4899', image: '#06b6d4',
};

// ─── Single Track Row (clips area only) ───────────────────────────────────────
const TrackClipsRow = memo(function TrackClipsRow({
  track, clipsWidth, allClips, height, collapsed,
}: {
  track: Track;
  clipsWidth: number;
  allClips: Clip[];
  height: number;
  collapsed: boolean;
}) {
  const { zoom, updateClip, setSelectedClip, selectedClipId, setShowTransitionPicker } =
    useEditorStore(useShallow((s) => ({
      zoom: s.zoom,
      updateClip: s.updateClip,
      setSelectedClip: s.setSelectedClip,
      selectedClipId: s.selectedClipId,
      setShowTransitionPicker: s.setShowTransitionPicker,
    })));

  const pxPerSec = zoom;
  const rowH     = collapsed ? 28 : height + 8;
  const color    = TRACK_COLORS[track.type] || '#6366f1';

  const [snapLine, setSnapLine] = useState<number | null>(null);

  const handleMove = useCallback((clip: Clip, newStart: number) => {
    updateClip(clip.id, { startTime: newStart });
  }, [updateClip]);

  const handleResize = useCallback((clip: Clip, edge: 'left' | 'right', newVal: number) => {
    if (edge === 'right') {
      updateClip(clip.id, { duration: Math.max(0.1, newVal - clip.startTime) });
    } else {
      const newDur = Math.max(0.1, clip.startTime + clip.duration - newVal);
      updateClip(clip.id, { startTime: newVal, duration: newDur });
    }
  }, [updateClip]);

  const sortedClips = useMemo(
    () => [...track.clips].sort((a, b) => a.startTime - b.startTime),
    [track.clips],
  );

  return (
    <div
      className="relative shrink-0"
      style={{
        width: clipsWidth,
        height: rowH,
        borderBottom: '1px solid #e5e7eb',
        background: collapsed ? '#f9fafb' : `${color}08`,
      }}
      onClick={() => setSelectedClip(null)}
    >
      {!collapsed && (
        <>
          {/* Subtle grid lines */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `repeating-linear-gradient(90deg, rgba(0,0,0,0.03) 0px, rgba(0,0,0,0.03) 1px, transparent 1px, transparent ${pxPerSec}px)`,
            }}
          />
          {/* Track color tint */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: `linear-gradient(90deg, ${color}10, transparent 40%)` }}
          />

          {/* Snap guide */}
          {snapLine !== null && (
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-40"
              style={{
                left: snapLine * pxPerSec,
                width: 1.5,
                background: '#fbbf24',
                boxShadow: '0 0 6px #fbbf24, 0 0 12px rgba(251,191,36,0.4)',
              }}
            />
          )}

          {/* Transition drop zones */}
          {sortedClips.map((clip, i) => {
            const next = sortedClips[i + 1];
            if (!next) return null;
            const gap = next.startTime - (clip.startTime + clip.duration);
            if (gap > 0.5) return null;
            return (
              <TransitionDropZone
                key={`tz-${clip.id}`}
                leftClip={clip}
                rightClip={next}
                pxPerSec={pxPerSec}
                onAdd={(e, clipId) => setShowTransitionPicker(true, { x: e.clientX, y: e.clientY }, clipId)}
              />
            );
          })}

          {/* Clips */}
          {track.clips.map((clip) => (
            <ClipBlock
              key={clip.id}
              clip={clip}
              pxPerSec={pxPerSec}
              trackHeight={height}
              isSelected={selectedClipId === clip.id}
              allClips={allClips}
              onSelect={() => setSelectedClip(clip.id)}
              onMove={(newStart) => handleMove(clip, newStart)}
              onResize={(edge, val) => handleResize(clip, edge, val)}
              onTransition={(e) =>
                setShowTransitionPicker(true, { x: e.clientX, y: e.clientY }, clip.id)
              }
              onSnapLine={setSnapLine}
            />
          ))}
        </>
      )}
    </div>
  );
});

// ─── Mini scroll bar ──────────────────────────────────────────────────────────
function MiniScrollBar({
  scrollRef, totalWidth,
}: {
  scrollRef: React.RefObject<HTMLDivElement>;
  totalWidth: number;
}) {
  const [thumb, setThumb] = useState({ left: 0, width: 30 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const viewRatio = el.clientWidth / Math.max(totalWidth, 1);
      const thumbW    = Math.max(6, viewRatio * 100);
      const maxScroll = totalWidth - el.clientWidth;
      const thumbL    = maxScroll > 0 ? (el.scrollLeft / maxScroll) * (100 - thumbW) : 0;
      setThumb({ left: thumbL, width: thumbW });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => { el.removeEventListener('scroll', update); obs.disconnect(); };
  }, [scrollRef, totalWidth]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect  = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    el.scrollLeft = ratio * totalWidth;
  }, [scrollRef, totalWidth]);

  return (
    <div
      className="relative cursor-pointer"
      style={{ height: MINIBAR_H, background: '#f3f4f6', borderTop: '1px solid #e5e7eb' }}
      onClick={handleClick}
    >
      <motion.div
        className="absolute top-[2px] bottom-[2px] rounded-full cursor-grab"
        style={{ left: `${thumb.left}%`, width: `${thumb.width}%`, background: '#d1d5db' }}
        whileHover={{ background: 'rgba(99,102,241,0.6)' }}
      />
    </div>
  );
}

// ─── Main Timeline ────────────────────────────────────────────────────────────
export default function Timeline() {
  const {
    project, setCurrentTime, currentTime, zoom, setZoom, addTrack, isPlaying,
  } = useEditorStore(useShallow((s) => ({
    project:        s.project,
    setCurrentTime: s.setCurrentTime,
    currentTime:    s.currentTime,
    zoom:           s.zoom,
    setZoom:        s.setZoom,
    addTrack:       s.addTrack,
    isPlaying:      s.isPlaying,
  })));

  const scrollRef      = useRef<HTMLDivElement>(null);
  const rulerScrollRef = useRef<HTMLDivElement>(null); // mirrors main scroll for ruler
  const outerRef       = useRef<HTMLDivElement>(null);
  const playheadRef    = useRef<PlayheadHandle>(null);
  const rulerPlayheadRef = useRef<HTMLDivElement>(null); // ruler's own playhead line

  // Use refs for values needed inside RAF callbacks to avoid stale closures
  const scrollLeftRef  = useRef(0);
  const pxPerSecRef    = useRef(zoom);
  const zoomRef        = useRef(zoom);  // always-fresh zoom for wheel handler
  const isPlayingRef   = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);

  const [scrollLeft, setScrollLeft]     = useState(0);
  const [containerW, setContainerW]     = useState(1200);
  const [panelH, setPanelH]             = useState(DEFAULT_PANEL_H);
  const [trackHeights, setTrackHeights] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed]       = useState<Record<string, boolean>>({});
  const [isResizingPanel, setIsResizingPanel] = useState(false);

  const pxPerSec   = zoom;
  const clipsWidth = Math.max(project.duration * pxPerSec + 800, 1200);
  const totalWidth = clipsWidth;
  const allClips   = useMemo(() => project.tracks.flatMap((t) => t.clips), [project]);

  // Keep refs up to date
  useEffect(() => { pxPerSecRef.current = zoom; zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  // Measure scroll container
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setContainerW(el.clientWidth));
    obs.observe(el);
    setContainerW(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  // Track scroll position — sync ruler scroll, update state+ref, move playhead
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const h = () => {
      const sl = el.scrollLeft;
      scrollLeftRef.current = sl;
      setScrollLeft(sl);
      // Mirror scroll into ruler scroll container
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = sl;
      // Also immediately reposition playhead DOM node
      const x = currentTimeRef.current * pxPerSecRef.current - sl;
      playheadRef.current?.moveTo(x, currentTimeRef.current);
    };
    el.addEventListener('scroll', h, { passive: true });
    return () => el.removeEventListener('scroll', h);
  }, []);

  // Playhead DOM update when currentTime changes (while paused / scrubbing)
  useEffect(() => {
    const x = currentTime * pxPerSec - scrollLeftRef.current;
    playheadRef.current?.moveTo(x, currentTime);
  }, [currentTime, pxPerSec]);

  // Subscribe to Zustand currentTime changes to imperatively move playhead during playback
  // This avoids re-rendering the whole Timeline on every time update
  useEffect(() => {
    return useEditorStore.subscribe((state) => {
      if (!isPlayingRef.current) return;
      const t  = state.currentTime;
      const x  = t * pxPerSecRef.current - scrollLeftRef.current;
      playheadRef.current?.moveTo(x, t);

      // Auto-scroll to follow playhead
      const el = scrollRef.current;
      if (el) {
        const viewEnd = el.scrollLeft + el.clientWidth;
        if (x > el.clientWidth - 80) {
          el.scrollLeft = t * pxPerSecRef.current - el.clientWidth / 2;
        } else if (x < 0) {
          el.scrollLeft = Math.max(0, t * pxPerSecRef.current - 40);
        }
      }
    });
  }, []);

  // Mouse wheel zoom (Ctrl/Cmd + scroll) — uses zoomRef to avoid stale closures
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const currentZoom = zoomRef.current;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const newZoom = Math.max(5, Math.min(800, currentZoom * factor));

        // Anchor zoom around mouse cursor position
        const rect = el.getBoundingClientRect();
        const mouseX = e.clientX - rect.left; // px offset inside scroll area
        const timeAtCursor = (el.scrollLeft + mouseX) / currentZoom;
        // After zoom, scroll so timeAtCursor stays under cursor
        const newScrollLeft = timeAtCursor * newZoom - mouseX;
        setZoom(newZoom);
        // Defer scroll update until after React re-render
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, newScrollLeft);
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // Only bind once — uses zoomRef internally
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setZoom]);

  const handleSeek = useCallback((t: number) => setCurrentTime(t), [setCurrentTime]);

  const handleFitZoom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const w   = el.clientWidth - 40;
    const dur = Math.max(project.duration, 1);
    setZoom(Math.max(5, Math.floor(w / dur)));
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollLeft = 0; });
  }, [project.duration, setZoom]);

  // Panel resize (drag top border)
  const handlePanelResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelH;
    setIsResizingPanel(true);
    const mm = (me: MouseEvent) => {
      const newH = Math.max(MIN_PANEL_H, Math.min(MAX_PANEL_H, startH - (me.clientY - startY)));
      setPanelH(newH);
    };
    const mu = () => {
      setIsResizingPanel(false);
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  }, [panelH]);

  const getTrackH    = (track: Track) => trackHeights[track.id] ?? track.height ?? (track.type === 'video' ? 56 : 44);
  const isCollapsed  = (track: Track) => collapsed[track.id] ?? false;

  const tracksHeight = useMemo(() => {
    return project.tracks.reduce((sum, t) => {
      return sum + (isCollapsed(t) ? 28 : getTrackH(t) + 8);
    }, 0);
  }, [project.tracks, trackHeights, collapsed]);

  const totalPlayheadHeight = RULER_H + tracksHeight;

  return (
    <div
      ref={outerRef}
      className="flex flex-col select-none"
      style={{
        height: panelH,
        background: '#ffffff',
        borderTop: '1px solid #e5e7eb',
        position: 'relative',
      }}
    >
      {/* ── Panel resize handle ── */}
      <div
        className="absolute top-0 left-0 right-0 z-50 group"
        style={{ height: 6, cursor: 'row-resize' }}
        onMouseDown={handlePanelResizeDown}
      >
        <div
          className="absolute top-[2px] left-1/2 -translate-x-1/2 rounded-full transition-all"
          style={{
            width: 40,
            height: 3,
            background: isResizingPanel ? '#6366f1' : '#d1d5db',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = '#6366f1';
            (e.currentTarget as HTMLElement).style.width = '60px';
          }}
          onMouseLeave={(e) => {
            if (!isResizingPanel) {
              (e.currentTarget as HTMLElement).style.background = '#d1d5db';
              (e.currentTarget as HTMLElement).style.width = '40px';
            }
          }}
        />
      </div>

      {/* ── Main area ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Fixed left panel ── */}
        <div
          className="flex flex-col shrink-0 z-20 overflow-hidden"
          style={{
            width: LABEL_W,
            minWidth: LABEL_W,
            background: '#ffffff',
            borderRight: '1px solid #e5e7eb',
          }}
        >
          {/* Corner block */}
          <div
            className="shrink-0 flex items-center justify-between px-2"
            style={{
              height: RULER_H,
              background: '#f8f9fa',
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: '#9ca3af' }}>
              Tracks
            </span>
            <div className="flex items-center gap-0.5">
              {(['video', 'audio', 'text', 'image'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => addTrack(type)}
                  title={`Add ${type} track`}
                  className="p-1 rounded transition-colors"
                  style={{ color: '#9ca3af' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = TRACK_COLORS[type])}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
                >
                  {type === 'video' ? <Video size={9} /> :
                   type === 'audio' ? <Music size={9} /> :
                   type === 'image' ? <ImageIcon size={9} /> :
                   <Type size={9} />}
                </button>
              ))}
            </div>
          </div>

          {/* Track panels */}
          <div className="flex-1 overflow-y-hidden overflow-x-hidden">
            {project.tracks.map((track) => (
              <TrackPanel
                key={track.id}
                track={track}
                height={getTrackH(track)}
                collapsed={isCollapsed(track)}
                onToggleCollapse={() => setCollapsed((prev) => ({ ...prev, [track.id]: !prev[track.id] }))}
                onHeightChange={(h) => setTrackHeights((prev) => ({ ...prev, [track.id]: h }))}
              />
            ))}
            {project.tracks.length === 0 && (
              <div
                className="flex flex-col items-center justify-center py-6 gap-2 opacity-40 cursor-pointer"
                onClick={() => addTrack('video')}
              >
                <Plus size={16} className="text-gray-400" />
                <span className="text-[9px] text-gray-400">Add track</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: ruler + scrollable clips stacked vertically ── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{ position: 'relative' }}>
          {/* ── Playhead (imperative update during playback) ── */}
          <Playhead
            ref={playheadRef}
            currentTime={currentTime}
            pxPerSec={pxPerSec}
            scrollLeft={scrollLeft}
            totalHeight="100%"
            onSeek={handleSeek}
          />
          {/* ── Ruler row — fixed height, scrolls horizontally in sync with clips ── */}
          <div
            ref={rulerScrollRef}
            style={{
              flexShrink: 0,
              height: RULER_H,
              overflowX: 'hidden',  // hidden — JS-synced to scrollRef
              overflowY: 'hidden',
              position: 'relative',
            }}
          >
            {/* Inner canvas matches clips width so ruler ticks align perfectly */}
            <div style={{ width: clipsWidth, minWidth: clipsWidth, height: RULER_H, position: 'relative' }}>
              <Ruler
                pxPerSec={pxPerSec}
                duration={project.duration}
                currentTime={currentTime}
                scrollLeft={scrollLeft}
                containerWidth={containerW}
                onSeek={handleSeek}
              />
            </div>
          </div>

          {/* ── Scrollable clips area (no ruler inside) ── */}
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-auto tl-scroll-area"
            style={{ position: 'relative', background: '#f8f9fa' }}
          >
            {/* Inner canvas */}
            <div
              style={{
                width: clipsWidth,
                minWidth: clipsWidth,
                position: 'relative',
                minHeight: '100%',
              }}
            >


              {/* ── Track clip rows ── */}
              {project.tracks.map((track) => (
                <TrackClipsRow
                  key={track.id}
                  track={track}
                  clipsWidth={clipsWidth}
                  allClips={allClips}
                  height={getTrackH(track)}
                  collapsed={isCollapsed(track)}
                />
              ))}

              {project.tracks.length === 0 && (
                <div
                  className="flex flex-col items-center justify-center gap-3 pointer-events-none"
                  style={{ paddingTop: 40, paddingBottom: 40, opacity: 0.4 }}
                >
                  <p className="text-xs text-gray-400">Drag media here or add a track</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Mini scroll bar ── */}
      <MiniScrollBar scrollRef={scrollRef as React.RefObject<HTMLDivElement>} totalWidth={clipsWidth} />

      {/* ── Bottom toolbar ── */}
      <div
        className="shrink-0 flex items-center gap-2 px-3"
        style={{
          height: TOOLBAR_H,
          background: '#f8f9fa',
          borderTop: '1px solid #e5e7eb',
        }}
      >
        <button
          onClick={() => setZoom(Math.max(5, zoom * 0.75))}
          className="px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors"
          style={{ color: '#6b7280' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          −
        </button>

        <div
          className="flex items-center gap-1 rounded px-1.5 py-0.5"
          style={{ background: '#f3f4f6', minWidth: 64, justifyContent: 'center' }}
        >
          <span className="text-[10px] font-mono" style={{ color: '#6b7280' }}>
            {Math.round(pxPerSec)}%
          </span>
        </div>

        <button
          onClick={() => setZoom(Math.min(800, zoom * 1.33))}
          className="px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors"
          style={{ color: '#6b7280' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          +
        </button>

        <button
          onClick={handleFitZoom}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
          style={{ color: '#6366f1' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99,102,241,0.08)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Maximize2 size={9} />
          Fit
        </button>

        <div className="flex-1" />

        <span className="font-mono text-[10px]" style={{ color: '#9ca3af' }}>
          {fmtTime(currentTime)}
        </span>

        <div className="flex items-center gap-1">
          {([
            { type: 'video' as const, Icon: Video, label: 'Video' },
            { type: 'audio' as const, Icon: Music, label: 'Audio' },
            { type: 'text' as const, Icon: Type, label: 'Text' },
          ]).map(({ type, Icon, label }) => (
            <button
              key={type}
              onClick={() => addTrack(type)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] transition-colors"
              style={{ color: '#9ca3af' }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = TRACK_COLORS[type];
                (e.currentTarget as HTMLElement).style.background = '#f3f4f6';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color = '#9ca3af';
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
              title={`Add ${label} track`}
            >
              <Plus size={7} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
