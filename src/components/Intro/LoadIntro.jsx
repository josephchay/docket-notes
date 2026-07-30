import { useEffect, useRef } from "react";
import gsap from "gsap";

import { loadSettings, markIntroSeen } from "../../utils/storage";

import "./LoadIntro.css";

// The page's own ink/paper pair — same values Home.jsx's THEME_BG uses for
// the theme wipe, just read here directly since the intro plays before
// Home has had a chance to set data-theme itself.
const INK = { light: "#191919", dark: "#fffeff" };
const PAPER = { light: "#fffeff", dark: "#161616" };

const REST_DIAMETER = 56; // px, matches .load-intro-ink in the stylesheet

const WORDMARK = "Docket".split("");

// The very first thing a fresh visitor sees, once per browser: a drop of
// the page's own ink blooms from center — the same reach-to-farthest-corner
// bloom math ThemeWipe.jsx already uses for its theme-flip wash, reused here
// as a full-bleed field — the "Docket" wordmark springs up letter by letter
// on top of it wearing the liquid-text filter (see LiquidTextFilter.jsx)
// for a living wobble, holds for a beat, then the whole thing scales up and
// fades to reveal the desk underneath. One imperative GSAP timeline drives
// every step, the same imperative-driver pattern InkGoo.jsx and QuickDock's
// magnetic tweens already use, rather than trying to choreograph it through
// declarative re-renders.
const LoadIntro = ({ onDone }) => {
  const inkRef = useRef(null);
  const letterRefs = useRef([]);

  // Read once, synchronously, rather than as state — Home.jsx hasn't
  // mounted yet to set data-theme, so this is the only source of truth for
  // which ink the intro should pour in.
  const themeRef = useRef(loadSettings().theme === "dark" ? "dark" : "light");
  const theme = themeRef.current;

  useEffect(() => {
    if (!inkRef.current) return;

    const reach = Math.hypot(window.innerWidth, window.innerHeight) / 2;
    const scale = (reach * 2.3) / REST_DIAMETER;

    const tl = gsap.timeline({
      defaults: { ease: "power2.out" },
      onComplete: () => {
        markIntroSeen();
        onDone?.();
      },
    });

    tl.set(inkRef.current, { scale: 0 })
      .set(letterRefs.current, { y: 70, opacity: 0 })
      .to(inkRef.current, { scale, duration: .85, ease: "back.out(1.35)" }, 0)
      .to(letterRefs.current, {
        y: 0,
        opacity: 1,
        duration: .5,
        stagger: .055,
        ease: "back.out(1.7)",
      }, .45)
      .to(inkRef.current, { scale: scale * 1.45, opacity: 0, duration: .5, ease: "power2.in" }, "+=.6")
      .to(letterRefs.current, { y: -40, opacity: 0, duration: .35, stagger: .02, ease: "power2.in" }, "<");

    return () => tl.kill();
    // Plays once, for the mount that owns the intro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="load-intro">
      <span
        ref={ inkRef }
        className="load-intro-ink"
        style={{ backgroundColor: INK[theme] }}
      />
      <h1 className="load-intro-word liquid-text" aria-label="Docket" style={{ color: PAPER[theme] }}>
        {
          WORDMARK.map((letter, index) => (
            <span
              key={ index }
              ref={ (el) => { letterRefs.current[index] = el; } }
              className="load-intro-letter"
            >
              { letter }
            </span>
          ))
        }
      </h1>
    </div>
  );
};

export default LoadIntro;
