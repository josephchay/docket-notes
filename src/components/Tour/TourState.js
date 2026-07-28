import { Machine } from 'xstate';

// The first-run walk's little life: closed until Home decides the visitor
// hasn't seen it this session, then a greeting where the ink guide
// introduces itself, one stop per control worth knowing, and a farewell
// where the guide takes its bow and soaks away on a timer. NEXT walks
// forward, BACK retraces a stop, SKIP bails from anywhere — every road
// still ends in the same final "done".
export const tourMachine = Machine({
  id: 'tour',
  initial: 'closed',
  states: {
    closed: {
      on: { START: 'greeting' },
    },
    greeting: {
      on: { NEXT: 'activator', SKIP: 'done' },
    },
    activator: {
      on: { NEXT: 'search', SKIP: 'done' },
    },
    search: {
      on: { NEXT: 'theme', BACK: 'activator', SKIP: 'done' },
    },
    theme: {
      on: { NEXT: 'farewell', BACK: 'search', SKIP: 'done' },
    },
    farewell: {
      // The goodbye lingers just long enough for the ink to soak away.
      after: { 1900: 'done' },
      on: { NEXT: 'done', SKIP: 'done' },
    },
    done: {
      type: 'final',
    },
  },
});
