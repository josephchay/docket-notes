import React, { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";

import { FaPen, FaStar, FaPalette, FaDownload, FaCopy, FaExpand, FaUpDownLeftRight } from "react-icons/fa6";
import { FaEye, FaTrash } from "react-icons/fa";

import useLongPress from "../../hooks/useLongPress";
import PullString from "./PullString";
import MoveString from "./MoveString";

import "./Note.css";

const debounceTimer = 500;

const NOTE_WIDTH = 340;   // matches the .note CSS width and the rope svg viewBox

const Note = ({
  delay,
  note,
  deleteNote,
  updateTitle,
  updateText,
  updateFavorite,
  updateColor,
  updateLock,
  reorderNotes,
  duplicateNote,
  openEditor,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteCompleted, setDeleteCompleted] = useState(false);

  const [deleteTimeout, setDeleteTimeout] = useState(null);

  // The fields are controlled through these drafts so edits made in the
  // focus editor land on the card too; commits back to the list are
  // debounced per note.
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftText, setDraftText] = useState(note.text);
  const [isTyping, setIsTyping] = useState(false);

  const titleRef = useRef(null);
  const textRef = useRef(null);
  const titleTimerRef = useRef(null);
  const textTimerRef = useRef(null);

  // Adopt outside changes unless the field is being typed in right now — a
  // self-made edit round-trips as the same value anyway.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setDraftTitle(note.title);
  }, [note.title]);

  useEffect(() => {
    if (document.activeElement !== textRef.current) setDraftText(note.text);
  }, [note.text]);

  useEffect(() => {
    const timers = [titleTimerRef, textTimerRef];
    return () => timers.forEach((timer) => clearTimeout(timer.current));
  }, []);

  const handleTitleUpdate = (title) => {
    setDraftTitle(title);
    clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => updateTitle(title, note.id), debounceTimer);
  }

  const handleTextUpdate = (text) => {
    setDraftText(text);
    clearTimeout(textTimerRef.current);
    textTimerRef.current = setTimeout(() => updateText(text, note.id), debounceTimer);
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
    const body = draftText?.trim() ? draftText : note.placeholder;
    const content = `${ draftTitle?.trim() || "Untitled note" }\n\n${ body }\n\n— ${ note.time }`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    const safeName = (draftTitle || "note").trim().replace(/[^\w-]+/g, "_").slice(0, 40) || "note";
    link.href = url;
    link.download = `${ safeName }.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // The "move" string stretches like the others; the note leans a little
  // toward the pull so it feels tugged along, easing off as the string is
  // stretched right across the grid. Pull the tassel onto any other note to
  // light it up as the swap target, and release to trade places with it.
  const movePullX = useMotionValue(0);
  const movePullY = useMotionValue(0);
  const [isPulling, setIsPulling] = useState(false);

  const noteLeanX = useTransform(movePullX, [-420, 0, 420], [-32, 0, 32], { clamp: true });
  const noteLeanY = useTransform(movePullY, [-420, 0, 420], [-32, 0, 32], { clamp: true });
  const noteTilt = useTransform(movePullX, [-420, 420], [-3, 3], { clamp: true });

  // The action strings, spread evenly across the note's width — add or remove
  // one here and the row re-spaces itself. The move string always sits last.
  const pullStrings = [
    // { key: "favorite", icon: <FaStar className="pull-grip-icon" />, verb: note.favorite ? "unpin" : "pin", onTrigger: handleFavorite },
    { key: "recolor", icon: <FaPalette className="pull-grip-icon" />, verb: "recolor", onTrigger: () => updateColor(note.id) },
    { key: "duplicate", icon: <FaCopy className="pull-grip-icon" />, verb: "duplicate", onTrigger: () => duplicateNote(note.id) },
    { key: "download", icon: <FaDownload className="pull-grip-icon" />, verb: "download", onTrigger: handleDownload },
    { key: "open", icon: <FaExpand className="pull-grip-icon" />, verb: "open", onTrigger: () => openEditor(note.id) },
  ];

  const anchorFor = (index) => Math.round((NOTE_WIDTH / (pullStrings.length + 2)) * (index + 1));

  return (
    <motion.div
      key={ note.id }
      data-note-id={ note.id }
      layout
      style={{
        x: noteLeanX,
        y: noteLeanY,
        rotate: noteTilt,
        zIndex: isPulling ? 40 : 1,
        position: "relative",
      }}
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
        layout: {
          type: "spring",
          stiffness: 420,
          damping: 34,
        },
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
        className={ `note ${ note.color }-bg ${ isPulling ? "dragging" : "" } ${ isTyping ? "editing" : "" }` }
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
          ref={ titleRef }
          readOnly={ note.lock }
          placeholder="Title"
          value={ draftTitle }
          onChange={ (e) => handleTitleUpdate(e.target.value) }
          onFocus={ () => setIsTyping(true) }
          onBlur={ () => setIsTyping(false) }
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
          ref={ textRef }
          readOnly={ note.lock }
          placeholder={ note.placeholder }
          value={ draftText }
          onChange={ (e) => handleTextUpdate(e.target.value) }
          onFocus={ () => setIsTyping(true) }
          onBlur={ () => setIsTyping(false) }
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
          {
            pullStrings.map((string, index) => (
              <PullString
                key={ string.key }
                anchorX={ anchorFor(index) }
                colorName={ note.color }
                icon={ string.icon }
                verb={ string.verb }
                onTrigger={ string.onTrigger }
              />
            ))
          }
          <MoveString
            anchorX={ anchorFor(pullStrings.length) }
            colorName={ note.color }
            icon={ <FaUpDownLeftRight className="pull-grip-icon" /> }
            noteId={ note.id }
            pullX={ movePullX }
            pullY={ movePullY }
            onPullStart={ () => setIsPulling(true) }
            onPullEnd={ () => setIsPulling(false) }
            onMove={ (targetId) => reorderNotes(note.id, targetId) }
          />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export default Note;
