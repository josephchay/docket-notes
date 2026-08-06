import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import FluidVisualizer from "./FluidVisualizer";

import "./FluidVisualizerPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// INSIGHTS_EVENT, GRAVITY_FIELD_EVENT, AUDIO_WAVE_STRING_EVENT) — a command
// palette entry fires this from anywhere.
export const FLUID_VISUALIZER_EVENT = "docket:fluid-visualizer";

// Same reasoning as AudioWaveStringPanel.jsx (see that file's own longer
// comment on the tradeoff): this panel owns a real <audio> element and Web
// Audio graph, not just a decorative physics loop, so it's gated on `open`
// rather than kept always-mounted through the close animation the way
// ParticleCuboidPanel/GravityFieldPanel/FluidFieldPanel deliberately are —
// the brief visual continuity those three protect isn't worth trading away
// having the audio keep playing for another ~300ms after the visitor has
// already clicked to close it.
const FluidVisualizerPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(FLUID_VISUALIZER_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(FLUID_VISUALIZER_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="fluid-visualizer-layer"
      backdropClassName="fluid-visualizer-backdrop"
      panelClassName="fluid-visualizer-panel"
      ariaLabel="Fluid audio visualizer"
    >
      <div className="fluid-visualizer-header">
        <h3>Fluid visualizer</h3>
        <button
          type="button"
          aria-label="Close"
          className="fluid-visualizer-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      <p className="fluid-visualizer-hint">Play a song — bass stirs one side of the pool, treble the other</p>
      <div className="fluid-visualizer-panel-stage">
        { open && <FluidVisualizer reduceMotion={ reduceMotion } /> }
      </div>
    </SheetPanel>
  );
};

export default FluidVisualizerPanel;
