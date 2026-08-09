import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import NoteConstellation from "./NoteConstellation";

import "./NoteConstellationPanel.css";

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
            <NoteConstellation active={ open } notes={ notes } onSelectNote={ handleSelect } reduceMotion={ reduceMotion } />
          ) : (
            <p className="note-constellation-empty">Pour a few notes first — the constellation needs something to map</p>
          )
        }
      </div>
    </SheetPanel>
  );
};

export default NoteConstellationPanel;
