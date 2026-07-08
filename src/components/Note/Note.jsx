import React, { useState } from "react";
import { motion, useDragControls } from "framer-motion";

import { FaPen, FaStar, FaPalette, FaDownload, FaUpDownLeftRight } from "react-icons/fa6";
import { FaEye, FaTrash } from "react-icons/fa";

import useLongPress from "../../hooks/useLongPress";
import PullString from "./PullString";

import "./Note.css";

let debounceTimer = 500, debounceTextTimeout, debounceTitleTimeout;

const Note = ({
  delay,
  note,
  deleteNote,
  updateTitle,
  updateText,
  updateFavorite,
  updateColor,
  updateLock,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteCompleted, setDeleteCompleted] = useState(false);

  const [deleteTimeout, setDeleteTimeout] = useState(null);

  const handleTitleUpdate = (title, id) => {
    clearTimeout(debounceTitleTimeout);
    debounceTitleTimeout = setTimeout(() => updateTitle(title, id), debounceTimer);
  }

  const handleTextUpdate = (text, id) => {
    clearTimeout(debounceTextTimeout);
    debounceTextTimeout = setTimeout(() => updateText(text, id), debounceTimer);
  }

  const handlePressHold = () => {
    setIsDeleting(true);

    const timeoutId = setTimeout(() => {
      setDeleteConfirmed(true);

      setTimeout(() => {
        deleteNote(note.id);

        setDeleteCompleted(true);
        setDeleteConfirmed(false);

        setTimeout(() => {
          setDeleteCompleted(false);
        }, 600);
      }, 600);
    }, 1000);

    setDeleteTimeout(timeoutId);
  }

  const handlePressRelease = () => {
    setIsDeleting(false);

    clearTimeout(deleteTimeout);
  }

  const longPressEvent = useLongPress(handlePressHold, () => {}, handlePressRelease, {
    shouldPreventDefault: true,
    delay: 800,
  });

  const handleFavorite = () => {
    updateFavorite(note.id);
  }

  const handleEditable = () => {
    updateLock(note.id);
  }

  // Save the note to a plain text file the visitor can keep.
  const handleDownload = () => {
    const body = note.text?.trim() ? note.text : note.placeholder;
    const content = `${ note.title?.trim() || "Untitled note" }\n\n${ body }\n\n— ${ note.time }`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    const safeName = (note.title || "note").trim().replace(/[^\w-]+/g, "_").slice(0, 40) || "note";
    link.href = url;
    link.download = `${ safeName }.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // The "move" string drags the whole note freely to wherever it is dropped.
  const moveControls = useDragControls();

  return (
    <motion.div
      key={ note.id }
      layout
      drag
      dragListener={ false }
      dragControls={ moveControls }
      dragMomentum={ false }
      animate={
        deleteConfirmed ? {
          scale: .2,
        } : isDeleting ? {
          scale: .26,
        } : {
          scale: 1,
        }
      }
      exit={
        deleteCompleted ? {
          scale: 0,
          transition: {
            duration: .8,
            type: "spring",
            stiffness: 100,
          }
        } : {}
      }
      transition={{
        duration: .8,
        type: "spring",
        stiffness: 200,
        damping: 20,
      }}
      { ...longPressEvent }
    >
      <motion.div
        initial={{
          opacity: 0,
          translateY: 80,
          scale: 1.04,
        }}
        whileInView={{
          opacity: 1,
          translateY: 0,
          scale: 1,
        }}
        viewport={{
          once: true,
        }}
        exit={
          deleteCompleted ? {} : {
            opacity: 0,
            translateY: -80,
            scale: 1.04,
            transition: {
              duration: .2,
              ease: "easeIn",
              delay: delay,
            }
          }
        }
        whileHover={{
          scale: 1.06
        }}
        whileTap={{
          scale: 0.96
        }}
        transition={{
          duration: 0.6,
          type: "spring",
          stiffness: 220,
          delay: delay,
          scale: {
            type: "spring",
            stiffness: 400,
            damping: 17,
          },
        }}
        style={{
          borderRadius: isDeleting ? "50%" : "24px",
        }}
        className={ `note ${ note.color }-bg` }
      >
        <div className="header">
          <motion.div
            initial={{
              opacity: 0,
              scale: 1,
              translateX: 0,
              translateY: -80,
            }}
            animate={
              isDeleting ? {
                opacity: 0,
                scale: .8,
                translateX: -80,
                translateY: 80,
              } : {
                opacity: 1,
                scale: 1,
                translateX: 0,
                translateY: 0,
              }
            }
            whileHover={{
              scale: 1.2,
            }}
            onClick={ handleFavorite }
            transition={{
              type: "spring",
              stiffness: 240,
            }}
            style={{
              backgroundColor: note.favorite ? "var(--black-color)" : "var(--black-even-more-transclucent-color)",
            }}
            className="star"
          >
            <FaStar
              className={ `star-icon ${ note.color }` }
            />
          </motion.div>
        </div>
        <motion.input
          initial={{
            opacity: 0,
            scale: 1,
          }}
          animate={
            isDeleting ? {
              opacity: 0,
              scale: .4,
            } : {
              opacity: 1,
              scale: 1,
            }
          }
          readOnly={ note.lock }
          placeholder="Title"
          defaultValue={ note.title }
          onInput={ (e) => handleTitleUpdate(e.target.value, note.id) }
          style={{
            color: note.lock ? "var(--black-transclucent-color)" : "var(--black-color)",
          }}
          className={ `note-title ${ note.color }-highlight` }
        />
        <motion.textarea
          initial={{
            opacity: 0,
            scale: 1,
          }}
          animate={
            isDeleting ? {
              opacity: 0,
              scale: .4,
            } : {
              opacity: 1,
              scale: 1,
            }
          }
          readOnly={ note.lock }
          placeholder={ note.placeholder }
          defaultValue={ note.text }
          onInput={ (e) => handleTextUpdate(e.target.value, note.id) }
          style={{
            color: note.lock ? "var(--black-transclucent-color)" : "var(--black-color)",
          }}
          className={ `custom-scroll ${ note.color }-highlight` }
        ></motion.textarea>
        <div
          className="trash-container"
          style={{
            display: isDeleting ? "flex" : "none",
          }}
        >
          <motion.div
            initial={{
              opacity: 0,
              scale: 0,
            }}
            animate={
              deleteConfirmed ? {
                opacity: 1,
                scale: 1.34,
              } : isDeleting ? {
                opacity: 1,
                scale: 1,
              } : {
                opacity: 0,
                scale: 0,
              }
            }
            transition={{
              duration: 0.4,
              type: "spring",
              stiffness: 200,
              delay: .2,
            }}
            className={ `trash ${ note.color }` }
          >
            <FaTrash
              className="trash-icon"
            />
          </motion.div>
        </div>
        <div className="footer">
          <motion.div
            initial={{
              opacity: 0,
              scale: 1,
              translateX: 0,
              translateY: 0,
            }}
            animate={
              isDeleting ? {
                opacity: 0,
                scale: .8,
                translateX: 80,
                translateY: -80,
              } : {
                opacity: 1,
                scale: 1,
                translateX: 0,
                translateY: 0,
              }
            }
            className="date"
          >
            <span
              className={ `note-date ${ note.color }-highlight` }
            >
              { note.time }
            </span>
          </motion.div>
          <motion.div
            initial={{
              opacity: 0,
              scale: 1,
              translateX: 0,
              translateY: 0,
            }}
            animate={
              isDeleting ? {
                opacity: 0,
                scale: .8,
                translateX: -80,
                translateY: -80,
              } : {
                opacity: 1,
                scale: 1,
                translateX: 0,
                translateY: 0,
              }
            }
            whileHover={{
              scale: 1.2,
            }}
            transition={{
              type: "spring",
              stiffness: 240,
            }}
            onClick={ handleEditable }
            className="edit"
          >
            {
              note.lock ? (
                <FaPen
                  className="edit-icon"
                />
              ) : (
                <FaEye
                  size={ 14 }
                  className="edit-icon"
                />
              )
            }
          </motion.div>
        </div>
        <motion.div
          initial={{
            opacity: 0,
            scale: 1,
            translateY: 0,
          }}
          animate={
            isDeleting ? {
              opacity: 0,
              scale: .4,
              translateY: -140,
            } : {
              opacity: 1,
              scale: 1,
              translateY: 0,
            }
          }
          transition={{
            type: "spring",
            stiffness: 240,
          }}
          className="pull-zone"
        >
          <PullString
            anchorX={ 58 }
            colorName={ note.color }
            icon={ <FaStar className="pull-grip-icon" /> }
            verb={ note.favorite ? "unpin" : "pin" }
            onTrigger={ handleFavorite }
          />
          <PullString
            anchorX={ 132 }
            colorName={ note.color }
            icon={ <FaPalette className="pull-grip-icon" /> }
            verb="recolor"
            onTrigger={ () => updateColor(note.id) }
          />
          <PullString
            anchorX={ 208 }
            colorName={ note.color }
            icon={ <FaDownload className="pull-grip-icon" /> }
            verb="download"
            onTrigger={ handleDownload }
          />

          <div className={ `pull-string ${ note.color }` }>
            <svg
              className="pull-rope"
              viewBox="0 0 340 260"
              preserveAspectRatio="none"
            >
              <path
                d="M 282 0 Q 282 16 282 26"
                strokeWidth={ 6 }
                className="pull-rope-line"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            <motion.button
              type="button"
              aria-label="Drag to move note"
              className={ `pull-tab move ${ note.color }-bg` }
              style={{ left: 282, top: 26 }}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 1.2 }}
              onPointerDown={ (e) => moveControls.start(e) }
              onMouseDown={ (e) => e.stopPropagation() }
              onTouchStart={ (e) => e.stopPropagation() }
            >
              <span className="pull-grip">
                <FaUpDownLeftRight className="pull-grip-icon" />
              </span>
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export default Note;
