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

// Raw shader colors go to the canvas untouched, so keep THREE from
// converting hex inks into linear space on the way in.
THREE.ColorManagement.enabled = false;

// Rest radii of the body chain, head first — the whole silhouette of the
// creature lives in these numbers.
const BODY_RADII = [30, 24, 21, 18, 16, 14];
const BODY = BODY_RADII.length;
const STEM = 2;
const COUNT = BODY + STEM;

// The creature is always drawn in the page's own ink.
const INK = { light: "#191919", dark: "#fffeff" };

const VERT = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// Gaussian metaballs: every drop contributes exp(-d²/r²), the sum is
// thresholded into a body with a soft inky edge, and a thin band just
// inside that edge picks up the current stop's accent as a wet sheen.
// Per-drop radius wobble on uTime keeps the surface simmering even when
// the springs have gone still.
const FRAG = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uDpr;
  uniform float uTime;
  uniform vec3 uBalls[${COUNT}];
  uniform vec3 uInk;
  uniform vec3 uRim;
  uniform float uAlpha;

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
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
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
    };
  }

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

    // The farewell bow: a quick swell, then the whole creature soaks away
    // into the paper.
    dismiss() {
      const s = simRef.current;
      gsap.to(s.dims, { stemA: 0, stemB: 0, duration: 0.3, ease: "power2.in", delay: 0.35 });
      gsap.to(s.fx, { spread: 1.16, duration: 0.2, ease: "power2.out", delay: 0.55 });
      gsap.to(s.fx, { spread: 0, duration: 0.55, ease: "back.in(1.9)", delay: 0.78 });
      gsap.to(s.fx, { alpha: 0, duration: 0.3, ease: "power1.in", delay: 1.05 });
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

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      const s = simRef.current;
      s.pulseTl?.kill();
      gsap.killTweensOf([s.dims, s.fx, s.rim, s.ink]);
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={ canvasRef } className="tour-goo" aria-hidden="true" />;
});

export default InkGoo;
