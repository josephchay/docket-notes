import { Machine } from 'xstate';

// The shot list for the replay of the original Dribbble film the desk was
// built from (src/assets/miscellaneous/dribbble-14037848-…mp4), one state
// per scene, advanced entirely by timers — this is a film, not a dialog.
// Every scene answers STOP so Escape can drop the whole production and
// return the desk to the visitor mid-take.
//
// The delays are cut to the rail's own choreography in Navigation.jsx: the
// pour timeline runs ~3.8s from the activator click to the last pot
// settling, which is exactly what "pouring" plus "reachPot" add up to — the
// ghost cursor arrives on the orange pot right as it stops moving.
export const replayMachine = Machine({
  id: 'replay',
  initial: 'idle',
  states: {
    idle: {
      on: { PLAY: 'curtain' },
    },
    // Chrome fades away, the ghost cursor wakes up.
    curtain: {
      after: { 500: 'dollyIn' },
      on: { STOP: 'idle' },
    },
    // The camera pushes in on the rail's + activator.
    dollyIn: {
      after: { 1600: 'reachActivator' },
      on: { STOP: 'idle' },
    },
    // The cursor glides onto the +.
    reachActivator: {
      after: { 700: 'pressActivator' },
      on: { STOP: 'idle' },
    },
    // Squash, ripple, and a real click — the rail machine takes it from here.
    pressActivator: {
      after: { 420: 'pouring' },
      on: { STOP: 'idle' },
    },
    // The ink pots pour down the rail; the cursor drifts after them.
    pouring: {
      after: { 3050: 'reachPot' },
      on: { STOP: 'idle' },
    },
    // Over to the orange pot, arriving as it settles.
    reachPot: {
      after: { 750: 'pressPot' },
      on: { STOP: 'idle' },
    },
    // The pot is really clicked: a real note is poured, with the pot as its
    // spawn origin, and the paper morph in Note.jsx plays for real.
    pressPot: {
      after: { 420: 'birth' },
      on: { STOP: 'idle' },
    },
    // A held beat while the drop squeezes free and flies for its slot.
    birth: {
      after: { 850: 'dollyOut' },
      on: { STOP: 'idle' },
    },
    // The camera eases back out as the note lands in the grid.
    dollyOut: {
      after: { 1700: 'inscribe' },
      on: { STOP: 'idle' },
    },
    // "This is a Docket note." types itself onto the fresh paper.
    inscribe: {
      after: { 1500: 'bow' },
      on: { STOP: 'idle' },
    },
    // Chrome returns, the cursor soaks away, the desk is handed back.
    bow: {
      after: { 850: 'idle' },
      on: { STOP: 'idle' },
    },
  },
});
