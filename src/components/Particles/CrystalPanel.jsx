import { useCallback, useEffect, useRef, useState } from "react";
import { FaXmark, FaSnowflake } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import CrystalField from "./CrystalField";
import useOdometer from "../../hooks/useOdometer";

import "./CrystalPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, CLOTH_EVENT, BOID_EVENT) — a command palette entry
// fires this from anywhere.
export const CRYSTAL_EVENT = "docket:crystal-field";

// A standalone showcase — a real diffusion-limited aggregation crystal, see
// CrystalField.jsx for the physics. Kept as its own panel rather than
// embedded anywhere, same reasoning as every other Particles/ panel — the
// simulation and WebGL context only exist while someone's actually looking
// at it.
const CrystalPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  // Bumped by the "New crystal" button — regrows from a single seed, the
  // only reset that makes sense here (see CrystalField.jsx's own comment:
  // nothing "undoes" a stuck particle the way a slider retune can for
  // ChladniField's live field).
  const [scatterToken, setScatterToken] = useState(0);
  const [stats, setStats] = useState(null);
  const panelRef = useRef(null);

  const grownPct = stats ? Math.round((100 * stats.aggregateSize) / stats.capacity) : 0;
  const displayedGrown = useOdometer(grownPct);
  const handleStats = useCallback((next) => setStats(next), []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(CRYSTAL_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(CRYSTAL_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="crystal-field-layer"
      backdropClassName="crystal-field-backdrop"
      panelClassName="crystal-field-panel"
      ariaLabel="Ink frost"
    >
      <div className="crystal-field-header">
        <h3>Ink frost</h3>
        <div className="crystal-field-header-actions">
          {
            stats && (
              <span className="crystal-field-stat" title="Share of the crystal's own maximum size already grown">
                { displayedGrown }% grown
              </span>
            )
          }
          <button
            type="button"
            aria-label="Close"
            className="crystal-field-close"
            onClick={ () => setOpen(false) }
          >
            <FaXmark />
          </button>
        </div>
      </div>
      <p className="crystal-field-hint">Watch it branch on its own, or drag to lean the growth your way</p>

      <div className="crystal-field-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the simulation and WebGL context actually run. */}
        <CrystalField
          active={ open }
          reduceMotion={ reduceMotion }
          scatterToken={ scatterToken }
          onStats={ handleStats }
        />
      </div>

      <div className="crystal-field-controls">
        <button type="button" className="crystal-field-regrow" onClick={ () => setScatterToken((t) => t + 1) }>
          <FaSnowflake />
          New crystal
        </button>
      </div>
    </SheetPanel>
  );
};

export default CrystalPanel;
