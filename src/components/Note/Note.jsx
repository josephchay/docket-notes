import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useAnimationControls, useMotionValue, useSpring, useTransform } from "framer-motion";
import anime from "animejs";
import gsap from "gsap";
import { interpret } from "xstate";

import { FaPen, FaStar, FaPalette, FaDownload, FaCopy, FaExpand, FaUpDownLeftRight, FaCheck } from "react-icons/fa6";
import { FaEye, FaTrash } from "react-icons/fa";

import useLongPress from "../../hooks/useLongPress";
import { playDelete, playStar } from "../../utils/sound";
import PullString from "./PullString";
import MoveString from "./MoveString";
import SparkBurst from "../Spark/SparkBurst";
import { HOLD_FILL_MS, noteDeleteMachine } from "./NoteDeleteState";
import { SNAPPY, EXIT_SPRING, coinFlip } from "../Motion";

import "./Note.css";

const debounceTimer = 500;

const NOTE_WIDTH = 340;   // matches the .note CSS width and the rope svg viewBox

const RING_RADIUS = 68;   // matches the delete-ring svg below

const RADIAL_RADIUS = 64;   // how far the radial menu's items spread from the click point
const RADIAL_MARGIN = 110;  // keeps the fully-spread menu clear of the viewport edge

const Note = ({
  delay,
  note,
  searchQuery,
  scrollVelocity,
  spawnOrigin,
  clearSpawn,
  selectMode,
  selected,
  onToggleSelect,
  deleteNote,
  updateTitle,
  updateText,
  updateFavorite,
  updateColor,
  updateLock,
  reorderNotes,
  duplicateNote,
  openEditor,
  onHoverStart,
  onHoverEnd,
  reduceMotion,
}) => {
  // Hold-to-delete (see NoteDeleteState.js for the full reasoning) — a real
  // xstate machine now owns the holding → confirmed → completing sequence;
  // isDeleting/deleteConfirmed/deleteCompleted stay as plain derived
  // booleans below so every existing consumer of those three names (there
  // are over a dozen, all through the JSX further down) needed no changes
  // at all, only the state that feeds them did.
  const [deleteService] = useState(() => interpret(noteDeleteMachine));
  const [deletePhase, setDeletePhase] = useState("idle");
  // Always the LATEST deleteNote, read from inside the transition handler
  // below without putting it in that effect's own deps — the same reason
  // NoteConstellation.jsx's own onSelectRef exists: re-running that effect
  // on every deleteNote identity change would mean calling
  // service.stop()/onTransition().start() again, which resets the machine
  // to "idle" — a genuine bug if that identity ever changed mid-hold.
  const deleteNoteRef = useRef(deleteNote);
  deleteNoteRef.current = deleteNote;

  useEffect(() => {
    deleteService.onTransition((state) => {
      setDeletePhase(String(state.value));
      if (!state.changed) return;
      if (state.value === "confirmed") playDelete();
      else if (state.value === "completing") deleteNoteRef.current(note.id);
    }).start();
    return () => deleteService.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteService]);

  const isDeleting = deletePhase !== "idle";
  const deleteConfirmed = deletePhase === "confirmed";
  const deleteCompleted = deletePhase === "completing";

  // The fields are controlled through these drafts so edits made in the
  // focus editor land on the card too; commits back to the list are
  // debounced per note.
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftText, setDraftText] = useState(note.text);
  const [isTyping, setIsTyping] = useState(false);

  // Title/text render as live, directly-editable inputs rather than static
  // text (see below), so there's no safe place to drop an in-line <mark>
  // the way CommandPalette highlights a matched command — a search hit
  // here gets a soft ink ring around the whole card instead (.search-match
  // in Note.css), the same family as the .editing/.selected rings just
  // below it, so a note that survived the current search still reads as
  // itself rather than needing its own separate treatment. Mirrors
  // Home.jsx's own filter predicate exactly, so "why is this card here"
  // always matches "why did the grid keep it."
  const trimmedQuery = searchQuery?.trim().toLowerCase();
  const isSearchMatch = !!trimmedQuery &&
    `${ note.title ?? "" } ${ note.text }`.toLowerCase().includes(trimmedQuery);

  // A wordier note carries real weight in its own spring physics — `mass`
  // is a genuine parameter of framer's actual damped-harmonic-oscillator
  // spring solver (m·x″ + d·x′ + k·x = 0, the same equation a real mass on
  // a real spring obeys), not something hand-derived here, so handing it a
  // bigger value naturally makes a longer note's own spawn arrival and grid
  // reflow read as heavier — slower to get moving, a touch more overshoot
  // settling — while a short note stays at the default snap. Read off the
  // committed note, not the live draft, so it can't flicker mid-keystroke;
  // capped well short of anything that would feel sluggish rather than
  // just weightier.
  const noteMass = 1 + Math.min(1.4, ((note.title?.length ?? 0) + note.text.length) / 900);

  // The whole grid already skews as one rigid sheet off Lenis's own scroll
  // velocity (see .notes' own skewY in NoteList.css, driven by the
  // --scroll-tilt custom property useLenisScroll.jsx writes) — every card
  // moving in perfect lockstep. This is the same live velocity signal (see
  // useLenisScroll's own scrollVelocity motion value), but sprung through
  // this card's own noteMass above rather than applied flat: a heavier
  // note genuinely resists sudden rotational acceleration more than a
  // light one for the same "torque," so a wordier card now visibly lags a
  // beat behind a short one as the desk is flung past it, instead of every
  // card reading as one undifferentiated slab. Lands on skewX specifically
  // — the outer card's own `rotate` already belongs to the move-string
  // lean (noteTilt below), and this needs a channel that's entirely its
  // own rather than fighting that for the same CSS property.
  const scrollLag = useSpring(scrollVelocity, { stiffness: 140, damping: 18, mass: noteMass });
  const scrollSkew = useTransform(scrollLag, (v) => Math.max(-3.5, Math.min(3.5, v * 0.45)));

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
    deleteService.send({ type: "HOLD" });
  }

  const handlePressRelease = () => {
    deleteService.send({ type: "RELEASE" });
  }

  const longPressEvent = useLongPress(handlePressHold, () => {}, handlePressRelease, {
    shouldPreventDefault: true,
    delay: 800,
  });

  // In select mode, tapping the paper toggles this note's checkmark — but
  // only when the tap actually lands on the paper itself. Most existing
  // controls (the pull-string tassels, the badge below) are real buttons,
  // excluded by the first two selectors; the star and lock/edit controls
  // are plain divs (see .star/.edit below), not buttons, so they need
  // naming explicitly — without them, starring or locking a note while in
  // select mode also toggled that note's selection, since the click still
  // bubbled up here unshielded.
  const handleCardClick = (e) => {
    if (!selectMode) return;
    if (e.target instanceof Element && e.target.closest("button, input, textarea, .star, .edit")) return;

    onToggleSelect?.(note.id);
  }

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
      playStar();
      setTimeout(() => setStarBurst(false), 700);
    }
    updateFavorite(note.id);
  }

  // The paper tilts under the pointer like it is resting on a soft desk,
  // springing flat again when the pointer leaves — continuous,
  // pointer-tracking motion firing on every hover of every note, so it's
  // gated under reduced motion the same way the app's other pointer-follow
  // effects (the toolbar's magnetic icons, the nav rail's ink pots) are.
  const tiltSourceX = useMotionValue(0);
  const tiltSourceY = useMotionValue(0);
  const tiltX = useSpring(useTransform(tiltSourceY, [-0.5, 0.5], [6, -6]), { stiffness: 300, damping: 22 });
  const tiltY = useSpring(useTransform(tiltSourceX, [-0.5, 0.5], [-6, 6]), { stiffness: 300, damping: 22 });

  const handleTiltMove = (e) => {
    if (isDeleting || reduceMotion) return;

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

  // Right-click blooms a gooey cluster of quick actions out from the click
  // point — the same melt-together filter the nav rail's ink pots use,
  // applied here so the buttons visually separate out of one blob instead
  // of just fading in as a list. Portaled to the document body since the
  // note's own tree sits under a transform (the tilt, the lean, the desk's
  // recede-on-editor scale) — any of those would otherwise become the
  // containing block for a fixed-position menu and throw its position off.
  const [radialAt, setRadialAt] = useState(null);

  const openRadialMenu = (e) => {
    e.preventDefault();

    setRadialAt({
      x: Math.min(Math.max(e.clientX, RADIAL_MARGIN), window.innerWidth - RADIAL_MARGIN),
      y: Math.min(Math.max(e.clientY, RADIAL_MARGIN), window.innerHeight - RADIAL_MARGIN),
    });
  }

  const closeRadialMenu = () => setRadialAt(null);

  useEffect(() => {
    if (!radialAt) return;

    const handleKey = (e) => {
      if (e.key === "Escape") closeRadialMenu();
    };
    const handleOutside = () => closeRadialMenu();

    window.addEventListener("keydown", handleKey);
    // A capture-phase pointerdown, delayed to the next tick, so the very
    // pointerdown that opened the menu (a right-click) doesn't also count
    // as the outside click that closes it again.
    const timer = setTimeout(() => document.addEventListener("pointerdown", handleOutside), 0);

    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handleOutside);
    };
  }, [radialAt]);

  const radialActions = [
    { key: "star", icon: <FaStar />, label: note.favorite ? "Unstar" : "Star", onRun: handleFavorite },
    { key: "recolor", icon: <FaPalette />, label: "Recolor", onRun: () => updateColor(note.id) },
    { key: "duplicate", icon: <FaCopy />, label: "Duplicate", onRun: () => duplicateNote(note.id) },
    {
      key: "lock",
      icon: note.lock ? <FaPen /> : <FaEye size={ 12 } />,
      label: note.lock ? "Unlock" : "Lock",
      onRun: handleEditable,
    },
    { key: "delete", icon: <FaTrash />, label: "Delete", onRun: () => deleteNote(note.id), danger: true },
  ];

  // A freshly poured note doesn't float in from nowhere — it morphs out of
  // the ink pot that made it: a dot-sized circle at the pot's position that
  // springs across the desk, swelling and squaring off into paper with a
  // starchy overshoot. A duplicate has no ink pot to spring from though —
  // its "origin" is the source note, already the same size and shape as
  // the copy — so it skips the dot/squeeze entirely and just slides in
  // from beside the original, full-size the whole way. Only the mount that
  // created the note plays either version.
  const [spawning, setSpawning] = useState(() => !!spawnOrigin);
  const spawnControls = useAnimationControls();
  const cardRef = useRef(null);
  // The duplicate's own ink-soak overlay (see the .note-soak-overlay JSX
  // below) — only ever relevant while spawning === true AND this spawn is
  // a duplicate, so it's fine as a plain ref rather than React state: the
  // GSAP tween that drives it never needs to trigger a re-render of
  // anything, only its own clip-path attribute.
  const soakRef = useRef(null);
  const isSoaking = spawning && !!spawnOrigin?.duplicate;

  useLayoutEffect(() => {
    if (!spawning || !cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const dx = spawnOrigin.x - (rect.left + rect.width / 2);
    const dy = spawnOrigin.y - (rect.top + rect.height / 2);

    const morph = async () => {
      if (spawnOrigin.duplicate) {
        // Already this note's own size and shape — just parked at the
        // source's position — so there's nothing to shrink or square off,
        // only a slide from there into its actual slot.
        spawnControls.set({
          x: dx,
          y: dy,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          borderRadius: "24px",
          opacity: 1,
        });

        // The copy's own color soaks in from its own center rather than
        // arriving already fully painted — GSAP driving a growing
        // clip-path circle on a colored overlay (see .note-soak-overlay;
        // the card underneath renders with NO color class for as long as
        // spawnOrigin.duplicate is true — see the className below — so
        // this overlay is genuinely the only source of color until it
        // finishes, not a redundant coat of paint over one already
        // there). Started, not awaited: it plays alongside the slide
        // below rather than gating it, so the copy arrives in its slot
        // already mid-soak rather than waiting on this first.
        if (reduceMotion) {
          if (soakRef.current) gsap.set(soakRef.current, { clipPath: "circle(150% at 50% 50%)" });
        } else if (soakRef.current) {
          gsap.set(soakRef.current, { clipPath: "circle(0% at 50% 50%)" });
          gsap.to(soakRef.current, { clipPath: "circle(150% at 50% 50%)", duration: .55, ease: "power2.out" });
        }

        await spawnControls.start({
          x: 0,
          y: 0,
          transition: {
            type: "spring",
            stiffness: 170,
            damping: 15,
            mass: noteMass,
          },
        });
      } else {
        // Full roundness in px (not "50%") so the corner morph can actually
        // tween as it squares off — mixed units would snap instead of
        // morphing.
        const round = Math.min(rect.width, rect.height) / 2;

        // A dot of ink, sitting right in the pot that was tapped.
        spawnControls.set({
          x: dx,
          y: dy,
          scale: 32 / rect.width,
          scaleX: 1,
          scaleY: 1,
          borderRadius: `${ round }px`,
          opacity: 1,
        });

        // 1 — The squeeze: a beat of anticipation as the drop pulls free of
        //     the pot, stretching thin before it lets go — still a perfect
        //     circle, just an elongated one.
        await spawnControls.start({
          scaleY: 1.5,
          scaleX: .78,
          transition: { duration: .16, ease: "easeOut" },
        });

        // 2 — The bloom: travels to its slot, grows, un-stretches, and
        //     squares off from circle to paper — all in one loose, starchy
        //     spring, so it reads as one continuous fluid motion rather
        //     than separate steps.
        await spawnControls.start({
          x: 0,
          y: 0,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          borderRadius: "24px",
          transition: {
            type: "spring",
            stiffness: 170,
            damping: 15,
            mass: noteMass,
          },
        });
      }

      // Landing jelly: one last squash-and-stretch as the paper's own
      // weight settles, the same wobble the focus editor plays.
      await spawnControls.start({
        scaleX: [1, 1.06, .97, 1.01, 1],
        scaleY: [1, .94, 1.05, .99, 1],
        transition: { duration: .5, times: [0, .3, .55, .8, 1], ease: "easeInOut" },
      });

      setSpawning(false);
      clearSpawn?.();
    };

    morph();
    // Runs once, for the mount that poured (or copied) the note.
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
        skewX: scrollSkew,
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
        // Every reflow (a sort, a filter, another note arriving or leaving)
        // now carries the same real mass the spawn morph above does — a
        // wordier note settling into its new grid slot a touch slower and
        // with a bit more overshoot than a short one, rather than every
        // card reflowing in perfect lockstep regardless of how much ink
        // it's actually carrying.
        layout: {
          type: "spring",
          stiffness: 420,
          damping: 34,
          mass: noteMass,
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
          // deleteCompleted plays its own dedicated delete-blob animation
          // elsewhere; this exit is only for every *other* way a card
          // leaves the grid (filtered out, sorted away). It used to be a
          // flat linear fade-slide under a spawn entrance that's a whole
          // squeeze-and-bloom sequence — now it echoes that landing jelly's
          // own squash-and-stretch with a quick bump before it lifts away.
          deleteCompleted ? {} : {
            opacity: 0,
            scaleX: [1, 1.05, .92],
            scaleY: [1, .92, .9],
            translateY: -70,
            transition: {
              duration: .28,
              times: [0, .3, 1],
              ease: "easeInOut",
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
          scale: SNAPPY,
        }}
        style={{
          borderRadius: isDeleting ? "50%" : "24px",
          rotateX: tiltX,
          rotateY: tiltY,
          transformPerspective: 900,
        }}
        onPointerMove={ handleTiltMove }
        onPointerLeave={ handleTiltLeave }
        onMouseEnter={ () => onHoverStart?.(note.id) }
        onMouseLeave={ () => onHoverEnd?.(note.id) }
        onClick={ handleCardClick }
        onContextMenu={ openRadialMenu }
        // The color class itself withholds while a duplicate is still
        // soaking (see isSoaking/.note-soak-overlay below) — the overlay
        // is genuinely the only source of color for that whole span, not
        // a redundant coat over one already there.
        className={ `note ${ isSoaking ? "soaking" : `${ note.color }-bg` } ${ isPulling ? "dragging" : "" } ${ isTyping ? "editing" : "" } ${ selectMode && selected ? "selected" : "" } ${ isSearchMatch ? "search-match" : "" }` }
      >
        {/* The duplicate's own ink-soak (see the useLayoutEffect above) —
            a plain div GSAP drives directly by ref, sized and rounded to
            match the card exactly, carrying the note's true color while
            the card itself carries none. */}
        {
          isSoaking && (
            <div ref={ soakRef } className={ `note-soak-overlay ${ note.color }-bg` } aria-hidden="true" />
          )
        }
        {/* The checkmark badge only exists in select mode, and blooms in
            with a bouncy overshoot rather than just appearing. Its own
            pointerdown is shielded from the card's long-press handlers,
            the same way the pull-string tassels shield theirs, so tapping
            it doesn't also fire the card's own tap-to-toggle underneath. */}
        <AnimatePresence>
          {
            selectMode && (
              <motion.button
                type="button"
                aria-label={ selected ? "Deselect this note" : "Select this note" }
                aria-pressed={ !!selected }
                className={ `select-badge ${ selected ? "checked" : "" }` }
                initial={{ opacity: 0, scale: 0, rotate: -20 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0, rotate: 20, transition: { duration: .15, ease: "easeIn" } }}
                whileHover={{ scale: 1.14 }}
                whileTap={{ scale: .88 }}
                transition={{ type: "spring", stiffness: 420, damping: 16 }}
                onMouseDown={ (e) => e.stopPropagation() }
                onTouchStart={ (e) => e.stopPropagation() }
                onClick={ () => onToggleSelect?.(note.id) }
              >
                <AnimatePresence mode="wait" initial={ false }>
                  {
                    selected && (
                      <motion.span
                        key="check"
                        initial={{ scale: 0, rotate: -45 }}
                        animate={{ scale: 1, rotate: 0 }}
                        exit={{ scale: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 18 }}
                      >
                        <FaCheck className="select-badge-icon" />
                      </motion.span>
                    )
                  }
                </AnimatePresence>
              </motion.button>
            )
          }
        </AnimatePresence>
        {/* A soft breathing halo in the note's own ink while it has the
            caret — the same live-editing moment the static ring already
            marks, just given a pulse instead of a flat line. The pulse
            itself is a repeat: Infinity loop that can run for as long as
            someone is actually writing — under reduced motion it holds a
            single steady glow instead, marking the same live-editing
            moment without the sustained animation. */}
        <AnimatePresence>
          {
            isTyping && (
              reduceMotion ? (
                <motion.span
                  className={ `note-focus-halo ${ note.color }-bg` }
                  initial={{ opacity: 0, scale: .94 }}
                  animate={{ opacity: .4, scale: 1 }}
                  exit={{ opacity: 0, scale: .94, transition: { duration: .3, ease: "easeIn" } }}
                  transition={{ duration: .3 }}
                />
              ) : (
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
            <SparkBurst
              active={ starBurst }
              count={ 6 }
              radius={ (i) => 30 + (i % 2) * 10 }
              className="star-burst"
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
                { ...coinFlip({ type: "spring", stiffness: 420, damping: 17 }) }
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
                reduceMotion={ reduceMotion }
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
            reduceMotion={ reduceMotion }
          />
        </motion.div>
      </motion.div>
      {
        createPortal(
          <AnimatePresence>
            {
              radialAt && (
                <div className="note-radial-layer">
                  <div className="note-radial-menu" style={{ left: radialAt.x, top: radialAt.y }}>
                    {
                      radialActions.map((action, index) => {
                        const angle = (index / radialActions.length) * Math.PI * 2 - Math.PI / 2;
                        const ox = Math.cos(angle) * RADIAL_RADIUS;
                        const oy = Math.sin(angle) * RADIAL_RADIUS;

                        return (
                          <motion.button
                            key={ action.key }
                            type="button"
                            aria-label={ action.label }
                            title={ action.label }
                            className={ `note-radial-item ${ note.color }-bg ${ action.danger ? "danger" : "" }` }
                            initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
                            animate={{ x: ox, y: oy, scale: 1, opacity: 1 }}
                            exit={{
                              x: 0,
                              y: 0,
                              scale: 0,
                              opacity: 0,
                              transition: {
                                ...EXIT_SPRING,
                                delay: (radialActions.length - index) * .015,
                              },
                            }}
                            transition={{
                              type: "spring",
                              stiffness: 260,
                              damping: 15,
                              delay: index * .035,
                            }}
                            onClick={ () => {
                              action.onRun();
                              closeRadialMenu();
                            } }
                          >
                            { action.icon }
                          </motion.button>
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
    </motion.div>
  );
}

export default Note;
