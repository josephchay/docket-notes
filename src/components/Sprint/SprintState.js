import { Machine, assign } from 'xstate';

export const SPRINT_PRESETS = [
  { key: 'short', label: '15', seconds: 15 * 60 },
  { key: 'classic', label: '25', seconds: 25 * 60 },
  { key: 'long', label: '45', seconds: 45 * 60 },
];

const DEFAULT_SPRINT_SECONDS = SPRINT_PRESETS[1].seconds;
const DEFAULT_BREAK_SECONDS = 5 * 60;

// A focus sprint's little life: idle until poured, running down while the
// desk stays quiet, pausable mid-flight, and rolling straight into a break
// the moment it hits zero — which rolls itself back to idle once it, in
// turn, runs out. `phase` (rather than the state name alone) is what the
// ink-ring reads to know whether it's draining a sprint or a break, since
// both "running" and "break" tick the same way.
export const sprintMachine = Machine({
  id: 'sprint',
  initial: 'idle',
  context: {
    sprintSeconds: DEFAULT_SPRINT_SECONDS,
    breakSeconds: DEFAULT_BREAK_SECONDS,
    secondsLeft: DEFAULT_SPRINT_SECONDS,
    phase: 'sprint',
  },
  states: {
    idle: {
      on: {
        SET_LENGTH: {
          actions: assign({
            sprintSeconds: (_ctx, event) => event.seconds,
            secondsLeft: (_ctx, event) => event.seconds,
          }),
        },
        START: {
          target: 'running',
          actions: assign({
            secondsLeft: (ctx) => ctx.sprintSeconds,
            phase: 'sprint',
          }),
        },
      },
    },
    running: {
      on: {
        PAUSE: 'paused',
        RESET: {
          target: 'idle',
          actions: assign({
            secondsLeft: (ctx) => ctx.sprintSeconds,
            phase: 'sprint',
          }),
        },
        TICK: [
          {
            cond: (ctx) => ctx.secondsLeft <= 1,
            target: 'break',
            actions: assign({
              secondsLeft: (ctx) => ctx.breakSeconds,
              phase: 'break',
            }),
          },
          {
            actions: assign({ secondsLeft: (ctx) => ctx.secondsLeft - 1 }),
          },
        ],
      },
    },
    paused: {
      on: {
        RESUME: 'running',
        RESET: {
          target: 'idle',
          actions: assign({
            secondsLeft: (ctx) => ctx.sprintSeconds,
            phase: 'sprint',
          }),
        },
      },
    },
    break: {
      on: {
        SKIP: {
          target: 'idle',
          actions: assign({
            secondsLeft: (ctx) => ctx.sprintSeconds,
            phase: 'sprint',
          }),
        },
        RESET: {
          target: 'idle',
          actions: assign({
            secondsLeft: (ctx) => ctx.sprintSeconds,
            phase: 'sprint',
          }),
        },
        TICK: [
          {
            cond: (ctx) => ctx.secondsLeft <= 1,
            target: 'idle',
            actions: assign({
              secondsLeft: (ctx) => ctx.sprintSeconds,
              phase: 'sprint',
            }),
          },
          {
            actions: assign({ secondsLeft: (ctx) => ctx.secondsLeft - 1 }),
          },
        ],
      },
    },
  },
});
