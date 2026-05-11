import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, CheckCircle, Loader2 } from 'lucide-react';
import { useEditorStore, interpolateClip, type Clip } from '../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';
import { TRANSITION_DURATION } from '../player/TransitionOverlay';

// ─── Resolution options (height-based; width computed from aspect ratio) ───────
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

/** Wait for video to finish seeking to a new position */
function waitForSeeked(el: HTMLVideoElement, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    const tid = window.setTimeout(resolve, timeoutMs);
    const done = () => { clearTimeout(tid); resolve(); };
    el.addEventListener('seeked', done, { once: true });
  });
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

/** Resolve text-shadow preset → CSS */
function resolveTextShadow(ts: string | undefined, color: string): string | undefined {
  if (!ts || ts === 'none') return undefined;
  if (ts === 'soft')  return '0 2px 8px rgba(0,0,0,0.6)';
  if (ts === 'hard')  return '2px 2px 0px rgba(0,0,0,0.9)';
  if (ts === 'glow')  return `0 0 12px ${color}, 0 0 24px ${color}`;
  if (ts === 'neon')  return `0 0 6px #fff, 0 0 12px ${color}, 0 0 30px ${color}`;
  return ts;
}

/**
 * Compute entry-transition state for a clip at exportTime.
 */
function getEntryTransitionState(clip: Clip, exportTime: number): { alpha: number; offsetX: number; offsetY: number; scale: number } {
  const ENTRY_DUR = 0.5;
  const entry = clip.entryTransition ?? 'none';
  if (entry === 'none') return { alpha: 1, offsetX: 0, offsetY: 0, scale: 1 };
  const elapsed = exportTime - clip.startTime;
  if (elapsed >= ENTRY_DUR) return { alpha: 1, offsetX: 0, offsetY: 0, scale: 1 };
  const t = Math.max(0, Math.min(1, elapsed / ENTRY_DUR));
  switch (entry) {
    case 'fade-in':    return { alpha: t, offsetX: 0, offsetY: 0, scale: 1 };
    case 'slide-up':   return { alpha: t, offsetX: 0, offsetY: (1 - t) * 40, scale: 1 };
    case 'slide-left': return { alpha: t, offsetX: (1 - t) * 60, offsetY: 0, scale: 1 };
    case 'zoom-in':    return { alpha: t, offsetX: 0, offsetY: 0, scale: 0.6 + t * 0.4 };
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
  const cx    = (liveClip.x ?? 0.5) * exportW;
  const cy    = (liveClip.y ?? 0.5) * exportH;
  const sw    = (liveClip.scaleX ?? 1.0) * exportW;
  const sh    = (liveClip.scaleY ?? 1.0) * exportH;
  const left  = cx - sw / 2;
  const top   = cy - sh / 2;

  const baseFontSize  = Math.max(10, (liveClip.fontSize || 72) * exportW / 1920);
  const fontWeight    = liveClip.fontWeight || 'bold';
  const fontStyle     = liveClip.fontStyle  || 'normal';
  const fontFamily    = liveClip.fontFamily || 'Inter, Arial, sans-serif';
  const color         = liveClip.color      || '#FFFFFF';
  const textAlign     = liveClip.textAlign  || 'center';
  const rawText       = liveClip.text       || '';
  const displayText   = liveClip.textUppercase ? rawText.toUpperCase() : rawText;
  const letterSpacing = liveClip.letterSpacing ? liveClip.letterSpacing * exportW / 1920 : 0;
  const lineHeight    = liveClip.lineHeight || 1.2;

  const { alpha, offsetX, offsetY } = getEntryTransitionState(clip, exportTime);
  const baseOpacity = liveClip.opacity ?? 1;

  ctx.save();

  ctx.beginPath();
  ctx.rect(left + offsetX, top + offsetY, sw, sh);
  ctx.clip();

  if (liveClip.rotation) {
    ctx.translate(cx + offsetX, cy + offsetY);
    ctx.rotate((liveClip.rotation * Math.PI) / 180);
    ctx.translate(-(cx + offsetX), -(cy + offsetY));
  }

  ctx.globalAlpha = baseOpacity * alpha;

  if (liveClip.textBackground && liveClip.textBackground !== 'transparent') {
    ctx.fillStyle = liveClip.textBackground;
    ctx.beginPath();
    ctx.roundRect(left + offsetX, top + offsetY, sw, sh, 4);
    ctx.fill();
  }

  ctx.font = `${fontStyle} ${fontWeight} ${baseFontSize}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = textAlign as CanvasTextAlign;

  const ts = resolveTextShadow(liveClip.textShadow, color);
  if (ts) {
    const m = ts.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(.+)/);
    if (m) {
      ctx.shadowOffsetX = parseFloat(m[1]!);
      ctx.shadowOffsetY = parseFloat(m[2]!);
      ctx.shadowBlur    = parseFloat(m[3]!);
      ctx.shadowColor   = m[4]!;
    }
  }

  if (liveClip.textOutline && liveClip.textOutlineWidth) {
    ctx.strokeStyle = liveClip.textOutline;
    ctx.lineWidth   = liveClip.textOutlineWidth * exportW / 1920;
    ctx.lineJoin    = 'round';
  }

  const padding = 8 * exportW / 1920;
  let textX: number;
  if (textAlign === 'left')       textX = left + offsetX + padding;
  else if (textAlign === 'right') textX = left + offsetX + sw - padding;
  else                            textX = cx + offsetX;

  const lines   = displayText.split('\n');
  const totalH  = lines.length * baseFontSize * lineHeight;
  let lineY     = cy + offsetY - totalH / 2 + (baseFontSize * lineHeight) / 2;

  for (const line of lines) {
    if (letterSpacing > 0) {
      const chars = line.split('');
      const totalLineW = chars.reduce((sum, ch) => sum + ctx.measureText(ch).width + letterSpacing, 0);
      let charX = textAlign === 'center'
        ? textX - totalLineW / 2
        : textAlign === 'right'
        ? textX - totalLineW
        : textX;
      for (const ch of chars) {
        if (liveClip.textOutlineWidth && liveClip.textOutline) ctx.strokeText(ch, charX, lineY);
        ctx.fillText(ch, charX, lineY);
        charX += ctx.measureText(ch).width + letterSpacing;
      }
    } else {
      if (liveClip.textOutlineWidth && liveClip.textOutline) ctx.strokeText(line, textX, lineY);
      ctx.fillText(line, textX, lineY);
    }
    lineY += baseFontSize * lineHeight;
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
  const cx = (liveClip.x ?? 0.5) * exportW;
  const cy = (liveClip.y ?? 0.5) * exportH;
  const sw = (liveClip.scaleX ?? 1.0) * exportW;
  const sh = (liveClip.scaleY ?? 1.0) * exportH;

  const { alpha, offsetX, offsetY, scale } = getEntryTransitionState(clip, exportTime);
  const baseOpacity = liveClip.opacity ?? 1;

  ctx.save();
  ctx.globalAlpha = baseOpacity * alpha;

  const filt = buildFilter(liveClip);
  if (filt && filt !== 'none') {
    // @ts-ignore
    ctx.filter = filt;
  }

  const acx = cx + offsetX;
  const acy = cy + offsetY;

  if (liveClip.rotation) {
    ctx.translate(acx, acy);
    ctx.rotate((liveClip.rotation * Math.PI) / 180);
    ctx.translate(-acx, -acy);
  }

  if (liveClip.blendMode && liveClip.blendMode !== 'normal') {
    ctx.globalCompositeOperation = liveClip.blendMode as GlobalCompositeOperation;
  }

  const imgAR = img.naturalWidth / img.naturalHeight;
  const boxAR = sw / sh;
  let drawW: number, drawH: number;
  if (imgAR > boxAR) { drawW = sw * scale; drawH = (sw / imgAR) * scale; }
  else               { drawH = sh * scale; drawW = (sh * imgAR) * scale; }

  ctx.drawImage(img, acx - drawW / 2, acy - drawH / 2, drawW, drawH);
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
  // For main track: use entry transition alpha but NOT keyframe position/scale
  // (main video always covers the full canvas)
  const { alpha: entryAlpha, offsetX, offsetY, scale: entryScale } = getEntryTransitionState(clip, exportTime);

  // Only apply keyframe opacity for overlay clips; main track uses clip.opacity or 1
  const baseOpacity = isMainTrack
    ? (clip.opacity ?? 1) * entryAlpha
    : (liveClip.opacity ?? 1) * entryAlpha;

  ctx.save();
  ctx.globalAlpha = baseOpacity;

  const filt = buildFilter(isMainTrack ? clip : liveClip);
  if (filt && filt !== 'none') {
    // @ts-ignore
    ctx.filter = filt;
  }

  if (liveClip.blendMode && liveClip.blendMode !== 'normal') {
    ctx.globalCompositeOperation = liveClip.blendMode as GlobalCompositeOperation;
  }

  if (isMainTrack) {
    // object-fit: cover — fills canvas, centred
    const vidAR = vid.videoWidth  / (vid.videoHeight || 1);
    const boxAR = exportW / exportH;
    let drawW: number, drawH: number;
    if (vidAR > boxAR) { drawH = exportH; drawW = exportH * vidAR; }
    else               { drawW = exportW; drawH = exportW / vidAR; }
    const drawX = (exportW - drawW) / 2;
    const drawY = (exportH - drawH) / 2;
    ctx.drawImage(vid, drawX, drawY, drawW, drawH);
  } else {
    // Overlay clip — positioned by keyframe-interpolated x/y/scale
    const cx  = (liveClip.x  ?? 0.5) * exportW;
    const cy  = (liveClip.y  ?? 0.5) * exportH;
    const sw  = (liveClip.scaleX ?? 1.0) * exportW;
    const sh  = (liveClip.scaleY ?? 1.0) * exportH;
    const acx = cx + offsetX;
    const acy = cy + offsetY;

    if (liveClip.rotation) {
      ctx.translate(acx, acy);
      ctx.rotate((liveClip.rotation * Math.PI) / 180);
      ctx.translate(-acx, -acy);
    }

    const vidAR = vid.videoWidth  / (vid.videoHeight || 1);
    const boxAR = sw / sh;
    let drawW: number, drawH: number;
    if (vidAR > boxAR) { drawW = sw * entryScale; drawH = (sw / vidAR) * entryScale; }
    else               { drawH = sh * entryScale; drawW = (sh * vidAR) * entryScale; }

    ctx.drawImage(vid, acx - drawW / 2, acy - drawH / 2, drawW, drawH);
  }

  ctx.restore();
}

/**
 * Draw clip transition overlay.
 */
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
    case 'fade':
    default: {
      ctx.globalAlpha = fade;
      ctx.fillStyle   = '#000000';
      ctx.fillRect(0, 0, exportW, exportH);
      break;
    }
    case 'dissolve': {
      const na = fade * 0.9;
      const grd1 = ctx.createRadialGradient(exportW * 0.2, exportH * 0.2, 0, exportW * 0.2, exportH * 0.2, exportW * 0.4);
      grd1.addColorStop(0, `rgba(0,0,0,${na})`);
      grd1.addColorStop(1, 'transparent');
      ctx.globalAlpha = 1;
      ctx.fillStyle   = grd1;
      ctx.fillRect(0, 0, exportW, exportH);
      const grd2 = ctx.createRadialGradient(exportW * 0.8, exportH * 0.4, 0, exportW * 0.8, exportH * 0.4, exportW * 0.35);
      grd2.addColorStop(0, `rgba(0,0,0,${na * 0.8})`);
      grd2.addColorStop(1, 'transparent');
      ctx.fillStyle = grd2;
      ctx.fillRect(0, 0, exportW, exportH);
      break;
    }
    case 'blur': {
      ctx.globalAlpha = fade * 0.6;
      ctx.fillStyle   = '#000000';
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
    case 'slide-left': {
      ctx.globalAlpha = fade * 0.5;
      const grd = ctx.createLinearGradient(0, 0, exportW, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0.4)');
      grd.addColorStop(1, 'rgba(0,0,0,0.1)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, exportW * (1 - p), exportH);
      break;
    }
    case 'zoom': {
      ctx.globalAlpha = fade * 0.45;
      ctx.fillStyle   = '#000000';
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
    case 'whip': {
      for (let i = 0; i < 6; i++) {
        const yPos = ([0.1, 0.28, 0.45, 0.62, 0.78, 0.9][i] ?? 0) * exportH;
        ctx.globalAlpha = fade * (0.06 + (i % 2) * 0.04);
        ctx.fillStyle   = '#ffffff';
        ctx.fillRect(0, yPos, exportW, exportH * 0.015 * (1 + (i % 3)));
      }
      break;
    }
  }

  ctx.restore();
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

  // Default to 1080p (high quality). User can change.
  const [resolution, setResolution] = useState<typeof RESOLUTIONS[number]>(RESOLUTIONS[1]!);
  const [format,     setFormat]     = useState<typeof FORMATS[number]>('MP4');
  const [fps,        setFps]        = useState<typeof FPS_OPTIONS[number]>(30);
  const [bitrate,    setBitrate]    = useState(16); // default higher bitrate
  const [status,     setStatus]     = useState<ExportStatus>('idle');
  const [progress,   setProgress]   = useState(0);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileName,    setFileName]   = useState('export.mp4');

  const cancelRef   = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Compute export dimensions from selected resolution height + canvas aspect ratio
  const exportH = resolution.h;
  const exportW = Math.round(exportH * (canvasAspectRatio.w / canvasAspectRatio.h));

  // Auto-select best resolution based on source video native height
  useEffect(() => {
    if (!showExportModal) {
      setStatus('idle');
      setProgress(0);
      setErrorMsg(null);
      cancelRef.current = false;
      return;
    }
    // Detect native video resolution from the first video element in preview
    const previewRoot = document.querySelector<HTMLDivElement>('[data-preview-canvas="root"]');
    if (previewRoot) {
      const vid = previewRoot.querySelector<HTMLVideoElement>('video[data-clip-id]');
      if (vid && vid.videoHeight > 0) {
        const nativeH = vid.videoHeight;
        // Pick the closest resolution option that doesn't exceed native
        const best = [...RESOLUTIONS].reverse().find((r) => r.h <= nativeH) ?? RESOLUTIONS[1]!;
        setResolution(best);
      }
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

    // All elements we create — cleaned up on finish/error
    const exportVideos: HTMLVideoElement[] = [];
    const exportAudios: HTMLAudioElement[] = [];
    let audioCtx: AudioContext | null = null;

    try {
      // ── 1. Create offscreen canvas ─────────────────────────────────────────
      const canvas  = document.createElement('canvas');
      canvas.width  = exportW;
      canvas.height = exportH;
      const ctx     = canvas.getContext('2d', { alpha: false })!;

      // ── 2. Gather all clips ────────────────────────────────────────────────
      const allClips   = project.tracks.flatMap((t) => t.clips);
      const mainTrack  = project.tracks.find((t) => t.type === 'video');
      const videoClips = allClips.filter((c) => c.type === 'video');
      const textClips  = allClips.filter((c) => c.type === 'text');
      const imageClips = allClips.filter((c) => c.type === 'image');
      const audioClips = allClips.filter((c) => c.type === 'audio');

      // ── 3. Create dedicated <video> elements for export ───────────────────
      // We do NOT reuse preview elements — avoids fighting MediaEngine and
      // lets us freely connect them to our own AudioContext.
      const videoElMap = new Map<string, HTMLVideoElement>();

      for (const clip of videoClips) {
        const mediaSrc = clip.src
          || (clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId)?.src : undefined);
        if (!mediaSrc) continue;

        const vid = document.createElement('video');
        vid.src          = mediaSrc;
        vid.crossOrigin  = 'anonymous';
        vid.preload      = 'auto';
        vid.muted        = false; // unmuted so AudioContext can capture audio
        vid.playbackRate = clip.speed ?? 1;
        // Keep hidden but in DOM so browser decodes
        vid.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
        document.body.appendChild(vid);
        exportVideos.push(vid);
        videoElMap.set(clip.id, vid);
      }

      // ── 4. Create dedicated <audio> elements for export ───────────────────
      const audioElMap = new Map<string, HTMLAudioElement>();

      for (const clip of audioClips) {
        const mediaSrc = clip.src
          || (clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId)?.src : undefined);
        if (!mediaSrc) continue;

        const aud = document.createElement('audio');
        aud.src         = mediaSrc;
        aud.crossOrigin = 'anonymous';
        aud.preload     = 'auto';
        document.body.appendChild(aud);
        exportAudios.push(aud);
        audioElMap.set(clip.id, aud);
      }

      // ── 5. Build Web Audio graph ───────────────────────────────────────────
      audioCtx = new AudioContext();
      const audioDest = audioCtx.createMediaStreamDestination();

      for (const clip of videoClips) {
        const vid = videoElMap.get(clip.id);
        if (!vid) continue;
        const srcNode  = audioCtx.createMediaElementSource(vid);
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = Math.max(0, Math.min(1, clip.volume ?? 1));
        srcNode.connect(gainNode);
        gainNode.connect(audioDest);
        // Do NOT connect to audioCtx.destination — we only want recorder output
      }

      for (const clip of audioClips) {
        const aud = audioElMap.get(clip.id);
        if (!aud) continue;
        const srcNode  = audioCtx.createMediaElementSource(aud);
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = Math.max(0, Math.min(1, clip.volume ?? 1));
        srcNode.connect(gainNode);
        gainNode.connect(audioDest);
      }

      // ── 6. Set up MediaRecorder with video + audio ─────────────────────────
      const mime        = getMimeType(format);
      const ext         = getExt(mime);
      const videoStream = canvas.captureStream(fps);

      for (const track of audioDest.stream.getAudioTracks()) {
        videoStream.addTrack(track);
      }

      const recorder = new MediaRecorder(videoStream, {
        mimeType: mime,
        videoBitsPerSecond: bitrate * 1_000_000,
      });
      recorderRef.current = recorder;

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const done = new Promise<Blob>((resolve, reject) => {
        recorder.onstop  = () => resolve(new Blob(chunks, { type: mime }));
        recorder.onerror = (e) => reject(e);
      });

      recorder.start(100);

      // ── 7. Pause real playback ─────────────────────────────────────────────
      setIsPlaying(false);
      await new Promise((r) => setTimeout(r, 150));

      // ── 8. Preload images ──────────────────────────────────────────────────
      const imagePreloadMap = new Map<string, HTMLImageElement | null>();
      await Promise.all(imageClips.map(async (clip) => {
        const mediaSrc = clip.src
          || (clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId)?.src : undefined);
        if (mediaSrc) imagePreloadMap.set(clip.id, await preloadImage(mediaSrc));
      }));

      // ── 9. Load + seek all video/audio elements to their start positions ───
      await Promise.all([
        ...videoClips.map(async (clip) => {
          const vid = videoElMap.get(clip.id);
          if (!vid) return;
          vid.load();
          await new Promise<void>((r) => {
            const tid = setTimeout(r, 5000);
            const done = () => { clearTimeout(tid); r(); };
            vid.addEventListener('canplay', done, { once: true });
            vid.addEventListener('error',   done, { once: true });
          });
          vid.currentTime = clip.trimStart ?? 0;
          await waitForSeeked(vid, 3000);
        }),
        ...audioClips.map(async (clip) => {
          const aud = audioElMap.get(clip.id);
          if (!aud) return;
          aud.load();
          await new Promise<void>((r) => {
            const tid = setTimeout(r, 5000);
            const done = () => { clearTimeout(tid); r(); };
            aud.addEventListener('canplay', done, { once: true });
            aud.addEventListener('error',   done, { once: true });
          });
          aud.currentTime = clip.trimStart ?? 0;
          await new Promise<void>((r) => {
            const tid = setTimeout(r, 1000);
            aud.addEventListener('seeked', () => { clearTimeout(tid); r(); }, { once: true });
          });
        }),
      ]);

      // ── 10. Frame loop ─────────────────────────────────────────────────────
      const totalDuration = project.duration;
      const frameInterval = 1 / fps;
      let   exportTime    = 0;

      while (exportTime <= totalDuration && !cancelRef.current) {

        // ── 10a. Resolve keyframe-interpolated clip state ────────────────────
        const liveClipMap = new Map<string, Clip>();
        for (const clip of allClips) {
          const interp = interpolateClip(clip, exportTime);
          const live   = Object.keys(interp).length > 0 ? { ...clip, ...interp } : clip;
          liveClipMap.set(clip.id, live as Clip);
        }

        // ── 10b. Seek active video clips to correct source time ──────────────
        const seekPromises: Promise<void>[] = [];

        for (const clip of videoClips) {
          const isActive = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
          const vid      = videoElMap.get(clip.id);
          if (!vid || !isActive) continue;

          const speed         = clip.speed ?? 1;
          const trimStart     = clip.trimStart ?? 0;
          const elapsedInClip = (exportTime - clip.startTime) * speed;
          const targetTime    = trimStart + elapsedInClip;
          const maxTime       = isFinite(vid.duration) ? vid.duration : targetTime;
          const clampedTime   = Math.max(0, Math.min(maxTime, targetTime));

          if (Math.abs(vid.currentTime - clampedTime) > 0.015) {
            vid.currentTime = clampedTime;
            seekPromises.push(waitForSeeked(vid, 2000));
          }
        }

        // Keep audio in sync (no await — just set currentTime; AudioContext handles real-time)
        for (const clip of audioClips) {
          const isActive = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
          const aud      = audioElMap.get(clip.id);
          if (!aud) continue;
          if (isActive) {
            const targetTime = (clip.trimStart ?? 0) + (exportTime - clip.startTime);
            if (aud.paused) {
              aud.currentTime = targetTime;
              aud.play().catch(() => {});
            } else if (Math.abs(aud.currentTime - targetTime) > 0.1) {
              aud.currentTime = targetTime;
            }
          } else {
            if (!aud.paused) aud.pause();
          }
        }

        if (seekPromises.length > 0) await Promise.all(seekPromises);

        // Give browser one rAF to decode the sought frame
        await new Promise<void>((r) => requestAnimationFrame(() => r()));

        // ── 10c. Draw frame ──────────────────────────────────────────────────
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, exportW, exportH);

        // Main track videos (bottom layer, cover fill)
        for (const clip of videoClips) {
          const isActive = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
          if (!isActive || clip.trackId !== mainTrack?.id) continue;
          const vid = videoElMap.get(clip.id);
          if (!vid || vid.readyState < 2) continue;
          const liveClip = liveClipMap.get(clip.id)!;
          try { drawVideoClip(ctx, clip, vid, exportW, exportH, true, liveClip, exportTime); } catch { /* skip */ }
        }

        // Overlay video clips
        for (const clip of videoClips) {
          const isActive = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
          if (!isActive || clip.trackId === mainTrack?.id) continue;
          const vid = videoElMap.get(clip.id);
          if (!vid || vid.readyState < 2) continue;
          const liveClip = liveClipMap.get(clip.id)!;
          try { drawVideoClip(ctx, clip, vid, exportW, exportH, false, liveClip, exportTime); } catch { /* skip */ }
        }

        // Image clips
        for (const clip of imageClips) {
          const isActive = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
          if (!isActive) continue;
          const img = imagePreloadMap.get(clip.id);
          if (!img) continue;
          const liveClip = liveClipMap.get(clip.id)!;
          drawImageClip(ctx, clip, img, exportW, exportH, liveClip, exportTime);
        }

        // Text clips (top layer)
        for (const clip of textClips) {
          const isActive = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
          if (!isActive) continue;
          const liveClip = liveClipMap.get(clip.id)!;
          drawTextClip(ctx, clip, exportW, exportH, liveClip, exportTime);
        }

        // ── 10d. Clip transitions ────────────────────────────────────────────
        if (mainTrack) {
          const mainClips = mainTrack.clips
            .filter((c) => c.type === 'video')
            .sort((a, b) => a.startTime - b.startTime);

          for (let i = 0; i < mainClips.length - 1; i++) {
            const curr = mainClips[i]!;
            const tEnd   = curr.startTime + curr.duration;
            const tStart = tEnd - TRANSITION_DURATION;

            if (exportTime >= tStart && exportTime <= tEnd + TRANSITION_DURATION && curr.transition) {
              const progress = (exportTime - tStart) / (TRANSITION_DURATION * 2);
              drawTransition(ctx, curr.transition, progress, exportW, exportH);
              break;
            }
          }
        }

        exportTime += frameInterval;
        setProgress(Math.min(99, (exportTime / totalDuration) * 100));
        setCurrentTime(exportTime);
      }

      const cleanup = () => {
        videoStream.getTracks().forEach((t) => t.stop());
        audioCtx?.close();
        exportVideos.forEach((v) => { v.pause(); v.src = ''; v.remove(); });
        exportAudios.forEach((a) => { a.pause(); a.src = ''; a.remove(); });
      };

      if (cancelRef.current) {
        recorder.stop();
        cleanup();
        setStatus('idle');
        return;
      }

      // ── 11. Finish ─────────────────────────────────────────────────────────
      recorder.stop();
      cleanup();

      const blob = await done;
      const url  = URL.createObjectURL(blob);
      const name = `${project.name.replace(/\s+/g, '_')}.${ext}`;

      setDownloadUrl(url);
      setFileName(name);
      setProgress(100);
      setStatus('done');
      setCurrentTime(0);

    } catch (err: unknown) {
      console.error('[Export] failed:', err);
      audioCtx?.close();
      exportVideos.forEach((v) => { try { v.pause(); v.src = ''; v.remove(); } catch {} });
      exportAudios.forEach((a) => { try { a.pause(); a.src = ''; a.remove(); } catch {} });
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('idle');
    }
  };

  const handleCancel = () => {
    cancelRef.current = true;
    recorderRef.current?.stop();
  };

  const handleDownload = () => {
    if (!downloadUrl) return;
    const a = document.createElement('a');
    a.href = downloadUrl;
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
            onClick={() => setShowExportModal(false)}
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
              <button
                onClick={() => setShowExportModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <X size={16} />
              </button>
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
                  <div className="font-semibold text-gray-800">Rendering frames…</div>
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
                    Frame-accurate render · keyframes · transitions · audio
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
                    <span>Frames</span>
                    <span className="font-medium text-gray-700">{Math.round(project.duration * fps)}</span>
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
