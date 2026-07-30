import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaXmark, FaClockRotateLeft } from "react-icons/fa6";

import { timeAgo } from "../../utils/date";

import "./HistoryPanel.css";

// The event the command palette's "Show edit history" entry fires to
// summon this panel from anywhere.
export const HISTORY_EVENT = "docket:history";

// The undo/redo stack Home.jsx already keeps, made visible: one tick per
// tracked edit, oldest on the left, "now" marked, redone-away-from states
// (if any) trailing off to the right. Dragging anywhere on the rail scrubs
// live across the whole session's edits — no stepping one Ctrl+Z at a
// time — landing wherever you let go. onPan reports pointer movement
// without framer laying a transform of its own onto the rail, so the
// playhead's rendered position stays a single, ordinary React value
// (cursor) the whole time; nothing here fights over who owns it.
const HistoryPanel = ({ timeline, cursor, onJump }) => {
  const [open, setOpen] = useState(false);
  const trackRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(HISTORY_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(HISTORY_EVENT, handleSummon);
    };
  }, []);

  const indexFromPoint = (x) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || timeline.length < 2) return cursor;

    const ratio = Math.min(Math.max((x - rect.left) / rect.width, 0), 1);
    return Math.round(ratio * (timeline.length - 1));
  };

  const handlePan = (_e, info) => onJump(indexFromPoint(info.point.x));
  const handleTrackClick = (e) => onJump(indexFromPoint(e.clientX));

  // timeline[cursor] is always the "now" placeholder — cursor is defined as
  // undoStack.length, which is exactly where that entry sits — so it can't
  // tell you what you're actually looking at. Every OTHER entry's label
  // describes the edit that turned it into the next one, so the entry
  // right before cursor is the one whose label describes how the desk
  // arrived at its current state; nothing before index 0 means there's
  // nowhere further back to have arrived from.
  const arrivedVia = cursor > 0 ? timeline[cursor - 1] : null;
  const pct = timeline.length > 1 ? (cursor / (timeline.length - 1)) * 100 : 0;

  return (
    <AnimatePresence>
      {
        open && (
          <div className="history-layer">
            <motion.div
              className="history-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .2 } }}
              onClick={ () => setOpen(false) }
            />
            <motion.div
              className="history-panel"
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
              <div className="history-header">
                <h3>Edit history</h3>
                <motion.button
                  type="button"
                  aria-label="Close"
                  className="history-close"
                  whileHover={{ scale: 1.15, rotate: 90 }}
                  whileTap={{ scale: .9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  onClick={ () => setOpen(false) }
                >
                  <FaXmark />
                </motion.button>
              </div>

              <div className="history-body">
                {
                  timeline.length < 2 ? (
                    <div className="history-empty">
                      <FaClockRotateLeft className="history-empty-icon" />
                      <p>Nothing tracked yet this session — edit a note or two.</p>
                    </div>
                  ) : (
                    <>
                      <motion.div
                        key={ cursor }
                        className="history-now"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 26 }}
                      >
                        <span className="history-now-label">
                          {
                            arrivedVia
                              ? arrivedVia.label.charAt(0).toUpperCase() + arrivedVia.label.slice(1)
                              : "The very start"
                          }
                        </span>
                        <span className="history-now-time">
                          { arrivedVia ? timeAgo(arrivedVia.at) : "session start" }
                        </span>
                      </motion.div>

                      <div
                        ref={ trackRef }
                        className="history-track"
                        onClick={ handleTrackClick }
                      >
                        <div className="history-track-rail" />
                        {
                          timeline.map((entry, index) => (
                            <button
                              key={ index }
                              type="button"
                              className={ `history-tick ${ index === cursor ? "active" : "" } ${ entry.label === "now" ? "is-now" : "" }` }
                              style={{ left: `${ timeline.length > 1 ? (index / (timeline.length - 1)) * 100 : 0 }%` }}
                              title={ entry.label === "now" ? "Right now" : entry.label }
                              onClick={ (e) => { e.stopPropagation(); onJump(index); } }
                            />
                          ))
                        }
                        <motion.div
                          className="history-playhead"
                          animate={{ left: `${ pct }%` }}
                          transition={{ type: "spring", stiffness: 500, damping: 32 }}
                          onPan={ handlePan }
                        />
                      </div>

                      <div className="history-track-labels">
                        <span>Oldest</span>
                        <span>{ redoStackHint(timeline, cursor) }</span>
                      </div>
                    </>
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

// The right-hand label reads "Newest" once the visitor has actually undone
// into the past (there's somewhere forward to go); otherwise there's
// nothing queued up ahead, so it just names what's there — now.
const redoStackHint = (timeline, cursor) => (cursor < timeline.length - 1 ? "Newest" : "Now");

export default HistoryPanel;
