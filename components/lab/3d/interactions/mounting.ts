/**
 * Mounting the burette on its stand.
 *
 * The burette is the one instrument that cannot simply be laid on the bench: a
 * real one hangs from a clamp, and the experiment is only physically possible
 * once it does. This module decides whether a released burette has found the
 * clamp, and whether a mounted burette may be read or titrated from — pure
 * rules, shared by the drop gesture and the contextual prompt so the two can
 * never disagree about whether the instrument is up.
 *
 * It carries no chemistry: `canTitrate` says the APPARATUS is ready, not that
 * the solution is standardised. The server still has the final word on every
 * delivery.
 */

import {
  CLAMP_SLOT,
  clampIsReachable,
  snapBuretteOnDrop,
  type BenchPoint,
} from "../simulation/spatial";

export interface MountOutcome {
  /** Did the release land on the clamp? */
  mounted: boolean;
  /** The position the burette takes after the release. */
  pos: BenchPoint;
}

/**
 * Resolve a released burette: near the clamp it mounts upright with its tip on
 * the receiving spot; anywhere else a real burette would topple, so it returns
 * to its cradle rather than teleporting somewhere it could not stand.
 */
export function buretteMountOutcome(point: BenchPoint): MountOutcome {
  return snapBuretteOnDrop(point);
}

/** Is the drop point within reach of the clamp (for the release highlight)? */
export function clampInReach(point: BenchPoint): boolean {
  return clampIsReachable(point);
}

export interface MountCheck {
  available: boolean;
  reason: string | null;
}

/** A reading is only meaningful with the burette hanging on the stand. */
export function readingNeedsMount(args: { mounted: boolean }): MountCheck {
  if (!args.mounted) {
    return {
      available: false,
      reason: "Mount the burette on the clamp before reading the scale.",
    };
  }
  return { available: true, reason: null };
}

/**
 * Titration needs the burette up AND the flask actually under the tip —
 * the physical precondition the stream depends on.
 */
export function titrationNeedsMount(args: {
  mounted: boolean;
  flaskInReceiving: boolean;
}): MountCheck {
  if (!args.mounted) {
    return {
      available: false,
      reason: "Hang the burette on the clamp before titrating.",
    };
  }
  if (!args.flaskInReceiving) {
    return {
      available: false,
      reason: "Stand the flask under the burette tip.",
    };
  }
  return { available: true, reason: null };
}

/** Where the clamp sits, for drawing the mounting target. */
export const CLAMP_MOUNT_SLOT: BenchPoint = { ...CLAMP_SLOT };

/** Prompt wording for the burette's current mounting state. */
export function mountLabel(mounted: boolean): string {
  return mounted ? "Mounted on the clamp" : "Lying in its cradle";
}
