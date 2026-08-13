import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { FaXmark } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { MILESTONES } from "../../constants/milestones";
import { metaballBridge } from "../../utils/metaball";
import SheetPanel from "../Sheet/SheetPanel";
import LiquidMeter from "../Meter/LiquidMeter";
import InkVial from "./InkVial";

import "./InkLevelsPanel.css";

// The event the toolbar's ink-levels button fires to summon this panel
// from anywhere — same convention as INSIGHTS_EVENT/TRASH_EVENT/etc.
export const INK_LEVELS_EVENT = "docket:inkLevels";

// How far a press on a vial has to travel before release counts as a real
// pour rather than a click — same convention ColorSelector's own
// drag-to-pour uses.
const POUR_DRAG_THRESHOLD = 36;

// How hard a splash in one vial still reaches its immediate neighbors
// through the connecting necks (see the bridge rendering below) — real
// linked tubes, not just a shared visual outline: a note poured into
// "yellow" now visibly disturbs "orange" and whichever else sits beside it
// too, scaled down from the amount the struck vial itself gets (see
// InkVial.jsx's own count-change strike for that fuller amount).
const NEIGHBOR_SPLASH_FALLOFF = .4;
const NEIGHBOR_SPLASH_PER_NOTE = .35;
const NEIGHBOR_SPLASH_MAX = 1.2;

// The milestone cascade's own stagger (see the celebration effect below) —
// every vial gets struck in turn, left to right, rather than only the
// summary meter above them.
const CASCADE_STAGGER_MS = 55;
const CASCADE_STRIKE = 1.1;

// The staggered pour-in each vial rides on open (see InkVial's own
// riseDelay/fill spring) — a real rising level per vial rather than the
// scaleY squash this row used to animate, which stretched each whole SVG
// (ripple, meniscus and all) instead of actually filling anything.
const RISE_STAGGER_MS = 70;

// How hard a decant strikes the two vials involved (see handleColumnPointerUp)
// — the source is emptied and the target takes the whole pour, so the
// target rings harder. Both are on top of whatever their own count-change
// strike already gives them.
const DECANT_SOURCE_STRIKE = .7;
const DECANT_TARGET_STRIKE = 1.3;

// How much of each ink the desk holds, dressed in the exact same
// chrome as the desk insights panel (SheetPanel dot-to-sheet, sectioned
// body, ink-tab tooltips) — this used to be a small corner popover with
// its own bespoke styling, then a flat row of independent bar charts.
// Redesigned again: the per-color vials are no longer independent columns
// that happen to sit next to each other — real metaball necks (the same
// geometry Navigation's own pot-bridges and NoteConstellation's cluster
// bridges use) connect adjacent same-row vials at their current fill
// lines, and a splash in one now propagates a smaller, decayed strike into
// its neighbors' own wave fields through those same necks — the row reads
// as one connected manifold, not seven unrelated bar charts. A milestone
// crossing cascades that same strike through every vial in sequence
// instead of only the summary meter at top, and a vial can be dragged
// straight out to pour a new note of that color onto the desk, the same
// gesture ColorSelector's own nav-rail pots already use — this panel is no
// longer purely a readout.
const InkLevelsPanel = ({
  totalCount,
  colorCounts,
  sortColor,
  setSortColor,
  reduceMotion,
  celebration,
  addNote,
  decantColor,
}) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(INK_LEVELS_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(INK_LEVELS_EVENT, handleSummon);
    };
  }, []);

  const paletteNames = Object.keys(NOTE_COLORS);
  const maxCount = Math.max(1, ...paletteNames.map((name) => colorCounts?.[name] ?? 0));

  // The vial's fill: how far the desk has come from the last milestone
  // toward the next one (not just totalCount/nextMilestone from zero —
  // that would look nearly full for most of the app's life once a few
  // milestones have passed). Maxed out once every milestone is behind it.
  const nextMilestone = MILESTONES.find((m) => m > totalCount) ?? null;
  const prevMilestone = [...MILESTONES].reverse().find((m) => m <= totalCount) ?? 0;
  const milestoneRatio = nextMilestone
    ? (totalCount - prevMilestone) / (nextMilestone - prevMilestone)
    : 1;
  const milestoneLabel = nextMilestone
    ? `${ totalCount } / ${ nextMilestone } to the next milestone`
    : `${ totalCount } notes — every milestone reached`;

  // Every per-color vial's own imperative strike (see InkVial.jsx's
  // useImperativeHandle) — indexed the same way paletteNames/columnRefs
  // already are, so "the vial two seats over" is just an index away.
  const vialRefs = useRef([]);
  const vialWrapRefs = useRef([]);

  // A note landing (or leaving) one color's vial sends a smaller splash
  // into its immediate neighbors through the connecting necks — real
  // coupling, not just a shared outline. InkVial's own internal
  // count-change effect still owns the FULL strike on the vial that
  // actually changed; this only ever reaches the ones beside it.
  const prevColorCountsRef = useRef(colorCounts);
  useEffect(() => {
    // Gated on `open` as well as reduceMotion: InkVial only steps its own
    // field while the panel is actually visible, so a splash sent into a
    // closed one isn't merely wasted, it sits there undamped until it is
    // reopened. Tracking prev counts regardless keeps the FIRST open after
    // a closed stretch from reading every accumulated change at once as
    // one enormous delta.
    if (reduceMotion || !open) {
      prevColorCountsRef.current = colorCounts;
      return;
    }

    const prev = prevColorCountsRef.current;
    paletteNames.forEach((name, index) => {
      const before = prev?.[name] ?? 0;
      const after = colorCounts?.[name] ?? 0;
      if (before === after) return;

      const amount = Math.min(NEIGHBOR_SPLASH_MAX, Math.abs(after - before) * NEIGHBOR_SPLASH_PER_NOTE) * NEIGHBOR_SPLASH_FALLOFF;
      vialRefs.current[index - 1]?.strike(amount);
      vialRefs.current[index + 1]?.strike(amount);
    });
    prevColorCountsRef.current = colorCounts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorCounts, reduceMotion, open]);

  // A milestone crossing now cascades through every vial in sequence —
  // the same crossing LiquidMeter's own summary vial above already reacts
  // to (see its own ratio-heuristic/celebration-key comment), read the
  // same way here: whichever fires first, this only ever triggers once
  // per actual celebration.
  const prevCelebrationKeyRef = useRef(celebration?.key ?? null);
  useEffect(() => {
    const celebrationFired = !!celebration && celebration.key !== prevCelebrationKeyRef.current;
    prevCelebrationKeyRef.current = celebration?.key ?? prevCelebrationKeyRef.current;
    // Same reasoning as the neighbour-splash above — a cascade fired into
    // a closed panel would sit in seven undamped fields until it opened.
    if (!celebrationFired || reduceMotion || !open) return;

    paletteNames.forEach((_, index) => {
      setTimeout(() => vialRefs.current[index]?.strike(CASCADE_STRIKE), index * CASCADE_STAGGER_MS);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebration, reduceMotion]);

  // The connecting necks themselves — computed from each vial-wrap's own
  // live rect (its bottom edge, minus the same `height` px InkVial itself
  // renders at, is the fill line in viewport space) rather than trying to
  // read InkVial's own live-animated wave surface, which would mean
  // exposing yet another imperative getter for a ripple this doesn't need
  // to track exactly. Skipped across a flex-wrap onto a second row (a
  // >4px gap in `top` between two "adjacent" columns) — bridging across a
  // wrap would connect the wrong corners entirely.
  const [bridges, setBridges] = useState([]);

  useEffect(() => {
    if (!open || reduceMotion) {
      setBridges([]);
      return undefined;
    }

    const compute = () => {
      const next = [];
      for (let i = 0; i < paletteNames.length - 1; i++) {
        const wrapA = vialWrapRefs.current[i];
        const wrapB = vialWrapRefs.current[i + 1];
        if (!wrapA || !wrapB) continue;

        const rectA = wrapA.getBoundingClientRect();
        const rectB = wrapB.getBoundingClientRect();
        if (Math.abs(rectA.top - rectB.top) > 4) continue;

        const nameA = paletteNames[i];
        const nameB = paletteNames[i + 1];
        const heightA = 8 + Math.round(((colorCounts?.[nameA] ?? 0) / maxCount) * 56);
        const heightB = 8 + Math.round(((colorCounts?.[nameB] ?? 0) / maxCount) * 56);

        const path = metaballBridge(
          rectA.left + rectA.width / 2, rectA.bottom - heightA, 9,
          rectB.left + rectB.width / 2, rectB.bottom - heightB, 9,
          { v: .6, maxDist: 60 },
        );
        if (path) next.push({ key: `${ nameA }-${ nameB }`, path, colorA: nameA, colorB: nameB });
      }
      setBridges(next);
    };

    compute();
    // The entrance is still filling on the very frame this first runs —
    // one trailing recompute once it has actually finished catches where
    // the surfaces really landed. Timed off the real thing it waits for:
    // the last vial's own staggered start (RISE_STAGGER_MS per column)
    // plus roughly how long that vial's fill spring then takes to settle,
    // rather than a bare guess that would go stale the moment either the
    // stagger or the palette length changed.
    const settleTimer = setTimeout(compute, paletteNames.length * RISE_STAGGER_MS + 900);
    window.addEventListener("resize", compute);

    return () => {
      clearTimeout(settleTimer);
      window.removeEventListener("resize", compute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, colorCounts, maxCount, reduceMotion]);

  // Drag a vial straight out to pour a new note of that color — a
  // portaled ghost that tracks the pointer 1:1, the same technique
  // ColorSelector's own nav-rail pots already use for the identical
  // gesture, right down to the suppress-click guard so a plain tap still
  // just filters by that color instead of also firing a pour.
  const dragStateRef = useRef({});
  const ghostRef = useRef(null);
  const suppressClickRef = useRef(false);
  // Which OTHER vial the drag is currently hovering, if any — a release
  // there decants this whole color into that one rather than pouring a
  // single new note onto the desk (see handleColumnPointerUp).
  const [decantTarget, setDecantTarget] = useState(null);

  const ensureGhost = (colorName) => {
    if (ghostRef.current) return ghostRef.current;
    const el = document.createElement("span");
    el.className = `ink-levels-pour-ghost ${ colorName }-bg`;
    document.body.appendChild(el);
    ghostRef.current = el;
    return el;
  };

  // Whichever vial column sits under the pointer right now, if it isn't
  // the one being dragged. elementFromPoint rather than hit-testing cached
  // rects: the ghost that follows the pointer is pointer-events: none (see
  // .ink-levels-pour-ghost), so it never occludes the column underneath
  // it, and the panel can scroll under a long drag without this going
  // stale the way a captured rect list would.
  const columnUnderPointer = (clientX, clientY, exclude) => {
    const el = document.elementFromPoint(clientX, clientY);
    const column = el?.closest?.("[data-ink-color]");
    const name = column?.getAttribute("data-ink-color");
    return name && name !== exclude ? name : null;
  };

  const handleColumnPointerDown = (e, name) => {
    if (reduceMotion || !addNote) return;
    dragStateRef.current = { name, startX: e.clientX, startY: e.clientY, active: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleColumnPointerMove = (e) => {
    const state = dragStateRef.current;
    if (!state.name) return;

    if (!state.active) {
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (Math.hypot(dx, dy) < 6) return;
      state.active = true;
      suppressClickRef.current = true;
    }

    const ghost = ensureGhost(state.name);
    ghost.style.transition = "";
    ghost.style.opacity = "1";
    ghost.style.transform = `translate(${ e.clientX }px, ${ e.clientY }px) translate(-50%, -50%)`;

    const over = columnUnderPointer(e.clientX, e.clientY, state.name);
    setDecantTarget(over);
    ghost.classList.toggle("decanting", !!over);
  };

  const handleColumnPointerUp = (e) => {
    const state = dragStateRef.current;
    dragStateRef.current = {};
    setDecantTarget(null);
    if (!state.name) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!state.active) return;

    const target = columnUnderPointer(e.clientX, e.clientY, state.name);
    const dist = Math.hypot(e.clientX - state.startX, e.clientY - state.startY);

    if (ghostRef.current) {
      if (target) {
        // Released over another vial — pour this whole color into that
        // one. Strikes both surfaces directly rather than waiting on the
        // count-change effect alone: the source is being emptied and the
        // target is taking the whole pour, which reads as a much bigger
        // event than either vial's own per-note ripple.
        decantColor?.(state.name, target);
        vialRefs.current[paletteNames.indexOf(state.name)]?.strike(DECANT_SOURCE_STRIKE);
        vialRefs.current[paletteNames.indexOf(target)]?.strike(DECANT_TARGET_STRIKE);
      } else if (dist > POUR_DRAG_THRESHOLD) {
        addNote?.(state.name, { x: e.clientX, y: e.clientY });
        // Closes the panel so the note that was just poured is actually
        // visible landing on the desk, rather than hidden behind the
        // backdrop it was dragged out from underneath. A decant above
        // deliberately does NOT close: its whole result is the vials
        // themselves changing level, which is only visible from here.
        setOpen(false);
      }
      const ghost = ghostRef.current;
      ghostRef.current = null;
      ghost.style.transition = "opacity .25s ease-out, transform .25s ease-out";
      ghost.style.opacity = "0";
      ghost.style.transform += " scale(.4)";
      setTimeout(() => ghost.remove(), 260);
    }
  };

  return (
    <>
      {
        createPortal(
          <AnimatePresence>
            {
              bridges.length > 0 && (
                <svg key="inkBridges" className="ink-levels-bridge-layer" aria-hidden="true">
                  <defs>
                    {
                      bridges.map((bridge) => (
                        <linearGradient key={ bridge.key } id={ `ink-bridge-${ bridge.key }` } x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0" stopColor={ `var(--${ bridge.colorA }-color)` } />
                          <stop offset="1" stopColor={ `var(--${ bridge.colorB }-color)` } />
                        </linearGradient>
                      ))
                    }
                  </defs>
                  {
                    bridges.map((bridge) => (
                      <motion.path
                        key={ bridge.key }
                        d={ bridge.path }
                        fill={ `url(#ink-bridge-${ bridge.key })` }
                        initial={{ opacity: 0 }}
                        animate={{ opacity: .85 }}
                        exit={{ opacity: 0 }}
                      />
                    ))
                  }
                </svg>
              )
            }
          </AnimatePresence>,
          document.body,
        )
      }
      <SheetPanel
        open={ open }
        onClose={ () => setOpen(false) }
        panelRef={ panelRef }
        radius={ 22 }
        layerClassName="ink-levels-layer"
        backdropClassName="ink-levels-backdrop"
        panelClassName="ink-levels-panel"
        ariaLabel="Ink levels"
      >
        <div className="ink-levels-header">
          <h3>Ink levels</h3>
          <motion.button
            type="button"
            aria-label="Close"
            className="ink-levels-close"
            whileHover={{ scale: 1.15, rotate: 90 }}
            whileTap={{ scale: .9 }}
            transition={{ type: "spring", stiffness: 420, damping: 16 }}
            onClick={ () => setOpen(false) }
          >
            <FaXmark />
          </motion.button>
        </div>

        <div className="ink-levels-body">
          <section className="ink-levels-section">
            <h4>Progress to next milestone</h4>
            <LiquidMeter
              ratio={ milestoneRatio }
              color="var(--page-ink-color)"
              label={ milestoneLabel }
              reduceMotion={ reduceMotion }
              celebration={ celebration }
            />
          </section>

          <section className="ink-levels-section">
            <h4>Ink by color</h4>
            <div className="ink-levels-bars">
              {
                paletteNames.map((name, index) => {
                  const count = colorCounts?.[name] ?? 0;
                  const label = `${ count } ${ name } ${ count === 1 ? "note" : "notes" }`;

                  return (
                    <button
                      key={ name }
                      type="button"
                      title={ label }
                      aria-label={
                        sortColor === name
                          ? `${ label } — showing only these; press to show every color, or drag to pour a new one`
                          : `${ label } — press to show only these, or drag to pour a new one`
                      }
                      aria-pressed={ sortColor === name }
                      data-ink-color={ name }
                      className={ `ink-levels-column ink-levels-button ${ sortColor === name ? "active" : "" } ${ decantTarget === name ? "decant-target" : "" }` }
                      style={{ touchAction: "none" }}
                      onPointerDown={ (e) => handleColumnPointerDown(e, name) }
                      onPointerMove={ handleColumnPointerMove }
                      onPointerUp={ handleColumnPointerUp }
                      onPointerCancel={ handleColumnPointerUp }
                      onClick={ () => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
                        setSortColor?.(sortColor === name ? null : name);
                      } }
                    >
                      <span className="ink-levels-tooltip">{ label }</span>
                      <motion.span
                        key={ `${ name }-${ count }` }
                        className="ink-levels-count"
                        initial={{ opacity: 0, scale: .5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: "spring", stiffness: 500, damping: 20, delay: .05 + index * .04 }}
                      >
                        { count }
                      </motion.span>
                      {/* No scaleY entrance any more — the vial fills for
                          real instead (see InkVial's own riseDelay/fill
                          spring). Scaling the wrap squashed the entire SVG
                          inside it, ripple and meniscus included, which is
                          the one thing a container being filled should
                          never appear to do. */}
                      <span
                        ref={ (el) => { vialWrapRefs.current[index] = el; } }
                        className="ink-levels-vial-wrap"
                      >
                        <InkVial
                          ref={ (el) => { vialRefs.current[index] = el; } }
                          count={ count }
                          height={ 8 + Math.round((count / maxCount) * 56) }
                          colorName={ name }
                          open={ open }
                          reduceMotion={ reduceMotion }
                          riseDelay={ index * RISE_STAGGER_MS }
                        />
                      </span>
                      <span className="ink-levels-label">{ name }</span>
                    </button>
                  );
                })
              }
            </div>
          </section>
        </div>
      </SheetPanel>
    </>
  );
};

export default InkLevelsPanel;
