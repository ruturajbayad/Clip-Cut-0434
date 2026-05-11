import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, CheckCircle, Loader2 } from 'lucide-react';
import { useEditorStore, type Clip } from '../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';

const RESOLUTIONS = [
  { label: '720p HD',   value: '720p',  w: 1280, h: 720  },
  { label: '1080p FHD', value: '1080p', w: 1920, h: 1080 },
  { label: '4K UHD',   value: '4k',    w: 3840, h: 2160 },
];

const FORMATS    = ['MP4', 'WebM'] as const;
const FPS_OPTIONS = [24, 30, 60]  as const;

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
  if (clip.effect && EFFECT_FILTERS[clip.effect]) return EFFECT_FILTERS[clip.effect];
  if (clip.filterCss) return clip.filterCss;
  const parts: string[] = [];
  if (clip.brightness !== undefined && clip.brightness !== 100) parts.push(`brightness(${clip.brightness}%)`);
  if (clip.contrast   !== undefined && clip.contrast   !== 100) parts.push(`contrast(${clip.contrast}%)`);
  if (clip.saturation !== undefined && clip.saturation !== 100) parts.push(`saturate(${clip.saturation}%)`);
  if (clip.blur       !== undefined && clip.blur       !== 0)   parts.push(`blur(${clip.blur}px)`);
  return parts.join(' ') || 'none';
}

/** Wait for a video element to finish seeking */
function waitForSeeked(el: HTMLVideoElement, timeoutMs = 500): Promise<void> {
  return new Promise((resolve) => {
    if (!isFinite(el.duration) || el.readyState >= 2) {
      resolve(); return;
    }
    const tid = setTimeout(resolve, timeoutMs);
    const cb  = () => { clearTimeout(tid); el.removeEventListener('seeked', cb); resolve(); };
    el.addEventListener('seeked', cb, { once: true });
  });
}

/** Resolve text-shadow preset key → CSS */
function resolveTextShadow(ts: string | undefined, color: string): string | undefined {
  if (!ts || ts === 'none') return undefined;
  if (ts === 'soft')  return '0 2px 8px rgba(0,0,0,0.6)';
  if (ts === 'hard')  return '2px 2px 0px rgba(0,0,0,0.9)';
  if (ts === 'glow')  return `0 0 12px ${color}, 0 0 24px ${color}`;
  if (ts === 'neon')  return `0 0 6px #fff, 0 0 12px ${color}, 0 0 30px ${color}`;
  return ts; // raw CSS
}

/**
 * Preload an <img> src and return the HTMLImageElement.
 * Returns null on failure so callers can skip gracefully.
 */
function preloadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ─── canvas text drawing ───────────────────────────────────────────────────────
/**
 * Draw a text clip onto the export canvas.
 * Mirrors OverlayLayer logic exactly: position = (x * W, y * H) center,
 * size = (scaleX * W, scaleY * H).
 */
function drawTextClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  exportW: number,
  exportH: number,
) {
  const cx    = (clip.x ?? 0.5) * exportW;
  const cy    = (clip.y ?? 0.5) * exportH;
  const sw    = (clip.scaleX ?? 1.0) * exportW;
  const sh    = (clip.scaleY ?? 1.0) * exportH;
  const left  = cx - sw / 2;
  const top   = cy - sh / 2;

  // Same font-size scaling as OverlayLayer (canvasW / 1920)
  const baseFontSize = Math.max(10, (clip.fontSize || 72) * exportW / 1920);
  const fontWeight   = clip.fontWeight || 'bold';
  const fontStyle    = clip.fontStyle  || 'normal';
  const fontFamily   = clip.fontFamily || 'Inter, Arial, sans-serif';
  const color        = clip.color      || '#FFFFFF';
  const textAlign    = clip.textAlign  || 'center';
  const rawText      = clip.text       || '';
  const displayText  = clip.textUppercase ? rawText.toUpperCase() : rawText;
  const letterSpacing = clip.letterSpacing ? clip.letterSpacing * exportW / 1920 : 0;
  const lineHeight   = clip.lineHeight || 1.2;

  ctx.save();

  // Clip to the text box bounds (prevents overflow)
  ctx.beginPath();
  ctx.rect(left, top, sw, sh);
  ctx.clip();

  // Rotation
  if (clip.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((clip.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  // Opacity
  ctx.globalAlpha = clip.opacity ?? 1;

  // Text background box
  if (clip.textBackground && clip.textBackground !== 'transparent') {
    ctx.fillStyle = clip.textBackground;
    ctx.beginPath();
    ctx.roundRect(left, top, sw, sh, 4);
    ctx.fill();
  }

  // Font
  ctx.font = `${fontStyle} ${fontWeight} ${baseFontSize}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = textAlign as CanvasTextAlign;

  // Text shadow
  const ts = resolveTextShadow(clip.textShadow, color);
  if (ts) {
    // Parse first shadow from CSS string (e.g. "0 2px 8px rgba(0,0,0,0.6)")
    const m = ts.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(.+)/);
    if (m) {
      ctx.shadowOffsetX = parseFloat(m[1]);
      ctx.shadowOffsetY = parseFloat(m[2]);
      ctx.shadowBlur    = parseFloat(m[3]);
      ctx.shadowColor   = m[4];
    }
  }

  // Outline (stroke)
  if (clip.textOutline && clip.textOutlineWidth) {
    ctx.strokeStyle   = clip.textOutline;
    ctx.lineWidth     = clip.textOutlineWidth * exportW / 1920;
    ctx.lineJoin      = 'round';
  }

  // X position based on alignment
  let textX: number;
  const padding = 8 * exportW / 1920;
  if (textAlign === 'left')  textX = left + padding;
  else if (textAlign === 'right') textX = left + sw - padding;
  else textX = cx; // center

  // Handle multi-line text + letter-spacing
  const lines = displayText.split('\n');
  const totalH = lines.length * baseFontSize * lineHeight;
  let lineY = cy - totalH / 2 + (baseFontSize * lineHeight) / 2;

  for (const line of lines) {
    if (letterSpacing > 0) {
      // Draw character by character for letter-spacing
      // Measure total line width first
      const chars = line.split('');
      const totalLineW = chars.reduce((sum, ch) => sum + ctx.measureText(ch).width + letterSpacing, 0);
      let charX = textAlign === 'center'
        ? textX - totalLineW / 2
        : textAlign === 'right'
        ? textX - totalLineW
        : textX;
      for (const ch of chars) {
        if (clip.textOutlineWidth && clip.textOutline) {
          ctx.strokeText(ch, charX, lineY);
        }
        ctx.fillText(ch, charX, lineY);
        charX += ctx.measureText(ch).width + letterSpacing;
      }
    } else {
      if (clip.textOutlineWidth && clip.textOutline) {
        ctx.strokeText(line, textX, lineY);
      }
      ctx.fillText(line, textX, lineY);
    }
    lineY += baseFontSize * lineHeight;
  }

  ctx.restore();
}

/**
 * Draw an image clip onto the export canvas.
 * Uses the same position/scale math as OverlayLayer.
 */
function drawImageClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  img: HTMLImageElement,
  exportW: number,
  exportH: number,
) {
  const cx   = (clip.x ?? 0.5) * exportW;
  const cy   = (clip.y ?? 0.5) * exportH;
  const sw   = (clip.scaleX ?? 1.0) * exportW;
  const sh   = (clip.scaleY ?? 1.0) * exportH;

  ctx.save();

  ctx.globalAlpha = clip.opacity ?? 1;

  // Apply CSS filters (cannot do blur in canvas ctx easily, but brightness/contrast/sat work)
  const filt = buildFilter(clip);
  if (filt && filt !== 'none') {
    // @ts-ignore — ctx.filter is standard but TS types lag
    ctx.filter = filt;
  }

  if (clip.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((clip.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  // Blend mode
  if (clip.blendMode && clip.blendMode !== 'normal') {
    ctx.globalCompositeOperation = clip.blendMode as GlobalCompositeOperation;
  }

  // object-fit: contain — maintain aspect ratio
  const imgAR  = img.naturalWidth / img.naturalHeight;
  const boxAR  = sw / sh;
  let drawW: number, drawH: number;
  if (imgAR > boxAR) {
    drawW = sw;
    drawH = sw / imgAR;
  } else {
    drawH = sh;
    drawW = sh * imgAR;
  }
  const drawX = cx - drawW / 2;
  const drawY = cy - drawH / 2;

  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();
}

/**
 * Draw a video clip onto the export canvas.
 * The wrapper element is positioned by OverlayLayer (overlay clips)
 * or fills the canvas (main track clips).
 */
function drawVideoClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  vid: HTMLVideoElement,
  exportW: number,
  exportH: number,
  isMainTrack: boolean,
) {
  const filt = buildFilter(clip);
  ctx.save();
  ctx.globalAlpha = clip.opacity ?? 1;
  if (filt && filt !== 'none') {
    // @ts-ignore
    ctx.filter = filt;
  }

  if (isMainTrack) {
    // object-fit: cover
    const vidAR = vid.videoWidth  / (vid.videoHeight || 1);
    const boxAR = exportW / exportH;
    let drawW: number, drawH: number, drawX: number, drawY: number;
    if (vidAR > boxAR) {
      drawH = exportH; drawW = exportH * vidAR;
    } else {
      drawW = exportW; drawH = exportW / vidAR;
    }
    drawX = (exportW - drawW) / 2;
    drawY = (exportH - drawH) / 2;
    ctx.drawImage(vid, drawX, drawY, drawW, drawH);
  } else {
    // Overlay clip — same position/scale as OverlayLayer CanvasElement
    const cx  = (clip.x ?? 0.5) * exportW;
    const cy  = (clip.y ?? 0.5) * exportH;
    const sw  = (clip.scaleX ?? 1.0) * exportW;
    const sh  = (clip.scaleY ?? 1.0) * exportH;

    if (clip.rotation) {
      ctx.translate(cx, cy);
      ctx.rotate((clip.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    // object-fit: contain
    const vidAR = vid.videoWidth  / (vid.videoHeight || 1);
    const boxAR = sw / sh;
    let drawW: number, drawH: number;
    if (vidAR > boxAR) { drawW = sw; drawH = sw / vidAR; }
    else                { drawH = sh; drawW = sh * vidAR; }
    ctx.drawImage(vid, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
  }

  ctx.restore();
}

// ─── component ────────────────────────────────────────────────────────────────

export default function ExportModal() {
  const {
    showExportModal, setShowExportModal,
    project, mediaLibrary,
    setCurrentTime, setIsPlaying,
  } = useEditorStore(useShallow((s) => ({
    showExportModal:    s.showExportModal,
    setShowExportModal: s.setShowExportModal,
    project:            s.project,
    mediaLibrary:       s.mediaLibrary,
    setCurrentTime:     s.setCurrentTime,
    setIsPlaying:       s.setIsPlaying,
  })));

  const [resolution, setResolution] = useState(RESOLUTIONS[1]);
  const [format,     setFormat]     = useState<typeof FORMATS[number]>('MP4');
  const [fps,        setFps]        = useState<typeof FPS_OPTIONS[number]>(30);
  const [bitrate,    setBitrate]    = useState(8);
  const [status,     setStatus]     = useState<ExportStatus>('idle');
  const [progress,   setProgress]   = useState(0);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileName,    setFileName]   = useState('export.webm');

  const cancelRef   = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);

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

    try {
      const exportW = resolution.w;
      const exportH = resolution.h;

      // ── 1. Create offscreen canvas ─────────────────────────────────────────
      const canvas  = document.createElement('canvas');
      canvas.width  = exportW;
      canvas.height = exportH;
      const ctx     = canvas.getContext('2d', { alpha: false })!;

      // ── 2. Set up MediaRecorder ────────────────────────────────────────────
      const mime     = getMimeType(format);
      const ext      = getExt(mime);
      const stream   = canvas.captureStream(fps);
      const recorder = new MediaRecorder(stream, {
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

      // ── 3. Pause real playback ─────────────────────────────────────────────
      setIsPlaying(false);

      // ── 4. Get all clips from store ────────────────────────────────────────
      const allClips  = project.tracks.flatMap((t) => t.clips);
      const mainTrack = project.tracks.find((t) => t.type === 'video');

      const videoClips = allClips.filter((c) => c.type === 'video');
      const textClips  = allClips.filter((c) => c.type === 'text');
      const imageClips = allClips.filter((c) => c.type === 'image');

      // ── 5. Locate live <video> elements from the DOM ───────────────────────
      // They are rendered in VideoLayer with persistent DOM mounting.
      // We find them by matching the src attribute which includes clip.id as hash.
      const previewRoot = document.querySelector<HTMLDivElement>('[data-preview-canvas="root"]');

      // Build clipId → HTMLVideoElement map
      // VideoLayer sets data-clip-id on every <video> element for reliable lookup.
      const videoElMap = new Map<string, HTMLVideoElement>();
      if (previewRoot) {
        const videoEls = Array.from(previewRoot.querySelectorAll<HTMLVideoElement>('video[data-clip-id]'));
        for (const vid of videoEls) {
          const id = vid.dataset.clipId;
          if (id) videoElMap.set(id, vid);
        }
        // Fallback: match by src hash if data-clip-id not present
        if (videoElMap.size === 0) {
          const allVids = Array.from(previewRoot.querySelectorAll<HTMLVideoElement>('video'));
          for (const vid of allVids) {
            const hash = vid.src.split('#')[1];
            if (hash) videoElMap.set(hash, vid);
          }
        }
      }

      // ── 6. Preload all image sources ───────────────────────────────────────
      const imageElMap = new Map<string, HTMLImageElement | null>();
      await Promise.all(imageClips.map(async (clip) => {
        const mediaSrc = clip.src
          || (clip.mediaId ? mediaLibrary.find((m) => m.id === clip.mediaId)?.src : undefined);
        if (mediaSrc) {
          imageElMap.set(clip.id, await preloadImage(mediaSrc));
        }
      }));

      // ── 7. Frame loop ──────────────────────────────────────────────────────
      const totalDuration = project.duration;
      const frameInterval = 1 / fps;
      let   exportTime    = 0;

      while (exportTime <= totalDuration && !cancelRef.current) {

        // ── 7a. Seek each video clip to the correct source time ──────────────
        const seekPromises: Promise<void>[] = [];

        for (const clip of videoClips) {
          const isActive = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
          const vid = videoElMap.get(clip.id);
          if (!vid) continue;

          if (!isActive) {
            // Hide off-screen clips during export
            vid.parentElement && (vid.parentElement.style.opacity = '0');
            continue;
          }

          // Compute source time: trimStart + elapsed_in_clip * speed
          const speed       = clip.speed ?? 1;
          const trimStart   = clip.trimStart ?? 0;
          const elapsedInClip = (exportTime - clip.startTime) * speed;
          const targetTime  = trimStart + elapsedInClip;
          const clampedTime = Math.max(0, Math.min(vid.duration || targetTime, targetTime));

          if (Math.abs(vid.currentTime - clampedTime) > 0.02) {
            vid.currentTime = clampedTime;
            seekPromises.push(waitForSeeked(vid, 400));
          }
        }

        // Wait for all seeks to complete
        if (seekPromises.length > 0) await Promise.all(seekPromises);

        // Give browser a frame to decode (rAF settle)
        await new Promise<void>((r) => requestAnimationFrame(() => r()));

        // ── 7b. Draw frame ───────────────────────────────────────────────────
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, exportW, exportH);

        // Draw main-track video clips first (bottom layer)
        for (const clip of videoClips) {
          const isActive = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
          if (!isActive) continue;
          const vid = videoElMap.get(clip.id);
          if (!vid || vid.readyState < 2) continue;

          const isMainTrack = clip.trackId === mainTrack?.id;
          // Only draw main track here (overlays drawn after text/image — they go on top)
          if (isMainTrack) {
            try {
              drawVideoClip(ctx, clip, vid, exportW, exportH, true);
            } catch { /* cross-origin / not-ready */ }
          }
        }

        // Draw overlay video clips (on top of main but behind text)
        for (const clip of videoClips) {
          const isActive = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
          if (!isActive) continue;
          const vid = videoElMap.get(clip.id);
          if (!vid || vid.readyState < 2) continue;
          const isMainTrack = clip.trackId === mainTrack?.id;
          if (!isMainTrack) {
            try {
              drawVideoClip(ctx, clip, vid, exportW, exportH, false);
            } catch { /* skip */ }
          }
        }

        // Draw image clips
        for (const clip of imageClips) {
          const isActive = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
          if (!isActive) continue;
          const img = imageElMap.get(clip.id);
          if (!img) continue;
          drawImageClip(ctx, clip, img, exportW, exportH);
        }

        // Draw text clips (top layer)
        for (const clip of textClips) {
          const isActive = exportTime >= clip.startTime && exportTime < clip.startTime + clip.duration;
          if (!isActive) continue;
          drawTextClip(ctx, clip, exportW, exportH);
        }

        exportTime += frameInterval;
        setProgress(Math.min(99, (exportTime / totalDuration) * 100));
        setCurrentTime(exportTime);
      }

      if (cancelRef.current) {
        recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
        setStatus('idle');
        return;
      }

      // ── 8. Finish ─────────────────────────────────────────────────────────
      recorder.stop();
      stream.getTracks().forEach((t) => t.stop());

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

            {/* ── Done ─────────────────────────────────────────────────────── */}
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
                    {fileName} — click Download to save
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

            /* ── Exporting ───────────────────────────────────────────────── */
            ) : status === 'exporting' ? (
              <div className="p-8 flex flex-col items-center gap-4 text-center">
                <div className="relative">
                  <Loader2 size={40} className="text-blue-500 animate-spin" />
                </div>
                <div>
                  <div className="font-semibold text-gray-800">Rendering frames…</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {fps} fps · {resolution.label} · {format}
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
                    Frame-accurate canvas render in progress
                  </div>
                </div>
                <button
                  onClick={handleCancel}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>

            /* ── Settings ────────────────────────────────────────────────── */
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
                      title="GIF not supported in browser"
                    >
                      GIF
                    </button>
                  </div>
                </div>

                {/* Resolution */}
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                    Resolution
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {RESOLUTIONS.map((r) => (
                      <button
                        key={r.value}
                        onClick={() => setResolution(r)}
                        className={`py-2 text-xs font-medium rounded-lg border-2 transition-all ${
                          resolution.value === r.value
                            ? 'border-blue-500 text-blue-600 bg-blue-50'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        <div className="font-bold">{r.label.split(' ')[0]}</div>
                        <div className="text-[9px] text-gray-400">{r.w}×{r.h}</div>
                      </button>
                    ))}
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
                    <span>Duration</span>
                    <span className="font-medium text-gray-700">{project.duration}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Est. size</span>
                    <span className="font-medium text-gray-700">
                      ~{Math.round((bitrate * project.duration) / 8)} MB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Frames</span>
                    <span className="font-medium text-gray-700">
                      {Math.round(project.duration * fps)}
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
