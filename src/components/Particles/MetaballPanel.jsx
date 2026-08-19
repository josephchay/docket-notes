import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import MetaballField from "./MetaballField";

import "./MetaballPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, INTERFERENCE_EVENT, LSYSTEM_EVENT) — a command
// palette entry fires this from anywhere.
export const METABALL_EVENT = "docket:metaball-field";

// A standalone showcase — real raymarched 3D metaballs, see
// MetaballField.jsx for the rendering technique. Kept as its own panel
// rather than embedded anywhere, same reasoning as every other Particles/
// panel — the simulation and WebGL context only exist while someone's
// actually looking at it. No stat pill and no slider here, unlike most of
// this panel's siblings — the actual subject is the render itself, not a
// tunable parameter or an evolving measurement worth surfacing.
const MetaballPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  // Bumped by the "Toss" button — a fresh upward velocity kick for every
  // blob, positions untouched, so they genuinely bounce and resettle from
  // real momentum rather than teleporting back to a tidy start.
  const [tossToken, setTossToken] = useState(0);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(METABALL_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(METABALL_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="metaball-field-layer"
      backdropClassName="metaball-field-backdrop"
      panelClassName="metaball-field-panel"
      ariaLabel="Droplets"
    >
      <div className="metaball-field-header">
        <h3>Droplets</h3>
        <button
          type="button"
          aria-label="Close"
          className="metaball-field-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      <p className="metaball-field-hint">Drag to swat them apart — watch how they melt back together</p>

      <div className="metaball-field-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the simulation and WebGL context actually run. */}
        <MetaballField
          active={ open }
          reduceMotion={ reduceMotion }
          tossToken={ tossToken }
        />
      </div>

      <div className="metaball-field-controls">
        <button type="button" className="metaball-field-toss" onClick={ () => setTossToken((t) => t + 1) }>
          Toss
        </button>
      </div>
    </SheetPanel>
  );
};

export default MetaballPanel;
