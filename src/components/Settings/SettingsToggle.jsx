import { useEffect, useRef } from "react";
import anime from "animejs";

// Track width 44px, thumb 20px, 3px inset on each side — 44 - 20 - 6 = 18px
// of travel.
const THUMB_TRAVEL = 18;

// The track's own on/off color is a plain CSS transition (matching every
// other toggle-ish control in this app); the thumb's slide is the one
// piece animated here, via anime.js rather than framer — this app's first
// use of anime.js on a genuine switch interaction rather than a number
// (see useOdometer.js) or a physics-driven drag.
const SettingsToggle = ({ checked, onChange, label, disabled = false }) => {
  const thumbRef = useRef(null);

  useEffect(() => {
    if (!thumbRef.current) return;

    anime({
      targets: thumbRef.current,
      translateX: checked ? THUMB_TRAVEL : 0,
      duration: 500,
      easing: "easeOutElastic(1, .6)",
    });
  }, [checked]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={ checked }
      aria-label={ label }
      disabled={ disabled }
      className={ `settings-toggle ${ checked ? "checked" : "" }` }
      onClick={ onChange }
    >
      <span ref={ thumbRef } className="settings-toggle-thumb" />
    </button>
  );
};

export default SettingsToggle;
