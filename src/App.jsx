import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import "./constants/colors.css";
import "../src/base/commons.css";

import Home from "./pages/Home";
import CursorDot from "./components/Cursor/CursorDot";
import CursorAura from "./components/Cursor/CursorAura";
import LoadIntro from "./components/Intro/LoadIntro";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary";
import { CURSOR_STYLE_EVENT } from "./components/Settings/SettingsPanel";
import { hasSeenIntro, loadSettings } from "./utils/storage";
import { prefersNativeCursor } from "./utils/cursorMotion";
import { id } from "./utils/math";

import './App.css';

const App = () => {
  const [showIntro, setShowIntro] = useState(() => !hasSeenIntro());

  // Owned here (rather than by Home, which is this component's own child)
  // since this is what actually decides which cursor to mount — Settings
  // lives deep inside Home's tree, so it reaches this choice the same
  // event-based way every other cross-cutting concern in this app already
  // does, not a new prop threaded down and back up past a boundary that
  // currently has none.
  const [cursorStyle, setCursorStyle] = useState(() => (loadSettings().cursorStyle === "aura" ? "aura" : "dot"));

  // Swapping cursors used to just be an instant unmount/mount — one
  // cursor vanishing and the other popping in a frame later, jarring next
  // to how carefully both of them are otherwise animated. A quick bloom of
  // ink at wherever the pointer actually was masks that cut: it blooms out
  // right as the old cursor is torn down and the new one mounts underneath
  // it, then soaks away — reads as the ink itself changing shape, not a
  // hard swap. Purely decorative, so it's skipped for reduced-motion/touch
  // visitors the same way both cursors already skip themselves.
  const [swapBloom, setSwapBloom] = useState(null);
  const lastPointRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  // A plain ref, not just a read of `cursorStyle` — this effect only ever
  // runs once ([] deps), so a closure over the state itself would stay
  // frozen at whatever it was on mount instead of tracking real changes.
  const cursorStyleRef = useRef(cursorStyle);
  cursorStyleRef.current = cursorStyle;

  useEffect(() => {
    const track = (e) => { lastPointRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", track, { passive: true });
    return () => window.removeEventListener("pointermove", track);
  }, []);

  useEffect(() => {
    const handleChange = (e) => {
      const next = e.detail === "aura" ? "aura" : "dot";

      if (next !== cursorStyleRef.current && !prefersNativeCursor()) {
        const { x, y } = lastPointRef.current;
        setSwapBloom({ key: id(), x, y });
      }

      setCursorStyle(next);
    };

    window.addEventListener(CURSOR_STYLE_EVENT, handleChange);
    return () => window.removeEventListener(CURSOR_STYLE_EVENT, handleChange);
  }, []);

  return (
    <div className="App">
      <ErrorBoundary>
        <Home />
      </ErrorBoundary>
      { cursorStyle === "aura" ? <CursorAura /> : <CursorDot /> }
      <AnimatePresence>
        {
          swapBloom && (
            <motion.span
              key={ swapBloom.key }
              className="cursor-swap-bloom"
              style={{ left: swapBloom.x, top: swapBloom.y }}
              initial={{ scale: 0, opacity: .85 }}
              animate={{ scale: [0, 1.5, 1.15], opacity: [.85, .55, 0] }}
              transition={{ duration: .55, times: [0, .4, 1], ease: "easeOut" }}
              onAnimationComplete={ () => setSwapBloom(null) }
              aria-hidden="true"
            />
          )
        }
      </AnimatePresence>
      {
        showIntro && (
          <LoadIntro onDone={ () => setShowIntro(false) } />
        )
      }
    </div>
  );
}

export default App;
