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
        /* Modern Transition Badge */
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(e, leftClip.id); }}
          className="w-6 h-6 rounded-md flex items-center justify-center bg-gradient-to-br from-pink-500 to-indigo-600 text-white shadow-lg hover:shadow-blue-500/30 hover:scale-110 transition-all active:scale-95 border border-white/20"
          title={`Transition: ${leftClip.transition}`}
        >
          <span className="text-[9px] font-bold tracking-tighter uppercase">tr</span>
        </button>
      ) : (
        /* Modern "+" Add Transition Button */
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(e, leftClip.id); }}
          className="w-5 h-5 rounded-md flex items-center justify-center bg-white/95 hover:bg-blue-600 hover:text-white text-gray-500 shadow-md hover:shadow-blue-500/25 border border-gray-200/80 hover:border-blue-500 hover:scale-115 opacity-40 group-hover:opacity-100 transition-all active:scale-90"
          style={{ backdropFilter: 'blur(4px)' }}
          title="Add Transition"
        >
          <Plus size={10} className="stroke-[2.5]" />
        </button>
      )}
    </div>
  );
});
