import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Undo2, Redo2, Download, Save, ChevronDown, Film
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';

export default function Navbar() {
  const {
    project, setShowExportModal, undo, redo,
    undoStack, redoStack, updateProject
  } = useEditorStore(useShallow((s) => ({
    project: s.project,
    setShowExportModal: s.setShowExportModal,
    undo: s.undo,
    redo: s.redo,
    undoStack: s.undoStack,
    redoStack: s.redoStack,
    updateProject: s.updateProject,
  })));

  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(project.name);

  return (
    <div className="h-12 flex items-center justify-between px-4 bg-white border-b border-gray-200 flex-shrink-0 z-50">
      {/* Left: Logo + Project */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Film size={14} className="text-white" />
          </div>
          <span className="font-semibold text-gray-900 text-sm">FrameForge</span>
        </div>
        <div className="w-px h-4 bg-gray-200" />
        {editingName ? (
          <input
            autoFocus
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onBlur={() => { updateProject({ name: tempName }); setEditingName(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { updateProject({ name: tempName }); setEditingName(false); }
              if (e.key === 'Escape') setEditingName(false);
            }}
            className="text-sm font-medium text-gray-800 bg-indigo-50 border border-indigo-300 rounded px-2 py-0.5 outline-none"
          />
        ) : (
          <button
            onClick={() => { setTempName(project.name); setEditingName(true); }}
            className="text-sm font-medium text-gray-800 hover:text-indigo-600 transition-colors px-1"
          >
            {project.name}
          </button>
        )}
        <div className="flex items-center gap-0.5">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={undo}
            disabled={!undoStack.length}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-30 transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={15} />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={redo}
            disabled={!redoStack.length}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-30 transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 size={15} />
          </motion.button>
        </div>
      </div>

      {/* Center: Project info pill */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="bg-gray-50 border border-gray-200 rounded px-2 py-1 font-medium text-gray-700">{project.fps} fps</span>
        <span className="bg-gray-50 border border-gray-200 rounded px-2 py-1 font-medium text-gray-700">{project.width}×{project.height}</span>
      </div>

      {/* Right: Save + Export */}
      <div className="flex items-center gap-2">
        <button className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors" title="Save">
          <Save size={15} />
        </button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setShowExportModal(true)}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm"
        >
          <Download size={13} />
          Export
          <ChevronDown size={12} />
        </motion.button>
      </div>
    </div>
  );
}
