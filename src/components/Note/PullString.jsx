import React, { useState, useRef, useEffect } from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  useMotionValueEvent,
} from "framer-motion";

const PULL_THRESHOLD = 120;   // how far "far enough" is (px)

// A single decorative elastic pull-string. Grab the tassel, stretch the rope,
// and release past the threshold to fire `onTrigger` with a little sparkle burst.
const PullString = ({ anchorX, restY = 26, colorName, icon, verb, onTrigger }) => {
  const pullX = useMotionValue(0);
  const pullY = useMotionValue(0);
  const tabRef = useRef(null);
  const readyRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [burst, setBurst] = useState(false);

  // The rope: a quadratic curve from the note's edge to the dragged tassel,
  // sagging while slack and pulling taut the further it is stretched.
  const ropePath = useTransform([pullX, pullY], ([x, y]) => {
    const tx = anchorX + x;
    const ty = restY + y;
    const sag = Math.max(0, 20 - Math.abs(y) * 0.16);
    const cx = (anchorX + tx) / 2;
    const cy = ty / 2 + sag;
    return `M ${anchorX} 0 Q ${cx} ${cy} ${tx} ${ty}`;
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
        aria-label={ `Pull to ${ verb }` }
        className={ `pull-tab ${ colorName }-bg ${ ready ? "ready" : "" }` }
        drag
        dragSnapToOrigin
        dragElastic={ 0.5 }
        dragConstraints={{ left: -70, right: 70, top: 0, bottom: 220 }}
        dragTransition={{ bounceStiffness: 340, bounceDamping: 13 }}
        style={{ x: pullX, y: pullY, scale: gripScale, left: anchorX, top: restY }}
        onDragEnd={ handleEnd }
        onMouseDown={ (e) => e.stopPropagation() }
        onTouchStart={ (e) => e.stopPropagation() }
      >
        <span className="pull-grip">{ icon }</span>
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
                Release to { verb } ✦
              </motion.span>
            </div>
          )
        }
      </AnimatePresence>
      <AnimatePresence>
        {
          burst && (
            <motion.div
              className="pull-burst"
              style={{ left: anchorX }}
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {
                Array.from({ length: 10 }).map((_, i) => {
                  const angle = (Math.PI * 2 * i) / 10;
                  const distance = 52 + (i % 3) * 15;

                  return (
                    <motion.span
                      key={ i }
                      className={ `spark ${ colorName }` }
                      initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                      animate={{
                        x: Math.cos(angle) * distance,
                        y: Math.sin(angle) * distance,
                        scale: [0, 1, 0],
                        opacity: [1, 1, 0],
                      }}
                      transition={{ duration: .7, ease: "easeOut" }}
                    >
                      ✦
                    </motion.span>
                  );
                })
              }
            </motion.div>
          )
        }
      </AnimatePresence>
    </div>
  );
};

export default PullString;
