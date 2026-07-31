import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

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

const VERT = `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aActive;

  uniform float uTime;

  varying vec3 vColor;
  varying float vActive;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float pulse = aActive > 0.5 ? 1.0 + 0.3 * sin(uTime * 4.0) : 1.0;
    gl_PointSize = aSize * pulse;

    vColor = aColor;
    vActive = aActive;
  }
`;

const FRAG = `
  precision mediump float;

  varying vec3 vColor;
  varying float vActive;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d);
    if (a < 0.01) discard;

    float glow = vActive > 0.5 ? 1.15 : 0.85;
    gl_FragColor = vec4(vColor * glow, a);
  }
`;

// Every tracked edit as a node in a slowly-rotating spiral, sized by how
// much actually changed at that step and colored by what kind of action it
// was — a fullscreen, genuinely data-driven view of the whole session,
// rather than more decoration layered on the linear rail. Branch-stash
// entries (see Home.jsx's branchStash) get their own small offset node
// near the point they forked from, joined by a line — the first time that
// concept gets real geometry instead of just a rail overlay + list row.
const HistoryConstellation = ({ timeline, cursor, branchStash, onJump, onRestoreBranch }) => {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const [hoveredNode, setHoveredNode] = useState(null);

  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;
  const onRestoreBranchRef = useRef(onRestoreBranch);
  onRestoreBranchRef.current = onRestoreBranch;

  // Mount-once: renderer/scene/camera + the render loop + input handling.
  // Reads whatever's currently in sceneRef (populated/replaced by the next
  // effect) rather than closing over any particular geometry, so this
  // effect never needs to re-run when the session changes shape.
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

    const uniforms = { uTime: { value: 0 } };

    sceneRef.current = { renderer, scene, camera, group, uniforms, nodes: [], points: null, lines: null };

    const resize = () => {
      const width = parent.clientWidth || 1;
      const height = parent.clientHeight || 1;
      renderer.setSize(width, height, false);

      const aspect = width / height;
      camera.left = -aspect;
      camera.right = aspect;
      camera.top = 1;
      camera.bottom = -1;
      camera.updateProjectionMatrix();
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

    const handleMove = (e) => {
      const node = nearestNode(e.clientX, e.clientY);
      const rect = canvas.getBoundingClientRect();
      setHoveredNode(node ? { ...node, screenX: e.clientX - rect.left, screenY: e.clientY - rect.top } : null);
    };

    const handleClick = (e) => {
      const node = nearestNode(e.clientX, e.clientY);
      if (!node) return;
      if (node.kind === "branch") onRestoreBranchRef.current?.(node.stashId);
      else onJumpRef.current?.(node.index);
    };

    const handleLeave = () => setHoveredNode(null);

    canvas.addEventListener("pointermove", handleMove);
    canvas.addEventListener("pointerleave", handleLeave);
    canvas.addEventListener("click", handleClick);

    const clock = new THREE.Clock();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = clock.getDelta();
      uniforms.uTime.value += dt;
      group.rotation.z += dt * ROTATE_SPEED;
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

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointermove", handleMove);
      canvas.removeEventListener("pointerleave", handleLeave);
      canvas.removeEventListener("click", handleClick);
      sceneRef.current?.points?.geometry.dispose();
      sceneRef.current?.points?.material.dispose();
      sceneRef.current?.lines?.geometry.dispose();
      sceneRef.current?.lines?.material.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuilds the graph's geometry whenever the session's actual shape
  // changes (a new tracked edit, a branch stashed or restored) — cheap at
  // the node counts this panel ever deals with, so a full rebuild here
  // rather than an incremental diff is the simpler, equally correct choice.
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
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aActive", new THREE.BufferAttribute(actives, 1));

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

  return (
    <div className="history-constellation">
      <canvas ref={ canvasRef } className="history-constellation-canvas" />
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
    </div>
  );
};

export default HistoryConstellation;
