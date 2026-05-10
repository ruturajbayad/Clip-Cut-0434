/**
 * TransitionOverlay — Visual transition effects rendered as DOM overlays.
 * Pure presentational, no state.
 */

export const TRANSITION_DURATION = 0.5; // seconds

export function TransitionOverlay({ type, progress }: { type: string; progress: number }) {
  const p = Math.max(0, Math.min(1, progress));
  // fade envelope: 0→1 in first half, 1→0 in second half
  const fade = p < 0.5 ? p * 2 : (1 - p) * 2;

  switch (type) {

    // ── Fade / Dissolve ──────────────────────────────────────────────────────
    case 'fade':
      return (
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ opacity: fade, zIndex: 25 }}
        />
      );

    // Dissolve: cross-fade via animated noise texture overlay
    case 'dissolve': {
      // Simulate a dissolve with a CSS noise-like radial pattern that fades
      const noiseOpacity = fade * 0.9;
      return (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 25,
            backgroundImage: `
              radial-gradient(circle at 20% 20%, rgba(0,0,0,${noiseOpacity}) 0%, transparent 40%),
              radial-gradient(circle at 80% 40%, rgba(0,0,0,${noiseOpacity * 0.8}) 0%, transparent 35%),
              radial-gradient(circle at 50% 80%, rgba(0,0,0,${noiseOpacity * 0.9}) 0%, transparent 45%),
              radial-gradient(circle at 70% 70%, rgba(0,0,0,${noiseOpacity * 0.7}) 0%, transparent 30%),
              radial-gradient(circle at 10% 60%, rgba(0,0,0,${noiseOpacity * 0.85}) 0%, transparent 38%)
            `,
            opacity: 1,
            mixBlendMode: 'multiply',
          }}
        />
      );
    }

    // ── Blur ────────────────────────────────────────────────────────────────
    case 'blur':
      return (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backdropFilter: `blur(${fade * 24}px)`, zIndex: 25 }}
        />
      );

    // ── Slide Left — panel wipes from right ─────────────────────────────────
    case 'slide-left':
      return (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ zIndex: 25 }}
        >
          {/* Outgoing clip slides off to the left */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.1) 100%)',
              transform: `translateX(${-p * 100}%)`,
              transition: 'none',
            }}
          />
          {/* Incoming clip slides in from the right */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.4) 100%)',
              transform: `translateX(${(1 - p) * 100}%)`,
              transition: 'none',
            }}
          />
          {/* Seam / edge highlight */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 3,
              background: 'rgba(255,255,255,0.25)',
              left: `calc(${p * 100}% - 1px)`,
              transition: 'none',
            }}
          />
        </div>
      );

    // ── Slide Right ─────────────────────────────────────────────────────────
    case 'slide-right':
      return (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ zIndex: 25 }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.1) 100%)',
              transform: `translateX(${p * 100}%)`,
              transition: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.4) 100%)',
              transform: `translateX(${-(1 - p) * 100}%)`,
              transition: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 3,
              background: 'rgba(255,255,255,0.25)',
              right: `calc(${p * 100}% - 1px)`,
              transition: 'none',
            }}
          />
        </div>
      );

    // ── Glitch ──────────────────────────────────────────────────────────────
    case 'glitch':
      return (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ zIndex: 25 }}
        >
          {/* RGB split lines */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'repeating-linear-gradient(0deg,rgba(255,0,0,0.15) 0px,rgba(255,0,0,0.15) 2px,transparent 2px,transparent 4px)',
              transform: `translateX(${Math.sin(p * 40) * 12}px)`,
              opacity: fade,
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'repeating-linear-gradient(0deg,transparent 0px,transparent 6px,rgba(0,255,255,0.1) 6px,rgba(0,255,255,0.1) 8px)',
              transform: `translateX(${Math.cos(p * 35) * -8}px)`,
              opacity: fade,
            }}
          />
          {/* Horizontal tear blocks */}
          {[0.15, 0.35, 0.6, 0.8].map((pos, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: `${4 + (i % 3) * 3}%`,
                top: `${pos * 100}%`,
                background: `rgba(${i % 2 === 0 ? '255,0,0' : '0,200,255'},0.08)`,
                transform: `translateX(${Math.sin((p + i * 0.3) * 25) * 16}px)`,
                opacity: fade,
              }}
            />
          ))}
        </div>
      );

    // ── Light Leak ──────────────────────────────────────────────────────────
    case 'lightleak':
      return (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 25,
            background: `
              radial-gradient(ellipse at 65% 25%, rgba(255,210,80,${fade * 0.85}), transparent 65%),
              radial-gradient(ellipse at 20% 70%, rgba(255,100,50,${fade * 0.4}), transparent 55%)
            `,
          }}
        />
      );

    // ── Zoom ────────────────────────────────────────────────────────────────
    case 'zoom': {
      // Scale up + fade: punchy zoom-in transition
      const scale = 1 + fade * 0.15;
      return (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 25,
            background: `rgba(0,0,0,${fade * 0.45})`,
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
            backdropFilter: `blur(${fade * 4}px)`,
          }}
        />
      );
    }

    // ── Whip ─────────────────────────────────────────────────────────────────
    case 'whip': {
      // Fast horizontal smear — motion-blur-like streaks
      const smear = fade;
      return (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ zIndex: 25 }}
        >
          {/* White speed streaks */}
          {[0.1, 0.28, 0.45, 0.62, 0.78, 0.9].map((yPos, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: `${yPos * 100}%`,
                height: `${1.5 + (i % 3) * 1.2}%`,
                left: '-10%',
                right: '-10%',
                background: `rgba(255,255,255,${smear * (0.06 + (i % 2) * 0.04)})`,
                transform: `scaleX(${1 + smear * 0.3}) translateX(${smear * (p < 0.5 ? -1 : 1) * 8}%)`,
              }}
            />
          ))}
          {/* Dark vignette sides */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(90deg, rgba(0,0,0,${smear * 0.5}), transparent 30%, transparent 70%, rgba(0,0,0,${smear * 0.5}))`,
            }}
          />
        </div>
      );
    }

    // ── Spin ────────────────────────────────────────────────────────────────
    case 'spin': {
      const angle = fade * 180; // max 180deg at peak
      return (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 25,
            background: `rgba(0,0,0,${fade * 0.6})`,
            transform: `rotate(${angle}deg) scale(${1 + fade * 0.4})`,
            transformOrigin: 'center center',
          }}
        />
      );
    }

    // ── Cinematic ──────────────────────────────────────────────────────────
    case 'cinematic': {
      const barH = `${fade * 14}%`;
      return (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 25 }}
        >
          {/* Top letterbox bar */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: barH,
              background: 'rgba(0,0,0,0.95)',
            }}
          />
          {/* Bottom letterbox bar */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: barH,
              background: 'rgba(0,0,0,0.95)',
            }}
          />
          {/* Soft center fade */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `rgba(0,0,0,${fade * 0.3})`,
            }}
          />
        </div>
      );
    }

    // ── Page Turn ───────────────────────────────────────────────────────────
    case 'page-turn': {
      // Folding page effect — a diagonal gradient that sweeps across
      const sweep = p; // 0 → 1
      return (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ zIndex: 25, perspective: '800px' }}
        >
          {/* The "page" — a div that rotates in 3D around Y axis */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(105deg, rgba(255,255,255,0.18) 0%, rgba(200,200,200,0.1) 40%, rgba(0,0,0,0.35) 100%)',
              transform: `perspective(800px) rotateY(${sweep * 90}deg)`,
              transformOrigin: 'right center',
              opacity: 1 - sweep * 0.8,
            }}
          />
          {/* Shadow cast by the turning page */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: `${sweep * 100}%`,
              width: `${(1 - sweep) * 100}%`,
              background: `linear-gradient(90deg, transparent 60%, rgba(0,0,0,${(1 - sweep) * 0.4}))`,
              pointerEvents: 'none',
            }}
          />
        </div>
      );
    }

    // ── Default fallback ─────────────────────────────────────────────────────
    default:
      return (
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ opacity: fade, zIndex: 25 }}
        />
      );
  }
}
