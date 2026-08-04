import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";

// The tour's guide made flesh: a full-viewport WebGL canvas rendering a
// little creature of ink as a gaussian metaball field. Six drops chase each
// other on springs — the head chases the perch it was told to sit at, every
// drop behind chases the drop ahead around its own lazy orbit — so the ink
// naturally stretches into a teardrop while travelling between stops and
// settles back into one gently boiling blob at rest. Two further drops are
// strung out toward the tour card's top edge each frame, so the card always
// hangs off the creature by a gooey stem no matter where its springs have
// carried it. gsap conducts everything scalar: the splat pulse on arrival,
// the accent sheen re-tinting per stop, the birth and the final soak-away.
//
// A second, independent metaball cluster (mark()/unmark() below) renders in
// this same draw call: a ring of ink pooling just outside whichever control
// the current stop is discussing — the control's entire "you are here" cue,
// replacing three separate things earlier rounds tried instead: a version
// that animated the control's own CSS transform/filter directly (fought
// aimCamera's zoom for the privilege), a DOM-side z-index-and-jelly bounce
// on the control itself, and a separate one-shot flubber blob-morph
// component (InkStamp) layered on top to sell the arrival. All three are
// gone now, folded into this one ring: on the very first mark, every drop
// is seeded at the target's own center and the tick loop's own spring-chase
// has to pull them outward into the ellipse — a real elastic explode into
// shape rather than a scale bloom — and every fresh arrival after that
// (see the `fresh` param) throws one bright impact pulse across every
// drop's radius, the ring's own "landed here" punctuation. This one never
// touches the control at all; it's a second field in the same shader,
// decoupled from the DOM node it happens to be circling.

// Raw shader colors go to the canvas untouched, so keep THREE from
// converting hex inks into linear space on the way in.
THREE.ColorManagement.enabled = false;

// Rest radii of the body chain, head first — the whole silhouette of the
// creature lives in these numbers.
const BODY_RADII = [30, 24, 21, 18, 16, 14];
const BODY = BODY_RADII.length;
const STEM = 2;
const COUNT = BODY + STEM;

// The discussed control's own mark: a second, independent metaball cluster
// — evenly spaced around whichever rect the current stop targets — that
// renders in the same draw call as the creature but answers to none of its
// springs. Liquid ink pooling in a ring just outside the control (so the
// icon underneath stays legible), continuously breathing, rather than the
// hand-drawn SketchRing's crisp pen line: two different marks of "look
// here," layered rather than duplicated.
const MARK_COUNT = 12;

// The creature is always drawn in the page's own ink.
const INK = { light: "#191919", dark: "#fffeff" };

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

const VERT = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// Gaussian metaballs: every drop contributes exp(-d²/r²), the sum is
// thresholded into a body with a soft inky edge, and a thin band just
// inside that edge picks up the current stop's accent as a wet sheen.
// Per-drop radius wobble on uTime keeps the surface simmering even when
// the springs have gone still. The mark cluster (uMarkBalls) runs the same
// metaball math a second time, entirely independent of the creature's own
// field, then the two are combined by a simple alpha-weighted blend —
// cheap, and correct wherever the two fields happen to overlap.
const FRAG = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uDpr;
  uniform float uTime;
  uniform vec3 uBalls[${COUNT}];
  uniform vec3 uInk;
  uniform vec3 uRim;
  uniform float uAlpha;
  uniform vec3 uMarkBalls[${MARK_COUNT}];
  uniform vec3 uMarkColor;
  uniform float uMarkAlpha;

  void main() {
    vec2 p = gl_FragCoord.xy / uDpr;
    p.y = uResolution.y - p.y;

    float field = 0.0;
    for (int i = 0; i < ${COUNT}; i++) {
      vec3 b = uBalls[i];
      float r = b.z * (1.0 + 0.06 * sin(uTime * (1.2 + float(i) * 0.37) + float(i) * 2.7));
      if (r > 0.5) {
        vec2 d = p - b.xy;
        field += exp(-dot(d, d) / (r * r));
      }
    }

    float body = smoothstep(0.5, 0.56, field);
    float rim = smoothstep(0.5, 0.6, field) * (1.0 - smoothstep(0.6, 1.05, field));
    vec3 col = mix(uInk, uRim, rim * 0.55);
    float alpha = body * uAlpha;

    float markField = 0.0;
    for (int i = 0; i < ${MARK_COUNT}; i++) {
      vec3 b = uMarkBalls[i];
      if (b.z > 0.5) {
        vec2 d = p - b.xy;
        markField += exp(-dot(d, d) / (b.z * b.z));
      }
    }

    float markBody = smoothstep(0.5, 0.64, markField);
    float markRim = smoothstep(0.5, 0.7, markField) * (1.0 - smoothstep(0.7, 1.2, markField));
    vec3 markCol = mix(uMarkColor * 0.7, uMarkColor * 1.2, markRim);
    float markAlpha = markBody * uMarkAlpha;

    float total = alpha + markAlpha;
    if (total < 0.004) discard;
    vec3 outCol = (col * alpha + markCol * markAlpha) / max(total, 0.0001);
    gl_FragColor = vec4(outCol, min(total, 1.0));
  }
`;

// One integrator step of a damped spring pulling a drop toward (tx, ty).
const springStep = (ball, tx, ty, k, c, dt) => {
  ball.vx += (k * (tx - ball.x) - c * ball.vx) * dt;
  ball.vy += (k * (ty - ball.y) - c * ball.vy) * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
};

const InkGoo = forwardRef(({ theme, cardTip }, ref) => {
  const canvasRef = useRef(null);

  // The card springs around on its own; reading its live top edge through a
  // ref each frame keeps the stem glued to it without re-rendering anything.
  const tipRef = useRef(cardTip);
  tipRef.current = cardTip;

  const simRef = useRef(null);
  if (!simRef.current) {
    simRef.current = {
      born: false,
      anchor: { x: 0, y: 0 },
      balls: Array.from({ length: BODY }, () => ({ x: 0, y: -220, vx: 0, vy: 0 })),
      stem: Array.from({ length: STEM }, () => ({ x: 0, y: -220, vx: 0, vy: 0 })),
      // pulse is the arrival splat; stemA/B are the stem drops' radii so
      // the tether can melt back into the body when nobody needs it.
      dims: { pulse: 1, stemA: 0, stemB: 0 },
      // spread scales every radius at once — 0 is "soaked into the paper".
      fx: { alpha: 0, spread: 0.35 },
      ink: new THREE.Color(INK.light),
      rim: new THREE.Color("#ffd56b"),
      pulseTl: null,
      // The mark cluster: liquid ink pooling around whichever control the
      // current stop targets, entirely separate from the creature's own
      // body/springs above. marked tracks whether it's currently blooming
      // over a real target (gates the one-time elastic bloom-in the same
      // way `born` gates the creature's own one-time entrance); anchor is
      // the rect it's chasing; balls are the ring of drops themselves.
      marked: false,
      markAnchor: null,
      markBaseRadius: 18,
      markBalls: Array.from({ length: MARK_COUNT }, () => ({ x: 0, y: 0, vx: 0, vy: 0 })),
      markFx: { alpha: 0, spread: 0 },
      markColor: new THREE.Color("#ffd56b"),
      // A second, independent scalar riding on top of markFx.spread — see
      // the impact pulse in mark() below.
      markPulse: { value: 1 },
    };
  }

  // Shared by mark() below and the walk-ending dismiss() — the same swell-
  // then-vanish signature every other soak-away in this file already uses.
  const soakMark = () => {
    const s = simRef.current;
    if (!s.marked) return;
    s.marked = false;
    s.markAnchor = null;
    gsap.killTweensOf(s.markFx);
    gsap.killTweensOf(s.markPulse);
    gsap.to(s.markFx, { spread: 1.14, duration: 0.16, ease: "power2.out" });
    gsap.to(s.markFx, { spread: 0, duration: 0.5, ease: "back.in(1.8)", delay: 0.16 });
    gsap.to(s.markFx, { alpha: 0, duration: 0.3, ease: "power1.in", delay: 0.32 });
  };

  useImperativeHandle(ref, () => ({
    // Send the creature to a new perch — the springs do the actual swim,
    // gsap lands the splat and re-inks the rim in the new stop's accent.
    moveTo({ x, y, accent, stem = true }) {
      const s = simRef.current;

      if (!s.born) {
        // First appearance: the whole chain starts stacked above its perch
        // and simply falls in, one long drip from the top of the page.
        s.born = true;
        s.balls.forEach((b, i) => {
          b.x = x;
          b.y = y - 200 - i * 24;
          b.vx = 0;
          b.vy = 0;
        });
        s.stem.forEach((b) => {
          b.x = x;
          b.y = y - 200;
          b.vx = 0;
          b.vy = 0;
        });
        gsap.to(s.fx, { alpha: 0.94, duration: 0.35, ease: "power1.out" });
        gsap.fromTo(s.fx, { spread: 0.35 }, { spread: 1, duration: 1.25, ease: "elastic.out(1, 0.5)", delay: 0.1 });
      }

      s.anchor.x = x;
      s.anchor.y = y;

      s.pulseTl?.kill();
      s.pulseTl = gsap.timeline({ delay: 0.34 })
        .set(s.dims, { pulse: 1 })
        .to(s.dims, { pulse: 1.3, duration: 0.14, ease: "power2.in" })
        .to(s.dims, { pulse: 1, duration: 0.9, ease: "elastic.out(1.1, 0.42)" });

      gsap.to(s.dims, {
        stemA: stem ? 14 : 0,
        stemB: stem ? 10 : 0,
        duration: 0.5,
        ease: "power2.out",
        delay: stem ? 0.4 : 0,
      });

      const c = new THREE.Color(accent);
      gsap.to(s.rim, { r: c.r, g: c.g, b: c.b, duration: 0.8, ease: "power2.inOut" });
    },

    // Resize/scroll re-aim: just move the perch, no ceremony.
    nudge({ x, y }) {
      const s = simRef.current;
      s.anchor.x = x;
      s.anchor.y = y;
    },

    // Pool a ring of ink around whichever rect the current stop targets —
    // called every time that rect is (re)measured (arrival, resize,
    // scroll), so the ring's radius and center track a moving/resizing
    // target live. `fresh` (true exactly on a genuine new-stop arrival,
    // false for an ambient re-measure of the same stop) gates the two
    // things that should only ever happen once per arrival rather than
    // every frame a
    // rect happens to be re-measured: the impact pulse, and — the very
    // first time this control is ever marked — the explode-into-shape
    // burst below. Every arrival after the first just glides the same
    // drops from wherever they already are to the new ellipse, exactly
    // the travel/nudge split moveTo already draws for the creature.
    mark({ rect, accent, fresh = false }) {
      const s = simRef.current;
      const a = rect.width / 2 + 15;
      const b = rect.height / 2 + 15;
      s.markAnchor = { cx: rect.cx, cy: rect.cy, a, b };
      // Radius tuned so MARK_COUNT drops, evenly spaced around that
      // ellipse, overlap into one continuous ring rather than a beaded
      // necklace or a solid disc.
      s.markBaseRadius = clamp(((a + b) / 2) * ((2 * Math.PI) / MARK_COUNT) * 0.68, 12, 34);

      const c = new THREE.Color(accent);
      gsap.to(s.markColor, { r: c.r, g: c.g, b: c.b, duration: 0.6, ease: "power2.inOut" });

      if (!s.marked) {
        s.marked = true;
        // Seeded at the target's own center — not already resting on the
        // ring — so the exact same spring-chase the tick loop below
        // already drives every frame has to actually pull each drop
        // outward into shape. The ring explodes into being, stretching
        // elastic on the way, rather than just fading up at full size.
        for (let i = 0; i < MARK_COUNT; i++) {
          const ball = s.markBalls[i];
          ball.x = rect.cx;
          ball.y = rect.cy;
          ball.vx = 0;
          ball.vy = 0;
        }
        gsap.killTweensOf(s.markFx);
        gsap.set(s.markFx, { spread: 0 });
        gsap.to(s.markFx, { alpha: 0.85, duration: 0.3, ease: "power1.out" });
        gsap.to(s.markFx, { spread: 1, duration: 0.9, ease: "elastic.out(1, 0.5)", delay: 0.05 });
      }

      if (fresh) {
        // The impact pulse: a bright, brief overshoot across every drop's
        // radius at once, firing on every fresh arrival — not just the
        // first-ever one. This is the stop's own "landed here" punctuation,
        // replacing what used to be a second, separately-timed component
        // (InkStamp) layered on top of the ring; folded into the ring's
        // own radius here instead, so there's exactly one thing marking
        // the control, not two racing to make the same point.
        gsap.killTweensOf(s.markPulse);
        gsap.set(s.markPulse, { value: 1 });
        gsap.to(s.markPulse, { value: 1.55, duration: .16, ease: "power2.out" });
        gsap.to(s.markPulse, { value: 1, duration: .85, delay: .16, ease: "elastic.out(1, .45)" });
      }
    },

    // Nothing to mark right now — a bookend scene, or a selector that
    // didn't resolve. Swells briefly then soaks away, same signature as
    // the creature's own dismiss() below.
    unmark: soakMark,

    // The farewell bow: a quick swell, then the whole creature — and
    // whatever ring is still marking a control — soaks away into the paper.
    dismiss() {
      const s = simRef.current;
      gsap.to(s.dims, { stemA: 0, stemB: 0, duration: 0.3, ease: "power2.in", delay: 0.35 });
      gsap.to(s.fx, { spread: 1.16, duration: 0.2, ease: "power2.out", delay: 0.55 });
      gsap.to(s.fx, { spread: 0, duration: 0.55, ease: "back.in(1.9)", delay: 0.78 });
      gsap.to(s.fx, { alpha: 0, duration: 0.3, ease: "power1.in", delay: 1.05 });
      soakMark();
    },
  }), []);

  // Theme flips mid-tour re-dye the creature in the page's new ink.
  useEffect(() => {
    const target = new THREE.Color(INK[theme] || INK.light);
    const tween = gsap.to(simRef.current.ink, {
      r: target.r,
      g: target.g,
      b: target.b,
      duration: 0.7,
      ease: "power2.inOut",
    });
    return () => tween.kill();
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: dpr },
      uTime: { value: 0 },
      uBalls: { value: Array.from({ length: COUNT }, () => new THREE.Vector3(0, 0, 0)) },
      uInk: { value: simRef.current.ink },
      uRim: { value: simRef.current.rim },
      uAlpha: { value: 0 },
      uMarkBalls: { value: Array.from({ length: MARK_COUNT }, () => new THREE.Vector3(0, 0, 0)) },
      uMarkColor: { value: simRef.current.markColor },
      uMarkAlpha: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    };
    resize();
    window.addEventListener("resize", resize);

    const clock = new THREE.Clock();
    let raf;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const s = simRef.current;
      const dt = Math.min(clock.getDelta(), 1 / 30);
      const t = clock.elapsedTime;

      // The head chases the perch; each drop behind chases the drop ahead
      // around a slow orbit of its own — comet in motion, simmer at rest.
      const head = s.balls[0];
      springStep(head, s.anchor.x, s.anchor.y, 150, 17, dt);
      for (let i = 1; i < BODY; i++) {
        const prev = s.balls[i - 1];
        const orbit = (3 + i * 2.6) * s.fx.spread;
        const w = 0.8 + i * 0.27;
        const dir = i % 2 ? 1 : -1;
        const tx = prev.x + Math.cos(t * w * dir + i * 2.1) * orbit;
        const ty = prev.y + Math.sin(t * w * dir + i * 2.1) * orbit;
        springStep(s.balls[i], tx, ty, 130 - i * 13, 14 - i * 0.9, dt);
      }

      // Two stem drops strung between the body and the card's live top edge.
      const tip = tipRef.current?.();
      const ax = tip ? head.x + (tip.x - head.x) * 0.42 : head.x;
      const ay = tip ? head.y + (tip.y - head.y) * 0.42 : head.y;
      const bx = tip ? head.x + (tip.x - head.x) * 0.78 : head.x;
      const by = tip ? head.y + (tip.y - head.y) * 0.78 : head.y;
      springStep(s.stem[0], ax, ay, 170, 18, dt);
      springStep(s.stem[1], bx, by, 170, 18, dt);

      const scale = s.fx.spread * s.dims.pulse;
      for (let i = 0; i < BODY; i++) {
        uniforms.uBalls.value[i].set(s.balls[i].x, s.balls[i].y, BODY_RADII[i] * scale);
      }
      uniforms.uBalls.value[BODY].set(s.stem[0].x, s.stem[0].y, s.dims.stemA * s.fx.spread);
      uniforms.uBalls.value[BODY + 1].set(s.stem[1].x, s.stem[1].y, s.dims.stemB * s.fx.spread);
      uniforms.uAlpha.value = s.fx.alpha;
      uniforms.uTime.value = t;

      // The mark ring: each drop's resting spot drifts slowly around its
      // own point on the target ellipse — never orbiting past its
      // neighbors, just breathing in and out — so the union reads as a
      // simmering liquid border rather than a rigid dashed line.
      if (s.markAnchor) {
        const { cx, cy, a, b } = s.markAnchor;
        for (let i = 0; i < MARK_COUNT; i++) {
          const ang = (i / MARK_COUNT) * Math.PI * 2;
          const jitter = Math.sin(t * (1.1 + i * 0.13) + i * 1.7) * 4;
          const tx = cx + Math.cos(ang) * (a + jitter);
          const ty = cy + Math.sin(ang) * (b + jitter * 0.6);
          springStep(s.markBalls[i], tx, ty, 190, 19, dt);
        }
      }
      for (let i = 0; i < MARK_COUNT; i++) {
        const wobble = 1 + 0.12 * Math.sin(t * (1.3 + i * 0.21) + i * 2.4);
        const r = s.markAnchor ? s.markBaseRadius * wobble * s.markFx.spread * s.markPulse.value : 0;
        uniforms.uMarkBalls.value[i].set(s.markBalls[i].x, s.markBalls[i].y, r);
      }
      uniforms.uMarkAlpha.value = s.markFx.alpha;

      renderer.render(scene, camera);
    };

    // InkGoo is mounted for the app's whole lifetime (see TourGuide.jsx),
    // not just while a walk is on screen, so an idle RAF loop left running
    // in a backgrounded tab would burn cycles indefinitely — pause it the
    // same way CursorAura/LiquidMeter already do for their own always-on
    // WebGL layers.
    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
        clock.getDelta();
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("resize", resize);
      const s = simRef.current;
      s.pulseTl?.kill();
      gsap.killTweensOf([s.dims, s.fx, s.rim, s.ink, s.markFx, s.markColor, s.markPulse]);
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={ canvasRef } className="tour-goo" aria-hidden="true" />;
});

export default InkGoo;
