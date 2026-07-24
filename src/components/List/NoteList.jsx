import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import anime from "animejs";
import { FaShuffle, FaSquareCheck } from "react-icons/fa6";

import Note from "../Note/Note";
import QuoteCard from "../Quote/QuoteCard";

import "./NoteList.css";
import { itemsPerFlexRow } from "../../utils/math";

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
  clearFilters,
  deskCleared,
  allTags,
  sortTag,
  setSortTag,
  selectMode,
  toggleSelectMode,
  selectedIds,
  toggleSelectNote,
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
}) => {
  const ref = useRef(null);

  const [numPerRow, setNumPerRow] = useState(0);
  const [renderFirstRow, setRenderFirstRow] = useState(false);  // To delay the rendering of the notes list group.

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
    <main className="main">
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
                  onClick={ () => setSortMode?.(mode.key) }
                >
                  {
                    sortMode === mode.key && (
                      <motion.span
                        layoutId="sortThumb"
                        className="sort-thumb"
                        style={{ borderRadius: 8 }}
                        transition={{
                          type: "spring",
                          stiffness: 480,
                          damping: 30,
                        }}
                      />
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
              onClick={ () => setSortTag?.(null) }
            >
              {
                !sortTag && (
                  <motion.span
                    layoutId="tagThumb"
                    className="tag-thumb"
                    style={{ borderRadius: 999 }}
                    transition={{ type: "spring", stiffness: 480, damping: 30 }}
                  />
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
                  onClick={ () => setSortTag?.(sortTag === tag ? null : tag) }
                >
                  {
                    sortTag === tag && (
                      <motion.span
                        layoutId="tagThumb"
                        className="tag-thumb"
                        style={{ borderRadius: 999 }}
                        transition={{ type: "spring", stiffness: 480, damping: 30 }}
                      />
                    )
                  }
                  <span className="tag-filter-label">#{ tag }</span>
                </button>
              ))
            }
          </motion.div>
        )
      }
      <QuoteCard />
      <div
        ref={ ref }
        className="notes"
      >
        {
          renderFirstRow && (
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
                        className="clean-desk-pill"
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
      </div>
    </main>
  )
}

export default NoteList;
