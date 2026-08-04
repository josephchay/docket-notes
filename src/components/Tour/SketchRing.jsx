import React, { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import anime from "animejs";

// What marks the current stop now that nothing is dimmed: a hand-drawn
// ellipse of accent ink circled around the control, the way a pen would.
// The loop is a catmull-rom ring of jittered points (so no two stops get
// the same circle), drawn on stroke-by-stroke with anime, and kept alive
// afterwards by a "boiling line" — a turbulence displacement whose seed is
// re-rolled a few times a second, the same trick hand-drawn cartoons use
// to make a still line feel sketched.

let ringSeq = 0;

// A closed, slightly-wrong ellipse: N jittered points smoothed back into
// cubic beziers.
const wobblyLoop = (cx, cy, a, b) => {
  const N = 18;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2 - Math.PI / 3;
    const j = 1 + (Math.random() - 0.5) * 0.055;
    pts.push({ x: cx + Math.cos(ang) * a * j, y: cy + Math.sin(ang) * b * j });
  }

  let d = `M ${ pts[0].x.toFixed(1) } ${ pts[0].y.toFixed(1) }`;
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % N];
    const p3 = pts[(i + 2) % N];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${ c1x.toFixed(1) } ${ c1y.toFixed(1) }, ${ c2x.toFixed(1) } ${ c2y.toFixed(1) }, ${ p2.x.toFixed(1) } ${ p2.y.toFixed(1) }`;
  }
  return `${ d } Z`;
};

const SketchRing = ({ rect, accent, reduced }) => {
  const lineRef = useRef(null);
  const shadowRef = useRef(null);
  const turbRef = useRef(null);
  const filterId = useRef(`tour-boil-${ ++ringSeq }`).current;

  const pad = 13;
  const margin = 12;
  const a = rect.width / 2 + pad;
  const b = rect.height / 2 + pad;
  const w = (a + margin) * 2;
  const h = (b + margin) * 2;

  // Re-rolled only when the target's size changes, so scrolling just slides
  // the same drawing around instead of redrawing a new one.
  const d = useMemo(() => wobblyLoop(w / 2, h / 2, a, b), [w, h, a, b]);

  // Draw the loop on like a pen stroke, then drop the dash bookkeeping so
  // later path updates render whole.
  useEffect(() => {
    const strokes = [lineRef.current, shadowRef.current].filter(Boolean);
    if (strokes.length === 0) return;

    if (reduced) {
      strokes.forEach((el) => { el.style.strokeDasharray = "none"; });
      return;
    }

    strokes.forEach((el) => {
      const len = el.getTotalLength();
      el.style.strokeDasharray = len;
      el.style.strokeDashoffset = len;
    });

    // An elastic draw-on rather than a plain ease — the line overshoots
    // past its own endpoint and springs back the last little way, like a
    // pen flourish rather than a ruled stroke. The same easeOutElastic
    // curve InkGoo's own glow-flash already uses elsewhere in this tour,
    // reused here for a third, differently-channeled read of "elastic":
    // InkGoo's mark ring breathes fluid and organic, bounceElement's jelly
    // squashes the control itself, and this one flourishes the pen line.
    anime({
      targets: strokes,
      strokeDashoffset: [anime.setDashoffset, 0],
      duration: 850,
      delay: 380,
      easing: "easeOutElastic(1, .5)",
      complete: () => strokes.forEach((el) => { el.style.strokeDasharray = "none"; }),
    });

    return () => anime.remove(strokes);
  }, [reduced]);

  // The boil: step the turbulence seed and the line never sits still.
  useEffect(() => {
    if (reduced) return;

    const interval = setInterval(() => {
      turbRef.current?.setAttribute("seed", String((Math.random() * 100) | 0));
    }, 140);
    return () => clearInterval(interval);
  }, [reduced]);

  return (
    <motion.svg
      className="tour-ring"
      style={{ left: rect.cx - w / 2, top: rect.cy - h / 2 }}
      width={ w }
      height={ h }
      viewBox={ `0 0 ${ w } ${ h }` }
      // A stretchy snap rather than a plain uniform scale spring —
      // scaleX/scaleY ride their own asymmetric overshoot, like a rubber
      // band flicked into a circle, instead of just growing in place.
      initial={{ opacity: 0, scaleX: .7, scaleY: .7 }}
      animate={{
        opacity: 1,
        scaleX: [.7, 1.14, .93, 1.04, 1],
        scaleY: [.7, .88, 1.1, .96, 1],
      }}
      exit={{ opacity: 0, scaleX: .85, scaleY: .85, transition: { duration: .16, ease: "easeIn" } }}
      transition={{ duration: .6, ease: "easeInOut" }}
      aria-hidden="true"
    >
      <defs>
        <filter id={ filterId } x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence
            ref={ turbRef }
            type="fractalNoise"
            baseFrequency="0.031"
            numOctaves="2"
            seed="1"
            result="noise"
          />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" />
        </filter>
      </defs>
      <g filter={ reduced ? undefined : `url(#${ filterId })` }>
        <path ref={ shadowRef } className="tour-ring-shadow" d={ d } transform="translate(1.6, 2.2)" />
        <path ref={ lineRef } className="tour-ring-line" d={ d } style={{ stroke: accent }} />
      </g>
    </motion.svg>
  );
};

export default SketchRing;
