import { useState, useRef, useEffect } from "react";
import { useTransform } from "framer-motion";

import PullRig from "./PullRig";
import { DRAG_SNAP } from "../Motion";

const HOVER_PADDING = 34;   // how far outside a card the pull still counts (px)

// The elastic "move" string. Stretch the tassel onto any other note in the
// list — it lights up as the swap target — and release to trade places with
// it, the grid gliding into the new order. Every note's position is cached
// once when the pull starts, so tracking the pointer costs no DOM reads and
// no re-renders mid-drag.
const MoveString = ({ anchorX, restY = 26, colorName, icon, noteId, pullX, pullY, onPullStart, onPullEnd, onMove }) => {
  const tabRef = useRef(null);
  const candidatesRef = useRef([]);
  const targetRef = useRef(null);

  const [armed, setArmed] = useState(false);
  const [burst, setBurst] = useState(false);

  // The rope: a quadratic curve from the note's edge to the dragged tassel,
  // sagging while slack and pulling taut the further it is stretched.
  const ropePath = useTransform([pullX, pullY], ([x, y]) => {
    const tx = anchorX + x;
    const ty = restY + y;
    const sag = Math.max(0, 20 - Math.hypot(x, y) * 0.16);
    const cx = (anchorX + tx) / 2;
    const cy = ty / 2 + sag;
    return `M ${anchorX} 0 Q ${cx} ${cy} ${tx} ${ty}`;
  });

  const stretch = useTransform([pullX, pullY], ([x, y]) => Math.hypot(x, y));
  const ropeWidth = useTransform(stretch, [0, 360], [6, 2], { clamp: true });
  const gripScale = useTransform(stretch, [0, 140, 420], [1, 1.2, 1.36], { clamp: true });
  const glowOpacity = useTransform(stretch, [40, 140], [0, 1], { clamp: true });

  const clearTarget = () => {
    targetRef.current?.el.classList.remove("swap-target");
    targetRef.current = null;
  };

  // Snapshot every other note's page-space bounds once per pull. The grid
  // never reflows mid-pull (the swap happens on release), so the cache stays
  // valid for the whole gesture.
  const handleStart = () => {
    const list = [];

    document.querySelectorAll("[data-note-id]").forEach((el) => {
      if (el.dataset.noteId === noteId) return;

      const rect = el.getBoundingClientRect();
      list.push({
        id: el.dataset.noteId,
        el,
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
        cx: rect.left + rect.width / 2 + window.scrollX,
        cy: rect.top + rect.height / 2 + window.scrollY,
      });
    });

    candidatesRef.current = list;
    onPullStart?.();
  };

  const handleDrag = (event, info) => {
    const { x, y } = info.point;

    // The card under the pointer; nearest centre wins where padded bounds
    // overlap, so the target never flickers between two notes.
    let next = null;
    let bestDistance = Infinity;

    for (const card of candidatesRef.current) {
      if (
        x < card.left - HOVER_PADDING || x > card.right + HOVER_PADDING ||
        y < card.top - HOVER_PADDING || y > card.bottom + HOVER_PADDING
      ) continue;

      const distance = Math.hypot(x - card.cx, y - card.cy);
      if (distance < bestDistance) {
        bestDistance = distance;
        next = card;
      }
    }

    if (next?.id === targetRef.current?.id) return;

    clearTarget();
    if (next) {
      next.el.classList.add("swap-target");
      targetRef.current = next;
    }

    setArmed(Boolean(next));
  };

  const handleEnd = () => {
    if (targetRef.current) {
      onMove(targetRef.current.id);
      setBurst(true);
      setTimeout(() => setBurst(false), 750);
    }

    clearTarget();
    candidatesRef.current = [];
    setArmed(false);
    onPullEnd?.();
  };

  // Stop the tassel's press from bubbling into the note's press handlers, so
  // pulling never starts the long-press delete or the note's tap-shrink.
  useEffect(() => {
    const node = tabRef.current;
    if (!node) return;

    const stop = (e) => e.stopPropagation();
    node.addEventListener("pointerdown", stop);

    return () => {
      node.removeEventListener("pointerdown", stop);
      clearTarget();
    };
  }, []);

  return (
    <PullRig
      anchorX={ anchorX }
      restY={ restY }
      colorName={ colorName }
      pullX={ pullX }
      pullY={ pullY }
      ropePath={ ropePath }
      ropeWidth={ ropeWidth }
      gripScale={ gripScale }
      glowOpacity={ glowOpacity }
      ready={ armed }
      hintText="Release to swap notes ⇄"
      tabRef={ tabRef }
      tabAriaLabel="Pull onto another note to swap places with it"
      tabClassName={ `pull-tab move ${ colorName }-bg ${ armed ? "ready" : "" }` }
      tabContent={ armed ? <span className="pull-grip-arrow">⇄</span> : icon }
      burst={ burst }
      dragProps={{
        drag: true,
        dragSnapToOrigin: true,
        dragMomentum: false,
        dragTransition: DRAG_SNAP,
        onDragStart: handleStart,
        onDrag: handleDrag,
        onDragEnd: handleEnd,
      }}
    />
  );
};

export default MoveString;
