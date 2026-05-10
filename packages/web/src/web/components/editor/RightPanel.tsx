import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Move, Sun,
  Droplets, ChevronDown, ChevronRight, Diamond, Type, Sliders, X, ImageIcon
} from 'lucide-react';
import { interpolateClip, useEditorStore, type Clip } from '../../store/editorStore';
import { useShallow } from 'zustand/react/shallow';

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

function SliderProp({ label, value, min, max, step = 1, unit = '', onChange, hasKeyframes = false }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  hasKeyframes?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500">{label}</span>
          {hasKeyframes && (
            <div className="w-2 h-2 rounded-sm rotate-45 bg-indigo-500" title="Has keyframes" />
          )}
        </div>
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
          background: `linear-gradient(to right, #6366F1 0%, #6366F1 ${((value - min) / (max - min)) * 100}%, #E5E7EB ${((value - min) / (max - min)) * 100}%, #E5E7EB 100%)`,
        }}
      />
    </div>
  );
}

function NumberInput({ label, value, onChange, unit = '', hasKeyframes = false }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  hasKeyframes?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 w-6">
        <span className="text-[10px] text-gray-500">{label}</span>
        {hasKeyframes && <div className="w-1.5 h-1.5 rounded-sm rotate-45 bg-indigo-500 flex-shrink-0" />}
      </div>
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

// ── Keyframe row for a single property ────────────────────────────────────────
function KeyframeRow({
  label,
  propNames,
  currentValue,
  clipId,
  currentTime,
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
    (n, p) => n + (clip.keyframes || []).filter((k) => k.property === p).length,
    0
  );

  const handleToggle = () => {
    if (anyActive) {
      propNames.forEach((prop) => {
        (clip.keyframes || [])
          .filter((k) => k.property === prop && Math.abs(k.time - currentTime) < 0.05)
          .forEach((k) => removeKeyframe(clipId, k.id));
      });
    } else {
      // Get the live (interpolated) value at currentTime for each prop
      const interp = interpolateClip(clip, currentTime);
      propNames.forEach((prop) => {
        const liveVal = (interp as Record<string, unknown>)[prop];
        const baseVal = (clip as Record<string, unknown>)[prop];
        const val = typeof liveVal === 'number' ? liveVal : (typeof baseVal === 'number' ? baseVal : currentValue);
        addKeyframe(clipId, prop, currentTime, val);
      });
    }
  };

  return (
    <div className="flex items-center justify-between py-1 border border-gray-100 rounded px-2 hover:bg-gray-50 transition-colors">
      <span className="text-[11px] text-gray-600">{label}</span>
      <div className="flex items-center gap-1.5">
        {totalKfs > 0 && (
          <span className="text-[9px] text-indigo-500 font-medium">{totalKfs} kf</span>
        )}
        <button
          title={anyActive ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'}
          onClick={handleToggle}
          className={`w-4 h-4 border-2 rounded-sm rotate-45 transition-colors ${
            anyActive
              ? 'bg-indigo-500 border-indigo-500'
              : 'border-gray-300 hover:border-indigo-500 bg-transparent'
          }`}
        />
      </div>
    </div>
  );
}

export default function RightPanel() {
  const { selectedClipId, project, updateClip, updateClipSpeed, addKeyframe, currentTime } = useEditorStore(useShallow((s) => ({
    selectedClipId: s.selectedClipId,
    project: s.project,
    updateClip: s.updateClip,
    updateClipSpeed: s.updateClipSpeed,
    addKeyframe: s.addKeyframe,
    currentTime: s.currentTime,
  })));

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

  // Get live interpolated values for display
  const interp = interpolateClip(selectedClip, currentTime);
  const live = { ...selectedClip, ...interp } as Clip & Record<string, unknown>;

  /** Check if a property has keyframes */
  const kf = (prop: string) => (selectedClip.keyframes || []).some((k) => k.property === prop);

  /**
   * Smart update: if the property has keyframes, write/update a keyframe at currentTime.
   * Otherwise update the base clip value.
   */
  const update = (key: string, value: number | string) => {
    if (typeof value === 'number' && kf(key)) {
      addKeyframe(selectedClip.id, key, currentTime, value);
    } else {
      updateClip(selectedClip.id, { [key]: value });
    }
  };

  const keyframeCount = (selectedClip.keyframes || []).length;

  return (
    <div className="flex flex-col h-full bg-white overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 sticky top-0 bg-white z-10">
        <div className="w-2 h-2 rounded-full" style={{
          backgroundColor: selectedClip.type === 'video' ? '#818CF8' : selectedClip.type === 'audio' ? '#34D399' : selectedClip.type === 'text' ? '#FBBF24' : selectedClip.type === 'image' ? '#22D3EE' : '#F472B6'
        }} />
        <div className="flex-1 min-w-0">
          <h2 className="text-[11px] font-semibold text-gray-800 truncate">{selectedClip.name}</h2>
          <div className="text-[10px] text-gray-400 capitalize">{selectedClip.type} clip · {selectedClip.duration.toFixed(1)}s</div>
        </div>
        {keyframeCount > 0 && (
          <div className="flex items-center gap-1 bg-indigo-50 rounded px-1.5 py-0.5">
            <Diamond size={9} className="text-indigo-500" />
            <span className="text-[9px] text-indigo-600 font-medium">{keyframeCount}</span>
          </div>
        )}
      </div>

      {/* Transform — video, text, and image clips */}
      {(selectedClip.type === 'video' || selectedClip.type === 'text' || selectedClip.type === 'image') && (
        <Section title="Transform" icon={Move}>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput
              label="X"
              value={Math.round(((live.x as number) ?? 0.5) * 100) / 100}
              onChange={(v) => update('x', Math.max(0, Math.min(1, v)))}
              unit="n"
              hasKeyframes={kf('x')}
            />
            <NumberInput
              label="Y"
              value={Math.round(((live.y as number) ?? 0.5) * 100) / 100}
              onChange={(v) => update('y', Math.max(0, Math.min(1, v)))}
              unit="n"
              hasKeyframes={kf('y')}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput
              label="W"
              value={Math.round(((live.scaleX as number) ?? 1) * 100)}
              onChange={(v) => update('scaleX', v / 100)}
              unit="%"
              hasKeyframes={kf('scaleX')}
            />
            <NumberInput
              label="H"
              value={Math.round(((live.scaleY as number) ?? 1) * 100)}
              onChange={(v) => update('scaleY', v / 100)}
              unit="%"
              hasKeyframes={kf('scaleY')}
            />
          </div>
          <SliderProp
            label="Rotation"
            value={Math.round((live.rotation as number) ?? 0)}
            min={-180} max={180} step={1} unit="°"
            onChange={(v) => update('rotation', v)}
            hasKeyframes={kf('rotation')}
          />
          <SliderProp
            label="Opacity"
            value={Math.round(((live.opacity as number) ?? 1) * 100)}
            min={0} max={100} step={1} unit="%"
            onChange={(v) => update('opacity', v / 100)}
            hasKeyframes={kf('opacity')}
          />
        </Section>
      )}

      {/* Text properties */}
      {selectedClip.type === 'text' && (
        <Section title="Text" icon={Type}>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Content</label>
              <textarea
                value={selectedClip.text || ''}
                onChange={(e) => update('text', e.target.value)}
                rows={2}
                className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded outline-none focus:border-indigo-400 resize-none text-gray-800"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Font</label>
              <select
                value={selectedClip.fontFamily || 'Inter'}
                onChange={(e) => update('fontFamily', e.target.value)}
                className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded outline-none focus:border-indigo-400 bg-white"
              >
                {['Inter', 'Georgia', 'Playfair Display', 'Space Grotesk', 'Raleway', 'Merriweather'].map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <SliderProp label="Size" value={selectedClip.fontSize || 72} min={12} max={200} step={1} unit="px" onChange={(v) => update('fontSize', v)} />
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={selectedClip.color || '#FFFFFF'}
                  onChange={(e) => update('color', e.target.value)}
                  className="w-7 h-7 rounded border border-gray-200 cursor-pointer"
                />
                <span className="text-[11px] font-mono text-gray-600">{selectedClip.color || '#FFFFFF'}</span>
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* Image-specific panel */}
      {selectedClip.type === 'image' && (
        <Section title="Image" icon={ImageIcon}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-gray-500 w-16">Blend</span>
            <select
              value={(selectedClip as Record<string, unknown>).blendMode as string || 'normal'}
              onChange={(e) => update('blendMode', e.target.value)}
              className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:border-indigo-400 bg-white"
            >
              {['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion'].map(m => (
                <option key={m} value={m}>{m.replace(/-/g, ' ')}</option>
              ))}
            </select>
          </div>
        </Section>
      )}

      {/* Speed & Reverse — video clips only */}
      {selectedClip.type === 'video' && (
        <Section title="Playback" icon={Sun}>
          <SliderProp
            label="Speed"
            value={Math.round(((live.speed as number) ?? 1) * 100) / 100}
            min={0.25} max={2} step={0.25} unit="x"
            onChange={(v) => updateClipSpeed(selectedClip.id, v)}
          />
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[11px] text-gray-600">Reverse</span>
            <button
              onClick={() => updateClip(selectedClip.id, { reverse: !(selectedClip.reverse ?? false) })}
              className={`relative w-9 h-5 rounded-full transition-colors ${selectedClip.reverse ? 'bg-indigo-500' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${selectedClip.reverse ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </Section>
      )}

      {/* Adjustments — video and image clips */}
      {(selectedClip.type === 'video' || selectedClip.type === 'image') && (
        <Section title="Adjustments" icon={Sun}>
          <SliderProp label="Brightness" value={(live.brightness as number) ?? 100} min={0} max={200} step={1} unit="%" onChange={(v) => update('brightness', v)} hasKeyframes={kf('brightness')} />
          <SliderProp label="Contrast"   value={(live.contrast   as number) ?? 100} min={0} max={200} step={1} unit="%" onChange={(v) => update('contrast',   v)} hasKeyframes={kf('contrast')} />
          <SliderProp label="Saturation" value={(live.saturation as number) ?? 100} min={0} max={200} step={1} unit="%" onChange={(v) => update('saturation', v)} hasKeyframes={kf('saturation')} />
          <SliderProp label="Blur"       value={(live.blur       as number) ??   0} min={0} max={20}  step={0.5} unit="px" onChange={(v) => update('blur', v)} hasKeyframes={kf('blur')} />
        </Section>
      )}

      {/* Audio */}
      {selectedClip.type === 'audio' && (
        <Section title="Audio" icon={Droplets}>
          <SliderProp label="Volume" value={((live.volume as number) ?? 1) * 100} min={0} max={200} step={1} unit="%" onChange={(v) => update('volume', v / 100)} />
          <div className="text-[10px] text-gray-500 mt-1">Fade In / Out coming soon</div>
        </Section>
      )}

      {/* Keyframes — video, text, and image clips */}
      {(selectedClip.type === 'video' || selectedClip.type === 'text' || selectedClip.type === 'image') && (
        <Section title="Keyframes" icon={Diamond} defaultOpen={keyframeCount > 0}>
          <div className="text-[10px] text-gray-400 mb-2">
            Playhead @ <span className="font-mono text-indigo-600">{currentTime.toFixed(2)}s</span>
            {keyframeCount > 0 && (
              <span className="ml-2 text-gray-500">· {keyframeCount} total</span>
            )}
          </div>

          <div className="mb-2 p-2 bg-blue-50 rounded text-[10px] text-blue-600 border border-blue-100">
            ◆ = add keyframe at playhead. Sliders auto-write keyframes when enabled.
          </div>

          <div className="space-y-1.5">
            <KeyframeRow
              label="Position"
              propNames={['x', 'y']}
              currentValue={selectedClip.x ?? 0.5}
              clipId={selectedClip.id}
              currentTime={currentTime}
            />
            <KeyframeRow
              label="Scale"
              propNames={['scaleX', 'scaleY']}
              currentValue={selectedClip.scaleX ?? 1}
              clipId={selectedClip.id}
              currentTime={currentTime}
            />
            <KeyframeRow
              label="Rotation"
              propNames={['rotation']}
              currentValue={selectedClip.rotation ?? 0}
              clipId={selectedClip.id}
              currentTime={currentTime}
            />
            <KeyframeRow
              label="Opacity"
              propNames={['opacity']}
              currentValue={selectedClip.opacity ?? 1}
              clipId={selectedClip.id}
              currentTime={currentTime}
            />
            {(selectedClip.type === 'video' || selectedClip.type === 'image') && (
              <>
                <KeyframeRow
                  label="Brightness"
                  propNames={['brightness']}
                  currentValue={selectedClip.brightness ?? 100}
                  clipId={selectedClip.id}
                  currentTime={currentTime}
                />
                <KeyframeRow
                  label="Contrast"
                  propNames={['contrast']}
                  currentValue={selectedClip.contrast ?? 100}
                  clipId={selectedClip.id}
                  currentTime={currentTime}
                />
                <KeyframeRow
                  label="Saturation"
                  propNames={['saturation']}
                  currentValue={selectedClip.saturation ?? 100}
                  clipId={selectedClip.id}
                  currentTime={currentTime}
                />
                <KeyframeRow
                  label="Blur"
                  propNames={['blur']}
                  currentValue={selectedClip.blur ?? 0}
                  clipId={selectedClip.id}
                  currentTime={currentTime}
                />
              </>
            )}
          </div>

          {/* List existing keyframes with remove button */}
          {keyframeCount > 0 && (
            <div className="mt-3 space-y-1">
              <div className="text-[10px] text-gray-500 font-medium mb-1">All keyframes</div>
              {(selectedClip.keyframes || []).map((kfItem) => (
                <div key={kfItem.id} className="flex items-center justify-between text-[10px] bg-gray-50 rounded px-2 py-1">
                  <span className="font-mono text-indigo-600">{kfItem.time.toFixed(2)}s</span>
                  <span className="text-gray-500 mx-2">{kfItem.property}</span>
                  <span className="font-mono text-gray-700 flex-1">{typeof kfItem.value === 'number' ? kfItem.value.toFixed(3) : kfItem.value}</span>
                  <button
                    onClick={() => useEditorStore.getState().removeKeyframe(selectedClip.id, kfItem.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors ml-1"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
