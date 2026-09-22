/**
 * Deterministic fluid-transfer preview for the 3D scene.
 *
 * VISUAL ONLY. While the stopcock stands open, the scene predicts where the
 * meniscus WOULD be for the volume accumulated so far, so the pour looks
 * continuous. The moment the stopcock closes, the preview is discarded and the
 * server's authoritative reading takes over. A rejected action therefore snaps
 * the burette back to truth instead of leaving a browser-invented level.
 */

import { quantizeDeliveryMl } from "./flow";

/**
 * Preview reading shown in the 3D burette while pouring: server reading plus
 * the accumulated (unconfirmed) delivery, capped at the tube capacity.
 */
export function previewBuretteReadingMl(args: {
  serverReadingMl: number | null;
  accumulatedMl: number;
  capacityMl: number;
}): number | null {
  if (args.serverReadingMl === null) return null;
  if (!(args.accumulatedMl > 0)) return args.serverReadingMl;
  return Math.min(args.capacityMl, args.serverReadingMl + args.accumulatedMl);
}

/**
 * Preview flask volume while pouring: server volume plus the quantized
 * delivery that WOULD be recorded. Displayed as a rising level only.
 */
export function previewFlaskVolumeMl(args: {
  serverVolumeMl: number;
  accumulatedMl: number;
  graduationMl: number;
}): number {
  if (!(args.accumulatedMl > 0)) return args.serverVolumeMl;
  return args.serverVolumeMl + quantizeDeliveryMl(args.accumulatedMl, args.graduationMl);
}
