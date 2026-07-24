import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaFileArrowDown } from "react-icons/fa6";

import "./DropZoneOverlay.css";

// Dragging a Docket backup file anywhere over the window blooms this in —
// a bouncy dashed frame in the page's own ink, with the download icon
// bobbing gently to say exactly where to let go. Purely decorative
// (pointer-events: none throughout); the real drag/drop listeners live in
// Home.jsx and don't need this layer in the way.
const DropZoneOverlay = ({ active }) => (
  <AnimatePresence>
    {
      active && (
        <motion.div
          className="drop-zone-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: .2, ease: "easeIn" } }}
        >
          <motion.div
            className="drop-zone-frame"
            initial={{ opacity: 0, scale: .8, rotate: -2 }}
            animate={{ opacity: 1, scale: [.8, 1.05, .98, 1], rotate: 0 }}
            exit={{ opacity: 0, scale: .85, transition: { duration: .18, ease: "easeIn" } }}
            transition={{ duration: .55, times: [0, .55, .8, 1], ease: "easeOut" }}
          >
            <motion.span
              className="drop-zone-icon"
              animate={{ translateY: [0, -10, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            >
              <FaFileArrowDown />
            </motion.span>
            <h3>Drop it on the desk</h3>
            <p>Pours a Docket backup (.json) right in</p>
          </motion.div>
        </motion.div>
      )
    }
  </AnimatePresence>
);

export default DropZoneOverlay;
