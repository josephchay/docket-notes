import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useAnimationControls, useMotionValue } from "framer-motion";
import gsap from "gsap";
import { FaStar, FaPen, FaXmark, FaCopy, FaShuffle, FaTag } from "react-icons/fa6";
import { FaEye } from "react-icons/fa";

import { NOTE_COLORS } from "../../constants/colors";
import useJellyTap from "../../hooks/useJellyTap";
import useInkPulse from "../../hooks/useInkPulse";
import useFocusTrap from "../../hooks/useFocusTrap";
import usePrefersReducedMotion from "../../hooks/usePrefersReducedMotion";
import HistoryAmbient from "../History/HistoryAmbient";
import { coinFlip } from "../Motion";

import "./NoteEditor.css";

const debounceTimer = 500;

// The palette dots and every action button (star, lock, copy, resize,
// close) shared this exact spring as a copy-pasted literal six times over
// in this one file — none of the app's cross-file Motion constants happen
// to match this file's own already-tuned 420/16 exactly, so it stays a
// local constant rather than being forced onto a slightly different
// shared one.
const actionSpring = { type: "spring", stiffness: 420, damping: 16 };

// The editor's papers: cozy for a quick line, roomy for writing, grand for
// spreading out, epic for filling the screen.
const EDITOR_SIZES = ["cozy", "roomy", "grand", "epic"];

const sizeFor = (name) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  switch (name) {
    case "cozy": return { width: Math.min(520, vw * .94), height: Math.min(470, vh * .86) };
    case "grand": return { width: Math.min(1080, vw * .94), height: Math.min(840, vh * .9) };
    case "epic": return { width: Math.min(1440, vw * 0.96), height: Math.min(1080, vh * 0.94) };
    default: return { width: Math.min(720, vw * .94), height: Math.min(600, vh * .86) };
  }
};

// The spring both the size button and the corner drag handle snap through
// — same numbers the old animate={sizeFor(size)} tween already used, kept
// identical on purpose so a button click still feels exactly as it always
// has; only the drag handle adds anything new (a live, un-sprung 1:1 track
// while the pointer is actually down, this spring taking back over only
// once it lifts — see the handle's own pointer handlers).
const RESIZE_SPRING = { type: "spring", stiffness: 260, damping: 14, mass: .9 };

// Which preset the drag handle should snap to on release — nearest by
// width alone (every preset's own aspect ratio is close enough that width
// and height never disagree about which one is closest in practice, and
// picking one axis rather than a 2D distance keeps this honest about what
// it's actually measuring).
const nearestSizeFor = (width) => {
  let best = EDITOR_SIZES[0];
  let bestDist = Infinity;
  for (const name of EDITOR_SIZES) {
    const dist = Math.abs(sizeFor(name).width - width);
    if (dist < bestDist) { bestDist = dist; best = name; }
  }
  return best;
};

// Paper tension — a faint physical "give" the whole sheet answers a
// keystroke or a scroll with, the same critically-underdamped spring
// shape NotePile's own squash-and-stretch uses (kicked in velocity, eased
// back toward 0 in position), just far gentler and reading as skew rather
// than scale: a sheet of real paper under a moving hand doesn't squash,
// it flexes. Run by hand in a plain rAF loop (see the effect below)
// rather than through Framer Motion — this needs to accept an arbitrary
// stream of small, unpredictably-timed impulses (a keystroke, a scroll
// tick) forever for as long as the editor stays open, which is exactly
// the shape a continuous physics integrator answers and a tween-based
// animation library doesn't.
const TENSION_STIFFNESS = 260;
const TENSION_DAMPING = 14;
const TENSION_KEY_KICK = 0.05; // deg/s of skew velocity per keystroke, sign randomized
const TENSION_SCROLL_KICK = 0.01; // deg/s of skew velocity per px of scroll delta
const TENSION_SCROLL_DELTA_CAP = 60; // px of one scroll event's delta this still responds to in full

// The paper unfurl — GSAP owns this one outright rather than Framer
// Motion (see the .note-editor-shell JSX below, which now only ever
// carries a plain opacity fade for AnimatePresence's own sake): a
// clip-path reveal from the top edge down, paired with a rotateX tilt
// that starts lifted — like the leading edge of a scroll still rolling —
// and settles flat exactly as the reveal finishes, plus a thin light
// "sheen" band that travels down the reveal edge the same way a real
// curling sheet catches the light differently right at its own fold.
// requestClose (see below) is what makes this a real close animation and
// not just an open one: it plays the reverse timeline FIRST and only
// calls the actual onClose prop (the one that flips React state and lets
// AnimatePresence unmount) once GSAP reports the timeline actually
// finished — so by the time React removes anything, the paper already
// visually rolled itself shut.
const UNFURL_OPEN_DURATION = .7;
const UNFURL_CLOSE_DURATION = .4;
const UNFURL_TILT = -20; // deg — how far the leading edge lifts at the rolled extreme
const UNFURL_SHEEN_PEAK = .4; // opacity the light band reaches mid-travel

// The focus editor. Pulling a note's "open" string stretches the card into
// this full writing surface — same paper, same color, far more room. Edits
// flow back into the card as you type (debounced, like the card's own
// fields), the palette repaints the note directly, and Escape, the backdrop,
// or the close button snap it shut again.
const NoteEditor = ({
  note,
  onClose,
  updateTitle,
  updateText,
  updateFavorite,
  updateLock,
  setNoteColor,
  updateQuote,
  updateTags,
}) => {
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftText, setDraftText] = useState(note.text);
  const [size, setSize] = useState("roomy");
  const [copied, setCopied] = useState(false);

  // The paper's own live width/height (see RESIZE_SPRING) — plain motion
  // values rather than the old animate={sizeFor(size)} tween, since the
  // drag handle below needs to write to these every pointermove with zero
  // spring lag (direct manipulation shouldn't lag behind a tween, the same
  // discipline NoteConstellation's own panning already keeps), while a
  // button click or a released drag still wants the exact same spring
  // motion always drove this with — see animateToSize.
  const widthMV = useMotionValue(sizeFor("roomy").width);
  const heightMV = useMotionValue(sizeFor("roomy").height);
  // True only for the live span of an actual corner drag — see the
  // wobble effect below, which reads this to skip the big jelly wobble on
  // every preset the pointer merely passes through mid-drag.
  const isDraggingResizeRef = useRef(false);
  const resizeDragRef = useRef(null);

  // Paper tension (see the TENSION_STIFFNESS constant block) — reduceMotion
  // gates both ends: kickTension below no-ops so typing/scrolling never
  // even tries to disturb it, and the rAF effect never starts in the first
  // place, so a reduced-motion visitor's paper is simply, permanently flat.
  const reduceMotion = usePrefersReducedMotion();
  const tensionRef = useRef(null);
  const tensionState = useRef({ x: 0, vx: 0, y: 0, vy: 0 });
  const lastScrollTopRef = useRef(0);

  const kickTension = (dvx, dvy) => {
    if (reduceMotion) return;
    tensionState.current.vx += dvx;
    tensionState.current.vy += dvy;
  };

  useEffect(() => {
    if (reduceMotion) return undefined;

    let raf;
    let lastT = performance.now();
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(.05, (now - lastT) / 1000);
      lastT = now;

      const s = tensionState.current;
      // A plain damped spring pulling skew back toward 0 — critically
      // underdamped (see NotePile's own squash for the identical shape),
      // so a kick overshoots past level by a hair before settling rather
      // than snapping straight back, which is what actually reads as give
      // rather than a rigid box merely nudging and stopping.
      s.vx += (-TENSION_STIFFNESS * s.x - TENSION_DAMPING * s.vx) * dt;
      s.x += s.vx * dt;
      s.vy += (-TENSION_STIFFNESS * s.y - TENSION_DAMPING * s.vy) * dt;
      s.y += s.vy * dt;

      if (tensionRef.current) {
        tensionRef.current.style.transform = `skewX(${ s.x.toFixed(3) }deg) skewY(${ s.y.toFixed(3) }deg)`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  // Tags pop in bouncy, shrink away when removed. Notes from before this
  // feature existed simply have none yet.
  const tags = note.tags || [];
  const [tagDraft, setTagDraft] = useState("");
  const tagInputRef = useRef(null);

  const addTag = () => {
    const clean = tagDraft.trim().toLowerCase().replace(/\s+/g, "-");
    setTagDraft("");
    if (!clean || tags.includes(clean)) return;

    updateTags([...tags, clean], note.id);
  };

  const handleTagKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagDraft && tags.length > 0) {
      updateTags(tags.slice(0, -1), note.id);
    }
  };

  const removeTag = (tag) => {
    updateTags(tags.filter((t) => t !== tag), note.id);
  };

  // The gluey wobble: whenever the paper opens or changes size it squashes
  // and stretches like jelly while the bouncy size spring overshoots.
  const jelly = useAnimationControls();

  // The header's action row was the editor's one flat corner — plain
  // hover/tap scale with no give in it. Each icon gets its own tap jelly
  // now, played on its own inner span so it never fights the button's own
  // whileHover/whileTap, or (for lock) the coin-flip already swapping
  // pen/eye on the span inside it.
  const starTap = useJellyTap();
  const lockTap = useJellyTap();
  const copyTap = useJellyTap();
  const resizeTap = useJellyTap();

  // The palette's ring borrows the free cursor's own press pulse and idle
  // pool (see useInkPulse) so it carries the same elastic personality as
  // it slides between colors.
  const paletteRingPulse = useInkPulse(note.color);
  const closeTap = useJellyTap();

  const wobble = useCallback(() => {
    jelly.start({
      scaleX: [1, 1.05, .96, 1.02, 1],
      scaleY: [1, .94, 1.06, .98, 1],
      transition: { duration: .6, times: [0, .25, .5, .75, 1], ease: "easeInOut" },
    });
  }, [jelly]);

  useEffect(() => {
    // Skipped mid-drag — the drag handle already updates `size` live as
    // the nearest preset changes purely so the CSS class (font sizing,
    // etc.) stays honest while dragging, and firing the big jelly wobble
    // on every one of those threshold crossings would read as frantic
    // next to the drag's own already-continuous motion. handlePointerUp
    // below calls wobble() itself exactly once the drag actually ends.
    if (isDraggingResizeRef.current) return;
    wobble();
  }, [size, wobble]);

  // Springs width/height to a named preset (see RESIZE_SPRING) and
  // updates `size` to match — the one funnel both the resize button and a
  // released drag go through, so either path always ends in the exact
  // same state.
  const animateToSize = useCallback((name) => {
    const target = sizeFor(name);
    animate(widthMV, target.width, RESIZE_SPRING);
    animate(heightMV, target.height, RESIZE_SPRING);
    setSize(name);
  }, [widthMV, heightMV]);

  // The corner drag handle — 1:1 pointer tracking while actually held
  // (see widthMV/heightMV above), clamped to the cozy↔epic range so a
  // wild drag can't pull the paper past either end of what the preset
  // button itself could ever reach. Pointer capture on the handle itself
  // means pointermove/up keep arriving even once a fast drag's cursor
  // has left the handle's own small hit area.
  const handleResizeDown = (e) => {
    const min = sizeFor(EDITOR_SIZES[0]);
    const max = sizeFor(EDITOR_SIZES[EDITOR_SIZES.length - 1]);
    resizeDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: widthMV.get(),
      startH: heightMV.get(),
      minW: min.width,
      maxW: max.width,
      minH: min.height,
      maxH: max.height,
    };
    isDraggingResizeRef.current = true;
    resizeTap.squash();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizeMove = (e) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    const nextW = Math.min(drag.maxW, Math.max(drag.minW, drag.startW + (e.clientX - drag.startX)));
    const nextH = Math.min(drag.maxH, Math.max(drag.minH, drag.startH + (e.clientY - drag.startY)));
    widthMV.set(nextW);
    heightMV.set(nextH);
    setSize((prev) => {
      const nearest = nearestSizeFor(nextW);
      return prev === nearest ? prev : nearest;
    });
  };

  const handleResizeUp = (e) => {
    if (!resizeDragRef.current) return;
    resizeDragRef.current = null;
    isDraggingResizeRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // The elastic overshoot on release — animateToSize's own spring, plus
    // the same big jelly wobble a button click already gets, played by
    // hand exactly once since the effect above stood down for the whole
    // drag.
    animateToSize(nearestSizeFor(widthMV.get()));
    wobble();
  };

  const titleRef = useRef(null);
  const textRef = useRef(null);
  const editorRef = useRef(null);
  const sheenRef = useRef(null);
  const titleTimerRef = useRef(null);
  const textTimerRef = useRef(null);
  const copiedTimerRef = useRef(null);

  // The unfurl's own opening half (see UNFURL_OPEN_DURATION) — plays
  // exactly once, right on mount. editorRef is .note-editor-shell itself
  // (see the JSX below), which now carries nothing but a plain opacity
  // fade from Framer Motion — clipPath and rotateX are GSAP's alone here,
  // never fought over between the two. Skipped entirely under reduced
  // motion, which leaves the shell at CSS's own default (fully visible,
  // untilted) rather than applying a GSAP `set()` that a skipped tween
  // would then leave stranded half-hidden forever.
  useEffect(() => {
    if (reduceMotion || !editorRef.current) return;

    gsap.set(editorRef.current, {
      clipPath: "inset(0% 0% 100% 0%)",
      rotateX: UNFURL_TILT,
      transformPerspective: 1400,
      transformOrigin: "50% 0%",
    });
    gsap.set(sheenRef.current, { top: "0%", opacity: 0 });

    gsap.timeline()
      .to(editorRef.current, {
        clipPath: "inset(0% 0% 0% 0%)",
        rotateX: 0,
        duration: UNFURL_OPEN_DURATION,
        ease: "power2.out",
      }, 0)
      .to(sheenRef.current, { top: "100%", duration: UNFURL_OPEN_DURATION, ease: "power2.out" }, 0)
      .to(sheenRef.current, { opacity: UNFURL_SHEEN_PEAK, duration: UNFURL_OPEN_DURATION * .2 }, 0)
      .to(sheenRef.current, { opacity: 0, duration: UNFURL_OPEN_DURATION * .35 }, UNFURL_OPEN_DURATION * .55);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The unfurl's closing half — the reverse timeline, played FIRST, with
  // the real onClose prop (the one that actually flips React state and
  // lets AnimatePresence unmount this component) wired to its own
  // onComplete rather than called directly. Every path that ends the
  // editor — Escape, the backdrop, the close button — goes through this
  // now instead of onClose itself, so all three get the same graceful
  // roll-shut rather than one of them still snapping straight to unmount.
  const requestClose = useCallback(() => {
    if (reduceMotion || !editorRef.current) {
      onClose();
      return;
    }

    gsap.timeline({ onComplete: onClose })
      .to(editorRef.current, {
        clipPath: "inset(0% 0% 100% 0%)",
        rotateX: UNFURL_TILT,
        duration: UNFURL_CLOSE_DURATION,
        ease: "power2.in",
      }, 0)
      .to(sheenRef.current, { top: "0%", opacity: UNFURL_SHEEN_PEAK, duration: UNFURL_CLOSE_DURATION * .5 }, 0)
      .to(sheenRef.current, { opacity: 0, duration: UNFURL_CLOSE_DURATION * .5 }, UNFURL_CLOSE_DURATION * .5);
  }, [reduceMotion, onClose]);

  // Traps Tab/Shift+Tab within the editor and returns focus to whatever
  // triggered it once closed — see useFocusTrap.js. `open` is a constant
  // `true` here (unlike every other panel using this hook) since this
  // component only ever exists while actively editing — Home.jsx mounts
  // and unmounts it entirely rather than toggling an internal open flag,
  // and the hook's restore-on-close step lives in its effect's own
  // cleanup specifically so that still fires correctly on unmount.
  // focusOnOpen is off: the effect below already puts the caret in the
  // text field itself (or, for a locked note, on the editor shell) — a
  // more specific target than the hook's own generic "focus the panel
  // root" fallback.
  useFocusTrap(editorRef, true, { focusOnOpen: false });

  // Adopt outside changes to the note unless that field is being typed in
  // right now — a self-made edit round-trips as the same value anyway.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setDraftTitle(note.title);
  }, [note.title]);

  useEffect(() => {
    if (document.activeElement !== textRef.current) setDraftText(note.text);
  }, [note.text]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") requestClose();
    };

    window.addEventListener("keydown", handleKey);

    const timers = [titleTimerRef, textTimerRef, copiedTimerRef];
    return () => {
      window.removeEventListener("keydown", handleKey);
      timers.forEach((timer) => clearTimeout(timer.current));
    };
  }, [requestClose]);

  // Drop the caret at the end of the body so writing continues immediately
  // — or, for a locked note (nothing to type into), land on the editor
  // shell itself instead, so a keyboard user still has *something*
  // focused to Tab from rather than nothing at all.
  useEffect(() => {
    if (note.lock) {
      editorRef.current?.focus({ preventScroll: true });
      return;
    }

    const field = textRef.current;
    if (!field) return;

    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, [note.lock]);

  const handleTitle = (value) => {
    setDraftTitle(value);
    // A tiny, randomly-signed kick per keystroke (see TENSION_KEY_KICK) —
    // random rather than a fixed direction so a long typing run reads as
    // the paper answering each press on its own, not leaning steadily one
    // way and springing back the exact same way every time.
    kickTension((Math.random() - .5) * 2 * TENSION_KEY_KICK, (Math.random() - .5) * 2 * TENSION_KEY_KICK * .6);
    clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => updateTitle(value, note.id), debounceTimer);
  };

  const handleText = (value) => {
    setDraftText(value);
    kickTension((Math.random() - .5) * 2 * TENSION_KEY_KICK, (Math.random() - .5) * 2 * TENSION_KEY_KICK * .6);
    clearTimeout(textTimerRef.current);
    textTimerRef.current = setTimeout(() => updateText(value, note.id), debounceTimer);
  };

  // The body's own scroll answers the same tension spring, along its one
  // genuinely physical axis: scrolling a real sheet under your hand tugs
  // it, and the sign follows the actual scroll direction rather than
  // being randomized the way a keystroke's is — this one has a true
  // direction to be honest about.
  const handleTextScroll = (e) => {
    const top = e.currentTarget.scrollTop;
    const delta = Math.max(-TENSION_SCROLL_DELTA_CAP, Math.min(TENSION_SCROLL_DELTA_CAP, top - lastScrollTopRef.current));
    lastScrollTopRef.current = top;
    kickTension(0, delta * TENSION_SCROLL_KICK);
  };

  // Copy the whole note as plain text, with a small sparkle of confirmation.
  const handleCopy = async () => {
    const body = draftText?.trim() ? draftText : note.placeholder;
    const content = `${ draftTitle?.trim() || "Untitled note" }\n\n${ body }`;

    try {
      await navigator.clipboard.writeText(content);
    } catch {
      return;
    }

    setCopied(true);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1400);
  };

  const words = draftText.trim() ? draftText.trim().split(/\s+/).length : 0;

  return (
    <div className="note-editor-layer">
      <motion.div
        className="note-editor-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{
          opacity: 0,
          transition: { duration: .25, ease: "easeIn" },
        }}
        onClick={ requestClose }
      />
      <motion.div
        ref={ editorRef }
        tabIndex={ -1 }
        className="note-editor-shell"
        /* The real entrance/exit character now lives entirely in GSAP
           (see the unfurl open effect and requestClose above) — clipPath
           and rotateX on this exact node. Framer Motion's own job here
           shrinks to a plain opacity fade purely so AnimatePresence still
           has SOMETHING to time the eventual unmount against; by the time
           that exit fade would even start, requestClose's own timeline
           has already finished and called the real onClose, so there's
           nothing left worth giving a slower, more visible fade of its
           own — a quick, cheap fade covering only whatever imperceptible
           gap sits between GSAP's onComplete and React's next commit. */
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: .12 } }}
        transition={{ duration: .12 }}
      >
        <div ref={ sheenRef } className="note-editor-unfurl-sheen" aria-hidden="true" />
        <motion.div
          className="note-editor-jelly"
          animate={ jelly }
        >
          {/* The tension wrapper (see TENSION_STIFFNESS) — a plain ref'd
              div, deliberately NOT a motion.div: it exists only so a raw
              rAF loop can write a skew transform to it directly every
              frame without a second animation system fighting Framer
              Motion over the same DOM node's transform. Sitting outside
              .note-editor rather than around just its content is what
              makes the skew read as the whole paper flexing (rounded
              corners, shadow, and all) instead of the content sliding
              inside a rigid frame. */}
          <div ref={ tensionRef } className="note-editor-tension">
            <motion.div
              className={ `note-editor ${ size } ${ note.color }-bg ${ note.lock ? "locked" : "" }` }
              style={{ width: widthMV, height: heightMV }}
            >
            {/* A faint drift of actual ink specks behind the paper — the
                exact same raw-Three.js dust technique History's own preview
                pane and the Settings panel already reuse (see
                HistoryAmbient.jsx). Tinted to the page's own ink rather than
                the note's color: the paper itself already *is* that color
                (note-editor's own background), so dust in the same shade
                would all but disappear into it — ink motes read clearly
                against any of the seven paper colors instead. */}
            <HistoryAmbient color="var(--page-ink-color)" />
            <div className="note-editor-header">
              <div className="note-editor-palette">
                {
                  Object.keys(NOTE_COLORS).map((name) => (
                    <motion.button
                      key={ name }
                      type="button"
                      aria-label={ `Paint the note ${ name }` }
                      className={ `note-editor-dot ${ name }-bg ${ name === note.color ? "active" : "" }` }
                      whileHover={{ scale: 1.25 }}
                      whileTap={{ scale: .85 }}
                      transition={ actionSpring }
                      onTapStart={ paletteRingPulse.squash }
                      onClick={ () => setNoteColor(name, note.id) }
                    >
                      {
                        name === note.color && (
                          <motion.span
                            layoutId="editorPaletteRing"
                            style={{ position: "absolute", inset: -3, borderRadius: "50%" }}
                            transition={{ type: "spring", stiffness: 450, damping: 17 }}
                          >
                            <motion.span
                              className="note-editor-dot-ring"
                              animate={ paletteRingPulse.jelly }
                              style={{ position: "absolute", inset: 0, borderRadius: "inherit" }}
                            />
                          </motion.span>
                        )
                      }
                    </motion.button>
                  ))
                }
              </div>
              <div className="note-editor-actions">
                <motion.button
                  type="button"
                  aria-label={ note.favorite ? "Unstar this note" : "Star this note" }
                  className="note-editor-action"
                  whileHover={{ scale: 1.15, rotate: -10 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  style={{
                    backgroundColor: note.favorite ? "var(--black-color)" : "var(--black-even-more-transclucent-color)",
                  }}
                  onTapStart={ starTap.squash }
                  onClick={ () => updateFavorite(note.id) }
                >
                  <motion.span animate={ starTap.jelly } style={{ display: "inline-flex" }}>
                    <FaStar className={ `note-editor-action-icon ${ note.color }` } />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ note.lock ? "Unlock this note for editing" : "Lock this note" }
                  className="note-editor-action dark"
                  style={{ transformPerspective: 300 }}
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ lockTap.squash }
                  onClick={ () => updateLock(note.id) }
                >
                  <motion.span animate={ lockTap.jelly } style={{ display: "inline-flex" }}>
                    <AnimatePresence mode="wait" initial={ false }>
                      <motion.span
                        key={ note.lock ? "pen" : "eye" }
                        className="note-editor-action-icon-wrap"
                        { ...coinFlip({ type: "spring", stiffness: 420, damping: 17 }) }
                      >
                        {
                          note.lock
                            ? <FaPen className="note-editor-action-icon light" />
                            : <FaEye className="note-editor-action-icon light" />
                        }
                      </motion.span>
                    </AnimatePresence>
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label="Copy the note to the clipboard"
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ copyTap.squash }
                  onClick={ handleCopy }
                >
                  <motion.span animate={ copyTap.jelly } style={{ display: "inline-flex" }}>
                    <FaCopy className="note-editor-action-icon light" />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ `Resize the paper (now ${ size })` }
                  className="note-editor-action"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .8 }}
                  transition={ actionSpring }
                  onTapStart={ resizeTap.squash }
                  onClick={ () => animateToSize(EDITOR_SIZES[(EDITOR_SIZES.indexOf(size) + 1) % EDITOR_SIZES.length]) }
                >
                  <motion.span animate={ resizeTap.jelly } style={{ display: "inline-flex" }}>
                    <span className={ `note-editor-size-box s${ EDITOR_SIZES.indexOf(size) }` } />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label="Close the editor"
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15, rotate: 90 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ closeTap.squash }
                  onClick={ requestClose }
                >
                  <motion.span animate={ closeTap.jelly } style={{ display: "inline-flex" }}>
                    <FaXmark className="note-editor-action-icon light" />
                  </motion.span>
                </motion.button>
              </div>
              <AnimatePresence>
                {
                  copied && (
                    <motion.span
                      className="note-editor-copied"
                      initial={{ opacity: 0, scale: .8, y: -6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: .8, y: -6 }}
                      transition={{ type: "spring", stiffness: 380, damping: 20 }}
                    >
                      Copied ✦
                    </motion.span>
                  )
                }
              </AnimatePresence>
            </div>
            <input
              ref={ titleRef }
              readOnly={ note.lock }
              placeholder="Title"
              value={ draftTitle }
              onChange={ (e) => handleTitle(e.target.value) }
              // liquid-text — the shared shader filter LoadIntro's own
              // logotype and HistoryPanel already wear (see
              // LiquidTextFilter.jsx, mounted once in Home.jsx); the title
              // steadies the instant it's actually focused (see the CSS)
              // so the wobble reads as the paper's own ambient life, never
              // as something fighting the caret while you're typing.
              className={ `note-editor-title liquid-text ${ note.color }-highlight` }
            />
            {/* A little rack of tags — each pops in with an overshoot when
                pinned on, shrinks away when pulled off. Enter or a comma
                pins the current word; Backspace on an empty field pulls the
                last one back off. */}
            {
              !note.lock && (
                <div className="note-editor-tags">
                  <AnimatePresence initial={ false }>
                    {
                      tags.map((tag) => (
                        <motion.button
                          key={ tag }
                          type="button"
                          aria-label={ `Remove the ${ tag } tag` }
                          className="note-editor-tag"
                          layout
                          initial={{ opacity: 0, scale: 0, translateY: 8 }}
                          animate={{ opacity: 1, scale: 1, translateY: 0 }}
                          exit={{ opacity: 0, scale: .4, transition: { duration: .16, ease: "easeIn" } }}
                          whileHover={{ scale: 1.06 }}
                          whileTap={{ scale: .9 }}
                          transition={{ type: "spring", stiffness: 420, damping: 17 }}
                          onClick={ () => removeTag(tag) }
                        >
                          <FaTag className="note-editor-tag-icon" />
                          { tag }
                          <FaXmark className="note-editor-tag-remove" />
                        </motion.button>
                      ))
                    }
                  </AnimatePresence>
                  <input
                    ref={ tagInputRef }
                    type="text"
                    placeholder={ tags.length ? "Add another…" : "Add a tag…" }
                    value={ tagDraft }
                    onChange={ (e) => setTagDraft(e.target.value) }
                    onKeyDown={ handleTagKeyDown }
                    onBlur={ addTag }
                    className="note-editor-tag-input"
                  />
                </div>
              )
            }
            <textarea
              ref={ textRef }
              readOnly={ note.lock }
              placeholder={ note.placeholder }
              value={ draftText }
              onChange={ (e) => handleText(e.target.value) }
              onScroll={ handleTextScroll }
              className={ `note-editor-text custom-scroll ${ note.color }-highlight` }
            ></textarea>
            <div className="note-editor-footer">
              <div className="note-editor-footer-left">
                <span className="note-editor-date">{ note.time }</span>
                <AnimatePresence>
                  {
                    !draftText.trim() && (
                      <motion.button
                        key="quote"
                        type="button"
                        aria-label="Deal a new inspiration quote"
                        className="note-editor-quote"
                        initial={{ opacity: 0, scale: .8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: .8 }}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: .92 }}
                        transition={{ type: "spring", stiffness: 420, damping: 18 }}
                        onClick={ () => updateQuote(note.id) }
                      >
                        <FaShuffle className="note-editor-quote-icon" />
                        new quote
                      </motion.button>
                    )
                  }
                </AnimatePresence>
              </div>
              <div className="note-editor-meta">
                <motion.span
                  key={ words }
                  className="note-editor-count"
                  initial={{ scale: .75, y: 2 }}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 18 }}
                >
                  { words } { words === 1 ? "word" : "words" }
                </motion.span>
                <span className="note-editor-count muted">{ draftText.length } chars</span>
              </div>
            </div>
            {/* The corner drag handle (see handleResizeDown) — a real,
                continuous alternative to the discrete resize button above:
                grab and drag freely between the cozy↔epic range, release
                anywhere and it snaps to whichever preset sat closest,
                with the exact same spring/wobble the button's own click
                already lands with. touchAction: none stops the browser's
                own touch-scroll from fighting the drag on a touchscreen. */}
            <div
              className="note-editor-resize-handle"
              role="presentation"
              style={{ touchAction: "none" }}
              onPointerDown={ handleResizeDown }
              onPointerMove={ handleResizeMove }
              onPointerUp={ handleResizeUp }
            />
            </motion.div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default NoteEditor;
