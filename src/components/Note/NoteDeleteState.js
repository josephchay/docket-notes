import { Machine } from "xstate";

// Hold-to-delete's real lifecycle — genuinely worth a real machine rather
// than the three booleans plus a hand-tracked setTimeout id this used to
// be (a plain useState/clearTimeout chain in Note.jsx): the ring fills
// over HOLD_FILL_MS, releasing early during that window cancels cleanly,
// but once "confirmed" the delete is unstoppable — there is no RELEASE
// transition out of confirmed/completing, on purpose, the same way a
// real destructive hold (force-deleting a file, a camera shutter already
// past its own point of no return) doesn't let a late release undo a
// commitment already made. The old boolean version could actually let a
// release right as the hold confirmed flip isDeleting back to false for a
// beat — animating the header/date/edit decorations back into place —
// while the delete it could no longer prevent was still in flight; xstate
// simply has no edge for that to happen through anymore. Same
// interpret()/onTransition/send pattern every other machine in this app
// already uses (ConstellationState.js, CommandState.js, SprintState.js).
export const HOLD_FILL_MS = 1000;    // how long the ring takes to fill once the hold registers
export const CONFIRM_HOLD_MS = 600;  // the confirmed blob's own beat before the note is actually gone
export const COMPLETE_HOLD_MS = 600; // the completed pose's own beat before resetting

export const noteDeleteMachine = Machine({
  id: "noteDelete",
  initial: "idle",
  states: {
    idle: {
      on: { HOLD: "holding" },
    },
    holding: {
      on: { RELEASE: "idle" },
      after: { [HOLD_FILL_MS]: "confirmed" },
    },
    confirmed: {
      after: { [CONFIRM_HOLD_MS]: "completing" },
    },
    completing: {
      after: { [COMPLETE_HOLD_MS]: "idle" },
    },
  },
});
