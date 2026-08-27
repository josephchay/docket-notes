import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { closedCatmullRomPath } from "../../utils/blob";
import SparkBurst from "../Spark/SparkBurst";

const BOX = 18; // the box's own SVG viewBox size, in local units

// How far the drawn square sits in from the viewBox's own edge — has to
// clear the stroke's own half-width (0.8) plus the jitter below's max
// reach (0.55) on every side, or the wobble can push the path (and its
// stroke) right past the viewBox boundary and get visually clipped/read as
// touching whatever sits beside the checkbox in the row. 2 clears both with
// a little to spare.
const INSET = 2;
const SPAN = BOX - INSET * 2;

// A slightly-imperfect hand-drawn square outline — twelve anchors (every
// corner plus the midpoint of each edge) nudged a touch off their perfect
// rounded-rect positions and smoothed through the same closed Catmull-Rom
// curve utils/blob.js's own blobPath already uses for note spawn
// silhouettes, rather than a plain vector rounded-rect. Computed once per
// checkbox (see the useMemo below) and never again — re-jittering on every
// render would just read as flicker, not character — so every box in a
// checklist ends up its own subtly wonky square instead of one icon
// stamped out identically down the whole list.
const wobblyBoxPath = () => {
  const r = SPAN * 0.22;
  const mid = INSET + SPAN / 2;
  const near = INSET;
  const far = INSET + SPAN;
  const j = () => (Math.random() - 0.5) * 1.1;

  const anchors = [
    [near + r, near], [mid, near], [far - r, near],
    [far, near + r], [far, mid], [far, far - r],
    [far - r, far], [mid, far], [near + r, far],
    [near, far - r], [near, mid], [near, near + r],
  ].map(([x, y]) => [x + j(), y + j()]);

  return closedCatmullRomPath(anchors);
};

// The checklist's own checkbox — deliberately a hand-drawn SQUARE rather
// than this app's usual circular toggle (the star, the lock, the select
// badge): a checkbox specifically needs to read as a box. Checking one
// doesn't pop a stock icon in — an actual checkmark draws itself on stroke
// by stroke (the same pathLength technique NoteEditor's own FocusRing
// already uses for its focus-draw ring), and a small burst of the note's
// own ink flicks off it, the same "yes, that landed" confirmation the
// star/restore/duplicate actions elsewhere already give. One instance per
// row (see ChecklistBody.jsx) — the wobble/draw-on/burst all live here so
// that file stays about row bookkeeping instead.
const InkCheckbox = ({ checked, locked, colorName, onToggle }) => {
  const boxPath = useMemo(() => wobblyBoxPath(), []);
  const [burst, setBurst] = useState(false);
  const burstTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(burstTimerRef.current), []);

  const handleClick = () => {
    if (!checked) {
      setBurst(true);
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = setTimeout(() => setBurst(false), 500);
    }
    onToggle();
  };

  return (
    <motion.button
      type="button"
      aria-label={ checked ? "Mark item not done" : "Mark item done" }
      aria-pressed={ checked }
      className={ `checklist-check ${ checked ? "checked" : "" }` }
      disabled={ locked }
      whileHover={ locked ? undefined : { scale: 1.12, rotate: -3 } }
      whileTap={ locked ? undefined : { scale: .84 } }
      transition={{ type: "spring", stiffness: 420, damping: 16 }}
      onClick={ handleClick }
    >
      <svg viewBox={ `0 0 ${ BOX } ${ BOX }` } className="checklist-check-svg" aria-hidden="true">
        <path className="checklist-check-box" d={ boxPath } />
        <AnimatePresence>
          {
            checked && (
              <motion.path
                className="checklist-check-mark"
                d="M4 9.6 L7.6 13.4 L14.4 4.8"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: .12 } }}
                transition={{ duration: .32, ease: "easeOut" }}
              />
            )
          }
        </AnimatePresence>
      </svg>
      <SparkBurst
        active={ burst }
        count={ 5 }
        radius={ 15 }
        duration={ .45 }
        className="checklist-check-burst"
        style={ colorName ? { color: `var(--${ colorName }-color)` } : undefined }
      />
    </motion.button>
  );
};

export default InkCheckbox;
