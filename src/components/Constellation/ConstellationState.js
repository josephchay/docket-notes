import { Machine, assign } from "xstate";

// The note-select lifecycle — genuinely worth its own explicit machine
// rather than a plain boolean, because "selecting" isn't instantaneous:
// picking a node plays a real zoom-toward-it-and-fade-its-threads flourish
// (see NoteConstellation.jsx's own dive effect) before the note actually
// opens, and this machine is the one source of truth for that sequencing —
// onSelectNote only ever fires from the terminal "done" state, never
// directly from the click handler, so the animation is guaranteed to
// finish before the editor takes over. Same interpret()/onTransition/send
// pattern every other panel's own xstate machine in this app already uses
// (SprintState.js, CommandState.js, TourState.js).
//
// Deliberately NOT modeling drag or hover here — those are continuous,
// per-frame physics state (see NoteConstellation.jsx's own byId map),
// the wrong shape for a state machine. This only owns the one genuinely
// discrete, multi-phase transition the whole interaction actually has.
export const DIVE_DURATION_MS = 520;

export const constellationMachine = Machine({
  id: "constellation",
  initial: "idle",
  context: { selectedId: null },
  states: {
    idle: {
      on: {
        SELECT: { target: "diving", actions: assign({ selectedId: (_ctx, event) => event.id }) },
      },
    },
    diving: {
      after: {
        [DIVE_DURATION_MS]: "done",
      },
    },
    done: {
      type: "final",
    },
  },
});
