import { motion } from "framer-motion";

import FluidVisualizer from "./FluidVisualizer";

import "./FluidPlayerDock.css";

// A persistent strip of the SPH fluid pool docked at the bottom of the
// main page — not a modal, always there, unlike FluidVisualizerPanel.jsx's
// own command-palette-summoned version (which stays available separately;
// this doesn't replace it). Reuses that exact same FluidVisualizer
// component and its already-verified physics wholesale — only the pool's
// own shape (wide and shallow, matching a docked bar rather than the
// panel's roughly-square stage) and the transport layout (one centered
// pill floating on the fluid, not a stacked row beneath it) differ, both
// via props FluidVisualizer.jsx now exposes for exactly this purpose. See
// that file's own comments for why the underlying physics constants
// (density, stiffness, viscosity, gravity, spacing, smoothing radius,
// substeps) are untouched here — only DOMAIN_W/DOMAIN_H/NX/NY, which were
// always pure layout, not physics, and don't affect the stability analysis
// already done for them.
//
// Positioned well clear of QuickDock (bottom:26px, ~62px tall) and the
// sprint capsule that stacks above it while a sprint is ticking
// (bottom:96px, ~40px tall — tallest point ≈136px from the viewport
// bottom) — bottom:148px leaves a clean 12px of headroom above the taller
// of those two regardless of which happens to be showing, without needing
// to move or coordinate with either.
const FluidPlayerDock = ({ reduceMotion }) => (
  <motion.div
    className="fluid-player-dock"
    initial={{ opacity: 0, scale: .3, translateY: 70 }}
    animate={{ opacity: 1, scale: 1, translateY: 0 }}
    exit={{ opacity: 0, scale: .3, translateY: 70, transition: { duration: .2, ease: "easeIn" } }}
    transition={{ type: "spring", stiffness: 220, damping: 16, delay: .3 }}
  >
    <FluidVisualizer
      reduceMotion={ reduceMotion }
      domainW={ 60 }
      domainH={ 9.5 }
      gridCols={ 44 }
      gridRows={ 3 }
      activationHeight={ 2.6 }
      controlsPosition="overlay"
    />
  </motion.div>
);

export default FluidPlayerDock;
