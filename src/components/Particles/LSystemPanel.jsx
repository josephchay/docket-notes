import { useEffect, useRef, useState } from "react";
import { FaXmark, FaMinus, FaPlus, FaSeedling } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import LSystemField, { PRESETS, ITERATIONS_MIN, ITERATIONS_MAX, DEFAULT_ITERATIONS } from "./LSystemField";

import "./LSystemPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, LENIA_EVENT, INTERFERENCE_EVENT) — a command
// palette entry fires this from anywhere.
export const LSYSTEM_EVENT = "docket:lsystem-field";

const clampIterations = (n) => Math.min(ITERATIONS_MAX, Math.max(ITERATIONS_MIN, n));

// A standalone showcase — real L-systems, see LSystemField.jsx for the
// grammar and the turtle-graphics interpretation of it. Kept as its own
// panel rather than embedded anywhere, same reasoning as every other
// Particles/ panel — the simulation and WebGL context only exist while
// someone's actually looking at it.
const LSystemPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(PRESETS[0]);
  const [iterations, setIterations] = useState(DEFAULT_ITERATIONS);
  const [regrowToken, setRegrowToken] = useState(0);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(LSYSTEM_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(LSYSTEM_EVENT, handleSummon);
    };
  }, []);

  const adjustIterations = (delta) => setIterations((n) => clampIterations(n + delta));

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="lsystem-field-layer"
      backdropClassName="lsystem-field-backdrop"
      panelClassName="lsystem-field-panel"
      ariaLabel="Growth"
    >
      <div className="lsystem-field-header">
        <h3>Growth</h3>
        <button
          type="button"
          aria-label="Close"
          className="lsystem-field-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      <p className="lsystem-field-hint">A whole plant grown from three symbols: draw forward, turn, branch</p>

      <div className="lsystem-field-presets">
        {
          PRESETS.map((p) => (
            <button
              key={ p.key }
              type="button"
              className={ `lsystem-field-preset ${ preset.key === p.key ? "active" : "" }` }
              onClick={ () => setPreset(p) }
            >
              { p.label }
            </button>
          ))
        }
      </div>

      <div className="lsystem-field-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the simulation and WebGL context actually run. */}
        <LSystemField
          active={ open }
          reduceMotion={ reduceMotion }
          preset={ preset }
          iterations={ iterations }
          regrowToken={ regrowToken }
        />
      </div>

      <div className="lsystem-field-controls">
        <div className="lsystem-iteration-stepper">
          <span className="lsystem-iteration-label">Detail</span>
          <button type="button" aria-label="Fewer iterations" onClick={ () => adjustIterations(-1) } disabled={ iterations <= ITERATIONS_MIN }>
            <FaMinus />
          </button>
          <span className="lsystem-iteration-value">{ iterations }</span>
          <button type="button" aria-label="More iterations" onClick={ () => adjustIterations(1) } disabled={ iterations >= ITERATIONS_MAX }>
            <FaPlus />
          </button>
        </div>
        <button type="button" className="lsystem-field-regrow" onClick={ () => setRegrowToken((t) => t + 1) }>
          <FaSeedling />
          Regrow
        </button>
      </div>
    </SheetPanel>
  );
};

export default LSystemPanel;
