import { useCallback, useEffect, useRef, useState } from "react";
import { FaXmark, FaMinus, FaPlus, FaShuffle } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import ChladniField, { MODE_MIN, MODE_MAX, DEFAULT_MODE_A, DEFAULT_MODE_B } from "./ChladniField";
import useOdometer from "../../hooks/useOdometer";

import "./ChladniPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, CLOTH_EVENT, INK_BLOOM_EVENT) — a command palette
// entry fires this from anywhere.
export const CHLADNI_EVENT = "docket:chladni-field";

const clampMode = (n) => Math.min(MODE_MAX, Math.max(MODE_MIN, n));

// A standalone showcase — real Chladni figures, see ChladniField.jsx for
// the physics. Kept as its own panel rather than embedded anywhere, same
// reasoning as every other Particles/ panel — the simulation and WebGL
// context only exist while someone's actually looking at it.
const ChladniPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const [modeA, setModeA] = useState(DEFAULT_MODE_A);
  const [modeB, setModeB] = useState(DEFAULT_MODE_B);
  // Bumped by the "Scatter" button — re-randomizes every grain so a
  // visitor can watch the current pattern re-assert itself out of chaos
  // again without closing and reopening the panel.
  const [scatterToken, setScatterToken] = useState(0);
  const [stats, setStats] = useState(null);
  const panelRef = useRef(null);

  const displayedSettled = useOdometer(Math.round((stats?.settledFraction ?? 0) * 100));
  const handleStats = useCallback((next) => setStats(next), []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(CHLADNI_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(CHLADNI_EVENT, handleSummon);
    };
  }, []);

  const adjustModeA = (delta) => setModeA((m) => clampMode(m + delta));
  const adjustModeB = (delta) => setModeB((m) => clampMode(m + delta));

  const randomizeModes = () => {
    // Distinct mode numbers read as far richer figures than n = m (which
    // just draws a plain symmetric grid) — resampling on a collision
    // rather than allowing one keeps every "Shuffle" landing somewhere
    // genuinely worth looking at.
    let a = modeA;
    let b = modeB;
    while (a === b) {
      a = MODE_MIN + Math.floor(Math.random() * (MODE_MAX - MODE_MIN + 1));
      b = MODE_MIN + Math.floor(Math.random() * (MODE_MAX - MODE_MIN + 1));
    }
    setModeA(a);
    setModeB(b);
    setScatterToken((t) => t + 1);
  };

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="chladni-field-layer"
      backdropClassName="chladni-field-backdrop"
      panelClassName="chladni-field-panel"
      ariaLabel="Ink plate"
    >
      <div className="chladni-field-header">
        <h3>Ink plate</h3>
        <div className="chladni-field-header-actions">
          {
            stats && (
              <span className="chladni-field-stat" title="Share of grains currently settled on a nodal line">
                { displayedSettled }% settled
              </span>
            )
          }
          <button
            type="button"
            aria-label="Close"
            className="chladni-field-close"
            onClick={ () => setOpen(false) }
          >
            <FaXmark />
          </button>
        </div>
      </div>
      <p className="chladni-field-hint">Drag to disturb the grains — they always find their way back to the pattern</p>

      <div className="chladni-field-controls">
        <div className="chladni-mode-stepper">
          <span className="chladni-mode-label">Mode A</span>
          <button type="button" aria-label="Decrease mode A" onClick={ () => adjustModeA(-1) } disabled={ modeA <= MODE_MIN }>
            <FaMinus />
          </button>
          <span className="chladni-mode-value">{ modeA }</span>
          <button type="button" aria-label="Increase mode A" onClick={ () => adjustModeA(1) } disabled={ modeA >= MODE_MAX }>
            <FaPlus />
          </button>
        </div>
        <div className="chladni-mode-stepper">
          <span className="chladni-mode-label">Mode B</span>
          <button type="button" aria-label="Decrease mode B" onClick={ () => adjustModeB(-1) } disabled={ modeB <= MODE_MIN }>
            <FaMinus />
          </button>
          <span className="chladni-mode-value">{ modeB }</span>
          <button type="button" aria-label="Increase mode B" onClick={ () => adjustModeB(1) } disabled={ modeB >= MODE_MAX }>
            <FaPlus />
          </button>
        </div>
        <button type="button" className="chladni-shuffle" onClick={ randomizeModes }>
          <FaShuffle />
          Shuffle
        </button>
      </div>

      <div className="chladni-field-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the simulation and WebGL context actually run. */}
        <ChladniField
          active={ open }
          reduceMotion={ reduceMotion }
          modeA={ modeA }
          modeB={ modeB }
          scatterToken={ scatterToken }
          onStats={ handleStats }
        />
      </div>
    </SheetPanel>
  );
};

export default ChladniPanel;
