import { memo } from 'react';
import { Plus } from 'lucide-react';
import { type Clip } from '../../../store/editorStore';

interface TransitionDropZoneProps {
  leftClip: Clip;
  rightClip: Clip;
  pxPerSec: number;
  onAdd: (e: React.MouseEvent, clipId: string) => void;
}

/**
 * Renders a "+" button between two adjacent clips on the same track.
 * Positioned at the junction between them.
 */
export const TransitionDropZone = memo(function TransitionDropZone({
  leftClip, rightClip, pxPerSec, onAdd,
}: TransitionDropZoneProps) {
  const gapX = leftClip.startTime + leftClip.duration;
  const x = gapX * pxPerSec;
  const hasTransition = !!leftClip.transition;

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 z-30 pointer-events-auto group"
      style={{ left: x - 10, width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {hasTransition ? (
        /* Transition block indicator */
        <div
          className="rounded-sm cursor-pointer hover:opacity-100 opacity-80 transition-opacity"
          style={{
            width: 14,
            height: 20,
            background: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 0 8px rgba(236,72,153,0.5)',
          }}
          onClick={(e) => { e.stopPropagation(); onAdd(e, leftClip.id); }}
          title={`Transition: ${leftClip.transition}`}
        />
      ) : (
        /* "+" add button */
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(e, leftClip.id); }}
          className="w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
          style={{
            background: 'rgba(99,102,241,0.8)',
            border: '1px solid rgba(255,255,255,0.3)',
            boxShadow: '0 2px 8px rgba(99,102,241,0.5)',
          }}
          title="Add transition"
        >
          <Plus size={8} className="text-white" />
        </button>
      )}
    </div>
  );
});
