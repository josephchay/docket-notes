import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import gsap from "gsap";
import { FaTrash } from "react-icons/fa";
import { FaArrowRotateLeft } from "react-icons/fa6";

import SparkBurst from "../Spark/SparkBurst";

import "./UndoToast.css";

const UNDO_WINDOW = 5000;   // how long a deleted note lingers (ms)
const SWIPE_THRESHOLD = 110; // how far a swipe has to travel to dismiss (px)
const UNDO_CONFIRM_DELAY = 600; // how long the Undo flourish gets to play before the card actually leaves (ms)

// A safety net under the long-press delete. Each deleted note becomes a card
// in this toast deck, wearing the note's own color; fresh deletes spring in
// at the front and nudge the older ones up into the pile behind. Every card
// drains its own timer bar — press Undo to spring that note back into its
// old spot in the list, or flick the card itself off to either side to wave
// it away early. A flicked card keeps sailing off in the direction it was
// thrown; every other exit (Undo, the timer running out) settles down and
// fades instead.
const UndoToast = ({ note, depth, onUndo, onDismiss, reduceMotion = false }) => {
  const dragX = useMotionValue(0);
  const rotate = useTransform(dragX, [-180, 0, 180], [-16, 0, 16]);
  const fadeOnDrag = useTransform(dragX, [-160, -40, 0, 40, 160], [.25, 1, 1, 1, .25]);

  // Set just before onDismiss fires from a swipe, so the exit animation
  // knows to keep sailing instead of settling.
  const [flungDir, setFlungDir] = useState(0);
  const dismissedRef = useRef(false);

  // The countdown, the swatch's shiver, and the timer's own eventual fire
  // all read from one shared clock rather than three independent ones —
  // `elapsedRef` only advances while `pausedRef` is false, so holding a
  // finger on the card (see onPointerDown/onPointerUp below) freezes the
  // bar's drain and the shiver's phase at the exact same instant, instead
  // of each drifting back into sync on release. `settledRef` stops this
  // loop from ever firing onDismiss a second time once some other path
  // (Undo, a flung swipe) has already decided this card is leaving.
  const drainMV = useMotionValue(1); // 1 = full bar, 0 = empty
  const shiverRotate = useMotionValue(0);
  const pausedRef = useRef(false);
  const elapsedRef = useRef(0);
  const settledRef = useRef(false);

  useEffect(() => {
    let raf;
    let last = performance.now();

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (settledRef.current) return;

      const dt = now - last;
      last = now;
      if (!pausedRef.current) elapsedRef.current += dt;

      const progress = Math.min(1, elapsedRef.current / UNDO_WINDOW);
      drainMV.set(1 - progress);

      // The shiver stays essentially still until the final stretch, then
      // both its frequency and its swing widen as a real function of how
      // much time is actually left — cubed so it stays inert for most of
      // the window and only wakes up in the last second or two, rather
      // than a linear ramp that'd be shivering the whole time.
      if (!reduceMotion) {
        const urgency = progress ** 3;
        const freq = 2 + urgency * 8;
        const amplitude = urgency * 4.5;
        shiverRotate.set(Math.sin((elapsedRef.current / 1000) * freq * Math.PI * 2) * amplitude);
      }

      if (progress >= 1) {
        settledRef.current = true;
        onDismiss(note.id);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDismiss, note.id, reduceMotion, drainMV, shiverRotate]);

  const handlePauseStart = () => { pausedRef.current = true; };
  const handlePauseEnd = () => { pausedRef.current = false; };

  // The same handful of ink drops Header's star toggle and the trash
  // panel's restore button already throw (see SparkBurst.jsx) — Undo is a
  // "yes, that landed" action too, so it earns the same little flourish
  // rather than just silently springing the card away.
  const [undoBurst, setUndoBurst] = useState(false);
  const burstTimerRef = useRef(null);
  const confirmTimerRef = useRef(null);

  useEffect(() => () => {
    clearTimeout(burstTimerRef.current);
    clearTimeout(confirmTimerRef.current);
  }, []);

  // The swatch's own ink-well ripple — a locally-scoped feDisplacementMap,
  // the same shared recipe Header's own #search-ripple filter uses (see
  // that file's searchDisplaceRef) rather than the shared, constantly-idle
  // #liquid-text filter: scale starts at 0 and only ever moves because
  // something here triggered it. `filterId` is per-note rather than a
  // fixed string since up to three toasts sit in the deck at once — a
  // shared id would make every visible swatch ripple off one instance's
  // trigger instead of just its own.
  const inkDisplaceRef = useRef(null);
  const filterId = `undo-ink-${ note.id }`;

  const rippleInk = useCallback(() => {
    if (reduceMotion || !inkDisplaceRef.current) return;
    gsap.killTweensOf(inkDisplaceRef.current);
    gsap.timeline()
      .to(inkDisplaceRef.current, { attr: { scale: 7 }, duration: .1, ease: "power2.out" })
      .to(inkDisplaceRef.current, { attr: { scale: 0 }, duration: .5, ease: "power2.out" });
  }, [reduceMotion]);

  // Once on arrival, like a fresh blot still settling into the paper.
  useEffect(() => {
    rippleInk();
  }, [rippleInk]);

  const handleUndo = () => {
    // The card is staying just long enough to let its own confirmation
    // play out, so both the timer loop and a mid-air swipe should stand
    // down — nothing else gets to decide this card is leaving now.
    pausedRef.current = true;
    settledRef.current = true;

    setUndoBurst(true);
    rippleInk();
    clearTimeout(burstTimerRef.current);
    burstTimerRef.current = setTimeout(() => setUndoBurst(false), UNDO_CONFIRM_DELAY);

    // The drag-to-dismiss path already has natural travel time before
    // onDismiss fires — a flick takes a beat to cross SWIPE_THRESHOLD, so
    // the burst it also throws (see the fling branch in handleDragEnd,
    // inherited from before) was never at risk of getting cut off. Undo
    // used to call onUndo in the very same tick as setUndoBurst(true),
    // which yanked the card out of the deck before its own flourish had
    // anywhere near finished. This waits for it.
    clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => onUndo(note.id), UNDO_CONFIRM_DELAY);
  };

  const handleDragEnd = (_e, info) => {
    if (dismissedRef.current) return;

    if (Math.abs(info.offset.x) > SWIPE_THRESHOLD || Math.abs(info.velocity.x) > 900) {
      dismissedRef.current = true;
      settledRef.current = true;
      setFlungDir(info.offset.x < 0 ? -1 : 1);
      onDismiss(note.id);
    }
  };

  const title = note.title?.trim();
  const label = title
    ? `“${ title.length > 18 ? `${ title.slice(0, 18) }…` : title }” deleted`
    : "Note deleted";

  return (
    <motion.div
      className="undo-toast"
      style={{ zIndex: 10 - depth, x: dragX, rotate, opacity: fadeOnDrag }}
      drag="x"
      dragDirectionLock
      dragElastic={ 0.6 }
      dragSnapToOrigin
      dragTransition={{ bounceStiffness: 420, bounceDamping: 22 }}
      whileDrag={{ scale: 1.03, cursor: "grabbing" }}
      onDragEnd={ handleDragEnd }
      onPointerDown={ handlePauseStart }
      onPointerUp={ handlePauseEnd }
      onPointerCancel={ handlePauseEnd }
      initial={{ opacity: 0, y: 90, scale: .9, rotate: -6 }}
      animate={{
        opacity: 1 - depth * .18,
        y: depth * -14,
        scale: 1 - depth * .06,
        rotate: 0,
      }}
      exit={
        flungDir ? {
          opacity: 0,
          x: flungDir * 520,
          rotate: flungDir * 26,
          scale: .8,
          transition: { duration: .38, ease: "easeOut" },
        } : {
          // A flung card keeps its own physical exit above; a card that
          // just settles out (Undo, or the timer running out) now gets a
          // small squash on its way down instead of a flat fade — the same
          // echo-of-the-entrance the swipe path already had for free.
          opacity: 0,
          scaleX: [1, 1.05, .85],
          scaleY: [1, .9, .82],
          y: 60,
          rotate: -4,
          transition: { duration: .28, times: [0, .3, 1], ease: "easeInOut" },
        }
      }
      transition={{
        type: "spring",
        stiffness: 320,
        damping: 22,
      }}
    >
      <svg width="0" height="0" aria-hidden="true">
        <defs>
          <filter id={ filterId } x="-40%" y="-40%" width="180%" height="180%">
            <feTurbulence type="fractalNoise" baseFrequency="0.06 0.09" numOctaves="2" seed="4" result="undo-ink-noise" />
            <feDisplacementMap ref={ inkDisplaceRef } in="SourceGraphic" in2="undo-ink-noise" scale="0" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <motion.span
        className={ `undo-toast-swatch ${ note.color }-bg` }
        style={{ rotate: shiverRotate, filter: `url(#${ filterId })` }}
      >
        <FaTrash className="undo-toast-trash" />
      </motion.span>
      <span className="undo-toast-label">{ label }</span>
      <motion.button
        type="button"
        className={ `undo-toast-button ${ note.color }-bg` }
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: .92 }}
        transition={{ type: "spring", stiffness: 420, damping: 16 }}
        onPointerDown={ (e) => e.stopPropagation() }
        onClick={ handleUndo }
      >
        <FaArrowRotateLeft className="undo-toast-undo-icon" />
        Undo
        <SparkBurst
          active={ undoBurst }
          count={ 5 }
          angleOffset={ -Math.PI / 2 }
          radius={ 22 }
          duration={ .5 }
          className="undo-toast-burst"
        />
      </motion.button>
      {/* The countdown itself (scaleX) stays exactly linear — this is the
          one place in the toast where legibility matters more than
          flourish, and an eased drain would misrepresent how much time is
          actually left. The ink character comes from a second, independent
          loop on top: a slow breathing thickness/opacity wobble that never
          touches the timing. scaleX itself now rides drainMV (the shared
          pausable clock above) via style rather than a fire-and-forget
          transition, so holding the card actually freezes it. */}
      <motion.span
        className={ `undo-toast-progress ${ note.color }-bg` }
        style={{ scaleX: drainMV }}
        initial={{ scaleY: 1, opacity: 1 }}
        animate={{ scaleY: [1, 1.18, 1], opacity: [1, .9, 1] }}
        transition={{
          scaleY: { duration: 1.3, repeat: Infinity, ease: "easeInOut" },
          opacity: { duration: 1.3, repeat: Infinity, ease: "easeInOut" },
        }}
      />
    </motion.div>
  );
};

export default UndoToast;
