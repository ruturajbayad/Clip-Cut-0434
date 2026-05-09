import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Settings2, CheckCircle, Loader2 } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';

const RESOLUTIONS = [
  { label: '720p HD', value: '720p', w: 1280, h: 720 },
  { label: '1080p FHD', value: '1080p', w: 1920, h: 1080 },
  { label: '4K UHD', value: '4k', w: 3840, h: 2160 },
];

const FORMATS = ['MP4', 'WebM', 'GIF'];
const FPS_OPTIONS = [24, 30, 60];

type ExportStatus = 'idle' | 'exporting' | 'done';

export default function ExportModal() {
  const { showExportModal, setShowExportModal, project } = useEditorStore(useShallow((s) => ({
    showExportModal: s.showExportModal,
    setShowExportModal: s.setShowExportModal,
    project: s.project,
  })));
  const [resolution, setResolution] = useState(RESOLUTIONS[1]);
  const [format, setFormat] = useState('MP4');
  const [fps, setFps] = useState(30);
  const [bitrate, setBitrate] = useState(8);
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!showExportModal) {
      setStatus('idle');
      setProgress(0);
    }
  }, [showExportModal]);

  const handleExport = () => {
    setStatus('exporting');
    setProgress(0);
    // Simulated export progress
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(interval);
          setStatus('done');
          return 100;
        }
        return p + 2 + Math.random() * 3;
      });
    }, 80);
  };

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
                <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
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
                  <div className="text-sm text-gray-500 mt-1">Your video is ready to download</div>
                </div>
                <div className="flex items-center gap-2 w-full">
                  <button
                    onClick={() => setShowExportModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Close
                  </button>
                  <button className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors">
                    Download
                  </button>
                </div>
              </div>
            ) : status === 'exporting' ? (
              <div className="p-8 flex flex-col items-center gap-4 text-center">
                <div className="relative">
                  <Loader2 size={40} className="text-indigo-500 animate-spin" />
                </div>
                <div>
                  <div className="font-semibold text-gray-800">Exporting...</div>
                  <div className="text-xs text-gray-500 mt-1">Processing frames with ffmpeg.wasm</div>
                </div>
                <div className="w-full">
                  <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                    <span>Progress</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-indigo-600 rounded-full"
                      style={{ width: `${progress}%` }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1.5">
                    Est. {Math.round((100 - progress) / 20)}s remaining
                  </div>
                </div>
                <button
                  onClick={() => setStatus('idle')}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                {/* Format */}
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Format</label>
                  <div className="flex gap-2">
                    {FORMATS.map((f) => (
                      <button
                        key={f}
                        onClick={() => setFormat(f)}
                        className={`flex-1 py-2 text-xs font-medium rounded-lg border-2 transition-all ${
                          format === f
                            ? 'border-indigo-500 text-indigo-600 bg-indigo-50'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Resolution */}
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Resolution</label>
                  <div className="grid grid-cols-3 gap-2">
                    {RESOLUTIONS.map((r) => (
                      <button
                        key={r.value}
                        onClick={() => setResolution(r)}
                        className={`py-2 text-xs font-medium rounded-lg border-2 transition-all ${
                          resolution.value === r.value
                            ? 'border-indigo-500 text-indigo-600 bg-indigo-50'
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
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Frame Rate</label>
                    <div className="flex gap-1">
                      {FPS_OPTIONS.map((f) => (
                        <button
                          key={f}
                          onClick={() => setFps(f)}
                          className={`flex-1 py-1.5 text-xs font-medium rounded-lg border-2 transition-all ${
                            fps === f
                              ? 'border-indigo-500 text-indigo-600 bg-indigo-50'
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
                      type="range" min={1} max={50} step={1} value={bitrate}
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
                    <span className="font-medium text-gray-700">{project.name}.{format.toLowerCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Duration</span>
                    <span className="font-medium text-gray-700">{project.duration}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Est. size</span>
                    <span className="font-medium text-gray-700">~{Math.round(bitrate * project.duration / 8)} MB</span>
                  </div>
                </div>

                <button
                  onClick={handleExport}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
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
