import React, { useEffect, useRef } from "react";

import "./CursorDot.css";

const INTERACTIVE = "button, a, [role='button'], .star, .edit";
const TEXT_FIELDS = "input[type='text'], input[type='search'], input:not([type]), textarea, [contenteditable='true']";

const DOT = 9;        // resting dot diameter (px)
const CARET_W = 2.5;  // text caret size (px)
const CARET_H = 24;
const WRAP_MAX = 140; // controls larger than this are not wrapped
const WRAP_PAD = 5;   // breathing room around a wrapped control (px)
const MAGNET = 0.14;  // how far a wrapped highlight leans toward the pointer

// A single ink drop for a cursor. Free, it is a small dot that stretches
// elastically with speed — the same physicality as the note pull-strings.
// Over a small control it melts outward and wraps it as a translucent ink
// highlight (iPadOS-style), leaning gently toward the pointer; over text it
// narrows into a caret; pressing squashes it. Touch and reduced-motion
// visitors keep the OS cursor.
const CursorDot = () => {
  const inkRef = useRef(null);

  useEffect(() => {
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

    let wrapEl = null;
    let textMode = false;
    let press = 0, pressTarget = 0;
    let seen = false;

    // Match a wrapped control's own corner rounding, padded and capped so
    // circles stay circles and pills stay pills.
    const radiusFor = (el, w, h) => {
      const raw = getComputedStyle(el).borderTopLeftRadius;
      const cap = Math.min(w, h) / 2;
      if (raw.includes("%")) return cap;
      return Math.min((parseFloat(raw) || 0) + WRAP_PAD, cap);
    };

    const handleMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;

      if (!seen) {
        seen = true;
        prev.x = cur.x = mouse.x;
        prev.y = cur.y = mouse.y;
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

      ink.classList.toggle("is-wrap", !!wrapEl);
    };

    const handleDown = () => { pressTarget = 1; };
    const handleUp = () => { pressTarget = 0; };
    const handleLeave = () => ink.classList.add("is-hidden");
    const handleEnter = () => { if (seen) ink.classList.remove("is-hidden"); };

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

      let transform = `translate3d(${cur.x - cur.w / 2}px, ${cur.y - cur.h / 2}px, 0)`;

      // Free dot stretches along its direction of travel, like pulled ink.
      if (!wrapEl && !textMode) {
        const stretch = Math.min(Math.hypot(vel.x, vel.y) * 0.00035, 0.35);
        if (stretch > 0.01) {
          const angle = Math.atan2(vel.y, vel.x);
          transform += ` rotate(${angle}rad) scale(${1 + stretch}, ${1 / (1 + stretch)}) rotate(${-angle}rad)`;
        }
      }

      if (press > 0.01) transform += ` scale(${1 - press * 0.14})`;

      ink.style.transform = transform;
      ink.style.width = `${cur.w}px`;
      ink.style.height = `${cur.h}px`;
      ink.style.borderRadius = `${cur.r}px`;

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
      ref={ inkRef }
      className="cursor-ink is-hidden"
      aria-hidden="true"
    ></div>
  );
};

export default CursorDot;
