/**
 * Deterministic simulation clock for the 3D flow loop.
 *
 * The browser's animation frames drive WHEN ticks happen; this accumulator
 * decides HOW MUCH simulated time each tick represents, clamped so a
 * backgrounded tab cannot deliver half a burette in one jump. Pure and tested.
 */

/** Longest real delta a single tick may claim, in seconds. */
export const MAX_TICK_SECONDS = 0.25;

export interface ClockState {
  /** Accumulated simulated seconds since `resetClock`. */
  elapsedSeconds: number;
  /** Raw volume accumulated at the current flow rate, in mL. */
  accumulatedMl: number;
}

export function resetClock(): ClockState {
  return { elapsedSeconds: 0, accumulatedMl: 0 };
}

/**
 * Advance the clock by one animation frame. `deltaMs` is the real frame delta
 * (e.g. from `useFrame`), `rateMlPerSecond` the active flow-mode rate.
 */
export function tickClock(
  state: ClockState,
  deltaMs: number,
  rateMlPerSecond: number,
): ClockState {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return state;
  const dt = Math.min(deltaMs / 1000, MAX_TICK_SECONDS);
  const safeRate = Number.isFinite(rateMlPerSecond) && rateMlPerSecond > 0 ? rateMlPerSecond : 0;
  return {
    elapsedSeconds: state.elapsedSeconds + dt,
    accumulatedMl: state.accumulatedMl + safeRate * dt,
  };
}
