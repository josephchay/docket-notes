import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import anime from "animejs";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { FaShuffle, FaSquareCheck, FaCheckDouble } from "react-icons/fa6";

import Note from "../Note/Note";
import QuoteCard from "../Quote/QuoteCard";
import TagThreads from "./TagThreads";
import BulkTethers from "../Bulk/BulkTethers";
import NotePile from "../Pile/NotePile";
import EmptyStateWash from "./EmptyStateWash";
import { NOTE_COLORS } from "../../constants/colors";

import "./NoteList.css";
import { itemsPerFlexRow } from "../../utils/math";
import useInkPulse from "../../hooks/useInkPulse";
import { createPoint, integratePoint } from "../../utils/verlet";
import { pointInPolygon } from "../../utils/hull";
import { smoothPath } from "../../utils/svgPath";
import { SNAPPY, EXIT_SPRING } from "../Motion";

gsap.registerPlugin(ScrollTrigger);

const GRID_RADIAL_RADIUS = 58;
const GRID_RADIAL_MARGIN = 100;

const springy = SNAPPY;

// The desk's layouts: freshest first, grouped by ink color, or starred to
// the front. The active label wears a sliding ink thumb.
const SORT_MODES = [
  { key: "fresh", label: "Fresh" },
  { key: "color", label: "Color" },
  { key: "starred", label: "Starred" },
];

// Slow drifting drops of note ink behind the empty desk; the page's gooey
// filter melts them into one lava-lamp blob as their paths cross.
const BLOBS = [
  { color: "var(--yellow-color)", size: 84, x: [-70, 40, -70], y: [-10, 30, -10], duration: 9 },
  { color: "var(--blue-color)", size: 64, x: [60, -40, 60], y: [20, -30, 20], duration: 11 },
  { color: "var(--pink-color)", size: 52, x: [-20, 70, -20], y: [50, -20, 50], duration: 10 },
  { color: "var(--purple-color)", size: 44, x: [30, -60, 30], y: [-40, 40, -40], duration: 12 },
];

// The one-off bloom the blobs throw when the desk goes from holding notes
// to holding none — bigger drops that fan outward from center and dissolve,
// melted into the idle drifters below by the same gooey filter.
const BURST = [
  { color: "var(--yellow-color)", x: -95, y: -30 },
  { color: "var(--blue-color)", x: 65, y: -65 },
  { color: "var(--pink-color)", x: 0, y: 55 },
  { color: "var(--purple-color)", x: 95, y: 15 },
  { color: "var(--green-color)", x: -55, y: 60 },
];

// The idle drifters used to just be four independent Framer keyframe
// loops — each blob's own path pre-baked, with zero awareness that the
// gooey filter was about to melt it into whichever neighbor its own fixed
// path happened to cross. This runs them as real verlet points instead
// (utils/verlet.js, the same position-based integration ClothField/
// PullString's own rope already trust): each blob still eases toward a
// lazy wandering target derived from its OLD keyframe range (so the
// overall character — which blob roams how far, how fast — is unchanged),
// but a plain pairwise penetration check now actually pushes two blobs
// apart the instant they'd overlap, so a "collision" is a real position
// correction, not a coincidence of two unrelated timelines.
const BLOB_SPRING = 0.05;      // pull toward the wander target, per frame
const BLOB_DAMPING = 0.93;     // per-frame implied-velocity retention
const BLOB_RADIUS_FACTOR = 0.4; // fraction of a blob's own CSS size counted as its collision radius
const BLOB_SEPARATION_PADDING = 8; // px of extra berth beyond bare contact

// The wander target a blob's own verlet point eases toward — a lazy
// Lissajous derived straight from its old 3-key keyframe range (x[0]/x[1]
// as the two extremes of a sine sweep) rather than a fresh shape, so this
// reads as the same slow drift the old fixed timeline had, just now a
// target something else can actually knock the real point off of.
const blobTarget = (blob, t) => {
  const xMid = (blob.x[0] + blob.x[1]) / 2;
  const xAmp = (blob.x[1] - blob.x[0]) / 2;
  const yMid = (blob.y[0] + blob.y[1]) / 2;
  const yAmp = (blob.y[1] - blob.y[0]) / 2;
  const phase = (t / blob.duration) * Math.PI * 2;
  return {
    x: xMid + xAmp * Math.sin(phase),
    // A slightly different rate than X, same reason TagThreads.jsx's own
    // idle wobble staggers its sine terms — a matched rate would just
    // trace a straight diagonal line back and forth instead of a loop.
    y: yMid + yAmp * Math.cos(phase * 0.82),
  };
};

const VerletBlobs = ({ reduceMotion }) => {
  const elRefs = useRef([]);
  const pointsRef = useRef(null);
  if (!pointsRef.current) pointsRef.current = BLOBS.map((blob) => createPoint(blob.x[0], blob.y[0]));

  useEffect(() => {
    if (reduceMotion) return undefined;

    let lastT = performance.now();
    let simTime = 0;
    let raf;

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.032, (now - lastT) / 1000);
      lastT = now;
      simTime += dt;

      const points = pointsRef.current;
      points.forEach((p, i) => {
        const target = blobTarget(BLOBS[i], simTime);
        integratePoint(p, dt, (target.x - p.x) * BLOB_SPRING, (target.y - p.y) * BLOB_SPRING, BLOB_DAMPING);
      });

      // All-pairs separation — four points, so the honest O(n²) reason
      // NoteConstellation.jsx's own quadtree comment names (complexity,
      // never a measured bottleneck at THAT scale) applies here even more
      // plainly: there is no scale at which four blobs would ever justify
      // reaching for it.
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const a = points[i];
          const b = points[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const minDist = (BLOBS[i].size + BLOBS[j].size) * BLOB_RADIUS_FACTOR + BLOB_SEPARATION_PADDING;
          if (dist >= minDist) continue;

          const overlap = (minDist - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }

      points.forEach((p, i) => {
        const el = elRefs.current[i];
        if (el) el.style.transform = `translate(${ p.x.toFixed(2) }px, ${ p.y.toFixed(2) }px) scale(${ (1 + Math.sin(simTime * 0.6 + i * 1.7) * 0.12).toFixed(3) })`;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  return BLOBS.map((blob, index) => (
    <span
      key={ index }
      ref={ (el) => { elRefs.current[index] = el; } }
      className="gooey-blob"
      style={{
        width: blob.size,
        height: blob.size,
        backgroundColor: blob.color,
      }}
    />
  ));
};

const GooeyBlobs = ({ burst, reduceMotion }) => (
  <>
    {/* EmptyStateWash sits OUTSIDE the gooey-filtered div on purpose — that
        filter (see .gooey-blobs below) is a blur+contrast trick tuned for
        melting solid blob shapes together, and running a WebGL canvas's
        own rendered output through it would just muddy real ripple detail
        for no benefit. */}
    <EmptyStateWash reduceMotion={ reduceMotion } />
    <div
      className="gooey-blobs"
      aria-hidden="true"
    >
      <VerletBlobs reduceMotion={ reduceMotion } />
      {
      burst && BURST.map((drop, index) => (
        <motion.span
          key={ `burst-${ index }` }
          className="gooey-blob"
          style={{
            width: 92,
            height: 92,
            backgroundColor: drop.color,
          }}
          initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
          animate={{
            x: [0, drop.x],
            y: [0, drop.y],
            scale: [0, 1.5, 0],
            opacity: [0, 1, 0],
          }}
          transition={{ duration: 1.15, delay: index * .06, ease: "easeInOut" }}
        />
      ))
      }
    </div>
  </>
);

// Each letter of the heading springs up from under the fold on its own,
// with a starchy overshoot.
const NOTES_HEADING = "Notes".split("");

// Receives the notes already filtered and ordered by Home — the search
// text, star, and color lenses all live up in the toolbar now.
const NoteList = ({
  notes,
  hasNotes,
  focusMode,
  searchQuery,
  scrollVelocity,
  clearFilters,
  deskCleared,
  addNote,
  allTags,
  sortTag,
  setSortTag,
  selectMode,
  toggleSelectMode,
  enterSelectMode,
  selectedIds,
  toggleSelectNote,
  setSelection,
  selectAllVisible,
  spawn,
  clearSpawn,
  sortMode,
  setSortMode,
  shuffleNotes,
  deleteNote,
  updateTitle,
  updateText,
  updateFavourite,
  updateColor,
  updateLock,
  reorderNotes,
  duplicateNote,
  openEditor,
  reduceMotion,
  pileView,
  togglePileView,
}) => {
  const ref = useRef(null);

  // Which note (if any) is currently hovered, for TagThreads below — the
  // ink-capillary connections to every other visible note sharing a tag.
  const [hoveredNoteId, setHoveredNoteId] = useState(null);

  const allSelected = notes.length > 0 && notes.every((note) => selectedIds?.has(note.id));

  // The sort-mode and tag-filter thumbs borrow the free cursor's own press
  // pulse and idle pool (see useInkPulse) so they carry the same elastic
  // personality instead of just sliding flatly between labels.
  const sortPulse = useInkPulse(sortMode);
  const tagPulse = useInkPulse(sortTag);

  const [numPerRow, setNumPerRow] = useState(0);
  const [renderFirstRow, setRenderFirstRow] = useState(false);  // To delay the rendering of the notes list group.

  // The whole notes panel throws a fluid, high-gloss burst — a scale
  // overshoot, a brief blur pulse, a shallow 3D tilt that rights itself —
  // every time focus mode toggles, timed with .home's grid-track collapse
  // (Home.css) and the nav/header slide (Navigation.jsx, Header.jsx) so the
  // panel visibly stretches into the reclaimed space rather than just
  // snapping to its new size once the layout catches up. Imperative
  // AnimatorControls (the same technique NoteEditor.jsx uses for its own
  // resize wobble) rather than a declarative animate target, because the
  // burst has to replay every toggle even when it returns to the exact
  // same resting values each time.
  const panelMorph = useAnimationControls();
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    panelMorph.start({
      scale: [1, focusMode ? 1.028 : .985, 1],
      filter: ["blur(0px)", "blur(7px)", "blur(0px)"],
      rotateX: [0, focusMode ? -2.2 : 1.6, 0],
      transition: { duration: .6, times: [0, .45, 1], ease: "easeInOut" },
    });
  }, [focusMode, panelMorph]);

  // A one-off flag, true for a beat right after the desk goes from holding
  // notes to holding none — drives the bigger blob bloom and the
  // congratulatory pill in the true-empty state below.
  const [celebrateClean, setCelebrateClean] = useState(false);
  const prevClearedRef = useRef(deskCleared);

  useEffect(() => {
    if (deskCleared === prevClearedRef.current) return;

    prevClearedRef.current = deskCleared;
    setCelebrateClean(true);
    const timer = setTimeout(() => setCelebrateClean(false), 1300);
    return () => clearTimeout(timer);
  }, [deskCleared]);

  // Right-click on empty desk space blooms a gooey ring of every note color
  // — same recipe as a note's own right-click menu — and picking one pours
  // a fresh note that morphs straight out of wherever the click landed,
  // reusing the exact spawn machinery an ink pot triggers.
  const [gridRadialAt, setGridRadialAt] = useState(null);
  const paletteNames = Object.keys(NOTE_COLORS);

  const openGridRadialMenu = (e) => {
    if (e.target.closest(".note, button, input, textarea, a")) return;

    e.preventDefault();
    setGridRadialAt({
      x: Math.min(Math.max(e.clientX, GRID_RADIAL_MARGIN), window.innerWidth - GRID_RADIAL_MARGIN),
      y: Math.min(Math.max(e.clientY, GRID_RADIAL_MARGIN), window.innerHeight - GRID_RADIAL_MARGIN),
    });
  };

  const closeGridRadialMenu = () => setGridRadialAt(null);

  useEffect(() => {
    if (!gridRadialAt) return;

    const handleKey = (event) => {
      if (event.key === "Escape") closeGridRadialMenu();
    };
    const handleOutside = () => closeGridRadialMenu();

    window.addEventListener("keydown", handleKey);
    const timer = setTimeout(() => document.addEventListener("pointerdown", handleOutside), 0);

    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handleOutside);
    };
  }, [gridRadialAt]);

  // Click-drag across empty desk space — same exclusion as the radial menu
  // above — traces a real freeform loop (recorded points, the same
  // "gap-throttled array plus a Catmull-Rom smoothPath" recipe
  // NoteConstellation.jsx's own lasso already established) rather than
  // the axis-aligned rectangle this used to draw, and picks up every note
  // it actually encircles as it grows, live. Held in a ref rather than
  // state until it actually crosses LASSO_THRESHOLD so a plain click on
  // empty space (no drag at all) never enters select mode or touches the
  // selection. Client (viewport) coordinates throughout, matched against
  // each note's own getBoundingClientRect(), so no local coordinate
  // conversion is needed against the grid's own scroll/layout.
  const LASSO_THRESHOLD = 6; // px of travel from the press point before this counts as a real drag
  const LASSO_POINT_GAP = 4; // px between recorded points — fine enough for tight loops, coarse enough not to flood the array
  const lassoStateRef = useRef(null);
  const [lassoPath, setLassoPath] = useState(null);

  // A note counts as "in" the loop by its own CENTER landing inside the
  // traced polygon (the same convention NoteConstellation's own lasso
  // already uses) rather than any overlap with it — the only reading that
  // actually makes sense once the loop is an arbitrary traced shape
  // instead of a rectangle, where "does any pixel of this card touch the
  // marquee" was a reasonable stand-in for "did you mean to include it."
  const notesInLasso = (points) => {
    const container = ref.current;
    if (!container || points.length < 3) return [];

    const polygon = points.map((p) => [p.x, p.y]);
    const ids = [];
    container.querySelectorAll("[data-note-id]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (pointInPolygon(r.left + r.width / 2, r.top + r.height / 2, polygon)) ids.push(el.dataset.noteId);
    });

    return ids;
  };

  const handleLassoMove = (e) => {
    const state = lassoStateRef.current;
    if (!state) return;

    const first = state.points[0];

    if (!state.active) {
      if (Math.hypot(e.clientX - first.x, e.clientY - first.y) < LASSO_THRESHOLD) return;
      state.active = true;
      if (!selectMode) enterSelectMode?.();
    }

    const last = state.points[state.points.length - 1];
    if (Math.hypot(e.clientX - last.x, e.clientY - last.y) >= LASSO_POINT_GAP) {
      state.points.push({ x: e.clientX, y: e.clientY });
    }

    // Closed with an explicit line back to the very first point — smoothPath
    // itself only ever draws an open curve THROUGH the given points, and an
    // unclosed loop would leave a visible straight gap between the last
    // recorded point and the start every frame it's still growing.
    setLassoPath(`${ smoothPath(state.points) } L ${ first.x } ${ first.y } Z`);
    setSelection?.(notesInLasso(state.points));
  };

  const handleLassoUp = () => {
    window.removeEventListener("pointermove", handleLassoMove);
    window.removeEventListener("pointerup", handleLassoUp);
    lassoStateRef.current = null;
    setLassoPath(null);
  };

  const handleLassoDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".note, button, input, textarea, a")) return;

    lassoStateRef.current = { points: [{ x: e.clientX, y: e.clientY }], active: false };
    window.addEventListener("pointermove", handleLassoMove);
    window.addEventListener("pointerup", handleLassoUp);
  };

  // The window listeners above are only ever live mid-drag; this just
  // guarantees they're gone if the component unmounts (a filter change,
  // navigating away) while one happens to be in flight.
  useEffect(() => () => {
    window.removeEventListener("pointermove", handleLassoMove);
    window.removeEventListener("pointerup", handleLassoUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The shuffle die does an elastic tumble while the layout springs riffle
  // the notes into their new random order.
  const shuffleIconRef = useRef(null);

  const handleShuffle = () => {
    shuffleNotes?.();

    if (shuffleIconRef.current) {
      anime.remove(shuffleIconRef.current);
      anime({
        targets: shuffleIconRef.current,
        rotate: "+=360",
        scale: [1, 1.4, 1],
        duration: 900,
        easing: "easeOutElastic(1, .5)",
      });
    }
  }

  // The daily-ink card drifts a little against the desk's own scroll — the
  // one static element in the grid that isn't already scroll-reactive the
  // way every note's whileInView entrance is. Targets the .home scroller
  // Lenis registered a ScrollTrigger proxy for (see useLenisScroll.jsx) by
  // its selector, so this stays a lightweight scrub rather than needing the
  // scroller instance threaded down as a prop.
  const quoteParallaxRef = useRef(null);

  useEffect(() => {
    if (!quoteParallaxRef.current) return;

    const trigger = ScrollTrigger.create({
      trigger: quoteParallaxRef.current,
      scroller: ".home",
      start: "top bottom",
      end: "bottom top",
      scrub: 0.6,
      onUpdate: (self) => {
        gsap.set(quoteParallaxRef.current, { y: (self.progress - 0.5) * 36 });
      },
    });

    return () => trigger.kill();
  }, []);

  // The grid's own settle wave — a light band sweeping down the WHOLE
  // desk as you scroll through it, tied to real scroll progress the same
  // ScrollTrigger infrastructure the quote card's own parallax just above
  // already sets up (same scroller, same scrub). Deliberately NOT another
  // per-card entrance layered on top of each Note's own whileInView pop
  // (see Note.jsx) — reaching into any note's own transform here would
  // mean fighting the half-dozen Framer-driven systems already living on
  // that exact element (the pointer tilt, the move-string lean, the
  // scroll-velocity skew, the spawn/delete morphs), the same conflict this
  // session already hit — and worked around — in ColorSelector.jsx's own
  // drag-to-pour. A grid-wide overlay this file fully owns sidesteps all
  // of that: nothing on any note is ever touched, so nothing here can
  // fight it.
  const gridWashRef = useRef(null);

  useEffect(() => {
    if (!ref.current || !gridWashRef.current || reduceMotion) return undefined;

    const trigger = ScrollTrigger.create({
      trigger: ref.current,
      scroller: ".home",
      start: "top top",
      end: "bottom bottom",
      scrub: 0.6,
      onUpdate: (self) => {
        // Faded out right at the very top/bottom of the sweep rather than
        // visible resting at the edge — the band should read as passing
        // THROUGH the desk, not parked at either end of it.
        const edge = Math.min(self.progress, 1 - self.progress);
        gsap.set(gridWashRef.current, {
          top: `${ self.progress * 100 }%`,
          opacity: Math.min(1, edge * 14),
        });
      },
    });

    return () => trigger.kill();
  }, [reduceMotion]);

  useEffect(() => {
    const delayTimer = setTimeout(() => {
      setRenderFirstRow(true);
    }, 700);

    const delayTimerItemsPerRow = setTimeout(() => {
      setNumPerRow(itemsPerFlexRow(ref));
    }, 750);

    return () => {
      clearTimeout(delayTimer);
      clearTimeout(delayTimerItemsPerRow);
    };
  }, []);

  return (
    <motion.main
      className="main"
      animate={ panelMorph }
      style={{ transformPerspective: 1400 }}
    >
      <div className="header">
        <h2 aria-label="Notes">
          {
            NOTES_HEADING.map((letter, index) => (
              <motion.span
                key={ index }
                initial={{
                  opacity: 0,
                  translateY: 70,
                }}
                animate={{
                  opacity: 1,
                  translateY: 0,
                }}
                transition={{
                  type: "spring",
                  stiffness: 340,
                  damping: 17,
                  delay: .55 + index * .055,
                }}
              >
                { letter }
              </motion.span>
            ))
          }
        </h2>
        <motion.div
          className="desk-tools"
          initial={{
            opacity: 0,
            translateY: 40,
          }}
          animate={{
            opacity: 1,
            translateY: 0,
          }}
          transition={{
            type: "spring",
            stiffness: 200,
            damping: 18,
            delay: .85,
          }}
        >
          <div className="sort-modes">
            {
              SORT_MODES.map((mode) => (
                <motion.button
                  key={ mode.key }
                  type="button"
                  aria-pressed={ sortMode === mode.key }
                  className={ `sort-mode ${ sortMode === mode.key ? "active" : "" }` }
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: .92 }}
                  transition={ springy }
                  onTapStart={ sortPulse.squash }
                  onClick={ () => setSortMode?.(mode.key) }
                >
                  {
                    sortMode === mode.key && (
                      <motion.span
                        layoutId="sortThumb"
                        style={{ position: "absolute", inset: 0, borderRadius: 8 }}
                        transition={{
                          type: "spring",
                          stiffness: 480,
                          damping: 19,
                        }}
                      >
                        <motion.span
                          className="sort-thumb"
                          animate={ sortPulse.jelly }
                          style={{ borderRadius: "inherit" }}
                        />
                      </motion.span>
                    )
                  }
                  <span className="sort-label">{ mode.label }</span>
                </motion.button>
              ))
            }
          </div>
          <motion.button
            type="button"
            aria-label="Shuffle the notes"
            title="Shuffle the notes"
            className="shuffle"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: .88 }}
            transition={ springy }
            onClick={ handleShuffle }
          >
            <span
              ref={ shuffleIconRef }
              className="shuffle-icon"
            >
              <FaShuffle />
            </span>
          </motion.button>
          <motion.button
            type="button"
            aria-pressed={ !!selectMode }
            aria-label={ selectMode ? "Stop selecting notes" : "Select multiple notes" }
            title={ selectMode ? "Stop selecting" : "Select notes" }
            className={ `select-toggle ${ selectMode ? "active" : "" }` }
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: .88 }}
            transition={ springy }
            onClick={ () => toggleSelectMode?.() }
          >
            <FaSquareCheck />
          </motion.button>
          {/* Only appears while actively selecting — sets off a staggered
              wave of checkmarks across the grid rather than an instant flat
              toggle, reusing each note's own select-badge pop-in. */}
          <AnimatePresence>
            {
              selectMode && (
                <motion.button
                  key="selectAll"
                  type="button"
                  aria-label={ allSelected ? "Deselect every note" : "Select every note" }
                  title={ allSelected ? "Deselect all" : "Select all" }
                  className="select-all"
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0 }}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: .92 }}
                  transition={ springy }
                  onClick={ () => selectAllVisible?.() }
                >
                  <FaCheckDouble className="select-all-icon" />
                  { allSelected ? "Deselect all" : "Select all" }
                </motion.button>
              )
            }
          </AnimatePresence>
        </motion.div>
      </div>
      {/* Only appears once at least one note has been tagged — the strip
          would otherwise just be clutter for a desk that never uses tags.
          Same sticky-thumb recipe as the sort-mode control above. */}
      {
        allTags?.length > 0 && (
          <motion.div
            className="tag-filters"
            initial={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
          >
            <button
              type="button"
              aria-pressed={ !sortTag }
              className={ `tag-filter ${ !sortTag ? "active" : "" }` }
              onPointerDown={ tagPulse.squash }
              onClick={ () => setSortTag?.(null) }
            >
              {
                !sortTag && (
                  <motion.span
                    layoutId="tagThumb"
                    style={{ position: "absolute", inset: 0, borderRadius: 999 }}
                    transition={{ type: "spring", stiffness: 480, damping: 19 }}
                  >
                    <motion.span
                      className="tag-thumb"
                      animate={ tagPulse.jelly }
                      style={{ borderRadius: "inherit" }}
                    />
                  </motion.span>
                )
              }
              <span className="tag-filter-label">All</span>
            </button>
            {
              allTags.map((tag) => (
                <button
                  key={ tag }
                  type="button"
                  aria-pressed={ sortTag === tag }
                  className={ `tag-filter ${ sortTag === tag ? "active" : "" }` }
                  onPointerDown={ tagPulse.squash }
                  onClick={ () => setSortTag?.(sortTag === tag ? null : tag) }
                >
                  {
                    sortTag === tag && (
                      <motion.span
                        layoutId="tagThumb"
                        style={{ position: "absolute", inset: 0, borderRadius: 999 }}
                        transition={{ type: "spring", stiffness: 480, damping: 19 }}
                      >
                        <motion.span
                          className="tag-thumb"
                          animate={ tagPulse.jelly }
                          style={{ borderRadius: "inherit" }}
                        />
                      </motion.span>
                    )
                  }
                  <span className="tag-filter-label">#{ tag }</span>
                </button>
              ))
            }
          </motion.div>
        )
      }
      <div ref={ quoteParallaxRef } className="quote-parallax">
        <QuoteCard />
      </div>
      <div
        ref={ ref }
        className={ `notes ${ pileView ? "pile-active" : "" }` }
        onContextMenu={ openGridRadialMenu }
        onPointerDown={ handleLassoDown }
      >
        {
          !reduceMotion && !pileView && (
            <div ref={ gridWashRef } className="grid-settle-wave" aria-hidden="true" />
          )
        }
        {
          pileView && (
            <NotePile
              notes={ notes }
              onOpenNote={ openEditor }
              onExit={ togglePileView }
            />
          )
        }
        {
          renderFirstRow && !pileView && (
            notes?.length > 0 ? (
              <AnimatePresence>
                {
                  notes.map((item, index) => (
                    <Note
                      key={ item.id }
                      // numPerRow needs the grid already painted to measure
                      // row breaks (see itemsPerFlexRow), so it's set 50ms
                      // after renderFirstRow flips true — during that gap it's
                      // still 0, and `index % 0` is NaN, so it's floored to 1
                      // here rather than left to hand every note on the first
                      // paint a NaN transition delay.
                      delay={ (index % Math.max(1, numPerRow) + 1) * 0.16 }
                      note={ item }
                      searchQuery={ searchQuery }
                      scrollVelocity={ scrollVelocity }
                      spawnOrigin={ spawn && spawn.id === item.id ? spawn : null }
                      clearSpawn={ clearSpawn }
                      selectMode={ selectMode }
                      selected={ selectedIds?.has(item.id) }
                      onToggleSelect={ toggleSelectNote }
                      deleteNote={ deleteNote }
                      updateTitle={ updateTitle }
                      updateText={ updateText }
                      updateFavorite={ updateFavourite }
                      updateColor={ updateColor }
                      updateLock={ updateLock }
                      reorderNotes={ reorderNotes }
                      duplicateNote={ duplicateNote }
                      openEditor={ openEditor }
                      onHoverStart={ setHoveredNoteId }
                      onHoverEnd={ (id) => setHoveredNoteId((current) => (current === id ? null : current)) }
                      reduceMotion={ reduceMotion }
                    />
                  ))
                }
              </AnimatePresence>
            ) : hasNotes ? (
              // Notes exist, the filters just hid them all — offer the way back.
              <div
                className="empty-state"
              >
                <GooeyBlobs reduceMotion={ reduceMotion } />
                <motion.h3
                  className="liquid-text"
                  initial={{
                    opacity: 0,
                    translateY: 40,
                  }}
                  animate={{
                    opacity: 1,
                    translateY: 0,
                  }}
                  transition={{
                    duration: 0.6,
                    type: "spring",
                    stiffness: 180,
                    delay: 0.1,
                  }}
                >
                  No matching notes
                </motion.h3>
                <motion.p
                  initial={{
                    opacity: 0,
                    translateY: 40,
                  }}
                  animate={{
                    opacity: 1,
                    translateY: 0,
                  }}
                  transition={{
                    duration: 0.6,
                    type: "spring",
                    stiffness: 180,
                    delay: 0.2,
                  }}
                >
                  Nothing on the desk matches these filters
                </motion.p>
                <motion.button
                  type="button"
                  className="empty-clear"
                  initial={{
                    opacity: 0,
                    translateY: 40,
                  }}
                  animate={{
                    opacity: 1,
                    translateY: 0,
                  }}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: .94 }}
                  transition={{
                    duration: 0.6,
                    type: "spring",
                    stiffness: 180,
                    delay: 0.3,
                  }}
                  onClick={ clearFilters }
                >
                  Show all notes
                </motion.button>
              </div>
            ) : (
              <div
                className="empty-state"
              >
                <GooeyBlobs burst={ celebrateClean } reduceMotion={ reduceMotion } />
                {/* Only plays right after the desk goes from holding notes
                    to holding none — a quieter counterpart to the milestone
                    ink shower, for clearing out rather than filling up. */}
                <AnimatePresence>
                  {
                    celebrateClean && (
                      <motion.span
                        key="cleanDesk"
                        className="clean-desk-pill liquid-text"
                        initial={{ opacity: 0, scale: .15, translateY: -10, borderRadius: 40 }}
                        animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 999 }}
                        /* Bloomed in from a dot; retreats the same way on
                           the way out — a small swell before it collapses
                           back down, instead of a flat linear shrink. */
                        exit={{
                          opacity: 0,
                          scale: [1, 1.06, .15],
                          translateY: -10,
                          transition: EXIT_SPRING,
                        }}
                        transition={{ type: "spring", stiffness: 190, damping: 13 }}
                      >
                        ✦ Clean desk — nice work
                      </motion.span>
                    )
                  }
                </AnimatePresence>
                <motion.h3
                  className="liquid-text"
                  initial={{
                    opacity: 0,
                    translateY: 40,
                  }}
                  animate={{
                    opacity: 1,
                    translateY: 0,
                    scale: 1,
                  }}
                  transition={{
                    duration: 0.6,
                    type: "spring",
                    stiffness: 180,
                    delay: 0.2,
                  }}
                >
                  No notes found
                </motion.h3>
                <motion.p
                  initial={{
                    opacity: 0,
                    translateY: 40,
                  }}
                  animate={{
                    opacity: 1,
                    translateY: 0,
                    scale: 1,
                  }}
                  transition={{
                    duration: 0.6,
                    type: "spring",
                    stiffness: 180,
                    delay: 0.3,
                  }}
                >
                  Click on the
                  <motion.strong
                    initial={{
                      scale: .8,
                    }}
                    animate={{
                      scale: 1.1,
                    }}
                    transition={{
                      duration: 0.4,
                      type: "spring",
                      stiffness: 300,
                      delay: .6,
                    }}
                  >
                    +
                  </motion.strong>
                  icon to add a note
                </motion.p>
              </div>
            )
          )
        }
        <TagThreads
          notes={ notes }
          hoveredId={ hoveredNoteId }
          containerRef={ ref }
          reduceMotion={ reduceMotion }
        />
      </div>
      <BulkTethers
        notes={ notes }
        selectedIds={ selectedIds }
        containerRef={ ref }
        reduceMotion={ reduceMotion }
      />
      {
        createPortal(
          <AnimatePresence>
            {
              lassoPath && (
                <svg className="lasso-layer" aria-hidden="true">
                  <motion.path
                    className="lasso-path"
                    d={ lassoPath }
                    initial={{ opacity: 0, scale: .92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.05, transition: EXIT_SPRING }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                </svg>
              )
            }
          </AnimatePresence>,
          document.body
        )
      }
      {
        createPortal(
          <AnimatePresence>
            {
              gridRadialAt && (
                <div className="note-radial-layer">
                  <div className="note-radial-menu" style={{ left: gridRadialAt.x, top: gridRadialAt.y }}>
                    {
                      paletteNames.map((name, index) => {
                        const angle = (index / paletteNames.length) * Math.PI * 2 - Math.PI / 2;
                        const ox = Math.cos(angle) * GRID_RADIAL_RADIUS;
                        const oy = Math.sin(angle) * GRID_RADIAL_RADIUS;

                        return (
                          <motion.button
                            key={ name }
                            type="button"
                            aria-label={ `Pour a new ${ name } note here` }
                            title={ `New ${ name } note` }
                            className={ `note-radial-item ${ name }-bg` }
                            initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
                            animate={{ x: ox, y: oy, scale: 1, opacity: 1 }}
                            exit={{
                              x: 0,
                              y: 0,
                              scale: 0,
                              opacity: 0,
                              transition: {
                                ...EXIT_SPRING,
                                delay: (paletteNames.length - index) * .012,
                              },
                            }}
                            transition={{
                              type: "spring",
                              stiffness: 260,
                              damping: 15,
                              delay: index * .03,
                            }}
                            onClick={ () => {
                              addNote?.(name, gridRadialAt);
                              closeGridRadialMenu();
                            } }
                          />
                        );
                      })
                    }
                  </div>
                </div>
              )
            }
          </AnimatePresence>,
          document.body
        )
      }
    </motion.main>
  )
}

export default NoteList;
