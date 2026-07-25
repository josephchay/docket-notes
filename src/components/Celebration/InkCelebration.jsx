import React from "react";
import { AnimatePresence, motion } from "framer-motion";

import "./InkCelebration.css";

// A little nod when the desk crosses a milestone note count — just the
// pill of praise, blooming up out of a drop the same dot-to-sheet way the
// command palette and every other panel in the app does, then dissolving
// back out. No shower of falling drops; that read as confetti rather than
// ink and never actually matched the rest of the desk's language.
const InkCelebration = ({ celebration }) => {
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
                className="ink-celebration-pill"
                initial={{ opacity: 0, scale: .15, translateY: -14, borderRadius: 40 }}
                animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 999 }}
                exit={{
                  opacity: 0,
                  scale: .3,
                  translateY: -10,
                  transition: { duration: .22, ease: "easeIn" },
                }}
                transition={{ type: "spring", stiffness: 190, damping: 13, delay: .12 }}
              >
                ✦ { celebration.count } notes on the desk
              </motion.div>
            )
          }
        </AnimatePresence>
      </div>
    </div>
  );
};

export default InkCelebration;
