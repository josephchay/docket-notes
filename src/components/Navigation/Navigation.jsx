import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from "react-dom";

import { AnimatePresence, motion } from "framer-motion";
import { interpret } from "xstate";
import anime from "animejs";
import gsap from "gsap";
import { FaFileArrowDown, FaFileArrowUp } from "react-icons/fa6";

import { toggleMachine } from "./NavigationState";
import plusIcon from "../../assets/icons/plus.svg";
import { metaballBridge } from "../../utils/metaball";
import { SNAPPY, RAIL_SLIDE } from "../Motion";

import ColorSelector from "./ColorSelector";
import NavRipple from "./NavRipple";

import "./Navigation.css";

// The hovered pot's own real liquid reach to its immediate neighbors in
// the column (see the bridge state/render below) — the exact same
// two-circle metaball-neck geometry NoteConstellation.jsx's own cluster
// bridges and Note/MoveString.jsx's swap bridge already use, standing in
// here for what the CSS #gooey-effect filter on .activator-container only
// ever actually shows during the brief open/close transit (the pots sit
// too far apart at rest — ~28px of gap against a blur radius tuned for
// that transition — for the filter alone to ever visibly connect them
// once settled). maxDist explicit rather than metaballBridge's own
// default (roughly 4× the seed radius): that default is tuned for
// objects already close enough to plausibly touch, and at these pots' own
// 16px radius it would leave almost no margin against their real ~60px
// center spacing.
const POT_BRIDGE_MAX_DIST = 90;

// The export/import data-stream (see spawnDataStream below) — plain
// elements appended straight to document.body and GSAP-tweened, the same
// "no React reconciliation for something this short-lived" choice
// ColorSelector.jsx's own drag-to-pour ghost and Header's own
// FilterScatter already make. Carries no destination of its own (export
// leaves for a browser download, import arrives from a native file
// picker — neither has an on-screen element to actually travel to or
// from), so both directions just read as ink leaving/arriving the icon
// itself rather than literally animating toward a file.
const DATA_STREAM_COUNT = 6;

const colorSelectors = [
  { order: "first", color: "yellow", isSubsequent: false, dataFrom: "0", dataTo: "80" },
  { order: "second", color: "orange", isSubsequent: true, dataFrom: "100", dataTo: "140" },
  { order: "third", color: "green", isSubsequent: true, dataFrom: "160", dataTo: "200" },
  { order: "fourth", color: "blue", isSubsequent: true, dataFrom: "220", dataTo: "260" },
  { order: "fifth", color: "purple", isSubsequent: true, dataFrom: "280", dataTo: "320" },
  { order: "sixth", color: "pink", isSubsequent: true, dataFrom: "340", dataTo: "380" },
  { order: "seventh", color: "red", isSubsequent: true, dataFrom: "400", dataTo: "440" },
];

const Navigation = ({
  addNote,
  exportNotes,
  importNotes,
  focusMode,
  reduceMotion,
}) => {
  const navActivator = useRef(null);
  const fileInput = useRef(null);
  const logoRef = useRef(null);
  const rippleRef = useRef(null);
  const exportBtnRef = useRef(null);
  const importBtnRef = useRef(null);
  const [toggleService, setToggleService] = useState(null);

  // The hovered pot's own metaball reach (see POT_BRIDGE_MAX_DIST) — a
  // plain index into colorSelectors is enough to find its column
  // neighbors (index - 1 above, index + 1 below), and potRefs (populated
  // via each ColorSelector's own registerRef) is what supplies their
  // actual live screen positions.
  const potRefs = useRef([]);
  const [hoveredPot, setHoveredPot] = useState(null);
  const [bridges, setBridges] = useState([]);

  useEffect(() => {
    if (hoveredPot === null || reduceMotion) {
      setBridges([]);
      return;
    }

    const next = [];
    [hoveredPot - 1, hoveredPot + 1].forEach((neighborIndex) => {
      const a = potRefs.current[hoveredPot];
      const b = potRefs.current[neighborIndex];
      if (!a || !b) return;

      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const path = metaballBridge(
        rectA.left + rectA.width / 2, rectA.top + rectA.height / 2, rectA.width / 2,
        rectB.left + rectB.width / 2, rectB.top + rectB.height / 2, rectB.width / 2,
        { v: 0.7, maxDist: POT_BRIDGE_MAX_DIST },
      );
      if (path) {
        next.push({
          key: `${ hoveredPot }-${ neighborIndex }`,
          path,
          colorA: colorSelectors[hoveredPot].color,
          colorB: colorSelectors[neighborIndex].color,
        });
      }
    });
    setBridges(next);
  }, [hoveredPot, reduceMotion]);

  // The wordmark's letters spring up one by one with an elastic overshoot,
  // and do a little wave again whenever the pointer greets them.
  useEffect(() => {
    anime({
      targets: logoRef.current?.querySelectorAll(".logo-letter"),
      translateY: [26, 0],
      delay: anime.stagger(55, { start: 250 }),
      duration: 1100,
      easing: "easeOutElastic(1, .55)",
    });
  }, []);

  // The rail tools are gently magnetic: their icons lean toward the pointer
  // while it hovers, then snap home with an elastic wobble. Only the inner
  // icon span moves, so framer keeps the button's own scale to itself. Off
  // entirely under reduced motion — a pointer-tracking icon is exactly the
  // kind of large, continuous motion that convention already gates
  // elsewhere (see the constellation's own gravity well in
  // HistoryConstellation.jsx), and this one fires on every hover rather
  // than just once.
  const magnetMove = (e) => {
    if (reduceMotion) return;

    const icon = e.currentTarget.querySelector(".magnet");
    if (!icon) return;

    const rect = e.currentTarget.getBoundingClientRect();
    anime.remove(icon);
    anime.set(icon, {
      translateX: (e.clientX - rect.left - rect.width / 2) * .4,
      translateY: (e.clientY - rect.top - rect.height / 2) * .4,
    });
  }

  const magnetLeave = (e) => {
    if (reduceMotion) return;

    const icon = e.currentTarget.querySelector(".magnet");
    if (!icon) return;

    anime.remove(icon);
    anime({
      targets: icon,
      translateX: 0,
      translateY: 0,
      duration: 650,
      easing: "easeOutElastic(1, .4)",
    });
  }

  // direction "out" (export): drops start at the icon and fly up/away,
  // fading as they go. direction "in" (import): drops start scattered
  // above the icon and fall INTO it, fading right on arrival — the same
  // reasoning ColorSelector.jsx's own drag ghost is a portaled plain
  // element rather than a React-rendered one, just for a burst of several
  // rather than one.
  const spawnDataStream = (originEl, direction) => {
    if (reduceMotion || !originEl) return;

    const rect = originEl.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;

    for (let i = 0; i < DATA_STREAM_COUNT; i++) {
      const dot = document.createElement("span");
      dot.className = "nav-data-drop";
      document.body.appendChild(dot);

      const angle = (Math.random() - 0.5) * 1.2;
      const dist = 34 + Math.random() * 22;
      const dx = Math.sin(angle) * dist;
      const dy = -(30 + Math.random() * 26); // both directions travel along the same "up and away from the rail" line, just start/end swap

      if (direction === "out") {
        gsap.fromTo(dot,
          { x: originX, y: originY, opacity: 1, scale: .5 + Math.random() * .3 },
          {
            x: originX + dx, y: originY + dy, opacity: 0,
            duration: .6 + Math.random() * .2, delay: i * .04, ease: "power2.out",
            onComplete: () => dot.remove(),
          },
        );
      } else {
        gsap.fromTo(dot,
          { x: originX + dx, y: originY + dy, opacity: 0, scale: .5 + Math.random() * .3 },
          {
            x: originX, y: originY, opacity: 1,
            duration: .5 + Math.random() * .15, delay: i * .035, ease: "power2.in",
            onComplete: () => gsap.to(dot, { opacity: 0, duration: .15, onComplete: () => dot.remove() }),
          },
        );
      }
    }
  };

  const waveLogo = () => {
    const letters = logoRef.current?.querySelectorAll(".logo-letter");
    if (!letters) return;

    anime.remove(letters);
    anime({
      targets: letters,
      translateY: [
        { value: -8, duration: 160, easing: "easeOutQuad" },
        { value: 0, duration: 650, easing: "easeOutElastic(1, .5)" },
      ],
      delay: anime.stagger(45),
    });
  }

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      importNotes(file);
      spawnDataStream(importBtnRef.current, "in");
    }
    e.target.value = "";   // allow re-importing the same file
  }

  const handleExport = () => {
    spawnDataStream(exportBtnRef.current, "out");
    exportNotes();
  }

  const disableActivator = () => {
    navActivator.current.setAttribute('disabled', '');
  }

  const enableActivator = () => {
    navActivator.current.removeAttribute('disabled');
  }

  useEffect(() => {
    const open = () => {
      const tl = anime.timeline();

      disableActivator();
      rippleRef.current?.ripple();

      tl.add({
        targets: navActivator.current,
        translateY: [0, -14, 0],
        scale: [1, .8, 1],
        rotate: 316,
        duration: 800,
        easing: 'easeInOutSine',
      }).add({
          targets: '.color-selectors .first',
          translateY: [0, 80],
          duration: 3200,
          scaleY: [1.8, 1],
        }, '-=400'
      ).add({
        targets: '.color-selectors .subsequent',
        translateY: (el) => {
          return [el.getAttribute('data-from'), el.getAttribute('data-to')];
        },
        scaleY: [0, 1],
        duration: 1600,
        opacity: {
          value: 1,
          duration: 10,
        },
        delay: anime.stagger(240),
        complete: () => {
          enableActivator();
        }
      }, '-=2600');
    }

    const close = () => {
      const tl = anime.timeline();

      disableActivator();
      rippleRef.current?.ripple();

      tl.add({
        targets: navActivator.current,
        rotate: 0,
        duration: 600,
        easing: 'easeInOutSine',
      }).add({
        targets: '.color-selectors .selector',
        translateY: (el) => {
          return [el.getAttribute('data-to'), 0];
        },
        duration: 400,
        delay: anime.stagger(80),
        easing: 'easeInOutSine',
        complete: () => {
          enableActivator();
        }
      }, '-=400');
    }

    const interpretToggleMachine = () => {
      const toggleService = interpret(toggleMachine);

      toggleService.onTransition((state) => {
        if (state.value === 'active') {
          open();
        } else if (state.value === 'inactive') {
          close();
        }
      }).start();

      return toggleService;
    }

    const service = interpretToggleMachine();
    setToggleService(service);

    // Every other xstate machine in this app stops its service on
    // unmount (CommandPalette, SprintPanel, TourGuide, QuoteCard); this
    // was the one place that didn't, leaking a running interpreter (and
    // its subscription) if Navigation ever unmounts.
    return () => service.stop();
  }, []);

  return (
    <motion.div
      className="nav"
      animate={{ x: focusMode ? -170 : 0 }}
      // A fixed duration + the exact bezier .home's grid-track collapse uses
      // (Home.css), rather than an open-ended spring — so the rail's slide
      // and the notes grid reclaiming that space finish in the same beat
      // instead of two similar-but-not-quite-matched motions.
      transition={ RAIL_SLIDE }
    >
      <motion.div
        initial={{
          opacity: 0,
          translateX: -140,
          scale: 1.04,
        }}
        animate={{
          opacity: 1,
          translateX: 0,
          scale: 1,
        }}
        transition={{
          duration: 0.4,
          type: "spring",
          stiffness: 120,
        }}
        className="logo"
        ref={ logoRef }
      >
        <h4
          onMouseEnter={ waveLogo }
        >
          {
            "Docket".split("").map((letter, index) => (
              <span
                key={ index }
                className="logo-letter"
              >
                { letter }
              </span>
            ))
          }
        </h4>
        {/* An unmissable little credit for the AI that helped build this
            desk — pops in right after the wordmark lands, then keeps a
            slow shimmer of its own so it never quite fades into the rail. */}
        <motion.div
          className="ai-credit"
          initial={{ opacity: 0, scale: 0, rotate: -10 }}
          animate={{ opacity: 1, scale: [0, 1.22, .94, 1.06, 1], rotate: 0 }}
          transition={{ duration: 1, type: "spring", stiffness: 220, damping: 11, delay: 1.05 }}
        >
          <span className="ai-credit-spark">✦</span>
          <span className="ai-credit-text">
            <span className="ai-credit-made">Made with</span>
            <span className="ai-credit-name">Claude AI</span>
          </span>
        </motion.div>
      </motion.div>
      <div
        className="activator-container"
      >
        <motion.div
          initial={{
            scale: 0,
          }}
          animate={{
            scale: 1,
          }}
          transition={{
            duration: 0.8,
            type: "spring",
            stiffness: 240,
            delay: 0.3,
          }}
          className="activator"
        >
          <button
            id="navActivator"
            ref={ navActivator }
            onClick={ () => toggleService.send("TOGGLE") }
          >
            {/* The activator's own ripple (see NavRipple.jsx) — off
                entirely under reduced motion rather than mounted-but-never-
                fired, the same restraint every other decorative WebGL
                layer in this app (ThemeWipeGL included) already keeps. */}
            {
              !reduceMotion && <NavRipple ref={ rippleRef } color="#ffffff" />
            }
            <img src={ plusIcon } alt="Plus Icon" />
          </button>
        </motion.div>
        <motion.div
          initial={{
            opacity: 0,
            scale: 0,
          }}
          animate={{
            opacity: 1,
            scale: 1,
          }}
          transition={{
            delay: 1.6,
          }}
          className="color-selectors"
        >
          {
            colorSelectors.map((selector, index) => (
              <ColorSelector
                key={ index }
                className={`selector ${ selector.order } ${ selector.isSubsequent ? 'subsequent' : '' } ${ selector.color }-bg`}
                color={ selector.color }
                dataFrom={ selector.dataFrom }
                dataTo={ selector.dataTo }
                addNote={ addNote }
                reduceMotion={ reduceMotion }
                index={ index }
                registerRef={ (el) => { potRefs.current[index] = el; } }
                onHoverStart={ () => setHoveredPot(index) }
                onHoverEnd={ () => setHoveredPot((prev) => (prev === index ? null : prev)) }
              />
            ))
          }
        </motion.div>
        {/* The hovered pot's own real liquid reach (see POT_BRIDGE_MAX_DIST)
            — portaled to document.body for the same reason Note.jsx's own
            radial menu and MoveString's swap bridge already are: page-
            absolute coordinates, escaping the activator's own gooey-filter
            stacking context entirely rather than fighting it. */}
        {
          createPortal(
            <AnimatePresence>
              {
                bridges.length > 0 && (
                  <svg key="pot-bridges" className="nav-pot-bridge-layer" aria-hidden="true">
                    <defs>
                      {
                        // objectBoundingBox (the default — no gradientUnits
                        // override) rather than userSpaceOnUse: the bridge
                        // path's own bbox already runs roughly top-to-bottom
                        // between the two pots (they're a vertical column),
                        // so 0→1 fractional coordinates land close enough to
                        // each pot's own end without needing their actual
                        // page-pixel positions on hand here too.
                        bridges.map((bridge) => (
                          <linearGradient key={ bridge.key } id={ `pot-bridge-${ bridge.key }` } x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor={ `var(--${ bridge.colorA }-color)` } />
                            <stop offset="1" stopColor={ `var(--${ bridge.colorB }-color)` } />
                          </linearGradient>
                        ))
                      }
                    </defs>
                    {
                      bridges.map((bridge) => (
                        <motion.path
                          key={ bridge.key }
                          d={ bridge.path }
                          fill={ `url(#pot-bridge-${ bridge.key })` }
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: .18 }}
                        />
                      ))
                    }
                  </svg>
                )
              }
            </AnimatePresence>,
            document.body,
          )
        }
      </div>
      <motion.div
        initial={{
          opacity: 0,
          translateY: 40,
        }}
        animate={{
          opacity: 1,
          translateY: 0,
        }}
        transition={{
          duration: 0.6,
          type: "spring",
          stiffness: 160,
          delay: 1,
        }}
        className="nav-tools"
      >
        <motion.button
          ref={ exportBtnRef }
          type="button"
          aria-label="Save all notes to a backup file"
          className="nav-tool export-trigger"
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: .9 }}
          transition={ SNAPPY }
          onMouseMove={ magnetMove }
          onMouseLeave={ magnetLeave }
          onClick={ handleExport }
        >
          <span className="magnet">
            <FaFileArrowDown className="nav-tool-icon" />
          </span>
        </motion.button>
        <motion.button
          ref={ importBtnRef }
          id="navImportButton"
          type="button"
          aria-label="Bring notes in from a backup file"
          className="nav-tool"
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: .9 }}
          transition={ SNAPPY }
          onMouseMove={ magnetMove }
          onMouseLeave={ magnetLeave }
          onClick={ () => fileInput.current?.click() }
        >
          <span className="magnet">
            <FaFileArrowUp className="nav-tool-icon" />
          </span>
        </motion.button>
        <input
          ref={ fileInput }
          type="file"
          accept="application/json"
          hidden
          onChange={ handleImportFile }
        />
      </motion.div>
    </motion.div>
  );
}

export default Navigation;
