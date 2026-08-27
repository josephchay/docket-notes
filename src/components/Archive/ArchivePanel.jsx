import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaXmark, FaArrowRotateLeft, FaBoxArchive, FaPen } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import SparkBurst from "../Spark/SparkBurst";
import { checklistAwareText } from "../../utils/checklist";

import "./ArchivePanel.css";

// The event the command palette's "Open the archive" entry (and the
// toolbar's archive button) fire to summon this panel from anywhere.
export const ARCHIVE_EVENT = "docket:archive";

// Everything set aside this session — a soft, reversible "not right now"
// distinct from the Trash's "gone for good." Archiving never actually
// removes a note from `notes` (see Home.jsx's archiveNote) — it just wears
// a flag the desk's own views filter out, the same way a locked note stays
// fully present but read-only — so unarchiving is a flat flag flip with no
// restore-to-original-position bookkeeping the way the Trash needs. The
// pen opens a note straight in the focus editor without bringing it back
// onto the desk at all: tucking something away for later reference
// shouldn't require putting it back out just to reread it.
const ArchivePanel = ({ entries, onUnarchive, onOpen, reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  // A small handful of ink sparks off the restore button — same recipe
  // Header/Note/TrashPanel already reuse for "yes, that landed."
  const [restoreBurst, setRestoreBurst] = useState(null);
  const burstTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(burstTimerRef.current), []);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(ARCHIVE_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(ARCHIVE_EVENT, handleSummon);
    };
  }, []);

  const handleUnarchive = (noteId) => {
    setRestoreBurst(noteId);
    clearTimeout(burstTimerRef.current);
    burstTimerRef.current = setTimeout(() => setRestoreBurst(null), 600);
    onUnarchive(noteId);
  };

  const handleOpen = (noteId) => {
    setOpen(false);
    onOpen(noteId);
  };

  const labelFor = (note) => {
    const title = note.title?.trim();
    if (title) return title;

    const text = checklistAwareText(note.text).trim();
    if (text) return text.length > 60 ? `${ text.slice(0, 60) }…` : text;

    return "Untitled note";
  };

  // Most recently set aside first, same convention as the Trash's own list
  // — but unlike the Trash (which appends a fresh DeletedEntry the instant
  // something's deleted, so its own array order already IS deletion order),
  // archiving just flips a flag on a note that stays exactly where it was
  // in the shared desk array (see archiveNote/bulkArchive in Home.jsx) — a
  // plain reverse() would sort by ARRAY position (roughly note-creation
  // order) instead, which drifts from actual archive order the moment two
  // notes are archived out of that order. archivedAt is the one field that
  // actually tracks when each note was set aside.
  const sorted = [...entries].sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="archive-layer"
      backdropClassName="archive-backdrop"
      panelClassName="archive-panel"
      ariaLabel="Archive"
    >
      <div className="archive-header">
        <h3>Archive</h3>
        <motion.button
          type="button"
          aria-label="Close"
          className="archive-close"
          whileHover={{ scale: 1.15, rotate: 90 }}
          whileTap={{ scale: .9 }}
          transition={{ type: "spring", stiffness: 420, damping: 16 }}
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </motion.button>
      </div>

      <div className="archive-body">
        {
          entries.length === 0 ? (
            <motion.div
              className="archive-empty"
              initial={{ opacity: 0, scale: .7, translateY: 14 }}
              animate={{ opacity: 1, scale: 1, translateY: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 18 }}
            >
              <motion.span
                initial={{ rotate: -18, scale: .6 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 14, delay: .08 }}
              >
                <FaBoxArchive className="archive-empty-icon" />
              </motion.span>
              <p>Nothing set aside this session.</p>
            </motion.div>
          ) : (
            <ul className="archive-list">
              <AnimatePresence initial={ false }>
                {
                  sorted.map((note) => (
                    <motion.li
                      key={ note.id }
                      className="archive-item"
                      layout
                      initial={{ opacity: 0, y: -10, scale: .92 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{
                        opacity: 0,
                        scale: .4,
                        y: -80,
                        rotate: -10,
                        transition: { type: "spring", stiffness: 320, damping: 16 },
                      }}
                      transition={{ type: "spring", stiffness: 380, damping: 26 }}
                    >
                      <span className={ `archive-item-swatch ${ note.color }-bg` } aria-hidden="true" />
                      <div className="archive-item-body">
                        <span className="archive-item-title">{ labelFor(note) }</span>
                        <span className="archive-item-time">{ note.time }</span>
                      </div>
                      <motion.button
                        type="button"
                        className="archive-item-open"
                        aria-label="View this note"
                        title="View"
                        whileHover={{ scale: 1.12 }}
                        whileTap={{ scale: .88 }}
                        transition={{ type: "spring", stiffness: 420, damping: 16 }}
                        onClick={ () => handleOpen(note.id) }
                      >
                        <FaPen />
                      </motion.button>
                      <motion.button
                        type="button"
                        className="archive-item-restore"
                        aria-label="Bring this note back to the desk"
                        title="Unarchive"
                        whileHover={{ scale: 1.12 }}
                        whileTap={{ scale: .88 }}
                        transition={{ type: "spring", stiffness: 420, damping: 16 }}
                        onClick={ () => handleUnarchive(note.id) }
                      >
                        <FaArrowRotateLeft />
                        <SparkBurst
                          active={ restoreBurst === note.id }
                          count={ 5 }
                          angleOffset={ -Math.PI / 2 }
                          radius={ 20 }
                          duration={ .5 }
                          className="archive-restore-burst"
                        />
                      </motion.button>
                    </motion.li>
                  ))
                }
              </AnimatePresence>
            </ul>
          )
        }
      </div>
    </SheetPanel>
  );
};

export default ArchivePanel;
