/**
 * What the student is looking at.
 *
 * A first-person laboratory is only convincing if the thing under the crosshair
 * is the thing you can act on. This module answers that from the camera pose
 * alone — no renderer, no raycast, no DOM — so the rule ("within reach, and
 * roughly centred") is unit-tested instead of discovered by aiming in a browser.
 *
 * The scene still runs its own three.js raycast for pointer selection; this is
 * the crosshair's own answer, used for the contextual prompt and the E key.
 */

import type { PhysicalSelectionKey } from "../simulation/apparatus-state";
import {
  BALANCE_SLOT,
  BEAKER_SLOT,
  BURETTE_TIP,
  CYLINDER_SLOT,
  FLASK_TILE_SLOT,
  WASTE_SLOT,
  type BenchPoint,
} from "../simulation/spatial";

export interface LookCandidate {
  key: Exclude<PhysicalSelectionKey, null>;
  /** Bench-plane position of the object. */
  x: number;
  z: number;
  /** Height of the point of interest, in scene units (the part you aim at). */
  y: number;
  /** Rough radius, so a wide object is easier to hold on the crosshair. */
  radius: number;
}

export interface LookVector {
  x: number;
  y: number;
  z: number;
}

/** How far the crosshair reaches, in scene units (~half a bench). */
export const LOOK_MAX_DISTANCE_UNITS = 6;

/** Minimum alignment of the view direction with the object (0.94 ≈ 20° cone). */
export const LOOK_MIN_DOT = 0.94;

/** Point on each piece of apparatus the crosshair should aim at. */
export function lookPointFor(
  key: Exclude<PhysicalSelectionKey, null>,
  flaskPos: BenchPoint,
): { x: number; z: number; y: number; radius: number } {
  switch (key) {
    case "burette":
      // Mid-tube: the part that actually carries the scale and the meniscus.
      return { x: BURETTE_TIP.x, z: BURETTE_TIP.z, y: 2.9, radius: 0.5 };
    case "conical_flask":
      return { x: flaskPos.x, z: flaskPos.z, y: 0.7, radius: 0.5 };
    case "beaker_250":
      return { x: BEAKER_SLOT.x, z: BEAKER_SLOT.z, y: 0.5, radius: 0.4 };
    case "analytical_balance":
      return { x: BALANCE_SLOT.x, z: BALANCE_SLOT.z, y: 0.8, radius: 0.7 };
    case "graduated_cylinder":
      return { x: CYLINDER_SLOT.x, z: CYLINDER_SLOT.z, y: 0.9, radius: 0.4 };
    case "waste_container":
      return { x: WASTE_SLOT.x, z: WASTE_SLOT.z, y: 0.6, radius: 0.5 };
    case "volumetric_flask":
      return { x: -3.7, z: 1.3, y: 0.5, radius: 0.4 };
    case "glass_rod":
      return { x: 1.0, z: 1.35, y: 0.35, radius: 0.35 };
    case "reagent_bottle":
      // The shelf: aiming at a bottle is aiming at the shelf in front of it.
      return { x: FLASK_TILE_SLOT.x + 1.6, z: -2.6, y: 2.6, radius: 1.6 };
    default:
      return { x: 0, z: 0, y: 0.5, radius: 0.4 };
  }
}

export function lookCandidates(flaskPos: BenchPoint): LookCandidate[] {
  const keys: Array<Exclude<PhysicalSelectionKey, null>> = [
    "burette",
    "conical_flask",
    "beaker_250",
    "analytical_balance",
    "graduated_cylinder",
    "waste_container",
    "volumetric_flask",
    "glass_rod",
  ];
  return keys.map((key) => {
    const point = lookPointFor(key, flaskPos);
    return { key, x: point.x, z: point.z, y: point.y, radius: point.radius };
  });
}

function normalise(vector: LookVector): LookVector | null {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 1e-6) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

/**
 * The apparatus the crosshair is on, or null when the student is looking at
 * empty bench.
 *
 * Candidates are scored by how squarely they sit in the view cone, not by raw
 * distance, so a big object you are actually aiming at beats a small one that
 * merely happens to be off to the side.
 */
export function lookTargetFor(args: {
  origin: LookVector;
  direction: LookVector;
  candidates: LookCandidate[];
  maxDistanceUnits?: number;
  minDot?: number;
}): Exclude<PhysicalSelectionKey, null> | null {
  const direction = normalise(args.direction);
  if (!direction) return null;
  const maxDistance = args.maxDistanceUnits ?? LOOK_MAX_DISTANCE_UNITS;
  const minDot = args.minDot ?? LOOK_MIN_DOT;

  let best: { key: Exclude<PhysicalSelectionKey, null>; score: number } | null = null;
  for (const candidate of args.candidates) {
    const toObject: LookVector = {
      x: candidate.x - args.origin.x,
      y: candidate.y - args.origin.y,
      z: candidate.z - args.origin.z,
    };
    const unit = normalise(toObject);
    if (!unit) continue;
    const distance = Math.hypot(toObject.x, toObject.y, toObject.z);
    if (distance > maxDistance) continue;
    const dot = unit.x * direction.x + unit.y * direction.y + unit.z * direction.z;
    // A wider object is a little more forgiving on the crosshair.
    const tolerance = Math.min(0.06, candidate.radius * 0.05);
    if (dot < Math.max(0, minDot - tolerance)) continue;
    const score = dot - distance / (maxDistance * 10);
    if (!best || score > best.score) best = { key: candidate.key, score };
  }
  return best?.key ?? null;
}

/** Human-facing name for the prompt, matching the apparatus labels in the HUD. */
export function lookTargetLabel(key: Exclude<PhysicalSelectionKey, null>): string {
  switch (key) {
    case "burette":
      return "Burette, 50 mL";
    case "conical_flask":
      return "Erlenmeyer flask";
    case "beaker_250":
      return "Beaker, 250 mL";
    case "analytical_balance":
      return "Analytical balance";
    case "graduated_cylinder":
      return "Measuring cylinder";
    case "waste_container":
      return "Waste container";
    case "volumetric_flask":
      return "Volumetric flask";
    case "glass_rod":
      return "Glass stirring rod";
    case "reagent_bottle":
      return "Reagent shelf";
    default:
      return "Bench";
  }
}
