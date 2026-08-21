import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from 'framer-motion';
import gsap from "gsap";
import { FaStar, FaMoon, FaSun, FaXmark, FaRotateLeft, FaChartSimple, FaChartLine, FaWandMagicSparkles, FaExpand, FaLock, FaLockOpen, FaTrashCan, FaClockRotateLeft, FaGear, FaLayerGroup } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { COMMAND_EVENT } from "../Command/CommandPalette";
import { INSIGHTS_EVENT } from "../Insights/InsightsPanel";
import { TRASH_EVENT } from "../Trash/TrashPanel";
import { HISTORY_EVENT } from "../History/HistoryPanel";
import { SETTINGS_EVENT } from "../Settings/SettingsPanel";
import { INK_LEVELS_EVENT } from "./InkLevelsPanel";
import searchIcon from '../../assets/icons/search.svg';
import useJellyTap from "../../hooks/useJellyTap";
import useInkPulse from "../../hooks/useInkPulse";
import useMagnetic from "../../hooks/useMagnetic";
import useOdometer from "../../hooks/useOdometer";
import { playStar } from "../../utils/sound";
import SparkBurst from "../Spark/SparkBurst";
import FilterScatter from "./FilterScatter";
import { SNAPPY, POP, RAIL_SLIDE, enterExitStagger, iconSpin } from "../Motion";

import './Header.css';

const springy = SNAPPY;

// The color squares bounce in one after another, each with a starchy
// overshoot, once the toolbar itself has landed.
const filterRowVariants = enterExitStagger(.55, .055);

const filterChipVariants = {
  hidden: {
    opacity: 0,
    scale: 0,
    translateY: 16,
  },
  shown: {
    opacity: 1,
    scale: 1,
    translateY: 0,
    transition: {
      type: "spring",
      stiffness: 380,
      damping: 15,
    },
  },
};

// The insights/history/trash/command/focus/pile/settings wands were seven
// near-identical copies of the same whileHover/whileTap/jelly/magnetic
// wiring, differing only in icon, rotation direction, label, and click
// handler — a real ~90 lines of copy-pasted JSX props for what's
// structurally one button. `jelly` and `magnetRef` still come from the
// caller (useJellyTap/registerItem can't run inside a loop), everything
// else is parameterized. Reuses filterChipVariants for its own pop-in — the
// same "starchy overshoot" .color-filters' own chips already ride, so the
// wand row can join the same staggered wave (see header-wand-row below)
// instead of introducing a second, slightly-different pop shape.
const WandButton = ({
  ariaLabel,
  title,
  rotate,
  jelly,
  magnetRef,
  onClick,
  className,
  icon: Icon,
  pressed,
  children,
}) => (
  <motion.div
    role="button"
    aria-pressed={ pressed }
    aria-label={ ariaLabel }
    title={ title }
    variants={ filterChipVariants }
    whileHover={{ scale: 1.14, rotate }}
    whileTap={{ scale: .9 }}
    transition={ SNAPPY }
    onTapStart={ jelly.squash }
    onClick={ onClick }
    className={ `wand ${ className }` }
  >
    <span ref={ magnetRef } style={{ display: "inline-flex" }}>
      <motion.span animate={ jelly.jelly } style={{ display: "inline-flex" }}>
        <Icon className="wand-icon" />
      </motion.span>
    </span>
    { children }
  </motion.div>
);

const Header = ({
  searchText,
  setNotesSortText,
  notesSortByFavorite,
  setNotesSortByFavorite,
  sortColor,
  setSortColor,
  notesCount,
  totalCount,
  clearFilters,
  colorCounts,
  theme,
  toggleTheme,
  focusMode,
  toggleFocusMode,
  persistNotes,
  togglePersistNotes,
  trashCount,
  pileView,
  togglePileView,
  reduceMotion,
  celebration,
}) => {
  const filtersActive = searchText !== "" || notesSortByFavorite || sortColor !== null;

  // The toolbar's plain icon buttons (star, and the three bare wand icons)
  // were the one flat corner of the desk — a uniform whileHover/whileTap
  // scale with no squash, no stretch, while everything else on the page
  // has some spring in it. Each gets its own jelly, played on its own inner
  // icon span so it never fights the button's own hover/tap scale.
  const starJelly = useJellyTap();
  const inkJelly = useJellyTap();
  const insightsJelly = useJellyTap();
  const historyJelly = useJellyTap();
  const commandJelly = useJellyTap();
  const focusJelly = useJellyTap();
  const trashJelly = useJellyTap();
  const settingsJelly = useJellyTap();
  const pileJelly = useJellyTap();

  // The color-filter ring borrows the free cursor's own press pulse and
  // idle pool (see useInkPulse) so it carries the same elastic personality
  // as it slides between squares.
  const colorRingPulse = useInkPulse(sortColor);

  // The toolbar's icon buttons feel the pointer's distance the same way
  // QuickDock's icons do (see useMagnetic.jsx) — "xy" rather than the
  // dock's "x" since this row can wrap onto a second line on narrow windows,
  // where an x-only distance would still tug at icons sitting on a
  // different line directly above or below the pointer. Each icon gets its
  // own plain wrapper span as the GSAP target, never the same node framer's
  // jelly/hover/tap animations already control, so the two never fight over
  // one transform.
  const toolbarMagnetic = useMagnetic({ range: 80, maxLift: 10, maxScale: 1.28, axis: "xy", reduceMotion });

  // Rolls through the intervening numbers rather than snapping straight to
  // the new count (see useOdometer.js — already HistoryPanel's own recipe
  // for exactly this, reused here) — a jump of several notes at once (a
  // bulk delete, a filter narrowing hard) reads as an actual count-through
  // instead of an instant substitution.
  const displayedNotesCount = useOdometer(notesCount);

  // The search field's own ripple (see the <filter id="search-ripple">
  // defs below) — a SEPARATE feDisplacementMap from the shared
  // #liquid-text filter LiquidTextFilter.jsx already drives (that one's
  // GSAP tween runs forever, a constant ambient wobble; the same shared
  // filter instance can't ALSO carry this field's own different behavior
  // — intensifying per keystroke rather than idling — without every other
  // .liquid-text element in the app picking that up too). Scale starts at
  // 0 (flat, undistorted) and only ever moves because a keystroke moved
  // it; nothing here idles.
  const searchDisplaceRef = useRef(null);
  const handleSearch = (e) => {
    setNotesSortText(e.target.value);

    if (!reduceMotion && searchDisplaceRef.current) {
      gsap.killTweensOf(searchDisplaceRef.current);
      gsap.timeline()
        .to(searchDisplaceRef.current, { attr: { scale: 9 }, duration: .08, ease: "power2.out" })
        .to(searchDisplaceRef.current, { attr: { scale: 0 }, duration: .55, ease: "power2.out" });
    }
  }

  // Escape wipes the query and hands the caret back to the desk.
  const handleSearchKeyDown = (e) => {
    if (e.key === "Escape") {
      setNotesSortText("");
      e.target.blur();
    }
  }

  // A distinct reaction for the instant a real search actually comes up
  // empty — reuses the exact same displacement ripple every keystroke
  // already triggers above (a bigger scale spike, same filter/ref, no new
  // mechanism) plus a small rejecting shake on the field itself, rather
  // than leaving "nothing matched" with no feedback beyond the note grid
  // quietly going blank. Fires once on the actual transition into that
  // state (via the ref below), not on every render while it stays there —
  // `notesCount` only reflects the just-typed character once Home.jsx has
  // re-rendered with it, so this has to live in its own effect rather than
  // inside handleSearch itself, which only ever sees the PREVIOUS count.
  const searchInputRef = useRef(null);
  const wasEmptyResultRef = useRef(false);

  useEffect(() => {
    const isEmptyResult = searchText.trim() !== "" && notesCount === 0;

    if (isEmptyResult && !wasEmptyResultRef.current && !reduceMotion) {
      if (searchDisplaceRef.current) {
        gsap.killTweensOf(searchDisplaceRef.current);
        gsap.timeline()
          .to(searchDisplaceRef.current, { attr: { scale: 22 }, duration: .1, ease: "power2.out" })
          .to(searchDisplaceRef.current, { attr: { scale: 0 }, duration: .7, ease: "power2.out" });
      }
      if (searchInputRef.current) {
        gsap.killTweensOf(searchInputRef.current);
        gsap.fromTo(
          searchInputRef.current,
          { x: 0 },
          { keyframes: { x: [0, -6, 6, -4, 4, 0] }, duration: .35, ease: "power1.inOut" }
        );
      }
    }

    wasEmptyResultRef.current = isEmptyResult;
  }, [searchText, notesCount, reduceMotion]);

  // The color row's own physical sweep on clear (see FilterScatter.jsx) —
  // chipRefs is a plain array (registered the same way toolbarMagnetic's
  // own items are, via a ref-callback per index) rather than React state,
  // since nothing here ever needs to trigger a re-render off it. The real
  // clearFilters() prop always fires regardless of reduceMotion — the
  // scatter is purely the decorative half, layered on top of (not gating)
  // the actual filter reset.
  const chipRefs = useRef([]);
  const filterScatterRef = useRef(null);

  // fling: null for a plain tap, or framer's own drag-release velocity
  // ({ x, y } px/s — see the clear-filters button's onDragEnd below) for a
  // real flick, passed straight through to FilterScatter.scatter.
  const handleClearFilters = (fling) => {
    if (!reduceMotion && filterScatterRef.current) {
      const chips = chipRefs.current
        .map((el, index) => {
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            size: rect.width,
            color: `var(--${ paletteNames[index] }-color)`,
          };
        })
        .filter(Boolean);
      filterScatterRef.current.scatter(chips, fling ?? null);
    }
    clearFilters();
  }

  // Drag straight across the color row to scrub between filters live,
  // rather than only ever landing exactly one tap at a time — the shared
  // colorFilterRing (see the JSX below) already slides smoothly between
  // whichever square is currently `sortColor`, so dragging just feeds it a
  // faster stream of targets instead of needing any motion of its own.
  // Kept fully separate from each button's own onClick (a real drag never
  // fires a click at all, since release lands on a different element than
  // the press did), so a plain tap still toggles exactly as it always has.
  const colorScrubRef = useRef(false);

  const handleColorRowPointerDown = (e) => {
    if (!(e.target instanceof Element) || !e.target.closest(".color-filter")) return;
    colorScrubRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  // Checks the pointer against each chip's own known rect directly rather
  // than document.elementFromPoint — CRA's dev-server error overlay
  // mounts a full-viewport iframe (id="webpack-dev-server-client-overlay")
  // that's pointer-events: none for real clicks but still comes back as
  // elementFromPoint's own top hit regardless, silently breaking any
  // point-based hit-test done this way for anyone running the app via
  // `npm start` — not just an automated-testing quirk.
  const handleColorRowPointerMove = (e) => {
    if (!colorScrubRef.current) return;
    const chips = e.currentTarget.querySelectorAll(".color-filter");
    for (const chip of chips) {
      const rect = chip.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) continue;
      const name = chip.getAttribute("data-color");
      if (name && name !== sortColor) {
        colorRingPulse.squash();
        setSortColor(name);
      }
      break;
    }
  };

  const handleColorRowPointerUp = () => { colorScrubRef.current = false; };

  // Turning the star filter on throws a little handful of sparks, the same
  // celebration a note gives when it is starred.
  const [starBurst, setStarBurst] = useState(false);
  const burstTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(burstTimerRef.current), []);

  const handleStarFilter = () => {
    if (!notesSortByFavorite) {
      setStarBurst(true);
      playStar();
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = setTimeout(() => setStarBurst(false), 700);
    }
    setNotesSortByFavorite();
  }

  // How much of each ink the desk holds, and overall progress toward the
  // next milestone, now live in their own full panel (see
  // InkLevelsPanel.jsx) rather than a toolbar popover — this button just
  // summons it, the same event-dispatch convention every other panel
  // trigger below already uses.
  const paletteNames = Object.keys(NOTE_COLORS);

  // The ink wash washes out from wherever the theme button actually sits,
  // not the pointer — so it looks the same whether it was clicked, tapped,
  // or triggered from the command palette.
  const themeRef = useRef(null);
  const handleThemeToggle = () => {
    const rect = themeRef.current?.getBoundingClientRect();
    toggleTheme(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined);
  }

  return (
    <motion.header
      initial={{
        opacity: 0,
        translateY: 80,
      }}
      animate={{
        opacity: 1,
        translateY: 0,
      }}
      transition={{
        duration: 0.8,
        type: "spring",
        stiffness: 100,
        delay: .4,
      }}
      className="header"
    >
      {/* A separate inner wrapper for the focus-mode slide, so it doesn't
          have to fight the entrance animation above (which only ever plays
          once, with its own one-time delay) for control of translateY. */}
      <motion.div
        className="header-toolbar"
        onMouseMove={ toolbarMagnetic.handleMove }
        onMouseLeave={ toolbarMagnetic.handleLeave }
        animate={{
          translateY: focusMode ? -90 : 0,
          opacity: focusMode ? 0 : 1,
        }}
        /* Same fixed duration + bezier as the nav rail's slide and .home's
           grid-track collapse (Home.css) — all three finish on the same
           beat instead of drifting apart as three separately-timed springs. */
        transition={ RAIL_SLIDE }
      >
      <div className="search">
        <div className="icon">
          <img src={ searchIcon } alt="Search Icon" />
        </div>
        {/* The search field's own liquid filter (see searchDisplaceRef
            above) — width/height 0, the same invisible-defs-only pattern
            LiquidTextFilter.jsx uses for the shared #liquid-text filter,
            just scoped locally here since nothing outside this one input
            wears it. */}
        <svg width="0" height="0" aria-hidden="true">
          <defs>
            <filter id="search-ripple" x="-20%" y="-60%" width="140%" height="220%">
              <feTurbulence type="fractalNoise" baseFrequency="0.02 0.05" numOctaves="2" seed="3" result="search-noise" />
              <feDisplacementMap ref={ searchDisplaceRef } in="SourceGraphic" in2="search-noise" scale="0" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
        <input
          ref={ searchInputRef }
          type="text"
          placeholder="Search"
          value={ searchText }
          onChange={ handleSearch }
          onKeyDown={ handleSearchKeyDown }
          className="search-ripple-text"
        />
        {/* One slot, two moods: a "/" shortcut hint while idle, a clear
            button once there is something to clear. */}
        <span className="search-extra">
          <AnimatePresence initial={ false }>
            {
              searchText ? (
                <motion.button
                  key="clearSearch"
                  type="button"
                  aria-label="Clear the search"
                  className="search-clear"
                  initial={{ opacity: 0, scale: .5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: .5 }}
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .85 }}
                  transition={ springy }
                  onClick={ () => setNotesSortText("") }
                >
                  <FaXmark />
                </motion.button>
              ) : (
                <motion.kbd
                  key="searchHint"
                  className="search-hint"
                  aria-hidden="true"
                  initial={{ opacity: 0, scale: .5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: .5 }}
                  transition={ springy }
                >
                  /
                </motion.kbd>
              )
            }
          </AnimatePresence>
        </span>
        <motion.button
          type="button"
          aria-label={ notesSortByFavorite ? "Show every note" : "Show only starred notes" }
          aria-pressed={ notesSortByFavorite }
          whileHover={{ scale: 1.14, rotate: -8 }}
          whileTap={{ scale: 0.96 }}
          transition={ springy }
          onTapStart={ starJelly.squash }
          onClick={ handleStarFilter }
          className={ `star ${ notesSortByFavorite ? "active" : "" }` }
        >
          <span ref={ toolbarMagnetic.registerItem(0) } style={{ display: "inline-flex" }}>
            <motion.span animate={ starJelly.jelly } style={{ display: "inline-flex" }}>
              <FaStar className="star-icon" />
            </motion.span>
          </span>
          <SparkBurst
            active={ starBurst }
            count={ 6 }
            radius={ (i) => 26 + (i % 2) * 8 }
            className="star-burst"
          />
        </motion.button>
      </div>
      {/* Springs into place once on Header's own mount; every count change
          after that rolls through via useOdometer above instead of
          re-triggering this same entrance on a remount — a rapid run of
          small changes now reads as one continuous count rather than a
          repeated pop each time. Filtered views read "shown / total". */}
      <motion.span
        className="notes-count"
        title={
          filtersActive
            ? `${ notesCount } of ${ totalCount } notes match`
            : `${ totalCount } notes on the desk`
        }
        initial={{
          opacity: 0,
          scale: .6,
          translateY: 8,
        }}
        animate={{
          opacity: 1,
          scale: 1,
          translateY: 0,
        }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 13,
        }}
      >
        { displayedNotesCount }
        {
          filtersActive && (
            <small>/ { totalCount }</small>
          )
        }
      </motion.span>
      {/* One square per palette color; tap to see only that color, tap
          again to let every note back onto the desk — or drag straight
          across the row to scrub between them live (see the pointer
          handlers above). The ink ring is a single shared element, so it
          slides — and stretches, gooily — from square to square. */}
      <motion.div
        className="color-filters"
        variants={ filterRowVariants }
        initial="hidden"
        animate="shown"
        onPointerDown={ handleColorRowPointerDown }
        onPointerMove={ handleColorRowPointerMove }
        onPointerUp={ handleColorRowPointerUp }
        onPointerCancel={ handleColorRowPointerUp }
      >
        {
          Object.keys(NOTE_COLORS).map((name) => (
            <motion.button
              key={ name }
              type="button"
              data-color={ name }
              title={ sortColor === name ? "Show every color" : `Show only ${ name } notes` }
              aria-label={ sortColor === name ? "Show every color" : `Show only ${ name } notes` }
              aria-pressed={ sortColor === name }
              className={ `color-filter ${ sortColor === name ? "active" : "" }` }
              variants={ filterChipVariants }
              whileHover={{ scale: 1.1, translateY: -2 }}
              whileTap={{ scale: .88 }}
              transition={ springy }
              onTapStart={ colorRingPulse.squash }
              onClick={ () => setSortColor(sortColor === name ? null : name) }
            >
              <span ref={ (el) => { chipRefs.current[paletteNames.indexOf(name)] = el; } } className={ `color-chip ${ name }-bg` } />
              <AnimatePresence>
                {
                  sortColor === name && (
                    <motion.span
                      layoutId="colorFilterRing"
                      style={{ position: "absolute", inset: 0, borderRadius: 10 }}
                      /* No exit before this — the ring used to just vanish
                         the instant a color filter cleared, the one flat
                         corner left on an otherwise fully-animated row. A
                         squash-then-fade reads as the ink flattening back
                         into the page rather than a plain shrink. */
                      exit={{ scaleY: .25, scaleX: 1.15, opacity: 0, transition: { duration: .28, ease: "easeIn" } }}
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 19,
                      }}
                    >
                      <motion.span
                        className="color-ring"
                        animate={ colorRingPulse.jelly }
                        style={{ borderRadius: "inherit" }}
                      />
                    </motion.span>
                  )
                }
              </AnimatePresence>
            </motion.button>
          ))
        }
      </motion.div>
      <FilterScatter ref={ filterScatterRef } />
      <AnimatePresence>
        {
          filtersActive && (
            <motion.button
              key="clearFilters"
              type="button"
              className="clear-filters"
              initial={{ opacity: 0, scale: .7, translateX: -10 }}
              animate={{ opacity: 1, scale: 1, translateX: 0 }}
              exit={{ opacity: 0, scale: .7, translateX: -10 }}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: .92 }}
              transition={ springy }
              /* A real flick, not just a click — drag the button itself a
                 little, same elastic-tug idiom PullString's own tassel
                 uses, and release it to throw the color row with actual
                 captured velocity (see FilterScatter's fling handling)
                 instead of the default gentle toss. dragSnapToOrigin
                 springs the button itself straight back into place;
                 framer suppresses onClick for any release that actually
                 engaged the drag, so a plain tap still only ever fires
                 onClick below, never both. */
              drag
              dragSnapToOrigin
              dragElastic={ 0.3 }
              dragConstraints={{ left: -20, right: 20, top: -16, bottom: 16 }}
              dragTransition={{ bounceStiffness: 480, bounceDamping: 22 }}
              onClick={ () => handleClearFilters(null) }
              onDragEnd={ (e, info) => handleClearFilters(info.velocity) }
            >
              <FaRotateLeft className="clear-filters-icon" />
              <span>Clear</span>
            </motion.button>
          )
        }
      </AnimatePresence>
      {/* ink-levels -> settings all pop in as one staggered wave once the
          toolbar has landed, picking up right where .color-filters' own
          wave leaves off. display:contents (the same trick QuickDock's own
          item row uses) lets this group share one variants context without
          disturbing .header-toolbar's flex layout — every child below still
          renders as one of its direct flex items. */}
      <motion.div
        className="header-wand-row"
        variants={ enterExitStagger(.62, .045) }
        initial="hidden"
        animate="shown"
      >
      <WandButton
        ariaLabel="Show how much of each ink the desk holds"
        title="Ink levels"
        rotate={ 10 }
        jelly={ inkJelly }
        magnetRef={ toolbarMagnetic.registerItem(1) }
        onClick={ () => window.dispatchEvent(new CustomEvent(INK_LEVELS_EVENT)) }
        className="ink-trigger"
        icon={ FaChartSimple }
      />
      <WandButton
        ariaLabel="Show desk insights"
        title="Desk insights"
        rotate={ 10 }
        jelly={ insightsJelly }
        magnetRef={ toolbarMagnetic.registerItem(2) }
        onClick={ () => window.dispatchEvent(new CustomEvent(INSIGHTS_EVENT)) }
        className="insights-trigger"
        icon={ FaChartLine }
      />
      <WandButton
        ariaLabel="Show edit history"
        title="Edit history"
        rotate={ 10 }
        jelly={ historyJelly }
        magnetRef={ toolbarMagnetic.registerItem(3) }
        onClick={ () => window.dispatchEvent(new CustomEvent(HISTORY_EVENT)) }
        className="history-trigger"
        icon={ FaClockRotateLeft }
      />
      <WandButton
        ariaLabel={ trashCount > 0 ? `Open the trash — ${ trashCount } ${ trashCount === 1 ? "note" : "notes" }` : "Open the trash" }
        title="Trash"
        rotate={ -10 }
        jelly={ trashJelly }
        magnetRef={ toolbarMagnetic.registerItem(4) }
        onClick={ () => window.dispatchEvent(new CustomEvent(TRASH_EVENT)) }
        className="trash-trigger"
        icon={ FaTrashCan }
      >
        <AnimatePresence>
          {
            trashCount > 0 && (
              <motion.span
                key="badge"
                className="trash-badge"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={ POP }
              >
                { trashCount }
              </motion.span>
            )
          }
        </AnimatePresence>
      </WandButton>
      <WandButton
        ariaLabel="Open the command palette"
        title="Command ink (Ctrl K)"
        rotate={ -10 }
        jelly={ commandJelly }
        magnetRef={ toolbarMagnetic.registerItem(5) }
        onClick={ () => window.dispatchEvent(new CustomEvent(COMMAND_EVENT)) }
        className="command-trigger"
        icon={ FaWandMagicSparkles }
      />
      <WandButton
        ariaLabel="Enter focus mode"
        title="Focus mode (F)"
        rotate={ -14 }
        jelly={ focusJelly }
        magnetRef={ toolbarMagnetic.registerItem(6) }
        onClick={ toggleFocusMode }
        className="focus-trigger"
        icon={ FaExpand }
      />
      {/* Tosses the desk into a real physics pile (see NotePile.jsx) — a
          decorative, opt-in view with no reduced-motion variant, so the
          button itself only ever appears when motion is on. */}
      {
        !reduceMotion && (
          <WandButton
            ariaLabel={ pileView ? "Restore the grid" : "Toss notes into a pile" }
            title={ pileView ? "Restore the grid" : "Toss notes into a pile" }
            rotate={ -10 }
            jelly={ pileJelly }
            magnetRef={ toolbarMagnetic.registerItem(7) }
            onClick={ togglePileView }
            className={ `pile-toggle ${ pileView ? "active" : "" }` }
            icon={ FaLayerGroup }
            pressed={ !!pileView }
          />
        )
      }
      <motion.div
        ref={ themeRef }
        role="button"
        aria-label={ theme === "dark" ? "Switch to the light theme" : "Switch to the Ink theme" }
        variants={ filterChipVariants }
        whileHover={{
          scale: 1.14,
          rotate: 24,
        }}
        whileTap={{
          scale: 0.9,
        }}
        transition={ springy }
        onClick={ handleThemeToggle }
        className="theme"
      >
        {/* The old icon spins out, the new one springs in — a tiny
            celestial changeover. */}
        <span ref={ toolbarMagnetic.registerItem(8) } style={{ display: "inline-flex" }}>
          <AnimatePresence mode="wait" initial={ false }>
            <motion.span
              key={ theme }
              className="theme-icon-wrap"
              { ...iconSpin({ type: "spring", stiffness: 380, damping: 16 }) }
            >
              {
                theme === "dark" ? (
                  <FaSun className="theme-icon" />
                ) : (
                  <FaMoon className="theme-icon" />
                )
              }
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.div>
      <motion.div
        role="button"
        aria-label={ persistNotes ? "Stop remembering notes after this tab" : "Remember notes across sessions" }
        title={ persistNotes ? "Notes stick around after you close this tab — click to stop" : "Notes clear when this tab closes — click to remember them" }
        variants={ filterChipVariants }
        whileHover={{ scale: 1.14, rotate: -10 }}
        whileTap={{ scale: .9 }}
        transition={ springy }
        onClick={ togglePersistNotes }
        className="persist"
      >
        {/* The same spring-in/spin-out changeover as the theme toggle beside
            it — the lock clicks shut or springs back open. */}
        <span ref={ toolbarMagnetic.registerItem(9) } style={{ display: "inline-flex" }}>
          <AnimatePresence mode="wait" initial={ false }>
            <motion.span
              key={ persistNotes ? "locked" : "unlocked" }
              className="persist-icon-wrap"
              { ...iconSpin({ type: "spring", stiffness: 420, damping: 15 }) }
            >
              {
                persistNotes ? (
                  <FaLock className="persist-icon" />
                ) : (
                  <FaLockOpen className="persist-icon" />
                )
              }
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.div>
      <WandButton
        ariaLabel="Open settings"
        title="Settings"
        rotate={ 14 }
        jelly={ settingsJelly }
        magnetRef={ toolbarMagnetic.registerItem(10) }
        onClick={ () => window.dispatchEvent(new CustomEvent(SETTINGS_EVENT)) }
        className="settings-trigger"
        icon={ FaGear }
      />
      </motion.div>
      </motion.div>
    </motion.header>
  );
}

export default Header;
