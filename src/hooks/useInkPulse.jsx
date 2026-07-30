import { useAnimationControls } from "framer-motion";
import { useEffect, useRef } from "react";

const IDLE_DELAY = 2200; // ms a pinned highlight sits still before it pools

// The free cursor's own two punctual reactions, borrowed for any shared
// layoutId highlight (a dock pill, a sort/tag thumb, a color ring) so it
// carries a bit of the same physicality instead of just sliding flatly
// between positions: a snappy jelly squash on press, and — left alone
// past IDLE_DELAY — one soft elastic pool, the same "deliberate little
// settle" the cursor itself takes when idle. Runs on a nested fill span,
// never the layoutId element itself — the same split useJellyTap uses to
// keep an imperative scale from fighting framer's own layout animation.
// `watch` is whatever identifies the highlight's current target (a
// selected mode, an active color) — change it and the idle timer re-arms.
const useInkPulse = (watch) => {
  const jelly = useAnimationControls();
  const idleTimer = useRef(null);

  const squash = () => {
    clearTimeout(idleTimer.current);
    jelly.stop();
    jelly.set({ scale: 1 });
    jelly.start({
      scale: [1, .82, 1.12, .96, 1.02, 1],
      transition: { duration: .5, times: [0, .18, .42, .64, .84, 1], ease: "easeInOut" },
    });
  };

  useEffect(() => {
    jelly.stop();
    jelly.set({ scale: 1 });

    idleTimer.current = setTimeout(() => {
      jelly.start({
        scale: [1, 1.14, .97, 1.03, 1],
        transition: { duration: .9, times: [0, .4, .68, .86, 1], ease: "easeInOut" },
      });
    }, IDLE_DELAY);

    return () => clearTimeout(idleTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch]);

  return { jelly, squash };
};

export default useInkPulse;
