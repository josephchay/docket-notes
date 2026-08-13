import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import { NOTE_COLORS } from "../../constants/colors";
import { catenaryPath } from "../../utils/catenary";

import "./BulkTethers.css";

// Slacker than TagThreads' own K (1.28) — a thread hanging all the way
// down to a fixed bar at the bottom of the viewport reads better with more
// give than the short hop between two neighboring notes.
const TETHER_K = 1.15;
const TETHER_SAMPLES = 14;
const MAX_SAG = 120;

const tetherPath = (x1, y1, x2, y2, t, index) => {
  const wobble = t === 0 ? 1 : 1 + Math.sin(t * 1.3 + index * 2.1) * 0.05;
  return catenaryPath(x1, y1, x2, y2, { k: TETHER_K, samples: TETHER_SAMPLES, maxSag: MAX_SAG, wobble });
};

// Every currently-selected note hangs a real catenary thread down to the
// bulk action bar — the same rope-hang math TagThreads.jsx already uses for
// its own tag capillaries (utils/catenary.js), so a selection visibly reads
// as roped to the bar about to act on it, not just marked with a badge.
// Portaled to document.body and drawn in raw viewport coordinates (unlike
// TagThreads, which draws container-relative): the bar is `position:
// fixed`, so a container-relative endpoint on one side and a viewport-fixed
// one on the other would drift apart the moment the desk scrolls.
const BulkTethers = ({ notes, selectedIds, containerRef, reduceMotion }) => {
  const [pairs, setPairs] = useState([]);
  const pathRefs = useRef({});
  const rafRef = useRef(0);

  const selectedKey = useMemo(() => [...(selectedIds || [])].sort().join(","), [selectedIds]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !selectedIds || selectedIds.size === 0) {
      setPairs([]);
      return undefined;
    }

    const compute = () => {
      // Queried by class rather than a threaded ref — the bar is a sibling
      // of this whole tree (rendered from Home.jsx, this from NoteList.jsx),
      // and its own class name is already a stable, addressable handle the
      // same way TagThreads reads note rects via [data-note-id] instead of
      // a ref per note.
      const barEl = document.querySelector(".bulk-bar");
      if (!barEl) { setPairs([]); return; }

      const barRect = barEl.getBoundingClientRect();
      const bx = barRect.left + barRect.width / 2;
      const by = barRect.top;

      const next = [];
      selectedIds.forEach((id) => {
        const note = notes.find((n) => n.id === id);
        const el = container.querySelector(`[data-note-id="${ id }"]`);
        if (!note || !el) return;

        const rect = el.getBoundingClientRect();
        next.push({
          id,
          color: note.color,
          x1: rect.left + rect.width / 2,
          y1: rect.top + rect.height / 2,
          x2: bx,
          y2: by,
        });
      });

      setPairs(next);
    };

    compute();

    // Scroll doesn't bubble, but a capture-phase listener on the document
    // still sees it fire on whichever ancestor actually scrolls (.home) —
    // same reasoning as TagThreads' own listener.
    document.addEventListener("scroll", compute, { capture: true, passive: true });
    window.addEventListener("resize", compute);

    let settleTimer = null;
    const mutationObserver = new MutationObserver(() => {
      compute();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(compute, 400);
    });
    mutationObserver.observe(container, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("scroll", compute, { capture: true });
      window.removeEventListener("resize", compute);
      mutationObserver.disconnect();
      clearTimeout(settleTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, containerRef]);

  // The same idle sway TagThreads drives its own threads with — direct
  // attribute writes on a raw ref rather than React state, so it costs
  // nothing while nothing is selected and never re-renders 60 times a
  // second while it is.
  useEffect(() => {
    if (reduceMotion || pairs.length === 0) return undefined;

    const start = performance.now();
    const tick = (now) => {
      const t = (now - start) / 1000;
      pairs.forEach((pair, index) => {
        const el = pathRefs.current[pair.id];
        if (el) el.setAttribute("d", tetherPath(pair.x1, pair.y1, pair.x2, pair.y2, t, index));
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [pairs, reduceMotion]);

  if (pairs.length === 0) return null;

  return createPortal(
    <svg className="bulk-tethers-layer" aria-hidden="true">
      <AnimatePresence>
        {
          pairs.map((pair, index) => (
            <motion.g
              key={ pair.id }
              className="bulk-tether"
              style={{ filter: "url(#gooey-effect)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: .85 }}
              exit={{ opacity: 0, transition: { duration: .18 } }}
            >
              <motion.path
                ref={ (el) => {
                  if (el) pathRefs.current[pair.id] = el;
                  else delete pathRefs.current[pair.id];
                } }
                className="bulk-tether-line"
                d={ tetherPath(pair.x1, pair.y1, pair.x2, pair.y2, 0, index) }
                stroke={ NOTE_COLORS[pair.color] || "var(--page-ink-color)" }
                initial={{ pathLength: reduceMotion ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ type: "spring", stiffness: 140, damping: 18, delay: index * .03 }}
              />
              <circle className="bulk-tether-node" cx={ pair.x1 } cy={ pair.y1 } r="4" fill={ NOTE_COLORS[pair.color] } />
            </motion.g>
          ))
        }
      </AnimatePresence>
    </svg>,
    document.body,
  );
};

export default BulkTethers;
