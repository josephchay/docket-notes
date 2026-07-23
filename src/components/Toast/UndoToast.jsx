import React, { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { FaTrash } from "react-icons/fa";
import { FaArrowRotateLeft } from "react-icons/fa6";

import "./UndoToast.css";

const UNDO_WINDOW = 5000;   // how long a deleted note lingers (ms)
const SWIPE_THRESHOLD = 110; // how far a swipe has to travel to dismiss (px)

// A safety net under the long-press delete. Each deleted note becomes a card
// in this toast deck, wearing the note's own color; fresh deletes spring in
// at the front and nudge the older ones up into the pile behind. Every card
// drains its own timer bar — press Undo to spring that note back into its
// old spot in the list, or flick the card itself off to either side to wave
// it away early. A flicked card keeps sailing off in the direction it was
// thrown; every other exit (Undo, the timer running out) settles down and
// fades instead.
const UndoToast = ({ note, depth, onUndo, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(note.id), UNDO_WINDOW);
    return () => clearTimeout(timer);
  }, [onDismiss, note.id]);

  const dragX = useMotionValue(0);
  const rotate = useTransform(dragX, [-180, 0, 180], [-16, 0, 16]);
  const fadeOnDrag = useTransform(dragX, [-160, -40, 0, 40, 160], [.25, 1, 1, 1, .25]);

  // Set just before onDismiss fires from a swipe, so the exit animation
  // knows to keep sailing instead of settling.
  const [flungDir, setFlungDir] = useState(0);
  const dismissedRef = useRef(false);

  const handleDragEnd = (_e, info) => {
    if (dismissedRef.current) return;

    if (Math.abs(info.offset.x) > SWIPE_THRESHOLD || Math.abs(info.velocity.x) > 900) {
      dismissedRef.current = true;
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
          opacity: 0,
          y: 60,
          scale: .85,
          transition: { duration: .25, ease: "easeIn" },
        }
      }
      transition={{
        type: "spring",
        stiffness: 320,
        damping: 22,
      }}
    >
      <span className={ `undo-toast-swatch ${ note.color }-bg` }>
        <FaTrash className="undo-toast-trash" />
      </span>
      <span className="undo-toast-label">{ label }</span>
      <motion.button
        type="button"
        className={ `undo-toast-button ${ note.color }-bg` }
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: .92 }}
        transition={{ type: "spring", stiffness: 420, damping: 16 }}
        onPointerDown={ (e) => e.stopPropagation() }
        onClick={ () => onUndo(note.id) }
      >
        <FaArrowRotateLeft className="undo-toast-undo-icon" />
        Undo
      </motion.button>
      <motion.span
        className={ `undo-toast-progress ${ note.color }-bg` }
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: UNDO_WINDOW / 1000, ease: "linear" }}
      />
    </motion.div>
  );
};

export default UndoToast;
