import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaStar, FaPalette, FaFileArrowDown, FaTrash, FaXmark } from "react-icons/fa6";

import "./BulkActionBar.css";

const springy = {
  type: "spring",
  stiffness: 400,
  damping: 17,
};

// Morphs up from the bottom edge the moment the first note is selected — a
// dot-to-bar expansion, ink-on-paper like the command palette — and folds
// back down to nothing the moment the last one is deselected.
const BulkActionBar = ({ count, onStar, onRecolor, onExport, onDelete, onDone }) => (
  <div className="bulk-bar-layer">
    <AnimatePresence>
      {
        count > 0 && (
          <motion.div
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
          >
            <motion.span
              key={ count }
              className="bulk-bar-count"
              initial={{ scale: .5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 18 }}
            >
              { count } selected
            </motion.span>
            <div className="bulk-bar-actions">
              <motion.button
                type="button"
                aria-label="Star every selected note"
                title="Star selection"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: .9 }}
                transition={ springy }
                onClick={ onStar }
              >
                <FaStar />
              </motion.button>
              <motion.button
                type="button"
                aria-label="Recolor every selected note"
                title="Recolor selection"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: .9 }}
                transition={ springy }
                onClick={ onRecolor }
              >
                <FaPalette />
              </motion.button>
              <motion.button
                type="button"
                aria-label="Export every selected note"
                title="Export selection"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: .9 }}
                transition={ springy }
                onClick={ onExport }
              >
                <FaFileArrowDown />
              </motion.button>
              <motion.button
                type="button"
                aria-label="Delete every selected note"
                title="Delete selection"
                className="bulk-bar-danger"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: .9 }}
                transition={ springy }
                onClick={ onDelete }
              >
                <FaTrash />
              </motion.button>
            </div>
            <motion.button
              type="button"
              aria-label="Done selecting"
              title="Done"
              className="bulk-bar-done"
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: .9 }}
              transition={ springy }
              onClick={ onDone }
            >
              <FaXmark />
            </motion.button>
          </motion.div>
        )
      }
    </AnimatePresence>
  </div>
);

export default BulkActionBar;
