import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import Note from "../Note/Note";
import { NOTE_COLORS } from "../../constants/colors";

import "./NoteList.css";
import { itemsPerFlexRow } from "../../utils/math";

const NoteList = ({
  notes,
  deleteNote,
  updateTitle,
  updateText,
  updateFavourite,
  updateColor,
  updateLock,
  reorderNotes,
  duplicateNote,
  openEditor,
  sortText,
  sortFavorite,
  sortColor,
  setSortColor,
}) => {
  const ref = useRef(null);

  const [numPerRow, setNumPerRow] = useState(0);
  const [renderFirstRow, setRenderFirstRow] = useState(false);  // To delay the rendering of the notes list group.

  const reverse = (arr) => {
    const reversed = [];
    for (let i = arr.length - 1; i >= 0; i--) {
      reversed.push(arr[i]);
    }

    return reversed;
  }

  const [filteredNotes, setFilteredNotes] = useState(reverse(notes));

  const sortByText = (arr, text) => {
    return arr.filter((note) =>
      `${ note.title ?? "" } ${ note.text }`.toLowerCase().includes(text)
    );
  }

  const sortByFavorite = (arr) => {
    return arr.filter((note) => note.favorite);
  }

  const sortByColor = (arr, color) => {
    return arr.filter((note) => note.color === color);
  }

  // Every lens over the list — search text, starred, color — stacks here.
  useEffect(() => {
    let filtered = sortByText(reverse(notes), sortText);

    if (sortFavorite) {
      filtered = sortByFavorite(filtered);
    }

    if (sortColor) {
      filtered = sortByColor(filtered, sortColor);
    }

    setFilteredNotes(filtered);
  }, [notes, sortText, sortFavorite, sortColor]);

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
        <motion.span
          key={ filteredNotes.length }
          className="notes-count"
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
            damping: 20,
          }}
        >
          { filteredNotes.length }
        </motion.span>
        <motion.div
          className="color-filters"
          initial={{
            opacity: 0,
            translateY: 40,
          }}
          animate={{
            opacity: 1,
            translateY: 0,
          }}
          transition={{
            duration: 0.8,
            type: "spring",
            stiffness: 160,
            delay: .7,
          }}
        >
          {
            Object.keys(NOTE_COLORS).map((name) => (
              <motion.button
                key={ name }
                type="button"
                aria-label={ sortColor === name ? "Show every color" : `Show only ${ name } notes` }
                className={ `color-filter ${ name }-bg ${ sortColor === name ? "active" : "" }` }
                whileHover={{ scale: 1.3 }}
                whileTap={{ scale: .85 }}
                transition={{ type: "spring", stiffness: 420, damping: 16 }}
                onClick={ () => setSortColor(sortColor === name ? null : name) }
              />
            ))
          }
        </motion.div>
      </div>
      <div
        ref={ ref }
        className="notes"
      >
        {
          renderFirstRow && (
            filteredNotes?.length > 0 ? (
              <AnimatePresence>
                {
                  filteredNotes.map((item, index) => (
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
