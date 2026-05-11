import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, CheckCircle, Loader2 } from 'lucide-react';
import { useEditorStore, interpolateClip, type Clip } from '../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';
import { TRANSITION_DURATION } from '../player/TransitionOverlay';

// ─── Resolution options ───────────────────────────────────────────────────────
const RESOLUTIONS = [
  { label: '720p',  h: 720  },
  { label: '1080p', h: 1080 },
  { label: '4K',    h: 2160 },
] as const;

const FORMATS     = ['MP4', 'WebM'] as const;
const FPS_OPTIONS = [24, 30, 60]   as const;

type ExportStatus = 'idle' | 'exporting' | 'done';

// ─── helpers ──────────────────────────────────────────────────────────────────

function getMimeType(format: string): string {
  if (format === 'MP4') {
    if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) return 'video/mp4;codecs=avc1';
    if (MediaRecorder.isTypeSupported('video/mp4'))             return 'video/mp4';
  }
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) return 'video/webm;codecs=vp8';
  return 'video/webm';
}

function getExt(mime: string): string {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

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

/** Preload image, returns element or null */
function preloadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Resolve text-shadow preset → CSS values */
function resolveTextShadow(ts: string | undefined, color: string): string | undefined {
  if (!ts || ts === 'none') return undefined;
  if (ts === 'soft')  return '0 2px 8px rgba(0,0,0,0.6)';
  if (ts === 'hard')  return '2px 2px 0px rgba(0,0,0,0.9)';
  if (ts === 'glow')  return `0 0 12px ${color}, 0 0 24px ${color}`;
  if (ts === 'neon')  return `0 0 6px #fff, 0 0 12px ${color}, 0 0 30px ${color}`;
  return ts;
}

/** Parse "Xpx Ypx Bpx color" CSS text-shadow into canvas shadow properties */
function applyTextShadowToCtx(ctx: CanvasRenderingContext2D, ts: string | undefined, color: string) {
  const resolved = resolveTextShadow(ts, color);
  if (!resolved) return;
  // Match first shadow (canvas only supports one)
  const m = resolved.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(.+)/);
  if (m) {
    ctx.shadowOffsetX = parseFloat(m[1]!);
    ctx.shadowOffsetY = parseFloat(m[2]!);
    ctx.shadowBlur    = parseFloat(m[3]!);
    ctx.shadowColor   = m[4]!.split(',')[0]!.trim(); // first shadow only
  }
}

/**
 * Entry-transition state for a clip at exportTime.
 */
function getEntryState(clip: Clip, t: number): { alpha: number; offsetX: number; offsetY: number; scale: number } {
  const DUR   = 0.5;
  const entry = clip.entryTransition ?? 'none';
  if (entry === 'none') return { alpha: 1, offsetX: 0, offsetY: 0, scale: 1 };
  const elapsed = t - clip.startTime;
  if (elapsed >= DUR)   return { alpha: 1, offsetX: 0, offsetY: 0, scale: 1 };
  const p = Math.max(0, Math.min(1, elapsed / DUR));
  switch (entry) {
    case 'fade-in':    return { alpha: p, offsetX: 0, offsetY: 0, scale: 1 };
    case 'slide-up':   return { alpha: p, offsetX: 0, offsetY: (1 - p) * 40, scale: 1 };
    case 'slide-left': return { alpha: p, offsetX: (1 - p) * 60, offsetY: 0, scale: 1 };
    case 'zoom-in':    return { alpha: p, offsetX: 0, offsetY: 0, scale: 0.6 + p * 0.4 };
    default:           return { alpha: 1, offsetX: 0, offsetY: 0, scale: 1 };
  }
}

// ─── canvas draw helpers ──────────────────────────────────────────────────────

function drawTextClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  exportW: number,
  exportH: number,
  liveClip: Clip,
  exportTime: number,
) {
  const cx  = (liveClip.x ?? 0.5) * exportW;
  const cy  = (liveClip.y ?? 0.5) * exportH;
  const sw  = (liveClip.scaleX ?? 0.6) * exportW;
  const sh  = (liveClip.scaleY ?? 0.15) * exportH;

  const scale      = exportW / 1920;
  const fontSize   = Math.max(10, (liveClip.fontSize || 72) * scale);
  const fontWeight = liveClip.fontWeight || 'bold';
  const fontStyle  = liveClip.fontStyle  || 'normal';
  const fontFamily = liveClip.fontFamily || 'Inter, Arial, sans-serif';
  const color      = liveClip.color      || '#FFFFFF';
  const textAlign  = (liveClip.textAlign || 'center') as CanvasTextAlign;
  const rawText    = liveClip.text       || '';
  const text       = liveClip.textUppercase ? rawText.toUpperCase() : rawText;
  const lspc       = (liveClip.letterSpacing ?? 0) * scale;
  const lh         = liveClip.lineHeight || 1.2;
  const padding    = 8 * scale;

  const { alpha, offsetX, offsetY } = getEntryState(clip, exportTime);
  const opacity = (liveClip.opacity ?? 1) * alpha;

  ctx.save();

  // Translate to center, rotate, translate back — BEFORE clipping
  ctx.translate(cx + offsetX, cy + offsetY);
  if (liveClip.rotation) ctx.rotate((liveClip.rotation * Math.PI) / 180);

  ctx.globalAlpha = opacity;

  // Background box (in rotated space, centered at origin)
  if (liveClip.textBackground && liveClip.textBackground !== 'transparent') {
    ctx.fillStyle = liveClip.textBackground;
    ctx.beginPath();
    (ctx as CanvasRenderingContext2D & { roundRect: (...args: unknown[]) => void })
      .roundRect(-sw / 2, -sh / 2, sw, sh, 4);
    ctx.fill();
  }

  // Clip to text box (in rotated space)
  ctx.beginPath();
  ctx.rect(-sw / 2, -sh / 2, sw, sh);
  ctx.clip();

  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle   = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign    = textAlign;

  applyTextShadowToCtx(ctx, liveClip.textShadow, color);

  if (liveClip.textOutline && liveClip.textOutlineWidth) {
    ctx.strokeStyle = liveClip.textOutline;
    ctx.lineWidth   = liveClip.textOutlineWidth * scale;
    ctx.lineJoin    = 'round';
  }

  // Text X relative to center (origin)
  let textX: number;
  if (textAlign === 'left')       textX = -sw / 2 + padding;
  else if (textAlign === 'right') textX =  sw / 2 - padding;
  else                            textX = 0;

  const lines  = text.split('\n');
  const totalH = lines.length * fontSize * lh;
  let   lineY  = -totalH / 2 + (fontSize * lh) / 2;

  for (const line of lines) {
    if (lspc > 0) {
      const chars      = line.split('');
      const totalLineW = chars.reduce((s, ch) => s + ctx.measureText(ch).width + lspc, 0);
      let   charX      = textAlign === 'center' ? -totalLineW / 2
                       : textAlign === 'right'  ? -totalLineW
                       : -sw / 2 + padding;
      for (const ch of chars) {
        if (liveClip.textOutlineWidth && liveClip.textOutline) ctx.strokeText(ch, charX, lineY);
        ctx.fillText(ch, charX, lineY);
        charX += ctx.measureText(ch).width + lspc;
      }
    } else {
      if (liveClip.textOutlineWidth && liveClip.textOutline) ctx.strokeText(line, textX, lineY);
      ctx.fillText(line, textX, lineY);
    }
    lineY += fontSize * lh;
  }

  ctx.restore();
}

function drawImageClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  img: HTMLImageElement,
  exportW: number,
  exportH: number,
  liveClip: Clip,
  exportTime: number,
) {
  const cx  = (liveClip.x ?? 0.5) * exportW;
  const cy  = (liveClip.y ?? 0.5) * exportH;
  const sw  = (liveClip.scaleX ?? 1.0) * exportW;
  const sh  = (liveClip.scaleY ?? 1.0) * exportH;
  const { alpha, offsetX, offsetY, scale: entryScale } = getEntryState(clip, exportTime);

  ctx.save();
  ctx.globalAlpha = (liveClip.opacity ?? 1) * alpha;

  const filt = buildFilter(liveClip);
  if (filt && filt !== 'none') (ctx as CanvasRenderingContext2D & { filter: string }).filter = filt;

  if (liveClip.blendMode && liveClip.blendMode !== 'normal')
    ctx.globalCompositeOperation = liveClip.blendMode as GlobalCompositeOperation;

  const acx = cx + offsetX;
  const acy = cy + offsetY;
  ctx.translate(acx, acy);
  if (liveClip.rotation) ctx.rotate((liveClip.rotation * Math.PI) / 180);

  const imgAR = img.naturalWidth / img.naturalHeight;
  const boxAR = sw / sh;
  let drawW: number, drawH: number;
  if (imgAR > boxAR) { drawW = sw * entryScale; drawH = (sw / imgAR) * entryScale; }
  else               { drawH = sh * entryScale; drawW = (sh * imgAR) * entryScale; }

  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function drawVideoClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  vid: HTMLVideoElement,
  exportW: number,
  exportH: number,
  isMainTrack: boolean,
  liveClip: Clip,
  exportTime: number,
) {
  const { alpha: entryAlpha, offsetX, offsetY, scale: entryScale } = getEntryState(clip, exportTime);
  const opacity = (liveClip.opacity ?? 1) * entryAlpha;

  ctx.save();
  ctx.globalAlpha = opacity;

  const filt = buildFilter(liveClip);
  if (filt && filt !== 'none') (ctx as CanvasRenderingContext2D & { filter: string }).filter = filt;

  if (liveClip.blendMode && liveClip.blendMode !== 'normal')
    ctx.globalCompositeOperation = liveClip.blendMode as GlobalCompositeOperation;

  if (isMainTrack) {
    const vidAR = vid.videoWidth / (vid.videoHeight || 1);
    const boxAR = exportW / exportH;
    let drawW: number, drawH: number;
    if (vidAR > boxAR) { drawH = exportH; drawW = exportH * vidAR; }
    else               { drawW = exportW; drawH = exportW / vidAR; }
    ctx.drawImage(vid, (exportW - drawW) / 2, (exportH - drawH) / 2, drawW, drawH);
  } else {
    const cx  = (liveClip.x  ?? 0.5) * exportW;
    const cy  = (liveClip.y  ?? 0.5) * exportH;
    const sw  = (liveClip.scaleX ?? 1.0) * exportW;
    const sh  = (liveClip.scaleY ?? 1.0) * exportH;
    const acx = cx + offsetX;
    const acy = cy + offsetY;

    ctx.translate(acx, acy);
    if (liveClip.rotation) ctx.rotate((liveClip.rotation * Math.PI) / 180);

    const vidAR = vid.videoWidth / (vid.videoHeight || 1);
    const boxAR = sw / sh;
    let drawW: number, drawH: number;
    if (vidAR > boxAR) { drawW = sw * entryScale; drawH = (sw / vidAR) * entryScale; }
    else               { drawH = sh * entryScale; drawW = (sh * vidAR) * entryScale; }
    ctx.drawImage(vid, -drawW / 2, -drawH / 2, drawW, drawH);
  }

  ctx.restore();
}

function drawTransition(
  ctx: CanvasRenderingContext2D,
  type: string,
  progress: number,
  exportW: number,
  exportH: number,
) {
  const p    = Math.max(0, Math.min(1, progress));
  const fade = p < 0.5 ? p * 2 : (1 - p) * 2;
  ctx.save();

  switch (type) {
    case 'dissolve': {
      const na  = fade * 0.9;
      const grd = ctx.createRadialGradient(exportW * 0.2, exportH * 0.2, 0, exportW * 0.2, exportH * 0.2, exportW * 0.4);
      grd.addColorStop(0, `rgba(0,0,0,${na})`);
      grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, exportW, exportH);
      break;
    }
    case 'lightleak': {
      const grd = ctx.createRadialGradient(exportW * 0.65, exportH * 0.25, 0, exportW * 0.65, exportH * 0.25, exportW * 0.65);
      grd.addColorStop(0, `rgba(255,210,80,${fade * 0.85})`);
      grd.addColorStop(1, 'transparent');
      ctx.globalAlpha = 1;
      ctx.fillStyle   = grd;
      ctx.fillRect(0, 0, exportW, exportH);
      break;
    }
    case 'glitch': {
      ctx.globalAlpha = fade * 0.3;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,0,0,0.3)' : 'rgba(0,255,255,0.2)';
        const y = (i / 8) * exportH + Math.sin(p * 40 + i) * 10;
        ctx.fillRect(0, y, exportW, exportH * 0.015);
      }
      break;
    }
    case 'cinematic': {
      const barH = fade * 0.14 * exportH;
      ctx.globalAlpha = 0.95;
      ctx.fillStyle   = '#000000';
      ctx.fillRect(0, 0, exportW, barH);
      ctx.fillRect(0, exportH - barH, exportW, barH);
      ctx.globalAlpha = fade * 0.3;
      ctx.fillRect(0, 0, exportW, exportH);
      break;
    }
    case 'fade':
    default: {
      ctx.globalAlpha = fade;
      ctx.fillStyle   = '#000000';
      ctx.fillRect(0, 0, exportW, exportH);
      break;
    }
  }
  ctx.restore();
}

// ─── audioBufferToWav ─────────────────────────────────────────────────────────
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh     = Math.min(2, buffer.numberOfChannels);
  const sr        = buffer.sampleRate;
  const numSamp   = buffer.length;
  const dataSize  = numSamp * numCh * 2;
  const ab        = new ArrayBuffer(44 + dataSize);
  const dv        = new DataView(ab);

  const w = (o: number, v: number) => dv.setUint8(o, v);
  // RIFF header
  [0x52,0x49,0x46,0x46].forEach((b, i) => w(i, b));
  dv.setUint32(4, 36 + dataSize, true);
  [0x57,0x41,0x56,0x45].forEach((b, i) => w(8 + i, b));
  [0x66,0x6D,0x74,0x20].forEach((b, i) => w(12 + i, b));
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, numCh, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * numCh * 2, true);
  dv.setUint16(32, numCh * 2, true);
  dv.setUint16(34, 16, true);
  [0x64,0x61,0x74,0x61].forEach((b, i) => w(36 + i, b));
  dv.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < numSamp; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i] ?? 0));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ─── component ────────────────────────────────────────────────────────────────

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

  // Default 720p — safer for most browsers; user can bump up
  const [resolution, setResolution] = useState<typeof RESOLUTIONS[number]>(RESOLUTIONS[0]!);
  const [format,     setFormat]     = useState<typeof FORMATS[number]>('WebM');
  const [fps,        setFps]        = useState<typeof FPS_OPTIONS[number]>(30);
  const [bitrate,    setBitrate]    = useState(8);
  const [status,     setStatus]     = useState<ExportStatus>('idle');
  const [progress,   setProgress]   = useState(0);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileName,    setFileName]   = useState('export.mp4');

  const cancelRef   = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const rafRef      = useRef<number>(0);

  const exportH = resolution.h;
  const exportW = Math.round(exportH * (canvasAspectRatio.w / canvasAspectRatio.h));

  useEffect(() => {
    if (!showExportModal) {
      setStatus('idle');
      setProgress(0);
      setErrorMsg(null);
      cancelRef.current = false;
    }
  }, [showExportModal]);

  useEffect(() => {
    return () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); };
  }, [downloadUrl]);

  // ─── Core export ─────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setStatus('exporting');
    setProgress(0);
    setErrorMsg(null);
    cancelRef.current = false;

    const exportVideos: HTMLVideoElement[] = [];
    const exportAudios: HTMLAudioElement[] = [];
    let   audioCtx: AudioContext | null    = null;

    const cleanup = () => {
      cancelAnimationFrame(rafRef.current);
      exportVideos.forEach((v) => { try { v.pause(); v.src = ''; document.body.contains(v) && v.remove(); } catch {} });
      exportAudios.forEach((a) => { try { a.pause(); a.src = ''; document.body.contains(a) && a.remove(); } catch {} });
      audioCtx?.close().catch(() => {});
    };

    try {
      // ── 1. Canvas ──────────────────────────────────────────────────────────
      // Hard cap at 1280×720 to prevent OOM on low-memory browsers.
      // Users choosing higher resolutions still get it if the browser supports it.
      const safeW = Math.min(exportW, 3840);
      const safeH = Math.min(exportH, 2160);
      const canvas  = document.createElement('canvas');
      canvas.width  = safeW;
      canvas.height = safeH;
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false })!;

      // ── 2. Gather clips ───────────────────────────────────────────────────
      const allClips   = project.tracks.flatMap((t) => t.clips);
      const mainTrack  = project.tracks.find((t) => t.type === 'video');
      const videoClips = allClips.filter((c) => c.type === 'video');
      const textClips  = allClips.filter((c) => c.type === 'text');
      const imageClips = allClips.filter((c) => c.type === 'image');
      const audioClips = allClips.filter((c) => c.type === 'audio');

      // ── 3. Create dedicated <video> elements ──────────────────────────────
      const videoElMap = new Map<string, HTMLVideoElement>();

      for (const clip of videoClips) {
        const mediaSrc = clip.src
          || (clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId)?.src : undefined);
        if (!mediaSrc) continue;

        const vid            = document.createElement('video');
        vid.src              = mediaSrc;
        vid.crossOrigin      = 'anonymous';
        vid.preload          = 'auto';
        vid.muted            = true;   // audio handled by OfflineAudioContext
        vid.playbackRate     = clip.speed ?? 1;
        vid.style.cssText    = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(vid);
        exportVideos.push(vid);
        videoElMap.set(clip.id, vid);
      }

      // ── 4. Offline render audio ───────────────────────────────────────────
      // Decode & mix every audio/video clip into a single AudioBuffer at exact
      // timeline timestamps — completely decoupled from frame-loop speed.
      const SAMPLE_RATE  = 44100;
      const totalSamples = Math.ceil(project.duration * SAMPLE_RATE);
      const offCtx       = new OfflineAudioContext(2, Math.max(1, totalSamples), SAMPLE_RATE);

      const fetchDecode = async (src: string): Promise<AudioBuffer | null> => {
        try {
          const buf = await fetch(src).then((r) => r.arrayBuffer());
          return await offCtx.decodeAudioData(buf);
        } catch { return null; }
      };

      await Promise.all([...audioClips, ...videoClips].map(async (clip) => {
        const mediaSrc = clip.src
          || (clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId)?.src : undefined);
        if (!mediaSrc) return;
        const decoded = await fetchDecode(mediaSrc);
        if (!decoded) return;

        const gain        = offCtx.createGain();
        gain.gain.value   = Math.max(0, Math.min(2, clip.volume ?? 1));
        gain.connect(offCtx.destination);

        const src         = offCtx.createBufferSource();
        src.buffer        = decoded;
        const trimStart   = clip.trimStart ?? 0;
        const clipLen     = Math.min(clip.duration, decoded.duration - trimStart);
        if (clipLen <= 0) return;
        src.connect(gain);
        src.start(clip.startTime, trimStart, clipLen);
      }));

      const mixedBuf = await offCtx.startRendering();
      const wavBlob  = audioBufferToWav(mixedBuf);

      // Pre-rendered audio element that will play in real-time during recording
      const mixedAudioEl    = document.createElement('audio');
      mixedAudioEl.src      = URL.createObjectURL(wavBlob);
      mixedAudioEl.preload  = 'auto';
      document.body.appendChild(mixedAudioEl);
      exportAudios.push(mixedAudioEl);

      await new Promise<void>((resolve) => {
        const tid  = setTimeout(resolve, 4000);
        const done = () => { clearTimeout(tid); resolve(); };
        mixedAudioEl.addEventListener('canplaythrough', done, { once: true });
        mixedAudioEl.addEventListener('error', done, { once: true });
        mixedAudioEl.load();
      });

      // ── 5. Load all video elements ────────────────────────────────────────
      await Promise.all(videoClips.map(async (clip) => {
        const vid = videoElMap.get(clip.id);
        if (!vid) return;
        await new Promise<void>((resolve) => {
          const tid  = setTimeout(resolve, 8000);
          const done = () => { clearTimeout(tid); resolve(); };
          vid.addEventListener('canplay', done, { once: true });
          vid.addEventListener('error',   done, { once: true });
          vid.load();
        });
      }));

      // ── 6. Preload images ─────────────────────────────────────────────────
      const imageMap = new Map<string, HTMLImageElement | null>();
      await Promise.all(imageClips.map(async (clip) => {
        const src = clip.src || (clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId)?.src : undefined);
        if (src) imageMap.set(clip.id, await preloadImage(src));
      }));

      // ── 7. Set up MediaRecorder ───────────────────────────────────────────
      audioCtx           = new AudioContext();
      const audioDest    = audioCtx.createMediaStreamDestination();
      const srcNode      = audioCtx.createMediaElementSource(mixedAudioEl);
      srcNode.connect(audioDest);
      srcNode.connect(audioCtx.destination); // also play for sync

      const mime        = getMimeType(format);
      const ext         = getExt(mime);
      const videoStream = canvas.captureStream(fps);
      audioDest.stream.getAudioTracks().forEach((t) => videoStream.addTrack(t));

      const recorder = new MediaRecorder(videoStream, {
        mimeType:          mime,
        videoBitsPerSecond: bitrate * 1_000_000,
      });
      recorderRef.current = recorder;

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const recordingDone = new Promise<Blob>((resolve, reject) => {
        recorder.onstop  = () => resolve(new Blob(chunks, { type: mime }));
        recorder.onerror = (e) => reject(e);
      });

      // ── 8. Seek all video elements to their start positions ───────────────
      // Before recording starts, seek each video to where it should start.
      // During recording we simply call .play() and let real-time advance the position.
      for (const clip of videoClips) {
        const vid = videoElMap.get(clip.id);
        if (!vid) continue;
        vid.currentTime = clip.trimStart ?? 0;
        // Wait for seek
        await new Promise<void>((r) => {
          const tid  = setTimeout(r, 2000);
          const done = () => { clearTimeout(tid); r(); };
          vid.addEventListener('seeked', done, { once: true });
          vid.addEventListener('error',  done, { once: true });
        });
      }

      // ── 9. Stop preview playback ──────────────────────────────────────────
      setIsPlaying(false);
      await new Promise((r) => setTimeout(r, 100));

      // ── 10. Real-time render loop ─────────────────────────────────────────
      // We don't seek during recording. Instead we track wall-clock time and
      // derive exportTime from it. Videos that should be playing are started
      // via .play() at the right wall-clock moment and just run in real-time.
      // This avoids any seek lag and keeps audio perfectly synced.

      recorder.start(100);

      const totalDuration = project.duration;
      const startWall     = performance.now();

      // Start audio playback in lock-step
      mixedAudioEl.currentTime = 0;
      mixedAudioEl.play().catch(() => {});

      // Map clip → whether we've called .play() on it yet
      const videoStarted = new Map<string, boolean>();

      await new Promise<void>((resolve) => {
        const tick = () => {
          if (cancelRef.current) { resolve(); return; }

          const exportTime = (performance.now() - startWall) / 1000;

          if (exportTime >= totalDuration) {
            resolve();
            return;
          }

          // ── 10a. Compute live clip state (keyframes) ──────────────────────
          const liveClipMap = new Map<string, Clip>();
          for (const clip of allClips) {
            const interp = interpolateClip(clip, exportTime);
            liveClipMap.set(clip.id, Object.keys(interp).length > 0 ? { ...clip, ...interp } as Clip : clip);
          }

          // ── 10b. Start / pause video elements at the right moments ────────
          for (const clip of videoClips) {
            const vid     = videoElMap.get(clip.id);
            if (!vid) continue;
            const active  = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
            const started = videoStarted.get(clip.id) ?? false;

            if (active && !started) {
              // Time to start this clip — seek to correct source position then play
              const elapsed   = exportTime - clip.startTime;
              const trimStart = clip.trimStart ?? 0;
              vid.currentTime = trimStart + elapsed * (clip.speed ?? 1);
              vid.playbackRate = clip.speed ?? 1;
              vid.play().catch(() => {});
              videoStarted.set(clip.id, true);
            } else if (!active && started) {
              vid.pause();
              videoStarted.set(clip.id, false);
            }
          }

          // ── 10c. Draw frame ───────────────────────────────────────────────
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, safeW, safeH);

          // Main track video (cover fill, bottom layer)
          for (const clip of videoClips) {
            if (clip.trackId !== mainTrack?.id) continue;
            const active = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
            if (!active) continue;
            const vid = videoElMap.get(clip.id);
            if (!vid || vid.readyState < 2) continue;
            drawVideoClip(ctx, clip, vid, safeW, safeH, true, liveClipMap.get(clip.id)!, exportTime);
          }

          // Overlay video clips
          for (const clip of videoClips) {
            if (clip.trackId === mainTrack?.id) continue;
            const active = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
            if (!active) continue;
            const vid = videoElMap.get(clip.id);
            if (!vid || vid.readyState < 2) continue;
            drawVideoClip(ctx, clip, vid, safeW, safeH, false, liveClipMap.get(clip.id)!, exportTime);
          }

          // Image clips
          for (const clip of imageClips) {
            const active = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
            if (!active) continue;
            const img = imageMap.get(clip.id);
            if (!img) continue;
            drawImageClip(ctx, clip, img, safeW, safeH, liveClipMap.get(clip.id)!, exportTime);
          }

          // Text clips (top layer)
          for (const clip of textClips) {
            const active = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
            if (!active) continue;
            drawTextClip(ctx, clip, safeW, safeH, liveClipMap.get(clip.id)!, exportTime);
          }

          // Clip transitions
          if (mainTrack) {
            const mainVidClips = mainTrack.clips
              .filter((c) => c.type === 'video')
              .sort((a, b) => a.startTime - b.startTime);

            for (let i = 0; i < mainVidClips.length - 1; i++) {
              const curr   = mainVidClips[i]!;
              const tEnd   = curr.startTime + curr.duration;
              const tStart = tEnd - TRANSITION_DURATION;
              if (exportTime >= tStart && exportTime <= tEnd + TRANSITION_DURATION && curr.transition) {
                const prog = (exportTime - tStart) / (TRANSITION_DURATION * 2);
                drawTransition(ctx, curr.transition, prog, safeW, safeH);
                break;
              }
            }
          }

          setProgress(Math.min(99, (exportTime / totalDuration) * 100));
          setCurrentTime(exportTime);

          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      });

      // ── 11. Finish ────────────────────────────────────────────────────────
      // Draw final frame (solid black if at end)
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, safeW, safeH);

      recorder.stop();
      cleanup();

      if (cancelRef.current) {
        setStatus('idle');
        return;
      }

      const blob = await recordingDone;
      const url  = URL.createObjectURL(blob);
      const name = `${project.name.replace(/\s+/g, '_')}.${ext}`;

      setDownloadUrl(url);
      setFileName(name);
      setProgress(100);
      setStatus('done');
      setCurrentTime(0);

    } catch (err: unknown) {
      console.error('[Export] failed:', err);
      cleanup();
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('idle');
    }
  };

  const handleCancel = () => {
    cancelRef.current = true;
    cancelAnimationFrame(rafRef.current);
    recorderRef.current?.stop();
  };

  const handleDownload = () => {
    if (!downloadUrl) return;
    const a = document.createElement('a');
    a.href     = downloadUrl;
    a.download = fileName;
    a.click();
  };

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {showExportModal && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
            onClick={() => status === 'idle' && setShowExportModal(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
            style={{ width: 440 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Download size={14} className="text-white" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">Export Video</div>
                  <div className="text-[11px] text-gray-400">{project.name}</div>
                </div>
              </div>
              {status === 'idle' && (
                <button
                  onClick={() => setShowExportModal(false)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* ── Done ──────────────────────────────────────────────────────── */}
            {status === 'done' ? (
              <div className="p-8 flex flex-col items-center gap-4 text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 15, stiffness: 300, delay: 0.1 }}
                >
                  <CheckCircle size={48} className="text-emerald-500" />
                </motion.div>
                <div>
                  <div className="font-semibold text-gray-900 text-lg">Export Complete!</div>
                  <div className="text-sm text-gray-500 mt-1">
                    {fileName} — {exportW}×{exportH} · {fps}fps
                  </div>
                </div>
                <div className="flex items-center gap-2 w-full">
                  <button
                    onClick={() => setShowExportModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleDownload}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Download size={14} />
                    Download
                  </button>
                </div>
              </div>

            /* ── Exporting ──────────────────────────────────────────────────── */
            ) : status === 'exporting' ? (
              <div className="p-8 flex flex-col items-center gap-4 text-center">
                <Loader2 size={40} className="text-blue-500 animate-spin" />
                <div>
                  <div className="font-semibold text-gray-800">Exporting in real-time…</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {exportW}×{exportH} · {fps}fps · {format} · {bitrate}Mbps
                  </div>
                </div>
                <div className="w-full">
                  <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                    <span>Progress</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-blue-600 rounded-full"
                      style={{ width: `${progress}%` }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1.5">
                    Renders at video duration — audio, keyframes & text included
                  </div>
                </div>
                <button
                  onClick={handleCancel}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>

            /* ── Settings ───────────────────────────────────────────────────── */
            ) : (
              <div className="p-5 space-y-4">
                {errorMsg && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
                    {errorMsg}
                  </div>
                )}

                {/* Format */}
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                    Format
                  </label>
                  <div className="flex gap-2">
                    {FORMATS.map((f) => (
                      <button
                        key={f}
                        onClick={() => setFormat(f)}
                        className={`flex-1 py-2 text-xs font-medium rounded-lg border-2 transition-all ${
                          format === f
                            ? 'border-blue-500 text-blue-600 bg-blue-50'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                    <button
                      disabled
                      className="flex-1 py-2 text-xs font-medium rounded-lg border-2 border-gray-100 text-gray-300 cursor-not-allowed"
                    >
                      GIF
                    </button>
                  </div>
                </div>

                {/* Resolution */}
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                    Resolution <span className="text-gray-400 normal-case font-normal">({canvasAspectRatio.w}:{canvasAspectRatio.h})</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {RESOLUTIONS.map((r) => {
                      const w = Math.round(r.h * canvasAspectRatio.w / canvasAspectRatio.h);
                      const heavy = r.h >= 1080;
                      return (
                        <button
                          key={r.label}
                          onClick={() => setResolution(r)}
                          className={`py-2 text-xs font-medium rounded-lg border-2 transition-all ${
                            resolution.label === r.label
                              ? 'border-blue-500 text-blue-600 bg-blue-50'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <div className="font-bold">{r.label}</div>
                          <div className="text-[9px] text-gray-400">{w}×{r.h}</div>
                          {heavy && <div className="text-[8px] text-amber-500 mt-0.5">slow</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* FPS + Bitrate */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                      Frame Rate
                    </label>
                    <div className="flex gap-1">
                      {FPS_OPTIONS.map((f) => (
                        <button
                          key={f}
                          onClick={() => setFps(f)}
                          className={`flex-1 py-1.5 text-xs font-medium rounded-lg border-2 transition-all ${
                            fps === f
                              ? 'border-blue-500 text-blue-600 bg-blue-50'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                      Bitrate: {bitrate} Mbps
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      step={1}
                      value={bitrate}
                      onChange={(e) => setBitrate(parseInt(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, #6366F1 0%, #6366F1 ${(bitrate / 50) * 100}%, #E5E7EB ${(bitrate / 50) * 100}%, #E5E7EB 100%)`,
                      }}
                    />
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-gray-50 rounded-xl p-3 text-[11px] text-gray-500 space-y-1">
                  <div className="flex justify-between">
                    <span>Output</span>
                    <span className="font-medium text-gray-700">
                      {project.name}.{format === 'MP4' ? 'mp4' : 'webm'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Dimensions</span>
                    <span className="font-medium text-gray-700">{exportW}×{exportH}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Duration</span>
                    <span className="font-medium text-gray-700">{project.duration.toFixed(1)}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Export time</span>
                    <span className="font-medium text-gray-700">~{project.duration.toFixed(0)}s real-time</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Est. size</span>
                    <span className="font-medium text-gray-700">
                      ~{Math.round((bitrate * project.duration) / 8)} MB
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleExport}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  <Download size={15} />
                  Export Video
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
