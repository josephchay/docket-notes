import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { FaTrash } from "react-icons/fa";
import { FaArrowRotateLeft } from "react-icons/fa6";

import "./UndoToast.css";

const UNDO_WINDOW = 5000;   // how long the deleted note lingers (ms)

// A safety net under the long-press delete. The toast springs up in the
// deleted note's own color, its timer bar draining across the undo window;
// press Undo to spring the note back into its old spot in the list.
const UndoToast = ({ note, onUndo, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(onDismiss, UNDO_WINDOW);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const title = note.title?.trim();
  const label = title
    ? `“${ title.length > 18 ? `${ title.slice(0, 18) }…` : title }” deleted`
    : "Note deleted";

  return (
    <div className="undo-toast-layer">
      <motion.div
        className="undo-toast"
        initial={{ opacity: 0, y: 90, scale: .9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{
          opacity: 0,
          y: 90,
          scale: .9,
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
          onClick={ onUndo }
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
    </div>
  );
};

export default UndoToast;
