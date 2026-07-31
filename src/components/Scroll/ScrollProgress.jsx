import React from "react";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";

import "./ScrollProgress.css";

// A thin ink line tracking how far down the desk you've scrolled — framer's
// useScroll reads the .home container directly, and a spring on top gives
// it a bit of bouncy catch-up lag rather than tracking the scrollbar 1:1.
// A droplet now rides its leading tip, and `markers` (starred notes' rough
// positions, see scrollMarkers in Home.jsx) render as small clickable
// ticks along the track — a quick-jump aid, not a precise map: notes wrap
// in a flex grid, so a note's real scroll offset isn't a simple function
// of its list index the way it would be in a single column. Both a
// marker's own placement and where it scrolls to on click come from that
// same index/total ratio, so the two always agree with each other even
// though neither is pixel-exact against the real DOM position.
const ScrollProgress = ({ containerRef, markers = [] }) => {
  const { scrollYProgress } = useScroll({ container: containerRef });
  const progress = useSpring(scrollYProgress, { stiffness: 280, damping: 32, mass: .4 });
  const dripLeft = useTransform(progress, (v) => `${ v * 100 }%`);

  const jumpTo = (ratio) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: ratio * (el.scrollHeight - el.clientHeight), behavior: "smooth" });
  };

  return (
    <div className="scroll-progress-track" aria-hidden="true">
      {
        markers.map((ratio, index) => (
          <button
            key={ index }
            type="button"
            tabIndex={ -1 }
            className="scroll-progress-marker"
            style={{ left: `${ ratio * 100 }%` }}
            onClick={ () => jumpTo(ratio) }
          />
        ))
      }
      <motion.div className="scroll-progress" style={{ scaleX: progress }} />
      <motion.div
        className="scroll-progress-drip"
        style={{ left: dripLeft }}
        animate={{ scale: [1, 1.18, 1] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
};

export default ScrollProgress;
