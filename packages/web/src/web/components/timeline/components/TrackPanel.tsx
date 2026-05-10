import { useState, useCallback, memo } from 'react';
import {
  Lock, Unlock, Eye, EyeOff, Volume2, VolumeX,
  ChevronDown, ChevronRight, Video, Music, Type, Sparkles, Trash2, ImageIcon,
} from 'lucide-react';
import { useEditorStore, type Track } from '../../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';

export const LABEL_W = 196;

const TRACK_META: Record<string, { color: string; Icon: React.ComponentType<{ size?: number; color?: string; className?: string }> }> = {
  video:   { color: '#6366f1', Icon: Video },
  audio:   { color: '#10b981', Icon: Music },
  text:    { color: '#f59e0b', Icon: Type },
  effects: { color: '#ec4899', Icon: Sparkles },
  image:   { color: '#06b6d4', Icon: ImageIcon },
};

interface TrackPanelProps {
  track: Track;
  height: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onHeightChange: (h: number) => void;
}

export const TrackPanel = memo(function TrackPanel({
  track, height, collapsed, onToggleCollapse, onHeightChange,
}: TrackPanelProps) {
  const { removeTrack } = useEditorStore(useShallow((s) => ({
    removeTrack: s.removeTrack,
  })));

  const [muted, setMuted] = useState(track.muted);
  const [visible, setVisible] = useState(track.visible);
  const [locked, setLocked] = useState(track.locked);
  const [hover, setHover] = useState(false);

  const meta = TRACK_META[track.type] || TRACK_META.video;
  const { color, Icon } = meta;
  const rowH = collapsed ? 28 : height + 8;

  const handleResizeDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = height;
    const mm = (me: MouseEvent) => {
      onHeightChange(Math.max(28, Math.min(120, startH + (me.clientY - startY))));
    };
    const mu = () => {
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  }, [height, onHeightChange]);

  return (
    <div
      className="relative flex items-center shrink-0"
      style={{
        width: LABEL_W,
        minWidth: LABEL_W,
        height: rowH,
        background: hover ? '#f9fafb' : '#ffffff',
        borderBottom: '1px solid #f3f4f6',
        borderRight: '1px solid #e5e7eb',
        transition: 'background 0.1s',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Color accent strip */}
      <div className="absolute left-0 inset-y-0 w-[3px]" style={{ background: color }} />

      <div className="flex items-center gap-1.5 pl-3 pr-1.5 w-full min-w-0">
        {/* Collapse */}
        <button
          onClick={onToggleCollapse}
          className="shrink-0 p-0.5 rounded transition-colors text-gray-300 hover:text-gray-600"
        >
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        </button>

        {/* Icon */}
        <div
          className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center"
          style={{ background: `${color}18`, border: `1px solid ${color}30` }}
        >
          <Icon size={10} color={color} />
        </div>

        {/* Name */}
        <span className="flex-1 min-w-0 text-[10px] font-semibold text-gray-700 truncate leading-none">
          {track.name}
        </span>

        {/* Controls */}
        <div className="flex items-center shrink-0 gap-0.5">
          <IconBtn title={muted ? 'Unmute' : 'Mute'} active={muted} activeColor="#ef4444" onClick={() => setMuted(!muted)}>
            {muted ? <VolumeX size={9} /> : <Volume2 size={9} />}
          </IconBtn>
          <IconBtn title={visible ? 'Hide' : 'Show'} active={!visible} activeColor="#f59e0b" onClick={() => setVisible(!visible)}>
            {!visible ? <EyeOff size={9} /> : <Eye size={9} />}
          </IconBtn>
          <IconBtn title={locked ? 'Unlock' : 'Lock'} active={locked} activeColor="#6366f1" onClick={() => setLocked(!locked)}>
            {locked ? <Lock size={9} /> : <Unlock size={9} />}
          </IconBtn>
          {hover && (
            <IconBtn title="Remove track" active={false} activeColor="#ef4444" onClick={() => removeTrack(track.id)}>
              <Trash2 size={9} />
            </IconBtn>
          )}
        </div>
      </div>

      {/* Row resize handle */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[4px] cursor-row-resize z-10"
        onMouseDown={handleResizeDrag}
        onMouseEnter={(e) => ((e.currentTarget.firstChild as HTMLElement).style.background = color)}
        onMouseLeave={(e) => ((e.currentTarget.firstChild as HTMLElement).style.background = 'transparent')}
      >
        <div className="absolute bottom-0 left-0 right-0 h-px transition-colors" style={{ background: 'transparent' }} />
      </div>
    </div>
  );
});

function IconBtn({
  children, title, active, activeColor, onClick,
}: {
  children: React.ReactNode;
  title: string;
  active: boolean;
  activeColor: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-0.5 rounded transition-colors"
      style={{ color: active ? activeColor : '#d1d5db' }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = '#6b7280'; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = '#d1d5db'; }}
    >
      {children}
    </button>
  );
}
