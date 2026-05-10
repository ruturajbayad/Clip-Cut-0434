import { useRef } from 'react';
import { motion } from 'framer-motion';
import {
  SkipBack, SkipForward, Play, Pause, ZoomIn, ZoomOut,
  Plus, Video, Music, Type, Sparkles, Scissors, Copy, ArrowLeftRight
} from 'lucide-react';
import { useEditorStore, type MediaItem } from '../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';
import { nanoid } from 'nanoid';

const TRACK_ICONS = { video: Video, audio: Music, text: Type, effects: Sparkles };
const TRACK_COLORS: Record<string, string> = { video: '#818CF8', audio: '#34D399', text: '#FBBF24', effects: '#F472B6' };

// Isolated timecode — only this re-renders on currentTime changes
function Timecode({ fps }: { fps: number }) {
  const currentTime = useEditorStore((s) => s.currentTime);
  const duration = useEditorStore((s) => s.project.duration);
  const fmt = (t: number) => {
    const m = Math.floor(t / 60).toString().padStart(2, '0');
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    const f = Math.floor((t % 1) * fps).toString().padStart(2, '0');
    return `${m}:${s}:${f}`;
  };
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="font-mono text-xs font-semibold text-gray-800 bg-gray-50 border border-gray-200 rounded px-2 py-1 tabular-nums">
        {fmt(currentTime)}
      </span>
      <span className="text-gray-300 text-xs">/</span>
      <span className="font-mono text-xs text-gray-400 tabular-nums">{fmt(duration)}</span>
    </div>
  );
}

export default function TransportBar() {
  // useShallow prevents infinite re-render from object selector returning new ref each time
  const {
    project, isPlaying, zoom,
    setIsPlaying, setZoom, setCurrentTime, addTrack, addMediaItem, addClipFromMedia,
    selectedClipId, splitClip, addClip
  } = useEditorStore(useShallow((s) => ({
    project: s.project,
    isPlaying: s.isPlaying,
    zoom: s.zoom,
    setIsPlaying: s.setIsPlaying,
    setZoom: s.setZoom,
    setCurrentTime: s.setCurrentTime,
    addTrack: s.addTrack,
    addMediaItem: s.addMediaItem,
    addClipFromMedia: s.addClipFromMedia,
    selectedClipId: s.selectedClipId,
    splitClip: s.splitClip,
    addClip: s.addClip,
  })));

  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60).toString().padStart(2, '0');
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    const f = Math.floor((t % 1) * project.fps).toString().padStart(2, '0');
    return `${m}:${s}:${f}`;
  };

  const processVideoFile = (file: File) => {
    const src = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.src = src;
    vid.onloadedmetadata = () => {
      // capture thumbnail
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 90;
      vid.currentTime = 0.5;
      vid.onseeked = () => {
        try { canvas.getContext('2d')!.drawImage(vid, 0, 0, 160, 90); } catch (_) {}
        const media: MediaItem = {
          id: nanoid(), name: file.name, type: 'video', src,
          duration: vid.duration,
          thumbnail: canvas.toDataURL('image/jpeg', 0.6),
          thumbnailColor: '#818CF8', width: vid.videoWidth, height: vid.videoHeight,
        };
        addMediaItem(media);
        addClipFromMedia(media);
      };
    };
  };

  const processAudioFile = (file: File) => {
    const src = URL.createObjectURL(file);
    const aud = document.createElement('audio');
    aud.preload = 'metadata';
    aud.src = src;
    aud.onloadedmetadata = () => {
      const media: MediaItem = {
        id: nanoid(), name: file.name, type: 'audio', src,
        duration: aud.duration, thumbnailColor: '#34D399',
      };
      addMediaItem(media);
      addClipFromMedia(media);
    };
  };

  const handleVideoFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => {
      if (f.type.startsWith('video/') || f.type.startsWith('image/')) processVideoFile(f);
    });
  };

  const handleAudioFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => {
      if (f.type.startsWith('audio/')) processAudioFile(f);
    });
  };

  const handleDuplicate = () => {
    if (!selectedClipId) return;
    const allClips = project.tracks.flatMap((t) => t.clips);
    const clip = allClips.find((c) => c.id === selectedClipId);
    if (!clip) return;
    addClip(clip.trackId, {
      ...clip,
      id: undefined as any,
      startTime: clip.startTime + clip.duration,
    });
  };

  const selectedClip = selectedClipId
    ? project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId)
    : null;

  return (
    <div className="h-11 flex items-center gap-3 px-3 bg-white border-b border-gray-200 flex-shrink-0 select-none overflow-x-auto">
      {/* Hidden file inputs */}
      <input ref={videoInputRef} type="file" accept="video/*,image/*" multiple className="hidden"
        onChange={(e) => handleVideoFiles(e.target.files)} />
      <input ref={audioInputRef} type="file" accept="audio/*" multiple className="hidden"
        onChange={(e) => handleAudioFiles(e.target.files)} />

      {/* Playback controls */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setCurrentTime(0)}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors"
          title="Go to start"
        >
          <SkipBack size={14} />
        </button>
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={() => setIsPlaying(!isPlaying)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white transition-colors shadow-sm"
          style={{ background: '#0f172a' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#1e293b')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#0f172a')}
          title="Play / Pause (Space)"
        >
          {isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
        </motion.button>
        <button
          onClick={() => setCurrentTime(project.duration)}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors"
          title="Go to end"
        >
          <SkipForward size={14} />
        </button>
      </div>

      {/* Timecode — isolated component, only it re-renders on time changes */}
      <Timecode fps={project.fps} />

      <div className="w-px h-5 bg-gray-200 shrink-0" />

      {/* Add track buttons — these trigger real file upload */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] text-gray-400 mr-0.5 font-medium whitespace-nowrap">Add</span>

        {/* + Video — opens file picker */}
        <button
          onClick={() => videoInputRef.current?.click()}
          title="Import video / image"
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors border border-gray-200 hover:border-blue-300"
        >
          <Plus size={8} className="text-gray-400" />
          <Video size={11} style={{ color: TRACK_COLORS.video }} />
          <span className="text-[10px] hidden sm:inline">Video</span>
        </button>

        {/* + Audio — opens file picker */}
        <button
          onClick={() => audioInputRef.current?.click()}
          title="Import audio"
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-gray-600 hover:bg-green-50 hover:text-green-700 transition-colors border border-gray-200 hover:border-green-300"
        >
          <Plus size={8} className="text-gray-400" />
          <Music size={11} style={{ color: TRACK_COLORS.audio }} />
          <span className="text-[10px] hidden sm:inline">Audio</span>
        </button>

        {/* + Text */}
        <button
          onClick={() => {
            const textTrack = project.tracks.find((t) => t.type === 'text');
            const trackId = textTrack?.id;
            if (trackId) {
              const endTime = textTrack.clips.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
              addClip(trackId, {
                name: 'New Text', type: 'text', startTime: useEditorStore.getState().currentTime, duration: 4,
                text: 'Your Text', fontSize: 72, fontFamily: 'Inter', color: '#FFFFFF',
                thumbnailColor: '#FBBF24',
              });
            } else {
              addTrack('text');
            }
          }}
          title="Add text clip"
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-gray-600 hover:bg-yellow-50 hover:text-yellow-700 transition-colors border border-gray-200 hover:border-yellow-300"
        >
          <Plus size={8} className="text-gray-400" />
          <Type size={11} style={{ color: TRACK_COLORS.text }} />
          <span className="text-[10px] hidden sm:inline">Text</span>
        </button>

        {/* + Transition */}
        <button
          onClick={() => {
            // If a clip is selected, attach a transition to it
            if (selectedClip) {
              const { updateClip } = useEditorStore.getState();
              updateClip(selectedClip.id, { transition: selectedClip.transition ? undefined : 'fade' });
            }
          }}
          title="Add transition to selected clip"
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-gray-600 hover:bg-pink-50 hover:text-pink-600 transition-colors border border-gray-200 hover:border-pink-300"
        >
          <Plus size={8} className="text-gray-400" />
          <ArrowLeftRight size={11} style={{ color: TRACK_COLORS.effects }} />
          <span className="text-[10px] hidden sm:inline">Trans</span>
        </button>
      </div>

      <div className="w-px h-5 bg-gray-200 shrink-0" />

      {/* Clip actions — Split & Duplicate */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => selectedClipId && splitClip(selectedClipId, useEditorStore.getState().currentTime)}
          disabled={!selectedClipId}
          title="Split clip at playhead"
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors ${
            selectedClipId
              ? 'text-gray-600 border-gray-200 hover:bg-red-50 hover:text-red-600 hover:border-red-300'
              : 'text-gray-300 border-gray-100 cursor-not-allowed'
          }`}
        >
          <Scissors size={11} />
          <span className="hidden sm:inline">Split</span>
        </button>

        <button
          onClick={handleDuplicate}
          disabled={!selectedClipId}
          title="Duplicate selected clip"
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors ${
            selectedClipId
              ? 'text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300'
              : 'text-gray-300 border-gray-100 cursor-not-allowed'
          }`}
        >
          <Copy size={11} />
          <span className="hidden sm:inline">Dup</span>
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Zoom */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setZoom(Math.max(5, zoom * 0.75))}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 transition-colors"
          title="Zoom out"
        >
          <ZoomOut size={13} />
        </button>
        <span className="text-[11px] text-gray-600 w-14 text-center font-mono">{Math.round(zoom)}%</span>
        <button
          onClick={() => setZoom(Math.min(800, zoom * 1.33))}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 transition-colors"
          title="Zoom in"
        >
          <ZoomIn size={13} />
        </button>
      </div>
    </div>
  );
}
