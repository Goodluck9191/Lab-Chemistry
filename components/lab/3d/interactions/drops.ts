/**
 * Counting drops out of a dropper held in the student's hand.
 *
 * Adding the indicator is a physical act: the student tips the phenolphthalein
 * dropper over the flask and a few drops fall in. The domain action takes an
 * integer, so the gesture has to produce one — and it must not be invented at
 * random: the same tilt that runs for the same time yields the same count, the
 * count is clamped into the range the experiment configures, and a dropper that
 * never left its upright pose yields nothing at all.
 *
 * Pure: no React, no scene, no chemistry. The caller decides when a pour starts
 * and stops; this decides how many drops it was worth.
 */

/** How long a single drop takes to fall from a squeezed dropper, ms. */
export const DROP_INTERVAL_MS = 450;

/** The domain's own bounds (`addIndicator` accepts an integer 1..20). */
export const MIN_DROPS = 1;
export const MAX_DROPS = 20;

/**
 * Drops for a pour that lasted `ms`. A pour too short to release a drop still
 * releases one: a student who tipped the dropper and got nothing back would
 * reasonably conclude the dropper was broken.
 */
export function dropsForPourMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(MIN_DROPS, Math.floor(ms / DROP_INTERVAL_MS) + 1);
}

/**
 * Bring a counted pour into the range the experiment documents (e.g. 2–3 drops
 * of phenolphthalein). Both ends are clamped independently so a malformed range
 * cannot invert the result.
 */
export function clampDropsToRange(drops: number, range: readonly [number, number]): number {
  const low = Math.min(range[0], range[1]);
  const high = Math.max(range[0], range[1]);
  const bounded = Math.min(Math.max(Math.round(drops), MIN_DROPS), MAX_DROPS);
  return Math.min(Math.max(bounded, low), high);
}

/** One line for the prompt while the dropper is tipped. */
export function dropCountLabel(drops: number, range: readonly [number, number]): string {
  const target = `${range[0]}–${range[1]}`;
  if (drops <= 0) return `Tip the dropper over the flask · ${target} drops needed`;
  return `${drops} drop${drops === 1 ? "" : "s"} · level off to add (${target} needed)`;
}
