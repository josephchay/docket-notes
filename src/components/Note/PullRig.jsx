import { motion, AnimatePresence } from "framer-motion";

import SparkBurst from "../Spark/SparkBurst";

// The shared rig every elastic pull-string in this app hangs off of: the
// sagging rope (an SVG quadratic curve), the glow that builds as it
// stretches, the draggable tassel itself, the "release to ⋯" hint, and the
// spark burst on release. PullString (pull straight down to fire a fixed
// action) and MoveString (drag onto any other note to swap places with it)
// differ in what counts as "ready" and what dragging even means — a
// straight distance threshold vs. live candidate detection — so each keeps
// its own motion-value math, gesture handlers, and drag config; this only
// owns the part that was rendering identically either way.
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
}) => (
  <div className={ `pull-string ${ colorName }` }>
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
      <span className="pull-grip">{ tabContent }</span>
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

export default PullRig;
