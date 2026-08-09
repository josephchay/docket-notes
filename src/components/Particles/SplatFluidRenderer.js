import * as THREE from "three";

// The rendering half of scaling FluidField.jsx/FluidVisualizer.jsx past a
// couple hundred particles. Both files previously rendered their metaball
// field with a single fullscreen-quad fragment shader that looped over
// every particle as a GLSL uniform array (`uBalls[N]`) — O(N) *per pixel*,
// paid again on every one of ~1-2M pixels a frame, and N itself was capped
// by GL_MAX_FRAGMENT_UNIFORM_VECTORS long before it got anywhere near
// "thousands of particles". That approach was the right one for N≈100-130;
// it doesn't scale further.
//
// This replaces it with the standard technique for particle-density fields
// at scale: splat each particle as a small GPU point sprite with a gaussian
// falloff, additively accumulated (hardware blending, not a shader loop)
// into an offscreen float render target — one pass, O(N) total, GPU-
// parallel across particles rather than serial across pixels. A second,
// genuinely O(1)-per-pixel fullscreen pass then reads that accumulated
// field and applies *the exact same* smoothstep/blend math the old inline
// loop used, so the visual result — body, rim, per-particle color blend —
// is unchanged; only how the field gets built changed.
//
// A third, independent point layer renders foam/spray sprites (see
// utils/sphFoam.js) directly on top, with ordinary alpha blending rather
// than into the additive field — foam is decoration on the fluid's
// surface, not part of the density field itself.
//
// A fourth, optional contribution: a caller running a real wave-equation
// height field (utils/waveField.js) can hand it in via setRippleGrid(),
// which the resolve pass folds into the same pseudo-normal the density
// field's own gradient already builds — a passing ripple visibly bends the
// existing specular highlight, real bump-mapping fed by a simulated height
// field rather than a texture. Opt-in and harmless unused: a caller that
// never calls setRippleGrid keeps sampling a tiny all-zero placeholder
// texture, which contributes nothing (the gradient of a constant is zero).

THREE.ColorManagement.enabled = false;

const PASSTHROUGH_VERT = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// uResolution here is in CSS pixels — the same space callers already
// compute particle positions in (see FluidField.jsx/FluidVisualizer.jsx's
// own `px = p.x * scaleX` etc.) — so callers don't need a second,
// dpr-scaled coordinate system just for this renderer. gl_PointSize is the
// one genuinely dpr-sensitive quantity (WebGL always sizes points in real
// framebuffer pixels), so it's the only place uDpr gets applied.
const SPLAT_VERT = `
  uniform vec2 uResolution;
  uniform float uDpr;
  uniform float uPointRadius;
  attribute vec3 aColor;
  varying vec3 vColor;

  void main() {
    vec2 ndc = (position.xy / uResolution) * 2.0 - 1.0;
    ndc.y = -ndc.y;
    gl_Position = vec4(ndc, 0.0, 1.0);
    gl_PointSize = uPointRadius * 2.0 * uDpr;
    vColor = aColor;
  }
`;

// gl_PointCoord spans the point sprite's own bounding square in 0..1; `d`
// re-centers and normalizes it to -1..1 so that d's own magnitude is
// exactly "distance from center, in units of uPointRadius" — the same
// gaussian shape the old per-pixel loop used (exp(-dist²/r²)), just with
// dist and r both pre-divided out to dist²=dot(d,d) directly. Written to
// both the color (premultiplied by weight) and alpha channels of a
// CustomBlending ONE/ONE additive target — see the renderer's blend setup
// below for why plain ONE/ONE, not SRC_ALPHA, is what makes the resolve
// pass's `acc.rgb / acc.a` unweighting come out correct.
const SPLAT_FRAG = `
  precision highp float;
  varying vec3 vColor;

  void main() {
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    float dist2 = dot(d, d);
    float w = exp(-dist2);
    if (w < 0.006) discard;
    gl_FragColor = vec4(vColor * w, w);
  }
`;

// The same body/rim/blend math FluidField.jsx's and FluidVisualizer.jsx's
// own fragment shaders originally used inline (field/blended now come from
// a texture sample of the splat target instead of a loop over uBalls[]),
// plus a directional gloss pass on top: a cheap pseudo-normal from the
// field's own screen-space gradient stands in for a real surface normal —
// there isn't one, this is a 2D density field, not real 3D geometry — the
// same idea ordinary bump-mapping uses when there's nothing but a height/
// density map to shade from. Steep where the metaball surface curls away
// from the viewer (near an edge), flat in the body's interior; lit from a
// fixed upper-left direction the same way every other rendered surface in
// this app already reads as lit (ParticleCuboid.jsx's lattice, InkGoo.jsx's
// blob) rather than inventing a new lighting convention just for this.
// Alpha/discard behavior is untouched from the original — this only
// enriches the RGB computation, so it carries none of the premultiplied-
// alpha correctness concerns a genuinely translucent edge would.
const RESOLVE_FRAG = `
  precision highp float;
  uniform sampler2D uField;
  uniform vec2 uPhysResolution;
  uniform vec3 uRim;
  uniform vec3 uBg;
  uniform vec3 uHighlight;
  uniform sampler2D uRipple;
  uniform vec2 uRippleTexel;
  uniform float uRippleStrength;

  void main() {
    vec2 texel = 1.0 / uPhysResolution;
    vec2 uv = gl_FragCoord.xy / uPhysResolution;
    vec4 acc = texture2D(uField, uv);
    float field = acc.a;

    vec3 blended = field > 0.0001 ? acc.rgb / field : uRim;
    float body = smoothstep(0.5, 0.56, field);
    float rimBand = smoothstep(0.5, 0.6, field) * (1.0 - smoothstep(0.6, 1.05, field));
    vec3 col = mix(blended, uRim, rimBand * 0.5);

    if (body < 0.01) discard;

    float fL = texture2D(uField, uv - vec2(texel.x, 0.0)).a;
    float fR = texture2D(uField, uv + vec2(texel.x, 0.0)).a;
    float fD = texture2D(uField, uv - vec2(0.0, texel.y)).a;
    float fU = texture2D(uField, uv + vec2(0.0, texel.y)).a;

    // The wave-equation ripple field (utils/waveField.js) rides in as a
    // second, independent contribution to the same pseudo-normal the
    // density field's own gradient already builds — real water rendering
    // perturbs its surface normal from a wave heightfield exactly this way
    // (this *is* bump-mapping, just fed by a simulated height field instead
    // of a texture), so a passing ripple visibly bends the existing
    // specular highlight and shading rather than needing a second, separate
    // shading pass of its own.
    float rL = texture2D(uRipple, uv - vec2(uRippleTexel.x, 0.0)).r;
    float rR = texture2D(uRipple, uv + vec2(uRippleTexel.x, 0.0)).r;
    float rD = texture2D(uRipple, uv - vec2(0.0, uRippleTexel.y)).r;
    float rU = texture2D(uRipple, uv + vec2(0.0, uRippleTexel.y)).r;

    vec3 normal = normalize(vec3(
      (fL - fR) * 14.0 + (rL - rR) * uRippleStrength,
      (fD - fU) * 14.0 + (rD - rU) * uRippleStrength,
      1.0
    ));
    vec3 lightDir = normalize(vec3(-0.45, 0.65, 0.6));

    float sheen = max(dot(normal, lightDir), 0.0);
    float specular = pow(sheen, 30.0);

    // Directional shading — a touch darker away from the light, brighter
    // toward it — so the body reads as a rounded, lit surface rather than
    // a flat tint; the specular term on top is the tight glassy highlight
    // itself, not the broader sheen gradient.
    col = mix(col * 0.88, mix(col, uHighlight, 0.25), sheen);
    col += uHighlight * specular * 0.85;

    // Depth/thickness: field keeps climbing past the body threshold
    // wherever splats pile up more densely — the pool's own deep interior,
    // a thick splash core — the same way looking through more real liquid
    // reads as darker and more saturated, not just a flat-tinted silhouette
    // regardless of how much of it a ray actually passed through. Range
    // starts well above the 0.56 body edge so this only ever deepens
    // already-thick regions, never thins the rim itself.
    float thickness = smoothstep(0.65, 2.4, field);
    col = mix(col, col * 0.62, thickness * 0.55);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const FOAM_VERT = `
  uniform vec2 uResolution;
  uniform float uDpr;
  attribute float aRadius;
  attribute float aAlpha;
  varying float vAlpha;

  void main() {
    vec2 ndc = (position.xy / uResolution) * 2.0 - 1.0;
    ndc.y = -ndc.y;
    gl_Position = vec4(ndc, 0.0, 1.0);
    gl_PointSize = aRadius * 2.0 * uDpr;
    vAlpha = aAlpha;
  }
`;

// A soft round dot (not a gaussian field contributor — foam isn't part of
// the additive density field, see file header) that fades per-sprite via
// aAlpha, which callers drive from FoamPool's own life/maxLife ratio. Dead
// slots (alpha ~ 0, see FoamPool) simply discard here rather than needing
// a separate "don't even upload this one" path — the whole fixed-capacity
// buffer is always drawn.
const FOAM_FRAG = `
  precision highp float;
  uniform vec3 uFoamColor;
  varying float vAlpha;

  void main() {
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    float dist = length(d);
    float edge = 1.0 - smoothstep(0.55, 1.0, dist);
    float a = edge * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uFoamColor, a);
  }
`;

export class SplatFluidRenderer {
  constructor(canvas, { foamCapacity = 0 } = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    // Manual clearing throughout render() below — the three separate
    // passes (splat-to-target, resolve-to-canvas, foam-on-top-of-canvas)
    // need three different clear behaviors (clear target, clear canvas,
    // *don't* clear canvas) that three.js's own per-render autoClear can't
    // express across passes sharing one canvas.
    renderer.autoClear = false;
    this.renderer = renderer;
    this.dpr = dpr;

    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadCamera = quadCamera;

    this.splatTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.splatUniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: dpr },
      uPointRadius: { value: 6 },
    };
    const splatGeometry = new THREE.BufferGeometry();
    const splatMaterial = new THREE.ShaderMaterial({
      uniforms: this.splatUniforms,
      vertexShader: SPLAT_VERT,
      fragmentShader: SPLAT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.splatMaterial = splatMaterial;
    this.splatPoints = new THREE.Points(splatGeometry, splatMaterial);
    // The vertex shaders above compute gl_Position directly from raw
    // pixel-space positions divided by uResolution — they never go through
    // quadCamera's own projection/view matrices at all. Three's default
    // CPU-side frustum culling doesn't know that: it tests the geometry's
    // bounding sphere (centered somewhere like (240, 180, 0), radius ~300+
    // once real particle positions are written) against quadCamera's own
    // tiny -1..1 frustum, always concludes it's entirely outside, and
    // silently skips rendering the object — no error, no console warning,
    // just an empty canvas. Off, since that culling test is meaningless for
    // a shader that ignores the camera to begin with.
    this.splatPoints.frustumCulled = false;
    this.splatScene = new THREE.Scene();
    this.splatScene.add(this.splatPoints);

    // A harmless 1×1-cell (2×2-texel) all-zero placeholder — a gradient of
    // a constant field is zero, so this contributes nothing to the normal
    // calculation until (if ever) a caller opts in via setRippleGrid()
    // below. Callers that never touch ripples at all (FluidField.jsx, as of
    // this writing) pay for one tiny never-updated texture and nothing more.
    this.rippleCols = 2;
    this.rippleRows = 2;
    this.rippleData = new Float32Array(4);
    this.rippleTexture = new THREE.DataTexture(this.rippleData, 2, 2, THREE.RedFormat, THREE.FloatType);
    this.rippleTexture.minFilter = THREE.LinearFilter;
    this.rippleTexture.magFilter = THREE.LinearFilter;
    this.rippleTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.rippleTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.rippleTexture.needsUpdate = true;

    this.resolveUniforms = {
      uField: { value: this.splatTarget.texture },
      uPhysResolution: { value: new THREE.Vector2(1, 1) },
      uRim: { value: new THREE.Color("#fffeff") },
      uBg: { value: new THREE.Color("#fffeff") },
      // A warm near-white default — real glass/liquid specular highlights
      // read as bright and roughly neutral regardless of the fluid's own
      // body color, so callers don't need to pick a per-theme highlight
      // just to get a believable gloss; setHighlight() below is there for
      // whoever eventually wants to override it anyway.
      uHighlight: { value: new THREE.Color("#fffdf6") },
      uRipple: { value: this.rippleTexture },
      uRippleTexel: { value: new THREE.Vector2(0.5, 0.5) },
      // Defaults on (not 0) since the placeholder texture above is already
      // harmless on its own — a caller with a real ripple field (see
      // setRippleGrid) doesn't also need to remember to turn this on.
      uRippleStrength: { value: 0.55 },
    };
    const resolveMaterial = new THREE.ShaderMaterial({
      uniforms: this.resolveUniforms,
      vertexShader: PASSTHROUGH_VERT,
      fragmentShader: RESOLVE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.resolveMaterial = resolveMaterial;
    this.resolveScene = new THREE.Scene();
    this.resolveScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), resolveMaterial));

    this.foamCapacity = foamCapacity;
    if (foamCapacity > 0) {
      this.foamPositions = new Float32Array(foamCapacity * 3);
      this.foamRadii = new Float32Array(foamCapacity);
      this.foamAlphas = new Float32Array(foamCapacity);

      const foamGeometry = new THREE.BufferGeometry();
      foamGeometry.setAttribute("position", new THREE.BufferAttribute(this.foamPositions, 3));
      foamGeometry.setAttribute("aRadius", new THREE.BufferAttribute(this.foamRadii, 1));
      foamGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.foamAlphas, 1));

      this.foamUniforms = {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uDpr: { value: dpr },
        uFoamColor: { value: new THREE.Color("#ffffff") },
      };
      const foamMaterial = new THREE.ShaderMaterial({
        uniforms: this.foamUniforms,
        vertexShader: FOAM_VERT,
        fragmentShader: FOAM_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      this.foamMaterial = foamMaterial;
      this.foamPoints = new THREE.Points(foamGeometry, foamMaterial);
      // Same reason as splatPoints above — this vertex shader also
      // computes gl_Position directly from pixel-space positions, bypassing
      // quadCamera entirely, so its default frustum culling is meaningless
      // (and would wrongly cull the whole layer).
      this.foamPoints.frustumCulled = false;
      this.foamScene = new THREE.Scene();
      this.foamScene.add(this.foamPoints);
    }

    this._cssW = 1;
    this._cssH = 1;
  }

  // Called once per instance — these two files' particle counts are fixed
  // for the lifetime of a mount (set from props at effect-setup time), so
  // there's no need for this to handle a changing count later.
  setFieldCount(n) {
    this.fieldCount = n;
    this.fieldPositions = new Float32Array(n * 3);
    this.fieldColors = new Float32Array(n * 3);
    const geom = this.splatPoints.geometry;
    geom.setAttribute("position", new THREE.BufferAttribute(this.fieldPositions, 3));
    geom.setAttribute("aColor", new THREE.BufferAttribute(this.fieldColors, 3));
  }

  setSize(cssW, cssH) {
    this._cssW = cssW;
    this._cssH = cssH;
    this.renderer.setSize(cssW, cssH, false);

    this.splatUniforms.uResolution.value.set(cssW, cssH);
    if (this.foamUniforms) this.foamUniforms.uResolution.value.set(cssW, cssH);

    const pw = Math.max(1, Math.round(cssW * this.dpr));
    const ph = Math.max(1, Math.round(cssH * this.dpr));
    this.splatTarget.setSize(pw, ph);
    this.resolveUniforms.uPhysResolution.value.set(pw, ph);
  }

  setPointRadius(cssRadius) {
    this.splatUniforms.uPointRadius.value = cssRadius;
  }

  setTint(rimCss, bgCss) {
    this.resolveUniforms.uRim.value.set(rimCss);
    this.resolveUniforms.uBg.value.set(bgCss);
  }

  setHighlight(css) {
    this.resolveUniforms.uHighlight.value.set(css);
  }

  setFoamColor(css) {
    if (this.foamUniforms) this.foamUniforms.uFoamColor.value.set(css);
  }

  // Opt-in — replaces the harmless 2×2 placeholder from the constructor
  // with a real cols×rows single-channel float texture. Called once per
  // instance, same lifetime contract as setFieldCount above: a caller
  // wanting ripples (FluidVisualizer.jsx) sizes this once from its own
  // domainW/domainH at effect-setup time. `rippleData` is exposed directly
  // — same convention as `fieldPositions`/`fieldColors`/`foamPositions`
  // elsewhere in this file — so a caller drives it every frame with a
  // plain `renderer.rippleData.set(waveField.height)` rather than going
  // through a setter call.
  setRippleGrid(cols, rows) {
    this.rippleCols = cols;
    this.rippleRows = rows;
    this.rippleData = new Float32Array(cols * rows);
    this.rippleTexture.dispose();
    this.rippleTexture = new THREE.DataTexture(this.rippleData, cols, rows, THREE.RedFormat, THREE.FloatType);
    this.rippleTexture.minFilter = THREE.LinearFilter;
    this.rippleTexture.magFilter = THREE.LinearFilter;
    this.rippleTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.rippleTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.resolveUniforms.uRipple.value = this.rippleTexture;
    this.resolveUniforms.uRippleTexel.value.set(1 / cols, 1 / rows);
  }

  setRippleStrength(v) {
    this.resolveUniforms.uRippleStrength.value = v;
  }

  render() {
    const geom = this.splatPoints.geometry;
    geom.attributes.position.needsUpdate = true;
    geom.attributes.aColor.needsUpdate = true;
    geom.setDrawRange(0, this.fieldCount);

    this.rippleTexture.needsUpdate = true;

    this.renderer.setRenderTarget(this.splatTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.splatScene, this.quadCamera);

    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.resolveScene, this.quadCamera);

    if (this.foamCapacity > 0) {
      const foamGeom = this.foamPoints.geometry;
      foamGeom.attributes.position.needsUpdate = true;
      foamGeom.attributes.aRadius.needsUpdate = true;
      foamGeom.attributes.aAlpha.needsUpdate = true;
      // No clear() before this one — drawn straight on top of whatever the
      // resolve pass just left in the canvas.
      this.renderer.render(this.foamScene, this.quadCamera);
    }
  }

  dispose() {
    this.splatPoints.geometry.dispose();
    this.splatMaterial.dispose();
    this.splatTarget.dispose();
    this.resolveScene.children[0].geometry.dispose();
    this.resolveMaterial.dispose();
    this.rippleTexture.dispose();
    if (this.foamCapacity > 0) {
      this.foamPoints.geometry.dispose();
      this.foamMaterial.dispose();
    }
    this.renderer.dispose();
  }
}
