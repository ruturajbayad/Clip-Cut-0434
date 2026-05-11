/**
 * ExportModal — frame-accurate video export
 *
 * ROOT CAUSES of browser crash (fixed here):
 * ─────────────────────────────────────────
 * 1. Per-frame seeking (vid.currentTime = X per frame):
 *    Each seek forces the video decoder to locate the nearest keyframe and
 *    decode every frame between that keyframe and the target. At 30fps on a
 *    10s clip = 300 seeks, each potentially decoding dozens of frames.
 *    This is O(n²) decode work → guaranteed OOM crash.
 *    FIX: play videos in real-time using .play(), never seek mid-recording.
 *
 * 2. requestAnimationFrame stops when the tab is hidden/unfocused:
 *    Export stalls silently at 0% if the user switches tabs.
 *    FIX: use setInterval as the render clock (fires even when hidden).
 *
 * 3. Real-time rAF approach had wall-clock drift:
 *    performance.now() - startWall accumulated timing error, especially when
 *    the browser was under load, causing audio/video desync.
 *    FIX: use a monotonic frame counter as the source of truth for time.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, CheckCircle, AlertCircle, Film, Settings } from 'lucide-react';
import { useEditorStore, interpolateClip, type Clip } from '../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';
import { TRANSITION_DURATION } from '../player/TransitionOverlay';

// ─── Constants ────────────────────────────────────────────────────────────────

const RESOLUTIONS = [
  { label: '480p',  h: 480,  desc: 'Fast preview' },
  { label: '720p',  h: 720,  desc: 'Recommended' },
  { label: '1080p', h: 1080, desc: 'Full HD' },
  { label: '4K',    h: 2160, desc: 'Ultra HD' },
] as const;

const FPS_OPTIONS = [24, 30, 60] as const;

// Auto bitrate by resolution (Mbps)
const AUTO_BITRATE: Record<string, number> = {
  '480p': 4, '720p': 8, '1080p': 16, '4K': 40,
};

type ExportStatus = 'idle' | 'preparing' | 'exporting' | 'done' | 'error';

// ─── Effect filter map ────────────────────────────────────────────────────────

const EFFECT_FILTERS: Record<string, string> = {
  blur:      'blur(4px)',
  vhs:       'saturate(1.3) contrast(1.1) sepia(0.15) hue-rotate(-5deg)',
  glitch:    'hue-rotate(90deg) saturate(2) contrast(1.5)',
  bw:        'grayscale(1)',
  cinematic: 'contrast(1.2) saturate(0.85) brightness(0.9) sepia(0.15)',
  bloom:     'brightness(1.3) contrast(0.9) saturate(1.2) blur(0.5px)',
  grain:     'contrast(1.1) saturate(0.9) brightness(1.05)',
  chromatic: 'hue-rotate(5deg) saturate(1.5) contrast(1.1)',
};

function buildFilter(clip: Clip): string {
  if (clip.effect && EFFECT_FILTERS[clip.effect]) return EFFECT_FILTERS[clip.effect]!;
  if (clip.filterCss) return clip.filterCss;
  const parts: string[] = [];
  if (clip.brightness !== undefined && clip.brightness !== 100) parts.push(`brightness(${clip.brightness}%)`);
  if (clip.contrast   !== undefined && clip.contrast   !== 100) parts.push(`contrast(${clip.contrast}%)`);
  if (clip.saturation !== undefined && clip.saturation !== 100) parts.push(`saturate(${clip.saturation}%)`);
  if (clip.blur       !== undefined && clip.blur       !== 0)   parts.push(`blur(${clip.blur}px)`);
  return parts.join(' ') || 'none';
}

// ─── Text shadow ──────────────────────────────────────────────────────────────

function resolveTextShadow(ts: string | undefined, color: string): string | undefined {
  if (!ts || ts === 'none') return undefined;
  if (ts === 'soft')  return '0 2px 8px rgba(0,0,0,0.6)';
  if (ts === 'hard')  return '2px 2px 0px rgba(0,0,0,0.9)';
  if (ts === 'glow')  return `0 0 12px ${color}, 0 0 24px ${color}`;
  if (ts === 'neon')  return `0 0 6px #fff, 0 0 12px ${color}, 0 0 30px ${color}`;
  return ts;
}

function applyTextShadow(ctx: CanvasRenderingContext2D, ts: string | undefined, color: string) {
  const r = resolveTextShadow(ts, color);
  if (!r) return;
  const m = r.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(.+)/);
  if (m) {
    ctx.shadowOffsetX = parseFloat(m[1]!);
    ctx.shadowOffsetY = parseFloat(m[2]!);
    ctx.shadowBlur    = parseFloat(m[3]!);
    ctx.shadowColor   = m[4]!.split(',')[0]!.trim();
  }
}

// ─── Entry transition ─────────────────────────────────────────────────────────

function getEntryState(clip: Clip, t: number) {
  const DUR   = 0.5;
  const entry = clip.entryTransition ?? 'none';
  if (entry === 'none') return { alpha: 1, offsetX: 0, offsetY: 0, scale: 1 };
  const p = Math.max(0, Math.min(1, (t - clip.startTime) / DUR));
  if (p >= 1)           return { alpha: 1, offsetX: 0, offsetY: 0, scale: 1 };
  switch (entry) {
    case 'fade-in':    return { alpha: p, offsetX: 0, offsetY: 0, scale: 1 };
    case 'slide-up':   return { alpha: p, offsetX: 0, offsetY: (1 - p) * 40, scale: 1 };
    case 'slide-left': return { alpha: p, offsetX: (1 - p) * 60, offsetY: 0, scale: 1 };
    case 'zoom-in':    return { alpha: p, offsetX: 0, offsetY: 0, scale: 0.6 + p * 0.4 };
    default:           return { alpha: 1, offsetX: 0, offsetY: 0, scale: 1 };
  }
}

// ─── Canvas draw functions ────────────────────────────────────────────────────

function drawText(ctx: CanvasRenderingContext2D, clip: Clip, W: number, H: number, live: Clip, t: number) {
  const cx      = (live.x ?? 0.5) * W;
  const cy      = (live.y ?? 0.5) * H;
  const sw      = (live.scaleX ?? 0.6) * W;
  const sh      = (live.scaleY ?? 0.15) * H;
  const scale   = W / 1920;
  const fSize   = Math.max(10, (live.fontSize || 72) * scale);
  const color   = live.color || '#FFFFFF';
  const align   = (live.textAlign || 'center') as CanvasTextAlign;
  const rawText = live.text || '';
  const text    = live.textUppercase ? rawText.toUpperCase() : rawText;
  const lspc    = (live.letterSpacing ?? 0) * scale;
  const lh      = live.lineHeight || 1.2;
  const pad     = 8 * scale;
  const { alpha, offsetX, offsetY } = getEntryState(clip, t);

  ctx.save();
  ctx.translate(cx + offsetX, cy + offsetY);
  if (live.rotation) ctx.rotate((live.rotation * Math.PI) / 180);
  ctx.globalAlpha = (live.opacity ?? 1) * alpha;

  if (live.textBackground && live.textBackground !== 'transparent') {
    ctx.fillStyle = live.textBackground;
    ctx.beginPath();
    (ctx as CanvasRenderingContext2D & { roundRect(...a: unknown[]): void }).roundRect(-sw/2, -sh/2, sw, sh, 4);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.rect(-sw/2, -sh/2, sw, sh);
  ctx.clip();

  ctx.font         = `${live.fontStyle||'normal'} ${live.fontWeight||'bold'} ${fSize}px ${live.fontFamily||'Inter,Arial,sans-serif'}`;
  ctx.fillStyle    = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign    = align;
  applyTextShadow(ctx, live.textShadow, color);

  if (live.textOutline && live.textOutlineWidth) {
    ctx.strokeStyle = live.textOutline;
    ctx.lineWidth   = live.textOutlineWidth * scale;
    ctx.lineJoin    = 'round';
  }

  const textX  = align === 'left' ? -sw/2 + pad : align === 'right' ? sw/2 - pad : 0;
  const lines  = text.split('\n');
  const totalH = lines.length * fSize * lh;
  let   lineY  = -totalH / 2 + (fSize * lh) / 2;

  for (const line of lines) {
    if (lspc > 0) {
      const chars  = line.split('');
      const totalW = chars.reduce((s, ch) => s + ctx.measureText(ch).width + lspc, 0);
      let   cx2    = align === 'center' ? -totalW/2 : align === 'right' ? -totalW : -sw/2 + pad;
      for (const ch of chars) {
        if (live.textOutlineWidth && live.textOutline) ctx.strokeText(ch, cx2, lineY);
        ctx.fillText(ch, cx2, lineY);
        cx2 += ctx.measureText(ch).width + lspc;
      }
    } else {
      if (live.textOutlineWidth && live.textOutline) ctx.strokeText(line, textX, lineY);
      ctx.fillText(line, textX, lineY);
    }
    lineY += fSize * lh;
  }
  ctx.restore();
}

function drawImage(ctx: CanvasRenderingContext2D, clip: Clip, img: HTMLImageElement, W: number, H: number, live: Clip, t: number) {
  const cx = (live.x ?? 0.5) * W;
  const cy = (live.y ?? 0.5) * H;
  const sw = (live.scaleX ?? 1.0) * W;
  const sh = (live.scaleY ?? 1.0) * H;
  const { alpha, offsetX, offsetY, scale: es } = getEntryState(clip, t);

  ctx.save();
  ctx.globalAlpha = (live.opacity ?? 1) * alpha;
  const filt = buildFilter(live);
  if (filt !== 'none') (ctx as CanvasRenderingContext2D & { filter: string }).filter = filt;
  if (live.blendMode && live.blendMode !== 'normal')
    ctx.globalCompositeOperation = live.blendMode as GlobalCompositeOperation;

  ctx.translate(cx + offsetX, cy + offsetY);
  if (live.rotation) ctx.rotate((live.rotation * Math.PI) / 180);

  const iAR = img.naturalWidth / img.naturalHeight;
  const bAR = sw / sh;
  const dW  = iAR > bAR ? sw * es : (sh * iAR) * es;
  const dH  = iAR > bAR ? (sw / iAR) * es : sh * es;
  ctx.drawImage(img, -dW/2, -dH/2, dW, dH);
  ctx.restore();
}

function drawVideo(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  vid: HTMLVideoElement,
  W: number, H: number,
  isMain: boolean,
  live: Clip,
  t: number,
) {
  if (vid.readyState < 2) return;
  const { alpha: ea, offsetX, offsetY, scale: es } = getEntryState(clip, t);
  ctx.save();
  ctx.globalAlpha = (live.opacity ?? 1) * ea;
  const filt = buildFilter(live);
  if (filt !== 'none') (ctx as CanvasRenderingContext2D & { filter: string }).filter = filt;
  if (live.blendMode && live.blendMode !== 'normal')
    ctx.globalCompositeOperation = live.blendMode as GlobalCompositeOperation;

  if (isMain) {
    const vAR = vid.videoWidth / (vid.videoHeight || 1);
    const bAR = W / H;
    const dW  = vAR > bAR ? H * vAR : W;
    const dH  = vAR > bAR ? H : W / vAR;
    ctx.drawImage(vid, (W - dW) / 2, (H - dH) / 2, dW, dH);
  } else {
    const cx  = (live.x  ?? 0.5) * W;
    const cy  = (live.y  ?? 0.5) * H;
    const sw  = (live.scaleX ?? 1.0) * W;
    const sh  = (live.scaleY ?? 1.0) * H;
    ctx.translate(cx + offsetX, cy + offsetY);
    if (live.rotation) ctx.rotate((live.rotation * Math.PI) / 180);
    const vAR = vid.videoWidth / (vid.videoHeight || 1);
    const bAR = sw / sh;
    const dW  = vAR > bAR ? sw * es : (sh * vAR) * es;
    const dH  = vAR > bAR ? (sw / vAR) * es : sh * es;
    ctx.drawImage(vid, -dW/2, -dH/2, dW, dH);
  }
  ctx.restore();
}

function drawTransition(ctx: CanvasRenderingContext2D, type: string, progress: number, W: number, H: number) {
  const p    = Math.max(0, Math.min(1, progress));
  const fade = p < 0.5 ? p * 2 : (1 - p) * 2;
  ctx.save();
  switch (type) {
    case 'dissolve': {
      const g = ctx.createRadialGradient(W*.2, H*.2, 0, W*.2, H*.2, W*.4);
      g.addColorStop(0, `rgba(0,0,0,${fade*.9})`); g.addColorStop(1,'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); break;
    }
    case 'lightleak': {
      const g = ctx.createRadialGradient(W*.65, H*.25, 0, W*.65, H*.25, W*.65);
      g.addColorStop(0, `rgba(255,210,80,${fade*.85})`); g.addColorStop(1,'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); break;
    }
    case 'glitch': {
      ctx.globalAlpha = fade * 0.3;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i%2===0 ? 'rgba(255,0,0,0.3)' : 'rgba(0,255,255,0.2)';
        ctx.fillRect(0, (i/8)*H + Math.sin(p*40+i)*10, W, H*0.015);
      }
      break;
    }
    case 'cinematic': {
      const barH = fade * 0.14 * H;
      ctx.globalAlpha = 0.95; ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, barH); ctx.fillRect(0, H-barH, W, barH);
      ctx.globalAlpha = fade * 0.3; ctx.fillRect(0, 0, W, H);
      break;
    }
    default: {
      ctx.globalAlpha = fade; ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.restore();
}

// ─── WAV encoder ──────────────────────────────────────────────────────────────

function audioBufferToWav(buf: AudioBuffer): Blob {
  const numCh   = Math.min(2, buf.numberOfChannels);
  const sr      = buf.sampleRate;
  const nSamp   = buf.length;
  const dataSz  = nSamp * numCh * 2;
  const ab      = new ArrayBuffer(44 + dataSz);
  const dv      = new DataView(ab);
  const w       = (o: number, v: number) => dv.setUint8(o, v);

  [0x52,0x49,0x46,0x46].forEach((b,i)=>w(i,b));
  dv.setUint32(4, 36+dataSz, true);
  [0x57,0x41,0x56,0x45].forEach((b,i)=>w(8+i,b));
  [0x66,0x6D,0x74,0x20].forEach((b,i)=>w(12+i,b));
  dv.setUint32(16,16,true); dv.setUint16(20,1,true);
  dv.setUint16(22,numCh,true); dv.setUint32(24,sr,true);
  dv.setUint32(28,sr*numCh*2,true); dv.setUint16(32,numCh*2,true);
  dv.setUint16(34,16,true);
  [0x64,0x61,0x74,0x61].forEach((b,i)=>w(36+i,b));
  dv.setUint32(40,dataSz,true);

  let off = 44;
  for (let i = 0; i < nSamp; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buf.getChannelData(ch)[i] ?? 0));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ─── Export component ─────────────────────────────────────────────────────────

export default function ExportModal() {
  const {
    showExportModal, setShowExportModal,
    project, mediaLibrary,
    setCurrentTime, setIsPlaying,
    canvasAspectRatio,
  } = useEditorStore(useShallow((s) => ({
    showExportModal:    s.showExportModal,
    setShowExportModal: s.setShowExportModal,
    project:            s.project,
    mediaLibrary:       s.mediaLibrary,
    setCurrentTime:     s.setCurrentTime,
    setIsPlaying:       s.setIsPlaying,
    canvasAspectRatio:  s.canvasAspectRatio,
  })));

  const [resolution, setResolution] = useState<typeof RESOLUTIONS[number]>(RESOLUTIONS[1]!);
  const [fps,        setFps]        = useState<typeof FPS_OPTIONS[number]>(30);
  const [status,     setStatus]     = useState<ExportStatus>('idle');
  const [progress,   setProgress]   = useState(0);
  const [stage,      setStage]      = useState('');
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileName,    setFileName]   = useState('export.mp4');
  const [fileSize,    setFileSize]   = useState<string | null>(null);
  const [outputMime,  setOutputMime] = useState<string>('video/mp4');

  const cancelRef   = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const exportH = resolution.h;
  const exportW = Math.round(exportH * (canvasAspectRatio.w / canvasAspectRatio.h));
  const bitrate = AUTO_BITRATE[resolution.label] ?? 8;

  useEffect(() => {
    if (!showExportModal) {
      setStatus('idle'); setProgress(0);
      setErrorMsg(null); setStage('');
      cancelRef.current = false;
    }
  }, [showExportModal]);

  useEffect(() => {
    return () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); };
  }, [downloadUrl]);

  // ─── Export engine ──────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    setStatus('preparing'); setProgress(0);
    setStage('Initialising…'); setErrorMsg(null);
    cancelRef.current = false;

    const W = exportW;
    const H = exportH;

    const videoEls: HTMLVideoElement[] = [];
    const audioEls: HTMLAudioElement[] = [];
    let   audioCtx: AudioContext | null = null;
    let   wavUrl:   string | null = null;

    const cleanup = () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      videoEls.forEach((v) => { try { v.pause(); v.src = ''; v.remove(); } catch {} });
      audioEls.forEach((a) => { try { a.pause(); a.src = ''; a.remove(); } catch {} });
      audioCtx?.close().catch(() => {});
      if (wavUrl) URL.revokeObjectURL(wavUrl);
    };

    try {
      // ── Canvas ─────────────────────────────────────────────────────────────
      const canvas  = document.createElement('canvas');
      canvas.width  = W;
      canvas.height = H;
      const ctx     = canvas.getContext('2d', { alpha: false, willReadFrequently: false })!;

      // ── Collect clips ───────────────────────────────────────────────────────
      const allClips   = project.tracks.flatMap((t) => t.clips);
      const mainTrack  = project.tracks.find((t) => t.type === 'video');
      const videoClips = allClips.filter((c) => c.type === 'video');
      const imageClips = allClips.filter((c) => c.type === 'image');
      const textClips  = allClips.filter((c) => c.type === 'text');
      const audioClips = allClips.filter((c) => c.type === 'audio');

      const resolveSrc = (clip: Clip) =>
        clip.src || (clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId)?.src : undefined);

      // ── Load video elements ─────────────────────────────────────────────────
      //
      // KEY FIX: We create ONE <video> per clip and keep it alive the entire
      // export. During recording we just call .play() / .pause() — NEVER seek.
      // This avoids the O(n²) decoder thrashing that crashed the browser.
      //
      setStage('Loading video clips…');
      const videoElMap = new Map<string, HTMLVideoElement>();

      await Promise.all(videoClips.map(async (clip) => {
        const src = resolveSrc(clip);
        if (!src) return;

        const vid         = document.createElement('video');
        vid.src           = src;
        vid.crossOrigin   = 'anonymous';
        vid.preload       = 'auto';
        vid.muted         = true;      // audio comes from OfflineAudioContext
        vid.playbackRate  = clip.speed ?? 1;
        vid.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(vid);
        videoEls.push(vid);

        await new Promise<void>((resolve) => {
          const tid  = setTimeout(resolve, 8000);
          const done = () => { clearTimeout(tid); resolve(); };
          vid.addEventListener('loadeddata', done, { once: true });
          vid.addEventListener('error',      done, { once: true });
          vid.load();
        });

        videoElMap.set(clip.id, vid);
      }));

      if (cancelRef.current) { cleanup(); setStatus('idle'); return; }

      // ── Pre-seek each video to its trim start (one-time, before recording) ─
      //
      // This is the only seek we do. After this we just play/pause.
      //
      setStage('Pre-seeking clips…');
      await Promise.all(videoClips.map(async (clip) => {
        const vid = videoElMap.get(clip.id);
        if (!vid) return;
        const target = clip.trimStart ?? 0;
        await new Promise<void>((resolve) => {
          const tid  = setTimeout(resolve, 3000);
          const done = () => { clearTimeout(tid); resolve(); };
          if (Math.abs(vid.currentTime - target) < 0.05) { resolve(); return; }
          vid.addEventListener('seeked', done, { once: true });
          vid.addEventListener('error',  done, { once: true });
          vid.currentTime = target;
        });
      }));

      if (cancelRef.current) { cleanup(); setStatus('idle'); return; }

      // ── Preload images ──────────────────────────────────────────────────────
      setStage('Loading images…');
      const imageMap = new Map<string, HTMLImageElement | null>();
      await Promise.all(imageClips.map(async (clip) => {
        const src = resolveSrc(clip);
        if (!src) return;
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload  = () => { imageMap.set(clip.id, img); resolve(); };
          img.onerror = () => { imageMap.set(clip.id, null); resolve(); };
          img.src = src;
        });
      }));

      if (cancelRef.current) { cleanup(); setStatus('idle'); return; }

      // ── Offline audio render ────────────────────────────────────────────────
      //
      // Pre-render entire audio mix to a WAV blob, then play it as a single
      // <audio> element during recording. No per-frame audio work.
      //
      setStage('Rendering audio mix…');
      const SAMPLE_RATE  = 48000;
      const totalSamples = Math.max(1, Math.ceil(project.duration * SAMPLE_RATE));
      const offCtx       = new OfflineAudioContext(2, totalSamples, SAMPLE_RATE);

      await Promise.all([...audioClips, ...videoClips].map(async (clip) => {
        const src = resolveSrc(clip);
        if (!src) return;
        try {
          const ab      = await fetch(src).then((r) => r.arrayBuffer());
          const decoded = await offCtx.decodeAudioData(ab);
          const gain    = offCtx.createGain();
          gain.gain.value = Math.max(0, Math.min(2, clip.volume ?? 1));
          gain.connect(offCtx.destination);
          const node    = offCtx.createBufferSource();
          node.buffer   = decoded;
          const trim    = clip.trimStart ?? 0;
          const len     = Math.min(clip.duration, decoded.duration - trim);
          if (len <= 0) return;
          node.connect(gain);
          node.start(clip.startTime, trim, len);
        } catch { /* skip bad audio */ }
      }));

      const mixedBuf = await offCtx.startRendering();
      const wavBlob  = audioBufferToWav(mixedBuf);
      wavUrl         = URL.createObjectURL(wavBlob);

      const mixAudio   = document.createElement('audio');
      mixAudio.src     = wavUrl;
      mixAudio.preload = 'auto';
      document.body.appendChild(mixAudio);
      audioEls.push(mixAudio);

      await new Promise<void>((resolve) => {
        const tid  = setTimeout(resolve, 5000);
        const done = () => { clearTimeout(tid); resolve(); };
        mixAudio.addEventListener('canplaythrough', done, { once: true });
        mixAudio.addEventListener('error', done, { once: true });
        mixAudio.load();
      });

      if (cancelRef.current) { cleanup(); setStatus('idle'); return; }

      // ── Wire audio into MediaStream ─────────────────────────────────────────
      audioCtx           = new AudioContext({ sampleRate: SAMPLE_RATE });
      const audioDest    = audioCtx.createMediaStreamDestination();
      const audioSrcNode = audioCtx.createMediaElementSource(mixAudio);
      audioSrcNode.connect(audioDest);

      // ── MediaRecorder ───────────────────────────────────────────────────────
      //
      // Prefer MP4/H.264. Firefox doesn't support it → fall back to WebM/VP9.
      //
      const mime = (() => {
        const candidates = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
        return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? 'video/webm';
      })();
      const ext         = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
      const videoStream = canvas.captureStream(fps);
      audioDest.stream.getAudioTracks().forEach((t) => videoStream.addTrack(t));

      const recorder = new MediaRecorder(videoStream, {
        mimeType:           mime,
        videoBitsPerSecond: bitrate * 1_000_000,
        audioBitsPerSecond: 192_000,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const recordingDone = new Promise<Blob>((resolve, reject) => {
        recorder.onstop  = () => resolve(new Blob(chunks, { type: mime }));
        recorder.onerror = (e) => reject(e);
      });

      // ── Start recording ─────────────────────────────────────────────────────
      setStatus('exporting');
      setIsPlaying(false);
      setStage('Recording…');

      recorder.start(200);

      // Start audio
      mixAudio.currentTime = 0;
      mixAudio.play().catch(() => {});

      const totalDuration = project.duration;
      const frameDuration = 1 / fps;
      const totalFrames   = Math.ceil(totalDuration * fps);

      // Track which video clips are currently playing
      const videoPlaying = new Map<string, boolean>();

      // Monotonic frame counter is the ONLY source of time truth.
      // This prevents drift and works even when tab is hidden.
      let frameIndex = 0;
      let tickBusy   = false; // re-entrancy guard

      await new Promise<void>((resolve) => {
        // ── KEY FIX: use setInterval not rAF ───────────────────────────────
        //
        // requestAnimationFrame STOPS FIRING when the tab loses focus.
        // setInterval keeps firing regardless → export completes even if
        // user switches tabs.
        //
        // We also draw synchronously (no awaits inside the tick) so the
        // interval never accumulates debt.
        //
        intervalRef.current = setInterval(() => {
          // If the previous tick's canvas draw is still running (slow GPU),
          // skip this tick rather than piling up work on the main thread.
          if (tickBusy) return;
          tickBusy = true;

          if (cancelRef.current || frameIndex >= totalFrames) {
            tickBusy = false;
            resolve();
            return;
          }

          const t = frameIndex * frameDuration;

          // ── Manage video playback (play/pause — never seek) ───────────────
          for (const clip of videoClips) {
            const vid    = videoElMap.get(clip.id);
            if (!vid) continue;
            const active  = t >= clip.startTime && t < clip.startTime + clip.duration;
            const playing = videoPlaying.get(clip.id) ?? false;

            if (active && !playing) {
              // First frame of this clip — the video is already pre-seeked to
              // trimStart, so just start playing. We may need to nudge position
              // slightly if another clip played this video earlier.
              const expectedSrc = (clip.trimStart ?? 0) + (t - clip.startTime) * (clip.speed ?? 1);
              const drift       = Math.abs(vid.currentTime - expectedSrc);
              // Only re-seek if off by more than 0.5s (e.g. overlapping clips or reuse)
              if (drift > 0.5) vid.currentTime = expectedSrc;
              vid.playbackRate = clip.speed ?? 1;
              vid.play().catch(() => {});
              videoPlaying.set(clip.id, true);
            } else if (!active && playing) {
              vid.pause();
              videoPlaying.set(clip.id, false);
            }
          }

          // ── Build live keyframe state ──────────────────────────────────────
          const liveMap = new Map<string, Clip>();
          for (const clip of allClips) {
            const interp = interpolateClip(clip, t);
            liveMap.set(clip.id, Object.keys(interp).length > 0 ? { ...clip, ...interp } as Clip : clip);
          }

          // ── Draw frame ────────────────────────────────────────────────────
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, W, H);

          // Main track video (cover)
          for (const clip of videoClips) {
            if (clip.trackId !== mainTrack?.id) continue;
            if (t < clip.startTime || t >= clip.startTime + clip.duration) continue;
            const vid = videoElMap.get(clip.id);
            if (vid) drawVideo(ctx, clip, vid, W, H, true, liveMap.get(clip.id)!, t);
          }

          // Overlay videos
          for (const clip of videoClips) {
            if (clip.trackId === mainTrack?.id) continue;
            if (t < clip.startTime || t >= clip.startTime + clip.duration) continue;
            const vid = videoElMap.get(clip.id);
            if (vid) drawVideo(ctx, clip, vid, W, H, false, liveMap.get(clip.id)!, t);
          }

          // Images
          for (const clip of imageClips) {
            if (t < clip.startTime || t >= clip.startTime + clip.duration) continue;
            const img = imageMap.get(clip.id);
            if (img) drawImage(ctx, clip, img, W, H, liveMap.get(clip.id)!, t);
          }

          // Text (top layer)
          for (const clip of textClips) {
            if (t < clip.startTime || t >= clip.startTime + clip.duration) continue;
            drawText(ctx, clip, W, H, liveMap.get(clip.id)!, t);
          }

          // Transitions
          if (mainTrack) {
            const sorted = [...mainTrack.clips]
              .filter((c) => c.type === 'video')
              .sort((a, b) => a.startTime - b.startTime);
            for (let i = 0; i < sorted.length - 1; i++) {
              const curr  = sorted[i]!;
              const tEnd  = curr.startTime + curr.duration;
              const tStart = tEnd - TRANSITION_DURATION;
              if (t >= tStart && t <= tEnd + TRANSITION_DURATION && curr.transition) {
                drawTransition(ctx, curr.transition, (t - tStart) / (TRANSITION_DURATION * 2), W, H);
                break;
              }
            }
          }

          frameIndex++;
          tickBusy = false;
          // Throttle React re-renders — only update UI every 10 frames.
          // Calling setState 30x/sec triggers 30 re-renders/sec on the main
          // thread, which competes with canvas draw and freezes the browser.
          // setCurrentTime also drives the player re-render — skip it entirely
          // during export; we restore it to 0 when done.
          if (frameIndex % 10 === 0 || frameIndex === totalFrames) {
            setProgress(Math.min(99, (frameIndex / totalFrames) * 100));
            setStage(`Frame ${frameIndex} / ${totalFrames}`);
          }
        }, frameDuration * 1000);
      });

      // ── Finish ──────────────────────────────────────────────────────────────
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }

      // Black tail frame
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);

      recorder.stop();
      cleanup();

      if (cancelRef.current) { setStatus('idle'); return; }

      const blob   = await recordingDone;
      const url    = URL.createObjectURL(blob);
      const name   = `${project.name.replace(/\s+/g, '_')}.${ext}`;
      const sizeMB = (blob.size / 1024 / 1024).toFixed(1);

      setDownloadUrl(url);
      setFileName(name);
      setFileSize(`${sizeMB} MB`);
      setOutputMime(mime);
      setProgress(100);
      setStage('');
      setStatus('done');
      setCurrentTime(0);

    } catch (err: unknown) {
      console.error('[Export]', err);
      cleanup();
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [project, mediaLibrary, exportW, exportH, fps, bitrate, setCurrentTime, setIsPlaying]);

  const handleCancel = useCallback(() => {
    cancelRef.current = true;
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const handleDownload = useCallback(() => {
    if (!downloadUrl) return;
    const a = document.createElement('a');
    a.href = downloadUrl; a.download = fileName; a.click();
  }, [downloadUrl, fileName]);

  // ─── UI ───────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {showExportModal && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
            onClick={() => status === 'idle' && setShowExportModal(false)}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
            style={{ width: 460 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/60">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm">
                  <Film size={15} className="text-white" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900 leading-tight">Export Video</div>
                  <div className="text-[11px] text-gray-400">{project.name}</div>
                </div>
              </div>
              {(status === 'idle' || status === 'error') && (
                <button onClick={() => setShowExportModal(false)}
                  className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 transition-colors">
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Done */}
            {status === 'done' && (
              <div className="p-8 flex flex-col items-center gap-5 text-center">
                <motion.div
                  initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 15, stiffness: 300, delay: 0.1 }}
                  className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center"
                >
                  <CheckCircle size={36} className="text-emerald-500" />
                </motion.div>
                <div>
                  <div className="font-semibold text-gray-900 text-lg">Export Complete!</div>
                  <div className="text-sm text-gray-500 mt-1">
                    {exportW}×{exportH} · {fps}fps · {resolution.label} · {outputMime.startsWith('video/mp4') ? 'MP4' : 'WebM'}
                  </div>
                  {fileSize && <div className="text-xs text-gray-400 mt-0.5">File size: {fileSize}</div>}
                </div>
                <div className="flex items-center gap-2 w-full">
                  <button onClick={() => { setStatus('idle'); setDownloadUrl(null); }}
                    className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium">
                    Export Again
                  </button>
                  <button onClick={handleDownload}
                    className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 shadow-sm">
                    <Download size={14} /> Download
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {status === 'error' && (
              <div className="p-6 flex flex-col items-center gap-4 text-center">
                <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center">
                  <AlertCircle size={32} className="text-red-500" />
                </div>
                <div>
                  <div className="font-semibold text-gray-900">Export Failed</div>
                  <div className="text-xs text-red-500 mt-2 max-w-xs break-words">{errorMsg}</div>
                </div>
                <button onClick={() => setStatus('idle')}
                  className="px-5 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors">
                  Try Again
                </button>
              </div>
            )}

            {/* Exporting / Preparing */}
            {(status === 'exporting' || status === 'preparing') && (
              <div className="p-7 flex flex-col items-center gap-5">
                <div className="relative w-20 h-20">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="#F3F4F6" strokeWidth="6" />
                    <motion.circle
                      cx="40" cy="40" r="34" fill="none" stroke="#2563EB" strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 34}`}
                      strokeDashoffset={`${2 * Math.PI * 34 * (1 - progress / 100)}`}
                      transition={{ duration: 0.2 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-bold text-gray-800">{Math.round(progress)}%</span>
                  </div>
                </div>

                <div className="text-center">
                  <div className="font-semibold text-gray-900 text-base">
                    {status === 'preparing' ? 'Preparing…' : 'Exporting…'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{exportW}×{exportH} · {fps}fps · {bitrate}Mbps</div>
                  {stage && <div className="text-[11px] text-blue-500 mt-2 font-medium">{stage}</div>}
                </div>

                <div className="w-full">
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div className="h-full bg-blue-600 rounded-full"
                      style={{ width: `${progress}%` }} transition={{ duration: 0.15 }} />
                  </div>
                </div>

                <div className="text-[11px] text-gray-400 text-center leading-relaxed">
                  Real-time render — videos play at normal speed.<br />
                  Export takes approx. {project.duration.toFixed(0)}s.
                </div>

                <button onClick={handleCancel}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors font-medium">
                  Cancel Export
                </button>
              </div>
            )}

            {/* Settings (idle) */}
            {status === 'idle' && (
              <div className="p-5 space-y-4">
                {/* Resolution */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Resolution</label>
                    <span className="text-[10px] text-gray-400">{canvasAspectRatio.w}:{canvasAspectRatio.h}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {RESOLUTIONS.map((r) => {
                      const w      = Math.round(r.h * canvasAspectRatio.w / canvasAspectRatio.h);
                      const active = resolution.label === r.label;
                      return (
                        <button key={r.label} onClick={() => setResolution(r)}
                          className={`py-2.5 px-1 text-xs font-medium rounded-xl border-2 transition-all text-center ${
                            active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                          }`}>
                          <div className="font-bold text-[13px]">{r.label}</div>
                          <div className="text-[9px] mt-0.5 opacity-70">{w}×{r.h}</div>
                          <div className={`text-[9px] mt-0.5 ${active ? 'text-blue-400' : 'text-gray-400'}`}>{r.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* FPS */}
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Frame Rate</label>
                  <div className="flex gap-1.5">
                    {FPS_OPTIONS.map((f) => (
                      <button key={f} onClick={() => setFps(f)}
                        className={`flex-1 py-2 text-xs font-semibold rounded-xl border-2 transition-all ${
                          fps === f ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}>
                        {f} fps
                      </button>
                    ))}
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-gray-50 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Settings size={11} className="text-gray-400" />
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Export summary</span>
                  </div>
                  {([
                    ['Format',     'MP4 (H.264) / WebM fallback'],
                    ['Resolution', `${exportW}×${exportH}`],
                    ['Frame rate', `${fps} fps`],
                    ['Bitrate',    `${bitrate} Mbps (auto)`],
                    ['Duration',   `${project.duration.toFixed(1)}s`],
                    ['Est. size',  `~${Math.round((bitrate * project.duration) / 8)} MB`],
                  ] as [string,string][]).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-[11px]">
                      <span className="text-gray-500">{k}</span>
                      <span className="font-semibold text-gray-800">{v}</span>
                    </div>
                  ))}
                </div>

                <button onClick={handleExport}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm">
                  <Download size={15} /> Export Video
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
