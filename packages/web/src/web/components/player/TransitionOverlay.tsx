/**
 * TransitionOverlay — Visual transition effects rendered as DOM overlays.
 * Pure presentational, no state.
 */

export const TRANSITION_DURATION = 0.5; // seconds

export function TransitionOverlay({ type, progress }: { type: string; progress: number }) {
  const p = Math.max(0, Math.min(1, progress));
  const fade = p < 0.5 ? p * 2 : (1 - p) * 2;

  switch (type) {
    case 'fade':
    case 'dissolve':
      return (
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ opacity: fade, zIndex: 25 }}
        />
      );
    case 'blur':
      return (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backdropFilter: `blur(${fade * 20}px)`, zIndex: 25 }}
        />
      );
    case 'slide-left':
      return (
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ transform: `translateX(${(1 - p) * 100}%)`, opacity: 0.6, zIndex: 25 }}
        />
      );
    case 'slide-right':
      return (
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ transform: `translateX(${-(1 - p) * 100}%)`, opacity: 0.6, zIndex: 25 }}
        />
      );
    case 'glitch':
      return (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ zIndex: 25 }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'repeating-linear-gradient(0deg,rgba(255,0,0,0.15) 0px,rgba(255,0,0,0.15) 2px,transparent 2px,transparent 4px)',
              transform: `translateX(${Math.sin(p * 30) * 10}px)`,
              opacity: fade,
            }}
          />
        </div>
      );
    case 'lightleak':
      return (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 60% 30%, rgba(255,200,80,${fade * 0.8}), transparent 70%)`,
            zIndex: 25,
          }}
        />
      );
    default:
      return (
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ opacity: fade, zIndex: 25 }}
        />
      );
  }
}
