import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaFileArrowDown } from "react-icons/fa6";

import "./DropZoneOverlay.css";

// The same lava-lamp drops NoteList.jsx's empty-state uses behind the desk
// — reused here rather than invented fresh, so "a pool of ink" reads as the
// same substance everywhere it shows up in the app.
const POOL_BLOBS = [
  { color: "var(--yellow-color)", size: 70, x: [-50, 30, -50], y: [-15, 20, -15], duration: 7 },
  { color: "var(--blue-color)", size: 56, x: [40, -30, 40], y: [15, -20, 15], duration: 8.5 },
  { color: "var(--pink-color)", size: 46, x: [-15, 45, -15], y: [35, -10, 35], duration: 9.5 },
  { color: "var(--purple-color)", size: 40, x: [25, -40, 25], y: [-30, 25, -30], duration: 6.5 },
];

// Dragging a Docket backup file anywhere over the window blooms this in —
// a gooey pool of ink (the same #gooey-effect filter the nav rail's pots
// and every radial menu already melt together with) rather than a plain
// dashed rectangle, so the one moment in the app that used to look like
// generic drop-zone boilerplate now reads as the same ink/paper substance
// as everywhere else. The file icon sits centered in the pool, dipping
// gently as if the ink itself is breathing. Purely decorative
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
            initial={{ opacity: 0, scale: .7 }}
            animate={{ opacity: 1, scale: [.7, 1.08, .96, 1] }}
            exit={{ opacity: 0, scale: .85, transition: { duration: .18, ease: "easeIn" } }}
            transition={{ duration: .6, times: [0, .55, .8, 1], ease: "easeOut" }}
          >
            <motion.div
              className="drop-zone-pool"
              aria-hidden="true"
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            >
              {
                POOL_BLOBS.map((blob, index) => (
                  <motion.span
                    key={ index }
                    className="drop-zone-blob"
                    style={{
                      width: blob.size,
                      height: blob.size,
                      backgroundColor: blob.color,
                    }}
                    animate={{ x: blob.x, y: blob.y, scale: [1, 1.15, 1] }}
                    transition={{ duration: blob.duration, repeat: Infinity, ease: "easeInOut" }}
                  />
                ))
              }
            </motion.div>
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
