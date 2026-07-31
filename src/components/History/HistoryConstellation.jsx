import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";

import { timeAgo } from "../../utils/date";
import { resolveCssColor } from "./HistoryAmbient";
import { styleFor, DEFAULT_STYLE, magnitudeOf, capitalize } from "./HistoryPanel";

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

const VERT = `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aActive;
  attribute float aFocused;
  attribute float aDim;
  attribute float aRevealDelay;

  uniform float uTime;
  uniform vec2 uMouse;
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
    // without needing to separately track either here.
    vec2 toMouse = mvPosition.xy - uMouse;
    float dist = length(toMouse);
    float force = smoothstep(${ GRAVITY_RADIUS.toFixed(3) }, 0.0, dist) * ${ GRAVITY_STRENGTH.toFixed(3) };
    if (dist > 0.0001) mvPosition.xy += normalize(toMouse) * force;

    gl_Position = projectionMatrix * mvPosition;

    float pulse = aActive > 0.5 ? 1.0 + 0.3 * sin(uTime * 4.0) : 1.0;
    float focusBoost = aFocused > 0.5 ? 1.4 : 1.0;
    // Nodes bloom in along the spiral's own chronological order as uReveal
    // sweeps 0→1 on mount (see the reveal effect below) — a size of 0
    // before their own delay has been reached, full size after.
    float revealT = clamp((uReveal - aRevealDelay) * 4.0, 0.0, 1.0);
    gl_PointSize = aSize * pulse * focusBoost * revealT;

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

    float glow = vActive > 0.5 ? 1.15 : 0.85;
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

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 5;

    const uniforms = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(9999, 9999) },
      uReveal: { value: 0 },
    };

    // `touring`/`aspect`/`zoom` are read by the render loop and by
    // resize() below — kept on the shared ref (rather than closed-over
    // props/state) since both this effect and the tour effect further
    // down need to read/write them without re-running this mount effect.
    const state = {
      renderer, scene, camera, group, uniforms,
      nodes: [], points: null, lines: null,
      touring: false, aspect: 1, zoom: { value: 1 },
    };
    sceneRef.current = state;

    const applyZoom = () => {
      const a = state.aspect;
      const z = state.zoom.value;
      camera.left = -a * z;
      camera.right = a * z;
      camera.top = 1 * z;
      camera.bottom = -1 * z;
      camera.updateProjectionMatrix();
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
        v.set(node.x, node.y, 0).applyMatrix4(group.matrixWorld).project(camera);
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

    const mouseTarget = new THREE.Vector2(9999, 9999);
    const updateMouseTarget = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
      const halfW = (camera.right - camera.left) / 2;
      const halfH = (camera.top - camera.bottom) / 2;
      mouseTarget.set(ndcX * halfW, ndcY * halfH);
    };

    const handleDown = (e) => {
      markActivity();
      isDragging = true;
      dragDistance = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const handleMove = (e) => {
      markActivity();

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
      isDragging = false;
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

    const handleClick = (e) => {
      if (dragDistance > 6) return; // a drag release, not a tap
      const node = nearestNode(e.clientX, e.clientY);
      if (!node) return;
      if (node.kind === "branch") onRestoreBranchRef.current?.(node.stashId);
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
        if (node.kind === "branch") onRestoreBranchRef.current?.(node.stashId);
        else onJumpRef.current?.(node.index);
      }
    };

    canvas.addEventListener("pointerdown", handleDown);
    canvas.addEventListener("pointermove", handleMove);
    canvas.addEventListener("pointerup", handleUp);
    canvas.addEventListener("pointerleave", handleLeave);
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("wheel", markActivity, { passive: true });

    const clock = new THREE.Clock();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = clock.getDelta();
      uniforms.uTime.value += dt;

      uniforms.uMouse.value.x += (mouseTarget.x - uniforms.uMouse.value.x) * 0.08;
      uniforms.uMouse.value.y += (mouseTarget.y - uniforms.uMouse.value.y) * 0.08;

      // The ambient drift stands down both while a tour is actively flying
      // the camera and while the pointer is actively dragging — either
      // way, something else is deliberately in control of the view. Also
      // stands down entirely under reduced motion, same as a tour's own
      // camera flight and the gravity well below.
      if (!state.touring && !isDragging && !reduceMotionRef.current) group.rotation.z += dt * ROTATE_SPEED;

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
      canvas.removeEventListener("wheel", markActivity);
      gsap.killTweensOf(camera.position);
      gsap.killTweensOf(state.zoom);
      sceneRef.current?.points?.geometry.dispose();
      sceneRef.current?.points?.material.dispose();
      sceneRef.current?.lines?.geometry.dispose();
      sceneRef.current?.lines?.material.dispose();
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

      return {
        index,
        stashId: null,
        kind: "step",
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        magnitude,
        color: resolveCssColor(style.color),
        colorVar: style.color,
        label: arrival ? capitalize(arrival.label) : "The very start",
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
        magnitude: 26,
        color: resolveCssColor("var(--orange-color)"),
        colorVar: "var(--orange-color)",
        label: `Branch — ${ capitalize(stash.label) }`,
        at: stash.at,
        forkX: forkNode.x,
        forkY: forkNode.y,
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
      positions[i * 3 + 2] = 0;

      const c = new THREE.Color(node.color);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizes[i] = (node.kind === "branch" ? 10 : 6 + (node.magnitude / maxMagnitude) * 10) * dpr;
      actives[i] = node.index === cursor ? 1 : 0;
      focuseds[i] = i === focusedIndex ? 1 : 0;
      dims[i] = (visibleIndices && node.kind === "step" && !visibleIndices.has(node.index)) ? 1 : 0;
      revealDelays[i] = i / Math.max(1, allNodes.length - 1);
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
      linePositions.push(mainNodes[i - 1].x, mainNodes[i - 1].y, 0, mainNodes[i].x, mainNodes[i].y, 0);
    }
    branchNodes.forEach((node) => {
      linePositions.push(node.forkX, node.forkY, 0, node.x, node.y, 0);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, branchStash]);

  // The live cursor's node pulses — updated on its own rather than folded
  // into the rebuild above, so scrubbing/clicking through the graph never
  // has to rebuild the whole geometry just to move the highlight.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s?.points) return;

    const attr = s.points.geometry.getAttribute("aActive");
    if (!attr) return;

    s.nodes.forEach((node, i) => { attr.array[i] = node.index === cursor ? 1 : 0; });
    attr.needsUpdate = true;
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
      const a = s.aspect;
      const z = s.zoom.value;
      s.camera.left = -a * z;
      s.camera.right = a * z;
      s.camera.top = 1 * z;
      s.camera.bottom = -1 * z;
      s.camera.updateProjectionMatrix();
    };

    // Under reduced motion the tour still works (play/pause, the cursor's
    // own pulse) — it just cuts straight to each node instead of sweeping
    // the camera across the whole graph to get there, which is the actual
    // vestibular concern, not the tour itself.
    const tweenFn = reduceMotion ? gsap.set : gsap.to;

    if (touring) {
      const node = s.nodes.find((n) => n.index === cursor);
      if (node) {
        s.group.updateMatrixWorld(true);
        const v = new THREE.Vector3(node.x, node.y, 0).applyMatrix4(s.group.matrixWorld);
        tweenFn(s.camera.position, { x: v.x, y: v.y, duration: 1.1, ease: "power3.inOut", overwrite: "auto" });
        tweenFn(s.zoom, { value: TOUR_ZOOM, duration: 1.1, ease: "power3.inOut", overwrite: "auto", onUpdate: applyZoom });
        applyZoom();
      }
    } else {
      tweenFn(s.camera.position, { x: 0, y: 0, duration: .9, ease: "power2.inOut", overwrite: "auto" });
      tweenFn(s.zoom, { value: 1, duration: .9, ease: "power2.inOut", overwrite: "auto", onUpdate: applyZoom });
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
