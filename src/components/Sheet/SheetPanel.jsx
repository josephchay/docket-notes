import { AnimatePresence, motion } from "framer-motion";

import useBlobClipMorph from "../../hooks/useBlobClipMorph";
import useFocusTrap from "../../hooks/useFocusTrap";
import { EXIT_SPRING } from "../Motion";

// The dot-to-sheet shell every panel in this app opens through — the
// backdrop, the blob-clip morph (see useBlobClipMorph), and the focus trap
// (see useFocusTrap) were hand-copied near-identically across seven files
// (Command, Insights, Settings, Shortcuts, Sprint, Trash, History). This is
// the one place that shape now lives; each panel keeps its own CSS classes
// and content, and only hands this the handful of things that actually
// differ (radius, class names, an aria-label, an onClose).
//
// The entrance itself is a real step up from the plain uniform `scale`
// spring every panel had: scaleX/scaleY now ride their own asymmetric
// keyframe curve — a genuine squash-and-stretch jelly landing, the same
// character useJellyTap already gives every toolbar icon's tap, rather
// than an approximation via spring overshoot alone — while a fresh
// rotateX tip (backed by transformPerspective) has the sheet lean back a
// few degrees as it grows, like a page tipping up off the desk toward the
// viewer, on top of the blob-clip morph that was already there. Position/
// opacity/border-radius still ride the original physical spring.
const ENTER_TIMES = [0, .45, .68, .86, 1];

const buildEnterAnimate = (radius) => ({
  opacity: 1,
  scaleX: [.08, 1.07, .96, 1.015, 1],
  scaleY: [.08, .93, 1.06, .985, 1],
  translateY: 0,
  rotateX: 0,
  borderRadius: radius,
  transition: {
    default: { type: "spring", stiffness: 190, damping: 14 },
    scaleX: { duration: .68, times: ENTER_TIMES, ease: "easeInOut" },
    scaleY: { duration: .68, times: ENTER_TIMES, ease: "easeInOut" },
  },
});

// The exit was a flat shrink-and-fade — the one corner of the panel's own
// grow-from-a-dot language it never echoed back. Now it mirrors
// buildEnterAnimate in reverse: a small squash-and-stretch bulge (times
// [0, .35, 1], same asymmetric scaleX/scaleY split) before the sheet
// flattens back down toward the dot it grew from, tipping forward on
// rotateX the opposite way the entrance tipped back. scaleX/scaleY stay
// real numbers throughout so useBlobClipMorph keeps reading a sensible `t`
// as the blob-clip retreats alongside it.
const EXIT_TIMES = [0, .35, 1];

const EXIT = {
  opacity: 0,
  scaleX: [1, 1.06, .1],
  scaleY: [1, .88, .08],
  translateY: 70,
  rotateX: -16,
  borderRadius: 60,
  transition: {
    default: EXIT_SPRING,
    scaleX: { duration: .34, times: EXIT_TIMES, ease: "easeInOut" },
    scaleY: { duration: .34, times: EXIT_TIMES, ease: "easeInOut" },
  },
};

// `panelRef` is owned by the caller (several panels — Trash's drop-physics
// handoff, History's own keyboard nav — read its rect/DOM node for reasons
// entirely their own), just handed here too so the morph/focus-trap hooks
// and the actual DOM ref land on the same node.
const SheetPanel = ({
  open,
  onClose,
  panelRef,
  radius = 22,
  layerClassName,
  backdropClassName,
  panelClassName,
  ariaLabel,
  focusOnOpen = true,
  animate: animateOverride,
  children,
}) => {
  const onBlobUpdate = useBlobClipMorph(panelRef, open, radius);
  useFocusTrap(panelRef, open, { focusOnOpen });

  return (
    <AnimatePresence>
      {
        open && (
          <div className={ layerClassName }>
            <motion.div
              className={ backdropClassName }
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .2 } }}
              onClick={ onClose }
            />
            <motion.div
              ref={ panelRef }
              tabIndex={ -1 }
              role="dialog"
              aria-modal="true"
              aria-label={ ariaLabel }
              className={ panelClassName }
              style={{ transformPerspective: 900 }}
              initial={{ opacity: 0, scaleX: .08, scaleY: .08, translateY: 90, rotateX: -18, borderRadius: 60 }}
              onUpdate={ onBlobUpdate }
              animate={ animateOverride ?? buildEnterAnimate(radius) }
              exit={ EXIT }
            >
              { children }
            </motion.div>
          </div>
        )
      }
    </AnimatePresence>
  );
};

export default SheetPanel;
