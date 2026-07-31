import { Machine, assign } from 'xstate';

export const PLAYBACK_SPEEDS = [
  { key: 'slow', label: 'Slow', ms: 900 },
  { key: 'normal', label: 'Normal', ms: 480 },
  { key: 'fast', label: 'Fast', ms: 220 },
];

const DEFAULT_SPEED_INDEX = 1;

// The time-lapse's own little life — idle until pressed play, ticking
// forward one tracked step at a time while playing, and rolling itself
// back to idle the moment it either runs off the end of the timeline or is
// stopped early (a manual scrub, closing the panel). The actual stepping
// — advancing HistoryPanel's `cursor` via onJump — happens outside this
// machine, in a plain effect that watches `phase`; this just tracks
// whether that effect should be running and how fast, the same split
// SprintState.js's own machine keeps between phase and the ticking effect
// that drives it.
export const playbackMachine = Machine({
  id: 'historyPlayback',
  initial: 'idle',
  context: {
    speedIndex: DEFAULT_SPEED_INDEX,
  },
  states: {
    idle: {
      on: {
        PLAY: 'playing',
      },
    },
    playing: {
      on: {
        STOP: 'idle',
        DONE: 'idle',
      },
    },
  },
  on: {
    CYCLE_SPEED: {
      actions: assign({
        speedIndex: (ctx) => (ctx.speedIndex + 1) % PLAYBACK_SPEEDS.length,
      }),
    },
  },
});
