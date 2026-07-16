import React, { useEffect, useRef } from "react";

import "./CursorDot.css";

const INTERACTIVE = "button, a, [role='button'], .star, .edit";
const TEXT_FIELDS = "input[type='text'], input[type='search'], input:not([type]), textarea, [contenteditable='true']";
const NOTE_COLOR_CLASS = /^(yellow|orange|green|blue|purple|pink|red)-bg$/;

const DOT = 9;        // resting dot diameter (px)
const CARET_W = 2.5;  // text caret size (px)
const CARET_H = 24;
const WRAP_MAX = 140; // controls larger than this are not wrapped
const WRAP_PAD = 5;   // breathing room around a wrapped control (px)
const MAGNET = 0.14;  // how far a wrapped highlight leans toward the pointer

const TRAIL_SIZES = [7, 6, 5, 4]; // trailing droplets, nib to tail
const PEN_HOLD_MS = 4000;         // how long dipped ink stays on the pen
const IDLE_DELAY = 2.5;           // seconds still before the ink starts pooling
const MAX_RIPPLES = 6;

// A single ink drop for a cursor. Free, it is a small dot that stretches
// elastically with speed — the same physicality as the note pull-strings —
// towing a short trail of droplets like a drawn stroke. Over a small control
// it melts outward and wraps it as a translucent ink highlight (iPadOS-style),
// leaning gently toward the pointer; over text it narrows into a blinking
// caret; pressing squashes it and drops a ripple onto the paper. Crossing a
// note dips the pen into that note's ink: the trail carries the color for a
// few seconds before drying back to page ink. Left still, the drop slowly
// pools and settles. Touch and reduced-motion visitors keep the OS cursor.
const CursorDot = () => {
  const layerRef = useRef(null);
  const inkRef = useRef(null);

  useEffect(() => {
    const layer = layerRef.current;
    const ink = inkRef.current;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    if (reducedMotion || coarsePointer) {
      document.body.classList.add("native-cursor");
      return () => document.body.classList.remove("native-cursor");
    }

    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const prev = { ...mouse };
    const vel = { x: 0, y: 0 };
    const cur = { x: mouse.x, y: mouse.y, w: DOT, h: DOT, r: DOT / 2 };

    const trails = Array.from(layer.querySelectorAll(".cursor-trail")).map((el, i) => {
      el.style.width = `${ TRAIL_SIZES[i] }px`;
      el.style.height = `${ TRAIL_SIZES[i] }px`;
      return { el, x: mouse.x, y: mouse.y, o: 0 };
    });

    let wrapEl = null;
    let textMode = false;
    let press = 0, pressTarget = 0;
    let seen = false;
    let pointerGone = false;
    let penColor = null;   // the note ink currently on the pen
    let penUntil = 0;      // when that ink dries out
    let lastMoveAt = performance.now();

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
      if (e.clientX !== mouse.x || e.clientY !== mouse.y) lastMoveAt = performance.now();

      mouse.x = e.clientX;
      mouse.y = e.clientY;

      if (!seen) {
        seen = true;
        prev.x = cur.x = mouse.x;
        prev.y = cur.y = mouse.y;
        trails.forEach((t) => { t.x = mouse.x; t.y = mouse.y; });
        ink.classList.remove("is-hidden");
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

      // Crossing a note dips the pen into its ink pot; the note's own ink is
      // always black, so the drop writes in black there in either theme.
      const noteEl = e.target.closest(".note");
      if (noteEl) {
        for (const cls of noteEl.classList) {
          const match = cls.match(NOTE_COLOR_CLASS);
          if (match) {
            if (penColor !== match[1]) {
              penColor = match[1];
              layer.style.setProperty("--pen-ink", `var(--${ penColor }-color)`);
            }
            penUntil = performance.now() + PEN_HOLD_MS;
            break;
          }
        }
      }

      ink.classList.toggle("on-note", !!noteEl);
      ink.classList.toggle("is-caret", textMode);
      ink.classList.toggle("is-wrap", !!wrapEl);
    };

    const handleDown = () => {
      pressTarget = 1;
      spawnRipple();
    };
    const handleUp = () => { pressTarget = 0; };
    const handleLeave = () => {
      pointerGone = true;
      ink.classList.add("is-hidden");
    };
    const handleEnter = () => {
      pointerGone = false;
      if (seen) ink.classList.remove("is-hidden");
    };

    let raf = 0;
    let last = performance.now();

    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // Frame-rate independent easing, identical feel at any refresh rate.
      const ease = (k) => 1 - Math.pow(1 - k, dt * 60);

      // Smoothed pointer velocity drives the elastic stretch.
      if (dt > 0) {
        vel.x += ((mouse.x - prev.x) / dt - vel.x) * ease(0.2);
        vel.y += ((mouse.y - prev.y) / dt - vel.y) * ease(0.2);
      }
      prev.x = mouse.x;
      prev.y = mouse.y;

      if (wrapEl && !document.contains(wrapEl)) {
        wrapEl = null;
        ink.classList.remove("is-wrap");
      }

      // Dipped ink dries back to page ink once its moment has passed.
      if (penColor && now > penUntil) {
        penColor = null;
        layer.style.removeProperty("--pen-ink");
      }

      // Where the drop wants to be this frame.
      let gx = mouse.x, gy = mouse.y, gw = DOT, gh = DOT, gr = DOT / 2;

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
      press += (pressTarget - press) * ease(0.35);

      const speed = Math.hypot(vel.x, vel.y);
      const free = !wrapEl && !textMode;

      let transform = `translate3d(${cur.x - cur.w / 2}px, ${cur.y - cur.h / 2}px, 0)`;

      // Free dot stretches along its direction of travel, like pulled ink.
      if (free) {
        const stretch = Math.min(speed * 0.00035, 0.35);
        if (stretch > 0.01) {
          const angle = Math.atan2(vel.y, vel.x);
          transform += ` rotate(${angle}rad) scale(${1 + stretch}, ${1 / (1 + stretch)}) rotate(${-angle}rad)`;
        }

        // Left alone, the drop pools: a slow, soft swell and settle.
        const still = (now - lastMoveAt) / 1000;
        if (still > IDLE_DELAY && press < 0.01) {
          const amp = Math.min((still - IDLE_DELAY) / 1.5, 1) * 0.07;
          transform += ` scale(${1 + amp * Math.sin((still - IDLE_DELAY) * 2.1)})`;
        }
      }

      if (press > 0.01) transform += ` scale(${1 - press * 0.14})`;

      ink.style.transform = transform;
      ink.style.width = `${cur.w}px`;
      ink.style.height = `${cur.h}px`;
      ink.style.borderRadius = `${cur.r}px`;

      // The droplet trail chases the drop, each link a touch looser than the
      // one before it, and only shows itself while the ink is really moving.
      let leadX = cur.x, leadY = cur.y;
      trails.forEach((t, i) => {
        t.x += (leadX - t.x) * ease(0.3 - i * 0.05);
        t.y += (leadY - t.y) * ease(0.3 - i * 0.05);
        leadX = t.x;
        leadY = t.y;

        const target = free && seen && !pointerGone
          ? Math.min(speed * 0.0008, 0.5) * (1 - i * 0.16)
          : 0;
        t.o += (target - t.o) * ease(0.18);

        t.el.style.transform = `translate3d(${t.x - TRAIL_SIZES[i] / 2}px, ${t.y - TRAIL_SIZES[i] / 2}px, 0)`;
        t.el.style.opacity = t.o.toFixed(3);
      });

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
      {
        TRAIL_SIZES.map((size, index) => (
          <span
            key={ index }
            className="cursor-trail"
          ></span>
        ))
      }
      <div
        ref={ inkRef }
        className="cursor-ink is-hidden"
      ></div>
    </div>
  );
};

export default CursorDot;
