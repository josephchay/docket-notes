import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { NOTE_COLORS } from "../../constants/colors";

import "./TagThreads.css";

// Which pairs of currently-visible notes should be threaded together: every
// other note sharing at least one tag with whichever note is hovered.
const relate = (notes, hoveredId) => {
  const hovered = notes.find((note) => note.id === hoveredId);
  if (!hovered?.tags?.length) return { hovered: null, related: [] };

  const related = notes.filter((note) => note.id !== hoveredId && note.tags?.some((tag) => hovered.tags.includes(tag)));
  return { hovered, related };
};

// A quadratic bezier between two note centers, sagging downward like a wet
// ink thread; a small sine wobble on the control point keeps it breathing
// gently rather than sitting perfectly still for the length of a hover.
const threadPath = ({ x1, y1, x2, y2 }, t, index) => {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const sag = Math.min(46, dist * .16);
  const wobble = t === 0 ? 0 : Math.sin(t * 1.6 + index * 1.7) * Math.min(6, dist * .02);

  return `M ${ x1 } ${ y1 } Q ${ mx } ${ my + sag + wobble } ${ x2 } ${ y2 }`;
};

// The gooey ink capillaries that bloom between a hovered note and every
// other visible note sharing a tag — the same shared gooey-merge filter
// every other blob in the app already reuses (see Svg/GooeyEffectSvg,
// mounted once near the top of Home's tree), so each thread visually melts
// into a small drop at both ends rather than just terminating in a bare line.
const TagThreads = ({ notes, hoveredId, containerRef, reduceMotion }) => {
  const { hovered, related } = useMemo(() => relate(notes, hoveredId), [notes, hoveredId]);
  const relatedKey = related.map((note) => note.id).join(",");

  const [pairs, setPairs] = useState([]);
  const pathRefs = useRef({});
  const rafRef = useRef(0);

  // Rects are read straight off the DOM (the same [data-note-id] lookup the
  // rest of the desk already relies on for click/drag hit-testing) rather
  // than threading a ref through every Note, and recomputed on resize or
  // scroll for as long as a hover is actually live.
  useEffect(() => {
    if (!hovered || !containerRef.current) {
      setPairs([]);
      return;
    }

    const compute = () => {
      const container = containerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const hoveredEl = container.querySelector(`[data-note-id="${ hovered.id }"]`);
      if (!hoveredEl) { setPairs([]); return; }

      const hoveredRect = hoveredEl.getBoundingClientRect();
      const hx = hoveredRect.left + hoveredRect.width / 2 - containerRect.left;
      const hy = hoveredRect.top + hoveredRect.height / 2 - containerRect.top;

      const next = related.reduce((acc, note) => {
        const el = container.querySelector(`[data-note-id="${ note.id }"]`);
        if (!el) return acc;

        const rect = el.getBoundingClientRect();
        acc.push({
          id: note.id,
          color: note.color,
          x1: hx,
          y1: hy,
          x2: rect.left + rect.width / 2 - containerRect.left,
          y2: rect.top + rect.height / 2 - containerRect.top,
        });
        return acc;
      }, []);

      setPairs(next);
    };

    compute();

    // Scroll doesn't bubble, but a capture-phase listener on the document
    // still sees it fire on whichever ancestor actually scrolls (.home).
    document.addEventListener("scroll", compute, { capture: true, passive: true });
    window.addEventListener("resize", compute);
    return () => {
      document.removeEventListener("scroll", compute, { capture: true });
      window.removeEventListener("resize", compute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered?.id, relatedKey]);

  // A light idle wobble on each thread's sag while it's showing — driven by
  // direct attribute writes (the same imperative, no-React-state-per-frame
  // technique Trash/TrashPhysics uses for its own body sync) so it costs
  // nothing while nothing is hovered and never re-renders 60 times a second
  // while it is.
  useEffect(() => {
    if (reduceMotion || pairs.length === 0) return;

    const start = performance.now();

    const tick = (now) => {
      const t = (now - start) / 1000;

      pairs.forEach((pair, index) => {
        const el = pathRefs.current[pair.id];
        if (el) el.setAttribute("d", threadPath(pair, t, index));
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [pairs, reduceMotion]);

  return (
    <svg className="tag-threads" aria-hidden="true">
      <defs>
        {
          pairs.map((pair) => (
            <linearGradient
              key={ `grad-${ pair.id }` }
              id={ `tagThreadGradient-${ pair.id }` }
              x1={ pair.x1 } y1={ pair.y1 } x2={ pair.x2 } y2={ pair.y2 }
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor={ NOTE_COLORS[hovered?.color] || "var(--page-ink-color)" } />
              <stop offset="100%" stopColor={ NOTE_COLORS[pair.color] || "var(--page-ink-color)" } />
            </linearGradient>
          ))
        }
      </defs>
      <AnimatePresence>
        {
          pairs.map((pair, index) => (
            <motion.g
              key={ pair.id }
              className="tag-thread"
              style={{ filter: "url(#gooey-effect)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .18 } }}
            >
              <motion.path
                ref={ (el) => {
                  if (el) pathRefs.current[pair.id] = el;
                  else delete pathRefs.current[pair.id];
                } }
                className="tag-thread-line"
                d={ threadPath(pair, 0, index) }
                stroke={ `url(#tagThreadGradient-${ pair.id })` }
                initial={{ pathLength: reduceMotion ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ type: "spring", stiffness: 140, damping: 18, delay: index * .03 }}
              />
              <circle className="tag-thread-node" cx={ pair.x1 } cy={ pair.y1 } r="5" fill={ NOTE_COLORS[hovered?.color] } />
              <circle className="tag-thread-node" cx={ pair.x2 } cy={ pair.y2 } r="5" fill={ NOTE_COLORS[pair.color] } />
            </motion.g>
          ))
        }
      </AnimatePresence>
    </svg>
  );
};

export default TagThreads;
