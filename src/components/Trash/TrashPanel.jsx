import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaXmark, FaArrowRotateLeft, FaTrash, FaBoxArchive } from "react-icons/fa6";

import { timeAgo } from "../../utils/date";

import "./TrashPanel.css";

// The event the command palette's "Open the trash" entry (and the
// toolbar's trash button) fire to summon this panel from anywhere.
export const TRASH_EVENT = "docket:trash";

// Every note deleted this session, not just the last few the toast deck had
// room for — opened the same dot-to-sheet way as the command palette and
// desk insights. Restoring peels a note back out toward the grid it came
// from; shredding crumples it away for good instead — two different exits
// off the one list, so the panel reads the difference even without text.
const TrashPanel = ({ entries, onRestore, onShred, onEmpty }) => {
  const [open, setOpen] = useState(false);
  const [pendingExit, setPendingExit] = useState({});

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(TRASH_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(TRASH_EVENT, handleSummon);
    };
  }, []);

  const handleRestore = (noteId) => {
    setPendingExit((prev) => ({ ...prev, [noteId]: "restore" }));
    onRestore(noteId);
  };

  const handleShred = (noteId) => {
    setPendingExit((prev) => ({ ...prev, [noteId]: "shred" }));
    onShred(noteId);
  };

  const handleEmptyAll = () => {
    setPendingExit((prev) => {
      const next = { ...prev };
      entries.forEach((entry) => { next[entry.note.id] = "shred"; });
      return next;
    });
    onEmpty();
  };

  // Most recently trashed first, same as any trash view — entries itself
  // arrives oldest-first (deletion order), this just flips the display.
  const sorted = [...entries].reverse();

  const labelFor = (note) => {
    const title = note.title?.trim();
    if (title) return title;

    const text = note.text?.trim();
    if (text) return text.length > 60 ? `${ text.slice(0, 60) }…` : text;

    return "Untitled note";
  };

  return (
    <AnimatePresence>
      {
        open && (
          <div className="trash-layer">
            <motion.div
              className="trash-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .2 } }}
              onClick={ () => setOpen(false) }
            />
            <motion.div
              className="trash-panel"
              initial={{ opacity: 0, scale: .1, translateY: 90, borderRadius: 60 }}
              animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 22 }}
              exit={{
                opacity: 0,
                scale: .24,
                translateY: 60,
                borderRadius: 50,
                transition: { duration: .2, ease: "easeIn" },
              }}
              transition={{ type: "spring", stiffness: 190, damping: 14 }}
            >
              <div className="trash-header">
                <h3>Trash</h3>
                <div className="trash-header-actions">
                  {
                    entries.length > 0 && (
                      <motion.button
                        type="button"
                        className="trash-empty-all"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: .94 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        onClick={ handleEmptyAll }
                      >
                        Empty trash
                      </motion.button>
                    )
                  }
                  <motion.button
                    type="button"
                    aria-label="Close"
                    className="trash-close"
                    whileHover={{ scale: 1.15, rotate: 90 }}
                    whileTap={{ scale: .9 }}
                    transition={{ type: "spring", stiffness: 420, damping: 16 }}
                    onClick={ () => setOpen(false) }
                  >
                    <FaXmark />
                  </motion.button>
                </div>
              </div>

              <div className="trash-body">
                {
                  entries.length === 0 ? (
                    <div className="trash-empty">
                      <FaBoxArchive className="trash-empty-icon" />
                      <p>Nothing in the trash this session.</p>
                    </div>
                  ) : (
                    <ul className="trash-list">
                      <AnimatePresence initial={ false }>
                        {
                          sorted.map((entry) => (
                            <motion.li
                              key={ entry.note.id }
                              className="trash-item"
                              layout
                              initial={{ opacity: 0, y: -10, scale: .92 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={
                                pendingExit[entry.note.id] === "shred"
                                  ? {
                                    opacity: 0,
                                    scale: .4,
                                    rotate: 14,
                                    x: 50,
                                    transition: { duration: .32, ease: "easeIn" },
                                  }
                                  : {
                                    opacity: 0,
                                    scale: .5,
                                    x: -60,
                                    transition: { duration: .28, ease: "easeIn" },
                                  }
                              }
                              transition={{ type: "spring", stiffness: 380, damping: 26 }}
                            >
                              <span className={ `trash-item-swatch ${ entry.note.color }-bg` } />
                              <div className="trash-item-body">
                                <span className="trash-item-title">{ labelFor(entry.note) }</span>
                                <span className="trash-item-time">{ timeAgo(entry.deletedAt) }</span>
                              </div>
                              <motion.button
                                type="button"
                                className="trash-item-restore"
                                aria-label="Restore this note"
                                title="Restore"
                                whileHover={{ scale: 1.12 }}
                                whileTap={{ scale: .88 }}
                                transition={{ type: "spring", stiffness: 420, damping: 16 }}
                                onClick={ () => handleRestore(entry.note.id) }
                              >
                                <FaArrowRotateLeft />
                              </motion.button>
                              <motion.button
                                type="button"
                                className="trash-item-shred"
                                aria-label="Delete this note forever"
                                title="Delete forever"
                                whileHover={{ scale: 1.12, rotate: -10 }}
                                whileTap={{ scale: .88 }}
                                transition={{ type: "spring", stiffness: 420, damping: 16 }}
                                onClick={ () => handleShred(entry.note.id) }
                              >
                                <FaTrash />
                              </motion.button>
                            </motion.li>
                          ))
                        }
                      </AnimatePresence>
                    </ul>
                  )
                }
              </div>
            </motion.div>
          </div>
        )
      }
    </AnimatePresence>
  );
};

export default TrashPanel;
