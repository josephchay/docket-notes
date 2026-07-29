import React, { useEffect, useRef } from "react";
import gsap from "gsap";

import "./CursorDot.css";

const INTERACTIVE = "button, a, [role='button'], .star, .edit";
const TEXT_FIELDS = "input[type='text'], input[type='search'], input:not([type]), textarea, [contenteditable='true']";

// A dot dips into ink wherever the page already keeps a `{color}-bg` class
// on the element — a note's own paper, or a nav-rail color pot.
const INK_COLOR_CLASS = /^(yellow|orange|green|blue|purple|pink|red)-bg$/;
const INK_SOURCE = ".note, .selector, .note-radial-item";

const R = 4.5;          // resting capsule end-cap radius (px) — a 9px dot at rest
const CARET_W = 2.5;    // text caret size (px)
const CARET_H = 24;
const WRAP_MAX = 140;   // controls larger than this are not wrapped
const WRAP_PAD = 5;     // breathing room around a wrapped control (px)
const MAGNET = 0.14;    // how far a wrapped highlight leans toward the pointer
const MAX_STRETCH = 74; // longest the capsule is allowed to stretch (px)

const PEN_HOLD_MS = 4000; // how long dipped ink stays on the pen
const IDLE_DELAY = 2.5;   // seconds still before the ink starts pooling
const MAX_RIPPLES = 6;

// The cursor is two tracked points — a head that snaps to the pointer and
// a tail that drags a beat behind it — rendered as ONE solid shape: a
// plain rounded div, stretched to span the distance between them and
// rotated to their angle, with fully-pill corner rounding at both ends.
// That's the whole trick: no separate trailing dots, no blur filter, just
// a single continuous capsule whose length and angle are recomputed every
// frame from where the two points currently sit. Fast motion pulls the
// head ahead of the tail and the capsule stretches like pulled taffy;
// stop moving and the tail catches back up until it's a plain dot again.
//
// Over a small control the cursor instead melts into a translucent ink
// highlight that wraps it (iPadOS-style), leaning gently toward the
// pointer; over text it narrows into a blinking caret. Those two states
// use their own separate element (`.cursor-ink`, unchanged from the
// original single-dot design) — a capsule can't sensibly represent an
// arbitrary button's own rectangle, so the two renderers simply crossfade
// based on which state is active. Crossing a note or a nav color pot dips
// the pen into that color: the capsule carries it for a few seconds
// before drying back to a neutral gray. Left still for a moment, GSAP
// eases the capsule through one gentle elastic pool. Touch and
// reduced-motion visitors keep the OS cursor.
const CursorDot = () => {
  const layerRef = useRef(null);
  const capsuleRef = useRef(null);
  const inkRef = useRef(null);

  useEffect(() => {
    const layer = layerRef.current;
    const capsule = capsuleRef.current;
    const ink = inkRef.current;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    if (reducedMotion || coarsePointer) {
      document.body.classList.add("native-cursor");
      return () => document.body.classList.remove("native-cursor");
    }

    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    // The capsule's two ends.
    const head = { x: mouse.x, y: mouse.y };
    const tail = { x: mouse.x, y: mouse.y };

    // The wrap/caret highlight's own eased box — unchanged from the
    // original single-dot cursor.
    const cur = { x: mouse.x, y: mouse.y, w: R * 2, h: R * 2, r: R };

    let wrapEl = null;
    let textMode = false;
    let press = 0, pressTarget = 0;
    let seen = false;
    let pointerGone = false;
    let penColor = null;   // the ink currently dipped onto the pen
    let penUntil = 0;      // when that ink dries out
    let lastMoveAt = performance.now();

    // Plain scalars GSAP can tween without fighting the rAF loop's own
    // per-frame writes — press reads as a snappy jelly pulse, idle reads
    // as a soft one-shot pool, both layered onto the physics above.
    const pulse = { amount: 0 };
    let pulseTween = null;

    const pool = { amount: 0 };
    let poolTween = null;
    let pooled = false;

    // Match a wrapped control's own corner rounding, padded and capped so
    // circles stay circles and pills stay pills.
    const radiusFor = (el, w, h) => {
      const raw = getComputedStyle(el).borderTopLeftRadius;
      const cap = Math.min(w, h) / 2;
      if (raw.includes("%")) return cap;
      return Math.min((parseFloat(raw) || 0) + WRAP_PAD, cap);
    };

    // A drop of the current ink lands where the press happened and rings
    // outward into the paper.
    const spawnRipple = () => {
      if (layer.querySelectorAll(".cursor-ripple").length >= MAX_RIPPLES) return;

      const ripple = document.createElement("span");
      ripple.className = "cursor-ripple";
      ripple.style.left = `${ mouse.x }px`;
      ripple.style.top = `${ mouse.y }px`;
      ripple.addEventListener("animationend", () => ripple.remove());
      layer.appendChild(ripple);
    };

    const handleMove = (e) => {
      if (e.clientX !== mouse.x || e.clientY !== mouse.y) {
        lastMoveAt = performance.now();

        if (pooled) {
          pooled = false;
          poolTween?.kill();
          poolTween = gsap.to(pool, { amount: 0, duration: 0.3, ease: "power2.out" });
        }
      }

      mouse.x = e.clientX;
      mouse.y = e.clientY;

      if (!seen) {
        seen = true;
        head.x = tail.x = cur.x = mouse.x;
        head.y = tail.y = cur.y = mouse.y;
      }
    };

    const handleOver = (e) => {
      if (!(e.target instanceof Element)) return;

      const text = e.target.closest(TEXT_FIELDS);
      const control = text ? null : e.target.closest(INTERACTIVE);

      textMode = !!text;
      wrapEl = null;

      if (control) {
        const rect = control.getBoundingClientRect();
        if (rect.width <= WRAP_MAX && rect.height <= WRAP_MAX) wrapEl = control;
      }

      // Crossing a note's paper or a nav-rail color pot dips the pen into
      // that color — the same ink-well, whichever one the pointer found.
      const inkEl = e.target.closest(INK_SOURCE);
      if (inkEl) {
        for (const cls of inkEl.classList) {
          const match = cls.match(INK_COLOR_CLASS);
          if (match) {
            if (penColor !== match[1]) {
              penColor = match[1];
              layer.style.setProperty("--pen-ink", `var(--${ penColor }-color)`);
            }
            penUntil = performance.now() + PEN_HOLD_MS;
            capsule.classList.add("is-inked");
            break;
          }
        }
      }

      ink.classList.toggle("on-note", !!e.target.closest(".note"));
      ink.classList.toggle("is-caret", textMode);
      ink.classList.toggle("is-wrap", !!wrapEl);
    };

    const handleDown = () => {
      pressTarget = 1;
      spawnRipple();

      pulseTween?.kill();
      pulse.amount = 0;
      pulseTween = gsap.timeline()
        .to(pulse, { amount: 1, duration: 0.09, ease: "power2.out" })
        .to(pulse, { amount: 0, duration: 0.62, ease: "elastic.out(1, 0.35)" });
    };
    const handleUp = () => { pressTarget = 0; };
    const handleLeave = () => { pointerGone = true; };
    const handleEnter = () => { pointerGone = false; };

    let raf = 0;
    let last = performance.now();

    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // Frame-rate independent easing, identical feel at any refresh rate.
      const ease = (k) => 1 - Math.pow(1 - k, dt * 60);

      if (wrapEl && !document.contains(wrapEl)) {
        wrapEl = null;
        ink.classList.remove("is-wrap");
      }

      // Dipped ink dries back to a neutral gray once its moment has passed.
      if (penColor && now > penUntil) {
        penColor = null;
        layer.style.removeProperty("--pen-ink");
        capsule.classList.remove("is-inked");
      }

      const free = !wrapEl && !textMode;

      // Left alone long enough, GSAP takes the idle swell from here — one
      // elastic pool rather than a continuous per-frame sine, so it reads
      // as a deliberate little settle.
      const still = (now - lastMoveAt) / 1000;
      if (!pooled && still > IDLE_DELAY && press < 0.01 && free) {
        pooled = true;
        poolTween?.kill();
        poolTween = gsap.to(pool, { amount: 1, duration: 0.9, ease: "elastic.out(1, 0.4)" });
      }

      press += (pressTarget - press) * ease(0.35);

      // ---- The capsule: head snaps to the pointer, tail drags behind. ----
      head.x += (mouse.x - head.x) * ease(0.45);
      head.y += (mouse.y - head.y) * ease(0.45);

      if (free) {
        tail.x += (head.x - tail.x) * ease(0.16);
        tail.y += (head.y - tail.y) * ease(0.16);
      } else {
        // Collapsed while wrapping or typing, so it's a plain dot again
        // the instant the pointer is free — no stray stretch left over.
        tail.x = head.x;
        tail.y = head.y;
      }

      let dx = head.x - tail.x;
      let dy = head.y - tail.y;
      let dist = Math.hypot(dx, dy);

      if (dist > MAX_STRETCH) {
        const k = MAX_STRETCH / dist;
        dx *= k;
        dy *= k;
        tail.x = head.x - dx;
        tail.y = head.y - dy;
        dist = MAX_STRETCH;
      }

      let r = R * (1 - press * 0.22);
      // GSAP's press pulse and idle pool both ride on the same radius, so
      // whichever is active simply fattens or swells the one shape.
      if (pulse.amount > 0.001) r *= 1 + pulse.amount * 0.3;
      if (pool.amount > 0.001) r *= 1 + pool.amount * 0.22 * Math.sin(pool.amount * Math.PI);

      const width = dist + r * 2;
      const height = r * 2;
      const angle = Math.atan2(dy, dx);
      const midX = (head.x + tail.x) / 2;
      const midY = (head.y + tail.y) / 2;

      capsule.style.width = `${ width }px`;
      capsule.style.height = `${ height }px`;
      capsule.style.borderRadius = `${ r }px`;
      capsule.style.transform = `translate3d(${ midX - width / 2 }px, ${ midY - height / 2 }px, 0) rotate(${ angle }rad)`;
      capsule.style.opacity = (free && seen && !pointerGone) ? 1 : 0;

      // ---- The wrap / caret highlight — unchanged single-dot recipe. ----
      let gx = mouse.x, gy = mouse.y, gw = R * 2, gh = R * 2, gr = R;

      if (wrapEl) {
        const rect = wrapEl.getBoundingClientRect();
        gw = rect.width + WRAP_PAD * 2;
        gh = rect.height + WRAP_PAD * 2;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        gx = cx + (mouse.x - cx) * MAGNET;
        gy = cy + (mouse.y - cy) * MAGNET;
        gr = radiusFor(wrapEl, gw, gh);
      } else if (textMode) {
        gw = CARET_W;
        gh = CARET_H;
        gr = CARET_W;
      }

      cur.x += (gx - cur.x) * ease(0.3);
      cur.y += (gy - cur.y) * ease(0.3);
      cur.w += (gw - cur.w) * ease(0.24);
      cur.h += (gh - cur.h) * ease(0.24);
      cur.r += (gr - cur.r) * ease(0.24);

      let inkTransform = `translate3d(${ cur.x - cur.w / 2 }px, ${ cur.y - cur.h / 2 }px, 0)`;
      if (press > 0.01) inkTransform += ` scale(${ 1 - press * 0.14 })`;

      ink.style.transform = inkTransform;
      ink.style.width = `${ cur.w }px`;
      ink.style.height = `${ cur.h }px`;
      ink.style.borderRadius = `${ cur.r }px`;
      ink.style.opacity = (!free && seen && !pointerGone) ? 1 : 0;

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    window.addEventListener("pointermove", handleMove, { passive: true });
    window.addEventListener("pointerdown", handleDown, { passive: true });
    window.addEventListener("pointerup", handleUp, { passive: true });
    document.addEventListener("pointerover", handleOver, { passive: true });
    document.documentElement.addEventListener("mouseleave", handleLeave);
    document.documentElement.addEventListener("mouseenter", handleEnter);

    return () => {
      cancelAnimationFrame(raf);
      pulseTween?.kill();
      poolTween?.kill();
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerdown", handleDown);
      window.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointerover", handleOver);
      document.documentElement.removeEventListener("mouseleave", handleLeave);
      document.documentElement.removeEventListener("mouseenter", handleEnter);
    };
  }, []);

  return (
    <div
      ref={ layerRef }
      className="cursor-layer"
      aria-hidden="true"
    >
      <div
        ref={ capsuleRef }
        className="cursor-capsule"
        style={{ opacity: 0 }}
      ></div>
      <div
        ref={ inkRef }
        className="cursor-ink"
        style={{ opacity: 0 }}
      ></div>
    </div>
  );
};

export default CursorDot;
