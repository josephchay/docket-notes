import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { FaXmark } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import GravityField from "./GravityField";
import HistoryAmbient from "../History/HistoryAmbient";
import useOdometer from "../../hooks/useOdometer";

import "./GravityFieldPanel.css";

// Same summon pattern as every other dot-to-sheet panel in this app (see
// INSIGHTS_EVENT, SHORTCUTS_EVENT, SETTINGS_EVENT) — a command palette
// entry fires this from anywhere.
export const GRAVITY_FIELD_EVENT = "docket:gravity-field";

// The title's own cheap echo of the actual gravity two layers below it —
// hovering the stage tugs it toward the cursor with the exact same
// inverse-square-plus-softening shape GravityField.jsx's real force law
// uses (F = G·m/(r²+ε²)), just as a decorative GSAP translate rather than
// a body in the simulation. TITLE_PULL_MAX caps it well short of anything
// that would actually interfere with reading the word "Gravity field."
const TITLE_PULL_STRENGTH = 4500;
const TITLE_PULL_SOFTENING = 60;
const TITLE_PULL_MAX = 10;

// A standalone showcase, not wired into any real desk data — a true N-body
// gravitational simulation (see GravityField.jsx for the physics: real
// Newtonian gravity, softening, circular-orbit spawning, a symplectic
// integrator). Kept as its own panel rather than embedded anywhere, so the
// physics loop and WebGL context only exist while someone's actually
// looking at it. The chrome around it used to be entirely flat — a plain
// header, a plain hint, a plain close button — despite the simulation
// underneath being some of the most mathematically real physics in this
// app; this brings a little of that into the frame itself: a live reading
// of the system's own actual kinetic energy, a starfield borrowed from
// HistoryAmbient's own dust technique, a title that visibly feels the
// gravity, and a quick self-collapse the instant the panel is asked to
// close.
const GravityFieldPanel = ({ reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const panelRef = useRef(null);
  const titleRef = useRef(null);
  const collapseRef = useRef(null);
  const titleQuickRef = useRef(null);

  const displayedEnergy = useOdometer(Math.round(stats?.kineticEnergy ?? 0));

  const handleSystemStats = useCallback((next) => setStats(next), []);

  // A quick contraction the instant the panel is told to close — the
  // system visibly collapsing in on itself a beat before SheetPanel's own
  // exit spring takes the whole panel away. A separate inner wrapper
  // (collapseRef), not panelRef — the same reasoning TrashPanel's own
  // shakeEmpty keeps its shake off panelRef: that node is SheetPanel's
  // own, already carrying its entrance/exit transform.
  const pulseCollapse = () => {
    if (reduceMotion || !collapseRef.current) return;
    gsap.killTweensOf(collapseRef.current);
    gsap.to(collapseRef.current, { scale: .9, opacity: .7, duration: .14, ease: "power2.in" });
  };

  const handleClose = () => {
    pulseCollapse();
    setOpen(false);
  };

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") handleClose();
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(GRAVITY_FIELD_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(GRAVITY_FIELD_EVENT, handleSummon);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureTitleQuick = () => {
    if (!titleQuickRef.current && titleRef.current) {
      titleQuickRef.current = {
        x: gsap.quickTo(titleRef.current, "x", { duration: .3, ease: "power3.out" }),
        y: gsap.quickTo(titleRef.current, "y", { duration: .3, ease: "power3.out" }),
      };
    }
    return titleQuickRef.current;
  };

  const handleStageMove = (e) => {
    if (reduceMotion || !titleRef.current) return;
    const quick = ensureTitleQuick();
    if (!quick) return;

    const rect = titleRef.current.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq) || 1;

    const pull = Math.min(TITLE_PULL_MAX, TITLE_PULL_STRENGTH / (distSq + TITLE_PULL_SOFTENING * TITLE_PULL_SOFTENING));
    quick.x(pull * (dx / dist));
    quick.y(pull * (dy / dist));
  };

  const handleStageLeave = () => {
    if (!titleRef.current) return;
    gsap.to(titleRef.current, { x: 0, y: 0, duration: .5, ease: "elastic.out(1, .5)" });
  };

  return (
    <SheetPanel
      open={ open }
      onClose={ handleClose }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="gravity-field-layer"
      backdropClassName="gravity-field-backdrop"
      panelClassName="gravity-field-panel"
      ariaLabel="Gravity field"
    >
      {/* A drifting star wash inside the panel itself, behind the header/
          stage content (see .gravity-field-panel's own isolation: isolate
          in the CSS) — HistoryAmbient's own dust technique wholesale, the
          same "ink motes behind the paper" placement NoteEditor.jsx
          already uses, reused rather than a second particle system just
          for this one modal. */}
      { !reduceMotion && <HistoryAmbient color="var(--page-ink-color)" /> }
      <div ref={ collapseRef } className="gravity-field-collapse-wrap">
        <div className="gravity-field-header">
          <h3 ref={ titleRef }>Gravity field</h3>
          <div className="gravity-field-header-actions">
            {
              stats && (
                <span className="gravity-field-stat" title="The system's own real total kinetic energy, Σ½mv²">
                  { displayedEnergy } E
                </span>
              )
            }
            <button
              type="button"
              aria-label="Close"
              className="gravity-field-close"
              onClick={ handleClose }
            >
              <FaXmark />
            </button>
          </div>
        </div>
        <p className="gravity-field-hint">Drag anywhere to sling a new body into orbit</p>
        <div
          className="gravity-field-stage"
          onMouseMove={ handleStageMove }
          onMouseLeave={ handleStageLeave }
        >
          {/* Always mounted, same reasoning as ParticleCuboidPanel.jsx used to
              follow before that effect moved into Settings — SheetPanel's own
              AnimatePresence already owns the mount/unmount decision through
              its close animation, so gating a second time here would only
              race against it. The physics loop and WebGL context are what
              actually start and stop, gated entirely by `active`. */}
          <GravityField active={ open } reduceMotion={ reduceMotion } onSystemStats={ handleSystemStats } />
        </div>
      </div>
    </SheetPanel>
  );
};

export default GravityFieldPanel;
