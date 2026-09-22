/**
 * The burette stopcock as a real valve (§12).
 *
 * The handle turns through a quarter turn. Where it stops decides how fast the
 * titrant leaves the tip — and nothing else. Converting that delivered volume
 * into chemistry stays in the domain engine, exactly as before; the flow rates
 * come from the existing `FLOW_MODES` table, so a quarter-open stopcock and a
 * "Dropwise" button produce byte-identical `add_titrant` actions.
 *
 * Pure and DOM-free: the drag handler in the scene and the keyboard/panel
 * equivalents all funnel through here.
 */

import { FLOW_MODES, type FlowMode } from "./flow";

/** Full quarter turn, in degrees. */
export const STOPCOCK_MAX_ANGLE_DEG = 90;

export type StopcockPosition = "closed" | "crack" | "dropwise" | "medium" | "fast";

export interface StopcockNotch {
  position: StopcockPosition;
  /** Inclusive lower bound, degrees. */
  fromDeg: number;
  /** Exclusive upper bound, degrees. */
  toDeg: number;
  /** Student-facing name. */
  label: string;
  /** Flow the tap produces here, or null when nothing passes. */
  flowMode: FlowMode | null;
}

/**
 * The four useful openings a student can find by feel. Boundaries are chosen so
 * the last approach to the endpoint is easy to hold: a third of the turn is
 * dropwise.
 */
export const STOPCOCK_NOTCHES: readonly StopcockNotch[] = [
  { position: "closed", fromDeg: 0, toDeg: 4, label: "Closed", flowMode: null },
  { position: "crack", fromDeg: 4, toDeg: 14, label: "Cracked open — slow drops", flowMode: "DROPWISE" },
  { position: "dropwise", fromDeg: 14, toDeg: 34, label: "Dropwise", flowMode: "DROPWISE" },
  { position: "medium", fromDeg: 34, toDeg: 64, label: "Steady flow", flowMode: "MEDIUM" },
  { position: "fast", fromDeg: 64, toDeg: STOPCOCK_MAX_ANGLE_DEG + 1, label: "Fast stream", flowMode: "FAST" },
] as const;

export function clampStopcockAngle(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) return 0;
  return Math.max(0, Math.min(STOPCOCK_MAX_ANGLE_DEG, angleDeg));
}

export function stopcockNotchFor(angleDeg: number): StopcockNotch {
  const angle = clampStopcockAngle(angleDeg);
  return (
    STOPCOCK_NOTCHES.find((notch) => angle >= notch.fromDeg && angle < notch.toDeg) ??
    STOPCOCK_NOTCHES[STOPCOCK_NOTCHES.length - 1]
  );
}

export function stopcockPositionFor(angleDeg: number): StopcockPosition {
  return stopcockNotchFor(angleDeg).position;
}

/** Flow the tap is passing, or null when it is closed. */
export function stopcockFlowModeFor(angleDeg: number): FlowMode | null {
  return stopcockNotchFor(angleDeg).flowMode;
}

export function stopcockIsOpen(angleDeg: number): boolean {
  return stopcockFlowModeFor(angleDeg) !== null;
}

/** Rate in mL/s at this opening. Closing the tap passes nothing. */
export function stopcockRateMlPerSecond(angleDeg: number): number {
  const mode = stopcockFlowModeFor(angleDeg);
  return mode === null ? 0 : FLOW_MODES[mode].mlPerSecond;
}

/** Angle the handle animation and the drawing use. */
export function stopcockAngleForOpenFlag(open: boolean): number {
  return open ? STOPCOCK_MAX_ANGLE_DEG : 0;
}

/**
 * Where the next keypress or button takes the tap: the accessible equivalent of
 * turning the handle by hand. Steps through the notches and wraps back to
 * closed, so the student never has to drag to reach a precise opening.
 */
export function nextStopcockAngle(angleDeg: number): number {
  const current = clampStopcockAngle(angleDeg);
  const currentIndex = STOPCOCK_NOTCHES.findIndex(
    (notch) => current >= notch.fromDeg && current < notch.toDeg,
  );
  const next = STOPCOCK_NOTCHES[(currentIndex + 1) % STOPCOCK_NOTCHES.length];
  return next.position === "closed" ? 0 : next.fromDeg;
}

/**
 * Turn one notch down (towards closed) — the "slow down" direction.
 *
 * Unlike `nextStopcockAngle`, this one does NOT wrap: a shut valve stays shut.
 * Wrapping a tap from closed straight to wide open is exactly the kind of
 * surprise that makes a student close it again without meaning to.
 */
export function previousStopcockAngle(angleDeg: number): number {
  const current = clampStopcockAngle(angleDeg);
  const currentIndex = STOPCOCK_NOTCHES.findIndex(
    (notch) => current >= notch.fromDeg && current < notch.toDeg,
  );
  if (currentIndex <= 0) return 0;
  const previous = STOPCOCK_NOTCHES[currentIndex - 1];
  return previous.position === "closed" ? 0 : previous.fromDeg;
}

/** Vertical pointer travel (px) that sweeps the handle through its full turn. */
export const STOPCOCK_DRAG_PIXELS_FULL_TURN = 160;

export function stopcockAngleFromDrag(args: {
  startAngleDeg: number;
  /** Upward drag is negative in screen pixels; up opens the tap. */
  deltaYPixels: number;
}): number {
  const degreesPerPixel = STOPCOCK_MAX_ANGLE_DEG / STOPCOCK_DRAG_PIXELS_FULL_TURN;
  return clampStopcockAngle(args.startAngleDeg - args.deltaYPixels * degreesPerPixel);
}
