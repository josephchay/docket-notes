import { useCallback, useEffect, useRef, useState } from "react";
import { FaXmark, FaInfinity } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import PendulumField from "./PendulumField";
import useOdometer from "../../hooks/useOdometer";

import "./PendulumPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, BOID_EVENT, CRYSTAL_EVENT) — a command palette
// entry fires this from anywhere.
export const PENDULUM_EVENT = "docket:pendulum-field";

// A standalone showcase — 50 real double pendulums, see PendulumField.jsx
// for the physics (a genuine Lagrangian-mechanics ODE system, RK4-
// integrated). Kept as its own panel rather than embedded anywhere, same
// reasoning as every other Particles/ panel — the simulation and WebGL
// context only exist while someone's actually looking at it.
const PendulumPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  // Bumped by the "Release" button — snaps every pendulum back to the
  // default horizontal release angle and lets them fall fresh, the same
  // full-reset contract CrystalField's own "New crystal" already uses.
  const [scatterToken, setScatterToken] = useState(0);
  const [stats, setStats] = useState(null);
  const panelRef = useRef(null);

  const displayedSpread = useOdometer(stats?.spreadPct ?? 0);
  const handleStats = useCallback((next) => setStats(next), []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(PENDULUM_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(PENDULUM_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="pendulum-field-layer"
      backdropClassName="pendulum-field-backdrop"
      panelClassName="pendulum-field-panel"
      ariaLabel="Chaos"
    >
      <div className="pendulum-field-header">
        <h3>Chaos</h3>
        <div className="pendulum-field-header-actions">
          {
            stats && (
              <span className="pendulum-field-stat" title="How far the 50 pendulums have spread apart, as a share of their own reach — every one starts within a fraction of a degree of the others">
                { displayedSpread }% diverged
              </span>
            )
          }
          <button
            type="button"
            aria-label="Close"
            className="pendulum-field-close"
            onClick={ () => setOpen(false) }
          >
            <FaXmark />
          </button>
        </div>
      </div>
      <p className="pendulum-field-hint">Drag to pull it out and let go — 50 copies, each starting a hair's breadth apart</p>

      <div className="pendulum-field-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the simulation and WebGL context actually run. */}
        <PendulumField
          active={ open }
          reduceMotion={ reduceMotion }
          scatterToken={ scatterToken }
          onStats={ handleStats }
        />
      </div>

      <div className="pendulum-field-controls">
        <button type="button" className="pendulum-field-release" onClick={ () => setScatterToken((t) => t + 1) }>
          <FaInfinity />
          Release
        </button>
      </div>
    </SheetPanel>
  );
};

export default PendulumPanel;
