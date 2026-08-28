import { useEffect, useRef } from "react";

// Standard set of "reachable by Tab" elements — explicitly excluding
// anything already opted out via tabindex="-1" (the panel root itself,
// once this hook lands focus there on open, is exactly such a case — it
// shouldn't then also count as one of its own boundaries).
const FOCUSABLE_SELECTOR = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "textarea:not([disabled])", "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// Traps Tab/Shift+Tab within panelRef's own subtree while `open`, moves
// focus into the panel the moment it opens, and restores focus to whatever
// had it before opening once it closes — proven out first for
// HistoryPanel.jsx, generalized here so every dot-to-sheet panel in this
// app (Insights, Trash, Sprint, Settings, History, Shortcuts, the Command
// Palette) can share one implementation instead of each carrying its own
// copy of the same logic.
//
// `panelRef` must point at a `tabIndex={-1}` element — the panel's own
// root is the usual choice, so it's programmatically focusable without
// joining the normal tab order. Pass `focusOnOpen: false` for a panel that
// already has its own entry-focus target (the Command Palette's search
// input has `autoFocus`, which this would otherwise fight a frame later).
//
// The restore-on-close step lives in this effect's own cleanup rather than
// an `else` branch keyed on `open` flipping to false, specifically so this
// also works correctly for a component that's mounted/unmounted by its
// *parent* instead of toggling its own internal `open` state (NoteEditor,
// unlike the other panels here, is only ever rendered while actively
// editing — passed a constant `true` — so it never sees an open→false
// transition of its own; a plain unmount runs this same cleanup instead).
//
// `trapTab` (default true) splits the Tab-cycling half off from the focus-
// on-open/restore-on-close half — added for ScriptureIndexPanel.jsx's own
// non-modal dock, which needs the LATTER (land focus somewhere reachable
// the instant it opens, restore it on close) at every width, but only
// wants the FORMER (an actual boundary-cycling trap) while it's genuinely
// acting like a modal. Keeping both halves on one `open` toggle would mean
// whatever makes the dock modal-only-sometimes (there, a viewport-width
// media query) would ALSO have to gate the panel's `open` argument itself
// — which then makes an unrelated width change look like a fresh open/
// close to this hook's first effect, stealing or restoring focus purely
// off a resize. Splitting them means `open` alone can stay the honest
// "is this thing actually open" signal for focus-on-open, while `trapTab`
// independently controls only whether Tab is boxed in once it's there.
const useFocusTrap = (panelRef, open, { focusOnOpen = true, trapTab = true } = {}) => {
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement;
    if (focusOnOpen) requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      if (previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus({ preventScroll: true });
        previouslyFocusedRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !trapTab) return;

    const handleKeyDown = (e) => {
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // document.activeElement === panel covers the moment right after
      // opening — focus starts on the panel root itself (see focusOnOpen
      // above), not yet on `first`, so a Shift+Tab pressed before ever
      // tabbing forward would otherwise slip past this guard and escape
      // the trap backward immediately.
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, trapTab, panelRef]);
};

export default useFocusTrap;
