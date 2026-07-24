import React from "react";
import { AnimatePresence, motion } from "framer-motion";

import "./ActionStamp.css";

// A quick ink stamp confirming an export or import actually happened —
// pressed down onto the page with a bit of overshoot, like a rubber stamp
// that bounced on landing, then lifted away again a couple of seconds later.
const ActionStamp = ({ stamp }) => (
  <div className="action-stamp-slot">
    <AnimatePresence>
      {
        stamp && (
          <motion.div
            key={ stamp.key }
            className="action-stamp"
            initial={{ opacity: 0, scale: 2.2, rotate: -6 }}
            animate={{ opacity: 1, scale: [2.2, .9, 1.05, 1], rotate: 0 }}
            exit={{
              opacity: 0,
              scale: .85,
              translateY: -8,
              transition: { duration: .22, ease: "easeIn" },
            }}
            transition={{ duration: .5, times: [0, .55, .8, 1], ease: "easeOut" }}
          >
            { stamp.text }
          </motion.div>
        )
      }
    </AnimatePresence>
  </div>
);

export default ActionStamp;
