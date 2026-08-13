import React, { useEffect, useRef } from 'react';
import anime from "animejs";

import { metaballBridge } from "../../utils/metaball";

const POUR_DRAG_THRESHOLD = 36; // px — how far a press has to travel before release counts as a real pour

// A flick's landing offset is the same v0/k a friction-decayed velocity
// integrates to over infinite time (v(t) = v0·e^-kt ⇒ ∫v dt = v0/k) — so
// rather than actually stepping a decaying velocity across frames, this one
// constant already IS that whole decayed throw, applied once at release.
const THROW_PROJECTION_MS = 90;
const THROW_SAMPLE_WINDOW_MS = 80; // only the last flick, not the whole drag's average
const MAX_THROW_PX = 260;

const TRAIL_LERP = 0.35;
const TRAIL_RADIUS = [16, 11, 7]; // ghost, trail dot 0, trail dot 1 — the tail thins as it lags
const MIX_DIST = 70; // px — how close the ghost has to pass another pot to pick up its ink
const RIPPLE_REACH = 2; // pours ripple out to same-column neighbors up to 2 pots away

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
  index,
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

  // A neighbor's own pour reaching this pot (see the pour-listener effect
  // below) — a self-contained out-and-back, unlike bulge() above, since
  // nothing here is going to fire a matching "return to 1" the way
  // mouseleave does for a hover bulge.
  const ripple = (amount, delay) => {
    const el = ref.current;
    if (!el) return;
    if (document.getElementById("navActivator")?.hasAttribute("disabled")) return;
    if (parseFloat(getComputedStyle(el).opacity) < .5) return;

    setTimeout(() => {
      const target = ref.current;
      if (!target) return;

      anime.remove(target);
      anime({
        targets: target,
        scale: [1, amount, 1],
        duration: 480,
        easing: "easeOutElastic(1, .55)",
      });
    }, delay);
  };

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

    // Tells the rest of the column a drop just left this pot (see the
    // pour-listener effect below) — a plain window event rather than
    // threading a callback through Navigation.jsx, since every pot already
    // needs to hear about every OTHER pot's pour, not just its own.
    if (index != null && !reduceMotion) {
      window.dispatchEvent(new CustomEvent("nav-pot-pour", { detail: { index } }));
    }
  }

  // Every pour on the rail (including this pot's own, filtered out below)
  // — the immediate neighbors ripple hardest, fading out by RIPPLE_REACH,
  // staggered so the jostle visibly travels down the column rather than
  // landing on every pot at once.
  useEffect(() => {
    if (index == null) return undefined;

    const onPour = (e) => {
      if (reduceMotion) return;
      const from = e.detail?.index;
      if (from == null || from === index) return;

      const distance = Math.abs(from - index);
      if (distance > RIPPLE_REACH) return;

      ripple(1 + .22 / distance, distance * 70);
    };

    window.addEventListener("nav-pot-pour", onPour);
    return () => window.removeEventListener("nav-pot-pour", onPour);
  }, [index, reduceMotion]);

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
  const dragRef = useRef({ active: false, startX: 0, startY: 0, lastX: 0, lastY: 0, samples: [], mixColor: null });
  const ghostRef = useRef(null);
  const trailRef = useRef([]);
  const trailBridgeRef = useRef([]);
  const trailSvgRef = useRef(null);
  const trailPointsRef = useRef([{ x: 0, y: 0 }, { x: 0, y: 0 }]);
  const rafRef = useRef(null);
  const suppressClickRef = useRef(false);

  const ensureGhost = () => {
    if (ghostRef.current) return ghostRef.current;
    const el = document.createElement("span");
    el.className = `nav-pot-ghost ${ color }-bg`;
    document.body.appendChild(el);
    ghostRef.current = el;
    return el;
  };

  // The trail's own two lagging dots plus the SVG neck bridging ghost →
  // dot0 → dot1 — the exact same two-circle metaball geometry (metaball.js)
  // Navigation.jsx's own pot-hover bridges and NoteConstellation's cluster
  // bridges already use, not a CSS blur filter: that filter's tuned for
  // elements sitting still at rest (see Navigation.css's own note on why
  // the pot-hover bridge stays OUT of the activator's gooey chain), and a
  // fast-moving drag object needs geometry that tracks it exactly, not a
  // blur radius guessing where it'll be next frame.
  const ensureTrail = () => {
    if (trailRef.current.length) return;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "nav-pot-drag-trail-layer");
    svg.setAttribute("aria-hidden", "true");
    const pathGhostToTrail0 = document.createElementNS(svgNS, "path");
    const pathTrail0ToTrail1 = document.createElementNS(svgNS, "path");
    svg.appendChild(pathGhostToTrail0);
    svg.appendChild(pathTrail0ToTrail1);
    document.body.appendChild(svg);
    trailSvgRef.current = svg;
    trailBridgeRef.current = [pathGhostToTrail0, pathTrail0ToTrail1];

    const start = { x: dragRef.current.lastX, y: dragRef.current.lastY };
    trailPointsRef.current = [{ ...start }, { ...start }];

    trailRef.current = [0, 1].map((i) => {
      const dot = document.createElement("span");
      dot.className = "nav-pot-ghost-trail";
      dot.style.width = `${ TRAIL_RADIUS[i + 1] * 2 }px`;
      dot.style.height = `${ TRAIL_RADIUS[i + 1] * 2 }px`;
      document.body.appendChild(dot);
      return dot;
    });
  };

  const cleanupDragVisuals = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    trailRef.current.forEach((dot) => dot.remove());
    trailRef.current = [];
    trailBridgeRef.current = [];
    if (trailSvgRef.current) {
      trailSvgRef.current.remove();
      trailSvgRef.current = null;
    }
  };

  useEffect(() => () => cleanupDragVisuals(), []);

  const dragLoop = () => {
    if (!dragRef.current.active) {
      rafRef.current = null;
      return;
    }

    const target = { x: dragRef.current.lastX, y: dragRef.current.lastY };
    const points = trailPointsRef.current;
    points[0].x += (target.x - points[0].x) * TRAIL_LERP;
    points[0].y += (target.y - points[0].y) * TRAIL_LERP;
    points[1].x += (points[0].x - points[1].x) * TRAIL_LERP;
    points[1].y += (points[0].y - points[1].y) * TRAIL_LERP;

    trailRef.current.forEach((dot, i) => {
      const p = points[i];
      dot.style.opacity = "1";
      dot.style.transform = `translate(${ p.x }px, ${ p.y }px) translate(-50%, -50%)`;
    });

    // The ghost's own live-mixed ink (see updateMix below) carries down the
    // whole tail, so a pass near another pot's color shows up trailing
    // behind it too, not just at the ghost itself.
    const fill = dragRef.current.mixColor || `var(--${ color }-color)`;
    const [pathGhostToTrail0, pathTrail0ToTrail1] = trailBridgeRef.current;
    if (pathGhostToTrail0) {
      const d = metaballBridge(target.x, target.y, TRAIL_RADIUS[0], points[0].x, points[0].y, TRAIL_RADIUS[1], { v: .75, maxDist: 70 });
      pathGhostToTrail0.setAttribute("d", d || "");
      pathGhostToTrail0.style.fill = fill;
    }
    if (pathTrail0ToTrail1) {
      const d = metaballBridge(points[0].x, points[0].y, TRAIL_RADIUS[1], points[1].x, points[1].y, TRAIL_RADIUS[2], { v: .75, maxDist: 55 });
      pathTrail0ToTrail1.setAttribute("d", d || "");
      pathTrail0ToTrail1.style.fill = fill;
    }

    rafRef.current = requestAnimationFrame(dragLoop);
  };

  // Two real inks bumping — the ghost blends toward whichever OTHER pot it
  // passes closest to, proportionally to how close, and lets go again once
  // it's clear. `!important` because the ghost's own base color comes from
  // its `${color}-bg` class (commons.css), which is itself `!important`.
  const updateMix = (clientX, clientY) => {
    const ghost = ghostRef.current;
    if (!ghost) return;

    const pots = document.querySelectorAll(".nav .activator-container .color-selectors .selector");
    let nearest = null;
    let nearestDist = Infinity;
    pots.forEach((el) => {
      if (el === ref.current) return;
      const rect = el.getBoundingClientRect();
      const d = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
      if (d < nearestDist) {
        nearestDist = d;
        nearest = el;
      }
    });

    const otherColor = nearest && [...nearest.classList].find((c) => c.endsWith("-bg"))?.replace("-bg", "");
    if (nearest && otherColor && otherColor !== color && nearestDist < MIX_DIST) {
      const t = Math.round((1 - nearestDist / MIX_DIST) * 60); // capped so this pot's own ink never fully disappears
      const mixed = `color-mix(in srgb, var(--${ otherColor }-color) ${ t }%, var(--${ color }-color) ${ 100 - t }%)`;
      ghost.style.setProperty("background-color", mixed, "important");
      dragRef.current.mixColor = mixed;
      return;
    }

    ghost.style.removeProperty("background-color");
    dragRef.current.mixColor = null;
  };

  const handlePointerDown = (e) => {
    if (reduceMotion) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
      mixColor: null,
    };
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
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;

    const now = performance.now();
    dragRef.current.samples.push({ x: e.clientX, y: e.clientY, t: now });
    while (dragRef.current.samples.length > 2 && now - dragRef.current.samples[0].t > THROW_SAMPLE_WINDOW_MS) {
      dragRef.current.samples.shift();
    }

    const ghost = ensureGhost();
    ghost.style.transition = "";
    ghost.style.opacity = "1";
    ghost.style.transform = `translate(${ e.clientX }px, ${ e.clientY }px) translate(-50%, -50%)`;

    updateMix(e.clientX, e.clientY);
    ensureTrail();
    if (!rafRef.current) rafRef.current = requestAnimationFrame(dragLoop);
  };

  const handlePointerUp = (e) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    ref.current?.releasePointerCapture?.(e.pointerId);

    const dist = Math.hypot(e.clientX - dragRef.current.startX, e.clientY - dragRef.current.startY);
    if (ghostRef.current) {
      if (dist > POUR_DRAG_THRESHOLD) {
        // Flick-throw: the release point plus the last THROW_SAMPLE_WINDOW_MS
        // of velocity projected out via THROW_PROJECTION_MS (see the constant's
        // own comment) — a fast flick lands well past the pointer, a slow
        // drag lands almost exactly where it's released.
        let landX = e.clientX;
        let landY = e.clientY;
        const samples = dragRef.current.samples;
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dt = first && last ? last.t - first.t : 0;
        if (dt > 0) {
          let offX = ((last.x - first.x) / dt) * THROW_PROJECTION_MS;
          let offY = ((last.y - first.y) / dt) * THROW_PROJECTION_MS;
          const mag = Math.hypot(offX, offY);
          if (mag > MAX_THROW_PX) {
            const k = MAX_THROW_PX / mag;
            offX *= k;
            offY *= k;
          }
          landX += offX;
          landY += offY;
        }

        addNote(color, { x: landX, y: landY });
        pour();
      }
      const ghost = ghostRef.current;
      ghostRef.current = null;
      ghost.style.transition = "opacity .25s ease-out, transform .25s ease-out";
      ghost.style.opacity = "0";
      ghost.style.transform += " scale(.4)";
      setTimeout(() => ghost.remove(), 260);
    }

    cleanupDragVisuals();
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
