import React, { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

import useBlobClipMorph from "../../hooks/useBlobClipMorph";
import useOdometer from "../../hooks/useOdometer";

import "./InkCelebration.css";

// A little nod when the desk crosses a milestone note count — the pill of
// praise blooms up through a real flubber blob-clip morph (the same
// dot-to-organic-blob-to-pill stage every SheetPanel opens through, see
// useBlobClipMorph) rather than just a scale+borderRadius approximation of
// one, the count ticks up to the milestone through the same elastic
// useOdometer tween the header's own tallies use instead of snapping
// straight to it, and a ring of ink bleeds outward behind it on arrival —
// the same "impact bleeding into the paper" language ActionStamp's own
// ring already speaks. Still no shower of falling drops; that read as
// confetti rather than ink and never actually matched the rest of the
// desk's language.
const InkCelebration = ({ celebration }) => {
  const pillRef = useRef(null);
  const onBlobUpdate = useBlobClipMorph(pillRef, !!celebration, 999);
  const displayedCount = useOdometer(celebration?.count ?? 0);

  return (
    <div
      className="ink-celebration"
      aria-hidden="true"
    >
      <div className="ink-celebration-pill-slot">
        <AnimatePresence>
          {
            celebration && (
              <motion.div
                key={ celebration.key }
                className="ink-celebration-wrap"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: .22 } }}
              >
                <motion.span
                  className="ink-celebration-ring"
                  initial={{ scale: .3, opacity: .55 }}
                  animate={{ scale: 3.2, opacity: 0 }}
                  transition={{ duration: .75, delay: .15, ease: "easeOut" }}
                />
                <motion.div
                  ref={ pillRef }
                  className="ink-celebration-pill"
                  initial={{ opacity: 0, scale: .15, translateY: -14, borderRadius: 40 }}
                  animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 999 }}
                  /* The pill bloomed up from a dot through a real blob
                     morph on the way in; on the way out it retreats the
                     same way rather than just shrinking — a last small
                     swell (scaleX/scaleY, not a single scale, so
                     useBlobClipMorph's clip-path keeps tracking a real
                     "how open" value) before it collapses back toward the
                     dot it grew from. */
                  exit={{
                    opacity: 0,
                    scaleX: [1, 1.08, .12],
                    scaleY: [1, .82, .1],
                    translateY: -14,
                    transition: { duration: .3, times: [0, .3, 1], ease: "easeInOut" },
                  }}
                  transition={{ type: "spring", stiffness: 190, damping: 13, delay: .12 }}
                  onUpdate={ onBlobUpdate }
                >
                  ✦ { displayedCount } notes on the desk
                </motion.div>
              </motion.div>
            )
          }
        </AnimatePresence>
      </div>
    </div>
  );
};

export default InkCelebration;
