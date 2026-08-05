import React, { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaFileArrowDown } from "react-icons/fa6";

import "./DropZoneOverlay.css";

// The same lava-lamp drops NoteList.jsx's empty-state uses behind the desk
// — reused here rather than invented fresh, so "a pool of ink" reads as the
// same substance everywhere it shows up in the app. Each blob still wanders
// its own independent elliptical orbit (radius/speed/phase, in place of the
// old hand-picked keyframe arrays), but the orbits were never checked
// against each other — two blobs' old paths could (and did) cross straight
// through one another with zero interaction. A real mutual repulsion (the
// same 1/r push AmbientField.jsx's dust field and NotePile.jsx's cohesion
// already use, just applied blob-to-blob here) now keeps them from ever
// truly overlapping, the way two immiscible drops of ink actually behave.
const POOL_BLOBS = [
  { color: "var(--yellow-color)", size: 70, radiusX: 46, radiusY: 24, speed: .5, phase: 0 },
  { color: "var(--blue-color)", size: 56, radiusX: 38, radiusY: 28, speed: .42, phase: 2.4 },
  { color: "var(--pink-color)", size: 46, radiusX: 32, radiusY: 30, speed: .37, phase: 4.6 },
  { color: "var(--purple-color)", size: 40, radiusX: 40, radiusY: 22, speed: .58, phase: 1.6 },
];

const REPEL_RANGE = 60;    // px — how close two blob centers can get before they start pushing apart
const REPEL_STRENGTH = 1600; // tuned against 1/dist² below, not a raw px/s figure on its own

// The blobs' own position is driven imperatively (plain refs, a value
// written straight to style.transform every tick) rather than through
// framer's `animate` — the same split NotePile.jsx/TrashPhysics.jsx already
// use for their own per-frame physics, and for the same reason: this needs
// to read every other blob's current position each frame to compute
// repulsion, which a declarative keyframe animation has no way to express.
// The gentle scale pulse stays fully declarative, on a separate nested
// element, so the two systems never fight over the same element's
// transform (the same two-node split useJellyTap/useMagnetic's own
// comments describe elsewhere in this app).
const DropZoneOverlay = ({ active }) => {
  const blobRefs = useRef([]);
  const stateRef = useRef(POOL_BLOBS.map(() => ({ x: 0, y: 0 })));

  useEffect(() => {
    if (!active) return undefined;

    let raf = null;
    const start = performance.now();

    const tick = () => {
      const t = (performance.now() - start) / 1000;
      const state = stateRef.current;

      // Each blob eases toward its own point on its own ellipse — eased
      // rather than snapped straight to it, so the repulsion correction
      // below (which nudges these same values) has something springy to
      // blend with instead of getting overwritten outright next frame.
      for (let i = 0; i < POOL_BLOBS.length; i++) {
        const blob = POOL_BLOBS[i];
        const targetX = Math.cos(t * blob.speed + blob.phase) * blob.radiusX;
        const targetY = Math.sin(t * blob.speed * 1.3 + blob.phase) * blob.radiusY;
        state[i].x += (targetX - state[i].x) * .025;
        state[i].y += (targetY - state[i].y) * .025;
      }

      // Mutual repulsion: force ∝ 1/dist² (an inverse-square falloff, the
      // same family AmbientField's own 2D field uses at a different power —
      // that one derived 1/r as the correct 2D analogue of Coulomb's law
      // for a field of independent points; this one only ever needs to act
      // over the last ~60px before two blobs would visibly overlap, where
      // a steeper 1/dist² falloff reads as a firmer "these two just won't
      // merge" push rather than a field affecting the whole pool at once).
      for (let i = 0; i < state.length; i++) {
        for (let j = i + 1; j < state.length; j++) {
          const dx = state[j].x - state[i].x;
          const dy = state[j].y - state[i].y;
          const dist = Math.max(4, Math.hypot(dx, dy));
          if (dist >= REPEL_RANGE) continue;

          const push = (REPEL_STRENGTH / (dist * dist)) * 0.0009;
          const nx = (dx / dist) * push;
          const ny = (dy / dist) * push;
          state[i].x -= nx; state[i].y -= ny;
          state[j].x += nx; state[j].y += ny;
        }
      }

      for (let i = 0; i < blobRefs.current.length; i++) {
        const el = blobRefs.current[i];
        if (el) el.style.transform = `translate(${ state[i].x }px, ${ state[i].y }px)`;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
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
              exit={{ opacity: 0, scale: [1, 1.05, .8], transition: { duration: .26, times: [0, .3, 1], ease: "easeInOut" } }}
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
                    <span
                      key={ index }
                      ref={ (el) => { blobRefs.current[index] = el; } }
                      className="drop-zone-blob-wrap"
                      style={{ width: blob.size, height: blob.size }}
                    >
                      <motion.span
                        className="drop-zone-blob"
                        style={{ backgroundColor: blob.color }}
                        animate={{ scale: [1, 1.15, 1] }}
                        transition={{ duration: 3.2 + index * .5, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </span>
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
};

export default DropZoneOverlay;
