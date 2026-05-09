/**
 * MediaEngine — Isolated, framework-agnostic playback core.
 *
 * Responsibilities:
 *  - Manages a registry of HTMLVideoElement / HTMLAudioElement instances
 *  - Runs a requestAnimationFrame loop to drive playback
 *  - Syncs clip visibility, play/pause, seek, volume every frame
 *  - Fires onTimeUpdate callback at a throttled rate for UI
 *  - Handles autoplay policy: starts muted, unmutes after user gesture
 *  - Loops playback: when project ends, restarts from t=0 seamlessly
 */

import type { Clip, Project, MediaItem } from '../../store/editorStore';

export interface MediaEngineOptions {
  onTimeUpdate: (time: number) => void; // called ~15fps, for UI timecode / scrubber
  onEnded: () => void;                  // called when project reaches end (loop point)
  onError?: (clipId: string, err: unknown) => void;
  uiUpdateInterval?: number;            // ms between onTimeUpdate calls (default 66 = ~15fps)
  loop?: boolean;                       // default true — restart from 0 when end reached
}

export class MediaEngine {
  private videoEls  = new Map<string, HTMLVideoElement>();
  private audioEls  = new Map<string, HTMLAudioElement>();
  private wrapperEls = new Map<string, HTMLElement>();

  private rafId    = 0;
  private lastRafTs = 0;
  private lastUiTs  = 0;

  private _time    = 0;
  private _playing = false;
  private _project: Project | null = null;
  private _library: MediaItem[]    = [];
  private _loop    = true;

  private _audioUnlocked = false;

  private opts: Required<MediaEngineOptions>;

  constructor(opts: MediaEngineOptions) {
    this._loop = opts.loop !== false; // default true
    this.opts  = {
      uiUpdateInterval: 66,
      onError: () => {},
      loop: true,
      ...opts,
    };
    this._bindUnlock();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  get currentTime() { return this._time; }
  get isPlaying()   { return this._playing; }

  setProject(project: Project, library: MediaItem[]) {
    this._project = project;
    this._library = library;
    if (!this._playing) this._syncFrame(this._time);
  }

  registerVideo(clipId: string, el: HTMLVideoElement) {
    el.muted      = !this._audioUnlocked;
    el.playsInline = true;
    el.preload    = 'auto';
    this.videoEls.set(clipId, el);
  }

  unregisterVideo(clipId: string) {
    this.videoEls.get(clipId)?.pause();
    this.videoEls.delete(clipId);
  }

  registerAudio(clipId: string, el: HTMLAudioElement) {
    el.preload = 'auto';
    this.audioEls.set(clipId, el);
  }

  unregisterAudio(clipId: string) {
    this.audioEls.get(clipId)?.pause();
    this.audioEls.delete(clipId);
  }

  registerWrapper(clipId: string, el: HTMLElement) {
    this.wrapperEls.set(clipId, el);
  }

  unregisterWrapper(clipId: string) {
    this.wrapperEls.delete(clipId);
  }

  play() {
    if (this._playing) return;
    this._playing  = true;
    this.lastRafTs = performance.now();
    this.lastUiTs  = performance.now();
    this._startLoop();
  }

  pause() {
    if (!this._playing) return;
    this._playing = false;
    cancelAnimationFrame(this.rafId);
    this.videoEls.forEach((el) => { if (!el.paused) el.pause(); });
    this.audioEls.forEach((el) => { if (!el.paused) el.pause(); });
    this._syncFrame(this._time);
    this.opts.onTimeUpdate(this._time);
  }

  seek(time: number) {
    this._time = Math.max(0, time);
    this._syncFrame(this._time);
    if (!this._playing) this.opts.onTimeUpdate(this._time);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('click',   this._unlock);
    window.removeEventListener('keydown', this._unlock);
    this.videoEls.forEach((el) => el.pause());
    this.audioEls.forEach((el) => el.pause());
    this.videoEls.clear();
    this.audioEls.clear();
    this.wrapperEls.clear();
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private _startLoop() {
    const tick = (now: number) => {
      if (!this._playing) return;

      const delta    = Math.min((now - this.lastRafTs) / 1000, 0.1);
      this.lastRafTs = now;

      const duration = this._project?.duration ?? 60;
      const next     = this._time + delta;

      if (next >= duration) {
        // ── Loop: seek back to 0 and keep playing ──────────────────────────
        this._time = 0;
        this._syncFrame(0);
        this.opts.onTimeUpdate(0);

        if (this._loop) {
          // Continue playing — reset timestamps so no time-jump on next tick
          this.lastRafTs = now;
          this.lastUiTs  = now;
          this.rafId = requestAnimationFrame(tick);
        } else {
          this._playing = false;
          this.opts.onEnded();
        }
        return;
      }

      this._time = next;
      this._syncFrame(next);

      // Throttled UI update (~15fps to keep React re-renders cheap)
      if (now - this.lastUiTs > this.opts.uiUpdateInterval) {
        this.lastUiTs = now;
        this.opts.onTimeUpdate(next);
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private _syncFrame(time: number) {
    if (!this._project) return;
    const clips = this._project.tracks.flatMap((t) => t.clips);

    clips.forEach((clip) => {
      if (clip.type !== 'video' && clip.type !== 'audio') return;
      const isActive = time >= clip.startTime && time < clip.startTime + clip.duration;

      const wrapper = this.wrapperEls.get(clip.id);
      if (wrapper) wrapper.style.display = isActive ? 'block' : 'none';

      if (clip.type === 'video') {
        const el = this.videoEls.get(clip.id);
        if (el) this._syncVideoEl(el, clip, time, isActive);
      }
      if (clip.type === 'audio') {
        const el = this.audioEls.get(clip.id);
        if (el) this._syncAudioEl(el, clip, time, isActive);
      }
    });
  }

  private _syncVideoEl(el: HTMLVideoElement, clip: Clip, time: number, isActive: boolean) {
    if (isActive) {
      const clipTime = (clip.trimStart ?? 0) + (time - clip.startTime);
      const safeTime = Math.max(0, clipTime);

      el.volume = Math.max(0, Math.min(1, clip.volume ?? 1));
      el.muted  = !this._audioUnlocked;

      if (this._playing) {
        if (el.paused) {
          el.currentTime = safeTime;
          el.play().catch((err) => this.opts.onError?.(clip.id, err));
        } else {
          const drift = Math.abs(el.currentTime - safeTime);
          if (drift > 0.3) el.currentTime = safeTime;
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - safeTime) > 0.05) el.currentTime = safeTime;
      }
    } else {
      if (!el.paused) el.pause();
    }
  }

  private _syncAudioEl(el: HTMLAudioElement, clip: Clip, time: number, isActive: boolean) {
    if (isActive) {
      const audioTime = Math.max(0, time - clip.startTime);
      el.volume = Math.max(0, Math.min(1, clip.volume ?? 1));

      if (this._playing) {
        if (el.paused) {
          el.currentTime = audioTime;
          el.play().catch((err) => this.opts.onError?.(clip.id, err));
        } else {
          const drift = Math.abs(el.currentTime - audioTime);
          if (drift > 0.3) el.currentTime = audioTime;
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - audioTime) > 0.05) el.currentTime = audioTime;
      }
    } else {
      if (!el.paused) el.pause();
    }
  }

  private _unlock = () => {
    if (this._audioUnlocked) return;
    this._audioUnlocked = true;
    this.videoEls.forEach((el) => { el.muted = false; });
    window.removeEventListener('click',   this._unlock);
    window.removeEventListener('keydown', this._unlock);
  };

  private _bindUnlock() {
    window.addEventListener('click',   this._unlock, { once: false });
    window.addEventListener('keydown', this._unlock, { once: false });
  }
}
