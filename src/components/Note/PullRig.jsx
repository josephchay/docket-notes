import { useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import gsap from "gsap";

import SparkBurst from "../Spark/SparkBurst";

// A tassel leaning toward the cursor before it's even grabbed — the same
// continuous distance-falloff-via-GSAP-quickTo idiom QuickDock's own
// magnetic dock and Header's toolbar icons already established (see
// useMagnetic.jsx), adapted from lift+scale to a small positional lean
// since a tassel reads as something hanging and swaying, not rising off a
// shelf. Landing on the INNER .pull-grip span rather than the outer
// motion.button itself is load-bearing: that button's own x/y are
// pullX/pullY, the exact same motion values the live drag gesture and the
// rope math both already own, and fighting GSAP against Framer Motion for
// the same element's transform would mean one of them losing every frame.
// A nested span composes its own local transform on TOP of whatever the
// button already has instead, so the lean is purely additive — and it
// naturally stands down mid-drag with no extra state to track: once the
// tassel is actually grabbed, the pointer IS the tassel, so this falloff's
// own distance term collapses to ~0 on its own.
const LEAN_RANGE = 70;   // px — reach of the pull
const LEAN_MAX = 10;     // px — lean at zero distance

const PullRig = ({
  anchorX,
  restY = 26,
  colorName,
  pullX,
  pullY,
  ropePath,
  ropeWidth,
  gripScale,
  glowOpacity,
  ready,
  hintText,
  tabRef,
  tabAriaLabel,
  tabClassName,
  tabContent,
  dragProps,
  burst,
  reduceMotion = false,
}) => {
  const gripLeanRef = useRef(null);
  const leanTween = useRef(null);

  const ensureLeanTween = () => {
    if (!leanTween.current && gripLeanRef.current) {
      leanTween.current = {
        x: gsap.quickTo(gripLeanRef.current, "x", { duration: .3, ease: "power3.out" }),
        y: gsap.quickTo(gripLeanRef.current, "y", { duration: .3, ease: "power3.out" }),
      };
    }
    return leanTween.current;
  };

  const handleLean = (e) => {
    if (reduceMotion || !tabRef.current) return;

    const rect = tabRef.current.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    const falloff = Math.max(0, 1 - dist / LEAN_RANGE);
    const eased = falloff * falloff * (3 - 2 * falloff); // smoothstep

    const tween = ensureLeanTween();
    if (!tween) return;
    tween.x((dx / (dist || 1)) * LEAN_MAX * eased);
    tween.y((dy / (dist || 1)) * LEAN_MAX * eased);
  };

  const handleLeanLeave = () => {
    leanTween.current = null;
    if (gripLeanRef.current) gsap.to(gripLeanRef.current, { x: 0, y: 0, duration: .5, ease: "elastic.out(1, 0.5)" });
  };

  return (
  <div className={ `pull-string ${ colorName }` } onPointerMove={ handleLean } onPointerLeave={ handleLeanLeave }>
    <svg
      className="pull-rope"
      viewBox="0 0 340 260"
      preserveAspectRatio="none"
    >
      <motion.path
        d={ ropePath }
        strokeWidth={ ropeWidth }
        className={ `pull-rope-line ${ ready ? "taut" : "" }` }
        fill="none"
        strokeLinecap="round"
      />
    </svg>
    <motion.div
      className="pull-glow"
      style={{ opacity: glowOpacity, x: pullX, y: pullY, left: anchorX, top: restY }}
    />
    <motion.button
      ref={ tabRef }
      type="button"
      aria-label={ tabAriaLabel }
      className={ tabClassName }
      style={{ x: pullX, y: pullY, scale: gripScale, left: anchorX, top: restY }}
      onMouseDown={ (e) => e.stopPropagation() }
      onTouchStart={ (e) => e.stopPropagation() }
      { ...dragProps }
    >
      <span ref={ gripLeanRef } className="pull-grip">{ tabContent }</span>
    </motion.button>
    <AnimatePresence>
      {
        ready && (
          <div className="pull-hint" style={{ left: anchorX }}>
            <motion.span
              className="pull-hint-label"
              initial={{ opacity: 0, scale: .8, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: .8 }}
              transition={{ type: "spring", stiffness: 320, damping: 20 }}
            >
              { hintText }
            </motion.span>
          </div>
        )
      }
    </AnimatePresence>
    <SparkBurst
      active={ burst }
      count={ 10 }
      radius={ (i) => 52 + (i % 3) * 15 }
      duration={ .7 }
      className="pull-burst"
      style={{ left: anchorX, color: `var(--${ colorName }-color)` }}
    />
  </div>
  );
};

export default PullRig;
