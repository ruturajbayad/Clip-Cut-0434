import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeftRight, Search, X } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';

const TRANSITIONS = [
  { id: 'fade', name: 'Fade', duration: '0.5s', gradient: 'from-white to-gray-200' },
  { id: 'dissolve', name: 'Dissolve', duration: '0.8s', gradient: 'from-indigo-100 to-purple-100' },
  { id: 'blur', name: 'Blur Fade', duration: '0.4s', gradient: 'from-blue-100 to-cyan-100' },
  { id: 'zoom', name: 'Zoom In', duration: '0.6s', gradient: 'from-emerald-100 to-teal-100' },
  { id: 'slide-left', name: 'Slide Left', duration: '0.5s', gradient: 'from-orange-100 to-amber-100' },
  { id: 'slide-right', name: 'Slide Right', duration: '0.5s', gradient: 'from-pink-100 to-rose-100' },
  { id: 'whip', name: 'Whip Pan', duration: '0.3s', gradient: 'from-violet-100 to-purple-100' },
  { id: 'glitch', name: 'Glitch', duration: '0.4s', gradient: 'from-red-100 to-pink-100' },
  { id: 'spin', name: 'Spin', duration: '0.5s', gradient: 'from-yellow-100 to-orange-100' },
  { id: 'cinematic', name: 'Cinematic Cut', duration: '1.0s', gradient: 'from-gray-100 to-gray-200' },
  { id: 'lightleak', name: 'Light Leak', duration: '0.7s', gradient: 'from-amber-100 to-yellow-100' },
  { id: 'page-turn', name: 'Page Turn', duration: '0.8s', gradient: 'from-sky-100 to-blue-100' },
];

export default function TransitionPicker() {
  const { showTransitionPicker, transitionPickerPosition, setShowTransitionPicker, updateClip, transitionPickerClipId } = useEditorStore(useShallow((s) => ({
    showTransitionPicker: s.showTransitionPicker,
    transitionPickerPosition: s.transitionPickerPosition,
    setShowTransitionPicker: s.setShowTransitionPicker,
    updateClip: s.updateClip,
    transitionPickerClipId: s.transitionPickerClipId,
  })));
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!showTransitionPicker || !transitionPickerPosition) return null;

  const filtered = TRANSITIONS.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

  const handleSelect = (id: string) => {
    setSelected(id);
    if (transitionPickerClipId) {
      updateClip(transitionPickerClipId, { transition: id });
    }
    setTimeout(() => setShowTransitionPicker(false), 300);
  };

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={() => setShowTransitionPicker(false)} />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: -8 }}
        className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden"
        style={{
          left: Math.min(transitionPickerPosition.x - 150, window.innerWidth - 320),
          top: transitionPickerPosition.y + 12,
          width: 300,
          maxHeight: 400,
        }}
      >
        <div className="p-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowLeftRight size={13} className="text-indigo-500" />
            <span className="text-[12px] font-semibold text-gray-800">Transitions</span>
          </div>
          <button
            onClick={() => setShowTransitionPicker(false)}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <X size={13} />
          </button>
        </div>
        <div className="p-2 border-b border-gray-100">
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transitions..."
              className="w-full text-xs pl-7 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-indigo-400"
            />
          </div>
        </div>
        <div className="overflow-y-auto p-2 grid grid-cols-3 gap-2" style={{ maxHeight: 300 }}>
          {filtered.map((tr) => (
            <motion.button
              key={tr.id}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleSelect(tr.id)}
              onHoverStart={() => setHoveredId(tr.id)}
              onHoverEnd={() => setHoveredId(null)}
              className={`rounded-lg overflow-hidden border-2 transition-all ${
                selected === tr.id
                  ? 'border-indigo-500 shadow-md shadow-indigo-100'
                  : hoveredId === tr.id
                  ? 'border-indigo-300'
                  : 'border-transparent'
              }`}
            >
              <div className={`h-12 bg-gradient-to-br ${tr.gradient} flex items-center justify-center`}>
                <motion.div
                  animate={hoveredId === tr.id ? { x: [0, 4, -4, 0] } : { x: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <ArrowLeftRight size={14} className="text-gray-500" />
                </motion.div>
              </div>
              <div className="p-1 bg-white">
                <div className="text-[9px] font-medium text-gray-700 text-center leading-tight">{tr.name}</div>
                <div className="text-[8px] text-gray-400 text-center">{tr.duration}</div>
              </div>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </>
  );
}
