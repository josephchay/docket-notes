import { useMemo } from "react";
import { motion } from "framer-motion";

import { blobPath } from "../../utils/blob";
import { SNAPPY, SETTLE } from "../Motion";

import "./ErrorSpill.css";

// A drop of ink tipped over rather than a bare error message — the same
// organic blob shape (utils/blob.js's flubber-powered blobPath) every
// dot-to-sheet panel already morphs through on the way in, otherwise
// sitting idle here as a plain static silhouette. Recomputed only once
// per mount (a crash is exactly the moment nothing should be doing extra
// work), not re-rolled on every render.
const ErrorSpill = ({ onRecover }) => {
  const blotPath = useMemo(() => blobPath(240, 200, 10, 0.4), []);

  return (
    <div className="error-spill">
      <div className="error-spill-drops" aria-hidden="true">
        {
          Array.from({ length: 6 }).map((_, i) => (
            <span key={ i } className={ `error-spill-drop error-spill-drop-${ i }` } />
          ))
        }
      </div>
      <svg className="error-spill-blot-svg" viewBox="0 0 240 200" aria-hidden="true">
        <motion.path
          d={ blotPath }
          className="error-spill-blot"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 140, damping: 12 }}
        />
      </svg>
      <motion.div
        className="error-spill-content"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SETTLE, delay: .25 }}
      >
        <h2>The ink spilled</h2>
        <p>Something on the desk tipped over. Your notes are saved separately from whatever just broke.</p>
        <motion.button
          type="button"
          className="error-spill-button"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: .95 }}
          transition={ SNAPPY }
          onClick={ onRecover }
        >
          Smooth the page back out
        </motion.button>
      </motion.div>
    </div>
  );
};

export default ErrorSpill;
