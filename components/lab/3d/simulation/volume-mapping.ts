/**
 * Volume → height mapping for the 3D laboratory.
 *
 * PURE, dependency-free, fully tested. These functions translate the
 * AUTHORITATIVE volumes from the public simulation state (mL) into scene
 * heights (world units) for drawing liquid columns. They never compute
 * chemistry: the numbers they take in are the server's public projection, and
 * the numbers they return position meshes only.
 *
 * Nothing here is hidden: capacity, reading and delivered volumes all arrive
 * from `TitrationPublicState` via the view model.
 */

/** Burette tube geometry, in scene units. Matches `Burette3D`. */
export interface BuretteTubeGeometry {
  /** Y of the tube interior top (the zero mark). */
  topY: number;
  /** Y of the tube interior bottom (above the stopcock). */
  bottomY: number;
  capacityMl: number;
}

/**
 * Fraction of the burette still full, 0..1, for drawing only.
 *
 * Mirrors the 2D view model (`fillFraction: 1 - reading / capacity`): an
 * unfilled burette (`null`) draws empty.
 */
export function buretteFillFraction(readingMl: number | null, capacityMl: number): number {
  if (readingMl === null || !Number.isFinite(readingMl) || capacityMl <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - readingMl / capacityMl));
}

/**
 * Y position of the liquid surface inside the burette tube, or null when the
 * burette has not been filled. Linear in the READING (mL from the top), exactly
 * like the physical scale: 0 mL at the top, capacity at the bottom.
 */
export function buretteLiquidSurfaceY(
  readingMl: number | null,
  geometry: BuretteTubeGeometry,
): number | null {
  if (readingMl === null || !Number.isFinite(readingMl)) return null;
  const clamped = Math.max(0, Math.min(geometry.capacityMl, readingMl));
  const span = geometry.bottomY - geometry.topY;
  return geometry.topY + (clamped / geometry.capacityMl) * span;
}

/** Erlenmeyer cone geometry, in scene units. Matches `Flask3D`. */
export interface FlaskConeGeometry {
  /** Height of the conical section (base to neck). */
  coneHeight: number;
  /** Volume the cone holds when full to the neck, in mL. */
  coneCapacityMl: number;
}

/**
 * Liquid height inside the conical flask for a vessel volume in mL.
 *
 * A cone's volume grows with the cube of its height, so the height grows with
 * the cube root of the volume. This is a VISUAL approximation (a real
 * Erlenmeyer has a rounded base and a neck), deterministic and monotonic —
 * enough for a student to see "more liquid in, higher level" without claiming
 * volumetric accuracy. Never used for measurement.
 */
export function flaskLiquidHeight(volumeMl: number, geometry: FlaskConeGeometry): number {
  if (!Number.isFinite(volumeMl) || volumeMl <= 0) return 0;
  if (geometry.coneCapacityMl <= 0 || geometry.coneHeight <= 0) return 0;
  const fraction = Math.min(1, volumeMl / geometry.coneCapacityMl);
  return geometry.coneHeight * Math.cbrt(fraction);
}

/**
 * Approximate radius of the liquid surface at a given liquid height in the
 * cone (narrow at the base, wide at the neck). Used to size the liquid disc so
 * it meets the glass wall instead of floating inside it.
 */
export function flaskLiquidRadiusAtHeight(
  heightUnits: number,
  baseRadius: number,
  neckRadius: number,
  coneHeight: number,
): number {
  if (coneHeight <= 0) return baseRadius;
  const t = Math.max(0, Math.min(1, heightUnits / coneHeight));
  return baseRadius + (neckRadius - baseRadius) * t;
}

/** Graduated-cylinder geometry, in scene units. Matches `MeasuringCylinder3D`. */
export interface CylinderGeometry {
  /** Y of the interior bottom. */
  bottomY: number;
  /** Interior height for the full nominal capacity. */
  heightUnits: number;
  capacityMl: number;
}

/** Linear liquid height for a straight-walled vessel (beaker, cylinder). */
export function straightWallLiquidHeight(volumeMl: number, geometry: CylinderGeometry): number {
  if (!Number.isFinite(volumeMl) || volumeMl <= 0) return 0;
  if (geometry.capacityMl <= 0 || geometry.heightUnits <= 0) return 0;
  return geometry.heightUnits * Math.min(1, volumeMl / geometry.capacityMl);
}

/**
 * The four observable flask colours, mapped to translucent display colours.
 * The label always accompanies the colour in the UI — colour is never the only
 * signal, matching the 2D bench contract.
 */
export function flaskColourHex(colour: string | null): string {
  switch (colour) {
    case "faint_pink":
      return "#f9a8d4";
    case "pink":
      return "#f472b6";
    case "deep_pink":
      return "#db2777";
    case "colourless":
    default:
      return "#e0f2fe";
  }
}

/** Opacity of the flask liquid layer for each observed colour. */
export function flaskColourOpacity(colour: string | null): number {
  switch (colour) {
    case "faint_pink":
      return 0.45;
    case "pink":
      return 0.65;
    case "deep_pink":
      return 0.9;
    case "colourless":
    default:
      return 0.35;
  }
}
