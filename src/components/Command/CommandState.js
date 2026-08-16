import { Machine } from 'xstate';

// The command palette's little life: folded away, open for casting, a
// brief "casting" beat after a command runs (long enough for the panel's
// own squash) before it folds itself away again, and — on a plain manual
// close (Escape, the backdrop, the X) rather than a cast — a "closing"
// beat first, long enough for the row list's own reverse stagger (see
// CLOSE_STAGGER_MAX/CLOSE_STAGGER_STEP in CommandPalette.jsx) to actually
// play before the sheet itself folds away under it. Deliberately a
// separate path from casting->closed: that transition already has its own
// distinct squash-fold choreography and shouldn't also drain the list.
export const commandMachine = Machine({
  id: 'commandPalette',
  initial: 'closed',
  states: {
    closed: {
      on: {
        TOGGLE: 'open',
        OPEN: 'open',
      },
    },
    open: {
      on: {
        TOGGLE: 'closing',
        CLOSE: 'closing',
        RUN: 'casting',
      },
    },
    // A reopen mid-drain is a change of mind, not a race — hand straight
    // back to 'open' rather than insisting on finishing the drain first.
    closing: {
      on: {
        TOGGLE: 'open',
        OPEN: 'open',
      },
      after: {
        300: 'closed',
      },
    },
    casting: {
      after: {
        260: 'closed',
      },
    },
  },
});
