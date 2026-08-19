import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import InterferenceField from "./InterferenceField";

import "./InterferencePanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, LENIA_EVENT, EPICYCLE_EVENT) — a command palette
// entry fires this from anywhere.
export const INTERFERENCE_EVENT = "docket:interference-field";

// A standalone showcase — real wave interference from up to six point
// sources, see InterferenceField.jsx for the physics. Kept as its own
// panel rather than embedded anywhere, same reasoning as every other
// Particles/ panel — the simulation and WebGL context only exist while
// someone's actually looking at it. No stat pill and no slider here,
// unlike most of this panel's siblings — the only parameter a visitor
// actually controls is where they click, and there's no ongoing
// measurement of the field worth surfacing that "N sources" wouldn't just
// be restating what's already visible on the pond itself.
const InterferencePanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  // Bumped by the "Clear" button — empties the pond back to still water,
  // the same explicit reset every other Particles/ panel's own action
  // button already uses.
  const [resetToken, setResetToken] = useState(0);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(INTERFERENCE_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(INTERFERENCE_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="interference-field-layer"
      backdropClassName="interference-field-backdrop"
      panelClassName="interference-field-panel"
      ariaLabel="Ripples"
    >
      <div className="interference-field-header">
        <h3>Ripples</h3>
        <button
          type="button"
          aria-label="Close"
          className="interference-field-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      <p className="interference-field-hint">Click anywhere to drop a stone — watch where the rings cross</p>

      <div className="interference-field-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the simulation and WebGL context actually run. */}
        <InterferenceField
          active={ open }
          reduceMotion={ reduceMotion }
          resetToken={ resetToken }
        />
      </div>

      <div className="interference-field-controls">
        <button type="button" className="interference-field-clear" onClick={ () => setResetToken((t) => t + 1) }>
          Still water
        </button>
      </div>
    </SheetPanel>
  );
};

export default InterferencePanel;
