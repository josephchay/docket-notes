import React, { useRef } from 'react';
import anime from "animejs";

const POUR_DRAG_THRESHOLD = 36; // px — how far a press has to travel before release counts as a real pour

// One ink pot on the nav rail. Under the gooey filter a hovered pot bulges
// elastically and melts into its neighbours; pressing squashes it before it
// springs back. The bulge stands down while the open/close timeline is
// running (the activator is disabled for exactly that window), so the two
// never fight over the element — and under reduced motion entirely, the
// same call Navigation.jsx's own magnetic icons already make, since this is
// the same class of continuous, hover-repeated elastic motion.
const ColorSelector = ({
  className,
  color,
  dataFrom,
  dataTo,
  addNote,
  reduceMotion,
  registerRef,
  onHoverStart,
  onHoverEnd,
}) => {
  const ref = useRef(null);

  const bulge = (scale) => {
    if (reduceMotion) return;

    const el = ref.current;
    if (!el) return;
    if (document.getElementById("navActivator")?.hasAttribute("disabled")) return;
    if (parseFloat(getComputedStyle(el).opacity) < .5) return;   // rail is closed

    anime.remove(el);
    anime({
      targets: el,
      scale,
      duration: 550,
      easing: "easeOutElastic(1, .45)",
    });
  }

  // The click itself only ever got the same plain hover-bulge every other
  // press on this pot does — nothing marked the one moment that actually
  // matters, an ink drop leaving it. This plays instead (mouseUp's own
  // bulge(1.3) still fires a beat earlier, but anime.remove below cancels
  // it clean rather than fighting it): a real give, dipping past its rest
  // scale as if the drop's weight just left, before an elastic rebound —
  // the same overshoot-settle character the note itself spawns with (see
  // Note.jsx's own squeeze/bloom/landing sequence), so the pot and the
  // note it just poured read as one continuous gesture, not two unrelated
  // animations that happen to fire at the same time.
  const pour = () => {
    if (reduceMotion) return;

    const el = ref.current;
    if (!el) return;

    anime.remove(el);
    anime({
      targets: el,
      scale: [1.3, .68, 1.18, .96, 1.06, 1],
      duration: 620,
      easing: "easeOutElastic(1, .5)",
    });
  }

  // Drag-to-pour — press and drag the pot itself out onto the desk,
  // releasing wherever the note should visually pour from, rather than
  // only ever clicking. Deliberately NOT Framer's own `drag` prop on this
  // same element: this div already has TWO independent anime.js-driven
  // transform channels living on it (the open/close timeline's own
  // resting translateY, driven by Navigation.jsx via a CSS-selector
  // target, and this file's own scale bulge/pour above) — adding a third,
  // Framer-managed one to the exact same node's own transform would mean
  // three different systems fighting over one CSS property, and Framer's
  // drag offset specifically would collide with the open/close timeline's
  // OWN use of translateY for the pot's resting column position, not just
  // visually jostle it. A separate, portaled "ghost" that follows the
  // pointer sidesteps all of that: the real pot's own transform is never
  // touched by any of this, so nothing here can conflict with what it's
  // already doing.
  const dragRef = useRef({ active: false, startX: 0, startY: 0 });
  const ghostRef = useRef(null);
  const suppressClickRef = useRef(false);

  const ensureGhost = () => {
    if (ghostRef.current) return ghostRef.current;
    const el = document.createElement("span");
    el.className = `nav-pot-ghost ${ color }-bg`;
    document.body.appendChild(el);
    ghostRef.current = el;
    return el;
  };

  const handlePointerDown = (e) => {
    if (reduceMotion) return;
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY };
    ref.current?.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.active) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    // Under this, it still reads as a stationary press (or the very start
    // of one) rather than a deliberate drag — no ghost yet, and critically
    // no suppressClickRef flip either, so a plain click still lands clean.
    if (Math.hypot(dx, dy) < 6) return;

    suppressClickRef.current = true;
    const ghost = ensureGhost();
    ghost.style.transition = "";
    ghost.style.opacity = "1";
    ghost.style.transform = `translate(${ e.clientX }px, ${ e.clientY }px) translate(-50%, -50%)`;
  };

  const handlePointerUp = (e) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    ref.current?.releasePointerCapture?.(e.pointerId);

    const dist = Math.hypot(e.clientX - dragRef.current.startX, e.clientY - dragRef.current.startY);
    if (ghostRef.current) {
      if (dist > POUR_DRAG_THRESHOLD) {
        addNote(color, { x: e.clientX, y: e.clientY });
        pour();
      }
      const ghost = ghostRef.current;
      ghostRef.current = null;
      ghost.style.transition = "opacity .25s ease-out, transform .25s ease-out";
      ghost.style.opacity = "0";
      ghost.style.transform += " scale(.4)";
      setTimeout(() => ghost.remove(), 260);
    }
  };

  return (
    <div
      ref={ (el) => { ref.current = el; registerRef?.(el); } }
      role="button"
      aria-label={ `Add a ${ color } note — drag it out to pour one wherever you release` }
      className={ className }
      data-from={ dataFrom }
      data-to={ dataTo }
      onMouseEnter={ () => { bulge(1.3); onHoverStart?.(); } }
      onMouseLeave={ () => { bulge(1); onHoverEnd?.(); } }
      onMouseDown={ () => bulge(.85) }
      onMouseUp={ () => bulge(1.3) }
      onPointerDown={ handlePointerDown }
      onPointerMove={ handlePointerMove }
      onPointerUp={ handlePointerUp }
      onClick={ () => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }

        // Tell the desk where this pot sits, so the new note can morph
        // right out of it.
        const rect = ref.current?.getBoundingClientRect();
        addNote(color, rect ? {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        } : undefined);
        pour();
      } }
    ></div>
  );
}

export default ColorSelector;
