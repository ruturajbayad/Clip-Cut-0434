import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Move, Sun,
  Droplets, ChevronDown, ChevronRight, Diamond, Type, Sliders, X,
  Gauge, Sparkles, Image as ImageIcon, Layers,
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';

const ACCENT = '#3b82f6';

function Section({ title, icon: Icon, defaultOpen = true, children }: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
      >
        <Icon size={12} className="text-gray-400" />
        <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide flex-1">{title}</span>
        {open ? <ChevronDown size={11} className="text-gray-400" /> : <ChevronRight size={11} className="text-gray-400" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-2.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SliderProp({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500">{label}</span>
        <span className="text-[10px] font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">
          {value.toFixed(step < 1 ? 2 : 0)}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, ${ACCENT} 0%, ${ACCENT} ${pct}%, #E5E7EB ${pct}%, #E5E7EB 100%)`,
        }}
      />
    </div>
  );
}

function NumberInput({ label, value, onChange, unit = '' }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-6">{label}</span>
      <div className="flex-1 flex items-center border border-gray-200 rounded overflow-hidden">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="flex-1 text-[11px] px-2 py-1 outline-none bg-white text-gray-800 w-0 min-w-0"
        />
        {unit && <span className="text-[10px] text-gray-400 pr-2 bg-white">{unit}</span>}
      </div>
    </div>
  );
}

// ── Keyframe row ──────────────────────────────────────────────────────────────
function KeyframeRow({
  label, propNames, currentValue, clipId, currentTime,
}: {
  label: string;
  propNames: string[];
  currentValue: number;
  clipId: string;
  currentTime: number;
}) {
  const { project, addKeyframe, removeKeyframe } = useEditorStore(useShallow((s) => ({
    project: s.project,
    addKeyframe: s.addKeyframe,
    removeKeyframe: s.removeKeyframe,
  })));

  const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clip) return null;

  const hasKfAtTime = (prop: string) =>
    (clip.keyframes || []).some((k) => k.property === prop && Math.abs(k.time - currentTime) < 0.05);

  const anyActive = propNames.some(hasKfAtTime);
  const totalKfs  = propNames.reduce(
    (n, p) => n + (clip.keyframes || []).filter((k) => k.property === p).length, 0
  );

  const handleToggle = () => {
    if (anyActive) {
      propNames.forEach((prop) => {
        (clip.keyframes || [])
          .filter((k) => k.property === prop && Math.abs(k.time - currentTime) < 0.05)
          .forEach((k) => removeKeyframe(clipId, k.id));
      });
    } else {
      propNames.forEach((prop) => {
        const val = (clip as Record<string, unknown>)[prop];
        addKeyframe(clipId, prop, currentTime, typeof val === 'number' ? val : currentValue);
      });
    }
  };

  return (
    <div className="flex items-center justify-between py-1 border border-gray-100 rounded px-2 hover:bg-gray-50 transition-colors">
      <span className="text-[11px] text-gray-600">{label}</span>
      <div className="flex items-center gap-1.5">
        {totalKfs > 0 && (
          <span className="text-[9px] font-medium" style={{ color: ACCENT }}>{totalKfs} kf</span>
        )}
        <button
          title={anyActive ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'}
          onClick={handleToggle}
          className="w-4 h-4 border-2 rounded-sm rotate-45 transition-colors"
          style={{
            background: anyActive ? ACCENT : 'transparent',
            borderColor: anyActive ? ACCENT : '#d1d5db',
          }}
        />
      </div>
    </div>
  );
}

// ── Entry transition picker ───────────────────────────────────────────────────
const ENTRY_TRANSITIONS = [
  { value: 'none',       label: 'None' },
  { value: 'fade-in',    label: 'Fade In' },
  { value: 'slide-up',   label: 'Slide Up' },
  { value: 'slide-left', label: 'Slide Left' },
  { value: 'zoom-in',    label: 'Zoom In' },
] as const;

export default function RightPanel() {
  const { selectedClipId, project, updateClip, updateClipSpeed } = useEditorStore(useShallow((s) => ({
    selectedClipId: s.selectedClipId,
    project: s.project,
    updateClip: s.updateClip,
    updateClipSpeed: s.updateClipSpeed,
  })));
  const currentTime = useEditorStore.getState().currentTime;

  const selectedClip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId);

  if (!selectedClip) {
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Inspector</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 p-6">
          <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center">
            <Sliders size={20} className="opacity-40" />
          </div>
          <div className="text-center">
            <div className="text-xs font-medium text-gray-500 mb-1">No clip selected</div>
            <div className="text-[11px] text-gray-400">Click a clip in the timeline to edit its properties</div>
          </div>
        </div>
      </div>
    );
  }

  const update = (key: string, value: number | string) => {
    updateClip(selectedClip.id, { [key]: value });
  };

  const keyframeCount = (selectedClip.keyframes || []).length;

  const clipDotColor =
    selectedClip.type === 'video' ? '#3b82f6' :
    selectedClip.type === 'audio' ? '#34D399' :
    selectedClip.type === 'text'  ? '#FBBF24' :
    selectedClip.type === 'image' ? '#06b6d4' : '#F472B6';

  return (
    <div className="flex flex-col h-full bg-white overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 sticky top-0 bg-white z-10">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: clipDotColor }} />
        <div>
          <h2 className="text-[11px] font-semibold text-gray-800 truncate max-w-40">{selectedClip.name}</h2>
          <div className="text-[10px] text-gray-400 capitalize">{selectedClip.type} clip</div>
        </div>
      </div>

      {/* ── Transform (video + text + image) ── */}
      {(selectedClip.type === 'video' || selectedClip.type === 'text' || selectedClip.type === 'image') && (
        <Section title="Transform" icon={Move}>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput label="X" value={selectedClip.x || 0} onChange={(v) => update('x', v)} unit="%" />
            <NumberInput label="Y" value={selectedClip.y || 0} onChange={(v) => update('y', v)} unit="%" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput label="W" value={(selectedClip.scaleX || 1) * 100} onChange={(v) => update('scaleX', v / 100)} unit="%" />
            <NumberInput label="H" value={(selectedClip.scaleY || 1) * 100} onChange={(v) => update('scaleY', v / 100)} unit="%" />
          </div>
          <NumberInput label="R" value={selectedClip.rotation || 0} onChange={(v) => update('rotation', v)} unit="°" />
          <SliderProp
            label="Opacity"
            value={(selectedClip.opacity || 1) * 100}
            min={0} max={100} step={1} unit="%"
            onChange={(v) => update('opacity', v / 100)}
          />
        </Section>
      )}

      {/* ── Image-specific properties ── */}
      {selectedClip.type === 'image' && (
        <Section title="Image" icon={ImageIcon}>
          <div>
            <label className="text-[10px] text-gray-500 mb-1 block">Blend Mode</label>
            <select
              value={selectedClip.blendMode || 'normal'}
              onChange={(e) => update('blendMode', e.target.value)}
              className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded outline-none bg-white text-gray-800"
              style={{ outlineColor: ACCENT }}
            >
              {['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'hard-light', 'soft-light', 'difference'].map((m) => (
                <option key={m} value={m}>{m.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>
              ))}
            </select>
          </div>
          <SliderProp label="Brightness" value={selectedClip.brightness ?? 100} min={0} max={200} step={1} unit="%" onChange={(v) => update('brightness', v)} />
          <SliderProp label="Contrast"   value={selectedClip.contrast   ?? 100} min={0} max={200} step={1} unit="%" onChange={(v) => update('contrast',   v)} />
          <SliderProp label="Saturation" value={selectedClip.saturation ?? 100} min={0} max={200} step={1} unit="%" onChange={(v) => update('saturation', v)} />
        </Section>
      )}

      {/* ── Video speed ── */}
      {selectedClip.type === 'video' && (
        <Section title="Speed" icon={Gauge}>
          <SliderProp
            label="Playback Speed"
            value={selectedClip.speed ?? 1}
            min={0.25}
            max={3}
            step={0.25}
            unit="x"
            onChange={(v) => updateClipSpeed(selectedClip.id, v)}
          />
          <div className="flex gap-1 flex-wrap">
            {[0.25, 0.5, 1, 1.5, 2, 3].map((v) => (
              <button
                key={v}
                onClick={() => updateClipSpeed(selectedClip.id, v)}
                className="px-2 py-0.5 rounded text-[10px] border transition-colors font-mono"
                style={{
                  borderColor: (selectedClip.speed ?? 1) === v ? ACCENT : '#e5e7eb',
                  color: (selectedClip.speed ?? 1) === v ? ACCENT : '#6b7280',
                  background: (selectedClip.speed ?? 1) === v ? `${ACCENT}10` : 'transparent',
                }}
              >
                {v}x
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* ── Entry Transition (video + image + text) ── */}
      {(selectedClip.type === 'video' || selectedClip.type === 'image' || selectedClip.type === 'text') && (
        <Section title="Entry Transition" icon={Sparkles} defaultOpen={false}>
          <div className="grid grid-cols-2 gap-1.5">
            {ENTRY_TRANSITIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => update('entryTransition', value)}
                className="px-2 py-1.5 rounded text-[10px] border transition-colors text-center"
                style={{
                  borderColor: (selectedClip.entryTransition ?? 'none') === value ? ACCENT : '#e5e7eb',
                  color: (selectedClip.entryTransition ?? 'none') === value ? ACCENT : '#6b7280',
                  background: (selectedClip.entryTransition ?? 'none') === value ? `${ACCENT}10` : 'transparent',
                  fontWeight: (selectedClip.entryTransition ?? 'none') === value ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-gray-400 mt-1">Applied at the start of this clip's playback</div>
        </Section>
      )}

      {/* ── Text properties ── */}
      {selectedClip.type === 'text' && (
        <Section title="Text" icon={Type}>
          <div className="space-y-2.5">
            {/* Content */}
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Content</label>
              <textarea
                value={selectedClip.text || ''}
                onChange={(e) => update('text', e.target.value)}
                rows={2}
                className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded outline-none resize-none text-gray-800"
                style={{ outlineColor: ACCENT }}
              />
            </div>

            {/* Font + Size */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Font</label>
                <select
                  value={selectedClip.fontFamily || 'Inter'}
                  onChange={(e) => update('fontFamily', e.target.value)}
                  className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded outline-none bg-white"
                  style={{ outlineColor: ACCENT }}
                >
                  {['Inter', 'Georgia', 'Playfair Display', 'Space Grotesk', 'Raleway', 'Merriweather'].map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Size</label>
                <input
                  type="number"
                  value={selectedClip.fontSize || 72}
                  onChange={(e) => update('fontSize', parseInt(e.target.value) || 72)}
                  className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded outline-none bg-white text-gray-800"
                  min={8} max={400}
                  style={{ outlineColor: ACCENT }}
                />
              </div>
            </div>

            {/* Bold / Italic / Uppercase row */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => update('fontWeight', selectedClip.fontWeight === 'bold' ? 'normal' : 'bold')}
                className="flex-1 py-1 rounded border text-xs font-bold transition-colors"
                style={{
                  borderColor: (selectedClip.fontWeight ?? 'bold') === 'bold' ? ACCENT : '#e5e7eb',
                  background: (selectedClip.fontWeight ?? 'bold') === 'bold' ? `${ACCENT}15` : 'transparent',
                  color: (selectedClip.fontWeight ?? 'bold') === 'bold' ? ACCENT : '#6b7280',
                }}
              >B</button>
              <button
                onClick={() => update('fontStyle', selectedClip.fontStyle === 'italic' ? 'normal' : 'italic')}
                className="flex-1 py-1 rounded border text-xs italic transition-colors"
                style={{
                  borderColor: selectedClip.fontStyle === 'italic' ? ACCENT : '#e5e7eb',
                  background: selectedClip.fontStyle === 'italic' ? `${ACCENT}15` : 'transparent',
                  color: selectedClip.fontStyle === 'italic' ? ACCENT : '#6b7280',
                }}
              >I</button>
              <button
                onClick={() => update('textUppercase', !selectedClip.textUppercase)}
                className="flex-1 py-1 rounded border text-[10px] font-bold transition-colors"
                style={{
                  borderColor: selectedClip.textUppercase ? ACCENT : '#e5e7eb',
                  background: selectedClip.textUppercase ? `${ACCENT}15` : 'transparent',
                  color: selectedClip.textUppercase ? ACCENT : '#6b7280',
                }}
              >AA</button>
            </div>

            {/* Alignment */}
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Alignment</label>
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as const).map((align) => (
                  <button
                    key={align}
                    onClick={() => update('textAlign', align)}
                    className="flex-1 py-1 rounded border text-[10px] transition-colors capitalize"
                    style={{
                      borderColor: (selectedClip.textAlign ?? 'center') === align ? ACCENT : '#e5e7eb',
                      background: (selectedClip.textAlign ?? 'center') === align ? `${ACCENT}15` : 'transparent',
                      color: (selectedClip.textAlign ?? 'center') === align ? ACCENT : '#6b7280',
                    }}
                  >{align === 'left' ? '⬅' : align === 'center' ? '↔' : '➡'}</button>
                ))}
              </div>
            </div>

            {/* Color + Background color */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Text Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedClip.color || '#FFFFFF'}
                    onChange={(e) => update('color', e.target.value)}
                    className="w-7 h-7 rounded border border-gray-200 cursor-pointer flex-shrink-0"
                  />
                  <span className="text-[10px] font-mono text-gray-600">{selectedClip.color || '#FFFFFF'}</span>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Background</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedClip.textBackground || '#00000000'}
                    onChange={(e) => update('textBackground', e.target.value)}
                    className="w-7 h-7 rounded border border-gray-200 cursor-pointer flex-shrink-0"
                  />
                  <button
                    onClick={() => update('textBackground', '')}
                    className="text-[9px] text-gray-400 hover:text-red-400 transition-colors"
                  >clear</button>
                </div>
              </div>
            </div>

            {/* Outline */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Outline Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedClip.textOutline || '#000000'}
                    onChange={(e) => update('textOutline', e.target.value)}
                    className="w-7 h-7 rounded border border-gray-200 cursor-pointer flex-shrink-0"
                  />
                  <button
                    onClick={() => { update('textOutline', ''); update('textOutlineWidth', 0); }}
                    className="text-[9px] text-gray-400 hover:text-red-400 transition-colors"
                  >clear</button>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Outline Width</label>
                <input
                  type="number"
                  value={selectedClip.textOutlineWidth || 0}
                  onChange={(e) => update('textOutlineWidth', parseFloat(e.target.value) || 0)}
                  className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded outline-none bg-white text-gray-800"
                  min={0} max={20} step={0.5}
                  style={{ outlineColor: ACCENT }}
                />
              </div>
            </div>

            {/* Shadow preset */}
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Shadow</label>
              <div className="flex gap-1 flex-wrap">
                {[
                  { key: 'none', label: 'None' },
                  { key: 'soft', label: 'Soft' },
                  { key: 'hard', label: 'Hard' },
                  { key: 'glow', label: 'Glow' },
                  { key: 'neon', label: 'Neon' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => update('textShadow', key)}
                    className="px-2 py-0.5 rounded text-[10px] border transition-colors"
                    style={{
                      borderColor: (selectedClip.textShadow ?? 'soft') === key ? ACCENT : '#e5e7eb',
                      color: (selectedClip.textShadow ?? 'soft') === key ? ACCENT : '#6b7280',
                      background: (selectedClip.textShadow ?? 'soft') === key ? `${ACCENT}10` : 'transparent',
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>

            {/* Letter spacing + Line height */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Letter Spacing</label>
                <input
                  type="number"
                  value={selectedClip.letterSpacing || 0}
                  onChange={(e) => update('letterSpacing', parseFloat(e.target.value) || 0)}
                  className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded outline-none bg-white text-gray-800"
                  min={-10} max={50} step={0.5}
                  style={{ outlineColor: ACCENT }}
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Line Height</label>
                <input
                  type="number"
                  value={selectedClip.lineHeight || 1.2}
                  onChange={(e) => update('lineHeight', parseFloat(e.target.value) || 1.2)}
                  className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded outline-none bg-white text-gray-800"
                  min={0.5} max={4} step={0.1}
                  style={{ outlineColor: ACCENT }}
                />
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* ── Video adjustments ── */}
      {selectedClip.type === 'video' && (
        <Section title="Adjustments" icon={Sun}>
          <SliderProp label="Brightness" value={selectedClip.brightness ?? 100} min={0} max={200} step={1} unit="%" onChange={(v) => update('brightness', v)} />
          <SliderProp label="Contrast"   value={selectedClip.contrast   ?? 100} min={0} max={200} step={1} unit="%" onChange={(v) => update('contrast',   v)} />
          <SliderProp label="Saturation" value={selectedClip.saturation ?? 100} min={0} max={200} step={1} unit="%" onChange={(v) => update('saturation', v)} />
          <SliderProp label="Blur"       value={selectedClip.blur       ??   0} min={0} max={20}  step={0.5} unit="px" onChange={(v) => update('blur', v)} />
        </Section>
      )}

      {/* ── Audio ── */}
      {selectedClip.type === 'audio' && (
        <Section title="Audio" icon={Droplets}>
          <SliderProp label="Volume" value={(selectedClip.volume ?? 1) * 100} min={0} max={200} step={1} unit="%" onChange={(v) => update('volume', v / 100)} />
          <div className="text-[10px] text-gray-400 mt-1">Fade In / Out coming soon</div>
        </Section>
      )}

      {/* ── Keyframes ── */}
      {(selectedClip.type === 'video' || selectedClip.type === 'text' || selectedClip.type === 'image') && (
        <Section title="Keyframes" icon={Diamond} defaultOpen={false}>
          <div className="text-[10px] text-gray-400 mb-2">
            Playhead @ <span className="font-mono" style={{ color: ACCENT }}>{currentTime.toFixed(2)}s</span>
            {keyframeCount > 0 && (
              <span className="ml-2 text-gray-500">· {keyframeCount} total</span>
            )}
          </div>

          <div className="space-y-1.5">
            <KeyframeRow label="Position" propNames={['x', 'y']} currentValue={selectedClip.x ?? 0.5} clipId={selectedClip.id} currentTime={currentTime} />
            <KeyframeRow label="Scale" propNames={['scaleX', 'scaleY']} currentValue={selectedClip.scaleX ?? 1} clipId={selectedClip.id} currentTime={currentTime} />
            <KeyframeRow label="Rotation" propNames={['rotation']} currentValue={selectedClip.rotation ?? 0} clipId={selectedClip.id} currentTime={currentTime} />
            <KeyframeRow label="Opacity" propNames={['opacity']} currentValue={selectedClip.opacity ?? 1} clipId={selectedClip.id} currentTime={currentTime} />
          </div>

          {keyframeCount > 0 && (
            <div className="mt-3 space-y-1">
              <div className="text-[10px] text-gray-500 font-medium mb-1">All keyframes</div>
              {(selectedClip.keyframes || []).map((kf) => (
                <div key={kf.id} className="flex items-center justify-between text-[10px] bg-gray-50 rounded px-2 py-1">
                  <span className="font-mono" style={{ color: ACCENT }}>{kf.time.toFixed(2)}s</span>
                  <span className="text-gray-500 mx-2">{kf.property}</span>
                  <span className="font-mono text-gray-700 flex-1">{typeof kf.value === 'number' ? kf.value.toFixed(3) : kf.value}</span>
                  <button
                    onClick={() => useEditorStore.getState().removeKeyframe(selectedClip.id, kf.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors ml-1"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2 p-2 bg-gray-50 rounded text-[10px] text-gray-500 text-center">
            Click ◆ to add/remove keyframe at playhead
          </div>
        </Section>
      )}

      {/* ── Layers label for image clips ── */}
      {selectedClip.type === 'image' && (
        <Section title="Layer" icon={Layers} defaultOpen={false}>
          <div className="text-[10px] text-gray-400">
            Reorder in timeline: use ↑↓ arrows on the track panel to change Z-order.
          </div>
        </Section>
      )}
    </div>
  );
}
