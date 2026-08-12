import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";

import { timeAgo } from "../../utils/date";
import { resolveCssColor } from "./HistoryAmbient";
import { styleFor, DEFAULT_STYLE, magnitudeOf, capitalize, arrivalLabel } from "./HistoryPanel";

THREE.ColorManagement.enabled = false;

// A sunflower/phyllotaxis spiral rather than a real force-directed graph —
// deterministic in one pass, nothing to iterate or destabilize, and it
// still reads as a genuine constellation rather than a straight line bent
// into a circle.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPACING = 0.16;
const ROTATE_SPEED = 0.05;
const HIT_RADIUS_PX = 20;
const DRAG_ROTATE_SPEED = 0.006;
const TOUR_ZOOM = 0.55;
const GRAVITY_RADIUS = 0.42;
const GRAVITY_STRENGTH = 0.14;
const IDLE_MS = 8000;
// A real perspective camera and a helix winding through Z now, rather than
// an orthographic camera looking at a flat spiral — oldest entry furthest
// away, "now" nearest the viewer. CAMERA_REST_Z/HELIX_DEPTH_RANGE are sized
// so a long session's typical XY spread (radius up to ~1.2) sits
// comfortably inside the frustum at rest; TOUR_DOLLY_OFFSET is how far
// back along Z the camera parks from whichever node the tour is visiting,
// so it ends up beside the node looking at it rather than inside it.
const CAMERA_FOV = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 20;
const CAMERA_REST_Z = 3.2;
const HELIX_DEPTH_RANGE = 2.4;
const TOUR_DOLLY_OFFSET = 1.2;
// Manual zoom — the same zoom.value the tour's own GSAP flight already
// tweens toward TOUR_ZOOM (0.55), just now also reachable by hand. A plain
// FOV pull/push centered on screen rather than a cursor-anchored solve
// (the "keep this exact world point under the pointer" math NoteConstellation's
// 2D orthographic camera does): anchoring THAT for a perspective camera's
// own FOV change would mean also translating the camera along the view
// ray, which isn't the ask here and would make the tour's own dolly-based
// zoom (TOUR_DOLLY_OFFSET) fight this over what actually "zooming" means
// in this scene. ZOOM_MIN/MAX both sit outside TOUR_ZOOM/1 so a manual
// zoom never boxes the tour's own preferred range in.
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
// The reveal shader's own runway constant (see VERT's `* 4.0` below) needs
// a node's delay to sit at least 1/4.0 short of uReveal's own max (1) for
// that node to ever reach full size — keep this in sync with that literal.
const REVEAL_DELAY_MAX = 1 - 1 / 4.0;

const VERT = `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aActive;
  attribute float aFocused;
  attribute float aDim;
  attribute float aRevealDelay;

  uniform float uTime;
  uniform vec2 uMouseNDC;
  uniform float uTanHalfFov;
  uniform float uAspect;
  uniform float uAttenRef;
  uniform float uReveal;

  varying vec3 vColor;
  varying float vActive;
  varying float vFocused;
  varying float vDim;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // A gentle gravity well around the pointer — computed in view space
    // (post-modelView, pre-projection) so it's naturally already relative
    // to the group's current rotation and the camera's current pan/zoom,
    // without needing to separately track either here. Under a perspective
    // camera the frustum's width varies with depth, so the pointer's NDC
    // position is unprojected to view space at THIS vertex's own depth
    // (the standard screen-to-view-space formula for a perspective
    // camera) rather than a single fixed-depth view-space point — that's
    // what keeps the well feeling consistent at any point along the helix
    // instead of only near the camera.
    float depthMag = -mvPosition.z;
    vec2 mouseView = uMouseNDC * vec2(uAspect, 1.0) * uTanHalfFov * depthMag;
    vec2 toMouse = mvPosition.xy - mouseView;
    float dist = length(toMouse);
    float force = smoothstep(${ GRAVITY_RADIUS.toFixed(3) }, 0.0, dist) * ${ GRAVITY_STRENGTH.toFixed(3) };
    if (dist > 0.0001) mvPosition.xy += normalize(toMouse) * force;

    gl_Position = projectionMatrix * mvPosition;

    // A continuous multiply rather than a boolean threshold — identical
    // at aActive's own resting values (0 or 1), but lets the cursor
    // effect below ease a node in/out of "active" instead of snapping.
    float pulse = 1.0 + aActive * 0.3 * sin(uTime * 4.0);
    float focusBoost = aFocused > 0.5 ? 1.4 : 1.0;
    // Nodes bloom in along the spiral's own chronological order as uReveal
    // sweeps 0→1 on mount (see the reveal effect below) — a size of 0
    // before their own delay has been reached, full size after.
    float revealT = clamp((uReveal - aRevealDelay) * 4.0, 0.0, 1.0);
    // Perspective doesn't shrink gl_PointSize with distance on its own —
    // gl_Position gets perspective-divided, gl_PointSize is a raw
    // device-pixel value. Without this every node would render the same
    // pixel size regardless of depth, which would defeat the whole point
    // of a real helix. Same attenuation math THREE.PointsMaterial's own
    // sizeAttenuation uses internally: a node right at uAttenRef's
    // distance renders at its natural size, nearer ones bigger, farther
    // ones smaller.
    float atten = uAttenRef / max(0.1, depthMag);
    gl_PointSize = aSize * pulse * focusBoost * revealT * atten;

    vColor = aColor;
    vActive = aActive;
    vFocused = aFocused;
    vDim = aDim;
  }
`;

const FRAG = `
  precision mediump float;

  varying vec3 vColor;
  varying float vActive;
  varying float vFocused;
  varying float vDim;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d);
    if (a < 0.01) discard;

    // Same continuous-not-boolean treatment as aActive's pulse above.
    float glow = 0.85 + vActive * 0.3;
    vec3 finalColor = vColor * glow;

    // Keyboard focus — a rim-light rather than a separately drawn ring, so
    // it stays correct without any extra geometry even as the group keeps
    // rotating/dragging underneath it.
    if (vFocused > 0.5) {
      float rim = smoothstep(0.5, 0.28, d);
      finalColor = mix(vec3(1.0), finalColor, rim);
    }

    // Dimmed by the activity list's own search/category filter (see
    // visibleIndices) — desaturated and faded rather than hidden outright,
    // so the spiral's overall shape stays legible as context.
    if (vDim > 0.5) {
      finalColor = mix(finalColor, vec3(0.5), 0.65);
      a *= 0.4;
    }

    gl_FragColor = vec4(finalColor, a);
  }
`;

// The tour's own comet tail (see the TRAIL_MAX_POINTS constant block) —
// a small, separate point cloud living at the scene root rather than
// inside `group` (the camera itself sits there too, outside the group's
// own rotation, so the trail has to as well or it would visibly swim
// against the camera's actual path the instant the ambient drift or a
// drag turned the group underneath it). aAge is 0 the instant a sample is
// taken and eases toward 1 every frame after (see the tick loop), driving
// both size and alpha down together so a point shrinks AND fades as it
// falls behind, rather than snapping out at some fixed distance.
const TRAIL_VERT = `
  attribute float aAge;
  varying float vAge;
  uniform float uPointSize;

  void main() {
    vAge = aAge;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = (1.0 - aAge) * uPointSize;
  }
`;

const TRAIL_FRAG = `
  precision mediump float;
  varying float vAge;
  uniform vec3 uColor;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d) * (1.0 - vAge) * 0.5;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

const TRAIL_MAX_POINTS = 40; // ≈ 0.66s of recent camera history at 60fps — a comet's tail, not its whole journey
const TRAIL_POINT_SIZE = 10;
const TRAIL_AGE_RATE = 1.2; // per second — a fresh sample reaches full age (invisible) in ~0.83s

// The active node's own corona (see the CORONA_BASE_SIZE constant block)
// — a single dedicated point rather than another attribute on the shared
// points geometry above: only ever one node is "now" at a time, so this
// doesn't need per-vertex plumbing the way aActive/aFocused/aDim do for
// every node at once. Lives inside `group` (not the scene root the way
// the comet trail above does) since it has to stay glued to whichever
// node it's marking as the group rotates/drags. uPulseScale is driven by
// the exact same elastic "bump" tween the cursor-change effect already
// runs for aActive — one entrance, not two competing ones for what's
// really the same "now just arrived here" moment.
const CORONA_VERT = `
  uniform float uTime;
  uniform float uBaseSize;
  uniform float uPulseScale;
  uniform float uAttenRef;
  varying float vPulseScale;

  void main() {
    vPulseScale = uPulseScale;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float depthMag = -mvPosition.z;
    float atten = uAttenRef / max(0.1, depthMag);
    gl_Position = projectionMatrix * mvPosition;
    float breathe = 1.0 + 0.12 * sin(uTime * 2.2);
    gl_PointSize = uBaseSize * breathe * uPulseScale * atten;
  }
`;

const CORONA_FRAG = `
  precision mediump float;
  uniform vec3 uColor;
  varying float vPulseScale;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv) * 2.0;
    // A soft core plus a wider, fainter glow — two blended falloffs
    // rather than one, so this reads as a corona (bright center, soft
    // halo) rather than a uniform disc the way the plain node points are.
    float halo = smoothstep(1.0, 0.0, d);
    float core = smoothstep(0.35, 0.0, d);
    float a = (halo * 0.35 + core * 0.5) * vPulseScale;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

const CORONA_BASE_SIZE = 22; // px at magnitude 0 — still a visible halo behind even the quietest step
const CORONA_MAGNITUDE_RANGE = 46; // + up to this much more at the session's own largest magnitude

// Every tracked edit as a node in a slowly-rotating spiral, sized by how
// much actually changed at that step and colored by what kind of action it
// was — a fullscreen, genuinely data-driven view of the whole session,
// rather than more decoration layered on the linear rail. Branch-stash
// entries (see Home.jsx's branchStash) get their own small offset node
// near the point they forked from, joined by a line — the first time that
// concept gets real geometry instead of just a rail overlay + list row.
//
// Reachable three ways: it drifts on its own, it can be dragged (plain
// pointer events, not framer's gesture system, to stay consistent with the
// hit-testing this file already does natively), and — when `touring` is
// true — the camera flies node to node on its own, driven by the same
// xstate playback machine HistoryPanel.jsx already uses for the linear
// rail's own time-lapse. Also reachable by keyboard alone (arrow keys +
// Enter/Space — see the keydown handling below), with the activity list's
// own search/category filter dimming non-matching nodes here too, and the
// render loop pausing itself both on tab-hidden and on genuine pointer/
// keyboard idle.
const HistoryConstellation = ({
  timeline, cursor, branchStash, onJump, onRestoreBranch, touring, visibleIndices, reduceMotion,
}) => {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [focusedIndex, setFocusedIndex] = useState(null);
  const [focusedLabel, setFocusedLabel] = useState("");

  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;
  const onRestoreBranchRef = useRef(onRestoreBranch);
  onRestoreBranchRef.current = onRestoreBranch;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const focusedIndexRef = useRef(focusedIndex);
  focusedIndexRef.current = focusedIndex;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  // Which node's aActive slot is currently live, and whatever tween is
  // mid-flight animating the handoff to a new one — see the cursor effect
  // further down. Reset to -1 whenever the geometry itself is rebuilt,
  // since a rebuild renumbers every node and this index would otherwise
  // point at whatever now happens to sit in that old slot.
  const activeNodeIdxRef = useRef(-1);
  const activeTweenRef = useRef(null);
  // The branch-restore graft's own in-flight tween (see graftBranch in the
  // mount effect below) — killed on rebuild/unmount the same defensive
  // way activeTweenRef already is, since it writes straight into the
  // shared points geometry's own buffers and a rebuild replaces that
  // geometry out from under it otherwise.
  const graftTweenRef = useRef(null);

  // Mount-once: renderer/scene/camera + the render loop + input handling.
  // Reads whatever's currently in sceneRef (populated/replaced by the
  // rebuild effect further down) rather than closing over any particular
  // geometry, so this effect never needs to re-run when the session
  // changes shape.
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
    camera.position.set(0, 0, CAMERA_REST_Z);
    camera.lookAt(0, 0, 0);

    const uniforms = {
      uTime: { value: 0 },
      uMouseNDC: { value: new THREE.Vector2(9999, 9999) },
      uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2) },
      uAspect: { value: 1 },
      uAttenRef: { value: CAMERA_REST_Z },
      uReveal: { value: 0 },
    };

    // `touring`/`aspect`/`zoom`/`camState` are read by the render loop and
    // by resize() below — kept on the shared ref (rather than closed-over
    // props/state) since both this effect and the tour effect further
    // down need to read/write them without re-running this mount effect.
    // camState carries the camera's own live position and look-at target
    // together, so a tour's flight tweens both in lockstep (see the tour
    // effect further down) rather than lookAt only snapping at the end.
    const state = {
      renderer, scene, camera, group, uniforms,
      nodes: [], points: null, lines: null,
      touring: false, aspect: 1, zoom: { value: 1 },
      camState: { x: 0, y: 0, z: CAMERA_REST_Z, lx: 0, ly: 0, lz: 0 },
    };
    sceneRef.current = state;

    // The tour's own comet tail (see TRAIL_MAX_POINTS) — added to `scene`
    // directly, not `group`, for the same reason the camera itself lives
    // there: this tracks the camera's real path through world space, which
    // the group's own ambient rotation/drag must never re-interpret.
    const trailPositions = new Float32Array(TRAIL_MAX_POINTS * 3);
    const trailAges = new Float32Array(TRAIL_MAX_POINTS).fill(1);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
    trailGeometry.setAttribute("aAge", new THREE.BufferAttribute(trailAges, 1));
    const trailMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(resolveCssColor("var(--page-ink-color)")) },
        uPointSize: { value: TRAIL_POINT_SIZE * dpr },
      },
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const trailPoints = new THREE.Points(trailGeometry, trailMaterial);
    scene.add(trailPoints);
    state.trail = { points: trailPoints, positions: trailPositions, ages: trailAges };

    // The active node's own corona (see CORONA_BASE_SIZE) — one vertex,
    // repositioned to whichever node is current rather than rebuilt.
    // uTime is the exact same uniform OBJECT the main shader's own
    // uniforms.uTime is (not a copy) — the render loop already advances
    // that once per frame, so sharing the reference is what keeps the
    // corona's own breathe term in lockstep for free, with nothing extra
    // to update here.
    const coronaGeometry = new THREE.BufferGeometry();
    coronaGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    const coronaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: uniforms.uTime,
        uBaseSize: { value: CORONA_BASE_SIZE * dpr },
        uPulseScale: { value: 0 },
        uAttenRef: { value: CAMERA_REST_Z },
        uColor: { value: new THREE.Color(resolveCssColor("var(--page-ink-color)")) },
      },
      vertexShader: CORONA_VERT,
      fragmentShader: CORONA_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const coronaPoints = new THREE.Points(coronaGeometry, coronaMaterial);
    group.add(coronaPoints);
    state.corona = { points: coronaPoints, material: coronaMaterial };

    // An orthographic "zoom" scaled the frustum bounds; a perspective
    // camera has none, so this scales FOV instead — same zoom.value
    // semantics as before (smaller = more zoomed in). uTanHalfFov/uAspect
    // stay in lockstep here too, since the gravity well's per-vertex mouse
    // unproject in the shader depends on both being current.
    const applyZoom = () => {
      camera.aspect = state.aspect;
      camera.fov = CAMERA_FOV * state.zoom.value;
      camera.updateProjectionMatrix();
      uniforms.uAspect.value = state.aspect;
      uniforms.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    };

    const resize = () => {
      const width = parent.clientWidth || 1;
      const height = parent.clientHeight || 1;
      renderer.setSize(width, height, false);
      state.aspect = width / height;
      applyZoom();
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    // Screen-space hit testing rather than GPU raycasting against Points
    // (fiddly to size a pick radius for correctly) — each node's known
    // local position is projected through the group's current (rotated)
    // world matrix and the camera, giving a plain nearest-within-radius
    // check against the pointer's canvas-relative pixel position.
    const nearestNode = (clientX, clientY) => {
      const nodes = sceneRef.current.nodes;
      if (nodes.length === 0) return null;

      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      group.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      let closest = null;
      let closestDist = HIT_RADIUS_PX;

      nodes.forEach((node) => {
        v.set(node.x, node.y, node.z || 0).applyMatrix4(group.matrixWorld).project(camera);
        const sx = (v.x * 0.5 + 0.5) * rect.width;
        const sy = (-v.y * 0.5 + 0.5) * rect.height;
        const dist = Math.hypot(sx - px, sy - py);
        if (dist < closestDist) {
          closestDist = dist;
          closest = node;
        }
      });

      return closest;
    };

    // Idle-pause bookkeeping — see the setInterval below. Any tracked
    // interaction (drag, hover, keyboard, wheel) bumps this.
    let lastActivity = performance.now();
    const markActivity = () => {
      lastActivity = performance.now();
      if (!raf && !document.hidden) {
        clock.getDelta(); // drop the paused-time gap rather than jumping on resume
        tick();
      }
    };

    // Drag-to-rotate — plain pointer events (matching the hit-testing
    // above rather than mixing in framer's gesture system on a raw
    // <canvas>). Horizontal drag spins around Z, vertical drag tilts
    // around X (clamped so it can't flip disorientingly upside down).
    // dragDistance is what tells the click handler below a real drag apart
    // from a plain tap/click.
    let isDragging = false;
    let dragDistance = 0;
    let lastX = 0;
    let lastY = 0;

    // Pinch-zoom — every active pointer rostered by id (the same pattern
    // NoteConstellation.jsx's own pinch already uses); a second pointer
    // landing upgrades the gesture from drag-rotate to pinch, and a
    // finger-distance ratio each move drives state.zoom.value exactly the
    // way the wheel handler below does. Either finger lifting ends the
    // pinch outright, same restraint NoteConstellation's own pinch
    // declaration explains: a half-lifted pinch has no honest
    // single-pointer intent (rotate?) to hand off to.
    const activePointers = new Map();
    const pinch = { active: false, lastDist: 0 };

    // Just the raw pointer NDC now — the shader itself unprojects this to
    // each vertex's own depth (see uMouseNDC/uTanHalfFov/uAspect in the
    // vertex shader above), since a perspective frustum's width varies
    // with depth and a single fixed-depth view-space point can't correctly
    // compare against nodes scattered along the whole helix.
    const mouseTarget = new THREE.Vector2(9999, 9999);
    const updateMouseTarget = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
      mouseTarget.set(ndcX, ndcY);
    };

    const handleDown = (e) => {
      markActivity();
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        const [p1, p2] = Array.from(activePointers.values());
        pinch.active = true;
        pinch.lastDist = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
        isDragging = false;
        return;
      }

      isDragging = true;
      dragDistance = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const handleMove = (e) => {
      markActivity();

      const roster = activePointers.get(e.pointerId);
      if (roster) {
        roster.x = e.clientX;
        roster.y = e.clientY;
      }

      if (pinch.active) {
        if (activePointers.size < 2) return;
        const [p1, p2] = Array.from(activePointers.values());
        const dist = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
        gsap.killTweensOf(state.zoom);
        // A wider finger spread reads as "pull the view closer," the
        // opposite sign of the raw distance ratio — inverted here so
        // zoom.value (smaller = more zoomed in, see applyZoom) tracks
        // that the same way the wheel handler's own factor already does.
        state.zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.zoom.value * (pinch.lastDist / dist)));
        applyZoom();
        pinch.lastDist = dist;
        return;
      }

      if (isDragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        dragDistance += Math.abs(dx) + Math.abs(dy);
        group.rotation.z += dx * DRAG_ROTATE_SPEED;
        group.rotation.x = Math.max(-0.6, Math.min(0.6, group.rotation.x + dy * DRAG_ROTATE_SPEED));
      }

      // Left at its default far-away value under reduced motion, so the
      // gravity well's force term always reads ~0 — nodes stop shifting
      // on their own as the pointer passes near them.
      if (!reduceMotionRef.current) updateMouseTarget(e.clientX, e.clientY);

      const node = nearestNode(e.clientX, e.clientY);
      const rect = canvas.getBoundingClientRect();
      // Clamped to the canvas's own bounds (not the wider viewport — this
      // label is positioned relative to .history-constellation, not
      // fixed) so a node near the right/bottom edge doesn't render its
      // label partly outside the constellation view. Widths/heights here
      // are rough estimates rather than measured, matching the label's
      // typical content size — good enough to keep it fully on-screen
      // without needing a DOM measurement pass on every pointer move.
      const clampedX = Math.min(e.clientX - rect.left, Math.max(0, rect.width - 236));
      const clampedY = Math.min(Math.max(e.clientY - rect.top, 30), Math.max(30, rect.height - 30));
      setHoveredNode(node ? { ...node, screenX: clampedX, screenY: clampedY } : null);
    };

    const handleUp = (e) => {
      activePointers.delete(e.pointerId);
      if (pinch.active && activePointers.size < 2) pinch.active = false;
      isDragging = false;
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

    // The restore graft — the branch node travels straight along its own
    // already-drawn connecting line to the fork point it forked from,
    // shrinking away as it arrives, rather than the view just jumping to
    // the post-restore state the instant the rebuild lands. Writes
    // directly into the shared points geometry's own position/aSize
    // buffers (the same raw-array-plus-needsUpdate technique the cursor
    // bump and the comet trail above both already use) since this one
    // node has no separate object of its own to animate. onRestoreBranch
    // — the actual state change, and what triggers the eventual rebuild —
    // only fires once the travel finishes, so that rebuild never yanks
    // the geometry out from under an animation still in flight.
    const graftBranch = (node) => {
      if (!node || node.kind !== "branch") return;
      const s = sceneRef.current;
      const idx = s?.nodes.indexOf(node) ?? -1;
      const posAttr = s?.points?.geometry.getAttribute("position");
      const sizeAttr = s?.points?.geometry.getAttribute("aSize");

      if (reduceMotionRef.current || idx === -1 || !posAttr || !sizeAttr) {
        onRestoreBranchRef.current?.(node.stashId);
        return;
      }

      graftTweenRef.current?.kill();
      const startSize = sizeAttr.array[idx];
      const travel = { t: 0 };
      graftTweenRef.current = gsap.to(travel, {
        t: 1,
        duration: .5,
        ease: "power2.in",
        onUpdate: () => {
          posAttr.array[idx * 3] = node.x + (node.forkX - node.x) * travel.t;
          posAttr.array[idx * 3 + 1] = node.y + (node.forkY - node.y) * travel.t;
          posAttr.array[idx * 3 + 2] = (node.z || 0) + ((node.forkZ || 0) - (node.z || 0)) * travel.t;
          sizeAttr.array[idx] = startSize * (1 - travel.t);
          posAttr.needsUpdate = true;
          sizeAttr.needsUpdate = true;
        },
        onComplete: () => onRestoreBranchRef.current?.(node.stashId),
      });
    };

    const handleClick = (e) => {
      if (dragDistance > 6) return; // a drag release, not a tap
      const node = nearestNode(e.clientX, e.clientY);
      if (!node) return;
      if (node.kind === "branch") graftBranch(node);
      else onJumpRef.current?.(node.index);
    };

    const handleLeave = () => {
      setHoveredNode(null);
      mouseTarget.set(9999, 9999);
    };

    // Keyboard access — the canvas is tabIndex=0 (see the JSX below).
    // Arrow keys step through sceneRef's own node array in order (simple
    // index stepping rather than spatial "nearest node in this direction"
    // reasoning — the spiral doesn't map cleanly onto up/down/left/right
    // anyway, and index order already matches chronological session
    // order). Enter/Space jumps or restores whichever node is focused.
    const moveFocus = (delta) => {
      const s = sceneRef.current;
      if (!s || s.nodes.length === 0) return;

      let base = focusedIndexRef.current;
      if (base === null) {
        base = s.nodes.findIndex((n) => n.index === cursorRef.current);
        if (base === -1) base = 0;
      }
      const next = Math.max(0, Math.min(s.nodes.length - 1, base + delta));
      setFocusedIndex(next);
      setFocusedLabel(s.nodes[next]?.label || "");
    };

    const handleKeyDown = (e) => {
      markActivity();

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        moveFocus(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        moveFocus(-1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const s = sceneRef.current;
        const node = focusedIndexRef.current !== null ? s?.nodes[focusedIndexRef.current] : null;
        if (!node) return;
        if (node.kind === "branch") graftBranch(node);
        else onJumpRef.current?.(node.index);
      }
    };

    canvas.addEventListener("pointerdown", handleDown);
    canvas.addEventListener("pointermove", handleMove);
    canvas.addEventListener("pointerup", handleUp);
    canvas.addEventListener("pointerleave", handleLeave);
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("keydown", handleKeyDown);
    // Real wheel-zoom (see the ZOOM_MIN/ZOOM_MAX constant block) — passive:
    // false since this needs preventDefault to stop the page itself
    // scrolling under a wheel event fired at the canvas.
    const handleWheel = (e) => {
      e.preventDefault();
      markActivity();
      gsap.killTweensOf(state.zoom);
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      state.zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.zoom.value * factor));
      applyZoom();
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    const clock = new THREE.Clock();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = clock.getDelta();
      uniforms.uTime.value += dt;

      uniforms.uMouseNDC.value.x += (mouseTarget.x - uniforms.uMouseNDC.value.x) * 0.08;
      uniforms.uMouseNDC.value.y += (mouseTarget.y - uniforms.uMouseNDC.value.y) * 0.08;

      // The ambient drift stands down both while a tour is actively flying
      // the camera and while the pointer is actively dragging — either
      // way, something else is deliberately in control of the view. Also
      // stands down entirely under reduced motion, same as a tour's own
      // camera flight and the gravity well below.
      if (!state.touring && !isDragging && !reduceMotionRef.current) group.rotation.z += dt * ROTATE_SPEED;

      // The comet tail (see TRAIL_MAX_POINTS) — every existing sample ages
      // regardless of whether a new one is being taken this frame, so a
      // tour that just stopped still finishes fading its own tail out
      // rather than cutting it off mid-flight. Under reduced motion the
      // tour itself jumps straight to each node (gsap.set, not .to — see
      // the tour effect below) with no continuous flight for a trail to
      // meaningfully sample in the first place, so this stands down
      // entirely there, the same restraint the ambient drift just above
      // already keeps.
      const trail = state.trail;
      let trailNeedsUpdate = false;
      if (!reduceMotionRef.current) {
        if (state.touring) {
          for (let i = 0; i < TRAIL_MAX_POINTS - 1; i++) {
            trail.positions[i * 3] = trail.positions[(i + 1) * 3];
            trail.positions[i * 3 + 1] = trail.positions[(i + 1) * 3 + 1];
            trail.positions[i * 3 + 2] = trail.positions[(i + 1) * 3 + 2];
            trail.ages[i] = trail.ages[i + 1];
          }
          const last = TRAIL_MAX_POINTS - 1;
          trail.positions[last * 3] = camera.position.x;
          trail.positions[last * 3 + 1] = camera.position.y;
          trail.positions[last * 3 + 2] = camera.position.z;
          trail.ages[last] = 0;
          trailNeedsUpdate = true;
        }
        for (let i = 0; i < TRAIL_MAX_POINTS; i++) {
          if (trail.ages[i] >= 1) continue;
          trail.ages[i] = Math.min(1, trail.ages[i] + dt * TRAIL_AGE_RATE);
          trailNeedsUpdate = true;
        }
        if (trailNeedsUpdate) {
          trail.points.geometry.attributes.position.needsUpdate = true;
          trail.points.geometry.attributes.aAge.needsUpdate = true;
        }
      }

      renderer.render(scene, camera);
    };

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

    // Pauses the render loop after a genuine stretch of no interaction —
    // the exact same cancelAnimationFrame/raf=null mechanism the
    // visibility handler above already uses — unless a cinematic tour is
    // running hands-off on purpose.
    const idleCheck = setInterval(() => {
      if (state.touring) return;
      if (raf && performance.now() - lastActivity > IDLE_MS) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }, 2000);

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      clearInterval(idleCheck);
      document.removeEventListener("visibilitychange", handleVisibility);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", handleDown);
      canvas.removeEventListener("pointermove", handleMove);
      canvas.removeEventListener("pointerup", handleUp);
      canvas.removeEventListener("pointerleave", handleLeave);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("wheel", handleWheel);
      gsap.killTweensOf(state.camState);
      gsap.killTweensOf(state.zoom);
      activeTweenRef.current?.kill();
      graftTweenRef.current?.kill();
      sceneRef.current?.points?.geometry.dispose();
      sceneRef.current?.points?.material.dispose();
      sceneRef.current?.lines?.geometry.dispose();
      sceneRef.current?.lines?.material.dispose();
      sceneRef.current?.trail?.points.geometry.dispose();
      sceneRef.current?.trail?.points.material.dispose();
      sceneRef.current?.corona?.points.geometry.dispose();
      sceneRef.current?.corona?.material.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A staggered bloom-in, following the spiral's own chronological order,
  // every time this view mounts (it mounts fresh each time `constellation`
  // flips true in HistoryPanel.jsx, so "on mount" is exactly the right
  // trigger) — GSAP driving a WebGL uniform the same way the existing
  // liquid-ripple effect elsewhere in this panel already drives an SVG
  // one, just applied here.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;

    // Gated on reduced motion the same way the ambient spin, gravity well,
    // tour flight, and rail stretch already are elsewhere in this panel —
    // a 1s staggered sweep across the whole graph is exactly the kind of
    // large, continuous motion that convention exists for; a reduced-motion
    // visitor gets every node at full size immediately instead.
    if (reduceMotionRef.current) {
      s.uniforms.uReveal.value = 1;
      return;
    }

    const tween = gsap.fromTo(s.uniforms.uReveal, { value: 0 }, { value: 1, duration: 1, ease: "power2.out" });
    // Unlike every other GSAP tween in this file, this one previously had
    // no cleanup — closing the panel mid-bloom (well within the realistic
    // 1s window) would leave it running past unmount, still mutating a
    // uniform nothing renders anymore until it finished on its own.
    return () => tween.kill();
  }, []);

  // Rebuilds the graph's geometry whenever the session's actual shape
  // changes (a new tracked edit, a branch stashed or restored) — cheap at
  // the node counts this panel ever deals with, so a full rebuild here
  // rather than an incremental diff is the simpler, equally correct
  // choice. cursor/focusedIndex/visibleIndices are read directly (not via
  // refs) since this effect's own closure is recreated fresh every time it
  // runs — deliberately not in the dependency array below, since changing
  // any of those alone shouldn't rebuild the whole geometry; the three
  // effects further down patch just their own attribute in that case.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;

    const mainNodes = timeline.map((entry, index) => {
      const angle = index * GOLDEN_ANGLE;
      const radius = Math.sqrt(index) * SPACING;
      const arrival = index > 0 ? timeline[index - 1] : null;
      const style = arrival ? styleFor(arrival.label) : DEFAULT_STYLE;
      const magnitude = index === 0 ? 0 : magnitudeOf(timeline[index - 1], entry);
      // Chronological depth — oldest at the far/negative end, "now" nearest
      // the camera — centered on the origin so the existing "camera looks
      // at (0,0,0)" convention (rest position, tour reset) needs no other
      // adjustment.
      const depthT = timeline.length > 1 ? index / (timeline.length - 1) : 0.5;

      return {
        index,
        stashId: null,
        kind: "step",
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        z: (depthT - 0.5) * HELIX_DEPTH_RANGE,
        magnitude,
        color: resolveCssColor(style.color),
        colorVar: style.color,
        label: arrivalLabel(arrival),
        at: arrival ? arrival.at : null,
      };
    });

    const branchNodes = (branchStash || []).map((stash) => {
      const forkIndex = Math.min(stash.undoStack.length, mainNodes.length - 1);
      const forkNode = mainNodes[forkIndex];
      if (!forkNode) return null;

      const forkAngle = Math.atan2(forkNode.y, forkNode.x) || 0;
      const offsetAngle = forkAngle + 0.7;
      const offsetRadius = SPACING * 2.4;

      return {
        index: null,
        stashId: stash.id,
        kind: "branch",
        x: forkNode.x + Math.cos(offsetAngle) * offsetRadius,
        y: forkNode.y + Math.sin(offsetAngle) * offsetRadius,
        // Sits beside the moment it forked from, not before or after it —
        // same depth as the fork node itself.
        z: forkNode.z,
        magnitude: 26,
        color: resolveCssColor("var(--orange-color)"),
        colorVar: "var(--orange-color)",
        label: `Branch — ${ capitalize(stash.label) }`,
        at: stash.at,
        forkX: forkNode.x,
        forkY: forkNode.y,
        forkZ: forkNode.z,
      };
    }).filter(Boolean);

    const allNodes = [...mainNodes, ...branchNodes];
    const maxRadius = Math.max(0.05, ...allNodes.map((n) => Math.hypot(n.x, n.y)));
    const scale = 1 / (maxRadius * 1.25);
    allNodes.forEach((n) => { n.x *= scale; n.y *= scale; });
    if (branchNodes.length > 0) {
      branchNodes.forEach((n) => { n.forkX *= scale; n.forkY *= scale; });
    }

    const positions = new Float32Array(allNodes.length * 3);
    const colors = new Float32Array(allNodes.length * 3);
    const sizes = new Float32Array(allNodes.length);
    const actives = new Float32Array(allNodes.length);
    const focuseds = new Float32Array(allNodes.length);
    const dims = new Float32Array(allNodes.length);
    const revealDelays = new Float32Array(allNodes.length);
    const maxMagnitude = Math.max(1, ...allNodes.map((n) => n.magnitude));

    allNodes.forEach((node, i) => {
      positions[i * 3] = node.x;
      positions[i * 3 + 1] = node.y;
      positions[i * 3 + 2] = node.z || 0;

      const c = new THREE.Color(node.color);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizes[i] = (node.kind === "branch" ? 10 : 6 + (node.magnitude / maxMagnitude) * 10) * dpr;
      actives[i] = node.index === cursor ? 1 : 0;
      focuseds[i] = i === focusedIndex ? 1 : 0;
      dims[i] = (visibleIndices && node.kind === "step" && !visibleIndices.has(node.index)) ? 1 : 0;
      // Spread over [0, REVEAL_DELAY_MAX] rather than the full [0, 1] — the
      // vertex shader's revealT needs a full 0.25 of uReveal's own runway
      // past a node's delay to reach size 1 (`(uReveal - aRevealDelay) *
      // 4.0`), and uReveal itself never exceeds 1. A node whose delay sat
      // at the naive i/(N-1), i.e. up to 1.0, could never fully bloom —
      // the very last node (every session's most recent step, plus every
      // branch-stash node, appended after it) stayed permanently
      // size-zero once uReveal settled. Capping the max delay at exactly
      // 1 - 1/4 leaves that last node precisely the runway it needs.
      revealDelays[i] = (i / Math.max(1, allNodes.length - 1)) * REVEAL_DELAY_MAX;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aActive", new THREE.BufferAttribute(actives, 1));
    geometry.setAttribute("aFocused", new THREE.BufferAttribute(focuseds, 1));
    geometry.setAttribute("aDim", new THREE.BufferAttribute(dims, 1));
    geometry.setAttribute("aRevealDelay", new THREE.BufferAttribute(revealDelays, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: s.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);

    const lineColor = new THREE.Color(resolveCssColor("var(--page-line-color)"));
    const linePositions = [];
    for (let i = 1; i < mainNodes.length; i++) {
      linePositions.push(
        mainNodes[i - 1].x, mainNodes[i - 1].y, mainNodes[i - 1].z,
        mainNodes[i].x, mainNodes[i].y, mainNodes[i].z,
      );
    }
    branchNodes.forEach((node) => {
      linePositions.push(node.forkX, node.forkY, node.forkZ, node.x, node.y, node.z);
    });
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePositions), 3));
    const lineMaterial = new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: .35 });
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);

    if (s.points) { s.group.remove(s.points); s.points.geometry.dispose(); s.points.material.dispose(); }
    if (s.lines) { s.group.remove(s.lines); s.lines.geometry.dispose(); s.lines.material.dispose(); }

    s.group.add(lines);
    s.group.add(points);
    s.points = points;
    s.lines = lines;
    s.nodes = allNodes;
    // Read by the cursor-change effect below whenever it needs to size a
    // freshly-active node's own corona — a rebuild is the only place
    // maxMagnitude is actually known.
    s.maxMagnitude = maxMagnitude;

    // A rebuild renumbers every node, so whatever the cursor effect below
    // thought was "the active slot" no longer reliably means that — reset
    // it to wherever the current cursor actually landed in the fresh
    // array (already burned into aActive above, correctly, with no
    // animation needed for this transition) rather than let a stale index
    // survive into the next cursor change.
    activeTweenRef.current?.kill();
    graftTweenRef.current?.kill();
    activeNodeIdxRef.current = allNodes.findIndex((n) => n.index === cursor);

    // The corona (see CORONA_BASE_SIZE) snaps straight to the rebuilt
    // active node too, no animation, for the same reason aActive itself
    // just did above — a rebuild is a new picture of the desk, not a
    // "now" transition worth animating into.
    const activeNode = activeNodeIdxRef.current >= 0 ? allNodes[activeNodeIdxRef.current] : null;
    if (activeNode) {
      const coronaDpr = Math.min(window.devicePixelRatio || 1, 2);
      const pos = s.corona.points.geometry.attributes.position;
      pos.array[0] = activeNode.x;
      pos.array[1] = activeNode.y;
      pos.array[2] = activeNode.z || 0;
      pos.needsUpdate = true;
      s.corona.material.uniforms.uBaseSize.value = (CORONA_BASE_SIZE + (activeNode.magnitude / maxMagnitude) * CORONA_MAGNITUDE_RANGE) * coronaDpr;
      s.corona.material.uniforms.uPulseScale.value = 1;
    } else {
      s.corona.material.uniforms.uPulseScale.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, branchStash]);

  // The live cursor's node glow — updated on its own rather than folded
  // into the rebuild above, so scrubbing/clicking through the graph never
  // has to rebuild the whole geometry just to move the highlight. Used to
  // just snap the flag from one node to the next; now eased instead, the
  // outgoing node's glow fading down while the incoming one blooms up with
  // a touch of overshoot — the same elastic character every other state
  // change in this app already carries, on the one node graph that didn't
  // have it yet.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s?.points) return;

    const attr = s.points.geometry.getAttribute("aActive");
    if (!attr) return;

    const newIndex = s.nodes.findIndex((node) => node.index === cursor);
    const prevIndex = activeNodeIdxRef.current;
    activeNodeIdxRef.current = newIndex;

    activeTweenRef.current?.kill();

    // The corona (see CORONA_BASE_SIZE) repositions and resizes to the
    // new node immediately — only its own uPulseScale (opacity/size
    // entrance) actually animates below, driven by the exact same bump.t
    // the node's own aActive glow already uses, rather than a second
    // independent tween for what's really one "now just arrived here"
    // moment.
    const newNode = newIndex >= 0 ? s.nodes[newIndex] : null;
    if (newNode && s.corona) {
      const coronaDpr = Math.min(window.devicePixelRatio || 1, 2);
      const pos = s.corona.points.geometry.attributes.position;
      pos.array[0] = newNode.x;
      pos.array[1] = newNode.y;
      pos.array[2] = newNode.z || 0;
      pos.needsUpdate = true;
      s.corona.material.uniforms.uBaseSize.value = (CORONA_BASE_SIZE + (newNode.magnitude / (s.maxMagnitude || 1)) * CORONA_MAGNITUDE_RANGE) * coronaDpr;
    }

    if (reduceMotionRef.current || prevIndex === newIndex) {
      s.nodes.forEach((node, i) => { attr.array[i] = node.index === cursor ? 1 : 0; });
      attr.needsUpdate = true;
      if (s.corona) s.corona.material.uniforms.uPulseScale.value = newNode ? 1 : 0;
      return;
    }

    const bump = { t: 0 };
    activeTweenRef.current = gsap.to(bump, {
      t: 1,
      duration: .5,
      ease: "elastic.out(1, .6)",
      onUpdate: () => {
        if (prevIndex >= 0 && prevIndex < attr.array.length) attr.array[prevIndex] = Math.max(0, 1 - bump.t);
        if (newIndex >= 0 && newIndex < attr.array.length) attr.array[newIndex] = Math.max(0, bump.t);
        attr.needsUpdate = true;
        if (s.corona) s.corona.material.uniforms.uPulseScale.value = newNode ? bump.t : 0;
      },
    });
  }, [cursor]);

  // Keyboard focus's own rim-light — see moveFocus above.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s?.points) return;

    const attr = s.points.geometry.getAttribute("aFocused");
    if (!attr) return;

    for (let i = 0; i < attr.array.length; i++) attr.array[i] = i === focusedIndex ? 1 : 0;
    attr.needsUpdate = true;
  }, [focusedIndex]);

  // Dimming from the activity list's own search/category filter — see
  // visibleIndices in HistoryPanel.jsx.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s?.points) return;

    const attr = s.points.geometry.getAttribute("aDim");
    if (!attr) return;

    s.nodes.forEach((node, i) => {
      attr.array[i] = (visibleIndices && node.kind === "step" && !visibleIndices.has(node.index)) ? 1 : 0;
    });
    attr.needsUpdate = true;
  }, [visibleIndices]);

  // The cinematic tour: reuses HistoryPanel.jsx's own xstate playback
  // machine as the source of truth (via the `touring` prop) rather than a
  // second one here. Every time the live cursor advances while touring,
  // the camera flies to and zooms in on that node; stopping eases back out
  // to the full view. gsap's overwrite: "auto" (this codebase's existing
  // convention for interrupting an in-flight tween) handles the cursor
  // advancing again before the previous flight finishes.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;

    s.touring = touring;

    const applyZoom = () => {
      s.camera.aspect = s.aspect;
      s.camera.fov = CAMERA_FOV * s.zoom.value;
      s.camera.updateProjectionMatrix();
      s.uniforms.uAspect.value = s.aspect;
      s.uniforms.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(s.camera.fov) / 2);
    };

    // Under reduced motion the tour still works (play/pause, the cursor's
    // own pulse) — it just cuts straight to each node instead of sweeping
    // the camera across the whole graph to get there, which is the actual
    // vestibular concern, not the tour itself.
    const tweenFn = reduceMotion ? gsap.set : gsap.to;

    // camState carries the camera's own position and its look-at target
    // together, tweened in lockstep via one shared onUpdate — with real
    // Z-depth now, the camera has to actually dolly toward a node and look
    // at it, not just pan across a flat plane while staring down -Z.
    const applyCamState = () => {
      s.camera.position.set(s.camState.x, s.camState.y, s.camState.z);
      s.camera.lookAt(s.camState.lx, s.camState.ly, s.camState.lz);
    };

    if (touring) {
      const node = s.nodes.find((n) => n.index === cursor);
      if (node) {
        s.group.updateMatrixWorld(true);
        const v = new THREE.Vector3(node.x, node.y, node.z).applyMatrix4(s.group.matrixWorld);
        tweenFn(s.camState, {
          x: v.x, y: v.y, z: v.z + TOUR_DOLLY_OFFSET,
          lx: v.x, ly: v.y, lz: v.z,
          duration: 1.1, ease: "power3.inOut", overwrite: "auto", onUpdate: applyCamState,
        });
        tweenFn(s.zoom, { value: TOUR_ZOOM, duration: 1.1, ease: "power3.inOut", overwrite: "auto", onUpdate: applyZoom });
        applyCamState();
        applyZoom();
      }
    } else {
      tweenFn(s.camState, {
        x: 0, y: 0, z: CAMERA_REST_Z, lx: 0, ly: 0, lz: 0,
        duration: .9, ease: "power2.inOut", overwrite: "auto", onUpdate: applyCamState,
      });
      tweenFn(s.zoom, { value: 1, duration: .9, ease: "power2.inOut", overwrite: "auto", onUpdate: applyZoom });
      applyCamState();
      applyZoom();
    }
  }, [cursor, touring, reduceMotion]);

  // Most node colors (the note-action palette) are theme-invariant by
  // design (see colors.css) and so never need this — but the line color
  // and the "very start" node's fallback both resolve from
  // --page-ink-color/--page-line-color, which *do* flip between light and
  // dark, and both only get resolved once, at rebuild time. Without this,
  // toggling the theme while the constellation is open would leave those
  // showing the old theme's color until some unrelated change (a new edit,
  // a branch stashed) happened to force a rebuild.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const s = sceneRef.current;
      if (!s) return;

      if (s.lines) {
        s.lines.material.color.set(resolveCssColor("var(--page-line-color)"));
      }

      if (s.trail) {
        s.trail.points.material.uniforms.uColor.value.set(resolveCssColor("var(--page-ink-color)"));
      }

      if (s.corona) {
        s.corona.material.uniforms.uColor.value.set(resolveCssColor("var(--page-ink-color)"));
      }

      const attr = s.points?.geometry.getAttribute("aColor");
      if (attr) {
        s.nodes.forEach((node, i) => {
          node.color = resolveCssColor(node.colorVar);
          const c = new THREE.Color(node.color);
          attr.array[i * 3] = c.r;
          attr.array[i * 3 + 1] = c.g;
          attr.array[i * 3 + 2] = c.b;
        });
        attr.needsUpdate = true;
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="history-constellation">
      <canvas ref={ canvasRef } className="history-constellation-canvas" tabIndex={ 0 } />
      {
        hoveredNode && (
          <div
            className="history-constellation-label"
            style={{ left: hoveredNode.screenX, top: hoveredNode.screenY }}
          >
            <span
              className="history-constellation-label-swatch"
              style={{ backgroundColor: hoveredNode.color }}
            />
            <span className="history-constellation-label-text">
              <span className="history-constellation-label-title">{ hoveredNode.label }</span>
              {
                hoveredNode.at && (
                  <span className="history-constellation-label-time">{ timeAgo(hoveredNode.at) }</span>
                )
              }
            </span>
          </div>
        )
      }
      <div className="history-constellation-status" aria-live="polite">
        { focusedIndex !== null ? `Focused: ${ focusedLabel }` : "" }
      </div>
    </div>
  );
};

export default HistoryConstellation;
