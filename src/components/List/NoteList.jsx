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
import NotePile from "../Pile/NotePile";
import { NOTE_COLORS } from "../../constants/colors";

import "./NoteList.css";
import { itemsPerFlexRow } from "../../utils/math";
import useInkPulse from "../../hooks/useInkPulse";

gsap.registerPlugin(ScrollTrigger);

const GRID_RADIAL_RADIUS = 58;
const GRID_RADIAL_MARGIN = 100;

const springy = {
  type: "spring",
  stiffness: 400,
  damping: 17,
};

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

const GooeyBlobs = ({ burst }) => (
  <div
    className="gooey-blobs"
    aria-hidden="true"
  >
    {
      BLOBS.map((blob, index) => (
        <motion.span
          key={ index }
          className="gooey-blob"
          style={{
            width: blob.size,
            height: blob.size,
            backgroundColor: blob.color,
          }}
          animate={{
            x: blob.x,
            y: blob.y,
            scale: [1, 1.15, 1],
          }}
          transition={{
            duration: blob.duration,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))
    }
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
  // above — draws an elastic selection rectangle and picks up every note it
  // covers as it grows, live. Held in a ref rather than state until it
  // actually crosses MOVE_THRESHOLD so a plain click on empty space (no
  // drag at all) never enters select mode or touches the selection.
  // Client (viewport) coordinates throughout, matched against each note's
  // own getBoundingClientRect(), so no local coordinate conversion is
  // needed against the grid's own scroll/layout.
  const LASSO_THRESHOLD = 6;
  const lassoStateRef = useRef(null);
  const [lassoRect, setLassoRect] = useState(null);

  const notesInLasso = (rect) => {
    const container = ref.current;
    if (!container) return [];

    const ids = [];
    container.querySelectorAll("[data-note-id]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const overlaps =
        r.left < rect.x + rect.width && r.left + r.width > rect.x &&
        r.top < rect.y + rect.height && r.top + r.height > rect.y;
      if (overlaps) ids.push(el.dataset.noteId);
    });

    return ids;
  };

  const handleLassoMove = (e) => {
    const state = lassoStateRef.current;
    if (!state) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    if (!state.active) {
      if (Math.hypot(dx, dy) < LASSO_THRESHOLD) return;
      state.active = true;
      if (!selectMode) enterSelectMode?.();
    }

    const rect = {
      x: Math.min(state.startX, e.clientX),
      y: Math.min(state.startY, e.clientY),
      width: Math.abs(dx),
      height: Math.abs(dy),
    };
    setLassoRect(rect);
    setSelection?.(notesInLasso(rect));
  };

  const handleLassoUp = () => {
    window.removeEventListener("pointermove", handleLassoMove);
    window.removeEventListener("pointerup", handleLassoUp);
    lassoStateRef.current = null;
    setLassoRect(null);
  };

  const handleLassoDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".note, button, input, textarea, a")) return;

    lassoStateRef.current = { startX: e.clientX, startY: e.clientY, active: false };
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
                      delay={ (index % numPerRow + 1) * 0.16 }
                      note={ item }
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
                    />
                  ))
                }
              </AnimatePresence>
            ) : hasNotes ? (
              // Notes exist, the filters just hid them all — offer the way back.
              <div
                className="empty-state"
              >
                <GooeyBlobs />
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
                <GooeyBlobs burst={ celebrateClean } />
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
                        exit={{
                          opacity: 0,
                          scale: .3,
                          translateY: -8,
                          transition: { duration: .22, ease: "easeIn" },
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
      {
        createPortal(
          <AnimatePresence>
            {
              lassoRect && (
                <motion.div
                  className="lasso-rect"
                  style={{
                    left: lassoRect.x,
                    top: lassoRect.y,
                    width: lassoRect.width,
                    height: lassoRect.height,
                  }}
                  initial={{ opacity: 0, scale: .92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05, transition: { duration: .18, ease: "easeIn" } }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
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
                                duration: .18,
                                delay: (paletteNames.length - index) * .012,
                                ease: "easeIn",
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
