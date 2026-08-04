import React, { useRef } from 'react';
import anime from "animejs";

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

  return (
    <div
      ref={ ref }
      role="button"
      aria-label={ `Add a ${ color } note` }
      className={ className }
      data-from={ dataFrom }
      data-to={ dataTo }
      onMouseEnter={ () => bulge(1.3) }
      onMouseLeave={ () => bulge(1) }
      onMouseDown={ () => bulge(.85) }
      onMouseUp={ () => bulge(1.3) }
      onClick={ () => {
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
