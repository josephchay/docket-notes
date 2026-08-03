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
      on: { NEXT: 'backup', SKIP: 'done' },
    },
    backup: {
      on: { NEXT: 'ink', BACK: 'activator', SKIP: 'done' },
    },
    ink: {
      on: { NEXT: 'search', BACK: 'backup', SKIP: 'done' },
    },
    search: {
      on: { NEXT: 'star', BACK: 'ink', SKIP: 'done' },
    },
    star: {
      on: { NEXT: 'pile', BACK: 'search', SKIP: 'done' },
    },
    pile: {
      on: { NEXT: 'shuffle', BACK: 'star', SKIP: 'done' },
    },
    shuffle: {
      on: { NEXT: 'sort', BACK: 'pile', SKIP: 'done' },
    },
    sort: {
      on: { NEXT: 'select', BACK: 'shuffle', SKIP: 'done' },
    },
    select: {
      on: { NEXT: 'dock', BACK: 'sort', SKIP: 'done' },
    },
    dock: {
      on: { NEXT: 'focus', BACK: 'select', SKIP: 'done' },
    },
    focus: {
      on: { NEXT: 'insights', BACK: 'dock', SKIP: 'done' },
    },
    insights: {
      on: { NEXT: 'history', BACK: 'focus', SKIP: 'done' },
    },
    history: {
      on: { NEXT: 'theme', BACK: 'insights', SKIP: 'done' },
    },
    theme: {
      on: { NEXT: 'persist', BACK: 'history', SKIP: 'done' },
    },
    persist: {
      on: { NEXT: 'settings', BACK: 'theme', SKIP: 'done' },
    },
    settings: {
      on: { NEXT: 'command', BACK: 'persist', SKIP: 'done' },
    },
    command: {
      on: { NEXT: 'shortcuts', BACK: 'settings', SKIP: 'done' },
    },
    shortcuts: {
      on: { NEXT: 'farewell', BACK: 'command', SKIP: 'done' },
    },
    farewell: {
      // The goodbye lingers just long enough for the ink to soak away.
      after: { 1900: 'done' },
      on: { NEXT: 'done', SKIP: 'done' },
    },
    // Not a true final state — a manual replay (see TOUR_EVENT/
    // REPLAY_DONE_EVENT in TourGuide.jsx) sends START again from here to
    // walk the whole thing once more, same as a fresh first visit does.
    done: {
      on: { START: 'greeting' },
    },
  },
});
