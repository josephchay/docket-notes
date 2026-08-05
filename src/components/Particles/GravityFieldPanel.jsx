import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import GravityField from "./GravityField";

import "./GravityFieldPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// INSIGHTS_EVENT, SHORTCUTS_EVENT, SETTINGS_EVENT) — a command palette
// entry fires this from anywhere.
export const GRAVITY_FIELD_EVENT = "docket:gravity-field";

// A standalone showcase, not wired into any real desk data — a true N-body
// gravitational simulation (see GravityField.jsx for the physics: real
// Newtonian gravity, softening, circular-orbit spawning, a symplectic
// integrator). Kept as its own panel rather than embedded anywhere, so the
// physics loop and WebGL context only exist while someone's actually
// looking at it.
const GravityFieldPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(GRAVITY_FIELD_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(GRAVITY_FIELD_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="gravity-field-layer"
      backdropClassName="gravity-field-backdrop"
      panelClassName="gravity-field-panel"
      ariaLabel="Gravity field"
    >
      <div className="gravity-field-header">
        <h3>Gravity field</h3>
        <button
          type="button"
          aria-label="Close"
          className="gravity-field-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      <p className="gravity-field-hint">Drag anywhere to sling a new body into orbit</p>
      <div className="gravity-field-stage">
        {/* Always mounted, same reasoning as ParticleCuboidPanel.jsx used to
            follow before that effect moved into Settings — SheetPanel's own
            AnimatePresence already owns the mount/unmount decision through
            its close animation, so gating a second time here would only
            race against it. The physics loop and WebGL context are what
            actually start and stop, gated entirely by `active`. */}
        <GravityField active={ open } reduceMotion={ reduceMotion } />
      </div>
    </SheetPanel>
  );
};

export default GravityFieldPanel;
