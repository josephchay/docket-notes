import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import AudioWaveString from "./AudioWaveString";

import "./AudioWaveStringPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// INSIGHTS_EVENT, GRAVITY_FIELD_EVENT, FLUID_FIELD_EVENT) — a command
// palette entry fires this from anywhere.
export const AUDIO_WAVE_STRING_EVENT = "docket:audio-wave-string";

// Unlike the other four Particles/ panels, this one does NOT thread an
// `active` prop through to keep its content always-mounted while the panel
// itself animates closed — a deliberate reversal of that pattern, not an
// oversight. ParticleCuboidPanel.jsx's own comment explains why *it* avoids
// an inner `open &&` gate: since this panel's own `open` prop and any inner
// gate I'd add both flip on the exact same render, an inner gate hides
// content one render before SheetPanel's AnimatePresence actually captures
// what to animate out — which blanks a decorative canvas to an empty box
// for the ~300ms of the shrink-away exit, purely a cosmetic loss there.
// Here that same race is worth taking on purpose: this component owns a
// real <audio> element and Web Audio graph, and letting it linger mounted
// through even a brief exit animation means actual sound keeps playing
// after the visitor has already clicked to close it — worse than the
// cosmetic blank the other panels avoid. The `open &&` gate below trades
// that visual continuity away specifically to make the audio stop the
// instant `open` flips, which is what closing a player should do.

const AudioWaveStringPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(AUDIO_WAVE_STRING_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(AUDIO_WAVE_STRING_EVENT, handleSummon);
    };
  }, []);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="audio-wave-string-layer"
      backdropClassName="audio-wave-string-backdrop"
      panelClassName="audio-wave-string-panel"
      ariaLabel="Wavy line audio player"
    >
      <div className="audio-wave-string-header">
        <h3>Wavy line</h3>
        <button
          type="button"
          aria-label="Close"
          className="audio-wave-string-close"
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </button>
      </div>
      <p className="audio-wave-string-hint">Grab the string to pluck it, or play a song and watch it respond</p>
      <div className="audio-wave-string-stage">
        {/* See the file-level comment above: gated on `open` on purpose, so
            AudioWaveString's own mount-effect cleanup (pause, revoke the
            object URL, close the AudioContext) fires the instant the panel
            starts closing rather than ~300ms later. */}
        { open && <AudioWaveString reduceMotion={ reduceMotion } /> }
      </div>
    </SheetPanel>
  );
};

export default AudioWaveStringPanel;
