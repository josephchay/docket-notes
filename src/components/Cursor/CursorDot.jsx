import React, { useEffect, useRef } from "react";
import gsap from "gsap";

import { frameEase, prefersNativeCursor } from "../../utils/cursorMotion";

import "./CursorDot.css";

const INTERACTIVE = "button, a, [role='button'], .star, .edit";
const TEXT_FIELDS = "input[type='text'], input[type='search'], input:not([type]), textarea, [contenteditable='true']";

// A dot dips into ink wherever the page already keeps a `{color}-bg` class
// on the element — a note's own paper, or a nav-rail color pot.
const INK_COLOR_CLASS = /^(yellow|orange|green|blue|purple|pink|red)-bg$/;
const INK_SOURCE = ".note, .selector, .note-radial-item";

const R = 10;           // resting capsule radius (px) — a 20px dot at rest
const CARET_W = 2.5;    // text caret size (px)
const CARET_H = 24;
const WRAP_MAX = 140;   // controls larger than this are not wrapped
const WRAP_PAD = 5;     // breathing room around a wrapped control (px)
const MAGNET = 0.14;    // how far a wrapped highlight leans toward the pointer
const MAX_SEG_STRETCH = 37; // longest either chain link (head→neck, neck→tail) may stretch (px)

const VEL_SMOOTH = 0.2;       // low-pass factor for the raw pointer-velocity estimate
const VEL_STRETCH_K = 0.0004; // px/s of pointer speed -> extra thinning ratio
const MAX_VEL_STRETCH = 0.35; // cap on that thinning (0.35 -> stroke as thin as 1/1.35 ≈ 74%)

const PEN_HOLD_MS = 4000; // how long dipped ink stays on the pen
const IDLE_DELAY = 2.5;   // seconds still before the ink starts pooling
const MAX_RIPPLES = 6;

const SHAPE_STIFFNESS = 220; // spring constant the wrap/caret box's shape converts with
const SHAPE_DAMPING = 14;    // underdamped enough for a visible pop-and-settle

// The cursor is a three-point chain — a head that snaps to the pointer, a
// neck that drags a beat behind the head, and a tail that drags a beat
// behind the neck — rendered as ONE stroked SVG path: a quadratic curve
// running head -> tail with the neck as its control point, round-capped so
// a straight chain reads as a plain capsule. That's the whole trick: no
// separate trailing dots, no blur filter, just one continuous curve
// recomputed every frame from where the three points currently sit. On a
// straight line the neck sits right on the head-tail line and the curve
// is visually a straight pill; turn the pointer through a curve and each
// link's own lag pulls the neck off that line, so the tail bows through
// the turn instead of swinging like a rigid rod. The pointer's own raw
// speed, smoothed independently of that chain lag, thins the stroke a
// touch on top — the chain's own spacing already does the elongating —
// so a quick flick whips thinner a beat before the links catch up, and a
// sudden stop lets it fatten back to a resting dot.
//
// Over a small control the cursor instead melts into a translucent ink
// highlight that wraps it (iPadOS-style), leaning gently toward the
// pointer; over text it narrows into a blinking caret. Those two states
// use their own separate element (`.cursor-ink`, unchanged from the
// original single-dot design) — a capsule can't sensibly represent an
// arbitrary button's own rectangle, so the two renderers simply crossfade
// based on which state is active. Crossing a note or a nav color pot dips
// the pen into that color: the capsule carries it for a few seconds
// before drying back to a neutral gray — or instantly, the moment text
// mode takes over, so the caret itself never picks up a note's color even
// mid-dip. Both renderers share the same two
// punctual reactions: a press snaps through one elastic jelly pulse, and
// — left still for a moment, free or wrapped alike — GSAP eases whichever
// shape is showing through one gentle elastic pool.
//
// The ink's position (x/y) always drifts continuously — the magnet lean
// keeps chasing the live pointer even while parked on one control — so it
// stays on the same plain decay as the capsule's own tracking. Its shape
// (w/h/r) only ever moves at all when the target itself converts: a new
// control, or crossing into/out of text mode. That box is a real
// mass-spring instead, tuned to actually overshoot before it settles — so
// every conversion pops and wobbles once rather than just resizing, with
// no extra bookkeeping needed, since a spring already sitting on its
// target simply stays put. Touch and reduced-motion visitors keep the OS
// cursor.
const CursorDot = () => {
  const layerRef = useRef(null);
  const capsuleRef = useRef(null);
  const inkRef = useRef(null);

  useEffect(() => {
    const layer = layerRef.current;
    const capsule = capsuleRef.current;
    const ink = inkRef.current;

    if (prefersNativeCursor()) {
      document.body.classList.add("native-cursor");
      return () => document.body.classList.remove("native-cursor");
    }

    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    // The chain's three links.
    const head = { x: mouse.x, y: mouse.y };
    const neck = { x: mouse.x, y: mouse.y };
    const tail = { x: mouse.x, y: mouse.y };

    // Raw pointer velocity, smoothed independently of the chain's own lag —
    // feeds the extra thinning layered on below.
    const prevMouse = { x: mouse.x, y: mouse.y };
    const vel = { x: 0, y: 0 };

    // The wrap/caret highlight's own box — position eased as before, shape
    // (below) a real spring so a conversion between targets can overshoot.
    const cur = { x: mouse.x, y: mouse.y, w: R * 2, h: R * 2, r: R };
    const curShapeVel = { w: 0, h: 0, r: 0 };

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
        head.x = neck.x = tail.x = cur.x = mouse.x;
        head.y = neck.y = tail.y = cur.y = mouse.y;
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

      if (textMode) {
        // The caret always stays neutral, even mid-note — dipping the pen
        // is a free-roam/wrap thing only, so any dip already drying out
        // gets cut short here instead of bleeding through the capsule/ink
        // crossfade the instant text mode takes over.
        if (penColor) {
          penColor = null;
          layer.style.removeProperty("--pen-ink");
          capsule.classList.remove("is-inked");
        }
      } else {
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
      const ease = (k) => frameEase(k, dt);

      // Smoothed pointer velocity — a faster, more direct signal than the
      // head/tail lag below, so it can lead the capsule's own stretch.
      if (dt > 0) {
        vel.x += ((mouse.x - prevMouse.x) / dt - vel.x) * ease(VEL_SMOOTH);
        vel.y += ((mouse.y - prevMouse.y) / dt - vel.y) * ease(VEL_SMOOTH);
      }
      prevMouse.x = mouse.x;
      prevMouse.y = mouse.y;

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
      // as a deliberate little settle. Applies whether the pointer is
      // roaming free or currently wrapping a control.
      const still = (now - lastMoveAt) / 1000;
      if (!pooled && still > IDLE_DELAY && press < 0.01) {
        pooled = true;
        poolTween?.kill();
        poolTween = gsap.to(pool, { amount: 1, duration: 0.9, ease: "elastic.out(1, 0.4)" });
      }

      press += (pressTarget - press) * ease(0.35);

      // ---- The chain: head snaps to the pointer, neck and tail each drag
      // a beat behind the link ahead of them. ----
      head.x += (mouse.x - head.x) * ease(0.45);
      head.y += (mouse.y - head.y) * ease(0.45);

      if (free) {
        neck.x += (head.x - neck.x) * ease(0.28);
        neck.y += (head.y - neck.y) * ease(0.28);
        tail.x += (neck.x - tail.x) * ease(0.16);
        tail.y += (neck.y - tail.y) * ease(0.16);
      } else {
        // Collapsed while wrapping or typing, so it's a plain dot again
        // the instant the pointer is free — no stray curve left over.
        neck.x = tail.x = head.x;
        neck.y = tail.y = head.y;
      }

      // Each link is only allowed to trail so far behind the one ahead of
      // it — independently, so the chain can still bow through a turn
      // without either half overshooting its own budget.
      const clampLink = (from, to) => {
        const lx = to.x - from.x;
        const ly = to.y - from.y;
        const ldist = Math.hypot(lx, ly);
        if (ldist > MAX_SEG_STRETCH) {
          const k = MAX_SEG_STRETCH / ldist;
          to.x = from.x + lx * k;
          to.y = from.y + ly * k;
        }
      };
      clampLink(head, neck);
      clampLink(neck, tail);

      let r = R * (1 - press * 0.22);
      // GSAP's press pulse and idle pool both ride on the same radius, so
      // whichever is active simply fattens or swells the one shape.
      if (pulse.amount > 0.001) r *= 1 + pulse.amount * 0.3;
      if (pool.amount > 0.001) r *= 1 + pool.amount * 0.22 * Math.sin(pool.amount * Math.PI);

      // A touch of extra thinning from raw pointer speed — the chain's own
      // spacing already stretches the curve out, so this just leans into
      // it, on top of the shape above.
      const speed = Math.hypot(vel.x, vel.y);
      const velStretch = Math.min(speed * VEL_STRETCH_K, MAX_VEL_STRETCH);
      r /= 1 + velStretch;

      capsule.setAttribute("d", `M${ head.x },${ head.y } Q${ neck.x },${ neck.y } ${ tail.x },${ tail.y }`);
      capsule.style.strokeWidth = `${ r * 2 }px`;
      capsule.style.opacity = (free && seen && !pointerGone) ? 1 : 0;

      // ---- The wrap / caret highlight — shares the capsule's own press
      // pulse and idle pool, so it carries the same elastic personality. ----
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

      // The shape springs to its target rather than just decaying toward
      // it — sitting still (target unchanged) it stays put, but a genuine
      // conversion gives it real mass to overshoot and settle with.
      const springTo = (key, target) => {
        const accel = -(cur[key] - target) * SHAPE_STIFFNESS - curShapeVel[key] * SHAPE_DAMPING;
        curShapeVel[key] += accel * dt;
        cur[key] += curShapeVel[key] * dt;
      };
      springTo("w", gw);
      springTo("h", gh);
      springTo("r", gr);

      // A big enough overshoot (a wide wrapped control converting straight
      // into a caret, say) can swing the spring past zero — clamp only the
      // painted value, the spring's own state keeps integrating untouched.
      const paintW = Math.max(0, cur.w);
      const paintH = Math.max(0, cur.h);
      const paintR = Math.max(0, cur.r);

      let inkScale = 1 - pulse.amount * 0.14;
      if (pool.amount > 0.001) inkScale *= 1 + pool.amount * 0.16 * Math.sin(pool.amount * Math.PI);

      let inkTransform = `translate3d(${ cur.x - paintW / 2 }px, ${ cur.y - paintH / 2 }px, 0)`;
      if (Math.abs(inkScale - 1) > 0.001) inkTransform += ` scale(${ inkScale })`;

      ink.style.transform = inkTransform;
      ink.style.width = `${ paintW }px`;
      ink.style.height = `${ paintH }px`;
      ink.style.borderRadius = `${ paintR }px`;
      ink.style.opacity = (!free && seen && !pointerGone) ? 1 : 0;

      raf = requestAnimationFrame(frame);
    };

    // Paused while the tab is hidden — this rAF loop used to just run
    // forever, backgrounded tab or not, unlike CursorAura's own pause-on-
    // hidden; same fix, same reasoning (no cursor to chase when nobody's
    // looking at the page).
    const stop = () => cancelAnimationFrame(raf);
    const start = () => {
      stop();
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const handleVisibility = () => (document.hidden ? stop() : start());

    start();

    window.addEventListener("pointermove", handleMove, { passive: true });
    window.addEventListener("pointerdown", handleDown, { passive: true });
    window.addEventListener("pointerup", handleUp, { passive: true });
    document.addEventListener("pointerover", handleOver, { passive: true });
    document.documentElement.addEventListener("mouseleave", handleLeave);
    document.documentElement.addEventListener("mouseenter", handleEnter);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stop();
      pulseTween?.kill();
      poolTween?.kill();
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerdown", handleDown);
      window.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointerover", handleOver);
      document.documentElement.removeEventListener("mouseleave", handleLeave);
      document.documentElement.removeEventListener("mouseenter", handleEnter);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <div
      ref={ layerRef }
      className="cursor-layer"
      aria-hidden="true"
    >
      <svg className="cursor-svg">
        <path
          ref={ capsuleRef }
          className="cursor-capsule"
          style={{ opacity: 0 }}
        />
      </svg>
      <div
        ref={ inkRef }
        className="cursor-ink"
        style={{ opacity: 0 }}
      ></div>
    </div>
  );
};

export default CursorDot;
