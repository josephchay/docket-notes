import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import ParticleCuboid from "./ParticleCuboid";

import "./ParticleCuboidPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// INSIGHTS_EVENT, SHORTCUTS_EVENT, SETTINGS_EVENT) — a command palette entry
// fires this from anywhere.
export const PARTICLE_CUBOID_EVENT = "docket:particle-cuboid";

// A standalone showcase, not wired into any real desk data — a cuboid
// lattice of ink particles on real damped springs, pushed through by the
// cursor via genuine inverse-square repulsion (see ParticleCuboid.jsx for
// the physics and the 3D↔2D projection it leans on Three.js's own Camera
// for rather than hand-deriving). Kept as its own panel — not mounted
// anywhere it would run for free — so the WebGL context and physics loop
// only exist while someone's actually looking at it.
const ParticleCuboidPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(PARTICLE_CUBOID_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(PARTICLE_CUBOID_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="particle-cuboid-layer"
      backdropClassName="particle-cuboid-backdrop"
      panelClassName="particle-cuboid-panel"
      ariaLabel="Particle cuboid"
    >
      <div className="particle-cuboid-header">
        <h3>Ink cuboid</h3>
        <button
          type="button"
          aria-label="Close"
          className="particle-cuboid-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      <p className="particle-cuboid-hint">Push through it, or grab a particle and drag</p>
      <div className="particle-cuboid-stage">
        {/* No extra `open &&` gate here — SheetPanel already owns exactly
            that decision (its own AnimatePresence is what keeps this
            mounted through its own close animation in the first place), so
            gating a second time here would only race against it. The WebGL
            context, physics loop, and listeners are what actually start and
            stop, gated entirely by the `active` prop below — ParticleCuboid's
            own effect no-ops and disposes cleanly whenever it's false,
            regardless of whether this element itself is still on-screen. */}
        <ParticleCuboid active={ open } reduceMotion={ reduceMotion } />
      </div>
    </SheetPanel>
  );
};

export default ParticleCuboidPanel;
