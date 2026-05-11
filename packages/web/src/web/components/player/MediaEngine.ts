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
const PRE_WARM_WINDOW = 5.0;

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

  private _audioUnlocked = false;

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
    if (!this._playing) this._syncFrame(this._time);
  }

  registerVideo(clipId: string, el: HTMLVideoElement) {
    el.muted = !this._audioUnlocked;
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
    // Reset entry transition transforms on all wrappers
    this.wrapperEls.forEach((wrapper) => {
      wrapper.style.transform = 'translateZ(0)';
    });
    this._syncFrame(this._time);
    if (!this._playing) this.opts.onTimeUpdate(this._time);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('click', this._unlock);
    window.removeEventListener('keydown', this._unlock);
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
    // Doing this before evaluating outgoing clips ensures that the outgoing clips
    // know a transition is pending and hold their last frame (preventing a 1-frame black flash
    // caused by array evaluation order).
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

  /**
   * Gate the reveal of an incoming clip on its first decoded video frame.
   *
   * Uses requestVideoFrameCallback (Chrome/Edge 83+) when available.
   * Falls back to an immediate reveal after the element reaches readyState ≥ 3.
   *
   * This guarantees the outgoing clip's last frame is held visible until the
   * incoming clip has at least one frame ready to paint — zero black frames.
   */
  private _gateReveal(clipId: string, wrapper: HTMLElement) {
    this._pendingReveal.add(clipId);

    const el = this.videoEls.get(clipId);
    if (!el) {
      // No video element yet — reveal immediately (text/image track?)
      this._doReveal(clipId, wrapper);
      return;
    }

    // If the element hasn't started loading yet (readyState 0 = HAVE_NOTHING),
    // call load() explicitly. Without this, the src may never be fetched and
    // the canplay/rVFC events never fire — causing clips to stay invisible forever.
    if (el.readyState < 1) {
      el.load();
    }

    const reveal = () => {
      if (!this._pendingReveal.has(clipId)) return; // was cancelled
      this._doReveal(clipId, wrapper);
    };

    // Safety-net timeout: if rVFC/canplay never fires within 3s (e.g. network
    // issue, codec mismatch, same-src element not triggering events), reveal anyway.
    const timeoutId = window.setTimeout(() => {
      if (this._pendingReveal.has(clipId)) {
        console.warn(`[MediaEngine] reveal timeout for clip ${clipId}, forcing reveal`);
        reveal();
      }
    }, 3000);

    const revealOnce = () => {
      window.clearTimeout(timeoutId);
      reveal();
    };

    if (supportsRVFC(el)) {
      // Best path: fire exactly when first frame is painted to screen
      (el as rVFCVideo).requestVideoFrameCallback(revealOnce);
    } else if (el.readyState >= 3) {
      // Already has frames buffered — reveal now
      window.clearTimeout(timeoutId);
      reveal();
    } else {
      // Fall back: reveal as soon as browser can play
      el.addEventListener('canplay', revealOnce, { once: true });
    }
  }

  private _doReveal(clipId: string, wrapper: HTMLElement) {
    this._pendingReveal.delete(clipId);
    this._revealedClips.add(clipId);
    this._setWrapperVisible(wrapper);

    // If no clips are waiting to reveal, clean up any stale outgoing clips
    if (this._pendingReveal.size === 0) {
      for (const staleId of this._staleClips) {
        this._revealedClips.delete(staleId);
        const staleWrapper = this.wrapperEls.get(staleId);
        if (staleWrapper) this._setWrapperHidden(staleWrapper);
      }
      this._staleClips.clear();
    }
  }

  // ─── Entry transition helper ──────────────────────────────────────────────────

  private _ENTRY_DUR = 0.5; // seconds

  private _applyEntryTransition(wrapper: HTMLElement, clip: Clip, time: number) {
    const entry = clip.entryTransition ?? 'none';
    if (entry === 'none') {
      // Reset any leftover transforms
      wrapper.style.transform = 'translateZ(0)';
      wrapper.style.opacity = '1';
      return;
    }
    const elapsed = time - clip.startTime;
    if (elapsed >= this._ENTRY_DUR) {
      wrapper.style.transform = 'translateZ(0)';
      wrapper.style.opacity = '1';
      return;
    }
    const t = Math.max(0, Math.min(1, elapsed / this._ENTRY_DUR));
    switch (entry) {
      case 'fade-in':
        // MediaEngine already controls opacity via _setWrapperVisible; apply inline opacity on the video child
        wrapper.style.transform = 'translateZ(0)';
        wrapper.style.opacity = String(t);
        break;
      case 'slide-up': {
        const dy = (1 - t) * 40;
        wrapper.style.transform = `translateY(${dy}px) translateZ(0)`;
        wrapper.style.opacity = String(t);
        break;
      }
      case 'slide-left': {
        const dx = (1 - t) * 60;
        wrapper.style.transform = `translateX(${dx}px) translateZ(0)`;
        wrapper.style.opacity = String(t);
        break;
      }
      case 'zoom-in': {
        const scale = 0.6 + t * 0.4;
        wrapper.style.transform = `scale(${scale}) translateZ(0)`;
        wrapper.style.opacity = String(t);
        break;
      }
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
      // safeTime = position inside the source file at the current project time
      // = trimStart + (elapsed project time * speed)
      const clipTime = (clip.trimStart ?? 0) + (time - clip.startTime) * speed;
      const safeTime = Math.max(0, clipTime);

      el.volume = Math.max(0, Math.min(1, clip.volume ?? 1));
      el.muted = !this._audioUnlocked;
      // Always set playbackRate so speed changes take effect immediately
      el.playbackRate = speed;

      // Apply entry transition to wrapper (only during first ENTRY_DUR seconds)
      const wrapper = this.wrapperEls.get(clip.id);
      if (wrapper && this._revealedClips.has(clip.id)) {
        this._applyEntryTransition(wrapper, clip, time);
      }

      if (this._playing) {
        if (el.paused) {
          // If element hasn't loaded at all, kick load() first
          if (el.readyState < 1) {
            el.load();
          }

          // Seek to position if meaningfully off
          if (el.readyState >= 1 && Math.abs(el.currentTime - safeTime) > 0.08) {
            el.currentTime = safeTime;
          }

          const tryPlay = () => {
            if (!this._playing) return;
            el.playbackRate = speed;
            el.play().catch((err) => this.opts.onError?.(clip.id, err));
          };

          if (el.readyState >= 3) {
            tryPlay();
          } else {
            el.addEventListener('canplay', () => tryPlay(), { once: true });
          }
        } else {
          // Already playing — only correct large drift, never during seeking
          el.playbackRate = speed;
          if (el.readyState >= 3 && !el.seeking) {
            const drift = Math.abs(el.currentTime - safeTime);
            if (drift > 0.5) el.currentTime = safeTime;
          }
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - safeTime) > 0.05) el.currentTime = safeTime;
      }
    } else if (isPreWarming) {
      // ── Aggressive pre-warming ────────────────────────────────────────────
      // Seek to the clip's start position so the decoder loads and caches frames.
      // Call play() then immediately pause() to force hardware decoder warmup.
      const startPos = clip.trimStart ?? 0;
      if (Math.abs(el.currentTime - startPos) > 0.15) {
        el.currentTime = startPos;
      }

      if (el.paused && el.readyState < 3) {
        // Kick the decoder: play() starts decoding, pause() halts rendering
        el.play()
          .then(() => el.pause())
          .catch(() => { }); // ignore autoplay policy errors during pre-warm
      } else if (!el.paused) {
        el.pause();
      }
    } else {
      // ── Cold (far from start) — just make sure it's paused ────────────────
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
          el.play().catch((err) => this.opts.onError?.(clip.id, err));
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

  // ─── Audio unlock ─────────────────────────────────────────────────────────────

  private _unlock = () => {
    if (this._audioUnlocked) return;
    this._audioUnlocked = true;
    this.videoEls.forEach((el) => { el.muted = false; });
    window.removeEventListener('click', this._unlock);
    window.removeEventListener('keydown', this._unlock);
  };

  private _bindUnlock() {
    window.addEventListener('click', this._unlock, { once: false });
    window.addEventListener('keydown', this._unlock, { once: false });
  }
}
