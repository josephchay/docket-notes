import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import AudioPulseField from "./AudioPulseField";

import "./AudioPulseFieldPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, FLUID_FIELD_EVENT) — a command palette entry fires
// this from anywhere.
export const AUDIO_PULSE_FIELD_EVENT = "docket:audio-pulse-field";

// A standalone showcase — a ring of particles on real damped springs, each
// tracking its own log-spaced frequency bin from a visitor-chosen local
// audio file, pulsed by a genuine energy-threshold beat detector (see
// AudioPulseField.jsx for the DSP and spring math). No audio is bundled or
// fetched — it only ever plays a file the visitor picks from their own
// device, and only while this panel is actually open.
const AudioPulseFieldPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(AUDIO_PULSE_FIELD_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(AUDIO_PULSE_FIELD_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="audio-pulse-field-layer"
      backdropClassName="audio-pulse-field-backdrop"
      panelClassName="audio-pulse-field-panel"
      ariaLabel="Audio pulse field"
    >
      <div className="audio-pulse-field-header">
        <h3>Audio pulse field</h3>
        <button
          type="button"
          aria-label="Close"
          className="audio-pulse-field-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      <p className="audio-pulse-field-hint">Choose a track — the ring traces its spectrum and pulses on the beat</p>
      <div className="audio-pulse-field-stage">
        {/* Always mounted, same reasoning as every other Particles/ panel —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates whether
            the physics loop and WebGL context actually run (the Web Audio
            graph itself, once built, deliberately outlives that — see
            AudioPulseField.jsx's own comment on why). */}
        <AudioPulseField active={ open } reduceMotion={ reduceMotion } />
      </div>
    </SheetPanel>
  );
};

export default AudioPulseFieldPanel;
