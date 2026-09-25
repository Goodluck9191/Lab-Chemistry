/**
 * Bench layout constants and placement-zone validation for the 3D laboratory.
 *
 * ONE source of truth for where things stand: `Lab3DScene` positions its
 * apparatus from these constants, and these pure validators decide whether a
 * dragged vessel counts as "under the burette" / "on the balance" / "over
 * waste". No pixel-perfect placement: every zone is a forgiving rectangle, and
 * the authoritative chemistry gate (e.g. `place_flask`, trial blockers) still
 * runs server-side — this layer only drives placement indicators and drag
 * snapping.
 *
 * Coordinates are scene units on the bench-top plane: +x right, +z towards the
 * viewer. Y is up; the bench surface is at `BENCH_TOP_Y`.
 */

export interface BenchPoint {
  x: number;
  z: number;
}

export interface ZoneRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Y of the bench working surface. */
export const BENCH_TOP_Y = 0;

/** Usable bench area; dragged objects are clamped inside it. */
export const BENCH_BOUNDS: ZoneRect = { minX: -4.6, maxX: 4.6, minZ: -2.2, maxZ: 2.6 };

/** Burette stand position; the tip hangs above `BURETTE_TIP`. */
export const BURETTE_BASE: BenchPoint = { x: -2.6, z: -0.9 };
export const BURETTE_TIP: BenchPoint = { x: -2.0, z: -0.5 };
/** Y of the burette tip outlet. */
export const BURETTE_TIP_Y = 2.06;
/** Y of the flask mouth when the flask stands under the burette. */
export const FLASK_MOUTH_UNDER_BURETTE_Y = 1.15;

/** Exact slot a flask snaps to when it counts as "under the burette". */
export const FLASK_UNDER_BURETTE_SLOT: BenchPoint = { x: -2.0, z: -0.5 };
/** Resting slot: the white tile beside the stand. */
export const FLASK_TILE_SLOT: BenchPoint = { x: -0.7, z: 0.1 };

export const BALANCE_SLOT: BenchPoint = { x: 2.2, z: -0.6 };
export const WASTE_SLOT: BenchPoint = { x: 4.0, z: 0.6 };
export const CYLINDER_SLOT: BenchPoint = { x: 0.9, z: -0.9 };
export const BEAKER_SLOT: BenchPoint = { x: 0.2, z: 0.9 };

/** Logical placement zones. Forgiving on purpose — no pixel-perfect drops. */
export const PLACEMENT_ZONES = {
  buretteReceiving: { minX: -2.7, maxX: -1.3, minZ: -1.2, maxZ: 0.2 },
  balance: { minX: 1.6, maxX: 2.8, minZ: -1.2, maxZ: 0.0 },
  waste: { minX: 3.4, maxX: 4.6, minZ: 0.0, maxZ: 1.2 },
  transfer: { minX: -0.2, maxX: 1.6, minZ: -1.4, maxZ: -0.2 },
} satisfies Record<string, ZoneRect>;

export function isInZone(point: BenchPoint, zone: ZoneRect): boolean {
  return (
    point.x >= zone.minX && point.x <= zone.maxX && point.z >= zone.minZ && point.z <= zone.maxZ
  );
}

/** The flask counts as positioned for titration inside the receiving zone. */
export function flaskReceivingValid(flaskPos: BenchPoint): boolean {
  return isInZone(flaskPos, PLACEMENT_ZONES.buretteReceiving);
}

export function balancePlacementValid(pos: BenchPoint): boolean {
  return isInZone(pos, PLACEMENT_ZONES.balance);
}

export function wastePlacementValid(pos: BenchPoint): boolean {
  return isInZone(pos, PLACEMENT_ZONES.waste);
}

/** Keep a dragged object on the bench surface. */
export function clampToBench(point: BenchPoint): BenchPoint {
  return {
    x: Math.max(BENCH_BOUNDS.minX, Math.min(BENCH_BOUNDS.maxX, point.x)),
    z: Math.max(BENCH_BOUNDS.minZ, Math.min(BENCH_BOUNDS.maxZ, point.z)),
  };
}

export function distance2D(a: BenchPoint, b: BenchPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Snap a dropped flask: near the receiving zone it clicks into the exact
 * under-burette slot (so the stream always meets the mouth); otherwise it
 * stays where the student left it.
 */
export function snapFlaskOnDrop(pos: BenchPoint): BenchPoint {
  if (flaskReceivingValid(pos)) return { ...FLASK_UNDER_BURETTE_SLOT };
  return pos;
}

/**
 * Snap a dropped beaker: on the balance pan it clicks into the exact pan
 * slot (so weighing reads as placed, not hovering); otherwise it stays where
 * the student left it. Physical positioning only — the authoritative weighing
 * is still the recorded `weigh_beaker` action.
 */
export function snapBeakerOnDrop(pos: BenchPoint): BenchPoint {
  if (balancePlacementValid(pos)) return { ...BALANCE_SLOT };
  return pos;
}

// ---------------------------------------------------------------------------
// Where every piece of apparatus rests, and where the burette may be clamped.
//
// Carrying is physical (§4): an object leaves its resting slot, rides in the
// student's hand, and returns to a slot when it is not being held. Because the
// slots live here rather than in a component, the same coordinates position the
// meshes and decide where a release lands — they can never drift apart.
// ---------------------------------------------------------------------------

/** Resting slots for apparatus that is not permanently installed. */
export const BURETTE_CRADLE_SLOT: BenchPoint = { x: -3.35, z: 0.15 };
export const VOLUMETRIC_FLASK_SLOT: BenchPoint = { x: -3.7, z: 1.3 };
export const GLASS_ROD_SLOT: BenchPoint = { x: 1.0, z: 1.35 };
export const STOPPER_SLOT: BenchPoint = { x: -3.15, z: 1.05 };
export const STOCK_BOTTLE_SLOT: BenchPoint = { x: 2.4, z: 0.6 };
export const WATER_BOTTLE_SLOT: BenchPoint = { x: 1.7, z: 0.6 };
export const KHP_SLOT: BenchPoint = { x: -4.1, z: 0.55 };

/**
 * The clamp's mounting position: the point on the stand where a correct
 * burette hangs vertically with its tip at `BURETTE_TIP`. A burette released
 * within `CLAMP_TOLERANCE_UNITS` of it mounts; anywhere else it stays in hand
 * or rests on the bench.
 */
export const CLAMP_SLOT: BenchPoint = { x: -2.0, z: -0.5 };
export const CLAMP_TOLERANCE_UNITS = 0.55;

/** Is this point close enough to the clamp for the burette to mount? */
export function clampIsReachable(pos: BenchPoint): boolean {
  return distance2D(pos, CLAMP_SLOT) <= CLAMP_TOLERANCE_UNITS;
}

/**
 * Snap a dropped burette: near the clamp it mounts upright (the tip lands on
 * `BURETTE_TIP`, which is what the liquid stream and the receiving zone expect);
 * otherwise it goes back to its cradle. A burette cannot stand on the bench —
 * a real one falls over — so an invalid release returns it to the cradle.
 */
export function snapBuretteOnDrop(pos: BenchPoint): { pos: BenchPoint; mounted: boolean } {
  if (clampIsReachable(pos)) return { pos: { ...CLAMP_SLOT }, mounted: true };
  return { pos: { ...BURETTE_CRADLE_SLOT }, mounted: false };
}
