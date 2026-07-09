import React, { useState, useRef, useEffect } from "react";
import {
  motion,
  AnimatePresence,
  useTransform,
} from "framer-motion";

const HOVER_PADDING = 34;   // how far outside a card the pull still counts (px)

// The elastic "move" string. Stretch the tassel onto any other note in the
// list — it lights up as the swap target — and release to trade places with
// it, the grid gliding into the new order. Every note's position is cached
// once when the pull starts, so tracking the pointer costs no DOM reads and
// no re-renders mid-drag.
const MoveString = ({ anchorX, restY = 26, colorName, icon, noteId, pullX, pullY, onPullStart, onPullEnd, onMove }) => {
  const tabRef = useRef(null);
  const candidatesRef = useRef([]);
  const targetRef = useRef(null);

  const [armed, setArmed] = useState(false);
  const [burst, setBurst] = useState(false);

  // The rope: a quadratic curve from the note's edge to the dragged tassel,
  // sagging while slack and pulling taut the further it is stretched.
  const ropePath = useTransform([pullX, pullY], ([x, y]) => {
    const tx = anchorX + x;
    const ty = restY + y;
    const sag = Math.max(0, 20 - Math.hypot(x, y) * 0.16);
    const cx = (anchorX + tx) / 2;
    const cy = ty / 2 + sag;
    return `M ${anchorX} 0 Q ${cx} ${cy} ${tx} ${ty}`;
  });

  const stretch = useTransform([pullX, pullY], ([x, y]) => Math.hypot(x, y));
  const ropeWidth = useTransform(stretch, [0, 360], [6, 2], { clamp: true });
  const gripScale = useTransform(stretch, [0, 140, 420], [1, 1.2, 1.36], { clamp: true });
  const glowOpacity = useTransform(stretch, [40, 140], [0, 1], { clamp: true });

  const clearTarget = () => {
    targetRef.current?.el.classList.remove("swap-target");
    targetRef.current = null;
  };

  // Snapshot every other note's page-space bounds once per pull. The grid
  // never reflows mid-pull (the swap happens on release), so the cache stays
  // valid for the whole gesture.
  const handleStart = () => {
    const list = [];

    document.querySelectorAll("[data-note-id]").forEach((el) => {
      if (el.dataset.noteId === noteId) return;

      const rect = el.getBoundingClientRect();
      list.push({
        id: el.dataset.noteId,
        el,
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
        cx: rect.left + rect.width / 2 + window.scrollX,
        cy: rect.top + rect.height / 2 + window.scrollY,
      });
    });

    candidatesRef.current = list;
    onPullStart?.();
  };

  const handleDrag = (event, info) => {
    const { x, y } = info.point;

    // The card under the pointer; nearest centre wins where padded bounds
    // overlap, so the target never flickers between two notes.
    let next = null;
    let bestDistance = Infinity;

    for (const card of candidatesRef.current) {
      if (
        x < card.left - HOVER_PADDING || x > card.right + HOVER_PADDING ||
        y < card.top - HOVER_PADDING || y > card.bottom + HOVER_PADDING
      ) continue;

      const distance = Math.hypot(x - card.cx, y - card.cy);
      if (distance < bestDistance) {
        bestDistance = distance;
        next = card;
      }
    }

    if (next?.id === targetRef.current?.id) return;

    clearTarget();
    if (next) {
      next.el.classList.add("swap-target");
      targetRef.current = next;
    }

    setArmed(Boolean(next));
  };

  const handleEnd = () => {
    if (targetRef.current) {
      onMove(targetRef.current.id);
      setBurst(true);
      setTimeout(() => setBurst(false), 750);
    }

    clearTarget();
    candidatesRef.current = [];
    setArmed(false);
    onPullEnd?.();
  };

  // Stop the tassel's press from bubbling into the note's press handlers, so
  // pulling never starts the long-press delete or the note's tap-shrink.
  useEffect(() => {
    const node = tabRef.current;
    if (!node) return;

    const stop = (e) => e.stopPropagation();
    node.addEventListener("pointerdown", stop);

    return () => {
      node.removeEventListener("pointerdown", stop);
      clearTarget();
    };
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
          className={ `pull-rope-line ${ armed ? "taut" : "" }` }
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
        aria-label="Pull onto another note to swap places with it"
        className={ `pull-tab move ${ colorName }-bg ${ armed ? "ready" : "" }` }
        drag
        dragSnapToOrigin
        dragMomentum={ false }
        dragTransition={{ bounceStiffness: 340, bounceDamping: 13 }}
        style={{ x: pullX, y: pullY, scale: gripScale, left: anchorX, top: restY }}
        onDragStart={ handleStart }
        onDrag={ handleDrag }
        onDragEnd={ handleEnd }
        onMouseDown={ (e) => e.stopPropagation() }
        onTouchStart={ (e) => e.stopPropagation() }
      >
        <span className="pull-grip">
          { armed ? <span className="pull-grip-arrow">⇄</span> : icon }
        </span>
      </motion.button>
      <AnimatePresence>
        {
          armed && (
            <div className="pull-hint" style={{ left: anchorX }}>
              <motion.span
                className="pull-hint-label"
                initial={{ opacity: 0, scale: .8, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: .8 }}
                transition={{ type: "spring", stiffness: 320, damping: 20 }}
              >
                Release to swap notes ⇄
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

export default MoveString;
