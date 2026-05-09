import { useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AnimatePresence } from 'framer-motion';
import Navbar from '../components/editor/Navbar';
import LeftSidebar from '../components/editor/LeftSidebar';
import PreviewCanvas from '../components/editor/PreviewCanvas';
import RightPanel from '../components/editor/RightPanel';
import Timeline from '../components/editor/Timeline';
import TransportBar from '../components/editor/TransportBar';
import TransitionPicker from '../components/editor/TransitionPicker';
import ExportModal from '../components/editor/ExportModal';
import { useEditorStore } from '../store/editorStore';

export default function Index() {
  const {
    setIsPlaying, isPlaying, undo, redo,
    setCurrentTime, currentTime, selectedClipId, removeClip
  } = useEditorStore(useShallow((s) => ({
    setIsPlaying: s.setIsPlaying,
    isPlaying: s.isPlaying,
    undo: s.undo,
    redo: s.redo,
    setCurrentTime: s.setCurrentTime,
    currentTime: s.currentTime,
    selectedClipId: s.selectedClipId,
    removeClip: s.removeClip,
  })));

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        setIsPlaying(!isPlaying);
        break;
      case 'KeyZ':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          e.shiftKey ? redo() : undo();
        }
        break;
      case 'KeyY':
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); redo(); }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        setCurrentTime(Math.max(0, currentTime - (e.shiftKey ? 1 : 1 / 30)));
        break;
      case 'ArrowRight':
        e.preventDefault();
        setCurrentTime(currentTime + (e.shiftKey ? 1 : 1 / 30));
        break;
      case 'Delete':
      case 'Backspace':
        if (selectedClipId) { e.preventDefault(); removeClip(selectedClipId); }
        break;
    }
  }, [isPlaying, currentTime, selectedClipId, setIsPlaying, setCurrentTime, undo, redo, removeClip]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden select-none">
      {/* Top Navbar */}
      <Navbar />

      {/* Main workspace */}
      <div className="flex flex-1 min-h-0">
        {/* Left Sidebar */}
        <div className="flex-shrink-0 border-r border-gray-200 bg-white" style={{ width: 256 }}>
          <LeftSidebar />
        </div>

        {/* Center: Preview */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0">
            <PreviewCanvas />
          </div>
        </div>

        {/* Right Panel */}
        <div className="flex-shrink-0 border-l border-gray-200 bg-white" style={{ width: 256 }}>
          <RightPanel />
        </div>
      </div>

      {/* Transport bar above timeline */}
      <TransportBar />

      {/* Bottom Timeline — height is self-managed (resizable panel) */}
      <div className="flex-shrink-0">
        <Timeline />
      </div>

      {/* Overlays */}
      <AnimatePresence>
        <TransitionPicker />
      </AnimatePresence>
      <ExportModal />
    </div>
  );
}
