import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import FluidField from "./FluidField";

import "./FluidFieldPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// INSIGHTS_EVENT, SHORTCUTS_EVENT, GRAVITY_FIELD_EVENT) — a command palette
// entry fires this from anywhere.
export const FLUID_FIELD_EVENT = "docket:fluid-field";

// A standalone showcase — a real (if deliberately modest) SPH fluid, see
// FluidField.jsx for the physics. Worth knowing going in: unlike the
// cuboid's spring lattice or the gravity field's Newtonian orbits, SPH's
// exact *feel* — how thick, how splashy, how much it settles versus
// sloshes — comes from the interplay of several constants (stiffness,
// viscosity, rest density) that don't reduce to one clean hand-checkable
// number the way a spring's ω·dt or an orbit's period does. The kernel
// math and the CFL-style stability bound are verified in FluidField.jsx's
// own comments; the aesthetic tuning past that point is the one thing in
// this whole particles/ series that couldn't be fully confirmed without
// actually watching it run.
const FluidFieldPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(FLUID_FIELD_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(FLUID_FIELD_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="fluid-field-layer"
      backdropClassName="fluid-field-backdrop"
      panelClassName="fluid-field-panel"
      ariaLabel="Fluid field"
    >
      <div className="fluid-field-header">
        <h3>Fluid field</h3>
        <button
          type="button"
          aria-label="Close"
          className="fluid-field-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      <p className="fluid-field-hint">Move the cursor through it to stir</p>
      <div className="fluid-field-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the physics loop and WebGL context actually run. */}
        <FluidField active={ open } reduceMotion={ reduceMotion } />
      </div>
    </SheetPanel>
  );
};

export default FluidFieldPanel;
