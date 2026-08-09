import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import ClothField from "./ClothField";

import "./ClothPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, FLUID_FIELD_EVENT, FLUID_VISUALIZER_EVENT) — a
// command palette entry fires this from anywhere.
export const CLOTH_EVENT = "docket:cloth-field";

// A standalone showcase — a real Verlet cloth (see ClothField.jsx and
// utils/verlet.js for the actual technique: position-based dynamics, not a
// spring-force simulation). Kept as its own panel rather than embedded
// anywhere, same reasoning as every other Particles/ panel — the physics
// loop only runs while someone's actually looking at it.
const ClothPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(CLOTH_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(CLOTH_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="cloth-field-layer"
      backdropClassName="cloth-field-backdrop"
      panelClassName="cloth-field-panel"
      ariaLabel="Cloth field"
    >
      <div className="cloth-field-header">
        <h3>Cloth field</h3>
        <button
          type="button"
          aria-label="Close"
          className="cloth-field-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      <p className="cloth-field-hint">Grab any thread and let go — it swings with real weight</p>
      <div className="cloth-field-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the physics loop actually runs. */}
        <ClothField active={ open } reduceMotion={ reduceMotion } />
      </div>
    </SheetPanel>
  );
};

export default ClothPanel;
