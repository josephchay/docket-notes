import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";
import { FaXmark } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { MILESTONES } from "../../constants/milestones";
import { catenaryPath } from "../../utils/catenary";
import SheetPanel from "../Sheet/SheetPanel";
import LiquidMeter from "../Meter/LiquidMeter";
import InkVial from "./InkVial";
import useOdometer from "../../hooks/useOdometer";

import "./InkLevelsPanel.css";

// The event the toolbar's ink-levels button fires to summon this panel
// from anywhere — same convention as INSIGHTS_EVENT/TRASH_EVENT/etc.
export const INK_LEVELS_EVENT = "docket:inkLevels";

// Computed once at module load rather than every render — NOTE_COLORS
// itself never changes, but Object.keys would otherwise hand back a fresh
// array reference each render, which the neighbor-ripple effect below
// needs to NOT treat as "the palette changed."
const PALETTE_NAMES = Object.keys(NOTE_COLORS);

// How gently a hover dips a vial versus how hard a real count change
// splashes it (see InkVial.jsx's own VIAL_COUNT_SPLASH) — a look, not a
// disturbance. NEIGHBOR_RIPPLE_SCALE is the same idea applied sideways:
// the coupled-neighbor reasoning InsightsPanel.jsx's own color bars
// already use (a hover or a pick there sends a real velocity impulse
// rippling to adjacent bars), adapted here to a liquid strike instead of
// a spring position — a color's own count changing doesn't just disturb
// its own vial, it sympathetically nudges whichever vials sit immediately
// next to it in the row.
const HOVER_STRIKE = 0.22;
const NEIGHBOR_RIPPLE_SCALE = 0.18;
const NEIGHBOR_RIPPLE_MAX = 0.5;

// A milestone crossing's own trickle-down (see the crossing effect below)
// — the exact same prev >= .96 && ratio < prev - .3 heuristic
// LiquidMeter.jsx already uses internally to catch its own pulse, read
// here too so both reactions fire off the identical real crossing rather
// than two independently-tuned guesses at the same event.
const MILESTONE_TRICKLE_STAGGER_MS = 60;
const MILESTONE_TRICKLE_STRIKE = 0.5;

// The recolor-travel droplet (see travelDroplet below) — a real arc
// (two straight segments meeting at an apex, the cheapest honest
// parabola approximation) rather than a straight line, since ink actually
// leaving one vial for another reads as thrown, not slid.
const DROP_ARC_HEIGHT = 26;
const DROP_LEG_DURATION = .28;

// The thread strung between adjacent vial tops (see the tick loop below)
// — the exact same real catenary rope-hang math TagThreads.jsx already
// uses for its own tag capillaries (utils/catenary.js), tuned tauter
// (lower k, smaller maxSag) than that file's own 1.28/70: these hops are
// a fraction of the distance between two notes on the desk, so the same
// slack would read as a loose loop rather than a thread under its own
// light tension.
const THREAD_K = 1.1;
const THREAD_SAMPLES = 6;
const THREAD_MAX_SAG = 10;

// How much of each ink the desk holds, dressed in the exact same
// chrome as the desk insights panel (SheetPanel dot-to-sheet, sectioned
// body, ink-tab tooltips) — this used to be a small corner popover with
// its own bespoke styling; now it's the same kind of panel Insights is,
// just with a different two sections: overall progress toward the next
// milestone, and a per-color breakdown. The per-color chart keeps its
// own liquid-vial identity (InkVial's real wave-equation surface) rather
// than switching to Insights' flat bars — a vial full of ink is already
// the more literal shape for "how much ink," it just now sits inside
// the same tooltip/spacing/typography language Insights' own bars do.
const InkLevelsPanel = ({
  totalCount,
  colorCounts,
  sortColor,
  setSortColor,
  reduceMotion,
  celebration,
}) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const barsRef = useRef(null);
  const vialRefs = useRef([]);
  const threadPathRefs = useRef([]);
  const backdropTurbRef = useRef(null);
  const prevColorCountsRef = useRef(colorCounts);

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

  // A real recolor arcing from the vial it left to the one it landed in —
  // page-space, portaled straight to document.body the same way every
  // other cross-element travel effect in this app already is (ColorSelector's
  // drag ghost, Navigation's data-stream drops), since it has to fly
  // between two columns regardless of whatever transform the panel's own
  // entrance/exit carries. Silently no-ops if either column isn't actually
  // on screen (panel closed, or mid-close) — nothing here assumes open.
  const travelDroplet = (from, to) => {
    const columns = document.querySelectorAll(".ink-levels-column");
    const fromVial = columns[from.index]?.querySelector(".ink-vial");
    const toVial = columns[to.index]?.querySelector(".ink-vial");
    if (!fromVial || !toVial) return;

    const fromRect = fromVial.getBoundingClientRect();
    const toRect = toVial.getBoundingClientRect();
    const originX = fromRect.left + fromRect.width / 2;
    const originY = fromRect.top + fromRect.height / 2;
    const destX = toRect.left + toRect.width / 2;
    const destY = toRect.top + toRect.height / 2;
    const apexX = (originX + destX) / 2;
    const apexY = Math.min(originY, destY) - DROP_ARC_HEIGHT;

    const dot = document.createElement("span");
    dot.className = `ink-levels-travel-drop ${ from.name }-bg`;
    document.body.appendChild(dot);

    gsap.timeline({ onComplete: () => dot.remove() })
      .set(dot, { x: originX, y: originY, opacity: 1, scale: .5 })
      .to(dot, { x: apexX, y: apexY, duration: DROP_LEG_DURATION, ease: "power1.out" })
      .to(dot, { x: destX, y: destY, scale: .8, duration: DROP_LEG_DURATION, ease: "power1.in" })
      .to(dot, { opacity: 0, scale: .3, duration: .15 }, "-=0.1");
  };

  // Whichever colors actually changed count since the last render each
  // send a decaying strike out to their own immediate neighbors — see
  // NEIGHBOR_RIPPLE_SCALE's own comment above. Runs even while the panel
  // is closed (cheap — it's just a diff and a couple of imperative calls
  // that no-op against unmounted vials), so a note poured in from
  // elsewhere on the desk still leaves a fresh ripple waiting the next
  // time this panel actually opens.
  useEffect(() => {
    const prev = prevColorCountsRef.current;
    prevColorCountsRef.current = colorCounts;
    if (reduceMotion || !prev) return;

    const deltas = PALETTE_NAMES
      .map((name, index) => ({ name, index, delta: (colorCounts?.[name] ?? 0) - (prev?.[name] ?? 0) }))
      .filter((d) => d.delta !== 0);

    // Exactly one color down and exactly one other up, by the same
    // amount — a real recolor, the same ink moving from one vial to
    // another, not two counts that merely happened to change at once.
    if (deltas.length === 2 && deltas[0].delta === -deltas[1].delta) {
      const from = deltas.find((d) => d.delta < 0);
      const to = deltas.find((d) => d.delta > 0);
      if (from && to) travelDroplet(from, to);
    }

    deltas.forEach(({ index, delta }) => {
      [index - 1, index + 1].forEach((neighborIndex) => {
        vialRefs.current[neighborIndex]?.strike(Math.min(NEIGHBOR_RIPPLE_MAX, Math.abs(delta) * NEIGHBOR_RIPPLE_SCALE));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorCounts, reduceMotion]);

  const maxCount = Math.max(1, ...PALETTE_NAMES.map((name) => colorCounts?.[name] ?? 0));

  // The desk's own current front-runner — a real comparison over
  // colorCounts, not a decorative pick, so the halo below only ever marks
  // whichever ink is genuinely most-used right now. No leader at all while
  // the desk (or every one of its colors) is still at zero.
  const leadingColor = PALETTE_NAMES.reduce(
    (best, name) => ((colorCounts?.[name] ?? 0) > (colorCounts?.[best] ?? -1) ? name : best),
    PALETTE_NAMES[0],
  );
  const hasLeader = (colorCounts?.[leadingColor] ?? 0) > 0;

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

  // A live, spring-tweened count rather than a static number baked into
  // milestoneLabel's own plain string — LiquidMeter's own label prop just
  // renders whatever it's handed as flat text, so this lives here as its
  // own small element instead of reaching into that shared component.
  const notesToGo = nextMilestone ? Math.max(0, nextMilestone - totalCount) : 0;
  const displayedNotesToGo = useOdometer(notesToGo);
  const prevMilestoneRatioRef = useRef(milestoneRatio);

  // The instant a milestone is actually reached (the identical prev >= .96
  // && ratio < prev - .3 crossing LiquidMeter.jsx itself already detects
  // for its own pulse), the achievement's own energy trickles down into
  // the color vials below — a left-to-right staggered strike tying the
  // milestone meter and the per-color breakdown together as one system,
  // rather than two unrelated widgets that happen to share a panel.
  useEffect(() => {
    const prev = prevMilestoneRatioRef.current;
    prevMilestoneRatioRef.current = milestoneRatio;
    if (reduceMotion) return;

    const crossed = prev >= .96 && milestoneRatio < prev - .3;
    if (!crossed) return;

    PALETTE_NAMES.forEach((_, index) => {
      setTimeout(() => vialRefs.current[index]?.strike(MILESTONE_TRICKLE_STRIKE), index * MILESTONE_TRICKLE_STAGGER_MS);
    });
  }, [milestoneRatio, reduceMotion]);

  // Drag-to-scrub across the whole row — press anywhere in .ink-levels-bars
  // and drag to scrub the active filter live through whichever color is
  // currently under the pointer, rather than only ever landing discrete
  // clicks one column at a time. suppressClickRef is the same "a real drag
  // eats the click that follows it" guard ColorSelector.jsx's own
  // drag-to-pour uses — necessary here because the browser still fires a
  // native click on whatever button sits under the pointer at release,
  // and without it that click would immediately re-toggle whatever the
  // drag itself just landed on.
  const scrubStartXRef = useRef(null);
  const suppressClickRef = useRef(false);

  const handleBarsPointerDown = (e) => {
    scrubStartXRef.current = e.clientX;
    suppressClickRef.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleBarsPointerMove = (e) => {
    if (scrubStartXRef.current == null) return;
    if (!suppressClickRef.current && Math.abs(e.clientX - scrubStartXRef.current) > 4) {
      suppressClickRef.current = true;
    }
    if (!suppressClickRef.current) return;

    const target = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.classList.contains("ink-levels-column"));
    const color = target?.dataset.color;
    if (color && color !== sortColor) setSortColor?.(color);
  };

  const handleBarsPointerUp = (e) => {
    scrubStartXRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // The thread strung across every vial's own top — real positions read
  // fresh off the DOM each frame (the same [data-note-id]-style live
  // lookup TagThreads.jsx already relies on for its own capillaries)
  // rather than computed analytically, since a vial's actual on-screen
  // top moves for reasons this component doesn't want to re-derive by
  // hand: the lift-and-yield spring when a filter is picked, the
  // entrance stagger, a live count change resizing the column under it.
  useEffect(() => {
    if (!open || reduceMotion) return undefined;

    const start = performance.now();
    let rafId = requestAnimationFrame(tick);

    function tick() {
      rafId = requestAnimationFrame(tick);
      const container = barsRef.current;
      if (!container) return;

      const t = (performance.now() - start) / 1000;
      const containerRect = container.getBoundingClientRect();
      const columns = container.querySelectorAll(".ink-levels-column");

      const points = Array.from(columns).map((col) => {
        const vial = col.querySelector(".ink-vial") || col;
        const rect = vial.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - containerRect.left, y: rect.top - containerRect.top };
      });

      for (let i = 0; i < points.length - 1; i++) {
        const el = threadPathRefs.current[i];
        if (!el) continue;

        const a = points[i];
        const b = points[i + 1];
        // A light idle wobble on the sag itself, staggered per segment —
        // the same "pulse `a` rather than perturb a single point" trick
        // TagThreads.jsx's own threadPath uses, so the whole thread pulses
        // coherently instead of one segment twitching on its own.
        const wobble = 1 + Math.sin(t * 1.4 + i * 1.8) * 0.06;
        el.setAttribute("d", catenaryPath(a.x, a.y, b.x, b.y, {
          k: THREAD_K, samples: THREAD_SAMPLES, maxSag: THREAD_MAX_SAG, wobble,
        }));
      }
    }

    return () => cancelAnimationFrame(rafId);
  }, [open, reduceMotion]);

  // The backdrop's own slow boil (see the SVG filter in the JSX below) —
  // the same feTurbulence/feDisplacementMap seed-boiling trick
  // CommandPalette.jsx's own backdrop already uses, reused here since an
  // "ink levels" panel is if anything the more natural home for a wet-ink
  // wash. Only runs while actually open, and never under reduced motion.
  useEffect(() => {
    if (!open || reduceMotion) return undefined;

    const interval = setInterval(() => {
      backdropTurbRef.current?.setAttribute("seed", String((Math.random() * 100) | 0));
    }, 220);
    return () => clearInterval(interval);
  }, [open, reduceMotion]);

  return (
    <>
      {/* The backdrop boil's own filter def — a hidden 0x0 SVG rather than
          inline styles, since CSS `filter: url(#id)` needs a real
          <filter> element to reference somewhere in the document. Same
          setup CommandPalette.jsx uses for its own backdrop boil. */}
      {
        !reduceMotion && (
          <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden="true">
            <defs>
              <filter id="ink-levels-backdrop-boil" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence
                  ref={ backdropTurbRef }
                  type="fractalNoise"
                  baseFrequency="0.012"
                  numOctaves="2"
                  seed="1"
                  result="noise"
                />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="10" />
              </filter>
            </defs>
          </svg>
        )
      }
      <SheetPanel
        open={ open }
        onClose={ () => setOpen(false) }
        panelRef={ panelRef }
        radius={ 22 }
        layerClassName="ink-levels-layer"
        backdropClassName={ `ink-levels-backdrop ${ reduceMotion ? "" : "ink-levels-backdrop-boil" }` }
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
        {/* Steps back the instant a color filter is picked — the "whole
            desk" stat this meter represents matters less while attention
            is on one color, so it visibly yields the same way the other
            colors' own columns already do below (see isYielding), tying
            the two sections together through the selection itself rather
            than only through the milestone-crossing trickle. */}
        <motion.section
          className="ink-levels-section"
          animate={{ opacity: sortColor !== null ? .5 : 1 }}
          transition={{ duration: .3 }}
        >
          <h4>
            Progress to next milestone
            {
              nextMilestone && (
                <motion.span
                  key={ nextMilestone }
                  className="ink-levels-countdown"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                >
                  { displayedNotesToGo } to go
                </motion.span>
              )
            }
          </h4>
          <LiquidMeter
            ratio={ milestoneRatio }
            color="var(--page-ink-color)"
            label={ milestoneLabel }
            reduceMotion={ reduceMotion }
            celebration={ celebration }
            interactive
          />
        </motion.section>

        <section className="ink-levels-section">
          <h4>Ink by color</h4>
          <div
            ref={ barsRef }
            className="ink-levels-bars"
            style={{ touchAction: "none" }}
            onPointerDown={ handleBarsPointerDown }
            onPointerMove={ handleBarsPointerMove }
            onPointerUp={ handleBarsPointerUp }
            onPointerCancel={ handleBarsPointerUp }
          >
            {/* Strung across every vial's own live top position (see the
                tick loop above) — a real catenary thread, not a static
                divider line. */}
            {
              !reduceMotion && (
                <svg className="ink-levels-thread-layer" aria-hidden="true">
                  {
                    PALETTE_NAMES.slice(1).map((_, i) => (
                      <path
                        key={ i }
                        ref={ (el) => { threadPathRefs.current[i] = el; } }
                        className="ink-levels-thread"
                      />
                    ))
                  }
                </svg>
              )
            }
            {
              PALETTE_NAMES.map((name, index) => {
                const count = colorCounts?.[name] ?? 0;
                const label = `${ count } ${ name } ${ count === 1 ? "note" : "notes" }`;
                const isActive = sortColor === name;
                const isYielding = sortColor !== null && !isActive;
                const isLeading = hasLeader && name === leadingColor;

                return (
                  <motion.button
                    key={ name }
                    type="button"
                    title={ label }
                    aria-label={
                      sortColor === name
                        ? `${ label } — showing only these; press to show every color`
                        : `${ label } — press to show only these`
                    }
                    aria-pressed={ sortColor === name }
                    data-color={ name }
                    className={ `ink-levels-column ink-levels-button ${ isActive ? "active" : "" } ${ isLeading ? "leading" : "" }` }
                    /* Selecting a color doesn't just ring it — the picked
                       column visibly lifts while the rest ease back and
                       dim, one physical "this one rises, the rest yield"
                       read rather than an instant opacity swap. */
                    animate={{
                      y: isActive ? -6 : 0,
                      scale: isYielding ? .93 : 1,
                      opacity: isYielding ? .6 : 1,
                    }}
                    transition={{ type: "spring", stiffness: 360, damping: 18 }}
                    onMouseEnter={ () => vialRefs.current[index]?.strike(HOVER_STRIKE) }
                    onClick={ () => {
                      // A real drag-scrub across the row (see
                      // handleBarsPointerMove) already landed on its own
                      // final color live — the native click the browser
                      // still fires afterward on whatever's under the
                      // pointer would otherwise immediately re-toggle it.
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
                    <motion.span
                      className="ink-levels-vial-wrap"
                      style={{ originY: 1 }}
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 13, delay: index * .04 }}
                    >
                      <InkVial
                        ref={ (el) => { vialRefs.current[index] = el; } }
                        count={ count }
                        height={ 8 + Math.round((count / maxCount) * 56) }
                        colorName={ name }
                        open={ open }
                        reduceMotion={ reduceMotion }
                      />
                    </motion.span>
                    <span className="ink-levels-label">{ name }</span>
                  </motion.button>
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
