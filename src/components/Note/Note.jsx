import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls, useMotionValue, useSpring, useTransform } from "framer-motion";
import anime from "animejs";

import { FaPen, FaStar, FaPalette, FaDownload, FaCopy, FaExpand, FaUpDownLeftRight } from "react-icons/fa6";
import { FaEye, FaTrash } from "react-icons/fa";

import useLongPress from "../../hooks/useLongPress";
import PullString from "./PullString";
import MoveString from "./MoveString";

import "./Note.css";

const debounceTimer = 500;

const NOTE_WIDTH = 340;   // matches the .note CSS width and the rope svg viewBox

const RING_RADIUS = 68;   // matches the delete-ring svg below

const Note = ({
  delay,
  note,
  spawnOrigin,
  clearSpawn,
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

  const HOLD_FILL_MS = 1000;   // how long the delete ring takes to fill once the hold registers

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
    }, HOLD_FILL_MS);

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

  // The moment the hold-ring finishes filling, it doesn't just vanish — it
  // splats into an irregular blot of ink that wobbles through a couple of
  // organic shapes before soaking away, right as the note itself starts
  // shrinking out of existence.
  const blobRef = useRef(null);

  useEffect(() => {
    if (!deleteConfirmed || !blobRef.current) return;

    const el = blobRef.current;
    anime.remove(el);
    anime.set(el, { opacity: 1, scale: 0 });
    anime({
      targets: el,
      scale: [0, 1.28, 1.05],
      borderRadius: [
        "50% 50% 50% 50% / 50% 50% 50% 50%",
        "63% 37% 54% 46% / 44% 56% 41% 59%",
        "40% 60% 46% 54% / 58% 42% 55% 45%",
      ],
      opacity: [1, 1, 0],
      duration: 600,
      easing: "easeOutElastic(1, .6)",
    });
  }, [deleteConfirmed]);

  // Starring a note throws a little handful of sparks off the star.
  const [starBurst, setStarBurst] = useState(false);

  const handleFavorite = () => {
    if (!note.favorite) {
      setStarBurst(true);
      setTimeout(() => setStarBurst(false), 700);
    }
    updateFavorite(note.id);
  }

  // The paper tilts under the pointer like it is resting on a soft desk,
  // springing flat again when the pointer leaves.
  const tiltSourceX = useMotionValue(0);
  const tiltSourceY = useMotionValue(0);
  const tiltX = useSpring(useTransform(tiltSourceY, [-0.5, 0.5], [6, -6]), { stiffness: 300, damping: 22 });
  const tiltY = useSpring(useTransform(tiltSourceX, [-0.5, 0.5], [-6, 6]), { stiffness: 300, damping: 22 });

  const handleTiltMove = (e) => {
    if (isDeleting) return;

    const rect = e.currentTarget.getBoundingClientRect();
    tiltSourceX.set((e.clientX - rect.left) / rect.width - 0.5);
    tiltSourceY.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  const handleTiltLeave = () => {
    tiltSourceX.set(0);
    tiltSourceY.set(0);
  }

  const handleEditable = () => {
    updateLock(note.id);
  }

  // A freshly poured note doesn't float in from nowhere — it morphs out of
  // the ink pot that made it: a dot-sized circle at the pot's position that
  // springs across the desk, swelling and squaring off into paper with a
  // starchy overshoot. Only the mount that created the note plays this.
  const [spawning, setSpawning] = useState(() => !!spawnOrigin);
  const spawnControls = useAnimationControls();
  const cardRef = useRef(null);

  useLayoutEffect(() => {
    if (!spawning || !cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();

    // Start as the 32px pot itself, centered where it was tapped.
    spawnControls.set({
      x: spawnOrigin.x - (rect.left + rect.width / 2),
      y: spawnOrigin.y - (rect.top + rect.height / 2),
      scale: 32 / rect.width,
      borderRadius: "50%",
      opacity: 1,
    });

    spawnControls.start({
      x: 0,
      y: 0,
      scale: 1,
      borderRadius: "24px",
      opacity: 1,
      transition: {
        type: "spring",
        stiffness: 230,
        damping: 18,
        mass: .9,
      },
    }).then(() => {
      setSpawning(false);
      clearSpawn?.();
    });
    // Runs once, for the mount that poured the note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        zIndex: isPulling ? 40 : spawning ? 30 : 1,
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
        ref={ cardRef }
        {
          ...(spawning ? {
            // The morph drives this mount from the ink pot; see the spawn
            // layout effect above.
            initial: false,
            animate: spawnControls,
          } : {
            initial: {
              opacity: 0,
              translateY: 80,
              scale: 1.04,
            },
            whileInView: {
              opacity: 1,
              translateY: 0,
              scale: 1,
            },
            viewport: {
              once: true,
            },
          })
        }
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
        whileHover={ spawning ? undefined : { scale: 1.06 } }
        whileTap={ spawning ? undefined : { scale: 0.96 } }
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
          rotateX: tiltX,
          rotateY: tiltY,
          transformPerspective: 900,
        }}
        onPointerMove={ handleTiltMove }
        onPointerLeave={ handleTiltLeave }
        className={ `note ${ note.color }-bg ${ isPulling ? "dragging" : "" } ${ isTyping ? "editing" : "" }` }
      >
        {/* A soft breathing halo in the note's own ink while it has the
            caret — the same live-editing moment the static ring already
            marks, just given a pulse instead of a flat line. */}
        <AnimatePresence>
          {
            isTyping && (
              <motion.span
                className={ `note-focus-halo ${ note.color }-bg` }
                initial={{ opacity: 0, scale: .94 }}
                animate={{ opacity: [0, .55, .3, .55], scale: [.94, 1.015, 1, 1.015] }}
                exit={{ opacity: 0, scale: .94, transition: { duration: .3, ease: "easeIn" } }}
                transition={{
                  opacity: { duration: 2.6, repeat: Infinity, ease: "easeInOut", times: [0, .3, .6, 1] },
                  scale: { duration: 2.6, repeat: Infinity, ease: "easeInOut", times: [0, .3, .6, 1] },
                }}
              />
            )
          }
        </AnimatePresence>
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
                        const distance = 30 + (i % 2) * 10;

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
          {/* Fills over exactly the hold's inner window (HOLD_FILL_MS) so it
              reads as a real countdown, not just a decoration; releasing
              early recoils it away with an elastic snap instead of a plain
              cut. */}
          <AnimatePresence>
            {
              isDeleting && !deleteConfirmed && (
                <motion.svg
                  className="delete-ring"
                  viewBox="0 0 160 160"
                  initial={{ opacity: 0, scale: .55, rotate: -90 }}
                  animate={{ opacity: 1, scale: 1, rotate: -90 }}
                  exit={{
                    opacity: 0,
                    scale: .4,
                    transition: { type: "spring", stiffness: 480, damping: 15 },
                  }}
                  transition={{ type: "spring", stiffness: 260, damping: 16 }}
                >
                  <circle
                    className="delete-ring-track"
                    cx="80"
                    cy="80"
                    r={ RING_RADIUS }
                  />
                  <motion.circle
                    className="delete-ring-fill"
                    style={{ stroke: `var(--${ note.color }-color)` }}
                    cx="80"
                    cy="80"
                    r={ RING_RADIUS }
                    strokeDasharray="1 1"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: HOLD_FILL_MS / 1000, ease: "linear" }}
                  />
                </motion.svg>
              )
            }
          </AnimatePresence>
          <span
            ref={ blobRef }
            className="delete-blob"
            style={{ opacity: 0, backgroundColor: "var(--black-color)" }}
          />
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
            style={{ transformPerspective: 300 }}
            className="edit"
          >
            {/* The lock flips like a coin between pen and eye instead of
                just cutting from one to the other. */}
            <AnimatePresence mode="wait" initial={ false }>
              <motion.span
                key={ note.lock ? "pen" : "eye" }
                className="edit-icon-wrap"
                initial={{ rotateY: -130, scale: .3, opacity: 0 }}
                animate={{ rotateY: 0, scale: 1, opacity: 1 }}
                exit={{
                  rotateY: 130,
                  scale: .3,
                  opacity: 0,
                  transition: { duration: .16, ease: "easeIn" },
                }}
                transition={{ type: "spring", stiffness: 420, damping: 17 }}
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
              </motion.span>
            </AnimatePresence>
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
