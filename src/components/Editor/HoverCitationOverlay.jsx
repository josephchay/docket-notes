import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import { findPrecedingSpan } from "../../utils/citations";

import "./HoverCitationOverlay.css";

// A real hover affordance over a NATIVE <textarea> — something this app's
// plain-text architecture has no built-in way to do at all, since a
// textarea's own rendered value isn't part of the accessible DOM (no node
// per character range for an ordinary :hover/mouseenter to ever land on).
// The standard workaround: an invisible mirror of the same text sits
// exactly behind the real textarea (same font/size/line-height/padding,
// kept in scroll-lockstep with it via a translateY tied to the textarea's
// own scrollTop), with every span this note's own citations are "attached
// to" (see findPrecedingSpan, shared with NoteEditor's own selection-offer
// classification so the two features can never disagree about where a
// citation's own prose begins and ends) wrapped in a hit-testable <mark>.
// The real textarea stays on top (see textarea.note-editor-text's own
// z-index in NoteEditor.css) for actual typing/selecting exactly as it
// always has — a <mark> only has pointer-events: auto because that's what
// lets the deliberate peek below actually FIND it, and if it ever sat
// above the textarea in paint order (it doesn't, but it would without
// that z-index) it would silently swallow every real click/drag landing
// on its span instead of letting them through to the field underneath.
// Hover DETECTION is driven from outside: NoteEditor wires the real
// textarea's own onMouseMove/onMouseLeave to handleMouseMove/clearHover
// below (exposed via ref, since the textarea — not this overlay — is
// what actually receives the pointer now), which briefly disables the
// textarea's own pointer-events during each mousemove's own
// elementFromPoint hit-test, then restores them in the same synchronous
// call — invisible to the user, but it's what lets the hit-test see past
// the (otherwise fully opaque to events) textarea to whichever mark sits
// behind that exact pixel. That peek is rAF-throttled (not run on every
// raw mousemove) and skipped outright while a mouse button is held —
// mid-drag the user is selecting text, not inspecting a citation, and the
// forced-synchronous-layout cost of elementFromPoint has no business
// running on every pixel of a text-selection drag. The tooltip itself is
// portaled to document.body (mirroring the copyGhost pattern elsewhere in
// NoteEditor.jsx) since it's `position: fixed` against the viewport, and
// this component normally renders nested inside NoteEditor's own jelly-
// wobble/enter-exit-spring wrappers — any non-none transform on an
// ancestor becomes the containing block for a fixed descendant, which
// would otherwise misposition the tooltip during those animations.
const HOVER_DELAY = 150;

const HoverCitationOverlay = forwardRef(({ text, citations, textareaRef }, ref) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [hover, setHover] = useState(null); // null | { label, x, y }
  const hoveredIndexRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const rafRef = useRef(null);
  const pendingEventRef = useRef(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // A scroll invalidates whatever the tooltip was last labeling — the
    // mouse hasn't moved, but the text underneath it has, so the safe,
    // simple move (matching the same "clear rather than guess" discipline
    // pendingSelection's and the preview card's own staleness guards use
    // in NoteEditor.jsx) is to drop it rather than try to reposition it
    // against content the mouse was never actually still over.
    const handleScroll = () => { setScrollTop(ta.scrollTop); clearHover(); };
    ta.addEventListener("scroll", handleScroll);
    return () => ta.removeEventListener("scroll", handleScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textareaRef]);

  // A pending reveal-delay timer must not outlive this component — since
  // it unmounts by a plain conditional-render swap (checklist/study mode,
  // see NoteEditor.jsx's own ternary) rather than any prop this component
  // could react to first, only an unmount cleanup actually catches it.
  useEffect(() => () => {
    clearTimeout(hoverTimerRef.current);
    cancelAnimationFrame(rafRef.current);
  }, []);

  // Every distinct span this note's citations are attached to, merged
  // where two or more citations (e.g. two pieces of the same group) share
  // or overlap the same preceding clause, so it's marked once, not doubled.
  // Walks EVERY occurrence of each citation, not just the deduped first
  // one (see citations.js's occurrences) — a reference cited twice has two
  // different clauses attached to it, and marking only the first would
  // leave the second, visually identical "clause (Book c:v)" span
  // inexplicably hover-dead. findPrecedingSpan only ever reads `.start`,
  // which an occurrence carries the same as a whole citation does.
  const spans = useMemo(() => {
    const raw = citations
      .flatMap((citation) => citation.occurrences.map(
        (occurrence) => ({ ...findPrecedingSpan(text, occurrence), full: citation.full })
      ))
      .filter((s) => s.end > s.start)
      .sort((a, b) => a.start - b.start);

    const merged = [];
    for (const s of raw) {
      const last = merged[merged.length - 1];
      if (last && s.start <= last.end) {
        last.end = Math.max(last.end, s.end);
        if (!last.fulls.includes(s.full)) last.fulls.push(s.full);
      } else {
        merged.push({ start: s.start, end: s.end, fulls: [s.full] });
      }
    }
    return merged;
  }, [text, citations]);

  const nodes = useMemo(() => {
    const out = [];
    let cursor = 0;
    spans.forEach((span, i) => {
      if (span.start > cursor) out.push(<span key={ `t${ i }` }>{ text.slice(cursor, span.start) }</span>);
      out.push(
        <mark key={ `m${ i }` } className="hover-citation-mark" data-index={ i }>
          { text.slice(span.start, span.end) }
        </mark>
      );
      cursor = span.end;
    });
    if (cursor < text.length) out.push(<span key="tail">{ text.slice(cursor) }</span>);
    return out;
  }, [text, spans]);

  const clearHover = () => {
    clearTimeout(hoverTimerRef.current);
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    pendingEventRef.current = null;
    hoveredIndexRef.current = null;
    setHover(null);
  };

  // The actual peek, run at most once per animation frame (see
  // handleMouseMove below) rather than once per raw mousemove — reads the
  // latest stored pointer position from pendingEventRef instead of taking
  // an event directly, since a raw browser mousemove can fire many times
  // faster than the display refreshes.
  const processPointer = () => {
    rafRef.current = null;
    const pending = pendingEventRef.current;
    if (!pending) return;

    // Mid-drag (selecting text), not hovering to inspect — a tooltip would
    // just fight the selection, and there's no reason to spend the
    // elementFromPoint peek's forced-layout cost on every pixel of a drag.
    if (pending.buttons === 1) {
      if (hoveredIndexRef.current !== null) clearHover();
      return;
    }

    // No citations at all (this note's last one was just deleted/undone
    // while a tooltip was showing) — clear rather than silently bail, so
    // a stale label doesn't ride along with the cursor with nothing left
    // to actually label.
    if (spans.length === 0) {
      if (hoveredIndexRef.current !== null) clearHover();
      return;
    }

    const ta = textareaRef.current;
    if (!ta) return;

    const prevPointerEvents = ta.style.pointerEvents;
    ta.style.pointerEvents = "none";
    const el = document.elementFromPoint(pending.x, pending.y);
    ta.style.pointerEvents = prevPointerEvents;

    const mark = el?.closest?.(".hover-citation-mark");
    const index = mark ? Number(mark.dataset.index) : null;

    if (index === hoveredIndexRef.current) {
      // Still hovering the SAME mark (or still hovering nothing) — no need
      // to restart the reveal delay, but the label is re-read fresh every
      // time regardless (cheap — an array index + join), since the note's
      // own text (and thus this span's citation) can change while the
      // mouse sits still over the exact same mark index.
      if (index !== null) {
        const label = spans[index].fulls.join(", ");
        setHover((prev) => (prev ? { ...prev, label, x: pending.x, y: pending.y } : prev));
      }
      return;
    }

    hoveredIndexRef.current = index;
    clearTimeout(hoverTimerRef.current);

    if (index === null) {
      setHover(null);
      return;
    }

    const label = spans[index].fulls.join(", ");
    const x = pending.x;
    const y = pending.y;
    // A small delay before showing the tooltip — a mouse merely passing
    // through on its way somewhere else shouldn't flash a label; only a
    // moment's pause over the same marked span earns one.
    hoverTimerRef.current = setTimeout(() => setHover({ label, x, y }), HOVER_DELAY);
  };

  const handleMouseMove = (e) => {
    pendingEventRef.current = { x: e.clientX, y: e.clientY, buttons: e.buttons };
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(processPointer);
  };

  // The textarea, not this overlay, is what actually sits on top and
  // receives real pointer events now — so it's the one NoteEditor wires
  // these to, reaching back into this component's own state/closures.
  useImperativeHandle(ref, () => ({ handleMouseMove, clearHover }));

  return (
    <>
      <div className="hover-citation-hit-layer">
        <div
          className="hover-citation-backdrop note-editor-text"
          style={{ transform: `translateY(${ -scrollTop }px)` }}
          aria-hidden="true"
        >
          { nodes }
        </div>
      </div>
      {
        // Portaled to document.body — this component normally renders
        // nested inside NoteEditor's own jelly-wobble and enter/exit-spring
        // wrappers, both of which carry a real (non-none) Framer Motion
        // transform. A `position: fixed` descendant of a transformed
        // ancestor resolves its own position against THAT ancestor, not
        // the viewport, which would misplace this tooltip away from the
        // cursor during those animations — the exact reason copyGhost a
        // little further down in NoteEditor.jsx is portaled the same way.
        createPortal(
          <AnimatePresence>
            {
              hover && (
                <motion.div
                  className="hover-citation-tooltip"
                  style={{ left: hover.x, top: hover.y }}
                  initial={{ opacity: 0, scale: .85, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: .85, y: 4, transition: { duration: .12 } }}
                  transition={{ type: "spring", stiffness: 460, damping: 24 }}
                >
                  belongs to { hover.label }
                </motion.div>
              )
            }
          </AnimatePresence>,
          document.body,
        )
      }
    </>
  );
});

HoverCitationOverlay.displayName = "HoverCitationOverlay";

export default HoverCitationOverlay;
