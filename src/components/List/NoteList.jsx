import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import Note from "../Note/Note";

import "./NoteList.css";
import { itemsPerFlexRow } from "../../utils/math";

// Slow drifting drops of note ink behind the empty desk; the page's gooey
// filter melts them into one lava-lamp blob as their paths cross.
const BLOBS = [
  { color: "var(--yellow-color)", size: 84, x: [-70, 40, -70], y: [-10, 30, -10], duration: 9 },
  { color: "var(--blue-color)", size: 64, x: [60, -40, 60], y: [20, -30, 20], duration: 11 },
  { color: "var(--pink-color)", size: 52, x: [-20, 70, -20], y: [50, -20, 50], duration: 10 },
  { color: "var(--purple-color)", size: 44, x: [30, -60, 30], y: [-40, 40, -40], duration: 12 },
];

const GooeyBlobs = () => (
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
  spawn,
  clearSpawn,
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
      </div>
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
                <GooeyBlobs />
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
