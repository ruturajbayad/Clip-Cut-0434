import { create } from 'zustand';
import { nanoid } from 'nanoid';

export type TrackType = 'video' | 'audio' | 'text' | 'effects' | 'image';

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
  fontWeight?: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  letterSpacing?: number;   // px
  lineHeight?: number;      // multiplier e.g. 1.2
  textShadow?: string;      // CSS text-shadow string or preset key
  textBackground?: string;  // background color for text box (hex or rgba)
  textOutline?: string;     // CSS stroke color e.g. '#000000'
  textOutlineWidth?: number; // stroke width in px
  textUppercase?: boolean;
  effect?: string;
  filterCss?: string; // raw CSS filter string from filter presets
  transition?: string;
  entryTransition?: 'none' | 'fade-in' | 'slide-up' | 'slide-left' | 'zoom-in'; // entry animation
  trimStart?: number; // seconds offset into the source file (for split clips)
  speed?: number;          // playback rate multiplier (default 1)
  reverse?: boolean;       // play clip in reverse
  sourceDuration?: number; // original unmodified duration (before speed changes)
  blendMode?: string;      // CSS mix-blend-mode for image clips
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
  return max === 0 ? 5 : Math.max(max, 5);
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
  /** Canvas aspect ratio — synced from PreviewCanvas so export uses correct dimensions */
  canvasAspectRatio: { w: number; h: number };
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
  setCanvasAspectRatio: (ar: { w: number; h: number }) => void;
  setShowTransitionPicker: (show: boolean, position?: { x: number; y: number }, clipId?: string) => void;
  addMediaItem: (item: MediaItem) => void;
  addTrack: (type: TrackType) => void;
  removeTrack: (trackId: string) => void;
  addClip: (trackId: string, clip: Partial<Clip>) => void;
  addClipFromMedia: (media: MediaItem, trackType?: TrackType) => void;
  removeClip: (clipId: string) => void;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  updateClipSpeed: (clipId: string, speed: number) => void;
  moveClip: (clipId: string, newTrackId: string, newStartTime: number) => void;
  splitClip: (clipId: string, atTime: number) => void;
  updateProject: (updates: Partial<Project>) => void;
  recomputeDuration: () => void;
  reorderTrack: (trackId: string, direction: 'up' | 'down') => void;
  undo: () => void;
  redo: () => void;
  saveToUndo: () => void;
  // Keyframe actions
  addKeyframe: (clipId: string, property: string, time: number, value: number, easing?: Keyframe['easing']) => void;
  removeKeyframe: (clipId: string, keyframeId: string) => void;
  updateKeyframe: (clipId: string, keyframeId: string, updates: Partial<Omit<Keyframe, 'id'>>) => void;
}

// The default video MediaItem uses the static public file served by Vite
const DEFAULT_VIDEO_MEDIA_ID = 'default-4k-video';
const DEFAULT_VIDEO_SRC      = '/4k_video.mp4';

export const defaultVideoMediaItem: MediaItem = {
  id:             DEFAULT_VIDEO_MEDIA_ID,
  name:           '4K Video',
  type:           'video',
  src:            DEFAULT_VIDEO_SRC,
  duration:       23,
  thumbnailColor: '#818CF8',
};

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
      clips: [],
    },
    {
      id: a1id,
      type: 'audio',
      name: 'Audio 1',
      muted: false,
      locked: false,
      visible: true,
      height: 48,
      clips: [],
    },
    {
      id: t1id,
      type: 'text',
      name: 'Text 1',
      muted: false,
      locked: false,
      visible: true,
      height: 44,
      clips: [],
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
  mediaLibrary: [defaultVideoMediaItem],
  currentTime: 0,
  isPlaying: false,
  zoom: 50,
  selectedClipId: null,
  selectedTrackId: null,
  activePanel: 'media',
  showExportModal: false,
  canvasAspectRatio: { w: 16, h: 9 },
  showTransitionPicker: false,
  transitionPickerPosition: null,
  transitionPickerClipId: null,
  undoStack: [],
  redoStack: [],

  setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setZoom: (zoom) => set({ zoom: Math.min(800, Math.max(5, zoom)) }),
  setSelectedClip: (id) => set({ selectedClipId: id }),
  setSelectedTrack: (id) => set({ selectedTrackId: id }),
  setActivePanel: (panel) => set({ activePanel: panel }),
  setShowExportModal: (show) => set({ showExportModal: show }),
  setCanvasAspectRatio: (ar) => set({ canvasAspectRatio: ar }),
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
          name: type === 'image'
            ? `Image ${state.project.tracks.filter((t) => t.type === type).length + 1}`
            : `${type.charAt(0).toUpperCase() + type.slice(1)} ${state.project.tracks.filter((t) => t.type === type).length + 1}`,
          muted: false,
          locked: false,
          visible: true,
          height: type === 'video' ? 56 : type === 'image' ? 48 : 44,
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

  reorderTrack: (trackId, direction) => {
    get().saveToUndo();
    set((state) => {
      const tracks = [...state.project.tracks];
      const idx = tracks.findIndex((t) => t.id === trackId);
      if (idx === -1) return {};
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= tracks.length) return {};
      [tracks[idx], tracks[newIdx]] = [tracks[newIdx], tracks[idx]];
      return { project: { ...state.project, tracks } };
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

    // Route image media to dedicated 'image' track; video stays on 'video'; audio on 'audio'
    const type: TrackType = trackType ||
      (media.type === 'audio' ? 'audio' :
       media.type === 'image' ? 'image' : 'video');

    // For video: if the main video track already has clips, always add to a NEW overlay video track
    // so multiple video clips can be managed as PIP overlays
    let track: Track | undefined;
    let newTracks = project.tracks;

    if (type === 'video') {
      // Always append to first video track by default (user can add more tracks explicitly)
      track = project.tracks.find((t) => t.type === 'video');
    } else {
      track = project.tracks.find((t) => t.type === type);
    }

    if (!track) {
      const id = nanoid();
      const trackNum = project.tracks.filter((t) => t.type === type).length + 1;
      track = {
        id,
        type,
        name: type === 'image' ? `Image ${trackNum}` :
              `${type.charAt(0).toUpperCase() + type.slice(1)} ${trackNum}`,
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

    // Image overlays default to 40% canvas size, centered; full video fills canvas
    const isImageOverlay = type === 'image';

    const clipSourceDur = media.duration || 5;
    const newClip: Clip = {
      id: nanoid(),
      trackId: track.id,
      name: media.name,
      type,
      startTime: endTime,
      duration: clipSourceDur,
      sourceDuration: clipSourceDur,
      src: media.src,
      mediaId: media.id,
      thumbnailColor: media.thumbnailColor || '#818CF8',
      opacity: 1,
      x: 0.5,
      y: 0.5,
      scaleX: isImageOverlay ? 0.4 : 1,
      scaleY: isImageOverlay ? 0.4 : 1,
      trimStart: 0,
      speed: 1,
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

  /**
   * Change clip speed and:
   *  1. Update clip.duration = sourceDuration / speed (so the timeline block shrinks/grows)
   *  2. Push/pull subsequent clips on the same track so they don't overlap / leave gaps
   */
  updateClipSpeed: (clipId, speed) => {
    get().saveToUndo();
    set((state) => {
      const safeSpeed = Math.max(0.0625, Math.min(16, speed));
      const newTracks = state.project.tracks.map((track) => {
        const clipIdx = track.clips.findIndex((c) => c.id === clipId);
        if (clipIdx === -1) return track;

        const clip = track.clips[clipIdx];
        // sourceDuration is set when clip is created (= original media duration).
        // If not set yet, treat current duration*currentSpeed as the source duration.
        const currentSpeed = clip.speed ?? 1;
        const srcDur = clip.sourceDuration ?? (clip.duration * currentSpeed);
        const newDuration = srcDur / safeSpeed;
        const oldDuration = clip.duration;
        const delta = newDuration - oldDuration;

        // Update this clip
        const updatedClip: Clip = {
          ...clip,
          speed: safeSpeed,
          duration: newDuration,
          sourceDuration: srcDur,
        };

        // Push subsequent clips (those that start at or after the end of this clip)
        const clipEnd = clip.startTime + oldDuration;
        const newClips = track.clips.map((c, i) => {
          if (i === clipIdx) return updatedClip;
          // Only push clips that START at or after the current clip's end (same-track)
          if (c.startTime >= clipEnd) {
            return { ...c, startTime: Math.max(0, c.startTime + delta) };
          }
          return c;
        });

        return { ...track, clips: newClips };
      });

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
      const clipToUpdate: Clip = targetClip;
      const updatedClip = { ...clipToUpdate, trackId: newTrackId, startTime: Math.max(0, newStartTime) };
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
