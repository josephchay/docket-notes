import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { FaTrash } from "react-icons/fa";
import { FaArrowRotateLeft } from "react-icons/fa6";

import "./UndoToast.css";

const UNDO_WINDOW = 5000;   // how long a deleted note lingers (ms)

// A safety net under the long-press delete. Each deleted note becomes a card
// in this toast deck, wearing the note's own color; fresh deletes spring in
// at the front and nudge the older ones up into the pile behind. Every card
// drains its own timer bar — press Undo to spring that note back into its
// old spot in the list.
const UndoToast = ({ note, depth, onUndo, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(note.id), UNDO_WINDOW);
    return () => clearTimeout(timer);
  }, [onDismiss, note.id]);

  const title = note.title?.trim();
  const label = title
    ? `“${ title.length > 18 ? `${ title.slice(0, 18) }…` : title }” deleted`
    : "Note deleted";

  return (
    <motion.div
      className="undo-toast"
      style={{ zIndex: 10 - depth }}
      initial={{ opacity: 0, y: 90, scale: .9 }}
      animate={{
        opacity: 1 - depth * .18,
        y: depth * -14,
        scale: 1 - depth * .06,
      }}
      exit={{
        opacity: 0,
        y: 60,
        scale: .85,
        transition: { duration: .25, ease: "easeIn" },
      }}
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
