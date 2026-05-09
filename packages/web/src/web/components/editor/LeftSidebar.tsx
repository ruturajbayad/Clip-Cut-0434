import { useState, useRef, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Video, Type, Music, Sparkles, ArrowLeftRight, Sticker,
  SlidersHorizontal, LayoutTemplate, Search, Plus, Upload,
  ImageIcon, Grid3X3, Loader2, Film, X
} from 'lucide-react';
import { useEditorStore, type MediaItem } from '../../store/editorStore';
import type { ActivePanel } from '../../store/editorStore';

const TABS: { id: ActivePanel; icon: React.ComponentType<{ size?: number; className?: string }>; label: string }[] = [
  { id: 'media', icon: Video, label: 'Media' },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'audio', icon: Music, label: 'Audio' },
  { id: 'effects', icon: Sparkles, label: 'FX' },
  { id: 'transitions', icon: ArrowLeftRight, label: 'Trans' },
  { id: 'stickers', icon: Sticker, label: 'Sticker' },
  { id: 'filters', icon: SlidersHorizontal, label: 'Filter' },
  { id: 'templates', icon: LayoutTemplate, label: 'Tmpl' },
];

const TEXT_PRESETS = [
  { id: 'cinematic', label: 'Cinematic Title', style: 'text-lg font-bold tracking-widest uppercase', color: 'text-gray-900' },
  { id: 'vlog', label: 'Vlog Style', style: 'text-xl font-bold italic', color: 'text-indigo-600' },
  { id: 'gaming', label: 'Gaming', style: 'text-xl font-black uppercase', color: 'text-yellow-500' },
  { id: 'minimal', label: 'Minimal', style: 'text-sm font-light tracking-widest', color: 'text-gray-600' },
  { id: 'neon', label: 'Neon Glow', style: 'text-xl font-bold', color: 'text-purple-500' },
  { id: 'subtitle', label: 'Subtitle', style: 'text-sm font-medium', color: 'text-gray-800' },
];

const EFFECT_ITEMS = [
  { id: 'blur', name: 'Blur', color: '#E0E7FF' },
  { id: 'vhs', name: 'VHS', color: '#FEF3C7' },
  { id: 'glitch', name: 'Glitch', color: '#FCE7F3' },
  { id: 'bw', name: 'B&W', color: '#F3F4F6' },
  { id: 'cinematic', name: 'Cinematic', color: '#FFF7ED' },
  { id: 'bloom', name: 'Bloom', color: '#FFFBEB' },
  { id: 'grain', name: 'Film Grain', color: '#F5F3FF' },
  { id: 'chromatic', name: 'Chromatic', color: '#FDF2F8' },
];

const TRANSITION_ITEMS = [
  { id: 'fade', name: 'Fade', duration: '0.5s' },
  { id: 'dissolve', name: 'Dissolve', duration: '0.8s' },
  { id: 'blur', name: 'Blur', duration: '0.4s' },
  { id: 'zoom', name: 'Zoom In', duration: '0.6s' },
  { id: 'slide', name: 'Slide Left', duration: '0.5s' },
  { id: 'whip', name: 'Whip Pan', duration: '0.3s' },
  { id: 'glitch', name: 'Glitch', duration: '0.4s' },
  { id: 'spin', name: 'Spin', duration: '0.5s' },
  { id: 'cinematic', name: 'Cinematic', duration: '1.0s' },
  { id: 'lightleak', name: 'Light Leak', duration: '0.7s' },
];

const FILTER_ITEMS = [
  { id: 'none', name: 'Original', css: '' },
  { id: 'warm', name: 'Warm', css: 'sepia(0.3) saturate(1.4) hue-rotate(-10deg)' },
  { id: 'cool', name: 'Cool', css: 'saturate(0.9) hue-rotate(20deg) brightness(1.05)' },
  { id: 'vintage', name: 'Vintage', css: 'sepia(0.5) contrast(1.1) brightness(0.9)' },
  { id: 'matte', name: 'Matte', css: 'contrast(0.9) brightness(1.1) saturate(0.85)' },
  { id: 'vibrant', name: 'Vibrant', css: 'saturate(1.8) contrast(1.1)' },
  { id: 'mono', name: 'Mono', css: 'grayscale(1)' },
  { id: 'fade', name: 'Faded', css: 'opacity(0.8) contrast(0.9) brightness(1.1)' },
];

const COLORS = ['#818CF8', '#6366F1', '#34D399', '#FBBF24', '#F472B6', '#60A5FA', '#A78BFA', '#FB923C'];

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => { resolve(video.duration); URL.revokeObjectURL(video.src); };
    video.onerror = () => resolve(5);
    video.src = URL.createObjectURL(file);
  });
}

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => { resolve(audio.duration); URL.revokeObjectURL(audio.src); };
    audio.onerror = () => resolve(5);
    audio.src = URL.createObjectURL(file);
  });
}

function getVideoThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.currentTime = 0.5;
    const src = URL.createObjectURL(file);
    video.src = src;
    video.onloadeddata = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        resolve('');
      } finally {
        URL.revokeObjectURL(src);
      }
    };
    video.onerror = () => { URL.revokeObjectURL(src); resolve(''); };
  });
}

function MediaCard({ item, onAdd }: { item: MediaItem; onAdd: () => void }) {
  const fmt = (d?: number) => {
    if (!d) return '';
    const m = Math.floor(d / 60);
    const s = Math.floor(d % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className="group relative rounded-lg overflow-hidden cursor-pointer border border-gray-100 hover:border-indigo-300 hover:shadow-md transition-all bg-white"
    >
      {/* Thumbnail */}
      <div className="aspect-video relative overflow-hidden bg-gray-100">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: (item.thumbnailColor || '#818CF8') + '22' }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: item.thumbnailColor || '#818CF8' }}>
              {item.type === 'video' ? <Film size={14} className="text-white" /> :
               item.type === 'audio' ? <Music size={14} className="text-white" /> :
               <ImageIcon size={14} className="text-white" />}
            </div>
          </div>
        )}
        {item.duration && (
          <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] font-mono px-1 rounded">
            {fmt(item.duration)}
          </div>
        )}
      </div>
      <div className="p-1.5">
        <div className="text-[10px] font-medium text-gray-700 truncate">{item.name}</div>
        <div className="text-[9px] text-gray-400 capitalize">{item.type}</div>
      </div>
      {/* Add overlay */}
      <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/5 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center shadow-lg hover:bg-indigo-700 transition-colors"
          title="Add to timeline"
        >
          <Plus size={12} className="text-white" />
        </button>
      </div>
    </motion.div>
  );
}

export default function LeftSidebar() {
  const { activePanel, setActivePanel, mediaLibrary, addMediaItem, addClipFromMedia, addClip, project } = useEditorStore(useShallow((s) => ({
    activePanel: s.activePanel,
    setActivePanel: s.setActivePanel,
    mediaLibrary: s.mediaLibrary,
    addMediaItem: s.addMediaItem,
    addClipFromMedia: s.addClipFromMedia,
    addClip: s.addClip,
    project: s.project,
  })));
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isAudio && !isImage) return;

    const src = URL.createObjectURL(file);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    let duration: number | undefined;
    let thumbnail: string | undefined;

    if (isVideo) {
      duration = await getVideoDuration(file);
      thumbnail = await getVideoThumbnail(file);
    } else if (isAudio) {
      duration = await getAudioDuration(file);
    } else if (isImage) {
      thumbnail = src;
      duration = 5;
    }

    const item: MediaItem = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ''),
      type: isVideo ? 'video' : isAudio ? 'audio' : 'image',
      src,
      duration,
      thumbnailColor: color,
      thumbnail,
    };

    addMediaItem(item);
    return item;
  }, [addMediaItem]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await processFile(file);
      }
    } finally {
      setUploading(false);
    }
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleAddText = () => {
    const textTrack = project.tracks.find(t => t.type === 'text');
    if (textTrack) {
      const endTime = textTrack.clips.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
      addClip(textTrack.id, {
        name: 'New Text',
        type: 'text',
        startTime: endTime,
        duration: 4,
        thumbnailColor: '#FBBF24',
        text: 'Your Text Here',
        fontSize: 72,
        fontFamily: 'Inter',
        color: '#FFFFFF',
      });
    }
  };

  return (
    <div className="flex h-full">
      {/* Tab icons */}
      <div className="w-14 flex flex-col items-center pt-2 gap-0.5 border-r border-gray-200 bg-white overflow-y-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activePanel === tab.id;
          return (
            <motion.button
              key={tab.id}
              onClick={() => setActivePanel(tab.id)}
              whileTap={{ scale: 0.9 }}
              className={`w-11 h-11 flex flex-col items-center justify-center rounded-xl transition-all gap-0.5 relative ${
                active ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
              }`}
              title={tab.label}
            >
              {active && (
                <motion.div layoutId="sidebar-active" className="absolute inset-0 bg-indigo-50 rounded-xl" />
              )}
              <Icon size={15} className="relative z-10" />
              <span className="text-[8px] font-medium relative z-10 leading-none">{tab.label}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Panel content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activePanel}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6 }}
          transition={{ duration: 0.12 }}
          className="flex-1 flex flex-col h-full bg-white overflow-hidden"
        >
          {/* Search bar */}
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${activePanel}...`}
                className="w-full text-xs pl-7 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-indigo-400 focus:bg-white transition-colors"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {/* ── MEDIA ── */}
            {activePanel === 'media' && (
              <div className="space-y-3">
                {/* Upload drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl py-5 flex flex-col items-center gap-2 transition-all cursor-pointer ${
                    dragOver ? 'border-indigo-500 bg-indigo-50 text-indigo-500' : 'border-gray-200 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50/40'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <><Loader2 size={20} className="animate-spin text-indigo-500" /><span className="text-xs font-medium">Processing...</span></>
                  ) : (
                    <><Upload size={18} /><span className="text-xs font-medium">Upload Video or Image</span><span className="text-[10px] opacity-70">MP4, MOV, WebM, JPG, PNG</span></>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="video/*,image/*,audio/*"
                  className="hidden"
                  onChange={(e) => e.target.files && handleFiles(e.target.files)}
                />

                {/* Library */}
                {mediaLibrary.length > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Your Media ({mediaLibrary.length})</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {mediaLibrary
                        .filter(m => m.name.toLowerCase().includes(search.toLowerCase()))
                        .map((item) => (
                          <MediaCard
                            key={item.id}
                            item={item}
                            onAdd={() => addClipFromMedia(item)}
                          />
                        ))}
                    </div>
                  </>
                )}

                {mediaLibrary.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-6 text-gray-400">
                    <Film size={28} className="opacity-30" />
                    <div className="text-xs text-center">
                      <div className="font-medium text-gray-500 mb-0.5">No media yet</div>
                      <div className="text-gray-400">Upload files to get started</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── TEXT ── */}
            {activePanel === 'text' && (
              <div className="space-y-2">
                <button
                  onClick={handleAddText}
                  className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-xl py-3 text-gray-400 hover:text-indigo-500 text-xs font-medium transition-all"
                >
                  <Plus size={14} /> Add Text Clip
                </button>
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-2">Presets</div>
                {TEXT_PRESETS.filter(t => t.label.toLowerCase().includes(search.toLowerCase())).map((preset) => (
                  <motion.div
                    key={preset.id}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleAddText}
                    className="border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/50 rounded-xl p-3 cursor-pointer transition-all"
                  >
                    <div className={`${preset.style} ${preset.color} leading-tight`}>{preset.label}</div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* ── AUDIO ── */}
            {activePanel === 'audio' && (
              <div className="space-y-3">
                <div
                  className="border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-xl py-4 flex flex-col items-center gap-2 text-gray-400 hover:text-indigo-500 transition-all cursor-pointer"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'audio/*';
                    input.multiple = true;
                    input.onchange = (e) => {
                      const files = (e.target as HTMLInputElement).files;
                      if (files) handleFiles(files);
                    };
                    input.click();
                  }}
                >
                  <Upload size={16} />
                  <span className="text-xs font-medium">Upload Audio</span>
                  <span className="text-[10px] opacity-70">MP3, WAV, AAC</span>
                </div>
                {mediaLibrary.filter(m => m.type === 'audio').length > 0 && (
                  <>
                    <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Your Audio</div>
                    {mediaLibrary.filter(m => m.type === 'audio' && m.name.toLowerCase().includes(search.toLowerCase())).map((item) => (
                      <div key={item.id} className="flex items-center gap-2 p-2 border border-gray-100 hover:border-indigo-200 rounded-xl cursor-pointer hover:bg-indigo-50/50 transition-all">
                        <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center shrink-0">
                          <Music size={14} className="text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-gray-800 truncate">{item.name}</div>
                          {item.duration && <div className="text-[10px] text-gray-400">{Math.floor(item.duration / 60)}:{Math.floor(item.duration % 60).toString().padStart(2,'0')}</div>}
                        </div>
                        <button
                          onClick={() => addClipFromMedia(item)}
                          className="w-6 h-6 rounded-full bg-indigo-100 hover:bg-indigo-600 text-indigo-600 hover:text-white flex items-center justify-center transition-all shrink-0"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* ── EFFECTS ── */}
            {activePanel === 'effects' && (
              <div className="grid grid-cols-2 gap-2">
                {EFFECT_ITEMS.filter(e => e.name.toLowerCase().includes(search.toLowerCase())).map((effect) => (
                  <motion.div
                    key={effect.id}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="rounded-xl overflow-hidden border border-gray-100 hover:border-indigo-300 hover:shadow-md cursor-grab transition-all"
                  >
                    <div className="h-14 flex items-center justify-center" style={{ backgroundColor: effect.color }}>
                      <Sparkles size={18} className="text-gray-600 opacity-60" />
                    </div>
                    <div className="p-1.5 bg-white">
                      <div className="text-[10px] font-medium text-gray-700 text-center">{effect.name}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* ── TRANSITIONS ── */}
            {activePanel === 'transitions' && (
              <div className="grid grid-cols-2 gap-2">
                {TRANSITION_ITEMS.filter(t => t.name.toLowerCase().includes(search.toLowerCase())).map((tr) => (
                  <motion.div
                    key={tr.id}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="rounded-xl border border-gray-100 hover:border-indigo-300 hover:shadow-md cursor-grab overflow-hidden transition-all"
                  >
                    <div className="h-12 bg-gradient-to-r from-indigo-100 to-purple-100 flex items-center justify-center">
                      <ArrowLeftRight size={16} className="text-indigo-400" />
                    </div>
                    <div className="p-1.5 bg-white text-center">
                      <div className="text-[10px] font-medium text-gray-700">{tr.name}</div>
                      <div className="text-[9px] text-gray-400">{tr.duration}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* ── FILTERS ── */}
            {activePanel === 'filters' && (
              <div className="grid grid-cols-2 gap-2">
                {FILTER_ITEMS.filter(f => f.name.toLowerCase().includes(search.toLowerCase())).map((filter) => (
                  <motion.div
                    key={filter.id}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="rounded-xl border border-gray-100 hover:border-indigo-300 hover:shadow-md cursor-grab overflow-hidden transition-all"
                  >
                    <div className="h-14 bg-gradient-to-br from-purple-100 to-indigo-100" style={{ filter: filter.css || 'none' }} />
                    <div className="p-1.5 bg-white text-center">
                      <div className="text-[10px] font-medium text-gray-700">{filter.name}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {(activePanel === 'stickers' || activePanel === 'templates') && (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-gray-400">
                <Grid3X3 size={28} className="opacity-40" />
                <div className="text-xs text-center">
                  <div className="font-medium text-gray-600 mb-1 capitalize">{activePanel}</div>
                  <div className="text-gray-400">Coming soon</div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
