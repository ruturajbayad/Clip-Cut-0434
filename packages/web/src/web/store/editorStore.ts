import { create } from 'zustand';
import { nanoid } from 'nanoid';

export type TrackType = 'video' | 'audio' | 'text' | 'effects';

export interface Keyframe {
  id: string;
  time: number; // absolute project time (seconds)
  value: number;
  property: string; // 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity'
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export interface MediaItem {
  id: string;
  name: string;
  type: 'video' | 'image' | 'audio';
  src: string; // object URL
  duration?: number; // seconds, from file metadata
  thumbnailColor?: string;
  thumbnail?: string; // data URL for preview
  width?: number;
  height?: number;
}

export interface Clip {
  id: string;
  trackId: string;
  name: string;
  type: TrackType;
  startTime: number;
  duration: number;
  src?: string;
  mediaId?: string;
  thumbnailColor?: string;
  volume?: number;
  opacity?: number;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  blur?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  keyframes?: Keyframe[];
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  effect?: string;
  transition?: string;
  trimStart?: number; // seconds offset into the source file (for split clips)
}

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  muted: boolean;
  locked: boolean;
  visible: boolean;
  height: number;
  clips: Clip[];
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  tracks: Track[];
}

export type ActivePanel = 'media' | 'text' | 'audio' | 'effects' | 'transitions' | 'stickers' | 'filters' | 'templates';

// Compute actual project duration from clips
export function computeDuration(tracks: Track[]): number {
  let max = 0;
  for (const t of tracks) {
    for (const c of t.clips) {
      max = Math.max(max, c.startTime + c.duration);
    }
  }
  return Math.max(max, 10); // minimum 10s
}

// ── Easing functions ──────────────────────────────────────────────────────────
function applyEasing(t: number, easing: Keyframe['easing']): number {
  switch (easing) {
    case 'ease-in':     return t * t;
    case 'ease-out':    return t * (2 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    default:            return t; // linear
  }
}

/**
 * Interpolate clip properties at `currentTime` using any keyframes set on the clip.
 * Returns an object with only the properties that have keyframes — merge with clip defaults.
 */
export function interpolateClip(clip: Clip, currentTime: number): Partial<Clip> {
  if (!clip.keyframes || clip.keyframes.length === 0) return {};

  const result: Partial<Clip> = {};
  const properties = [...new Set(clip.keyframes.map((k) => k.property))];

  for (const prop of properties) {
    const kfs = clip.keyframes
      .filter((k) => k.property === prop)
      .sort((a, b) => a.time - b.time);

    if (kfs.length === 0) continue;
    if (kfs.length === 1) {
      (result as Record<string, number>)[prop] = kfs[0].value;
      continue;
    }

    // Before first keyframe — use first value
    if (currentTime <= kfs[0].time) {
      (result as Record<string, number>)[prop] = kfs[0].value;
      continue;
    }
    // After last keyframe — use last value
    if (currentTime >= kfs[kfs.length - 1].time) {
      (result as Record<string, number>)[prop] = kfs[kfs.length - 1].value;
      continue;
    }

    // Find bracketing keyframes
    let prev = kfs[0];
    let next = kfs[kfs.length - 1];
    for (let i = 0; i < kfs.length - 1; i++) {
      if (kfs[i].time <= currentTime && kfs[i + 1].time >= currentTime) {
        prev = kfs[i];
        next = kfs[i + 1];
        break;
      }
    }

    const span = next.time - prev.time;
    const raw  = span === 0 ? 1 : (currentTime - prev.time) / span;
    const t    = applyEasing(Math.max(0, Math.min(1, raw)), next.easing);
    (result as Record<string, number>)[prop] = prev.value + (next.value - prev.value) * t;
  }

  return result;
}

interface EditorState {
  project: Project;
  mediaLibrary: MediaItem[];
  currentTime: number;
  isPlaying: boolean;
  zoom: number;
  selectedClipId: string | null;
  selectedTrackId: string | null;
  activePanel: ActivePanel;
  showExportModal: boolean;
  showTransitionPicker: boolean;
  transitionPickerPosition: { x: number; y: number } | null;
  transitionPickerClipId: string | null;
  undoStack: Project[];
  redoStack: Project[];

  // Actions
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  setSelectedClip: (id: string | null) => void;
  setSelectedTrack: (id: string | null) => void;
  setActivePanel: (panel: ActivePanel) => void;
  setShowExportModal: (show: boolean) => void;
  setShowTransitionPicker: (show: boolean, position?: { x: number; y: number }, clipId?: string) => void;
  addMediaItem: (item: MediaItem) => void;
  addTrack: (type: TrackType) => void;
  removeTrack: (trackId: string) => void;
  addClip: (trackId: string, clip: Partial<Clip>) => void;
  addClipFromMedia: (media: MediaItem, trackType?: TrackType) => void;
  removeClip: (clipId: string) => void;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  moveClip: (clipId: string, newTrackId: string, newStartTime: number) => void;
  splitClip: (clipId: string, atTime: number) => void;
  updateProject: (updates: Partial<Project>) => void;
  recomputeDuration: () => void;
  undo: () => void;
  redo: () => void;
  saveToUndo: () => void;
  // Keyframe actions
  addKeyframe: (clipId: string, property: string, time: number, value: number, easing?: Keyframe['easing']) => void;
  removeKeyframe: (clipId: string, keyframeId: string) => void;
  updateKeyframe: (clipId: string, keyframeId: string, updates: Partial<Omit<Keyframe, 'id'>>) => void;
}

const makeDefaultTracks = (): Track[] => {
  const v1id = nanoid();
  const a1id = nanoid();
  const t1id = nanoid();
  return [
    {
      id: v1id,
      type: 'video',
      name: 'Video 1',
      muted: false,
      locked: false,
      visible: true,
      height: 56,
      clips: [
        { id: nanoid(), trackId: v1id, name: 'Clip 01.mp4', type: 'video', startTime: 0,  duration: 8, thumbnailColor: '#818CF8', opacity: 1, x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, trimStart: 0 },
        { id: nanoid(), trackId: v1id, name: 'Clip 02.mp4', type: 'video', startTime: 9,  duration: 7, thumbnailColor: '#6366F1', opacity: 1, x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, trimStart: 0 },
        { id: nanoid(), trackId: v1id, name: 'Clip 03.mp4', type: 'video', startTime: 17, duration: 6, thumbnailColor: '#818CF8', opacity: 1, x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, trimStart: 0 },
      ],
    },
    {
      id: a1id,
      type: 'audio',
      name: 'Audio 1',
      muted: false,
      locked: false,
      visible: true,
      height: 48,
      clips: [
        { id: nanoid(), trackId: a1id, name: 'Background Music.mp3', type: 'audio', startTime: 0, duration: 23, thumbnailColor: '#34D399', volume: 0.8 },
      ],
    },
    {
      id: t1id,
      type: 'text',
      name: 'Text 1',
      muted: false,
      locked: false,
      visible: true,
      height: 44,
      clips: [
        { id: nanoid(), trackId: t1id, name: 'Title Text', type: 'text', startTime: 2, duration: 4, thumbnailColor: '#FBBF24', text: 'Hello World', fontSize: 72, fontFamily: 'Inter', color: '#FFFFFF', x: 0.5, y: 0.8, scaleX: 0.6, scaleY: 0.15 },
      ],
    },
  ];
};

const defaultTracks = makeDefaultTracks();

const defaultProject: Project = {
  id: nanoid(),
  name: 'Untitled Project',
  width: 1920,
  height: 1080,
  fps: 30,
  duration: computeDuration(defaultTracks),
  tracks: defaultTracks,
};

export const useEditorStore = create<EditorState>((set, get) => ({
  project: defaultProject,
  mediaLibrary: [],
  currentTime: 0,
  isPlaying: false,
  zoom: 50,
  selectedClipId: null,
  selectedTrackId: null,
  activePanel: 'media',
  showExportModal: false,
  showTransitionPicker: false,
  transitionPickerPosition: null,
  transitionPickerClipId: null,
  undoStack: [],
  redoStack: [],

  setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setZoom: (zoom) => set({ zoom: Math.min(200, Math.max(10, zoom)) }),
  setSelectedClip: (id) => set({ selectedClipId: id }),
  setSelectedTrack: (id) => set({ selectedTrackId: id }),
  setActivePanel: (panel) => set({ activePanel: panel }),
  setShowExportModal: (show) => set({ showExportModal: show }),
  setShowTransitionPicker: (show, position, clipId) =>
    set({ showTransitionPicker: show, transitionPickerPosition: position || null, transitionPickerClipId: clipId || null }),

  addMediaItem: (item) => set((state) => ({ mediaLibrary: [item, ...state.mediaLibrary] })),

  recomputeDuration: () => {
    const { project } = get();
    const dur = computeDuration(project.tracks);
    set({ project: { ...project, duration: dur } });
  },

  saveToUndo: () => {
    const { project, undoStack } = get();
    set({
      undoStack: [...undoStack.slice(-20), JSON.parse(JSON.stringify(project))],
      redoStack: [],
    });
  },

  addTrack: (type) => {
    get().saveToUndo();
    const id = nanoid();
    set((state) => {
      const newTracks = [
        ...state.project.tracks,
        {
          id,
          type,
          name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${state.project.tracks.filter((t) => t.type === type).length + 1}`,
          muted: false,
          locked: false,
          visible: true,
          height: type === 'video' ? 56 : 44,
          clips: [],
        },
      ];
      return { project: { ...state.project, tracks: newTracks, duration: computeDuration(newTracks) } };
    });
  },

  removeTrack: (trackId) => {
    get().saveToUndo();
    set((state) => {
      const newTracks = state.project.tracks.filter((t) => t.id !== trackId);
      return { project: { ...state.project, tracks: newTracks, duration: computeDuration(newTracks) } };
    });
  },

  addClip: (trackId, clip) => {
    get().saveToUndo();
    const newClip: Clip = {
      id: nanoid(),
      trackId,
      name: 'New Clip',
      type: 'video',
      startTime: 0,
      duration: 5,
      x: 0.5, y: 0.5, scaleX: 1, scaleY: 1,
      ...clip,
    };
    set((state) => {
      const newTracks = state.project.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, newClip] } : t
      );
      return { project: { ...state.project, tracks: newTracks, duration: computeDuration(newTracks) } };
    });
  },

  addClipFromMedia: (media, trackType) => {
    get().saveToUndo();
    const { project } = get();
    const type: TrackType = trackType || (media.type === 'audio' ? 'audio' : media.type === 'image' ? 'video' : 'video');
    // Find first matching track or create one
    let track = project.tracks.find((t) => t.type === type);
    let newTracks = project.tracks;

    if (!track) {
      const id = nanoid();
      track = {
        id,
        type,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${project.tracks.filter((t) => t.type === type).length + 1}`,
        muted: false,
        locked: false,
        visible: true,
        height: type === 'video' ? 56 : 44,
        clips: [],
      };
      newTracks = [...project.tracks, track];
    }

    // Find the end time of existing clips on this track to append
    const trackClips = newTracks.find((t) => t.id === track!.id)?.clips || [];
    const endTime = trackClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);

    const newClip: Clip = {
      id: nanoid(),
      trackId: track.id,
      name: media.name,
      type,
      startTime: endTime,
      duration: media.duration || 5,
      src: media.src,
      mediaId: media.id,
      thumbnailColor: media.thumbnailColor || '#818CF8',
      opacity: 1,
      x: 0.5, y: 0.5, scaleX: 1, scaleY: 1,
      trimStart: 0,
    };

    newTracks = newTracks.map((t) =>
      t.id === track!.id ? { ...t, clips: [...t.clips, newClip] } : t
    );

    set({
      project: { ...project, tracks: newTracks, duration: computeDuration(newTracks) },
      selectedClipId: newClip.id,
    });
  },

  removeClip: (clipId) => {
    get().saveToUndo();
    set((state) => {
      const newTracks = state.project.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== clipId),
      }));
      return {
        project: { ...state.project, tracks: newTracks, duration: computeDuration(newTracks) },
        selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
      };
    });
  },

  updateClip: (clipId, updates) => {
    set((state) => {
      const newTracks = state.project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...updates } : c)),
      }));
      return { project: { ...state.project, tracks: newTracks, duration: computeDuration(newTracks) } };
    });
  },

  moveClip: (clipId, newTrackId, newStartTime) => {
    get().saveToUndo();
    set((state) => {
      let targetClip: Clip | null = null;
      const tracks = state.project.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => {
          if (c.id === clipId) { targetClip = c; return false; }
          return true;
        }),
      }));
      if (!targetClip) return state;
      const updatedClip = { ...targetClip, trackId: newTrackId, startTime: Math.max(0, newStartTime) };
      const newTracks = tracks.map((t) =>
        t.id === newTrackId ? { ...t, clips: [...t.clips, updatedClip] } : t
      );
      return { project: { ...state.project, tracks: newTracks, duration: computeDuration(newTracks) } };
    });
  },

  splitClip: (clipId, atTime) => {
    get().saveToUndo();
    set((state) => {
      const newTracks = state.project.tracks.map((t) => {
        const clip = t.clips.find((c) => c.id === clipId);
        if (!clip || atTime <= clip.startTime || atTime >= clip.startTime + clip.duration) return t;
        const firstDuration  = atTime - clip.startTime;
        const secondDuration = clip.duration - firstDuration;
        const existingTrimStart = clip.trimStart ?? 0;

        // For keyframes: keep only those in range for each half
        const firstKeyframes  = clip.keyframes?.filter((k) => k.time < atTime) ?? [];
        const secondKeyframes = clip.keyframes?.filter((k) => k.time >= atTime) ?? [];

        const first: Clip  = { ...clip, duration: firstDuration, keyframes: firstKeyframes };
        const second: Clip = {
          ...clip,
          id: nanoid(),
          startTime: atTime,
          duration: secondDuration,
          trimStart: existingTrimStart + firstDuration,
          keyframes: secondKeyframes,
        };
        return { ...t, clips: t.clips.flatMap((c) => (c.id === clipId ? [first, second] : [c])) };
      });
      return { project: { ...state.project, tracks: newTracks, duration: computeDuration(newTracks) } };
    });
  },

  updateProject: (updates) => {
    set((state) => ({ project: { ...state.project, ...updates } }));
  },

  undo: () => {
    const { undoStack, project, redoStack } = get();
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    set({ project: prev, undoStack: undoStack.slice(0, -1), redoStack: [JSON.parse(JSON.stringify(project)), ...redoStack.slice(0, 20)] });
  },

  redo: () => {
    const { redoStack, project, undoStack } = get();
    if (!redoStack.length) return;
    const next = redoStack[0];
    set({ project: next, redoStack: redoStack.slice(1), undoStack: [...undoStack.slice(-20), JSON.parse(JSON.stringify(project))] });
  },

  // ── Keyframe actions ───────────────────────────────────────────────────────

  addKeyframe: (clipId, property, time, value, easing = 'linear') => {
    set((state) => {
      const newTracks = state.project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c;
          const existing = c.keyframes || [];
          // Replace if one already exists at same time+property (within 0.05s tolerance)
          const filtered = existing.filter(
            (k) => !(k.property === property && Math.abs(k.time - time) < 0.05)
          );
          const newKf: Keyframe = { id: nanoid(), time, value, property, easing };
          return { ...c, keyframes: [...filtered, newKf].sort((a, b) => a.time - b.time) };
        }),
      }));
      return { project: { ...state.project, tracks: newTracks } };
    });
  },

  removeKeyframe: (clipId, keyframeId) => {
    set((state) => {
      const newTracks = state.project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c;
          return { ...c, keyframes: (c.keyframes || []).filter((k) => k.id !== keyframeId) };
        }),
      }));
      return { project: { ...state.project, tracks: newTracks } };
    });
  },

  updateKeyframe: (clipId, keyframeId, updates) => {
    set((state) => {
      const newTracks = state.project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c;
          return {
            ...c,
            keyframes: (c.keyframes || [])
              .map((k) => (k.id === keyframeId ? { ...k, ...updates } : k))
              .sort((a, b) => a.time - b.time),
          };
        }),
      }));
      return { project: { ...state.project, tracks: newTracks } };
    });
  },
}));
