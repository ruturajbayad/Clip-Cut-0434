import { useState, useCallback, memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Scissors, Copy, Trash2, ArrowLeftRight, Film,
  RotateCcw, Gauge, Volume2,
} from 'lucide-react';
import { useEditorStore, type Clip } from '../../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';
import { computeSnapTargets, snapToTargets } from '../utils/snap';
import { useAudioPeaks } from '../utils/audioWaveform';
import { fmtTime } from '../utils/time';

// Light-theme clip colors
const CLIP_STYLES: Record<string, {
  border: string; bg: string; bgSelected: string;
  wave: string; label: string; accent: string;
}> = {
  video: {
    border: '#3b82f6',
    bg: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
    bgSelected: 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)',
    wave: '#818cf8',
    label: '#4338ca',
    accent: '#3b82f6',
  },
  audio: {
    border: '#10b981',
    bg: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
    bgSelected: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)',
    wave: '#34d399',
    label: '#065f46',
    accent: '#10b981',
  },
  text: {
    border: '#f59e0b',
    bg: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
    bgSelected: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
    wave: '#fbbf24',
    label: '#92400e',
    accent: '#f59e0b',
  },
  effects: {
    border: '#ec4899',
    bg: 'linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%)',
    bgSelected: 'linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)',
    wave: '#f472b6',
    label: '#9d174d',
    accent: '#ec4899',
  },
  image: {
    border: '#06b6d4',
    bg: 'linear-gradient(135deg, #ecfeff 0%, #cffafe 100%)',
    bgSelected: 'linear-gradient(135deg, #cffafe 0%, #a5f3fc 100%)',
    wave: '#22d3ee',
    label: '#0e7490',
    accent: '#06b6d4',
  },
};

interface ClipBlockProps {
  clip: Clip;
  pxPerSec: number;
  trackHeight: number;
  isSelected: boolean;
  allClips: Clip[];
  onSelect: () => void;
  onMove: (newStart: number) => void;
  onResize: (edge: 'left' | 'right', newVal: number) => void;
  onTransition: (e: React.MouseEvent) => void;
  onSnapLine: (t: number | null) => void;
}

export const ClipBlock = memo(function ClipBlock({
  clip, pxPerSec, trackHeight, isSelected, allClips,
  onSelect, onMove, onResize, onTransition, onSnapLine,
}: ClipBlockProps) {
  const { removeClip, splitClip, addClip, updateClip } = useEditorStore(useShallow((s) => ({
    removeClip: s.removeClip,
    splitClip: s.splitClip,
    addClip: s.addClip,
    updateClip: s.updateClip,
  })));

  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const st = CLIP_STYLES[clip.type] || CLIP_STYLES.video;
  const left  = clip.startTime * pxPerSec;
  const width = Math.max(20, clip.duration * pxPerSec);



  // ── Move drag ──────────────────────────────────────────────────────────────
  const handleMoveDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    onSelect();
    const startX = e.clientX;
    const origStart = clip.startTime;
    setIsDragging(true);
    const mm = (me: MouseEvent) => {
      const raw = Math.max(0, origStart + (me.clientX - startX) / pxPerSec);
      const targets = computeSnapTargets(allClips, clip.id, useEditorStore.getState().currentTime);
      const { snapped, snapLine } = snapToTargets(raw, targets, pxPerSec);
      onSnapLine(snapLine);
      onMove(snapped);
    };
    const mu = () => {
      setIsDragging(false);
      onSnapLine(null);
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  }, [clip, pxPerSec, allClips, onMove, onSelect, onSnapLine]);

  // ── Left resize ────────────────────────────────────────────────────────────
  const handleLeftDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const origStart = clip.startTime;
    const mm = (me: MouseEvent) => {
      const raw = Math.max(0, origStart + (me.clientX - startX) / pxPerSec);
      const targets = computeSnapTargets(allClips, clip.id, useEditorStore.getState().currentTime);
      const { snapped, snapLine } = snapToTargets(raw, targets, pxPerSec);
      onSnapLine(snapLine);
      onResize('left', snapped);
    };
    const mu = () => { onSnapLine(null); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  }, [clip, pxPerSec, allClips, onResize, onSnapLine]);

  // ── Right resize ───────────────────────────────────────────────────────────
  const handleRightDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const origEnd = clip.startTime + clip.duration;
    const mm = (me: MouseEvent) => {
      const raw = Math.max(clip.startTime + 0.1, origEnd + (me.clientX - startX) / pxPerSec);
      const targets = computeSnapTargets(allClips, clip.id, useEditorStore.getState().currentTime);
      const { snapped, snapLine } = snapToTargets(raw, targets, pxPerSec);
      onSnapLine(snapLine);
      onResize('right', snapped);
    };
    const mu = () => { onSnapLine(null); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  }, [clip, pxPerSec, allClips, onResize, onSnapLine]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setShowMenu(true);
  }, []);

  const thumbnailCount = Math.min(16, Math.max(1, Math.floor(width / 36)));
  const waveBarCount   = Math.min(300, Math.max(10, Math.floor(width / 4)));
  const peaks = useAudioPeaks(clip.src, clip.id, waveBarCount, clip.duration);

  return (
    <>
      <div
        className="absolute select-none group"
        style={{
          left,
          width,
          top: 2,
          bottom: 2,
          zIndex: isSelected ? 20 : 10,
        }}
        onMouseDown={handleMoveDown}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        onContextMenu={handleContextMenu}
      >
        {/* Clip card */}
        <div
          className="h-full rounded-[5px] overflow-hidden relative"
          style={{
            background: isSelected ? st.bgSelected : st.bg,
            border: `1.5px solid ${isSelected ? st.border : `${st.border}50`}`,
            boxShadow: isSelected
              ? `0 0 0 2px ${st.border}40, 0 2px 8px rgba(0,0,0,0.12)`
              : isDragging
              ? `0 4px 16px rgba(0,0,0,0.15)`
              : `0 1px 3px rgba(0,0,0,0.07)`,
            cursor: isDragging ? 'grabbing' : 'grab',
            transition: 'border-color 0.1s, box-shadow 0.12s',
          }}
        >
          {/* Left accent bar */}
          <div
            className="absolute left-0 inset-y-0 w-[3px] rounded-l-[4px]"
            style={{ background: st.border }}
          />

          {/* Left / Right Fade Handles (Modern Editing UI styling) */}
          {width > 20 && (
            <>
              <div className="absolute top-0 left-[4px] w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-gray-400">
                  <path d="M0 0 H10 C10 0 5 5 0 10 Z" fill="currentColor" className="opacity-40" />
                  <circle cx="2" cy="2" r="1.2" fill="#fff" />
                </svg>
              </div>
              <div className="absolute top-0 right-[1px] w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-gray-400">
                  <path d="M10 0 H0 C0 0 5 5 10 10 Z" fill="currentColor" className="opacity-40" />
                  <circle cx="8" cy="2" r="1.2" fill="#fff" />
                </svg>
              </div>
            </>
          )}

          {/* VIDEO: filmstrip */}
          {clip.type === 'video' && width > 28 && (
            <div className="absolute inset-0 left-[3px] flex overflow-hidden pointer-events-none">
              {Array.from({ length: thumbnailCount }).map((_, i) => (
                <div
                  key={i}
                  className="h-full shrink-0 relative flex items-center justify-center"
                  style={{
                    width: Math.max(28, (width - 3) / thumbnailCount),
                    borderRight: i < thumbnailCount - 1 ? `1px solid ${st.border}20` : 'none',
                    background: clip.thumbnailColor
                      ? `${clip.thumbnailColor}18`
                      : `${st.border}12`,
                  }}
                >
                  <Film size={8} style={{ color: st.wave, opacity: 0.5 }} />
                </div>
              ))}
            </div>
          )}

          {/* AUDIO: waveform */}
          {clip.type === 'audio' && (
            <div
              className="absolute inset-0 left-[4px] right-[1px] flex items-center justify-between overflow-hidden pointer-events-none"
              style={{ padding: '3px 0px' }}
            >
              {peaks.map((h, i) => (
                <div
                  key={i}
                  className="shrink-0 rounded-full"
                  style={{ width: 1.5, height: `${Math.min(92, 12 + h * 76)}%`, background: st.wave, opacity: 0.7 }}
                />
              ))}
            </div>
          )}

          {/* TEXT: preview */}
          {clip.type === 'text' && clip.text && width > 40 && (
            <div
              className="absolute inset-0 left-4 flex items-center pointer-events-none"
              style={{ color: st.label, fontSize: 9.5, fontWeight: 700, opacity: 0.7 }}
            >
              <span className="truncate">{clip.text.slice(0, 30)}</span>
            </div>
          )}

          {/* Clip name + duration label */}
          <div
            className="absolute bottom-0 left-[4px] right-0 flex items-center gap-1 pointer-events-none"
            style={{ padding: '2px 4px 2px 0' }}
          >
            {width > 40 && (
              <span
                className="text-[9px] font-semibold truncate leading-none"
                style={{ color: st.label }}
              >
                {clip.name}
              </span>
            )}
            {width > 80 && (
              <span className="text-[8px] font-mono shrink-0 opacity-50" style={{ color: st.label }}>
                {clip.duration.toFixed(1)}s
              </span>
            )}
          </div>

          {/* Selected time badge */}
          {isSelected && (
            <div
              className="absolute font-mono text-white text-[8px] rounded px-1.5 py-0.5 whitespace-nowrap pointer-events-none shadow-md"
              style={{
                bottom: 'calc(100% + 3px)',
                left: 0,
                background: st.border,
                zIndex: 50,
              }}
            >
              {fmtTime(clip.startTime)} → {fmtTime(clip.startTime + clip.duration)}
            </div>
          )}

          {/* Keyframe diamond markers — shown as small ◆ icons along the clip */}
          {clip.keyframes && clip.keyframes.length > 0 && (
            <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
              {clip.keyframes.map((kf) => {
                const relTime = kf.time - clip.startTime;
                const xPos = (relTime / clip.duration) * 100;
                if (xPos < 0 || xPos > 100) return null;
                return (
                  <div
                    key={kf.id}
                    className="absolute -translate-x-1/2"
                    style={{
                      left: `${xPos}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 6,
                      height: 6,
                      background: '#3b82f6',
                      borderRadius: 1,
                      rotate: '45deg',
                      opacity: 0.85,
                      boxShadow: '0 0 0 1px rgba(255,255,255,0.8)',
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Visual transition wedge */}
          {clip.transition && (
            <div
              className="absolute right-0 top-0 bottom-0 pointer-events-none rounded-r-[4px]"
              style={{
                width: Math.min(width, 0.5 * pxPerSec),
                background: 'linear-gradient(to top left, rgba(236,72,153,0.2) 0%, transparent 100%)',
                borderRight: '1.5px solid rgba(236,72,153,0.6)',
              }}
            />
          )}

          {/* Transition dot / button */}
          <div
            className="absolute right-1 top-1/2 -translate-y-1/2 z-30 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ opacity: clip.transition ? 1 : undefined }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onTransition(e); }}
              className="w-[20px] h-[20px] rounded-md flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-md border"
              style={{
                background: clip.transition 
                  ? 'linear-gradient(135deg, #ec4899, #8b5cf6)' 
                  : 'rgba(255,255,255,0.9)',
                borderColor: clip.transition ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
                boxShadow: clip.transition ? '0 2px 6px rgba(236,72,153,0.4)' : '0 2px 4px rgba(0,0,0,0.06)',
              }}
              title={clip.transition ? `Transition: ${clip.transition}` : 'Add transition'}
            >
              <ArrowLeftRight size={9} style={{ color: clip.transition ? '#fff' : '#4b5563' }} />
            </button>
          </div>
        </div>

        {/* Resize handles */}
        <div
          className="absolute left-0 inset-y-0 w-[6px] cursor-ew-resize z-30 group/lh flex items-center justify-center"
          onMouseDown={handleLeftDown}
        >
          <div className="w-[2px] h-[12px] rounded-full opacity-0 group-hover/lh:opacity-100 transition-opacity bg-white shadow" />
        </div>
        <div
          className="absolute right-0 inset-y-0 w-[6px] cursor-ew-resize z-30 group/rh flex items-center justify-center"
          onMouseDown={handleRightDown}
        >
          <div className="w-[2px] h-[12px] rounded-full opacity-0 group-hover/rh:opacity-100 transition-opacity bg-white shadow" />
        </div>
      </div>

      {/* Context menu */}
      <AnimatePresence>
        {showMenu && (
          <>
            <div className="fixed inset-0 z-[100]" onClick={() => setShowMenu(false)} onContextMenu={(e) => { e.preventDefault(); setShowMenu(false); }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.93, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: -4 }}
              transition={{ duration: 0.1 }}
              className="fixed z-[101] rounded-xl overflow-hidden py-1.5"
              style={{
                left: Math.min(menuPos.x, window.innerWidth - 210),
                top: Math.min(menuPos.y, window.innerHeight - 280),
                width: 200,
                background: 'rgba(255,255,255,0.97)',
                border: '1px solid rgba(0,0,0,0.1)',
                boxShadow: '0 12px 32px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08)',
                backdropFilter: 'blur(16px)',
              }}
            >
              <CtxItem icon={<Scissors size={11} className="text-gray-400" />} label="Split at playhead" shortcut="S"
                onClick={() => { splitClip(clip.id, useEditorStore.getState().currentTime); setShowMenu(false); }} />
              <CtxItem icon={<Copy size={11} className="text-gray-400" />} label="Duplicate"
                onClick={() => { addClip(clip.trackId, { ...clip, id: undefined as any, startTime: clip.startTime + clip.duration }); setShowMenu(false); }} />
              <CtxItem icon={<ArrowLeftRight size={11} className="text-pink-400" />} label={clip.transition ? 'Change transition' : 'Add transition'}
                onClick={(e) => { onTransition(e as any); setShowMenu(false); }} />
              {clip.transition && (
                <CtxItem icon={<ArrowLeftRight size={11} className="text-orange-400" />} label="Remove transition"
                  onClick={() => { updateClip(clip.id, { transition: undefined }); setShowMenu(false); }} />
              )}
              {clip.type === 'audio' && (
                <CtxItem icon={<Volume2 size={11} className="text-green-500" />} label="Detach audio"
                  onClick={() => setShowMenu(false)} />
              )}
              <CtxItem icon={<Gauge size={11} className="text-blue-400" />} label="Speed / duration"
                onClick={() => setShowMenu(false)} />
              <CtxItem icon={<RotateCcw size={11} className="text-purple-400" />} label="Reverse"
                onClick={() => setShowMenu(false)} />
              <div className="mx-3 my-1 h-px bg-gray-100" />
              <CtxItem icon={<Trash2 size={11} className="text-red-400" />} label="Delete" danger
                onClick={() => { removeClip(clip.id); setShowMenu(false); }} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
});

function CtxItem({
  icon, label, shortcut, onClick, danger = false,
}: {
  icon: React.ReactNode; label: string; shortcut?: string;
  onClick: (e: React.MouseEvent) => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-[7px] text-[11px] font-medium transition-colors text-left
        ${danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[9px] opacity-30 font-mono">{shortcut}</span>}
    </button>
  );
}
