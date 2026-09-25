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
  BURETTE_CRADLE_SLOT,
  CYLINDER_SLOT,
  FLASK_TILE_SLOT,
  GLASS_ROD_SLOT,
  KHP_SLOT,
  STOPPER_SLOT,
  STOCK_BOTTLE_SLOT,
  VOLUMETRIC_FLASK_SLOT,
  WATER_BOTTLE_SLOT,
  clampToBench,
  isInZone,
  PLACEMENT_ZONES,
  snapBeakerOnDrop,
  snapFlaskOnDrop,
  type BenchPoint,
} from "../simulation/spatial";
import { buretteMountOutcome } from "./mounting";

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

// ---------------------------------------------------------------------------
// The general holdable model.
//
// The first version of carrying knew only the two vessels that could pour. The
// laboratory has more in it than that: a burette to hang on the clamp, a
// measuring cylinder to draw acid into, reagent bottles to pour from. Rather
// than teach every mesh its own handling rules, each holdable names itself
// once here — what it is called, whether it pours, whether it mounts, and where
// it lives — and the gesture, the prompt and the release logic all read from
// that one table.
//
// The original `carryKindFor`/`primaryVerbFor` are left alone: the vessel-only
// path still works, and this broader model is additive.
// ---------------------------------------------------------------------------

/** Everything a student can pick up and put down. */
export type HoldableKind =
  | CarryKind
  | "burette"
  | "cylinder"
  | "volumetric_flask"
  | "glass_rod"
  | "stopper"
  | "stock_bottle"
  | "water_bottle"
  | "khp"
  | "indicator"
  | "spatula";

export interface HoldSpec {
  kind: HoldableKind;
  /** As a student would say it. */
  label: string;
  /** Can its contents be poured out when tipped? */
  pourable: boolean;
  /** Hangs on the clamp rather than resting on the bench. */
  mounts: boolean;
  /** Where it rests when it is not being held. */
  home: BenchPoint;
  /** What it is for, shown on the prompt. */
  role: string;
}

export const HOLD_SPECS: Record<HoldableKind, HoldSpec> = {
  flask: {
    kind: "flask",
    label: "Erlenmeyer flask",
    pourable: true,
    mounts: false,
    home: { ...FLASK_TILE_SLOT },
    role: "receives the solution",
  },
  beaker: {
    kind: "beaker",
    label: "250 mL beaker",
    pourable: true,
    mounts: false,
    home: { ...BEAKER_SLOT },
    role: "weighs and dissolves the KHP",
  },
  burette: {
    kind: "burette",
    label: "Burette, 50 mL",
    pourable: false,
    mounts: true,
    home: { ...BURETTE_CRADLE_SLOT },
    role: "delivers the titrant",
  },
  cylinder: {
    kind: "cylinder",
    label: "Measuring cylinder",
    pourable: true,
    mounts: false,
    home: { ...CYLINDER_SLOT },
    role: "measures the aliquot",
  },
  volumetric_flask: {
    kind: "volumetric_flask",
    label: "Volumetric flask",
    pourable: true,
    mounts: false,
    home: { ...VOLUMETRIC_FLASK_SLOT },
    role: "makes up the working solution",
  },
  glass_rod: {
    kind: "glass_rod",
    label: "Glass stirring rod",
    pourable: false,
    mounts: false,
    home: { ...GLASS_ROD_SLOT },
    role: "stirs and transfers",
  },
  stopper: {
    kind: "stopper",
    label: "Rubber stopper",
    pourable: false,
    mounts: false,
    home: { ...STOPPER_SLOT },
    role: "seals the flask for mixing",
  },
  stock_bottle: {
    kind: "stock_bottle",
    label: "Stock NaOH",
    pourable: true,
    mounts: false,
    home: { ...STOCK_BOTTLE_SLOT },
    role: "the concentrated titrant",
  },
  water_bottle: {
    kind: "water_bottle",
    label: "Distilled water",
    pourable: true,
    mounts: false,
    home: { ...WATER_BOTTLE_SLOT },
    role: "dilutes the solution",
  },
  khp: {
    kind: "khp",
    label: "Potassium hydrogen phthalate",
    pourable: true,
    mounts: false,
    home: { ...KHP_SLOT },
    role: "the primary standard",
  },
  indicator: {
    kind: "indicator",
    label: "Phenolphthalein dropper",
    pourable: true,
    mounts: false,
    home: { ...STOPPER_SLOT },
    role: "marks the endpoint",
  },
  spatula: {
    kind: "spatula",
    label: "Spatula",
    pourable: false,
    mounts: false,
    home: { ...KHP_SLOT },
    role: "transfers the solid",
  },
};

export function holdSpecFor(kind: HoldableKind): HoldSpec {
  return HOLD_SPECS[kind];
}

/**
 * The holdable a selected/looked-at object becomes, or null if it is fixed.
 *
 * Only the vessel that the SCENE can actually draw in the hand is offered
 * here, so the logical state and the picture never disagree: a picked-up object
 * that stayed on the bench would be worse than one that cannot be picked up.
 * The other holdables are fully described in `HOLD_SPECS` and resolved by
 * `holdReleaseFor`, so teaching their meshes to ride in front of the eye is a
 * presentation change with the rules already in place — not a new model.
 */
export function holdKindFor(key: string | null): HoldableKind | null {
  switch (key) {
    case "beaker_250":
      return "beaker";
    case "conical_flask":
      return "flask";
    default:
      return null;
  }
}

/** The verb E performs with the broader holdable model. */
export function holdVerbFor(
  key: string | null,
  held: HoldableKind | null,
): { label: string; picksUp: boolean } {
  if (held) return { label: "Set down", picksUp: false };
  if (holdKindFor(key)) return { label: "Pick up", picksUp: true };
  return { label: "Interact", picksUp: false };
}

/** What releasing a held object at this point means. */
export type HoldRelease =
  | { kind: "burette_mount"; mounted: boolean; pos: BenchPoint }
  | { kind: "discard"; pos: BenchPoint }
  | { kind: "balance"; pos: BenchPoint }
  | { kind: "under_burette"; pos: BenchPoint }
  | { kind: "rest"; pos: BenchPoint };

/**
 * Resolve a physical release. The rules are the same ones the drop gesture and
 * the placement rings already use: over the waste means a disposal, on the pan
 * means a weighing position, near the clamp means the burette mounts. Anything
 * else simply rests where it was set down.
 */
export function holdReleaseFor(kind: HoldableKind, point: BenchPoint): HoldRelease {
  const clamped = clampToBench(point);
  if (kind === "burette") {
    const outcome = buretteMountOutcome(clamped);
    return { kind: "burette_mount", mounted: outcome.mounted, pos: outcome.pos };
  }
  if (isInZone(clamped, PLACEMENT_ZONES.waste)) {
    return { kind: "discard", pos: clamped };
  }
  if (kind === "beaker" && isInZone(clamped, PLACEMENT_ZONES.balance)) {
    return { kind: "balance", pos: snapBeakerOnDrop(clamped) };
  }
  if (kind === "flask") {
    return isInZone(clamped, PLACEMENT_ZONES.buretteReceiving)
      ? { kind: "under_burette", pos: snapFlaskOnDrop(clamped) }
      : { kind: "rest", pos: clamped };
  }
  return { kind: "rest", pos: clamped };
}
