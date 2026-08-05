import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { NOTE_COLORS } from "../../constants/colors";
import { smoothPath } from "../../utils/svgPath";

import "./TagThreads.css";

// Which pairs of currently-visible notes should be threaded together: every
// other note sharing at least one tag with whichever note is hovered.
const relate = (notes, hoveredId) => {
  const hovered = notes.find((note) => note.id === hoveredId);
  if (!hovered?.tags?.length) return { hovered: null, related: [] };

  const related = notes.filter((note) => note.id !== hoveredId && note.tags?.some((tag) => hovered.tags.includes(tag)));
  return { hovered, related };
};

// How taut the ink reads as it hangs — bigger K sags the thread harder per
// unit span, the same way a real chain's own weight (relative to how hard
// its ends are pulled apart) decides how sharply it droops. This isn't a
// tuning knob dressed up as physics — it's the actual catenary parameter
// (y = a·cosh(x/a), the exact curve a rope hangs in under its own weight,
// derived from a real force balance along the rope — not the parabola a
// uniformly-loaded suspension cable settles into, which is what a plain
// quadratic bezier was quietly approximating before). Solving for the
// catenary's "a" from a target span *and* a target sag has no closed form
// short of an iterative root-find; going the other way — picking `a`
// directly as a fraction of the span and letting the sag fall out of the
// formula — sidesteps that iteration entirely, at the cost of only being
// able to name the sag indirectly (via K) rather than in pixels.
const CATENARY_K = 1.28;
const CATENARY_SAMPLES = 12;
const MAX_SAG = 70;

// Two note centers, connected by that real catenary curve rather than one
// bezier control point — worked out in a local frame where the chord
// between them is horizontal (so both ends sit at the same height, the one
// case the plain y = a·cosh(x/a) formula actually solves), then rotated
// back into screen space. The idle "breathing" rides `a` itself (the
// thread's own apparent taughtness pulses a few percent) rather than
// perturbing a single point, so the whole curve pulses coherently instead
// of one corner wobbling on its own.
const threadPath = ({ x1, y1, x2, y2 }, t, index) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);

  // Overlapping/near-overlapping centers have no meaningful chord to build
  // a local frame from — a plain line covers that instant without risking
  // a division by (near) zero in the catenary math below.
  if (dist < 1) return `M ${ x1 } ${ y1 } L ${ x2 } ${ y2 }`;

  const theta = Math.atan2(dy, dx);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const wobble = t === 0 ? 1 : 1 + Math.sin(t * 1.6 + index * 1.7) * 0.06;
  const a = (dist / CATENARY_K) * wobble;
  const half = dist / 2;
  const coshHalf = Math.cosh(half / a);

  // A hard cap on the midpoint sag, same spirit as the old Math.min(46, …)
  // — scaling the whole curve down rather than clamping it flat keeps the
  // catenary's actual shape (steep near center, flattening toward the
  // ends) intact even when a very long span would otherwise droop further
  // than reads well on the desk.
  const naturalSag = a * (coshHalf - 1);
  const sagScale = naturalSag > MAX_SAG ? MAX_SAG / naturalSag : 1;

  const points = [];
  for (let i = 0; i <= CATENARY_SAMPLES; i++) {
    const localX = (i / CATENARY_SAMPLES) * dist;
    const localY = (a * coshHalf - a * Math.cosh((localX - half) / a)) * sagScale;

    points.push({
      x: x1 + localX * cosT - localY * sinT,
      y: y1 + localX * sinT + localY * cosT,
    });
  }

  return smoothPath(points);
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

    // Adding, deleting, or sorting notes reflows the grid via each Note's
    // own `layout` prop (Note.jsx) — a position change that fires neither
    // scroll nor resize. That reflow is reachable mid-hover (the nav's add
    // button sits outside the grid, so the pointer never has to leave the
    // hovered note), so without this a thread stays glued to pre-reflow
    // coordinates for the rest of the hover. A MutationObserver catches the
    // DOM change that kicks the reflow off; the trailing recompute catches
    // where notes land once Note's own layout spring settles.
    let settleTimer = null;
    const mutationObserver = new MutationObserver(() => {
      compute();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(compute, 400);
    });
    mutationObserver.observe(containerRef.current, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("scroll", compute, { capture: true });
      window.removeEventListener("resize", compute);
      mutationObserver.disconnect();
      clearTimeout(settleTimer);
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
