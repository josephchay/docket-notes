import { AnimatePresence, motion } from "framer-motion";

import "./SparkBurst.css";

// The little handful of ink flicked off a button when something lands —
// starring a note (Note.jsx, Header.jsx), restoring one from the trash
// (TrashPanel.jsx), releasing a pull-string past its threshold
// (PullString.jsx, MoveString.jsx). Five near-identical copies of this
// existed before now, each drawing a ring of "✦" glyphs that scaled up
// then faded — this is the one place the shape lives, redesigned as an
// actual flick of ink rather than a sparkle: every drop is rotated to
// face its own flight direction and stretches long and thin as it
// launches (scaleX racing ahead of scaleY), the way a loaded nib
// spatters when flicked, then relaxes back round as it shrinks into
// nothing — real elastic/stretchy character standing in for the flat
// "glyph fades in place" every copy drew before.
//
// Positioning is deliberately left to the caller (className/style) —
// the five sites anchor their burst differently (centered over a small
// icon, hanging off a moving drag anchor, flex-centered over a button),
// so only the drops themselves are shared here.
const SparkBurst = ({
  active,
  count = 6,
  radius = 30,
  angleOffset = 0,
  duration = .6,
  className,
  style,
}) => {
  const radiusFor = typeof radius === "function" ? radius : () => radius;

  return (
    <AnimatePresence>
      {
        active && (
          <motion.span
            className={ `spark-burst ${ className || "" }` }
            style={ style }
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {
              Array.from({ length: count }).map((_, i) => {
                const angle = (Math.PI * 2 * i) / count + angleOffset;
                const distance = radiusFor(i);
                const facing = (angle * 180) / Math.PI;

                return (
                  <motion.span
                    key={ i }
                    className="spark-dot"
                    style={{ rotate: facing }}
                    initial={{ x: 0, y: 0, scaleX: .3, scaleY: .3, opacity: 1 }}
                    animate={{
                      x: Math.cos(angle) * distance,
                      y: Math.sin(angle) * distance,
                      scaleX: [.3, 2.2, .6, 0],
                      scaleY: [.3, .7, .9, 0],
                      opacity: [1, 1, 1, 0],
                    }}
                    transition={{ duration, ease: "easeOut" }}
                  />
                );
              })
            }
          </motion.span>
        )
      }
    </AnimatePresence>
  );
};

export default SparkBurst;
