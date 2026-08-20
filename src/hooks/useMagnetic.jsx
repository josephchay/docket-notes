import { useRef } from "react";
import gsap from "gsap";

// The magnetic-dock recipe QuickDock.jsx pioneered, generalized so any row of
// icons can borrow it: every item feels the pointer's distance continuously
// (not just its own hover), rising and swelling more the closer it gets, via
// GSAP quickTo tweens on each item's own inner wrapper — kept separate from
// whatever outer button drives its own tap bounce so the two never fight over
// the same transform. Leaving the row springs every item back at once with a
// shared elastic release. `reduceMotion` is opt-in per caller (default off)
// rather than read internally via matchMedia, since every current consumer
// (Header.jsx's toolbar, QuickDock.jsx) already threads the app's own
// reduceMotion prop down anyway — one shared source of truth instead of a
// second, independent check.
const useMagnetic = ({
  range = 96, maxLift = 16, maxScale = 1.55, axis = "x", reduceMotion = false,
  // Opt-in — a plank-like rotateZ layered on top of the existing lift/
  // scale response, signed by which side of an item's own center the
  // pointer currently sits. Off by default so the hook's other caller
  // (Header's toolbar) renders exactly as it always has; QuickDock is the
  // first to turn it on.
  tilt = false, maxTilt = 8,
} = {}) => {
  const itemRefs = useRef([]);
  const quickTweens = useRef([]);

  // The pointer's own real exit velocity (see handleLeave below) — a couple
  // of recent samples is enough for a usable px/ms estimate without the
  // cost of keeping a longer history like the throw-projection ones
  // (ColorSelector.jsx's own drag samples) bother with, since this only
  // ever needs "how fast was it moving just now," not a whole gesture.
  const lastSampleRef = useRef(null);
  const velocityRef = useRef({ vx: 0, vy: 0 });

  // Handed to an element's `ref` prop as `registerItem(index)`.
  const registerItem = (index) => (el) => {
    itemRefs.current[index] = el;
  };

  const ensureTween = (index) => {
    if (!quickTweens.current[index] && itemRefs.current[index]) {
      quickTweens.current[index] = {
        scale: gsap.quickTo(itemRefs.current[index], "scale", { duration: .35, ease: "power3.out" }),
        y: gsap.quickTo(itemRefs.current[index], "y", { duration: .35, ease: "power3.out" }),
        ...(tilt ? { rotateZ: gsap.quickTo(itemRefs.current[index], "rotateZ", { duration: .35, ease: "power3.out" }) } : {}),
      };
    }
    return quickTweens.current[index];
  };

  const handleMove = (e) => {
    if (reduceMotion) return;

    const now = performance.now();
    const last = lastSampleRef.current;
    if (last) {
      const dt = now - last.t;
      if (dt > 0) {
        velocityRef.current = {
          vx: (e.clientX - last.x) / dt,
          vy: (e.clientY - last.y) / dt,
        };
      }
    }
    lastSampleRef.current = { x: e.clientX, y: e.clientY, t: now };

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
      if (tween.rotateZ) {
        // Continuous signed offset (not axis's own already-absolute
        // `distance`) — which side of THIS item's center the pointer sits
        // on, clamped to ±1 across `range`, same falloff as the lift/scale
        // above so the tilt eases out right alongside them.
        const dxNorm = Math.max(-1, Math.min(1, (e.clientX - centerX) / range));
        tween.rotateZ(dxNorm * maxTilt * eased);
      }
    });
  };

  const handleLeave = () => {
    // How hard the pointer was actually moving the instant it left — a
    // real exit velocity, read straight off the last couple of handleMove
    // samples, rather than every release playing the exact same fixed
    // snap-back regardless of whether the hand whipped past or drifted
    // off. At zero velocity this reduces to exactly the original release
    // (amplitude 1, no kick) — a pointer that was already still leaves the
    // row exactly as it did before this existed.
    const { vx, vy } = velocityRef.current;
    const speed = Math.min(Math.hypot(vx, vy), 3); // px/ms, clamped — a flick, not a teleport
    const amplitude = (1 + Math.min(speed / 1.2, 1.3)).toFixed(2);
    const dirX = axis === "y" ? 0 : Math.sign(vx) || 0;
    const kick = Math.min(speed * 5, 14);

    itemRefs.current.forEach((el, index) => {
      if (!el) return;
      quickTweens.current[index] = null;

      const timeline = gsap.timeline();
      // A fast exit keeps carrying the row a touch further along the
      // pointer's own direction before the spring reels it back — the
      // same "continues past release" read ColorSelector's own flick-throw
      // gives a poured note, applied here to the whole row's snap instead.
      if (kick > 1) timeline.to(el, { x: dirX * kick, duration: .07, ease: "power1.out" });
      timeline.to(el, { x: 0, scale: 1, y: 0, ...(tilt ? { rotateZ: 0 } : {}), duration: .6, ease: `elastic.out(${ amplitude}, 0.45)` });
    });

    lastSampleRef.current = null;
    velocityRef.current = { vx: 0, vy: 0 };
  };

  return { registerItem, handleMove, handleLeave };
};

export default useMagnetic;
