import { Machine } from 'xstate';

// The first-run tour's little life: closed until Home decides the visitor
// hasn't seen it this session, then one state per spotlighted control,
// ending in a final "done" state whichever way it was left — walked through
// with NEXT, or bailed out of early with SKIP.
export const tourMachine = Machine({
  id: 'tour',
  initial: 'closed',
  states: {
    closed: {
      on: { START: 'activator' },
    },
    activator: {
      on: { NEXT: 'search', SKIP: 'done' },
    },
    search: {
      on: { NEXT: 'theme', SKIP: 'done' },
    },
    theme: {
      on: { NEXT: 'done', SKIP: 'done' },
    },
    done: {
      type: 'final',
    },
  },
});
