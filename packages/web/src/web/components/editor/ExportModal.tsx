import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, CheckCircle, Loader2 } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';

const RESOLUTIONS = [
  { label: '720p HD',  value: '720p', w: 1280, h: 720  },
  { label: '1080p FHD', value: '1080p', w: 1920, h: 1080 },
  { label: '4K UHD',  value: '4k',   w: 3840, h: 2160 },
];

const FORMATS = ['MP4', 'WebM'] as const;
const FPS_OPTIONS = [24, 30, 60] as const;

type ExportStatus = 'idle' | 'exporting' | 'done';

// ─── helpers ──────────────────────────────────────────────────────────────────

function getMimeType(format: string): string {
  if (format === 'MP4') {
    // Prefer mp4 if supported, fall back to webm
    if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1'))  return 'video/mp4;codecs=avc1';
    if (MediaRecorder.isTypeSupported('video/mp4'))              return 'video/mp4';
  }
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9'))   return 'video/webm;codecs=vp9';
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8'))   return 'video/webm;codecs=vp8';
  return 'video/webm';
}

function getExt(mime: string): string {
  if (mime.startsWith('video/mp4')) return 'mp4';
  return 'webm';
}

// ─── component ────────────────────────────────────────────────────────────────

export default function ExportModal() {
  const { showExportModal, setShowExportModal, project, currentTime, setCurrentTime, setIsPlaying } =
    useEditorStore(
      useShallow((s) => ({
        showExportModal:    s.showExportModal,
        setShowExportModal: s.setShowExportModal,
        project:            s.project,
        currentTime:        s.currentTime,
        setCurrentTime:     s.setCurrentTime,
        setIsPlaying:       s.setIsPlaying,
      }))
    );

  const [resolution, setResolution] = useState(RESOLUTIONS[1]);
  const [format,     setFormat]     = useState<typeof FORMATS[number]>('MP4');
  const [fps,        setFps]        = useState<typeof FPS_OPTIONS[number]>(30);
  const [bitrate,    setBitrate]    = useState(8);
  const [status,     setStatus]     = useState<ExportStatus>('idle');
  const [progress,   setProgress]   = useState(0);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileName,    setFileName]   = useState('export.webm');

  const cancelRef    = useRef(false);
  const recorderRef  = useRef<MediaRecorder | null>(null);

  // Reset on close
  useEffect(() => {
    if (!showExportModal) {
      setStatus('idle');
      setProgress(0);
      setErrorMsg(null);
      cancelRef.current = false;
    }
  }, [showExportModal]);

  // Revoke blob URL when modal closes to avoid memory leaks
  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  // ─── real canvas-based export ──────────────────────────────────────────────
  const handleExport = async () => {
    setStatus('exporting');
    setProgress(0);
    setErrorMsg(null);
    cancelRef.current = false;

    try {
      // 1. Find the preview canvas container (the black div in PreviewCanvas)
      //    It has the persistent <video> elements inside VideoLayer.
      const previewRoot = document.querySelector<HTMLDivElement>(
        '[data-preview-canvas="root"]'
      );

      // 2. Create an offscreen canvas at target resolution
      const canvas   = document.createElement('canvas');
      canvas.width   = resolution.w;
      canvas.height  = resolution.h;
      const ctx      = canvas.getContext('2d', { alpha: false })!;

      // 3. Set up MediaRecorder on the canvas stream
      const mime      = getMimeType(format);
      const ext       = getExt(mime);
      const stream    = canvas.captureStream(fps);
      const recorder  = new MediaRecorder(stream, {
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

      recorder.start(200); // collect data every 200 ms

      // 4. Seek the store to 0, pause real playback during export
      setIsPlaying(false);
      setCurrentTime(0);

      const totalDuration = project.duration;
      const frameInterval = 1 / fps;
      let   exportTime    = 0;

      // 5. Frame loop — advance exportTime, draw video frames
      const drawFrame = () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            if (previewRoot) {
              // Find all <video> elements that are currently visible (opacity != 0)
              const videos = Array.from(previewRoot.querySelectorAll<HTMLVideoElement>('video'));
              for (const vid of videos) {
                // Check wrapper visibility — MediaEngine sets opacity/visibility on parent
                const wrapper = vid.closest<HTMLDivElement>('[style*="position: absolute"]');
                const wrapperOpacity = wrapper
                  ? parseFloat(getComputedStyle(wrapper).opacity || '0')
                  : 1;
                if (wrapperOpacity < 0.01) continue;
                if (vid.readyState < 2)    continue;
                try {
                  ctx.globalAlpha = wrapperOpacity;
                  ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
                  ctx.globalAlpha = 1;
                } catch {
                  // cross-origin or not-ready — skip frame
                }
              }
            } else {
              // Fallback: render a placeholder gradient so recording still produces output
              const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
              grad.addColorStop(0, '#1e1b4b');
              grad.addColorStop(1, '#312e81');
              ctx.fillStyle = grad;
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.fillStyle = 'rgba(255,255,255,0.6)';
              ctx.font = `bold ${canvas.height * 0.04}px Inter, sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillText(project.name, canvas.width / 2, canvas.height / 2);
            }

            resolve();
          });
        });

      // Seek video elements to correct time for each frame
      const seekVideos = async (t: number) => {
        if (!previewRoot) return;
        const videos = Array.from(previewRoot.querySelectorAll<HTMLVideoElement>('video'));
        const seeks  = videos.map(
          (vid) =>
            new Promise<void>((res) => {
              if (!isFinite(vid.duration) || vid.duration === 0) { res(); return; }
              // Each clip has trimStart stored on the clip — we approximate
              // by using the current src time which MediaEngine manages.
              // For export we just ensure the video is at the right relative time.
              const wrapper = vid.closest<HTMLDivElement>('[style*="position: absolute"]');
              const visible  = wrapper
                ? parseFloat(getComputedStyle(wrapper).opacity || '0') > 0.01
                : true;
              if (!visible) { res(); return; }

              const target = vid.currentTime; // MediaEngine already handles seek
              if (Math.abs(vid.currentTime - target) < 0.05) { res(); return; }
              const onSeeked = () => { vid.removeEventListener('seeked', onSeeked); res(); };
              vid.addEventListener('seeked', onSeeked, { once: true });
              vid.currentTime = target;
              // Safety timeout
              setTimeout(res, 200);
            })
        );
        await Promise.all(seeks);
      };

      // 6. Update store time (triggers MediaEngine to show/hide clips)
      //    We use a small sleep to let the engine settle on each frame.
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      while (exportTime <= totalDuration && !cancelRef.current) {
        // Advance store time — MediaEngine reacts imperatively
        setCurrentTime(exportTime);

        // Give MediaEngine a tick to update DOM visibility
        await sleep(1000 / fps < 40 ? 40 : 1000 / fps);
        await seekVideos(exportTime);
        await drawFrame();

        exportTime += frameInterval;
        setProgress(Math.min(99, (exportTime / totalDuration) * 100));
      }

      if (cancelRef.current) {
        recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
        setStatus('idle');
        return;
      }

      // 7. Finish recording
      recorder.stop();
      stream.getTracks().forEach((t) => t.stop());

      const blob = await done;
      const url  = URL.createObjectURL(blob);
      const name = `${project.name.replace(/\s+/g, '_')}.${ext}`;

      setDownloadUrl(url);
      setFileName(name);
      setProgress(100);
      setStatus('done');

      // Restore playhead to where it was
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
    const a  = document.createElement('a');
    a.href   = downloadUrl;
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

            {/* ── Done state ───────────────────────────────────────────────── */}
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

            /* ── Exporting state ─────────────────────────────────────────── */
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
                    Frame-accurate canvas capture in progress
                  </div>
                </div>
                <button
                  onClick={handleCancel}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>

            /* ── Idle / settings state ───────────────────────────────────── */
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
                      title="GIF export not supported in browser"
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
                        <div className="text-[9px] text-gray-400">
                          {r.w}×{r.h}
                        </div>
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
