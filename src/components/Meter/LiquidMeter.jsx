import { useEffect, useRef } from "react";

import "./LiquidMeter.css";

const VIAL_W = 44;
const VIAL_H = 56;
const RADIUS = 10;

// A little ink vial rather than a flat progress bar — two overlapping sine
// waves (different phase/speed for a bit of depth) whose baseline eases
// toward `ratio` every frame with simple damped interpolation, the same
// hand-rolled rAF-loop convention InkGoo.jsx and AmbientField.jsx already
// use elsewhere, rather than a declarative spring — the wave motion itself
// needs a continuous per-frame driver regardless, so the fill level just
// eases inside that same loop instead of running a second animation system.
const LiquidMeter = ({ ratio = 0, color = "var(--page-ink-color)", label }) => {
  const waveARef = useRef(null);
  const waveBRef = useRef(null);
  const currentRef = useRef(0);
  const targetRef = useRef(ratio);

  useEffect(() => {
    targetRef.current = Math.max(0, Math.min(1, ratio));
  }, [ratio]);

  useEffect(() => {
    const start = performance.now();
    let raf;

    const wavePath = (level, amplitude, phase, waveLength) => {
      const baseY = VIAL_H - 4 - level * (VIAL_H - 10);
      const step = 5;
      const pts = [];
      for (let x = -step; x <= VIAL_W + step; x += step) {
        const y = baseY + Math.sin(x / waveLength + phase) * amplitude;
        pts.push(`${ x },${ y.toFixed(2) }`);
      }
      return `M0,${ VIAL_H } L${ pts.join(" L") } L${ VIAL_W },${ VIAL_H } Z`;
    };

    const tick = (now) => {
      raf = requestAnimationFrame(tick);

      currentRef.current += (targetRef.current - currentRef.current) * .05;
      const t = (now - start) / 1000;

      if (waveARef.current) waveARef.current.setAttribute("d", wavePath(currentRef.current, 3, t * 1.6, 15));
      if (waveBRef.current) waveBRef.current.setAttribute("d", wavePath(currentRef.current, 2, t * -1.1 + 2, 20));
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="liquid-meter">
      <svg
        className="liquid-meter-svg"
        viewBox={ `0 0 ${ VIAL_W } ${ VIAL_H }` }
        aria-hidden="true"
      >
        <defs>
          <clipPath id="liquid-meter-clip">
            <rect x="1" y="1" width={ VIAL_W - 2 } height={ VIAL_H - 2 } rx={ RADIUS } ry={ RADIUS } />
          </clipPath>
        </defs>
        <rect
          className="liquid-meter-vial"
          x="1"
          y="1"
          width={ VIAL_W - 2 }
          height={ VIAL_H - 2 }
          rx={ RADIUS }
          ry={ RADIUS }
        />
        <g clipPath="url(#liquid-meter-clip)">
          <path ref={ waveBRef } className="liquid-meter-wave" style={{ fill: color, opacity: .4 }} />
          <path ref={ waveARef } className="liquid-meter-wave" style={{ fill: color, opacity: .85 }} />
        </g>
        <rect
          className="liquid-meter-rim"
          x="1"
          y="1"
          width={ VIAL_W - 2 }
          height={ VIAL_H - 2 }
          rx={ RADIUS }
          ry={ RADIUS }
        />
      </svg>
      {
        label && <span className="liquid-meter-label">{ label }</span>
      }
    </div>
  );
};

export default LiquidMeter;
