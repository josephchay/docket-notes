import { useState, useRef, useEffect } from "react";
import { useMotionValue, useTransform, useMotionValueEvent } from "framer-motion";

import PullRig from "./PullRig";
import { DRAG_SNAP } from "../Motion";
import { smoothPath } from "../../utils/svgPath";

const PULL_THRESHOLD = 120;   // how far "far enough" is (px)
// Exported for MoveString.jsx — the same rope-rendering math, shared rather
// than duplicated a second time (that duplication is exactly why the two
// files' dragTransition literal needed DRAG_SNAP in the first place).
export const ROPE_SAMPLES = 10;

// Solves a·(cosh(L/2a) − 1) = sag for `a` — the catenary parameter that
// makes a rope of "slack" `a` droop by exactly `sag` over a span `L`. No
// closed form exists for this (that's the same reason TagThreads.jsx's own
// catenary picks `a` directly rather than solving for it), but this rope's
// sag is deliberately tied to how far it's been pulled — the whole point of
// grabbing the tassel — so it can't sidestep the solve the way a hover
// connector can. The shallow-sag approximation a ≈ L²/(8·sag) alone isn't
// good enough here: checked by hand against this rope's own numbers, it's
// off by roughly 2× right at rest (L≈26, sag≈20 — sag is 77% of the span
// there, nowhere near the "sag ≪ span" regime that approximation assumes).
// Newton-Raphson from that same approximation as a seed converges cleanly
// in a handful of steps even from that far off — verified by hand at rest,
// mid-pull, and fully taut before this ever ran as code — so it's unrolled
// to a fixed count rather than looping until some tolerance is hit, which
// keeps this cheap (it runs every drag frame) and removes any chance of it
// not terminating.
export const solveCatenaryA = (span, sag) => {
  let a = (span * span) / (8 * sag);

  for (let i = 0; i < 5; i++) {
    const m = span / (2 * a);
    const coshM = Math.cosh(m);
    const sinhM = Math.sinh(m);
    const f = a * (coshM - 1) - sag;
    const fPrime = (coshM - 1) - m * sinhM;
    a -= f / (fPrime > -1e-6 ? -1e-6 : fPrime);
  }

  return a;
};

// A single decorative elastic pull-string. Grab the tassel, stretch the rope,
// and release past the threshold to fire `onTrigger` with a little sparkle burst.
const PullString = ({ anchorX, restY = 26, colorName, icon, verb, onTrigger, reduceMotion = false }) => {
  const pullX = useMotionValue(0);
  const pullY = useMotionValue(0);
  const tabRef = useRef(null);
  const readyRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [burst, setBurst] = useState(false);

  // The rope: from the note's edge to the dragged tassel, sagging while
  // slack and pulling taut the further it's stretched — the sag amount is
  // the same already-tuned falloff this always used (20px at rest, gone by
  // ~125px of pull), just now shaping a real catenary curve instead of one
  // parabolic bezier control point. The droop stays purely vertical (added
  // straight onto the linear x/y interpolation between the two endpoints)
  // rather than perpendicular to the anchor-tassel chord — this rope's
  // fixed end sits above a tassel that can be pulled well off to either
  // side, so "perpendicular to chord" would make it bulge sideways under a
  // steep pull instead of hanging straight down under its own weight.
  const ropePath = useTransform([pullX, pullY], ([x, y]) => {
    const tx = anchorX + x;
    const ty = restY + y;
    const dx = tx - anchorX;
    const dy = ty;
    const span = Math.hypot(dx, dy);

    const sag = Math.max(0.5, 20 - Math.abs(y) * 0.16);
    const a = solveCatenaryA(span, sag);
    const half = span / 2;
    const coshHalf = Math.cosh(half / a);

    const points = [];
    for (let i = 0; i <= ROPE_SAMPLES; i++) {
      const f = i / ROPE_SAMPLES;
      const localX = f * span;
      const droop = a * coshHalf - a * Math.cosh((localX - half) / a);

      points.push({
        x: anchorX + f * dx,
        y: f * dy + droop,
      });
    }

    return smoothPath(points);
  });

  const ropeWidth = useTransform(pullY, [0, 220], [6, 2.2], { clamp: true });
  const gripScale = useTransform(pullY, [0, PULL_THRESHOLD, 240], [1, 1.2, 1.36]);
  const glowOpacity = useTransform(pullY, [40, PULL_THRESHOLD], [0, 1], { clamp: true });

  useMotionValueEvent(pullY, "change", () => {
    const distance = Math.hypot(pullX.get(), pullY.get());
    const isReady = distance > PULL_THRESHOLD;
    if (isReady !== readyRef.current) {
      readyRef.current = isReady;
      setReady(isReady);
    }
  });

  const handleEnd = () => {
    const distance = Math.hypot(pullX.get(), pullY.get());
    if (distance > PULL_THRESHOLD) {
      onTrigger();
      setBurst(true);
      setTimeout(() => setBurst(false), 750);
    }
    readyRef.current = false;
    setReady(false);
  };

  // Stop the tassel's press from bubbling into the note's press handlers, so
  // pulling never starts the long-press delete or the note's tap-shrink.
  useEffect(() => {
    const node = tabRef.current;
    if (!node) return;

    const stop = (e) => e.stopPropagation();
    node.addEventListener("pointerdown", stop);

    return () => node.removeEventListener("pointerdown", stop);
  }, []);

  return (
    <PullRig
      anchorX={ anchorX }
      restY={ restY }
      colorName={ colorName }
      pullX={ pullX }
      pullY={ pullY }
      ropePath={ ropePath }
      ropeWidth={ ropeWidth }
      gripScale={ gripScale }
      glowOpacity={ glowOpacity }
      ready={ ready }
      hintText={ `Release to ${ verb } ✦` }
      tabRef={ tabRef }
      tabAriaLabel={ `Pull to ${ verb }` }
      tabClassName={ `pull-tab ${ colorName }-bg ${ ready ? "ready" : "" }` }
      tabContent={ icon }
      burst={ burst }
      reduceMotion={ reduceMotion }
      dragProps={{
        drag: true,
        dragSnapToOrigin: true,
        dragElastic: 0.5,
        dragConstraints: { left: -70, right: 70, top: 0, bottom: 220 },
        dragTransition: DRAG_SNAP,
        onDragEnd: handleEnd,
      }}
    />
  );
};

export default PullString;
