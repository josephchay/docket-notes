import React, { useRef } from 'react';
import anime from "animejs";

// One ink pot on the nav rail. Under the gooey filter a hovered pot bulges
// elastically and melts into its neighbours; pressing squashes it before it
// springs back. The bulge stands down while the open/close timeline is
// running (the activator is disabled for exactly that window), so the two
// never fight over the element.
const ColorSelector = ({
  className,
  color,
  dataFrom,
  dataTo,
  addNote,
}) => {
  const ref = useRef(null);

  const bulge = (scale) => {
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
      } }
    ></div>
  );
}

export default ColorSelector;
