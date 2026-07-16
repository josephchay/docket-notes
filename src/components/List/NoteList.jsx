import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import Note from "../Note/Note";

import "./NoteList.css";
import { itemsPerFlexRow } from "../../utils/math";

// Receives the notes already filtered and ordered by Home — the search
// text, star, and color lenses all live up in the toolbar now.
const NoteList = ({
  notes,
  hasNotes,
  clearFilters,
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
        <motion.h2
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
            stiffness: 160,
            delay: .6,
          }}
        >
          Notes
        </motion.h2>
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
