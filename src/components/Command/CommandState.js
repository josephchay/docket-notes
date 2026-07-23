import { Machine } from 'xstate';

// The command palette's little life: folded away, open for casting, and a
// brief "casting" beat after a command runs — long enough for the panel's
// squash — before it folds itself away again.
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
        TOGGLE: 'closed',
        CLOSE: 'closed',
        RUN: 'casting',
      },
    },
    casting: {
      after: {
        260: 'closed',
      },
    },
  },
});
