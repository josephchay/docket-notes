import { useAnimationControls } from "framer-motion";

// The starchy squash-and-stretch a tap leaves behind on an icon — the same
// jelly recipe the note editor's resize wobble and a note's spawn landing
// already use, packaged so any toolbar icon can borrow it. Runs on the
// icon's own inner span, never the button around it — the same split
// QuickDock and the nav rail's magnetic tools already use to keep an
// imperative squeeze from fighting the button's own whileHover/whileTap.
const useJellyTap = () => {
  const jelly = useAnimationControls();

  const squash = () => {
    jelly.stop();
    jelly.set({ scaleX: 1, scaleY: 1 });
    jelly.start({
      scaleX: [1, .74, 1.18, .93, 1.04, 1],
      scaleY: [1, 1.28, .84, 1.08, .97, 1],
      transition: { duration: .55, times: [0, .18, .42, .64, .84, 1], ease: "easeInOut" },
    });
  };

  return { jelly, squash };
};

export default useJellyTap;
