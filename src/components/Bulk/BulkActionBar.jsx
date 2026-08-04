import React, { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaStar, FaPalette, FaFileArrowDown, FaTrash, FaXmark } from "react-icons/fa6";

import useJellyTap from "../../hooks/useJellyTap";
import useBlobClipMorph from "../../hooks/useBlobClipMorph";
import useOdometer from "../../hooks/useOdometer";

import "./BulkActionBar.css";

const springy = {
  type: "spring",
  stiffness: 400,
  damping: 17,
};

// The four action icons bounce in one after another once the bar itself
// has landed — the same recipe the header's color-filter chips use.
const actionRowVariants = {
  hidden: {},
  shown: {
    transition: { delayChildren: .1, staggerChildren: .05 },
  },
};

const actionItemVariants = {
  hidden: { opacity: 0, scale: 0, translateY: 12 },
  shown: {
    opacity: 1,
    scale: 1,
    translateY: 0,
    transition: { type: "spring", stiffness: 420, damping: 14 },
  },
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
const BulkActionBar = ({ count, onStar, onRecolor, onExport, onDelete, onDone }) => {
  const starJelly = useJellyTap();
  const recolorJelly = useJellyTap();
  const exportJelly = useJellyTap();
  const deleteJelly = useJellyTap();
  const doneJelly = useJellyTap();

  const barRef = useRef(null);
  const onBlobUpdate = useBlobClipMorph(barRef, count > 0, 20);
  const displayedCount = useOdometer(count);

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
              exit={{
                opacity: 0,
                scale: .2,
                translateY: 50,
                borderRadius: 60,
                transition: { duration: .2, ease: "easeIn" },
              }}
              transition={{ type: "spring", stiffness: 220, damping: 15 }}
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
                  onClick={ onRecolor }
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
                  aria-label="Delete every selected note"
                  title="Delete selection"
                  className="bulk-bar-danger"
                  variants={ actionItemVariants }
                  whileHover={{ scale: 1.1, rotate: 8 }}
                  whileTap={{ scale: .9 }}
                  transition={ springy }
                  onTapStart={ deleteJelly.squash }
                  onClick={ onDelete }
                >
                  <motion.span animate={ deleteJelly.jelly } style={{ display: "inline-flex" }}>
                    <FaTrash />
                  </motion.span>
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
