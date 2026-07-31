import { useEffect, useRef, useState } from "react";
import anime from "animejs";

// Ticks a displayed number toward `value` via anime.js's own numeric
// tweening — targeting a plain object's field rather than a DOM node,
// which is the idiomatic way anime.js drives an arbitrary value that isn't
// itself a CSS/SVG property. The header's edit count and the diff chips'
// +/- figures all read this instead of the raw prop, so a jump of several
// steps at once (a scrub, a branch restore) rolls through the numbers in
// between rather than snapping straight to the new one.
const useOdometer = (value) => {
  const [display, setDisplay] = useState(value);
  const objRef = useRef({ val: value });

  useEffect(() => {
    const obj = objRef.current;

    const animation = anime({
      targets: obj,
      val: value,
      duration: 500,
      easing: "easeOutElastic(1, .7)",
      round: 1,
      update: () => setDisplay(Math.round(obj.val)),
    });

    return () => animation.pause();
  }, [value]);

  return display;
};

export default useOdometer;
