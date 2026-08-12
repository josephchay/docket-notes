import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FaXmark } from "react-icons/fa6";

import { blobPath } from "../../utils/blob";
import SheetPanel from "../Sheet/SheetPanel";
import { SNAPPY } from "../Motion";
import NoteConstellation from "./NoteConstellation";

import "./NoteConstellationPanel.css";

// The empty pool's lone drop — one blob from the same generator every
// node silhouette comes from, rolled once per session load: the empty
// state speaks the exact ink language the notes will arrive in. Lives
// here rather than in NoteConstellation.jsx because THIS component owns
// the empty case — the constellation itself never mounts without notes.
const EMPTY_DROP_PATH = blobPath(56, 56, 8, 0.2);

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, FLUID_VISUALIZER_EVENT, CLOTH_EVENT) — a command
// palette entry fires this from anywhere. Unlike those, this one is a real
// feature over real desk data (see NoteConstellation.jsx for the actual
// force-directed layout), not a standalone physics showcase — which is why
// it opens full-viewport (radius=0, a full-bleed sheet) rather than the
// smaller min(520px,94vw) stage those use: a graph of the whole note
// collection needs real room, not a modal-sized window onto it.
export const NOTE_CONSTELLATION_EVENT = "docket:note-constellation";

const NoteConstellationPanel = ({ notes, openEditor, reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(NOTE_CONSTELLATION_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(NOTE_CONSTELLATION_EVENT, handleSummon);
    };
  }, []);

  // Selecting a node closes this panel and hands the note straight to the
  // editor — the same "tap a note, it opens" affordance the grid itself
  // already has, just reached through the graph instead.
  const handleSelect = (id) => {
    setOpen(false);
    openEditor?.(id);
  };

  // Short-circuited on `open` — this app-wide component tree re-renders
  // often (every note edit anywhere touches the `notes` array this panel
  // gets handed), and the tag-overlap scan below is real O(n²) work that
  // has no reason to run while the panel is sitting closed, which is most
  // of the time.
  const hasNotes = open && notes.length > 0;
  const hasEdges = hasNotes && notes.some((note, i) =>
    notes.slice(i + 1).some((other) => (note.tags || []).some((tag) => (other.tags || []).includes(tag)))
  );

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 0 }
      layerClassName="note-constellation-layer"
      backdropClassName="note-constellation-backdrop"
      panelClassName="note-constellation-panel"
      ariaLabel="Note constellation"
    >
      <div className="note-constellation-header">
        <h3>Note constellation</h3>
        <button
          type="button"
          aria-label="Close"
          className="note-constellation-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      {
        hasNotes && !hasEdges && (
          <p className="note-constellation-hint">Tag your notes to draw real connections between them</p>
        )
      }
      <div className="note-constellation-stage">
        {
          hasNotes ? (
            // Always mounted while open, same reasoning as every other
            // Particles/ panel — SheetPanel's own AnimatePresence already
            // owns the mount/unmount timing through its close animation;
            // `active` alone gates whether the layout simulation runs.
            // NoteConstellation.jsx genuinely unmounts once that close
            // finishes (it's nested inside SheetPanel's own exit-gated
            // subtree, which this component doesn't control), which is
            // why the handful of settings meant to survive a reopen — see
            // that file's own persistedPinnedIds comment — carry
            // themselves across in a plain module-level variable instead
            // of relying on the component instance surviving.
            <NoteConstellation active={ open } notes={ notes } onSelectNote={ handleSelect } reduceMotion={ reduceMotion } />
          ) : (
            open && (
              // Not an error state: an invitation, in the ink the notes
              // themselves will arrive as. The drop breathes on a slow
              // tide (still, under reduced motion).
              <motion.div
                className="note-constellation-empty-state"
                initial={ reduceMotion ? false : { opacity: 0, y: 10 } }
                animate={{ opacity: 1, y: 0 }}
                transition={ SNAPPY }
              >
                <motion.svg
                  viewBox="0 0 56 56"
                  className="note-constellation-empty-drop"
                  animate={ reduceMotion ? undefined : { scale: [1, 1.05, 1] } }
                  transition={ reduceMotion ? undefined : { duration: 4, repeat: Infinity, ease: "easeInOut" } }
                >
                  <path d={ EMPTY_DROP_PATH } />
                </motion.svg>
                <p className="note-constellation-empty-title">The pool is empty</p>
                <p className="note-constellation-empty-sub">
                  Pour a few notes onto the desk — every shared tag becomes a thread.
                </p>
              </motion.div>
            )
          )
        }
      </div>
    </SheetPanel>
  );
};

export default NoteConstellationPanel;
