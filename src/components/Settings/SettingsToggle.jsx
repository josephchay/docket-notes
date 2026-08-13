import { useEffect, useRef } from "react";
import anime from "animejs";

// Track width 44px, thumb 20px, 3px inset on each side — 44 - 20 - 6 = 18px
// of travel.
const THUMB_TRAVEL = 18;
const COMMIT_RATIO = .5; // how far across its own travel a drag has to cross before release commits the flip

// The track's own on/off color is a plain CSS transition (matching every
// other toggle-ish control in this app); the thumb's slide is animated via
// anime.js rather than framer — this app's first use of anime.js on a
// genuine switch interaction rather than a number (see useOdometer.js) or
// a physics-driven drag. The thumb is now also a real press-and-drag
// target, not just a click surface: dragging it live-tracks the pointer,
// stretching along its own direction of travel proportional to how fast
// it's actually moving (the same elastic-deformation read TrashPhysics'
// own chips squash on impact with), and only commits the flip if released
// past COMMIT_RATIO of its own travel — short of that, it springs back to
// wherever it already was.
const SettingsToggle = ({ checked, onChange, label, disabled = false }) => {
  const thumbRef = useRef(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const startXRef = useRef(0);
  const lastXRef = useRef(0);
  const lastTRef = useRef(0);

  // The shared settle every path here eventually lands on — commits from a
  // drag, snap-backs from a short drag, and a plain checked prop change
  // (click, keyboard, or another instance of this same preference changing
  // it) all resolve through this one call. scaleX/scaleY are included
  // every time (not just after a drag) so a plain click still relaxes any
  // stretch a previous drag left mid-flight, rather than only ever
  // resetting on the next drag's own first frame.
  const settleTo = (isChecked) => {
    if (!thumbRef.current) return;
    anime.remove(thumbRef.current);
    anime({
      targets: thumbRef.current,
      translateX: isChecked ? THUMB_TRAVEL : 0,
      scaleX: 1,
      scaleY: 1,
      duration: 500,
      easing: "easeOutElastic(1, .6)",
    });
  };

  useEffect(() => {
    settleTo(checked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  const handlePointerDown = (e) => {
    if (disabled) return;
    draggingRef.current = true;
    startXRef.current = e.clientX;
    lastXRef.current = e.clientX;
    lastTRef.current = performance.now();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    anime.remove(thumbRef.current);
  };

  const handlePointerMove = (e) => {
    if (!draggingRef.current || !thumbRef.current) return;

    const dx = e.clientX - startXRef.current;
    if (Math.abs(dx) > 3) suppressClickRef.current = true; // a real drag, not a stray click about to follow

    const base = checked ? THUMB_TRAVEL : 0;
    const x = Math.max(0, Math.min(THUMB_TRAVEL, base + dx));

    const now = performance.now();
    const dt = Math.max(1, now - lastTRef.current);
    const vx = (e.clientX - lastXRef.current) / dt; // px/ms
    lastXRef.current = e.clientX;
    lastTRef.current = now;

    // A real elastic deformation, not a decorative one — stretched along
    // the axis it's actually sliding on proportional to speed, squashed
    // perpendicular to conserve its own apparent volume, capped so a very
    // fast flick still reads as a toggle thumb and not a smear.
    const stretch = Math.min(Math.abs(vx) * 1.8, .55);
    thumbRef.current.style.transform =
      `translateX(${ x }px) scaleX(${ 1 + stretch }) scaleY(${ 1 - stretch * .6 })`;
  };

  const handlePointerUp = (e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (!suppressClickRef.current) return; // never crossed the drag threshold — the plain onClick below handles it

    const base = checked ? THUMB_TRAVEL : 0;
    const dx = e.clientX - startXRef.current;
    const x = Math.max(0, Math.min(THUMB_TRAVEL, base + dx));
    const shouldCheck = x > THUMB_TRAVEL * COMMIT_RATIO;

    if (shouldCheck !== checked) onChange();
    else settleTo(checked);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={ checked }
      aria-label={ label }
      disabled={ disabled }
      className={ `settings-toggle ${ checked ? "checked" : "" }` }
      onPointerDown={ handlePointerDown }
      onPointerMove={ handlePointerMove }
      onPointerUp={ handlePointerUp }
      onPointerCancel={ handlePointerUp }
      onClick={ () => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onChange();
      } }
    >
      <span ref={ thumbRef } className="settings-toggle-thumb" />
    </button>
  );
};

export default SettingsToggle;
