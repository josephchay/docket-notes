import React from "react";
import { AnimatePresence, motion } from "framer-motion";

import "./ThemeWipe.css";

const RESTING_DIAMETER = 56; // px, matches .theme-wipe in the stylesheet

// The page doesn't just crossfade between paper and ink — a drop of the new
// page color blooms from wherever the theme button was pressed and washes
// clean over the whole desk, overshooting into a fat bloom before it
// settles. The CSS variables have already swapped underneath by the time
// it's covering everything, so the fade-out at the end is seamless — the
// drop is just cleaning up after itself.
const ThemeWipe = ({ wipe }) => {
  const reach = wipe
    ? Math.hypot(
        Math.max(wipe.x, window.innerWidth - wipe.x),
        Math.max(wipe.y, window.innerHeight - wipe.y)
      )
    : 0;
  const scale = (reach * 2.2) / RESTING_DIAMETER;

  return (
    <AnimatePresence>
      {
        wipe && (
          <motion.span
            key={ wipe.key }
            aria-hidden="true"
            className="theme-wipe"
            style={{
              left: wipe.x,
              top: wipe.y,
              backgroundColor: wipe.color,
            }}
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale, opacity: [1, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{
              scale: { type: "spring", stiffness: 85, damping: 13.5, mass: 1 },
              opacity: { duration: .9, times: [0, .72, 1], ease: "easeInOut" },
            }}
          />
        )
      }
    </AnimatePresence>
  );
};

export default ThemeWipe;
