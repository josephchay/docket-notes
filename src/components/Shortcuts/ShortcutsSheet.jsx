import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaXmark } from "react-icons/fa6";

import "./ShortcutsSheet.css";

// The event the command palette's "Show keyboard shortcuts" entry fires to
// summon this sheet from anywhere.
export const SHORTCUTS_EVENT = "docket:shortcuts";

const SHORTCUTS = [
  { keys: ["N"], label: "Pour a new note" },
  { keys: ["F"], label: "Toggle focus mode" },
  { keys: ["/"], label: "Jump to search" },
  { keys: ["Ctrl", "K"], label: "Open the command palette" },
  { keys: ["Ctrl", "Z"], label: "Undo the last edit" },
  { keys: ["Ctrl", "Shift", "Z"], label: "Redo the last undo" },
  { keys: ["↑", "↓"], label: "Move through a list" },
  { keys: ["Enter"], label: "Confirm the highlighted row" },
  { keys: ["Esc"], label: "Close whatever's open" },
  { keys: ["?"], label: "Show this sheet" },
];

// A quick reference for the desk's keyboard shortcuts. "?" summons it
// (guarded the same way as N and / in Home.jsx — it stands down while any
// field has the caret). Built from the same dot-to-sheet morph recipe as
// the command palette, kept as its own component since this one has no
// casting phase — just a look-up, staggered in row by row.
const ShortcutsSheet = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;

      if (e.key === "?") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(SHORTCUTS_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(SHORTCUTS_EVENT, handleSummon);
    };
  }, []);

  return (
    <AnimatePresence>
      {
        open && (
          <div className="shortcuts-layer">
            <motion.div
              className="shortcuts-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .2 } }}
              onClick={ () => setOpen(false) }
            />
            <motion.div
              className="shortcuts-panel"
              initial={{ opacity: 0, scale: .1, translateY: 90, borderRadius: 60 }}
              animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 20 }}
              exit={{
                opacity: 0,
                scale: .24,
                translateY: 60,
                borderRadius: 50,
                transition: { duration: .2, ease: "easeIn" },
              }}
              transition={{ type: "spring", stiffness: 190, damping: 14 }}
            >
              <div className="shortcuts-header">
                <h3>Shortcuts</h3>
                <motion.button
                  type="button"
                  aria-label="Close"
                  className="shortcuts-close"
                  whileHover={{ scale: 1.15, rotate: 90 }}
                  whileTap={{ scale: .9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  onClick={ () => setOpen(false) }
                >
                  <FaXmark />
                </motion.button>
              </div>
              <div className="shortcuts-list">
                {
                  SHORTCUTS.map((row, index) => (
                    <motion.div
                      key={ row.label }
                      className="shortcuts-row"
                      initial={{ opacity: 0, translateX: -16 }}
                      animate={{ opacity: 1, translateX: 0 }}
                      transition={{
                        type: "spring",
                        stiffness: 340,
                        damping: 20,
                        delay: .05 + index * .04,
                      }}
                    >
                      <span className="shortcuts-row-label">{ row.label }</span>
                      <span className="shortcuts-row-keys">
                        {
                          row.keys.map((key) => (
                            <kbd key={ key } className="shortcuts-key">{ key }</kbd>
                          ))
                        }
                      </span>
                    </motion.div>
                  ))
                }
              </div>
            </motion.div>
          </div>
        )
      }
    </AnimatePresence>
  );
};

export default ShortcutsSheet;
