/**
 * Pouring out of a vessel held in the student's hand.
 *
 * A pour is the one gesture that turns handling into chemistry: the student
 * tips the beaker over the flask and the beaker's contents end up in the flask.
 * This module answers the two questions the scene and the controller both need
 * — "is liquid leaving the vessel?" and "what is it being poured into?" — and
 * nothing else. It never names a protocol action and never reads a hidden
 * value; the controller maps the zone onto the same domain action the panel
 * button sends, gated by the same availability rules.
 *
 * The flow rate is deliberately NOT invented here: a tipped vessel uses the
 * same rate curve as the burette stopcock (`stopcockRateMlPerSecond`) by
 * projecting the tilt onto a virtual handle angle. A beaker tipped halfway and
 * a stopcock turned halfway therefore pass the same volume per second, and the
 * laboratory never has two disagreeing definitions of "slow".
 */

import { MAX_TILT_RADIANS, POUR_TILT_RADIANS, isPourTilt, type HoldPose } from "./hold";
import {
  STOPCOCK_MAX_ANGLE_DEG,
  STOPCOCK_NOTCHES,
  stopcockFlowModeFor,
  stopcockRateMlPerSecond,
} from "../simulation/stopcock";
import { PLACEMENT_ZONES, isInZone, type BenchPoint } from "../simulation/spatial";
import type { FlowMode } from "../simulation/flow";

/** The places a pour can land. */
export type PourZone =
  | "flask"
  | "beaker"
  | "cylinder"
  | "waste"
  | "balance"
  | "volumetric_flask"
  | "bench";

export interface PourTargets {
  /** Bench position of the receiving flask. */
  flask: BenchPoint;
  beaker: BenchPoint | null;
  cylinder: BenchPoint | null;
  volumetricFlask: BenchPoint | null;
  /** Extra vessels positioned by the scene, by zone name. */
  named?: Partial<Record<PourZone, BenchPoint | null>>;
}

export interface PourIntent {
  /** Liquid is leaving the vessel right now. */
  pouring: boolean;
  /** Where it is aimed. `bench` means it would spill on the bench top. */
  zone: PourZone;
  /** Volume per second at the current tilt. */
  rateMlPerSecond: number;
  /** Matching flow mode, so the stream can look like the burette stream. */
  flowMode: FlowMode | null;
  /** Short phrase for the contextual prompt. */
  label: string;
}

/** How close the aim point must be to a vessel to count as "into it". */
export const POUR_RECEIVER_TOLERANCE_UNITS = 0.7;

/**
 * The angle at which the tap first passes anything — the "crack". The pour
 * curve starts here rather than at zero so that the instant a vessel is tipped
 * past its pour threshold it is genuinely dripping, not silently doing nothing.
 */
const FIRST_OPEN_ANGLE_DEG =
  STOPCOCK_NOTCHES.find((notch) => notch.flowMode !== null)?.fromDeg ?? 4;

/**
 * The tilt expressed as an equivalent stopcock handle angle, so a tipped
 * vessel and an opened tap share one rate curve. Tipping past the threshold
 * cracks the vessel open; a full tip is a fully open tap.
 */
export function pourAngleFor(tiltRadians: number): number {
  if (!Number.isFinite(tiltRadians) || tiltRadians <= POUR_TILT_RADIANS) return 0;
  const span = MAX_TILT_RADIANS - POUR_TILT_RADIANS;
  if (span <= 0) return STOPCOCK_MAX_ANGLE_DEG;
  const t = Math.max(0, Math.min(1, (tiltRadians - POUR_TILT_RADIANS) / span));
  return FIRST_OPEN_ANGLE_DEG + t * (STOPCOCK_MAX_ANGLE_DEG - FIRST_OPEN_ANGLE_DEG);
}

export function pourRateMlPerSecond(tiltRadians: number): number {
  return stopcockRateMlPerSecond(pourAngleFor(tiltRadians));
}

export function pourFlowModeFor(tiltRadians: number): FlowMode | null {
  return stopcockFlowModeFor(pourAngleFor(tiltRadians));
}

function distance2D(a: BenchPoint, b: BenchPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Which receiver the pour is aimed at.
 *
 * Ordered by specificity: the waste and balance zones are explicit rectangles,
 * the burette receiving zone means "into the flask", and otherwise the nearest
 * named vessel within tolerance wins. Anything else is the bench.
 */
export function pourZoneAt(point: BenchPoint, targets: PourTargets): PourZone {
  if (isInZone(point, PLACEMENT_ZONES.waste)) return "waste";
  if (isInZone(point, PLACEMENT_ZONES.balance)) return "balance";
  if (isInZone(point, PLACEMENT_ZONES.buretteReceiving)) return "flask";

  const named: Array<[PourZone, BenchPoint | null | undefined]> = [
    ["flask", targets.flask],
    ["beaker", targets.beaker],
    ["cylinder", targets.cylinder],
    ["volumetric_flask", targets.volumetricFlask],
    ["waste", targets.named?.waste],
    ["balance", targets.named?.balance],
    ["beaker", targets.named?.beaker],
    ["cylinder", targets.named?.cylinder],
    ["volumetric_flask", targets.named?.volumetric_flask],
  ];

  let best: { zone: PourZone; distance: number } | null = null;
  for (const [zone, position] of named) {
    if (!position) continue;
    const distance = distance2D(point, position);
    if (distance > POUR_RECEIVER_TOLERANCE_UNITS) continue;
    if (!best || distance < best.distance) best = { zone, distance };
  }
  return best?.zone ?? "bench";
}

/** Human word for a zone, used on the prompt while pouring. */
export function pourZoneLabel(zone: PourZone): string {
  switch (zone) {
    case "flask":
      return "the flask";
    case "beaker":
      return "the beaker";
    case "cylinder":
      return "the measuring cylinder";
    case "waste":
      return "the waste container";
    case "balance":
      return "the balance";
    case "volumetric_flask":
      return "the volumetric flask";
    default:
      return "the bench";
  }
}

/**
 * The full pour state for the held vessel: whether it is pouring, where it
 * lands, and how fast. `aimPoint` is where the student is pointing (the scene's
 * crosshair landing point); tipping alone is not enough if the vessel is level.
 */
export function pourIntent(args: {
  pose: HoldPose;
  aimPoint: BenchPoint;
  targets: PourTargets;
}): PourIntent {
  const pouring = isPourTilt(args.pose);
  const zone = pourZoneAt(args.aimPoint, args.targets);
  const rateMlPerSecond = pouring ? pourRateMlPerSecond(args.pose.tiltRadians) : 0;
  const flowMode = pouring ? pourFlowModeFor(args.pose.tiltRadians) : null;
  return {
    pouring,
    zone,
    rateMlPerSecond,
    flowMode,
    label: pouring ? `Pouring into ${pourZoneLabel(zone)}` : "Upright",
  };
}
