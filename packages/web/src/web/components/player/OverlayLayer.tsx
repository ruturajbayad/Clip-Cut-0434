/**
 * OverlayLayer — Interactive, moveable overlay elements.
 *
 * Renders CanvasElement wrappers for:
 *  - Active video clips (transparent hit area for drag/resize; actual video is in VideoLayer)
 *  - Active text clips (rendered text with animation presets)
 *  - Active image clips (rendered <img> as moveable/resizable overlays)
 *
 * Features:
 *  - 8-handle resize (corners + edges)
 *  - Rotation handle above selection
 *  - Aspect-ratio-locked resize with Shift key
 *  - Keyframe-aware dragging: if a property has keyframes, writes a keyframe
 *    at currentTime instead of setting the base clip property
 */

import { memo, useCallback } from 'react';
import { interpolateClip, useEditorStore, type Clip } from '../../store/editorStore';

// ── Text animation presets ────────────────────────────────────────────────────
function getTextAnimStyle(
  clip: Clip,
  currentTime: number,
): React.CSSProperties {
  const elapsed = currentTime - clip.startTime;
  const remaining = (clip.startTime + clip.duration) - currentTime;
  const fadeInDur = 0.4;
  const fadeOutDur = 0.3;

  const inProg  = Math.min(1, elapsed / fadeInDur);
  const outProg = Math.min(1, (fadeOutDur - remaining) / fadeOutDur);
  const opacity = inProg * (1 - Math.max(0, outProg));

  return { opacity };
}

// ── Entry transition style ────────────────────────────────────────────────────
const ENTRY_DUR = 0.5; // seconds

function getEntryTransitionStyle(clip: Clip, currentTime: number): React.CSSProperties {
  const entry = clip.entryTransition ?? 'none';
  if (entry === 'none') return {};

  const elapsed = currentTime - clip.startTime;
  if (elapsed >= ENTRY_DUR) return {};

  const t = Math.max(0, Math.min(1, elapsed / ENTRY_DUR)); // 0→1 over ENTRY_DUR

  switch (entry) {
    case 'fade-in':
      return { opacity: t };
    case 'slide-up': {
      const dy = (1 - t) * 40; // px offset
      return { opacity: t, transform: `translateY(${dy}px)` };
    }
    case 'slide-left': {
      const dx = (1 - t) * 60;
      return { opacity: t, transform: `translateX(${dx}px)` };
    }
    case 'zoom-in': {
      const scale = 0.6 + t * 0.4; // 0.6→1
      return { opacity: t, transform: `scale(${scale})` };
    }
    default:
      return {};
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Does this clip have any keyframes for any of these properties? */
function hasKeyframesFor(clip: Clip, props: string[]): boolean {
  if (!clip.keyframes || clip.keyframes.length === 0) return false;
  return props.some((p) => clip.keyframes!.some((k) => k.property === p));
}

interface CanvasElementProps {
  clip: Clip;
  isSelected: boolean;
  canvasW: number;
  canvasH: number;
  children: React.ReactNode;
  onSelect: () => void;
  isOverlay?: boolean;
  currentTime?: number;
}

export function CanvasElement({
  clip, isSelected, canvasW, canvasH, children, onSelect, isOverlay = false, currentTime = 0,
}: CanvasElementProps) {
  const updateClip = useEditorStore((s) => s.updateClip);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);

  const cx = (clip.x ?? 0.5) * canvasW;
  const cy = (clip.y ?? 0.5) * canvasH;
  const sw = (clip.scaleX ?? 1.0) * canvasW;
  const sh = (clip.scaleY ?? 1.0) * canvasH;
  const rotation = clip.rotation ?? 0;

  const startDrag = useCallback((e: React.MouseEvent) => {
    if (!isOverlay) return;
    if ((e.target as HTMLElement).dataset.handle) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    // Use current interpolated position as drag origin
    const ox = clip.x ?? 0.5, oy = clip.y ?? 0.5;
    const sx = e.clientX, sy = e.clientY;
    const keyed = hasKeyframesFor(clip, ['x', 'y']);
    const mm = (me: MouseEvent) => {
      const newX = Math.max(0, Math.min(1, ox + (me.clientX - sx) / canvasW));
      const newY = Math.max(0, Math.min(1, oy + (me.clientY - sy) / canvasH));
      if (keyed) {
        addKeyframe(clip.id, 'x', currentTime, newX);
        addKeyframe(clip.id, 'y', currentTime, newY);
      } else {
        updateClip(clip.id, { x: newX, y: newY });
      }
    };
    const mu = () => {
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', mu);
    };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
  }, [clip, canvasW, canvasH, updateClip, addKeyframe, onSelect, isOverlay, currentTime]);

  // 8 resize handles
  const HANDLES = isOverlay ? [
    { id: 'nw', cls: 'top-0 left-0 cursor-nw-resize', dx: -1, dy: -1, isEdge: false },
    { id: 'ne', cls: 'top-0 right-0 cursor-ne-resize', dx:  1, dy: -1, isEdge: false },
    { id: 'sw', cls: 'bottom-0 left-0 cursor-sw-resize', dx: -1, dy:  1, isEdge: false },
    { id: 'se', cls: 'bottom-0 right-0 cursor-se-resize', dx:  1, dy:  1, isEdge: false },
    { id: 'n', cls: 'top-0 left-1/2 -translate-x-1/2 cursor-n-resize', dx: 0, dy: -1, isEdge: true },
    { id: 's', cls: 'bottom-0 left-1/2 -translate-x-1/2 cursor-s-resize', dx: 0, dy:  1, isEdge: true },
    { id: 'w', cls: 'left-0 top-1/2 -translate-y-1/2 cursor-w-resize', dx: -1, dy:  0, isEdge: true },
    { id: 'e', cls: 'right-0 top-1/2 -translate-y-1/2 cursor-e-resize', dx:  1, dy:  0, isEdge: true },
  ] : [];

  return (
    <div
      className={`absolute select-none ${isSelected ? 'z-20' : 'z-10'}`}
      style={{
        left: cx - sw / 2,
        top: cy - sh / 2,
        width: sw,
        height: sh,
        cursor: isOverlay ? 'move' : 'default',
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'center center',
      }}
      onMouseDown={startDrag}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <div className="w-full h-full overflow-hidden"
        style={{ borderRadius: clip.type === 'text' ? 0 : 4 }}>
        {children}
      </div>

      {isSelected && (
        <>
          {/* Selection border */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              boxShadow: '0 0 0 1.5px rgba(255,255,255,0.9), 0 0 0 3px #3b82f6',
              borderRadius: 4,
              zIndex: 30,
            }}
          />

          {/* Resize handles — 8 total */}
          {HANDLES.map(({ id, cls, dx, dy, isEdge }) => (
            <div
              key={id}
              data-handle="1"
              className={`absolute z-30 ${cls}`}
              style={{
                width: isEdge ? 8 : 10,
                height: isEdge ? 8 : 10,
                background: 'white',
                border: '2px solid #3b82f6',
                borderRadius: isEdge ? 2 : 3,
                transform: `translate(${dx === -1 ? '-50%' : dx === 1 ? '50%' : '-50%'}, ${dy === -1 ? '-50%' : dy === 1 ? '50%' : '-50%'})`,
                pointerEvents: 'all',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const osx = clip.scaleX ?? 1, osy = clip.scaleY ?? 1;
                const ox = clip.x ?? 0.5, oy = clip.y ?? 0.5;
                const sx = e.clientX, sy = e.clientY;
                const lockAspect = e.shiftKey;
                const aspectRatio2 = osx / (osy || 1);
                const keyed = hasKeyframesFor(clip, ['scaleX', 'scaleY', 'x', 'y']);
                const mm = (me: MouseEvent) => {
                  let ddx = dx !== 0 ? (me.clientX - sx) * dx / canvasW : 0;
                  let ddy = dy !== 0 ? (me.clientY - sy) * dy / canvasH : 0;
                  if (lockAspect && dx !== 0 && dy !== 0) {
                    const avg = (Math.abs(ddx) + Math.abs(ddy)) / 2;
                    ddx = ddx >= 0 ? avg : -avg;
                    ddy = ddy >= 0 ? avg / aspectRatio2 * (osx / osy) : -avg / aspectRatio2 * (osx / osy);
                  }
                  const newSx = Math.max(0.05, osx + ddx);
                  const newSy = Math.max(0.05, osy + ddy);
                  const newX = Math.max(0, Math.min(1, ox + (dx !== 0 ? ddx / 2 : 0)));
                  const newY = Math.max(0, Math.min(1, oy + (dy !== 0 ? ddy / 2 : 0)));
                  if (keyed) {
                    addKeyframe(clip.id, 'scaleX', currentTime, newSx);
                    addKeyframe(clip.id, 'scaleY', currentTime, newSy);
                    addKeyframe(clip.id, 'x', currentTime, newX);
                    addKeyframe(clip.id, 'y', currentTime, newY);
                  } else {
                    updateClip(clip.id, { scaleX: newSx, scaleY: newSy, x: newX, y: newY });
                  }
                };
                const mu = () => {
                  window.removeEventListener('mousemove', mm);
                  window.removeEventListener('mouseup', mu);
                };
                window.addEventListener('mousemove', mm);
                window.addEventListener('mouseup', mu);
              }}
            />
          ))}

          {/* Rotation handle */}
          {isOverlay && (
            <div
              data-handle="rotate"
              className="absolute z-30"
              style={{
                width: 20,
                height: 20,
                background: '#3b82f6',
                borderRadius: '50%',
                top: -32,
                left: '50%',
                transform: 'translateX(-50%)',
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'all',
                boxShadow: '0 2px 6px rgba(59,130,246,0.5)',
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
                const startRot = rotation;
                const keyed = hasKeyframesFor(clip, ['rotation']);
                const mm = (me: MouseEvent) => {
                  const angle = Math.atan2(me.clientY - cy, me.clientX - cx) * (180 / Math.PI);
                  const newRot = startRot + (angle - startAngle);
                  if (keyed) {
                    addKeyframe(clip.id, 'rotation', currentTime, newRot);
                  } else {
                    updateClip(clip.id, { rotation: newRot });
                  }
                };
                const mu = () => {
                  window.removeEventListener('mousemove', mm);
                  window.removeEventListener('mouseup', mu);
                };
                window.addEventListener('mousemove', mm);
                window.addEventListener('mouseup', mu);
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
            </div>
          )}

          {/* Line from element to rotation handle */}
          {isOverlay && (
            <div
              className="absolute pointer-events-none"
              style={{
                width: 1,
                height: 24,
                background: '#3b82f6',
                top: -24,
                left: '50%',
                transform: 'translateX(-50%)',
                opacity: 0.6,
              }}
            />
          )}

          {/* Clip name label */}
          <div className="absolute -top-6 left-0 text-[9px] bg-blue-600 text-white px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none z-30 font-medium">
            {clip.name}
          </div>
        </>
      )}
    </div>
  );
}

interface OverlayLayerProps {
  activeVideoClips: Clip[];
  activeTextClips: Clip[];
  activeImageClips: Clip[];
  overlayVideoClips: Clip[];
  currentTime: number;
  canvasW: number;
  canvasH: number;
  selectedClipId: string | null;
  onSelect: (id: string | null) => void;
  mediaLibrary: { id: string; src: string }[];
}

export const OverlayLayer = memo(function OverlayLayer({
  activeVideoClips,
  activeTextClips,
  activeImageClips,
  overlayVideoClips,
  currentTime,
  canvasW,
  canvasH,
  selectedClipId,
  onSelect,
  mediaLibrary,
}: OverlayLayerProps) {
  const overlayIds = new Set(overlayVideoClips.map((c) => c.id));

  return (
    <>
      {/* Video hit areas — ALL video clips are moveable/resizable (including main track) */}
      {activeVideoClips.map((clip) => {
        const interp = interpolateClip(clip, currentTime);
        const liveClip = Object.keys(interp).length > 0 ? { ...clip, ...interp } : clip;
        const isSelected = selectedClipId === clip.id;

        return (
          <CanvasElement
            key={clip.id}
            clip={liveClip}
            isSelected={isSelected}
            canvasW={canvasW}
            canvasH={canvasH}
            onSelect={() => onSelect(clip.id)}
            isOverlay={true}
            currentTime={currentTime}
          >
            {/* Transparent hit area — actual video is in VideoLayer below */}
            <div className="w-full h-full" style={{ background: 'transparent' }} />
          </CanvasElement>
        );
      })}

      {/* Image clips — rendered as <img> overlays, fully draggable/resizable/rotatable */}
      {activeImageClips.map((clip) => {
        const interp = interpolateClip(clip, currentTime);
        const liveClip = Object.keys(interp).length > 0 ? { ...clip, ...interp } : clip;
        const mediaSrc = clip.src ||
          (clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId)?.src : undefined);
        const entryStyle = getEntryTransitionStyle(liveClip, currentTime);

        return (
          <CanvasElement
            key={clip.id}
            clip={liveClip}
            isSelected={selectedClipId === clip.id}
            canvasW={canvasW}
            canvasH={canvasH}
            onSelect={() => onSelect(clip.id)}
            isOverlay
            currentTime={currentTime}
          >
            {mediaSrc ? (
              <img
                src={mediaSrc}
                alt={clip.name}
                className="w-full h-full"
                style={{
                  ...entryStyle,
                  objectFit: 'contain',
                  opacity: entryStyle.opacity !== undefined ? entryStyle.opacity : (liveClip.opacity ?? 1),
                  pointerEvents: 'none',
                  userSelect: 'none',
                  display: 'block',
                  mixBlendMode: (liveClip.blendMode as React.CSSProperties['mixBlendMode']) || 'normal',
                  filter: (() => {
                    const EFFECT_FILTERS: Record<string, string> = {
                      blur: 'blur(4px)',
                      vhs: 'saturate(1.3) contrast(1.1) sepia(0.15) hue-rotate(-5deg)',
                      glitch: 'hue-rotate(90deg) saturate(2) contrast(1.5)',
                      bw: 'grayscale(1)',
                      cinematic: 'contrast(1.2) saturate(0.85) brightness(0.9) sepia(0.15)',
                      bloom: 'brightness(1.3) contrast(0.9) saturate(1.2) blur(0.5px)',
                      grain: 'contrast(1.1) saturate(0.9) brightness(1.05)',
                      chromatic: 'hue-rotate(5deg) saturate(1.5) contrast(1.1)',
                    };
                    if (liveClip.effect && EFFECT_FILTERS[liveClip.effect]) return EFFECT_FILTERS[liveClip.effect];
                    if (liveClip.filterCss) return liveClip.filterCss;
                    return [
                      liveClip.brightness !== undefined && liveClip.brightness !== 100 ? `brightness(${liveClip.brightness}%)` : '',
                      liveClip.contrast !== undefined && liveClip.contrast !== 100 ? `contrast(${liveClip.contrast}%)` : '',
                      liveClip.saturation !== undefined && liveClip.saturation !== 100 ? `saturate(${liveClip.saturation}%)` : '',
                      liveClip.blur !== undefined && liveClip.blur !== 0 ? `blur(${liveClip.blur}px)` : '',
                    ].filter(Boolean).join(' ') || undefined;
                  })(),
                }}
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center rounded"
                style={{ background: `${clip.thumbnailColor || '#818CF8'}44` }}
              >
                <span className="text-white text-xs opacity-60">IMG</span>
              </div>
            )}
          </CanvasElement>
        );
      })}

      {/* Text clips — fully rendered here with animation */}
      {activeTextClips.map((clip) => {
        const interp = interpolateClip(clip, currentTime);
        const liveClip = Object.keys(interp).length > 0 ? { ...clip, ...interp } : clip;
        const fontSize = Math.max(10, (liveClip.fontSize || 72) * canvasW / 1920);
        const animStyle = getTextAnimStyle(liveClip, currentTime);
        const entryStyle = getEntryTransitionStyle(liveClip, currentTime);
        // Merge: entry transition overrides fade-in from animStyle if set
        const mergedStyle = Object.keys(entryStyle).length > 0 ? { ...animStyle, ...entryStyle } : animStyle;

        // Build text-shadow from preset key or raw CSS
        const textShadow = (() => {
          const ts = liveClip.textShadow;
          if (!ts || ts === 'none') return undefined;
          if (ts === 'soft')   return '0 2px 8px rgba(0,0,0,0.6)';
          if (ts === 'hard')   return '2px 2px 0px rgba(0,0,0,0.9)';
          if (ts === 'glow')   return `0 0 12px ${liveClip.color || '#fff'}, 0 0 24px ${liveClip.color || '#fff'}`;
          if (ts === 'neon')   return `0 0 6px #fff, 0 0 12px ${liveClip.color || '#fff'}, 0 0 30px ${liveClip.color || '#fff'}`;
          return ts; // raw CSS
        })();

        // Build WebKit text stroke for outline
        const webkitTextStroke = liveClip.textOutline && liveClip.textOutlineWidth
          ? `${liveClip.textOutlineWidth}px ${liveClip.textOutline}`
          : undefined;

        return (
          <CanvasElement
            key={clip.id}
            clip={liveClip}
            isSelected={selectedClipId === clip.id}
            canvasW={canvasW}
            canvasH={canvasH}
            onSelect={() => onSelect(clip.id)}
            isOverlay
            currentTime={currentTime}
          >
            <div
              className="w-full h-full flex items-center"
              style={{
                ...mergedStyle,
                justifyContent:
                  liveClip.textAlign === 'left' ? 'flex-start' :
                  liveClip.textAlign === 'right' ? 'flex-end' : 'center',
                backgroundColor: liveClip.textBackground || 'transparent',
                borderRadius: liveClip.textBackground ? 4 : 0,
                padding: '4px 8px',
              }}
            >
              <span
                style={{
                  fontFamily: liveClip.fontFamily || 'Inter',
                  fontSize,
                  color: liveClip.color || '#FFFFFF',
                  fontWeight: liveClip.fontWeight || 'bold',
                  fontStyle: liveClip.fontStyle || 'normal',
                  letterSpacing: liveClip.letterSpacing ? `${liveClip.letterSpacing * canvasW / 1920}px` : undefined,
                  lineHeight: liveClip.lineHeight || 1.2,
                  textShadow,
                  WebkitTextStroke: webkitTextStroke,
                  textTransform: liveClip.textUppercase ? 'uppercase' : 'none',
                  textAlign: liveClip.textAlign || 'center',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  display: 'block',
                  width: '100%',
                }}
              >
                {liveClip.text || 'Text'}
              </span>
            </div>
          </CanvasElement>
        );
      })}
    </>
  );
});
