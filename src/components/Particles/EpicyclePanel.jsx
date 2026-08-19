import { useCallback, useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import EpicycleField, { N_TERMS_MIN, N_TERMS_MAX, N_TERMS_DEFAULT } from "./EpicycleField";

import "./EpicyclePanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, CHLADNI_EVENT, LENIA_EVENT) — a command palette
// entry fires this from anywhere.
export const EPICYCLE_EVENT = "docket:epicycle-field";

// A standalone showcase — a real discrete Fourier transform driving actual
// circles-on-circles, see EpicycleField.jsx for the math. Kept as its own
// panel rather than embedded anywhere, same reasoning as every other
// Particles/ panel — the simulation and WebGL context only exist while
// someone's actually looking at it. No stat pill here unlike this panel's
// siblings — every other Particles/ demo's own stat is a real quantity
// read off a system that's still evolving (GravityFieldPanel's kinetic
// energy, ChladniPanel's settled%); nothing here is still becoming
// anything once a drawing finishes, so there's no live measurement to
// report that a decorative one wouldn't just be standing in for.
const EpicyclePanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const [nTerms, setNTerms] = useState(N_TERMS_DEFAULT);
  const [hasDrawn, setHasDrawn] = useState(false);
  const panelRef = useRef(null);

  const handleDraw = useCallback(() => setHasDrawn(true), []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(EPICYCLE_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(EPICYCLE_EVENT, handleSummon);
    };
  }, []);

  // A fresh sheet always opens on the same default star (EpicycleField's
  // own default), so the hint should too — otherwise reopening the panel
  // after drawing once earlier this session would still claim to be
  // retracing something that's no longer showing.
  useEffect(() => {
    if (open) setHasDrawn(false);
  }, [open]);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="epicycle-field-layer"
      backdropClassName="epicycle-field-backdrop"
      panelClassName="epicycle-field-panel"
      ariaLabel="Orbits"
    >
      <div className="epicycle-field-header">
        <h3>Orbits</h3>
        <button
          type="button"
          aria-label="Close"
          className="epicycle-field-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      <p className="epicycle-field-hint">
        { hasDrawn
          ? "Circles chase circles, retracing exactly what you drew"
          : "Drag to draw anything — circles on circles will trace it forever" }
      </p>

      <div className="epicycle-field-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the simulation and WebGL context actually run. */}
        <EpicycleField
          active={ open }
          reduceMotion={ reduceMotion }
          nTerms={ nTerms }
          onDraw={ handleDraw }
        />
      </div>

      <div className="epicycle-field-controls">
        <label className="epicycle-field-slider">
          <span>Detail</span>
          <input
            type="range"
            min={ N_TERMS_MIN }
            max={ N_TERMS_MAX }
            step={ 1 }
            value={ nTerms }
            onChange={ (e) => setNTerms(parseInt(e.target.value, 10)) }
            aria-label="Number of Fourier terms"
          />
          <span className="epicycle-field-slider-value">{ nTerms }</span>
        </label>
      </div>
    </SheetPanel>
  );
};

export default EpicyclePanel;
