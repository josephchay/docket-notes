import { useCallback, useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import InkBloomField from "./InkBloomField";
import useOdometer from "../../hooks/useOdometer";

import "./InkBloomPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// GRAVITY_FIELD_EVENT, FLUID_FIELD_EVENT, CLOTH_EVENT) — a command palette
// entry fires this from anywhere.
export const INK_BLOOM_EVENT = "docket:ink-bloom";

// Named neighborhoods in Gray-Scott's own (feed, kill) parameter space —
// Pearson's 1993 classification maps named regimes (spots, stripes, coral,
// self-replicating "mitosis" blobs, chaotic worms...) across exactly this
// plane; the pairs below are representative coordinates within those
// regions, tuned by hand against this exact grid/timestep rather than
// trusted blind from a remembered table — the same "checked against this
// specific configuration, not just copied" standard every other Particles/
// demo's own constants already hold to (see InkBloomField.jsx's DU/DV
// comment). The sliders in the panel below are the actually-precise
// interface; these five are just good places to start exploring from.
const PRESETS = [
  { key: "coral", label: "Coral", feed: 0.0545, kill: 0.062 },
  { key: "mitosis", label: "Mitosis", feed: 0.0367, kill: 0.0649 },
  { key: "spots", label: "Spots", feed: 0.03, kill: 0.062 },
  { key: "stripes", label: "Stripes", feed: 0.03, kill: 0.057 },
  { key: "worms", label: "Worms", feed: 0.058, kill: 0.065 },
];
const DEFAULT_PRESET = PRESETS[1]; // mitosis — self-replicating spots read as alive the instant the panel opens, the same reasoning InkBloomField's own initial burst exists at all

// A standalone showcase — a real Gray-Scott reaction-diffusion simulation,
// see InkBloomField.jsx for the physics. Kept as its own panel rather than
// embedded anywhere, same reasoning as every other Particles/ panel — the
// simulation and WebGL context only exist while someone's actually looking
// at it.
const InkBloomPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState(DEFAULT_PRESET.feed);
  const [kill, setKill] = useState(DEFAULT_PRESET.kill);
  const [activePreset, setActivePreset] = useState(DEFAULT_PRESET.key);
  // Bumped to reseed a blank page under whatever feed/kill are current
  // right now — a preset pick and the panel's own "Fresh page" button both
  // go through this; a bare slider drag deliberately never does (see
  // handleFeedChange/handleKillChange below), or every tick of a drag
  // would blow away a pattern that's already blooming.
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
    window.addEventListener(INK_BLOOM_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(INK_BLOOM_EVENT, handleSummon);
    };
  }, []);

  const applyPreset = (preset) => {
    setFeed(preset.feed);
    setKill(preset.kill);
    setActivePreset(preset.key);
    setResetToken((t) => t + 1);
  };

  // A hand-dragged slider no longer matches any named preset's exact pair
  // — activePreset clears so none of the chips reads as selected once the
  // visitor is off exploring on their own.
  const handleFeedChange = (e) => {
    setFeed(parseFloat(e.target.value));
    setActivePreset(null);
  };
  const handleKillChange = (e) => {
    setKill(parseFloat(e.target.value));
    setActivePreset(null);
  };

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="ink-bloom-layer"
      backdropClassName="ink-bloom-backdrop"
      panelClassName="ink-bloom-panel"
      ariaLabel="Ink bloom"
    >
      <div className="ink-bloom-header">
        <h3>Ink bloom</h3>
        <div className="ink-bloom-header-actions">
          {
            steps > 0 && (
              <span className="ink-bloom-stat" title="Reaction-diffusion steps run so far">
                { displayedSteps.toLocaleString() } gen
              </span>
            )
          }
          <button
            type="button"
            aria-label="Close"
            className="ink-bloom-close"
            onClick={ () => setOpen(false) }
          >
            <FaXmark />
          </button>
        </div>
      </div>
      <p className="ink-bloom-hint">Drag anywhere to drop ink — it reacts and spreads on its own from there</p>

      <div className="ink-bloom-presets">
        {
          PRESETS.map((preset) => (
            <button
              key={ preset.key }
              type="button"
              className={ `ink-bloom-preset ${ activePreset === preset.key ? "active" : "" }` }
              onClick={ () => applyPreset(preset) }
            >
              { preset.label }
            </button>
          ))
        }
        <button
          type="button"
          className="ink-bloom-preset ink-bloom-preset-reset"
          onClick={ () => setResetToken((t) => t + 1) }
        >
          Fresh page
        </button>
      </div>

      <div className="ink-bloom-stage">
        {/* Always mounted, same reasoning as the other Particles/ panels —
            SheetPanel's own AnimatePresence already owns the mount/unmount
            timing through its close animation; `active` alone gates
            whether the simulation and WebGL context actually run. */}
        <InkBloomField
          active={ open }
          reduceMotion={ reduceMotion }
          feed={ feed }
          kill={ kill }
          resetToken={ resetToken }
          onSteps={ handleSteps }
        />
      </div>

      <div className="ink-bloom-sliders">
        <label className="ink-bloom-slider">
          <span>Feed</span>
          <input
            type="range"
            min={ 0.01 }
            max={ 0.1 }
            step={ 0.0005 }
            value={ feed }
            onChange={ handleFeedChange }
            aria-label="Feed rate"
          />
        </label>
        <label className="ink-bloom-slider">
          <span>Kill</span>
          <input
            type="range"
            min={ 0.03 }
            max={ 0.07 }
            step={ 0.0005 }
            value={ kill }
            onChange={ handleKillChange }
            aria-label="Kill rate"
          />
        </label>
      </div>
    </SheetPanel>
  );
};

export default InkBloomPanel;
