import React from "react";
import { motion, useScroll, useSpring } from "framer-motion";

import "./ScrollProgress.css";

// A thin ink line tracking how far down the desk you've scrolled — framer's
// useScroll reads the .home container directly, and a spring on top gives
// it a bit of bouncy catch-up lag rather than tracking the scrollbar 1:1.
const ScrollProgress = ({ containerRef }) => {
  const { scrollYProgress } = useScroll({ container: containerRef });
  const progress = useSpring(scrollYProgress, { stiffness: 280, damping: 32, mass: .4 });

  return (
    <motion.div
      className="scroll-progress"
      style={{ scaleX: progress }}
      aria-hidden="true"
    />
  );
};

export default ScrollProgress;
