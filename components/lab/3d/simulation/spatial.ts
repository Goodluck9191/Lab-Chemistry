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
