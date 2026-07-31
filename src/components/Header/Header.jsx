import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from 'framer-motion';
import { FaStar, FaMoon, FaSun, FaXmark, FaRotateLeft, FaChartSimple, FaChartLine, FaWandMagicSparkles, FaExpand, FaLock, FaLockOpen, FaTrashCan, FaClockRotateLeft } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { MILESTONES } from "../../constants/milestones";
import { COMMAND_EVENT } from "../Command/CommandPalette";
import { INSIGHTS_EVENT } from "../Insights/InsightsPanel";
import { TRASH_EVENT } from "../Trash/TrashPanel";
import { HISTORY_EVENT } from "../History/HistoryPanel";
import searchIcon from '../../assets/icons/search.svg';
import useJellyTap from "../../hooks/useJellyTap";
import useInkPulse from "../../hooks/useInkPulse";
import useMagnetic from "../../hooks/useMagnetic";
import LiquidMeter from "../Meter/LiquidMeter";

import './Header.css';

const springy = {
  type: "spring",
  stiffness: 400,
  damping: 17,
};

// The color squares bounce in one after another, each with a starchy
// overshoot, once the toolbar itself has landed.
const filterRowVariants = {
  hidden: {},
  shown: {
    transition: {
      delayChildren: .55,
      staggerChildren: .055,
    },
  },
};

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
}) => {
  const filtersActive = searchText !== "" || notesSortByFavorite || sortColor !== null;

  // The toolbar's plain icon buttons (star, and the three bare wand icons)
  // were the one flat corner of the desk — a uniform whileHover/whileTap
  // scale with no squash, no stretch, while everything else on the page
  // has some spring in it. Each gets its own jelly, played on its own inner
  // icon span so it never fights the button's own hover/tap scale.
  const starJelly = useJellyTap();
  const insightsJelly = useJellyTap();
  const historyJelly = useJellyTap();
  const commandJelly = useJellyTap();
  const focusJelly = useJellyTap();
  const trashJelly = useJellyTap();

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
  const toolbarMagnetic = useMagnetic({ range: 80, maxLift: 10, maxScale: 1.28, axis: "xy" });

  const handleSearch = (e) => {
    setNotesSortText(e.target.value);
  }

  // Escape wipes the query and hands the caret back to the desk.
  const handleSearchKeyDown = (e) => {
    if (e.key === "Escape") {
      setNotesSortText("");
      e.target.blur();
    }
  }

  // Turning the star filter on throws a little handful of sparks, the same
  // celebration a note gives when it is starred.
  const [starBurst, setStarBurst] = useState(false);
  const burstTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(burstTimerRef.current), []);

  const handleStarFilter = () => {
    if (!notesSortByFavorite) {
      setStarBurst(true);
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = setTimeout(() => setStarBurst(false), 700);
    }
    setNotesSortByFavorite();
  }

  // The ink-levels chart: how much of each ink the desk holds, as springy
  // bars. Clicking a bar borrows the color filter, so the chart doubles as
  // a control. Closes on any press outside it.
  const [inkOpen, setInkOpen] = useState(false);
  const inkRef = useRef(null);

  useEffect(() => {
    if (!inkOpen) return;

    const close = (e) => {
      if (inkRef.current && !inkRef.current.contains(e.target)) setInkOpen(false);
    };

    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [inkOpen]);

  const paletteNames = Object.keys(NOTE_COLORS);
  const maxCount = Math.max(1, ...paletteNames.map((name) => colorCounts?.[name] ?? 0));

  // The ink vial's fill: how far the desk has come from the last milestone
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
        transition={{ duration: .5, ease: [0.34, 1.56, 0.64, 1] }}
      >
      <div className="search">
        <div className="icon">
          <img src={ searchIcon } alt="Search Icon" />
        </div>
        <input
          type="text"
          placeholder="Search"
          value={ searchText }
          onChange={ handleSearch }
          onKeyDown={ handleSearchKeyDown }
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
          <AnimatePresence>
            {
              starBurst && (
                <motion.span
                  className="star-burst"
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {
                    Array.from({ length: 6 }).map((_, i) => {
                      const angle = (Math.PI * 2 * i) / 6;
                      const distance = 26 + (i % 2) * 8;

                      return (
                        <motion.span
                          key={ i }
                          className="spark"
                          initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                          animate={{
                            x: Math.cos(angle) * distance,
                            y: Math.sin(angle) * distance,
                            scale: [0, 1, 0],
                            opacity: [1, 1, 0],
                          }}
                          transition={{ duration: .6, ease: "easeOut" }}
                        >
                          ✦
                        </motion.span>
                      );
                    })
                  }
                </motion.span>
              )
            }
          </AnimatePresence>
        </motion.button>
      </div>
      {/* The tally pops with a spring every time a note joins, leaves, or a
          filter narrows the desk; filtered views read "shown / total". */}
      <motion.span
        key={ `${ notesCount }/${ totalCount }` }
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
        { notesCount }
        {
          filtersActive && (
            <small>/ { totalCount }</small>
          )
        }
      </motion.span>
      {/* One square per palette color; tap to see only that color, tap
          again to let every note back onto the desk. The ink ring is a
          single shared element, so it slides — and stretches, gooily —
          from square to square. */}
      <motion.div
        className="color-filters"
        variants={ filterRowVariants }
        initial="hidden"
        animate="shown"
      >
        {
          Object.keys(NOTE_COLORS).map((name) => (
            <motion.button
              key={ name }
              type="button"
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
              <span className={ `color-chip ${ name }-bg` } />
              {
                sortColor === name && (
                  <motion.span
                    layoutId="colorFilterRing"
                    style={{ position: "absolute", inset: 0, borderRadius: 10 }}
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
            </motion.button>
          ))
        }
      </motion.div>
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
              onClick={ clearFilters }
            >
              <FaRotateLeft className="clear-filters-icon" />
              <span>Clear</span>
            </motion.button>
          )
        }
      </AnimatePresence>
      <div
        className="ink-levels"
        ref={ inkRef }
      >
        <motion.button
          type="button"
          aria-expanded={ inkOpen }
          aria-label="Show how much of each ink the desk holds"
          title="Ink levels"
          className={ `ink-button ${ inkOpen ? "open" : "" }` }
          whileHover={{ scale: 1.14 }}
          whileTap={{ scale: .9 }}
          transition={ springy }
          onClick={ () => setInkOpen((prev) => !prev) }
        >
          <span ref={ toolbarMagnetic.registerItem(1) } style={{ display: "inline-flex" }}>
            <FaChartSimple className="ink-button-icon" />
          </span>
        </motion.button>
        <AnimatePresence>
          {
            inkOpen && (
              <motion.div
                key="inkPopover"
                className="ink-popover"
                style={{ originX: .85, originY: 0 }}
                initial={{ opacity: 0, scale: .2, translateY: -8, borderRadius: 40 }}
                animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 16 }}
                exit={{
                  opacity: 0,
                  scale: .3,
                  translateY: -8,
                  borderRadius: 40,
                  transition: { duration: .18, ease: "easeIn" },
                }}
                transition={{ type: "spring", stiffness: 240, damping: 15 }}
              >
                <div className="ink-meter-row">
                  <LiquidMeter ratio={ milestoneRatio } color="var(--page-ink-color)" label={ milestoneLabel } />
                </div>
                <div className="ink-row">
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
                              ? `${ label } — showing only these; press to show every color`
                              : `${ label } — press to show only these`
                          }
                          aria-pressed={ sortColor === name }
                          className={ `ink-column ${ sortColor === name ? "active" : "" }` }
                          onClick={ () => setSortColor(sortColor === name ? null : name) }
                        >
                          <motion.span
                            key={ `${ name }-${ count }` }
                            className="ink-count"
                            initial={{ opacity: 0, scale: .5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{
                              type: "spring",
                              stiffness: 500,
                              damping: 20,
                              delay: .1 + index * .045,
                            }}
                          >
                            { count }
                          </motion.span>
                          <motion.span
                            className={ `ink-bar ${ name }-bg` }
                            style={{
                              height: 8 + Math.round((count / maxCount) * 56),
                              originY: 1,
                            }}
                            initial={{ scaleY: 0 }}
                            animate={{ scaleY: 1 }}
                            transition={{
                              type: "spring",
                              stiffness: 320,
                              damping: 13,
                              delay: .06 + index * .045,
                            }}
                          />
                        </button>
                      );
                    })
                  }
                </div>
              </motion.div>
            )
          }
        </AnimatePresence>
      </div>
      <motion.div
        role="button"
        aria-label="Show desk insights"
        title="Desk insights"
        whileHover={{ scale: 1.14, rotate: 10 }}
        whileTap={{ scale: .9 }}
        transition={ springy }
        onTapStart={ insightsJelly.squash }
        onClick={ () => window.dispatchEvent(new CustomEvent(INSIGHTS_EVENT)) }
        className="wand"
      >
        <span ref={ toolbarMagnetic.registerItem(2) } style={{ display: "inline-flex" }}>
          <motion.span animate={ insightsJelly.jelly } style={{ display: "inline-flex" }}>
            <FaChartLine className="wand-icon" />
          </motion.span>
        </span>
      </motion.div>
      <motion.div
        role="button"
        aria-label="Show edit history"
        title="Edit history"
        whileHover={{ scale: 1.14, rotate: 10 }}
        whileTap={{ scale: .9 }}
        transition={ springy }
        onTapStart={ historyJelly.squash }
        onClick={ () => window.dispatchEvent(new CustomEvent(HISTORY_EVENT)) }
        className="wand"
      >
        <span ref={ toolbarMagnetic.registerItem(3) } style={{ display: "inline-flex" }}>
          <motion.span animate={ historyJelly.jelly } style={{ display: "inline-flex" }}>
            <FaClockRotateLeft className="wand-icon" />
          </motion.span>
        </span>
      </motion.div>
      <motion.div
        role="button"
        aria-label={ trashCount > 0 ? `Open the trash — ${ trashCount } ${ trashCount === 1 ? "note" : "notes" }` : "Open the trash" }
        title="Trash"
        whileHover={{ scale: 1.14, rotate: -10 }}
        whileTap={{ scale: .9 }}
        transition={ springy }
        onTapStart={ trashJelly.squash }
        onClick={ () => window.dispatchEvent(new CustomEvent(TRASH_EVENT)) }
        className="wand trash-trigger"
      >
        <span ref={ toolbarMagnetic.registerItem(4) } style={{ display: "inline-flex" }}>
          <motion.span animate={ trashJelly.jelly } style={{ display: "inline-flex" }}>
            <FaTrashCan className="wand-icon" />
          </motion.span>
        </span>
        <AnimatePresence>
          {
            trashCount > 0 && (
              <motion.span
                key="badge"
                className="trash-badge"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 20 }}
              >
                { trashCount }
              </motion.span>
            )
          }
        </AnimatePresence>
      </motion.div>
      <motion.div
        role="button"
        aria-label="Open the command palette"
        title="Command ink (Ctrl K)"
        whileHover={{ scale: 1.14, rotate: -10 }}
        whileTap={{ scale: .9 }}
        transition={ springy }
        onTapStart={ commandJelly.squash }
        onClick={ () => window.dispatchEvent(new CustomEvent(COMMAND_EVENT)) }
        className="wand"
      >
        <span ref={ toolbarMagnetic.registerItem(5) } style={{ display: "inline-flex" }}>
          <motion.span animate={ commandJelly.jelly } style={{ display: "inline-flex" }}>
            <FaWandMagicSparkles className="wand-icon" />
          </motion.span>
        </span>
      </motion.div>
      <motion.div
        role="button"
        aria-label="Enter focus mode"
        title="Focus mode (F)"
        whileHover={{ scale: 1.14, rotate: -14 }}
        whileTap={{ scale: .9 }}
        transition={ springy }
        onTapStart={ focusJelly.squash }
        onClick={ toggleFocusMode }
        className="wand"
      >
        <span ref={ toolbarMagnetic.registerItem(6) } style={{ display: "inline-flex" }}>
          <motion.span animate={ focusJelly.jelly } style={{ display: "inline-flex" }}>
            <FaExpand className="wand-icon" />
          </motion.span>
        </span>
      </motion.div>
      <motion.div
        ref={ themeRef }
        role="button"
        aria-label={ theme === "dark" ? "Switch to the light theme" : "Switch to the Ink theme" }
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
        <span ref={ toolbarMagnetic.registerItem(7) } style={{ display: "inline-flex" }}>
          <AnimatePresence mode="wait" initial={ false }>
            <motion.span
              key={ theme }
              className="theme-icon-wrap"
              initial={{ rotate: -140, scale: 0, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{
                rotate: 140,
                scale: 0,
                opacity: 0,
                transition: { duration: .15, ease: "easeIn" },
              }}
              transition={{
                type: "spring",
                stiffness: 380,
                damping: 16,
              }}
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
        whileHover={{ scale: 1.14, rotate: -10 }}
        whileTap={{ scale: .9 }}
        transition={ springy }
        onClick={ togglePersistNotes }
        className="persist"
      >
        {/* The same spring-in/spin-out changeover as the theme toggle beside
            it — the lock clicks shut or springs back open. */}
        <span ref={ toolbarMagnetic.registerItem(8) } style={{ display: "inline-flex" }}>
          <AnimatePresence mode="wait" initial={ false }>
            <motion.span
              key={ persistNotes ? "locked" : "unlocked" }
              className="persist-icon-wrap"
              initial={{ rotate: -140, scale: 0, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{
                rotate: 140,
                scale: 0,
                opacity: 0,
                transition: { duration: .15, ease: "easeIn" },
              }}
              transition={{
                type: "spring",
                stiffness: 420,
                damping: 15,
              }}
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
      </motion.div>
    </motion.header>
  );
}

export default Header;
