import React, { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import anime from "animejs";

import { NOTE_COLORS } from "../../constants/colors";

import "./InkCelebration.css";

const DROP_COUNT = 16;

// A little shower of ink when the desk crosses a milestone note count.
// Drops in every palette color tumble from the top of the screen, each
// squashing and settling on its own landing beat before soaking away, while
// a pill of praise blooms in above them and dissolves back out.
const InkCelebration = ({ celebration }) => {
  const dropsRef = useRef(null);

  useEffect(() => {
    if (!celebration || !dropsRef.current) return;

    const drops = Array.from(dropsRef.current.children);
    const names = Object.keys(NOTE_COLORS);

    drops.forEach((drop, i) => {
      const size = 10 + Math.random() * 15;
      drop.style.left = `${ Math.random() * 96 + 2 }%`;
      drop.style.width = `${ size }px`;
      drop.style.height = `${ size }px`;
      drop.style.backgroundColor = `var(--${ names[(i + Math.floor(Math.random() * names.length)) % names.length] }-color)`;
    });

    // One timeline per drop, fall and landing both riding the same stagger
    // so each drop's own squash-and-settle beat lands exactly when its own
    // fall finishes — translate/rotate hold the top-level duration for the
    // 950ms fall, then scale springs through the landing while opacity
    // holds through both and only fades right at the very end.
    anime.remove(drops);
    anime({
      targets: drops,
      translateY: () => window.innerHeight * (0.5 + Math.random() * 0.4),
      translateX: () => anime.random(-40, 40),
      rotate: () => anime.random(-200, 200),
      duration: 950,
      easing: "easeInQuad",
      scaleY: [
        { value: 1, duration: 950 },
        { value: .4, duration: 90, easing: "easeOutQuad" },
        { value: 1.3, duration: 170, easing: "easeOutElastic(1, .5)" },
        { value: 1, duration: 280, easing: "easeOutElastic(1, .6)" },
      ],
      scaleX: [
        { value: 1, duration: 950 },
        { value: 1.6, duration: 90, easing: "easeOutQuad" },
        { value: .85, duration: 170, easing: "easeOutElastic(1, .5)" },
        { value: 1, duration: 280, easing: "easeOutElastic(1, .6)" },
      ],
      opacity: [
        { value: 1, duration: 60 },
        { value: 1, duration: 1050 },
        { value: 0, duration: 380, easing: "easeInQuad" },
      ],
      delay: anime.stagger(42, { start: anime.random(0, 140) }),
    });
  }, [celebration]);

  return (
    <div
      className="ink-celebration"
      aria-hidden="true"
    >
      <div
        ref={ dropsRef }
        className="ink-celebration-drops"
      >
        {
          Array.from({ length: DROP_COUNT }).map((_, i) => (
            <span key={ i } className="ink-drop" />
          ))
        }
      </div>
      <div className="ink-celebration-pill-slot">
        <AnimatePresence>
          {
            celebration && (
              <motion.div
                key={ celebration.key }
                className="ink-celebration-pill"
                initial={{ opacity: 0, scale: .15, translateY: -14, borderRadius: 40 }}
                animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 999 }}
                exit={{
                  opacity: 0,
                  scale: .3,
                  translateY: -10,
                  transition: { duration: .22, ease: "easeIn" },
                }}
                transition={{ type: "spring", stiffness: 190, damping: 13, delay: .12 }}
              >
                ✦ { celebration.count } notes on the desk
              </motion.div>
            )
          }
        </AnimatePresence>
      </div>
    </div>
  );
};

export default InkCelebration;
