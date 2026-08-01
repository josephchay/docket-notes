import React from "react";
import { AnimatePresence, motion } from "framer-motion";

import "./ActionStamp.css";

const SPATTER = [
  { x: -30, y: -14, size: 7 },
  { x: 26, y: -20, size: 5 },
  { x: -20, y: 20, size: 6 },
  { x: 32, y: 12, size: 5 },
  { x: 4, y: -26, size: 4 },
  { x: -8, y: 26, size: 4 },
];

// A quick ink stamp confirming an export or import actually happened —
// pressed down onto the page hard enough to actually flatten (an asymmetric
// scaleX/scaleY squash, not just a uniform shrink) with a spatter of ink
// droplets flung out on impact. The pill and its droplets share the app's
// one gooey-merge filter (see Svg/GooeyEffectSvg, mounted once in Home's
// tree) so the burst reads as ink separating from a single splash rather
// than a handful of unrelated dots.
const ActionStamp = ({ stamp }) => (
  <div className="action-stamp-slot">
    <AnimatePresence>
      {
        stamp && (
          <motion.div
            key={ stamp.key }
            className="action-stamp-wrap"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: .18 } }}
          >
            {/* The droplets alone sit behind the gooey filter — the pill's
                actual text renders as a separate, unfiltered sibling on top,
                since the gaussian-blur/contrast trick that melts the ink
                spatter into one blob would just as happily blur the label
                into mush. */}
            <div className="action-stamp-goo">
              {
                SPATTER.map((drop, index) => (
                  <motion.span
                    key={ index }
                    className="action-stamp-drop"
                    style={{ width: drop.size, height: drop.size }}
                    initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                    animate={{
                      x: drop.x,
                      y: drop.y,
                      scale: [0, 1, .3],
                      opacity: [1, 1, 0],
                    }}
                    transition={{ duration: .55, delay: .2 + index * .012, ease: "easeOut" }}
                  />
                ))
              }
            </div>
            <motion.div
              className="action-stamp"
              initial={{ opacity: 0, scaleX: 2.2, scaleY: 2.2, rotate: -6 }}
              animate={{
                opacity: 1,
                scaleX: [2.2, 1.14, .96, 1],
                scaleY: [2.2, .7, 1.08, 1],
                rotate: 0,
              }}
              exit={{
                opacity: 0,
                scale: .85,
                translateY: -8,
                transition: { duration: .22, ease: "easeIn" },
              }}
              transition={{ duration: .5, times: [0, .55, .8, 1], ease: "easeOut" }}
            >
              { stamp.text }
            </motion.div>
            {/* A soft ring of ink bleeding outward into the paper, separate
                from the gooey cluster above so it stays a plain fading wash
                rather than merging into the droplets. */}
            <motion.span
              className="action-stamp-ring"
              initial={{ scale: .4, opacity: .5 }}
              animate={{ scale: 2.6, opacity: 0 }}
              transition={{ duration: .6, delay: .18, ease: "easeOut" }}
            />
          </motion.div>
        )
      }
    </AnimatePresence>
  </div>
);

export default ActionStamp;
