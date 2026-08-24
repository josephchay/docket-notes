import React, { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import gsap from "gsap";

import "./ThemeWipe.css";

const RESTING_DIAMETER = 56; // px, matches the CSS-fallback .theme-wipe

// Up to this many washes can be visibly in flight at once — a second
// toggle fired before the first finishes gets its own bloom instead of
// killing/replacing it, and the two fuse at the edge (see smin in
// FRAGMENT) instead of one hard-cutting the other. Rapid-fire toggling
// beyond this cap drops the oldest bloom early to make room.
const MAX_BLOOMS = 2;
// Thin ink-capillary flecks that race ahead of the newest bloom's own
// edge, at a few random angles — TENDRIL_LEAD_SCALE > 1 so they reach a
// given point in space before the main wash does.
const TENDRIL_COUNT = 3;
const TENDRIL_LEAD_SCALE = 1.18;
const TENDRIL_RADIUS = 26; // CSS px, fixed — these read as flecks, not a second bloom
// How far apart two blooms' own edges can be and still visibly fuse
// (smin's blend radius, in the same px units the shader's `sd` uses).
const SMIN_K = 40;

const VERTEX = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Up to 2 organic ink-blooms — each a metaball-style distance field whose
// edge is wobbled by a few stacked sine terms (the same "wobbly ring"
// trick CursorAura and InkGoo use for their own rims) — combined via a
// polynomial smooth-min so two overlapping washes fuse into one soft edge
// instead of one flatly overdrawing the other, plus a handful of thin
// tendril flecks that lead just ahead of the newest bloom's own edge.
const FRAGMENT = `
precision highp float;

uniform vec2 uOrigin[2];   // canvas px, y-down source flipped to y-up below
uniform float uRadius[2];  // CSS px
uniform vec3 uColor[2];
uniform float uAlpha[2];
uniform float uActive[2];
uniform vec2 uTendrilOrigin[3];
uniform float uTendrilActive[3];
uniform float uTendrilRadius;
uniform float uTendrilAlpha;
uniform vec3 uTendrilColor;
uniform float uTime;
uniform float uRatio;   // canvas px per CSS px

// A fine per-fragment hash — screen-space, not per-bloom-angle, so it
// reads as texture fixed to the page (paper fiber) rather than orbiting
// with a bloom's own polar angle.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float wobbleRadius(vec2 p, vec2 d, float baseR) {
  float ang = atan(d.y, d.x);
  float wobble = sin(ang * 3.0 + uTime * 1.6) * 0.035
    + sin(ang * 5.0 - uTime * 2.3) * 0.02
    + sin(ang * 7.0 + uTime * 3.1) * 0.012;
  // Only meaningfully visible right at the edge band itself — a deep
  // interior fragment stays fully opaque and a deep exterior one stays
  // fully clear regardless of a few px of radius jitter, the same reason
  // the angular wobble above never needed its own proximity mask either.
  float grain = (hash(p * 0.06) - 0.5) * 5.0;
  return baseR * (1.0 + wobble) + grain;
}

// Polynomial smooth-min (Inigo Quilez's classic formulation): blends two
// signed distances so two overlapping blooms fuse into one soft edge.
// Degrades to plain min() once the two are farther apart than ~k, and to
// exactly a alone when b is the huge "inactive" sentinel below.
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  float blur = 22.0;

  float sd0 = 1.0e6;
  float sd1 = 1.0e6;
  vec3 col0 = vec3(0.0);
  vec3 col1 = vec3(0.0);
  float a0 = 0.0;
  float a1 = 0.0;

  if (uActive[0] > 0.5) {
    vec2 d = p - uOrigin[0];
    float dist = length(d) / uRatio;
    float r = wobbleRadius(p, d, uRadius[0]);
    sd0 = dist - r;
    col0 = uColor[0];
    a0 = uAlpha[0];
  }
  if (uActive[1] > 0.5) {
    vec2 d = p - uOrigin[1];
    float dist = length(d) / uRatio;
    float r = wobbleRadius(p, d, uRadius[1]);
    sd1 = dist - r;
    col1 = uColor[1];
    a1 = uAlpha[1];
  }

  float sd = smin(sd0, sd1, ${ SMIN_K.toFixed(1) });
  float edge = 1.0 - smoothstep(-blur, 0.0, sd);
  // Whichever bloom's own raw (unmerged) edge is actually closer at this
  // fragment wins the color/alpha — not an RGB blend, since two different
  // ink colors overlapping should read as one winning over the other
  // right at the seam, not muddying into a third, off-palette tone.
  vec3 col = sd0 <= sd1 ? col0 : col1;
  float alpha = sd0 <= sd1 ? a0 : a1;
  float a = edge * alpha;

  // Tendril flecks: independent thin circular falloffs, composited UNDER
  // the main bloom(s) (standard premultiplied "over" blend) — where a
  // tendril and the main wash both cover a fragment, the wash wins, since
  // by the time it's actually arrived there a lead fleck is indistinguishable
  // from more of the same ink.
  float tendril = 0.0;
  for (int t = 0; t < 3; t++) {
    if (uTendrilActive[t] < 0.5) continue;
    float td = length(p - uTendrilOrigin[t]) / uRatio;
    tendril = max(tendril, 1.0 - smoothstep(0.0, uTendrilRadius, td));
  }
  float ta = tendril * uTendrilAlpha;

  vec3 outColor = col * a + uTendrilColor * ta * (1.0 - a);
  float outAlpha = a + ta * (1.0 - a);
  gl_FragColor = vec4(outColor, outAlpha);
}
`;

const hexToUnit = (hex) => {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
};

// The GPU-shaded bloom(s): a persistent, transparent fullscreen canvas
// that stays inert (nothing drawn) until a `wipe` or a drag-driven
// `preview` comes in. Mirrors CursorAura's raw-WebGL compile/teardown
// discipline — no three.js needed for a couple of shapes.
const ThemeWipeGL = ({ wipe, preview }) => {
  const canvasRef = useRef(null);
  const drawRef = useRef(null);
  const bloomsRef = useRef([]); // live { key, originX, originY, reach, color, state, tendrilAngles, tween }
  const previewTweenRef = useRef(null);
  const lastPreviewRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) return undefined;

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };

    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return undefined;

    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      origin: gl.getUniformLocation(program, "uOrigin"),
      radius: gl.getUniformLocation(program, "uRadius"),
      color: gl.getUniformLocation(program, "uColor"),
      alpha: gl.getUniformLocation(program, "uAlpha"),
      active: gl.getUniformLocation(program, "uActive"),
      tendrilOrigin: gl.getUniformLocation(program, "uTendrilOrigin"),
      tendrilActive: gl.getUniformLocation(program, "uTendrilActive"),
      tendrilRadius: gl.getUniformLocation(program, "uTendrilRadius"),
      tendrilAlpha: gl.getUniformLocation(program, "uTendrilAlpha"),
      tendrilColor: gl.getUniformLocation(program, "uTendrilColor"),
      time: gl.getUniformLocation(program, "uTime"),
      ratio: gl.getUniformLocation(program, "uRatio"),
    };

    let ratio = 1;
    const resize = () => {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();

    // blooms: up to 2 { originX, originY, radius, color:[r,g,b], alpha }
    // tendrils: null, or { positions:[{x,y}...], color:[r,g,b], alpha }
    const draw = ({ blooms = [], tendrils = null }) => {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const originArr = new Float32Array(4);
      const radiusArr = new Float32Array(2);
      const colorArr = new Float32Array(6);
      const alphaArr = new Float32Array(2);
      const activeArr = new Float32Array(2);

      let anyVisible = false;
      for (let i = 0; i < 2; i++) {
        const b = blooms[i];
        if (b && b.alpha > 0.001 && b.radius > 0) {
          originArr[i * 2] = b.originX * ratio;
          originArr[i * 2 + 1] = canvas.height - b.originY * ratio;
          radiusArr[i] = b.radius;
          colorArr[i * 3] = b.color[0];
          colorArr[i * 3 + 1] = b.color[1];
          colorArr[i * 3 + 2] = b.color[2];
          alphaArr[i] = b.alpha;
          activeArr[i] = 1;
          anyVisible = true;
        }
      }

      const tendrilOriginArr = new Float32Array(6);
      const tendrilActiveArr = new Float32Array(3);
      let tendrilAlpha = 0;
      let tendrilColor = [0, 0, 0];
      if (tendrils && tendrils.alpha > 0.001) {
        tendrils.positions.forEach((pos, i) => {
          tendrilOriginArr[i * 2] = pos.x * ratio;
          tendrilOriginArr[i * 2 + 1] = canvas.height - pos.y * ratio;
          tendrilActiveArr[i] = 1;
        });
        tendrilAlpha = tendrils.alpha;
        tendrilColor = tendrils.color;
        anyVisible = true;
      }

      if (!anyVisible) return;

      gl.uniform2fv(uniforms.origin, originArr);
      gl.uniform1fv(uniforms.radius, radiusArr);
      gl.uniform3fv(uniforms.color, colorArr);
      gl.uniform1fv(uniforms.alpha, alphaArr);
      gl.uniform1fv(uniforms.active, activeArr);
      gl.uniform2fv(uniforms.tendrilOrigin, tendrilOriginArr);
      gl.uniform1fv(uniforms.tendrilActive, tendrilActiveArr);
      gl.uniform1f(uniforms.tendrilRadius, TENDRIL_RADIUS);
      gl.uniform1f(uniforms.tendrilAlpha, tendrilAlpha);
      gl.uniform3f(uniforms.tendrilColor, tendrilColor[0], tendrilColor[1], tendrilColor[2]);
      gl.uniform1f(uniforms.time, performance.now() / 1000);
      gl.uniform1f(uniforms.ratio, ratio);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    drawRef.current = draw;

    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      bloomsRef.current.forEach((b) => b.tween?.kill());
      bloomsRef.current = [];
      previewTweenRef.current?.kill();
      drawRef.current = null;
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
    };
  }, []);

  // Redraws every currently-live bloom (up to MAX_BLOOMS) plus the newest
  // bloom's own lead tendrils, called from each bloom's GSAP onUpdate.
  const redrawAll = () => {
    if (!drawRef.current) return;
    const blooms = bloomsRef.current.map((b) => ({
      originX: b.originX,
      originY: b.originY,
      radius: b.state.progress * b.reach * 1.06,
      color: b.color,
      alpha: b.state.alpha,
    }));
    const latest = bloomsRef.current[bloomsRef.current.length - 1];
    const tendrils = latest
      ? {
          positions: latest.tendrilAngles.map((ang) => {
            const lead = Math.min(latest.state.progress * TENDRIL_LEAD_SCALE, 1) * latest.reach;
            return {
              x: latest.originX + Math.cos(ang) * lead,
              y: latest.originY + Math.sin(ang) * lead,
            };
          }),
          color: latest.color,
          alpha: latest.state.alpha,
        }
      : null;
    drawRef.current({ blooms, tendrils });
  };

  useEffect(() => {
    if (!wipe || !drawRef.current) return undefined;

    const reach = Math.hypot(
      Math.max(wipe.x, window.innerWidth - wipe.x),
      Math.max(wipe.y, window.innerHeight - wipe.y)
    );
    const color = hexToUnit(wipe.color);
    const startProgress = Math.min(1, Math.max(0, wipe.startProgress || 0));
    // Matches the preview effect's own alpha formula exactly (progress *
    // 1.4, capped at 1) so a bloom picking up mid-drag continues from the
    // same alpha the last preview frame was actually showing instead of
    // popping straight to fully opaque.
    const state = { progress: startProgress, alpha: startProgress > 0 ? Math.min(1, startProgress * 1.4) : 1 };
    const tendrilAngles = Array.from({ length: TENDRIL_COUNT }, () => Math.random() * Math.PI * 2);

    // Cap concurrent blooms: a rapid extra toggle beyond MAX_BLOOMS kills
    // the oldest one early to make room, rather than growing unbounded.
    if (bloomsRef.current.length >= MAX_BLOOMS) {
      const oldest = bloomsRef.current.shift();
      oldest?.tween?.kill();
      redrawAll(); // otherwise the killed bloom's last frame lingers until the next tick's own onUpdate
    }

    const bloom = { key: wipe.key, originX: wipe.x, originY: wipe.y, reach, color, state, tendrilAngles, tween: null };
    bloomsRef.current.push(bloom);

    // A wash that's picking up mid-drag (startProgress > 0) has less
    // distance left to cover, so its own expand duration — and the point
    // at which the fade-out kicks in — both scale down proportionally
    // instead of replaying the full 0.85s from scratch.
    const expandDuration = 0.85 * (1 - startProgress);
    const fadeStart = expandDuration * (0.64 / 0.85);

    const tween = gsap.timeline({
      onUpdate: redrawAll,
      onComplete: () => {
        bloomsRef.current = bloomsRef.current.filter((b) => b !== bloom);
        redrawAll();
      },
    })
      .to(state, { progress: 1, duration: expandDuration, ease: "elastic.out(0.65, 0.8)" }, 0)
      .to(state, { alpha: 0, duration: .28, ease: "power1.in" }, fadeStart);
    bloom.tween = tween;

    return undefined;
  }, [wipe]);

  // Live drag preview: tracks the pointer directly (no GSAP/timeline)
  // through the exact same origin/reach/radius math the committed wash
  // above uses, so the two scales match exactly and a mid-drag release
  // (see Home.jsx's commitThemePreview) hands off with no visible jump —
  // the committed timeline just keeps going from wherever this left off.
  useEffect(() => {
    if (preview) {
      lastPreviewRef.current = preview;
      previewTweenRef.current?.kill();
      if (!drawRef.current) return undefined;
      const reach = Math.hypot(
        Math.max(preview.x, window.innerWidth - preview.x),
        Math.max(preview.y, window.innerHeight - preview.y)
      );
      drawRef.current({
        blooms: [{
          originX: preview.x,
          originY: preview.y,
          radius: preview.progress * reach * 1.06,
          color: hexToUnit(preview.color),
          alpha: Math.min(1, preview.progress * 1.4),
        }],
        tendrils: null,
      });
      return undefined;
    }

    // Preview cleared: if a commit just happened, `wipe` is already truthy
    // in this same render and its own bloom effect above takes over
    // drawing from here with no gap — only ease back to nothing on a
    // genuine cancel (released before the commit threshold).
    const last = lastPreviewRef.current;
    lastPreviewRef.current = null;
    if (!last || wipe || !drawRef.current) return undefined;

    const reach = Math.hypot(
      Math.max(last.x, window.innerWidth - last.x),
      Math.max(last.y, window.innerHeight - last.y)
    );
    const color = hexToUnit(last.color);
    const retreat = { radius: last.progress * reach * 1.06, alpha: Math.min(1, last.progress * 1.4) };
    previewTweenRef.current?.kill();
    previewTweenRef.current = gsap.to(retreat, {
      radius: 0,
      alpha: 0,
      duration: 0.32,
      ease: "power2.out",
      onUpdate: () => drawRef.current?.({
        blooms: [{ originX: last.x, originY: last.y, radius: retreat.radius, color, alpha: retreat.alpha }],
        tendrils: null,
      }),
    });
    return undefined;
  }, [preview, wipe]);

  return (
    <canvas
      ref={ canvasRef }
      className="theme-wipe-gl"
      aria-hidden="true"
    />
  );
};

// The page doesn't just crossfade between paper and ink — a drop of the new
// page color blooms from wherever the theme button was pressed and washes
// clean over the whole desk. On a capable, motion-friendly browser that
// bloom is a real organic ink shape (ThemeWipeGL, above); otherwise this
// falls back to the original scaling circle, which overshoots into a fat
// bloom before settling. Either way the CSS variables have already swapped
// underneath by the time it's covering everything, so the fade-out at the
// end is seamless — the drop is just cleaning up after itself. `preview`
// (a live drag-preview state from Home.jsx) is only ever consumed by the
// capable GL path — the CSS fallback stays a plain one-shot click, since
// prefers-reduced-motion and no-WebGL browsers are exactly the ones a
// draggable live-growing preview matters least to.
const ThemeWipe = ({ wipe, preview }) => {
  const capableRef = useRef(null);
  if (capableRef.current === null) {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let webgl = false;
    try {
      const test = document.createElement("canvas");
      webgl = !!(test.getContext("webgl") || test.getContext("experimental-webgl"));
    } catch {
      webgl = false;
    }
    capableRef.current = webgl && !reducedMotion;
  }

  if (capableRef.current) return <ThemeWipeGL wipe={ wipe } preview={ preview } />;

  const reach = wipe
    ? Math.hypot(
        Math.max(wipe.x, window.innerWidth - wipe.x),
        Math.max(wipe.y, window.innerHeight - wipe.y)
      )
    : 0;
  const scale = (reach * 2.2) / RESTING_DIAMETER;

  return (
    <AnimatePresence>
      {
        wipe && (
          <motion.span
            key={ wipe.key }
            aria-hidden="true"
            className="theme-wipe"
            style={{
              left: wipe.x,
              top: wipe.y,
              backgroundColor: wipe.color,
            }}
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale, opacity: [1, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{
              scale: { type: "spring", stiffness: 85, damping: 13.5, mass: 1 },
              opacity: { duration: .9, times: [0, .72, 1], ease: "easeInOut" },
            }}
          />
        )
      }
    </AnimatePresence>
  );
};

export default ThemeWipe;
