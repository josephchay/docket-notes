import { useCallback, useEffect, useRef, useState } from "react";
import { FaXmark, FaBolt } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import BoidField, { DEFAULT_SEPARATION_WEIGHT, DEFAULT_COHESION_WEIGHT } from "./BoidField";
import useOdometer from "../../hooks/useOdometer";

import "./BoidPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, CLOTH_EVENT, CHLADNI_EVENT) — a command palette
// entry fires this from anywhere.
export const BOID_EVENT = "docket:boid-field";

// A standalone showcase — a real Reynolds boids flock, see BoidField.jsx
// for the physics. Kept as its own panel rather than embedded anywhere,
// same reasoning as every other Particles/ panel — the simulation and
// WebGL context only exist while someone's actually looking at it.
const BoidPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const [separationWeight, setSeparationWeight] = useState(DEFAULT_SEPARATION_WEIGHT);
  const [cohesionWeight, setCohesionWeight] = useState(DEFAULT_COHESION_WEIGHT);
  // Bumped by the "Startle" button — a fresh random velocity kick for
  // every boid, so a visitor can watch real disorder resolve back into a
  // flock without closing and reopening the panel.
  const [scatterToken, setScatterToken] = useState(0);
  const [stats, setStats] = useState(null);
  const panelRef = useRef(null);

  const displayedCruise = useOdometer(Math.round((stats?.cruiseFraction ?? 0) * 100));
  const handleStats = useCallback((next) => setStats(next), []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(BOID_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(BOID_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="boid-field-layer"
      backdropClassName="boid-field-backdrop"
      panelClassName="boid-field-panel"
      ariaLabel="Murmuration"
    >
      <div className="boid-field-header">
        <h3>Murmuration</h3>
        <div className="boid-field-header-actions">
          {
            stats && (
              <span className="boid-field-stat" title="Average flock speed, as a share of top speed">
                { displayedCruise }% cruise
              </span>
            )
          }
          <button
            type="button"
            aria-label="Close"
            className="boid-field-close"
            onClick={ () => setOpen(false) }
          >
            <FaXmark />
          </button>
        </div>
      </div>
      <p className="boid-field-hint">Hover to draw the flock near — press and hold to startle it</p>

      <div className="boid-field-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the simulation and WebGL context actually run. */}
        <BoidField
          active={ open }
          reduceMotion={ reduceMotion }
          separationWeight={ separationWeight }
          cohesionWeight={ cohesionWeight }
          scatterToken={ scatterToken }
          onStats={ handleStats }
        />
      </div>

      <div className="boid-field-controls">
        <label className="boid-field-slider">
          <span>Separation</span>
          <input
            type="range"
            min={ 0.4 }
            max={ 3.2 }
            step={ 0.05 }
            value={ separationWeight }
            onChange={ (e) => setSeparationWeight(parseFloat(e.target.value)) }
            aria-label="Separation strength"
          />
        </label>
        <label className="boid-field-slider">
          <span>Cohesion</span>
          <input
            type="range"
            min={ 0.1 }
            max={ 2.2 }
            step={ 0.05 }
            value={ cohesionWeight }
            onChange={ (e) => setCohesionWeight(parseFloat(e.target.value)) }
            aria-label="Cohesion strength"
          />
        </label>
        <button type="button" className="boid-field-startle" onClick={ () => setScatterToken((t) => t + 1) }>
          <FaBolt />
          Startle
        </button>
      </div>
    </SheetPanel>
  );
};

export default BoidPanel;
