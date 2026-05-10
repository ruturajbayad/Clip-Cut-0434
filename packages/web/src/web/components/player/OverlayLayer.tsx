/**
 * OverlayLayer — Interactive, moveable overlay elements.
 *
 * Renders CanvasElement wrappers for:
 *  - Active video clips (transparent hit area for drag/resize; actual video is in VideoLayer)
 *  - Active text clips (rendered text)
 *  - Active image clips (rendered <img> as moveable/resizable overlays)
 *
 * This layer re-renders at ~15fps via currentTime subscription (acceptable since
 * it's only a thin CSS/SVG overlay, not video decoding).
 *
 * Overlay videos are DRAGGABLE and RESIZABLE — unlike the main video which fills
 * the full canvas.
 */

import { memo, useCallback } from 'react';
import { interpolateClip, useEditorStore, type Clip } from '../../store/editorStore';

interface CanvasElementProps {
  clip: Clip;
  isSelected: boolean;
  canvasW: number;
  canvasH: number;
  children: React.ReactNode;
  onSelect: () => void;
  isOverlay?: boolean; // overlay clips CAN be moved (default: false = fills canvas)
}

export function CanvasElement({
  clip, isSelected, canvasW, canvasH, children, onSelect, isOverlay = false,
}: CanvasElementProps) {
  const updateClip = useEditorStore((s) => s.updateClip);
  const cx = (clip.x ?? 0.5) * canvasW;
  const cy = (clip.y ?? 0.5) * canvasH;
  const sw = (clip.scaleX ?? 1.0) * canvasW;
  const sh = (clip.scaleY ?? 1.0) * canvasH;

  const startDrag = useCallback((e: React.MouseEvent) => {
    if (!isOverlay) return; // main video is locked
    if ((e.target as HTMLElement).dataset.handle) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    const ox = clip.x ?? 0.5, oy = clip.y ?? 0.5;
    const sx = e.clientX, sy = e.clientY;
    const mm = (me: MouseEvent) => updateClip(clip.id, {
      x: Math.max(0, Math.min(1, ox + (me.clientX - sx) / canvasW)),
      y: Math.max(0, Math.min(1, oy + (me.clientY - sy) / canvasH)),
    });
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
  }, [clip.id, clip.x, clip.y, canvasW, canvasH, updateClip, onSelect, isOverlay]);

  return (
    <div
      className={`absolute select-none ${isSelected ? 'z-20' : 'z-10'}`}
      style={{
        left: cx - sw / 2,
        top: cy - sh / 2,
        width: sw,
        height: sh,
        cursor: isOverlay ? 'move' : 'default',
      }}
      onMouseDown={startDrag}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <div className="w-full h-full overflow-hidden rounded">{children}</div>

      {isSelected && (
        <>
          <div
            className="absolute inset-0 rounded pointer-events-none"
            style={{ boxShadow: '0 0 0 2px #fff, 0 0 0 3px #6366f1', zIndex: 30 }}
          />

          {/* Resize handles — only for overlay/text/image clips */}
          {isOverlay && ([
            { cls: 'top-0 left-0 cursor-nw-resize', dx: -1, dy: -1 },
            { cls: 'top-0 right-0 cursor-ne-resize', dx: 1, dy: -1 },
            { cls: 'bottom-0 left-0 cursor-sw-resize', dx: -1, dy: 1 },
            { cls: 'bottom-0 right-0 cursor-se-resize', dx: 1, dy: 1 },
          ] as const).map(({ cls, dx, dy }, i) => (
            <div
              key={i}
              data-handle="1"
              className={`absolute w-3 h-3 bg-white border-2 border-indigo-500 rounded-sm z-30 ${cls}`}
              style={{
                transform: `translate(${dx === -1 ? '-50%' : '50%'}, ${dy === -1 ? '-50%' : '50%'})`,
                pointerEvents: 'all',
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const osx = clip.scaleX ?? 1, osy = clip.scaleY ?? 1;
                const ox = clip.x ?? 0.5, oy = clip.y ?? 0.5;
                const sx = e.clientX, sy = e.clientY;
                const mm = (me: MouseEvent) => {
                  const ddx = (me.clientX - sx) * dx / canvasW;
                  const ddy = (me.clientY - sy) * dy / canvasH;
                  updateClip(clip.id, {
                    scaleX: Math.max(0.05, osx + ddx),
                    scaleY: Math.max(0.05, osy + ddy),
                    x: Math.max(0, Math.min(1, ox + ddx / 2)),
                    y: Math.max(0, Math.min(1, oy + ddy / 2)),
                  });
                };
                const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
                window.addEventListener('mousemove', mm);
                window.addEventListener('mouseup', mu);
              }}
            />
          ))}

          <div className="absolute -top-5 left-0 text-[9px] bg-indigo-600 text-white px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none z-30">
            {clip.name}
          </div>
        </>
      )}
    </div>
  );
}

interface OverlayLayerProps {
  activeVideoClips: Clip[];   // video clips active at currentTime
  activeTextClips: Clip[];    // text clips active at currentTime
  activeImageClips: Clip[];   // image clips active at currentTime (rendered as <img> overlays)
  overlayVideoClips: Clip[];  // video clips that are overlays (not main track)
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
      {/* Video hit areas (overlay clips are moveable) */}
      {activeVideoClips.map((clip) => {
        const interp = interpolateClip(clip, currentTime);
        const liveClip = Object.keys(interp).length > 0 ? { ...clip, ...interp } : clip;
        const isSelected = selectedClipId === clip.id;
        const isOverlay = overlayIds.has(clip.id);

        return (
          <CanvasElement
            key={clip.id}
            clip={liveClip}
            isSelected={isSelected}
            canvasW={canvasW}
            canvasH={canvasH}
            onSelect={() => onSelect(clip.id)}
            isOverlay={isOverlay}
          >
            {/* Transparent hit area — real video is in VideoLayer below */}
            <div className="w-full h-full" style={{ background: 'transparent' }} />
          </CanvasElement>
        );
      })}

      {/* Image clips — rendered as <img> overlays, fully draggable/resizable */}
      {activeImageClips.map((clip) => {
        const interp = interpolateClip(clip, currentTime);
        const liveClip = Object.keys(interp).length > 0 ? { ...clip, ...interp } : clip;
        const mediaSrc = clip.src ||
          (clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId)?.src : undefined);

        return (
          <CanvasElement
            key={clip.id}
            clip={liveClip}
            isSelected={selectedClipId === clip.id}
            canvasW={canvasW}
            canvasH={canvasH}
            onSelect={() => onSelect(clip.id)}
            isOverlay
          >
            {mediaSrc ? (
              <img
                src={mediaSrc}
                alt={clip.name}
                className="w-full h-full"
                style={{
                  objectFit: 'contain',
                  opacity: liveClip.opacity ?? 1,
                  pointerEvents: 'none',
                  userSelect: 'none',
                  display: 'block',
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

      {/* Text clips — fully rendered here */}
      {activeTextClips.map((clip) => {
        const interp = interpolateClip(clip, currentTime);
        const liveClip = Object.keys(interp).length > 0 ? { ...clip, ...interp } : clip;
        const fontSize = Math.max(10, (liveClip.fontSize || 72) * canvasW / 1920);

        return (
          <CanvasElement
            key={clip.id}
            clip={liveClip}
            isSelected={selectedClipId === clip.id}
            canvasW={canvasW}
            canvasH={canvasH}
            onSelect={() => onSelect(clip.id)}
            isOverlay
          >
            <div
              className="w-full h-full flex items-center justify-center"
              style={{
                fontFamily: liveClip.fontFamily || 'Inter',
                fontSize,
                color: liveClip.color || '#FFFFFF',
                fontWeight: 700,
                textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                pointerEvents: 'none',
                userSelect: 'none',
                opacity: liveClip.opacity ?? 1,
              }}
            >
              {liveClip.text || 'Text'}
            </div>
          </CanvasElement>
        );
      })}
    </>
  );
});
