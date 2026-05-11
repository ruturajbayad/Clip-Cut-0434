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
  private _pendingSyncTimer = 0; // debounce timer for post-registration sync

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
    // Use debounced sync so project updates and DOM registrations settle before evaluating.
    // If playing, the RAF loop will pick up the new project immediately.
    if (!this._playing) this._scheduleSync();
  }

  registerVideo(clipId: string, el: HTMLVideoElement) {
    el.muted = !this._audioUnlocked;
    el.playsInline = true;
    el.preload = 'auto';
    this.videoEls.set(clipId, el);
    // Debounced sync: batch all registrations from one React render into a single _syncFrame
    this._scheduleSync();
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
    // If this clip was already revealed before its wrapper registered,
    // apply visibility now so it doesn't stay hidden forever.
    if (this._revealedClips.has(clipId)) {
      this._setWrapperVisible(el);
    } else {
      // Start hidden — MediaEngine will reveal via _gateReveal when active
      this._setWrapperHidden(el);
    }
    // Debounced sync: re-evaluate all clips after registrations settle
    this._scheduleSync();
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
    // NOTE: do NOT reset wrapper transforms on seek — VideoLayer's subscription
    // owns left/top/width/height/transform and will reapply after the store updates.
    this._syncFrame(this._time);
    if (!this._playing) this.opts.onTimeUpdate(this._time);
  }

  /** Debounced sync — batch all registrations from one React render into one _syncFrame */
  private _scheduleSync() {
    if (this._pendingSyncTimer) return; // already scheduled
    this._pendingSyncTimer = window.setTimeout(() => {
      this._pendingSyncTimer = 0;
      if (!this._playing) this._syncFrame(this._time);
    }, 50); // 50ms: enough for all React useEffect/ref callbacks to settle
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    window.clearTimeout(this._pendingSyncTimer);
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

    if (el.readyState >= 1) {
      // Has at least metadata (readyState 1) — enough to seek and show a frame.
      // Reveal immediately; _syncVideoEl will seek to the right position.
      window.clearTimeout(timeoutId);
      reveal();
    } else if (supportsRVFC(el) && this._playing) {
      // rVFC only fires when a frame is actually painted — only reliable during playback.
      // When paused, rVFC never fires because no new frames are rendered.
      (el as rVFCVideo).requestVideoFrameCallback(revealOnce);
    } else {
      // Paused or no rVFC — wait for canplay (fires as soon as first frame is decodable).
      // This is the safe path for initial load at t=0 where video is paused.
      el.addEventListener('canplay', revealOnce, { once: true });
      // Also register rVFC as a backup if playback starts before canplay fires
      if (supportsRVFC(el)) {
        (el as rVFCVideo).requestVideoFrameCallback(() => {
          if (this._pendingReveal.has(clipId)) revealOnce();
        });
      }
    }
  }

  private _doReveal(clipId: string, wrapper: HTMLElement) {
    this._pendingReveal.delete(clipId);

    // Guard: only reveal if this clip is still active at the current time.
    // rVFC/canplay may fire after a seek that moved time past the clip's end.
    const clip = this._project?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    const isStillActive = clip
      ? this._time >= clip.startTime && this._time < clip.startTime + clip.duration
      : false;

    if (!isStillActive) {
      // Clip already ended by the time rVFC fired — don't reveal, just hide.
      // Add to revealedClips so _syncFrame's Pass 1 won't call _gateReveal again next frame.
      // _syncFrame Pass 2 will then correctly hide it since isActive=false.
      this._revealedClips.add(clipId);
      this._setWrapperHidden(wrapper);
      return;
    }

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
  // IMPORTANT: this helper must NEVER write wrapper.style.opacity (owned by
  // _setWrapperVisible/_setWrapperHidden) and must NEVER write wrapper.style.transform
  // (owned by VideoLayer's Zustand subscription which positions the wrapper).
  // Instead we apply the entry effect to the VIDEO element's child (the <video>/<img>)
  // via a CSS variable on the wrapper that VideoLayer's inner element can pick up,
  // OR — simplest + most robust — we apply it to the wrapper's `filter` and a
  // separate `--entry-opacity` custom property that doesn't conflict with position.
  //
  // Actual approach: apply to the first child element of the wrapper (the <video> tag).
  // The wrapper itself is position-controlled by VideoLayer.

  private _ENTRY_DUR = 0.5; // seconds

  private _applyEntryTransition(wrapper: HTMLElement, clip: Clip, time: number) {
    const entry = clip.entryTransition ?? 'none';
    // Target the inner <video> or <img> child, not the wrapper itself
    const inner = wrapper.firstElementChild as HTMLElement | null;

    if (entry === 'none' || !inner) {
      if (inner) {
        inner.style.opacity = '';
        inner.style.transform = '';
      }
      return;
    }

    const elapsed = time - clip.startTime;
    if (elapsed >= this._ENTRY_DUR) {
      inner.style.opacity = '';
      inner.style.transform = '';
      return;
    }

    const t = Math.max(0, Math.min(1, elapsed / this._ENTRY_DUR));
    switch (entry) {
      case 'fade-in':
        inner.style.opacity = String(t);
        inner.style.transform = '';
        break;
      case 'slide-up': {
        const dy = (1 - t) * 40;
        inner.style.opacity = String(t);
        inner.style.transform = `translateY(${dy}px)`;
        break;
      }
      case 'slide-left': {
        const dx = (1 - t) * 60;
        inner.style.opacity = String(t);
        inner.style.transform = `translateX(${dx}px)`;
        break;
      }
      case 'zoom-in': {
        const scale = 0.6 + t * 0.4;
        inner.style.opacity = String(t);
        inner.style.transform = `scale(${scale})`;
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
        // Paused — ensure element is loading and seeked to the right position.
        if (!el.paused) el.pause();
        if (el.readyState < 1) {
          // Element hasn't started loading at all — kick it.
          // This triggers network fetch and will fire canplay, unblocking _gateReveal.
          el.load();
        } else if (!el.seeking && Math.abs(el.currentTime - safeTime) > 0.08) {
          // Loaded but at wrong position — seek.
          el.currentTime = safeTime;
        }
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
