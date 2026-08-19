import { useCallback, useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import LeniaField from "./LeniaField";
import useOdometer from "../../hooks/useOdometer";

import "./LeniaPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, CHLADNI_EVENT, PENDULUM_EVENT) — a command palette
// entry fires this from anywhere.
export const LENIA_EVENT = "docket:lenia-field";

const DEFAULT_MU = 0.15;
const DEFAULT_SIGMA = 0.017;

// A standalone showcase — a real Lenia continuous cellular automaton, see
// LeniaField.jsx for the physics. Kept as its own panel rather than
// embedded anywhere, same reasoning as every other Particles/ panel — the
// simulation and WebGL context only exist while someone's actually looking
// at it.
const LeniaPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const [mu, setMu] = useState(DEFAULT_MU);
  const [sigma, setSigma] = useState(DEFAULT_SIGMA);
  // Bumped by the "Reseed" button — a fresh random soup under whatever
  // mu/sigma are current right now, the same explicit-not-automatic reset
  // InkBloomPanel's own presets use (a bare slider drag never triggers
  // this on its own, or every tick of a drag would blow away a field
  // that's already alive).
  const [resetToken, setResetToken] = useState(0);
  const [steps, setSteps] = useState(0);
  const panelRef = useRef(null);

  const displayedSteps = useOdometer(steps);
  const handleSteps = useCallback((n) => setSteps(n), []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(LENIA_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(LENIA_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="lenia-field-layer"
      backdropClassName="lenia-field-backdrop"
      panelClassName="lenia-field-panel"
      ariaLabel="Ink life"
    >
      <div className="lenia-field-header">
        <h3>Ink life</h3>
        <div className="lenia-field-header-actions">
          {
            steps > 0 && (
              <span className="lenia-field-stat" title="Simulation steps run so far">
                { displayedSteps.toLocaleString() } gen
              </span>
            )
          }
          <button
            type="button"
            aria-label="Close"
            className="lenia-field-close"
            onClick={ () => setOpen(false) }
          >
            <FaXmark />
          </button>
        </div>
      </div>
      <p className="lenia-field-hint">Drag to feed it — Center and Width decide whether it lives or fades</p>

      <div className="lenia-field-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the simulation and WebGL context actually run. */}
        <LeniaField
          active={ open }
          reduceMotion={ reduceMotion }
          mu={ mu }
          sigma={ sigma }
          resetToken={ resetToken }
          onSteps={ handleSteps }
        />
      </div>

      <div className="lenia-field-sliders">
        <label className="lenia-field-slider">
          <span>Center</span>
          <input
            type="range"
            min={ 0.05 }
            max={ 0.4 }
            step={ 0.001 }
            value={ mu }
            onChange={ (e) => setMu(parseFloat(e.target.value)) }
            aria-label="Growth center"
          />
        </label>
        <label className="lenia-field-slider">
          <span>Width</span>
          <input
            type="range"
            min={ 0.005 }
            max={ 0.05 }
            step={ 0.001 }
            value={ sigma }
            onChange={ (e) => setSigma(parseFloat(e.target.value)) }
            aria-label="Growth width"
          />
        </label>
        <button type="button" className="lenia-field-reseed" onClick={ () => setResetToken((t) => t + 1) }>
          Reseed
        </button>
      </div>
    </SheetPanel>
  );
};

export default LeniaPanel;
