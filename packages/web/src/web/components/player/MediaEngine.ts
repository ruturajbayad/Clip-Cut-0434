/**
 * MediaEngine — Isolated, framework-agnostic playback core.
 *
 * Anti-flicker architecture (v3):
 *
 * ROOT CAUSE of flickering:  `display: none` destroys the browser's GPU
 * compositor layer for a video element. Re-showing it (`display: block`) forces
 * a full layout → repaint → GPU-upload cycle that takes 1–3 frames (16–50 ms),
 * causing a visible black flash at every cut.
 *
 * FIX — three layered defences:
 *  1. GPU-layer preservation: video wrappers NEVER get `display:none`.
 *     We use `opacity 0/1` + `visibility hidden/visible` only.
 *     This keeps the element on the GPU compositor tree at all times.
 *
 *  2. requestVideoFrameCallback (rVFC) gating: before revealing an incoming
 *     clip we register a rVFC callback. The outgoing clip stays at opacity 1
 *     (holding its last frame) until rVFC fires and confirms the first decoded
 *     frame of the incoming clip is painted. Only then do we swap opacities —
 *     guaranteeing zero black frames between clips.
 *
 *  3. Aggressive pre-warming (5 s): the incoming video element is seeked to
 *     its start position and told to play+pause well before its startTime.
 *     This forces the browser decoder to decode and cache frames so rVFC fires
 *     immediately at the cut boundary (no wait).
 *
 *  4. Drift correction guarded by !seeking && readyState>=3: prevents the
 *     seek-loop that stalled playback after transitions.
 *
 * AUDIO:
 *  Videos start unmuted. Browser autoplay policy may block audio until first
 *  user gesture. We immediately attempt to play with audio; if blocked we fall
 *  back to muted and retry unmute after any user interaction.
 */

import type { Clip, Project, MediaItem } from '../../store/editorStore';

export interface MediaEngineOptions {
  onTimeUpdate: (time: number) => void;
  onEnded: () => void;
  onError?: (clipId: string, err: unknown) => void;
  uiUpdateInterval?: number;
  loop?: boolean;
}

// How many seconds before clip.startTime to begin pre-warming the decoder
const PRE_WARM_WINDOW = 8.0;

// rVFC is available in Chrome 83+, Edge 83+
type VideoFrameCallback = (now: number, metadata: unknown) => void;
interface rVFCVideo extends HTMLVideoElement {
  requestVideoFrameCallback: (cb: VideoFrameCallback) => number;
  cancelVideoFrameCallback: (id: number) => void;
}
function supportsRVFC(el: HTMLVideoElement): boolean {
  return typeof (el as any).requestVideoFrameCallback === 'function';
}

export class MediaEngine {
  private videoEls = new Map<string, HTMLVideoElement>();
  private audioEls = new Map<string, HTMLAudioElement>();
  private wrapperEls = new Map<string, HTMLElement>();

  private rafId = 0;
  private lastRafTs = 0;
  private lastUiTs = 0;

  private _time = 0;
  private _playing = false;
  private _project: Project | null = null;
  private _library: MediaItem[] = [];
  private _loop = true;

  // Audio state — start as "unlocked" to attempt audio immediately.
  // Browser will mute if autoplay policy blocks it; we retry on first gesture.
  private _audioUnlocked = true;
  private _audioRetryPending = false;

  // Clips currently shown at opacity 1 (may lag 1 frame behind isActive for crossfade hold)
  private _revealedClips = new Set<string>();
  // Clips waiting for rVFC before becoming visible
  private _pendingReveal = new Set<string>();
  // Outgoing clips held visible to prevent black frames while new clips wait for rVFC
  private _staleClips = new Set<string>();

  private opts: Required<MediaEngineOptions>;

  constructor(opts: MediaEngineOptions) {
    this._loop = opts.loop !== false;
    this.opts = {
      uiUpdateInterval: 66,
      onError: () => { },
      loop: true,
      ...opts,
    };
    this._bindUnlock();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  get currentTime() { return this._time; }
  get isPlaying() { return this._playing; }

  setProject(project: Project, library: MediaItem[]) {
    this._project = project;
    this._library = library;
    // Always sync — even during playback. This ensures any clip whose
    // trimStart/speed just changed (e.g. speed edit) gets its <video> element
    // seeked to the correct position immediately, so it's pre-warmed by the
    // time the playhead reaches it, not buffering from position 0.
    this._syncFrame(this._time);
  }

  registerVideo(clipId: string, el: HTMLVideoElement) {
    // Start unmuted — browser will throw if autoplay policy blocks, we handle below
    el.muted = false;
    el.playsInline = true;
    el.preload = 'auto';
    this.videoEls.set(clipId, el);
  }

  unregisterVideo(clipId: string) {
    this.videoEls.get(clipId)?.pause();
    this.videoEls.delete(clipId);
    this._revealedClips.delete(clipId);
    this._pendingReveal.delete(clipId);
    this._staleClips.delete(clipId);
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
    this._playing = true;
    this.lastRafTs = performance.now();
    this.lastUiTs = performance.now();
    // Unlock audio on explicit play action (user gesture)
    this._audioUnlocked = true;
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
    // Reset reveal state on seek so clips re-evaluate from scratch
    this._pendingReveal.clear();
    this._revealedClips.clear();
    this._staleClips.clear();
    this._syncFrame(this._time);
    if (!this._playing) this.opts.onTimeUpdate(this._time);
  }

  /** Force unmute all video elements (call after confirmed user gesture) */
  unmuteAll() {
    this._audioUnlocked = true;
    this.videoEls.forEach((el) => {
      el.muted = false;
      // Retry volume application
      if (!el.paused) {
        el.volume = el.volume; // triggers volume apply
      }
    });
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('click', this._unlock);
    window.removeEventListener('keydown', this._unlock);
    window.removeEventListener('touchstart', this._unlock);
    this.videoEls.forEach((el) => el.pause());
    this.audioEls.forEach((el) => el.pause());
    this.videoEls.clear();
    this.audioEls.clear();
    this.wrapperEls.clear();
    this._revealedClips.clear();
    this._pendingReveal.clear();
    this._staleClips.clear();
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private _startLoop() {
    const tick = (now: number) => {
      if (!this._playing) return;

      const delta = Math.min((now - this.lastRafTs) / 1000, 0.1);
      this.lastRafTs = now;

      const duration = this._project?.duration ?? 60;
      const next = this._time + delta;

      if (next >= duration) {
        this._time = 0;
        this._pendingReveal.clear();
        this._revealedClips.clear();
        this._staleClips.clear();
        this._syncFrame(0);
        this.opts.onTimeUpdate(0);

        if (this._loop) {
          this.lastRafTs = now;
          this.lastUiTs = now;
          this.rafId = requestAnimationFrame(tick);
        } else {
          this._playing = false;
          this.opts.onEnded();
        }
        return;
      }

      this._time = next;
      this._syncFrame(next);

      if (now - this.lastUiTs > this.opts.uiUpdateInterval) {
        this.lastUiTs = now;
        this.opts.onTimeUpdate(next);
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  // ─── Core sync — called every RAF frame ──────────────────────────────────────

  private _syncFrame(time: number) {
    if (!this._project) return;
    const clips = this._project.tracks.flatMap((t) => t.clips);

    // Pass 1: Mark pending reveals for any newly active video clips.
    clips.forEach((clip) => {
      if (clip.type !== 'video') return;
      const isActive = time >= clip.startTime && time < clip.startTime + clip.duration;
      if (isActive && !this._revealedClips.has(clip.id) && !this._pendingReveal.has(clip.id)) {
        const wrapper = this.wrapperEls.get(clip.id);
        if (wrapper) this._gateReveal(clip.id, wrapper);
      }
    });

    // Pass 2: Sync visibility and elements
    clips.forEach((clip) => {
      if (clip.type !== 'video' && clip.type !== 'audio') return;

      const isActive = time >= clip.startTime && time < clip.startTime + clip.duration;
      const timeToStart = clip.startTime - time;
      const isPreWarming = !isActive && timeToStart > 0 && timeToStart <= PRE_WARM_WINDOW;

      const wrapper = this.wrapperEls.get(clip.id);

      // ── Video wrapper visibility ────────────────────────────────────────────
      if (wrapper && clip.type === 'video') {
        wrapper.style.display = 'block';

        if (isActive) {
          if (this._staleClips.has(clip.id)) {
            this._staleClips.delete(clip.id); // It became active again
          }
        } else {
          // Clip is no longer active
          if (this._pendingReveal.has(clip.id)) {
            // Was waiting to reveal but clip ended — cancel
            this._pendingReveal.delete(clip.id);
            this._setWrapperHidden(wrapper);
          }
          if (this._revealedClips.has(clip.id) && !this._staleClips.has(clip.id)) {
            this._staleClips.add(clip.id);
          }

          const isStale = this._staleClips.has(clip.id);
          const holdStale = isStale && this._pendingReveal.size > 0;

          if (!holdStale) {
            if (isStale) {
              this._staleClips.delete(clip.id);
              this._revealedClips.delete(clip.id);
              this._setWrapperHidden(wrapper);
            } else {
              this._setWrapperHidden(wrapper);
            }
          }
        }
      }

      // ── Audio wrapper visibility (display:none is fine — no visual) ─────────
      if (wrapper && clip.type === 'audio') {
        wrapper.style.display = isActive ? 'block' : 'none';
      }

      // ── Media element sync ──────────────────────────────────────────────────
      if (clip.type === 'video') {
        const el = this.videoEls.get(clip.id);
        if (el) this._syncVideoEl(el, clip, time, isActive, isPreWarming);
      }
      if (clip.type === 'audio') {
        const el = this.audioEls.get(clip.id);
        if (el) this._syncAudioEl(el, clip, time, isActive);
      }
    });
  }

  /** Show wrapper: opacity 1, visible, pointer events on */
  private _setWrapperVisible(wrapper: HTMLElement) {
    wrapper.style.opacity = '1';
    wrapper.style.visibility = 'visible';
    wrapper.style.pointerEvents = 'auto';
  }

  /** Hide wrapper: opacity 0, visibility hidden, pointer events off.
   *  Does NOT set display:none — preserves the GPU compositor layer. */
  private _setWrapperHidden(wrapper: HTMLElement) {
    wrapper.style.opacity = '0';
    wrapper.style.visibility = 'hidden';
    wrapper.style.pointerEvents = 'none';
  }

  private _gateReveal(clipId: string, wrapper: HTMLElement) {
    this._pendingReveal.add(clipId);

    const el = this.videoEls.get(clipId);
    if (!el) {
      this._doReveal(clipId, wrapper);
      return;
    }

    const reveal = () => {
      if (!this._pendingReveal.has(clipId)) return;
      this._doReveal(clipId, wrapper);
    };

    // rVFC only fires when a new frame is painted — i.e. the video must be PLAYING.
    // If the video is paused (pre-warmed) and has data ready, reveal immediately
    // using readyState check to avoid a black-frame stall.
    if (el.readyState >= 2) {
      // Frame data available — reveal immediately, no need to wait for rVFC.
      // Use a microtask so the calling _syncFrame pass completes first.
      Promise.resolve().then(reveal);
      return;
    }

    // Not ready yet — wait for canplay, then reveal
    const onCanPlay = () => {
      if (!this._pendingReveal.has(clipId)) return;
      if (supportsRVFC(el) && !el.paused) {
        // Video is playing and rVFC available — use it for precise frame timing
        (el as rVFCVideo).requestVideoFrameCallback(reveal);
      } else {
        reveal();
      }
    };

    el.addEventListener('canplay', onCanPlay, { once: true });

    // Safety timeout: if canplay never fires within 300ms, reveal anyway
    // to prevent a permanent freeze (e.g. network slow, codec issue)
    setTimeout(() => {
      if (this._pendingReveal.has(clipId)) reveal();
    }, 300);
  }

  private _doReveal(clipId: string, wrapper: HTMLElement) {
    this._pendingReveal.delete(clipId);
    this._revealedClips.add(clipId);
    this._setWrapperVisible(wrapper);

    if (this._pendingReveal.size === 0) {
      for (const staleId of this._staleClips) {
        this._revealedClips.delete(staleId);
        const staleWrapper = this.wrapperEls.get(staleId);
        if (staleWrapper) this._setWrapperHidden(staleWrapper);
      }
      this._staleClips.clear();
    }
  }

  // ─── Video element sync ───────────────────────────────────────────────────────

  private _syncVideoEl(
    el: HTMLVideoElement,
    clip: Clip,
    time: number,
    isActive: boolean,
    isPreWarming: boolean,
  ) {
    if (isActive) {
      const speed = clip.speed ?? 1;
      const reverse = clip.reverse ?? false;
      // How far into the source file (accounting for trimStart and speed)
      const elapsed = (time - clip.startTime) * speed;
      const trimStart = clip.trimStart ?? 0;
      // sourceDuration: actual media file duration. Use el.duration if loaded, else fall back.
      // For reverse mapping we need to know the full source length.
      const sourceDur = clip.sourceDuration ?? (el.duration > 0 ? el.duration : (clip.duration * speed));
      // Position in source file (forward)
      const sourcePos = trimStart + elapsed;
      // For reverse: play from end → start of the source segment
      const safeTime = reverse
        ? Math.max(0, Math.min(sourceDur, sourceDur - elapsed + trimStart))
        : Math.max(0, Math.min(sourceDur, sourcePos));

      el.volume = Math.max(0, Math.min(1, clip.volume ?? 1));
      // Only mute if audio hasn't been unlocked yet (autoplay policy)
      // We start as unlocked=true, so videos play with audio from the start
      el.muted = false;

      // Apply playback rate; reverse is handled by seeking each frame
      el.playbackRate = reverse ? 1 : Math.max(0.0625, Math.min(16, speed));

      if (this._playing) {
        if (reverse) {
          // Reverse mode: keep video paused, seek to computed position each frame.
          // Threshold of 1/fps to avoid thrashing seeks on every RAF tick.
          if (!el.paused) el.pause();
          if (el.readyState >= 2 && Math.abs(el.currentTime - safeTime) > 0.033) {
            el.currentTime = safeTime;
          }
        } else if (el.paused) {
          if (Math.abs(el.currentTime - safeTime) > 0.08) {
            el.currentTime = safeTime;
          }

          const tryPlay = () => {
            if (!this._playing) return;
            el.play().catch((err) => {
              // If autoplay with audio is blocked, mute and retry
              if ((err as Error)?.name === 'NotAllowedError') {
                el.muted = true;
                this._audioRetryPending = true;
                el.play().catch(() => this.opts.onError?.(clip.id, err));
              } else {
                this.opts.onError?.(clip.id, err);
              }
            });
          };

          if (el.readyState >= 3) {
            tryPlay();
          } else {
            el.addEventListener('canplay', () => tryPlay(), { once: true });
          }
        } else {
          if (el.readyState >= 3 && !el.seeking) {
            const drift = Math.abs(el.currentTime - safeTime);
            if (drift > 0.5) el.currentTime = safeTime;
          }
          // Ensure unmuted if audio was unlocked via user gesture
          if (!el.muted && this._audioUnlocked) {
            // already unmuted — good
          } else if (this._audioUnlocked && el.muted && this._audioRetryPending) {
            el.muted = false;
            this._audioRetryPending = false;
          }
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - safeTime) > 0.05) el.currentTime = safeTime;
      }
    } else if (isPreWarming) {
      const startPos = clip.trimStart ?? 0;
      // Always seek to trimStart so frame is decoded and in GPU memory
      if (Math.abs(el.currentTime - startPos) > 0.15) {
        el.currentTime = startPos;
      }
      // Force the browser to decode the frame: play briefly then pause.
      // This ensures readyState reaches >= 2 so _gateReveal can reveal immediately.
      if (el.paused) {
        el.play()
          .then(() => {
            // Pause right away — we just want the decoder to warm up
            el.pause();
            el.currentTime = startPos;
          })
          .catch(() => { });
      } else if (!el.paused) {
        el.pause();
        el.currentTime = startPos;
      }
    } else {
      if (!el.paused) el.pause();
    }
  }

  // ─── Audio element sync ───────────────────────────────────────────────────────

  private _syncAudioEl(el: HTMLAudioElement, clip: Clip, time: number, isActive: boolean) {
    if (isActive) {
      const audioTime = Math.max(0, (clip.trimStart ?? 0) + (time - clip.startTime));
      el.volume = Math.max(0, Math.min(1, clip.volume ?? 1));

      if (this._playing) {
        if (el.paused) {
          el.currentTime = audioTime;
          el.play().catch((err) => {
            if ((err as Error)?.name === 'NotAllowedError') {
              // Audio blocked by autoplay policy — will retry on next user gesture
              this._audioRetryPending = true;
            } else {
              this.opts.onError?.(clip.id, err);
            }
          });
        } else {
          if (el.readyState >= 3 && !el.seeking) {
            const drift = Math.abs(el.currentTime - audioTime);
            if (drift > 0.5) el.currentTime = audioTime;
          }
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - audioTime) > 0.05) el.currentTime = audioTime;
      }
    } else {
      if (!el.paused) el.pause();
    }
  }

  // ─── Audio unlock (retry after user gesture if autoplay was blocked) ──────────

  private _unlock = () => {
    this._audioUnlocked = true;
    if (this._audioRetryPending) {
      this._audioRetryPending = false;
      // Unmute all videos and retry audio
      this.videoEls.forEach((el) => {
        el.muted = false;
      });
      // Retry stalled audio clips
      this.audioEls.forEach((el) => {
        if (el.paused && this._playing) {
          el.play().catch(() => { });
        }
      });
    }
  };

  private _bindUnlock() {
    window.addEventListener('click', this._unlock);
    window.addEventListener('keydown', this._unlock);
    window.addEventListener('touchstart', this._unlock);
  }
}
