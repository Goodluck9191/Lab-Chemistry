/**
 * Picking things up and putting them down.
 *
 * Physical handling is what separates "do the experiment" from "fill a form",
 * so the rules live here in one place rather than inside whichever mesh happens
 * to be draggable today: what may be carried, where it lands when released, and
 * how it turns in the hand.
 *
 * Nothing here is chemistry. Releasing a flask over the bench only moves the
 * flask; releasing it over the waste container is what the scene turns into the
 * existing `discard_to_waste` action, gated by the same availability rules as
 * the panel button.
 */

import { ROTATE_STEP_RADIANS, rotateBy, type HeldRotation } from "../simulation/keymap";
import {
  BALANCE_SLOT,
  BENCH_BOUNDS,
  BEAKER_SLOT,
  BENCH_TOP_Y,
  FLASK_TILE_SLOT,
  clampToBench,
  isInZone,
  PLACEMENT_ZONES,
  snapBeakerOnDrop,
  snapFlaskOnDrop,
  type BenchPoint,
} from "../simulation/spatial";

/** Vessels the student can physically hold. */
export type CarryKind = "flask" | "beaker";

export interface CarryState {
  kind: CarryKind;
  /** Where it will land if released right now. */
  point: BenchPoint;
  rotation: HeldRotation;
}

export function carryingLabel(kind: CarryKind): string {
  return kind === "flask" ? "Erlenmeyer flask" : "250 mL beaker";
}

/**
 * May the student pick this up at all? A frozen (read-only) attempt or an
 * action still in flight leaves the world alone — the same rule the panels use.
 */
export function canCarry(args: { canWrite: boolean; pending: boolean }): {
  available: boolean;
  reason: string | null;
} {
  if (!args.canWrite) {
    return { available: false, reason: "This attempt is read-only, so nothing can be moved." };
  }
  if (args.pending) {
    return { available: false, reason: "Saving the last action — the bench is briefly locked." };
  }
  return { available: true, reason: null };
}

/** Where a carried vessel rests when set down, with the same snapping as a drag. */
export function releasePointFor(kind: CarryKind, point: BenchPoint): BenchPoint {
  const clamped = clampToBench(point);
  return kind === "flask" ? snapFlaskOnDrop(clamped) : snapBeakerOnDrop(clamped);
}

/** Does releasing here mean "into the waste container"? */
export function releasesIntoWaste(kind: CarryKind, point: BenchPoint): boolean {
  // Only vessels that could hold a discarded solution; the same waste zone the
  // drag system and the placement ring use.
  void kind;
  return isInZone(point, PLACEMENT_ZONES.waste);
}

/** Does releasing here mean "onto the balance pan"? */
export function releasesOntoBalance(kind: CarryKind, point: BenchPoint): boolean {
  return kind === "beaker" && isInZone(point, PLACEMENT_ZONES.balance);
}

/** Does releasing here mean "under the burette, ready to titrate"? */
export function releasesUnderBurette(kind: CarryKind, point: BenchPoint): boolean {
  return kind === "flask" && isInZone(point, PLACEMENT_ZONES.buretteReceiving);
}

/** Home slot for a vessel, used when a carried object is returned. */
export function homeSlotFor(kind: CarryKind): BenchPoint {
  return kind === "flask" ? { ...FLASK_TILE_SLOT } : { ...BEAKER_SLOT };
}

export function panSlot(): BenchPoint {
  return { ...BALANCE_SLOT };
}

/** One press of R: turn the object in the hand by a visible step. */
export function rotateHeldRight(rotation: HeldRotation, steps = 1): HeldRotation {
  return rotateBy(rotation, ROTATE_STEP_RADIANS * steps);
}

export function rotateHeldLeft(rotation: HeldRotation, steps = 1): HeldRotation {
  return rotateBy(rotation, -ROTATE_STEP_RADIANS * steps);
}

/**
 * Keep a carried vessel inside the usable bench while it follows the pointer.
 * Reuses the same bounds as dragging, so carrying and dragging cannot disagree.
 */
export function followPoint(point: BenchPoint): BenchPoint {
  return clampToBench(point);
}

/** The bench is finite; a carried object never leaves it. */
export function insideBench(point: BenchPoint): boolean {
  return (
    point.x >= BENCH_BOUNDS.minX &&
    point.x <= BENCH_BOUNDS.maxX &&
    point.z >= BENCH_BOUNDS.minZ &&
    point.z <= BENCH_BOUNDS.maxZ
  );
}

/**
 * Where a vessel held in front of the student would come to rest: the point
 * where the view ray crosses the bench top.
 *
 * Walking up to the bench and setting something down is a physical gesture, so
 * the landing spot is derived from where the student is standing and looking —
 * not from a slot table. A ray that never meets the bench (looking at the
 * ceiling) falls back to the bench edge in front of the student rather than
 * teleporting the object somewhere arbitrary.
 */
export function dropPointInFront(args: {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  fallbackDistance?: number;
}): BenchPoint {
  const { origin, direction } = args;
  const fallback = args.fallbackDistance ?? 1.1;
  const horizontal = Math.hypot(direction.x, direction.z);
  const planeY = BENCH_TOP_Y + 0.02;
  const downward = direction.y;

  // Ray-plane intersection with the bench top. Only a downward-looking ray
  // meets it in front of the student; anything else uses the fallback arm.
  if (Number.isFinite(downward) && downward < -1e-3) {
    const t = (planeY - origin.y) / downward;
    if (t > 0 && t < 40) {
      return clampToBench({ x: origin.x + direction.x * t, z: origin.z + direction.z * t });
    }
  }
  if (horizontal < 1e-3) return clampToBench({ x: origin.x, z: origin.z + fallback });
  return clampToBench({
    x: origin.x + (direction.x / horizontal) * fallback,
    z: origin.z + (direction.z / horizontal) * fallback,
  });
}

/**
 * The verb E performs on whatever is under the crosshair. One press should do
 * the obvious thing: pick a vessel up, or open the steps for an instrument.
 */
export function primaryVerbFor(
  key: string | null,
  carried: CarryKind | null,
): { label: string; picksUp: boolean } {
  if (carried) return { label: "Set down", picksUp: false };
  if (key === "beaker_250" || key === "conical_flask") return { label: "Pick up", picksUp: true };
  return { label: "Interact", picksUp: false };
}

/** Carry kind for a carryable selection key, or null. */
export function carryKindFor(key: string | null): CarryKind | null {
  if (key === "beaker_250") return "beaker";
  if (key === "conical_flask") return "flask";
  return null;
}
