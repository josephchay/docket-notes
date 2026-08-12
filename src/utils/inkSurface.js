import * as THREE from "three";

import { WaveField } from "./waveField";

// A liquid ink surface the note constellation floats on — utils/
// waveField.js's verified 2D wave-equation solver (the exact same class
// FluidVisualizer already ripples with) stepped on the CPU in the graph's
// own domain space, rendered as a fullscreen fragment shader that shades
// each pixel from the height field: |h| pools ink, the height gradient
// adds a sheen along wavefronts, and the height field's own curvature
// (its Laplacian) throws real caustics — the cheap, standard "focus where
// the surface is concave" approximation, needing no second ray-marched
// pass, since the four neighbor taps the gradient already samples hand
// the Laplacian its stencil for free. The same split HistoryConstellation.jsx
// already established for WebGL work in this app — physics in plain JS
// where it can be hand-verified, shaders doing only the per-pixel part
// nothing else can do cheaply.
//
// The shader receives the SVG camera's own translate/zoom as a uniform and
// inverts it per pixel (screen → world → domain → texture), so ripples are
// pinned to the graph's world space — pan the camera and the rings pan
// with it, exactly as if the notes really were sitting in a pool — rather
// than being wallpaper stuck to the viewport.
//
// CFL stability (see waveField.js's own von Neumann derivation): r =
// c·dt/cell must stay ≤ 1/√2. With WAVE_SPEED = 16 and the cell size a
// 96-column grid gives a 160-unit domain (1.667), the bound allows dt up
// to ≈ 0.0736s — comfortably above the 0.05s frame clamp the caller's own
// tick loop already enforces, so a single step per frame is
// unconditionally stable with margin to spare.
const GRID_COLS = 96;
const WAVE_SPEED = 16;
const WAVE_DAMPING = 0.982;

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = `
  precision mediump float;

  varying vec2 vUv;

  uniform sampler2D uHeight;
  uniform vec2 uResolution; // CSS pixels
  uniform vec3 uView;       // camera x, y (px), zoom
  uniform vec2 uScale;      // px per domain unit
  uniform vec2 uTexel;      // one height-texture texel, in uv units
  uniform vec3 uInk;
  uniform float uTime;      // seconds, the same simTime the physics itself runs on

  // Height is packed into a uint8 channel as (h * 0.5 + 0.5) — see
  // InkSurface.upload — so unpacking is the inverse affine map.
  float heightAt(vec2 tuv) {
    return texture2D(uHeight, tuv).r * 2.0 - 1.0;
  }

  void main() {
    // vUv has GL's y-up convention; the camera uniforms live in the DOM's
    // y-down convention — flip once here so every coordinate after this
    // line speaks DOM.
    vec2 screenPx = vec2(vUv.x, 1.0 - vUv.y) * uResolution;
    vec2 worldPx = (screenPx - uView.xy) / uView.z;
    // uScale already folds px-per-domain-unit together with the domain
    // extent (see render() below), so this lands directly on texture uv.
    vec2 tuv = worldPx / uScale;

    // Soft fade toward the pool's own edge — the wave field's Dirichlet
    // boundary (see waveField.js) makes the physics end there anyway;
    // this just keeps the rendering from ending in a hard rectangle.
    vec2 edge = smoothstep(0.0, 0.07, tuv) * smoothstep(0.0, 0.07, 1.0 - tuv);
    float fade = edge.x * edge.y;
    if (fade <= 0.001) discard;

    float h = heightAt(tuv);
    float hxPos = heightAt(tuv + vec2(uTexel.x, 0.0));
    float hxNeg = heightAt(tuv - vec2(uTexel.x, 0.0));
    float hyPos = heightAt(tuv + vec2(0.0, uTexel.y));
    float hyNeg = heightAt(tuv - vec2(0.0, uTexel.y));
    vec2 grad = vec2(hxPos - h, hyPos - h);

    // Two shading terms, both from the field itself: displaced water
    // carries ink (alpha from |h|, crest or trough alike — ink pools
    // wherever the surface is disturbed), and steep slopes catch a faint
    // sheen (alpha from the gradient magnitude, which traces the moving
    // wavefronts themselves).
    float body = smoothstep(0.015, 0.5, abs(h));
    float sheen = smoothstep(0.02, 0.3, length(grad));
    float alpha = (body * 0.085 + sheen * 0.05) * fade;

    // Caustics — the standard cheap real-time approximation for them:
    // light doesn't refract through this field for real (there's nothing
    // underneath to shine it onto but the desk itself), but a patch of
    // surface curving concave-up focuses a bundle of parallel rays into a
    // bright knot exactly the way a real lens would, and convex patches
    // spread them thin — so the height field's own Laplacian (curvature),
    // not the height or its slope, is what actually predicts where a
    // caustic falls. hxPos/hxNeg/hyPos/hyNeg above already hand this its
    // four corners for free; h itself is the fifth sample the five-point
    // stencil needs.
    float laplacian = hxPos + hxNeg + hyPos + hyNeg - 4.0 * h;
    float caustic = smoothstep(0.0, 0.05, laplacian);
    // A slow shimmer keyed off both position and uTime, so a caustic knot
    // never reads as a static decal — real light through moving water
    // never holds still even over a momentarily-calm patch, since the
    // water itself never is either.
    caustic *= 0.75 + 0.25 * sin(uTime * 2.2 + tuv.x * 40.0 + tuv.y * 37.0);
    caustic *= fade;

    // Mixed toward white rather than a fixed highlight color, so this
    // reads correctly against uInk's own live value (setInk swaps it per
    // theme) instead of fighting whichever ink is currently loaded — and
    // left OUT of alpha entirely when caustic is 0, so a calm, uncurved
    // patch renders byte-for-byte what it always has.
    vec3 color = mix(uInk, vec3(1.0), clamp(caustic, 0.0, 1.0));
    float causticAlpha = caustic * 0.4;

    gl_FragColor = vec4(color, clamp(alpha + causticAlpha, 0.0, 1.0));
  }
`;

export class InkSurface {
  constructor(canvas, domainW, domainH) {
    this.domainW = domainW;
    this.domainH = domainH;

    const cols = GRID_COLS;
    const cellSize = domainW / cols;
    const rows = Math.round(domainH / cellSize);
    this.wave = new WaveField(cols, rows, cellSize, { waveSpeed: WAVE_SPEED, damping: WAVE_DAMPING });

    // Height packed into uint8 (128 = flat) rather than a float texture —
    // float sampling with linear filtering still needs an extension WebGL
    // doesn't guarantee, and at the amplitudes this pool runs (|h| well
    // under 1), 7 bits per side of zero quantizes finer than the
    // smoothstep shading above can resolve anyway.
    this.texData = new Uint8Array(cols * rows * 4);
    this.texture = new THREE.DataTexture(this.texData, cols, rows, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.uniforms = {
      uHeight: { value: this.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uView: { value: new THREE.Vector3(0, 0, 1) },
      uScale: { value: new THREE.Vector2(1, 1) },
      uTexel: { value: new THREE.Vector2(1 / cols, 1 / rows) },
      uInk: { value: new THREE.Color("#191919") },
      uTime: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    this._material = material;

    this._width = 0;
    this._height = 0;
  }

  setInk(cssColor) {
    this.uniforms.uInk.value.set(cssColor);
  }

  // Domain-space splash — hands straight off to the wave field's own
  // bilinear excite.
  splash(x, y, amount) {
    this.wave.excite(x, y, amount);
  }

  // The surface slope at a domain point (see waveField.js's gradientAt) —
  // the read half of two-way coupling: splash() is how the graph pushes
  // the pool, this is how the pool pushes back.
  gradientAt(x, y) {
    return this.wave.gradientAt(x, y);
  }

  // The field's own RMS energy (see waveField.js's energy) — what the
  // ambient pool-voice sonification reads every frame.
  energy() {
    return this.wave.energy();
  }

  // Strike a standing eigenmode across the whole pool (see waveField.js's
  // exciteMode) — a splash taps the water somewhere; this strikes it
  // everywhere at once, like a bell.
  strikeMode(m, n, amount) {
    this.wave.exciteMode(m, n, amount);
  }

  step(dt) {
    this.wave.step(dt);
  }

  // One frame: pack the current heights into the texture, aim the shader's
  // inverse-camera at wherever the SVG camera currently is, draw.
  render({ width, height, cameraX, cameraY, zoom, scaleX, scaleY, time = 0 }) {
    if (width !== this._width || height !== this._height) {
      this.renderer.setSize(width, height, false);
      this._width = width;
      this._height = height;
    }

    const heights = this.wave.height;
    const data = this.texData;
    for (let i = 0; i < heights.length; i++) {
      const packed = Math.max(0, Math.min(255, Math.round(heights[i] * 127 + 128)));
      data[i * 4] = packed;
      data[i * 4 + 3] = 255;
    }
    this.texture.needsUpdate = true;

    this.uniforms.uResolution.value.set(width, height);
    this.uniforms.uView.value.set(cameraX, cameraY, zoom);
    this.uniforms.uTime.value = time;
    // px-per-domain folded together with the domain extent, so the shader
    // lands directly on texture uv: world / (scale · domain).
    this.uniforms.uScale.value.set(scaleX * this.domainW, scaleY * this.domainH);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.texture.dispose();
    this._material.dispose();
    this.scene.children.forEach((child) => child.geometry?.dispose());
    this.renderer.dispose();
  }
}
