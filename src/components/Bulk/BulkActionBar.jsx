import React, { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import gsap from "gsap";
import { FaStar, FaPalette, FaFileArrowDown, FaBoxArchive, FaTrash, FaXmark } from "react-icons/fa6";

import useJellyTap from "../../hooks/useJellyTap";
import useBlobClipMorph from "../../hooks/useBlobClipMorph";
import useOdometer from "../../hooks/useOdometer";
import { SNAPPY, DOCK_ITEM, EXIT_SPRING, enterExitStagger } from "../Motion";

import "./BulkActionBar.css";

const springy = SNAPPY;

// The four action icons bounce in one after another once the bar itself
// has landed — the same recipe the header's color-filter chips use.
const actionRowVariants = enterExitStagger(.1, .05);

// The same spring shape as QuickDock's own item pop-in (DOCK_ITEM) — both
// are a row of icon buttons bouncing in behind their own shell's entrance.
const actionItemVariants = {
  hidden: { opacity: 0, scale: 0, translateY: 12 },
  shown: {
    opacity: 1,
    scale: 1,
    translateY: 0,
    transition: DOCK_ITEM,
  },
};

const HOLD_DELETE_MS = 650; // how long the danger button has to be held before it actually commits
const RECOLOR_DROP_DURATION = .55;

// Delete is the one irreversible action on this bar, so it's the only one
// that doesn't fire on a bare click — pathLength on the ring below fills
// linearly while held (a real hourglass, not a fake progress bar: the same
// duration every time, driven straight off HOLD_DELETE_MS) and only calls
// onDelete once it actually reaches 1. Releasing early — pointer up, pointer
// leaving the button, or a key release — retargets it back to 0 with a
// quick snap instead, same as letting go of a held spring.
const useHoldToConfirm = (onConfirm, reduceMotion) => {
  const [holding, setHolding] = useState(false);

  if (reduceMotion) {
    return {
      holding: false,
      handlers: { onClick: onConfirm },
    };
  }

  const start = () => setHolding(true);
  const cancel = () => setHolding(false);

  return {
    holding,
    handlers: {
      onPointerDown: start,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") start(); },
      onKeyUp: (e) => { if (e.key === "Enter" || e.key === " ") cancel(); },
    },
    onComplete: () => {
      if (holding) {
        setHolding(false);
        onConfirm();
      }
    },
  };
};

// Morphs up from the bottom edge the moment the first note is selected — a
// dot-to-bar expansion, ink-on-paper like the command palette — and folds
// back down to nothing the moment the last one is deselected. Each icon
// gets its own tap jelly, squashed on its own inner span so it never
// fights the button's own hover/tap scale. The entrance itself now runs
// through the same flubber blob-clip morph every SheetPanel opens with
// (see useBlobClipMorph) — a real organic ink-blob stage between "dot" and
// "bar", not just a scaling rounded rect — and the count reads through
// useOdometer's own elastic tween rather than popping in fresh each time,
// so a multi-note selection/deselection drag rolls through the numbers in
// between instead of snapping.
const BulkActionBar = ({ count, onStar, onRecolor, onExport, onArchive, onDelete, onDone, reduceMotion }) => {
  const starJelly = useJellyTap();
  const recolorJelly = useJellyTap();
  const exportJelly = useJellyTap();
  const archiveJelly = useJellyTap();
  const deleteJelly = useJellyTap();
  const doneJelly = useJellyTap();

  const barRef = useRef(null);
  const onBlobUpdate = useBlobClipMorph(barRef, count > 0, 20);
  const displayedCount = useOdometer(count);

  // A real spring-mass system settles slower under more mass on the same
  // spring/damper — this is that relationship, not an arbitrary duration
  // tween: a 20-note selection genuinely feels heavier landing than a
  // 2-note one, because framer's own physics engine is carrying more mass
  // through the exact same stiffness/damping. Capped so a huge selection
  // doesn't turn sluggish forever.
  const barMass = 1 + Math.min(count, 24) / 8;

  const deleteHold = useHoldToConfirm(onDelete, reduceMotion);

  // The bar's own position is the drop's real origin/destination — read
  // fresh per click rather than cached, since the bar can still be mid-
  // entrance (or the page can have scrolled) the instant this fires.
  const recolorCascade = () => {
    onRecolor?.();
    if (reduceMotion) return;

    // Waits one frame so the note grid has already committed (and painted)
    // each selected note's own NEW `${color}-bg` class before this reads
    // it back via getComputedStyle — otherwise every drop would carry
    // whatever color that note is about to leave, not the one it's headed
    // toward.
    requestAnimationFrame(() => {
      const bar = barRef.current;
      if (!bar) return;

      const barRect = bar.getBoundingClientRect();
      const originX = barRect.left + barRect.width / 2;
      const originY = barRect.top;

      const targets = Array.from(document.querySelectorAll(".note.selected"))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          return { el, x, y, dist: Math.hypot(x - originX, y - originY) };
        })
        .sort((a, b) => a.dist - b.dist);

      targets.forEach((target, i) => {
        const dot = document.createElement("span");
        dot.className = "bulk-recolor-drop";
        dot.style.backgroundColor = getComputedStyle(target.el).backgroundColor;
        document.body.appendChild(dot);

        gsap.fromTo(dot,
          { x: originX, y: originY, opacity: 0, scale: .3 },
          {
            x: target.x, y: target.y, opacity: 1, scale: 1,
            duration: RECOLOR_DROP_DURATION, delay: i * .025, ease: "power2.out",
            onComplete: () => {
              gsap.to(dot, {
                scale: 1.7, opacity: 0, duration: .22, ease: "power1.out",
                onComplete: () => dot.remove(),
              });
            },
          },
        );
      });
    });
  };

  return (
    <div className="bulk-bar-layer">
      <AnimatePresence>
        {
          count > 0 && (
            <motion.div
              ref={ barRef }
              className="bulk-bar"
              initial={{ opacity: 0, scale: .1, translateY: 60, borderRadius: 60 }}
              animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 20 }}
              /* Bloomed up from a dot through a real blob morph on the way
                 in (see useBlobClipMorph); on the way out it retreats the
                 same way — a last small swell before it collapses back
                 toward the dot it grew from, rather than a flat shrink. */
              exit={{
                opacity: 0,
                scale: [1, 1.06, .12],
                translateY: 46,
                borderRadius: 60,
                transition: EXIT_SPRING,
              }}
              transition={{ type: "spring", stiffness: 220, damping: 15, mass: barMass }}
              onUpdate={ onBlobUpdate }
            >
              <span className="bulk-bar-count">
                { displayedCount } selected
              </span>
              <motion.div className="bulk-bar-actions" variants={ actionRowVariants } initial="hidden" animate="shown">
                <motion.button
                  type="button"
                  aria-label="Star every selected note"
                  title="Star selection"
                  variants={ actionItemVariants }
                  whileHover={{ scale: 1.1, rotate: -8 }}
                  whileTap={{ scale: .9 }}
                  transition={ springy }
                  onTapStart={ starJelly.squash }
                  onClick={ onStar }
                >
                  <motion.span animate={ starJelly.jelly } style={{ display: "inline-flex" }}>
                    <FaStar />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label="Recolor every selected note"
                  title="Recolor selection"
                  variants={ actionItemVariants }
                  whileHover={{ scale: 1.1, rotate: 10 }}
                  whileTap={{ scale: .9 }}
                  transition={ springy }
                  onTapStart={ recolorJelly.squash }
                  onClick={ recolorCascade }
                >
                  <motion.span animate={ recolorJelly.jelly } style={{ display: "inline-flex" }}>
                    <FaPalette />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label="Export every selected note"
                  title="Export selection"
                  variants={ actionItemVariants }
                  whileHover={{ scale: 1.1, rotate: -10 }}
                  whileTap={{ scale: .9 }}
                  transition={ springy }
                  onTapStart={ exportJelly.squash }
                  onClick={ onExport }
                >
                  <motion.span animate={ exportJelly.jelly } style={{ display: "inline-flex" }}>
                    <FaFileArrowDown />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label="Archive every selected note"
                  title="Archive selection"
                  variants={ actionItemVariants }
                  whileHover={{ scale: 1.1, rotate: -8 }}
                  whileTap={{ scale: .9 }}
                  transition={ springy }
                  onTapStart={ archiveJelly.squash }
                  onClick={ onArchive }
                >
                  <motion.span animate={ archiveJelly.jelly } style={{ display: "inline-flex" }}>
                    <FaBoxArchive />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ reduceMotion ? "Delete every selected note" : "Hold to delete every selected note" }
                  title={ reduceMotion ? "Delete selection" : "Hold to delete selection" }
                  className="bulk-bar-danger"
                  variants={ actionItemVariants }
                  whileHover={{ scale: 1.1, rotate: 8 }}
                  whileTap={{ scale: .94 }}
                  transition={ springy }
                  onTapStart={ deleteJelly.squash }
                  { ...deleteHold.handlers }
                >
                  <motion.span animate={ deleteJelly.jelly } style={{ display: "inline-flex" }}>
                    <FaTrash />
                  </motion.span>
                  {
                    !reduceMotion && (
                      <svg className="bulk-hold-ring" viewBox="0 0 36 36" aria-hidden="true">
                        <motion.rect
                          x="1" y="1" width="34" height="34" rx="10"
                          initial={ false }
                          animate={{ pathLength: deleteHold.holding ? 1 : 0 }}
                          transition={
                            deleteHold.holding
                              ? { duration: HOLD_DELETE_MS / 1000, ease: "linear" }
                              : { duration: .18, ease: "easeOut" }
                          }
                          onAnimationComplete={ deleteHold.onComplete }
                        />
                      </svg>
                    )
                  }
                </motion.button>
              </motion.div>
              <motion.button
                type="button"
                aria-label="Done selecting"
                title="Done"
                className="bulk-bar-done"
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: .9 }}
                transition={ springy }
                onTapStart={ doneJelly.squash }
                onClick={ onDone }
              >
                <motion.span animate={ doneJelly.jelly } style={{ display: "inline-flex" }}>
                  <FaXmark />
                </motion.span>
              </motion.button>
            </motion.div>
          )
        }
      </AnimatePresence>
    </div>
  );
};

export default BulkActionBar;
