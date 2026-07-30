import { useRef } from "react";
import gsap from "gsap";

// The magnetic-dock recipe QuickDock.jsx pioneered, generalized so any row of
// icons can borrow it: every item feels the pointer's distance continuously
// (not just its own hover), rising and swelling more the closer it gets, via
// GSAP quickTo tweens on each item's own inner wrapper — kept separate from
// whatever outer button drives its own tap bounce so the two never fight over
// the same transform. Leaving the row springs every item back at once with a
// shared elastic release.
const useMagnetic = ({ range = 96, maxLift = 16, maxScale = 1.55, axis = "x" } = {}) => {
  const itemRefs = useRef([]);
  const quickTweens = useRef([]);

  // Handed to an element's `ref` prop as `registerItem(index)`.
  const registerItem = (index) => (el) => {
    itemRefs.current[index] = el;
  };

  const ensureTween = (index) => {
    if (!quickTweens.current[index] && itemRefs.current[index]) {
      quickTweens.current[index] = {
        scale: gsap.quickTo(itemRefs.current[index], "scale", { duration: .35, ease: "power3.out" }),
        y: gsap.quickTo(itemRefs.current[index], "y", { duration: .35, ease: "power3.out" }),
      };
    }
    return quickTweens.current[index];
  };

  const handleMove = (e) => {
    itemRefs.current.forEach((el, index) => {
      if (!el) return;

      const itemRect = el.getBoundingClientRect();
      const centerX = itemRect.left + itemRect.width / 2;
      const centerY = itemRect.top + itemRect.height / 2;

      // "xy" for rows that can wrap onto more than one line (Header's
      // toolbar) — an x-only distance would otherwise still tug at icons
      // sitting directly above/below the pointer on a different line.
      const distance = axis === "xy"
        ? Math.hypot(e.clientX - centerX, e.clientY - centerY)
        : axis === "x"
          ? Math.abs(e.clientX - centerX)
          : Math.abs(e.clientY - centerY);
      const falloff = Math.max(0, 1 - distance / range);
      const eased = falloff * falloff * (3 - 2 * falloff); // smoothstep — a rounder peak than a linear falloff

      const tween = ensureTween(index);
      if (!tween) return;
      tween.scale(1 + (maxScale - 1) * eased);
      tween.y(-maxLift * eased);
    });
  };

  const handleLeave = () => {
    itemRefs.current.forEach((el, index) => {
      if (!el) return;
      quickTweens.current[index] = null;
      gsap.to(el, { scale: 1, y: 0, duration: .6, ease: "elastic.out(1, 0.45)" });
    });
  };

  return { registerItem, handleMove, handleLeave };
};

export default useMagnetic;
