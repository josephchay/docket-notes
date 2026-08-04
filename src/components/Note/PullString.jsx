import { useState, useRef, useEffect } from "react";
import { useMotionValue, useTransform, useMotionValueEvent } from "framer-motion";

import PullRig from "./PullRig";
import { DRAG_SNAP } from "../Motion";

const PULL_THRESHOLD = 120;   // how far "far enough" is (px)

// A single decorative elastic pull-string. Grab the tassel, stretch the rope,
// and release past the threshold to fire `onTrigger` with a little sparkle burst.
const PullString = ({ anchorX, restY = 26, colorName, icon, verb, onTrigger }) => {
  const pullX = useMotionValue(0);
  const pullY = useMotionValue(0);
  const tabRef = useRef(null);
  const readyRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [burst, setBurst] = useState(false);

  // The rope: a quadratic curve from the note's edge to the dragged tassel,
  // sagging while slack and pulling taut the further it is stretched.
  const ropePath = useTransform([pullX, pullY], ([x, y]) => {
    const tx = anchorX + x;
    const ty = restY + y;
    const sag = Math.max(0, 20 - Math.abs(y) * 0.16);
    const cx = (anchorX + tx) / 2;
    const cy = ty / 2 + sag;
    return `M ${anchorX} 0 Q ${cx} ${cy} ${tx} ${ty}`;
  });

  const ropeWidth = useTransform(pullY, [0, 220], [6, 2.2], { clamp: true });
  const gripScale = useTransform(pullY, [0, PULL_THRESHOLD, 240], [1, 1.2, 1.36]);
  const glowOpacity = useTransform(pullY, [40, PULL_THRESHOLD], [0, 1], { clamp: true });

  useMotionValueEvent(pullY, "change", () => {
    const distance = Math.hypot(pullX.get(), pullY.get());
    const isReady = distance > PULL_THRESHOLD;
    if (isReady !== readyRef.current) {
      readyRef.current = isReady;
      setReady(isReady);
    }
  });

  const handleEnd = () => {
    const distance = Math.hypot(pullX.get(), pullY.get());
    if (distance > PULL_THRESHOLD) {
      onTrigger();
      setBurst(true);
      setTimeout(() => setBurst(false), 750);
    }
    readyRef.current = false;
    setReady(false);
  };

  // Stop the tassel's press from bubbling into the note's press handlers, so
  // pulling never starts the long-press delete or the note's tap-shrink.
  useEffect(() => {
    const node = tabRef.current;
    if (!node) return;

    const stop = (e) => e.stopPropagation();
    node.addEventListener("pointerdown", stop);

    return () => node.removeEventListener("pointerdown", stop);
  }, []);

  return (
    <PullRig
      anchorX={ anchorX }
      restY={ restY }
      colorName={ colorName }
      pullX={ pullX }
      pullY={ pullY }
      ropePath={ ropePath }
      ropeWidth={ ropeWidth }
      gripScale={ gripScale }
      glowOpacity={ glowOpacity }
      ready={ ready }
      hintText={ `Release to ${ verb } ✦` }
      tabRef={ tabRef }
      tabAriaLabel={ `Pull to ${ verb }` }
      tabClassName={ `pull-tab ${ colorName }-bg ${ ready ? "ready" : "" }` }
      tabContent={ icon }
      burst={ burst }
      dragProps={{
        drag: true,
        dragSnapToOrigin: true,
        dragElastic: 0.5,
        dragConstraints: { left: -70, right: 70, top: 0, bottom: 220 },
        dragTransition: DRAG_SNAP,
        onDragEnd: handleEnd,
      }}
    />
  );
};

export default PullString;
