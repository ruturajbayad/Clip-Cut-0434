import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { motion, useInView } from 'framer-motion';
import {
  Film, Zap, Layers, Music, Type, Sparkles,
  ChevronRight, Play, Check, Star, ArrowRight,
  Scissors, Wand2, Download, MonitorPlay, Palette, Clock
} from 'lucide-react';

// ─── Animated counter ────────────────────────────────────────────────────────
function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = to / 60;
    const id = setInterval(() => {
      start += step;
      if (start >= to) { setVal(to); clearInterval(id); }
      else setVal(Math.floor(start));
    }, 16);
    return () => clearInterval(id);
  }, [inView, to]);
  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>;
}

// ─── Feature card ─────────────────────────────────────────────────────────────
function FeatureCard({ icon: Icon, title, desc, delay }: {
  icon: React.ElementType; title: string; desc: string; delay: number;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.45, delay }}
      className="group border border-gray-200 rounded-2xl p-6 hover:border-black hover:shadow-lg transition-all duration-300 cursor-default bg-white"
    >
      <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center mb-4">
        <Icon size={18} className="text-white" />
      </div>
      <h3 className="font-semibold text-gray-900 text-sm mb-1.5">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
    </motion.div>
  );
}

// ─── Main Landing ─────────────────────────────────────────────────────────────
export default function Landing() {
  const [, setLocation] = useLocation();

  const features = [
    { icon: Scissors,    title: 'Smart Timeline',     desc: 'Multi-track timeline with drag & drop, split, trim and precise frame control.' },
    { icon: Wand2,       title: 'Effects & Filters',  desc: 'Cinematic, VHS, glitch, bloom — one-click filters with live preview.' },
    { icon: Type,        title: 'Text & Titles',      desc: 'Animated overlays with custom fonts, shadows, outlines and entry transitions.' },
    { icon: Music,       title: 'Audio Mixing',       desc: 'Layer music & SFX with per-track volume and offline audio pre-render.' },
    { icon: Layers,      title: 'Keyframe Animation', desc: 'Animate position, scale, opacity, rotation with smooth interpolation.' },
    { icon: Sparkles,    title: 'Transitions',        desc: 'Dissolve, light leak, glitch and cinematic cuts between clips.' },
    { icon: MonitorPlay, title: 'Aspect Ratios',      desc: '16:9, 9:16, 1:1, 4:3 — perfect for YouTube, Reels, TikTok.' },
    { icon: Download,    title: 'MP4 / WebM Export',  desc: 'Up to 1080p 60fps. Real-time render, no browser crash.' },
    { icon: Palette,     title: 'Colour Grading',     desc: 'Brightness, contrast, saturation and blur per clip with instant feedback.' },
  ];

  const stats = [
    { to: 1080, suffix: 'p',   label: 'Max Resolution' },
    { to: 60,   suffix: 'fps', label: 'Frame Rate' },
    { to: 100,  suffix: '%',   label: 'Browser Native' },
    { to: 0,    suffix: 'ms',  label: 'Install Time' },
  ];

  // Enable smooth scroll on mount
  useEffect(() => {
    document.documentElement.style.scrollBehavior = 'smooth';
    return () => { document.documentElement.style.scrollBehavior = ''; };
  }, []);

  return (
    <div className="min-h-screen bg-white text-gray-900 overflow-x-hidden">

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
              <Film size={15} className="text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">CutCraft</span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm text-gray-500">
            <a href="#features"  className="hover:text-black transition-colors">Features</a>
            <a href="#how"       className="hover:text-black transition-colors">How it works</a>
            <a href="#reviews"   className="hover:text-black transition-colors">Reviews</a>
          </div>

          <button
            onClick={() => setLocation('/editor')}
            className="px-4 py-2 bg-black hover:bg-gray-800 text-white text-sm font-semibold rounded-xl transition-all flex items-center gap-1.5"
          >
            Open Editor <ArrowRight size={14} />
          </button>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="pt-40 pb-24 px-6">
        <div className="max-w-4xl mx-auto text-center">

          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 bg-gray-100 text-gray-600 text-xs font-semibold px-4 py-1.5 rounded-full mb-7 border border-gray-200"
          >
            <Zap size={11} className="fill-gray-600" />
            No install · No account · 100% browser
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="text-6xl md:text-7xl font-extrabold leading-[1.08] tracking-tight mb-6 text-gray-900"
          >
            Professional video
            <br />
            <span className="text-black relative">
              editing in your browser.
              <span className="absolute -bottom-1 left-0 right-0 h-[3px] bg-black rounded-full" />
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.2 }}
            className="text-lg text-gray-500 max-w-xl mx-auto mb-10 leading-relaxed"
          >
            Multi-track timeline, effects, audio mixing, keyframe animation and 1080p export —
            all in the browser. Open and start editing instantly.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <button
              onClick={() => setLocation('/editor')}
              className="group px-8 py-4 bg-black hover:bg-gray-800 text-white font-bold text-base rounded-2xl transition-all flex items-center gap-2 shadow-xl shadow-black/10"
            >
              Start Editing — Free
              <ChevronRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <button
              onClick={() => setLocation('/editor')}
              className="px-8 py-4 bg-white hover:bg-gray-50 border-2 border-gray-200 hover:border-gray-300 text-gray-700 font-semibold text-base rounded-2xl transition-all flex items-center gap-2"
            >
              <div className="w-6 h-6 rounded-full bg-black flex items-center justify-center">
                <Play size={9} className="fill-white text-white ml-0.5" />
              </div>
              See it in action
            </button>
          </motion.div>

          {/* Trust row */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="flex items-center justify-center gap-6 mt-8"
          >
            {['No watermark', 'No signup', '1080p export', 'MP4 & WebM'].map((t) => (
              <span key={t} className="flex items-center gap-1.5 text-xs text-gray-400">
                <Check size={11} className="text-black" strokeWidth={3} /> {t}
              </span>
            ))}
          </motion.div>
        </div>

        {/* ── Editor mockup ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 48 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.45 }}
          className="max-w-5xl mx-auto mt-16"
        >
          <div className="rounded-2xl border-2 border-gray-900 overflow-hidden shadow-2xl shadow-black/20 bg-[#111]">
            {/* Window bar */}
            <div className="flex items-center gap-2 px-4 py-3 bg-[#1a1a1a] border-b border-white/10">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="flex items-center gap-2 bg-white/5 rounded-md px-3 py-1">
                  <Film size={11} className="text-gray-400" />
                  <span className="text-xs text-gray-400">CutCraft — My Project.mp4</span>
                </div>
              </div>
              <button
                onClick={() => setLocation('/editor')}
                className="px-3 py-1 bg-white text-black text-xs font-bold rounded-md hover:bg-gray-100 transition-colors"
              >
                Export
              </button>
            </div>

            {/* Editor layout */}
            <div className="flex" style={{ height: 320 }}>
              {/* Sidebar icons */}
              <div className="w-14 bg-[#111] border-r border-white/10 flex flex-col items-center py-3 gap-2.5">
                {[Film, Music, Type, Palette, Sparkles, Layers].map((Icon, i) => (
                  <div key={i} className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer transition-colors
                    ${i === 0 ? 'bg-white text-black' : 'text-gray-600 hover:text-gray-300'}`}>
                    <Icon size={16} />
                  </div>
                ))}
              </div>

              {/* Canvas */}
              <div className="flex-1 bg-[#0d0d0d] flex items-center justify-center relative">
                <div className="w-72 h-40 bg-white rounded-lg relative overflow-hidden border border-white/10 flex items-center justify-center shadow-xl">
                  {/* Cinematic bars */}
                  <div className="absolute top-0 left-0 right-0 h-4 bg-black" />
                  <div className="absolute bottom-0 left-0 right-0 h-4 bg-black" />
                  <div className="text-center z-10">
                    <div className="text-black font-black text-2xl tracking-tight">CUTCRAFT</div>
                    <div className="text-gray-500 text-[11px] mt-0.5 uppercase tracking-widest">Professional Editor</div>
                  </div>
                </div>
                {/* Playhead */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 border border-white/10 rounded-full px-3 py-1.5 backdrop-blur">
                  <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center">
                    <Play size={8} className="fill-black ml-0.5" />
                  </div>
                  <span className="text-xs text-white font-mono">00:05.12 / 00:23.00</span>
                </div>
              </div>

              {/* Inspector */}
              <div className="w-44 bg-[#111] border-l border-white/10 p-3 flex flex-col gap-3">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Inspector</div>
                {['Opacity', 'Scale X', 'Scale Y', 'Rotation'].map((prop, i) => (
                  <div key={prop}>
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] text-gray-500">{prop}</span>
                      <span className="text-[10px] text-white font-mono">{[100, 1.0, 1.0, 0][i]}</span>
                    </div>
                    <div className="h-1 bg-white/10 rounded-full">
                      <div className="h-full bg-white rounded-full" style={{ width: `${[100, 60, 60, 10][i]}%` }} />
                    </div>
                  </div>
                ))}
                <div className="mt-auto">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Filter</div>
                  <div className="grid grid-cols-3 gap-1">
                    {['VHS', 'B&W', 'Glow', 'Cin.', 'Blur', 'Neon'].map((fx, i) => (
                      <div key={fx} className={`text-[9px] text-center py-1 rounded font-semibold ${i === 3 ? 'bg-white text-black' : 'bg-white/5 text-gray-500'}`}>{fx}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="border-t border-white/10 bg-[#0f0f0f] px-4 py-3">
              {[
                { label: 'Video', clips: [{ w: 30, label: 'Clip 01' }, { w: 28, label: 'Clip 02' }, { w: 22, label: 'Clip 03' }] },
                { label: 'Audio', clips: [{ w: 84, label: 'Background Music' }] },
                { label: 'Text',  clips: [{ w: 14, label: 'Title' }, { w: 18, label: 'Subtitle' }] },
              ].map((row, ri) => (
                <div key={ri} className="flex items-center gap-2 mb-1.5">
                  <div className="w-10 text-[9px] text-gray-600 shrink-0 font-medium">{row.label}</div>
                  <div className="flex-1 h-6 bg-white/3 rounded relative overflow-hidden flex gap-0.5 items-center px-0.5">
                    {row.clips.map((clip, ci) => (
                      <div key={ci} className="h-4 rounded bg-white/20 border border-white/10 flex items-center px-2 shrink-0" style={{ width: `${clip.w}%` }}>
                        <span className="text-[8px] text-white/60 truncate">{clip.label}</span>
                      </div>
                    ))}
                    {/* Playhead */}
                    <div className="absolute top-0 bottom-0 w-px bg-white/60" style={{ left: '24%' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <section id="stats" className="py-16 px-6 border-y border-gray-100 bg-gray-50">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.08 }}
            >
              <div className="text-4xl font-black text-black mb-1">
                <Counter to={s.to} suffix={s.suffix} />
              </div>
              <div className="text-sm text-gray-500">{s.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <motion.p
              initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3"
            >
              Features
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: 0.1 }}
              className="text-4xl md:text-5xl font-extrabold text-black mb-4"
            >
              Everything you need to create.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: 0.15 }}
              className="text-gray-500 max-w-lg mx-auto"
            >
              Professional editing tools — no subscriptions, no desktop app, no compromise.
            </motion.p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => <FeatureCard key={f.title} {...f} delay={i * 0.04} />)}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section id="how" className="py-24 px-6 bg-black text-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <motion.p
              initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3"
            >
              How it works
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: 0.1 }}
              className="text-4xl md:text-5xl font-extrabold mb-4"
            >
              Up and running in seconds.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: 0.15 }}
              className="text-gray-400 max-w-lg mx-auto"
            >
              No install. No account. No catch.
            </motion.p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { step: '01', icon: Download,  title: 'Upload your media',      desc: 'Drop in videos, images and audio. MP4, MOV, WebM, JPG, PNG, MP3 — all supported.' },
              { step: '02', icon: Scissors,  title: 'Edit on the timeline',   desc: 'Trim, split, layer clips. Add text, filters, transitions and music.' },
              { step: '03', icon: Film,      title: 'Export & download',       desc: 'Render to MP4 or WebM up to 1080p. Instant download, no watermark.' },
            ].map((item, i) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }}
                className="relative border border-white/10 rounded-2xl p-7 hover:border-white/30 transition-colors"
              >
                <div className="text-6xl font-black text-white/5 absolute top-4 right-5 leading-none">{item.step}</div>
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center mb-5">
                  <item.icon size={18} className="text-black" />
                </div>
                <h3 className="font-bold text-white text-base mb-2">{item.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Reviews ────────────────────────────────────────────────────────── */}
      <section id="reviews" className="py-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <motion.h2
              initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-4xl font-extrabold text-black mb-3"
            >
              Loved by creators
            </motion.h2>
            <p className="text-gray-500">Real feedback from real editors.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { name: 'Sarah K.',  role: 'Content Creator',      stars: 5, text: 'CutCraft replaced my desktop editor. The 1080p export quality from a browser app is genuinely insane.' },
              { name: 'James L.',  role: 'YouTuber',              stars: 5, text: 'The timeline feels exactly like Premiere. Keyframe animations and audio mixing in the browser — wild.' },
              { name: 'Priya M.', role: 'Social Media Manager',  stars: 5, text: 'I edit all my Reels in CutCraft. The 9:16 mode and animated text are super easy to use.' },
            ].map((review, i) => (
              <motion.div
                key={review.name}
                initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }}
                className="border border-gray-200 rounded-2xl p-6 hover:border-black hover:shadow-lg transition-all"
              >
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: review.stars }).map((_, j) => (
                    <Star key={j} size={13} className="fill-black text-black" />
                  ))}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed mb-5">"{review.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center text-white text-xs font-bold">
                    {review.name[0]}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 text-sm">{review.name}</div>
                    <div className="text-xs text-gray-400">{review.role}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-black text-white">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }} whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }} transition={{ duration: 0.5 }}
          >
            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center mx-auto mb-7">
              <Film size={24} className="text-black" />
            </div>
            <h2 className="text-5xl font-extrabold mb-4 leading-tight">
              Ready to create<br />something great?
            </h2>
            <p className="text-gray-400 mb-8 leading-relaxed max-w-md mx-auto">
              Jump into the editor right now. No sign-up, no credit card, no catch.
            </p>
            <button
              onClick={() => setLocation('/editor')}
              className="group px-10 py-4 bg-white hover:bg-gray-100 text-black font-bold text-base rounded-2xl transition-all shadow-xl flex items-center justify-center gap-2 mx-auto"
            >
              Open Editor — It's Free
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <div className="flex items-center justify-center gap-6 mt-7 text-xs text-gray-500">
              {['No signup required', 'No watermark', '1080p export'].map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <Check size={11} className="text-white" strokeWidth={3} /> {t}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 py-8 px-6 bg-white">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-black rounded-md flex items-center justify-center">
              <Film size={12} className="text-white" />
            </div>
            <span className="font-bold text-sm">CutCraft</span>
          </div>
          <p className="text-xs text-gray-400">Professional video editing in your browser.</p>
          <button
            onClick={() => setLocation('/editor')}
            className="text-xs font-semibold text-black hover:underline flex items-center gap-1"
          >
            Open Editor <ArrowRight size={11} />
          </button>
        </div>
      </footer>
    </div>
  );
}
