/**
 * How an object sits in the student's hand.
 *
 * A carried vessel is not a decoration: it rides in front of the eye, turns when
 * the student turns it, and TILTS. Tilting is what turns "pick the bottle up"
 * into "pour the bottle", so the geometry of the tilt lives here — pure, unit
 * tested, and shared by the mesh that shows the vessel and the stream that
 * leaves its mouth. Neither of them re-derives it.
 *
 * Nothing here is chemistry. The pose decides where a mesh is drawn and where a
 * pour visually starts; what a pour MEANS is decided by `pour.ts`, and whether
 * the server accepts it is decided by the protocol.
 */

export interface HoldPose {
  /** Turn about the vertical axis — the student turning the object in hand. */
  yawRadians: number;
  /**
   * Tip forward out of the hand. 0 is upright; positive tips the mouth down and
   * away, which is how anything is poured. Negative tips it back, which simply
   * holds it level and pours nothing.
   */
  tiltRadians: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const NEUTRAL_HOLD: HoldPose = { yawRadians: 0, tiltRadians: 0 };

/** How far in front of the eye a carried object rides, and how far below it. */
export const HOLD_FORWARD_UNITS = 0.85;
export const HOLD_DROP_UNITS = 0.42;

/** Distance from the hold point to the vessel's mouth, in scene units. */
export const MOUTH_REACH_UNITS = 0.34;

/** One tick of the tilt key: a visible, controllable step. */
export const TILT_STEP_RADIANS = Math.PI / 36;

/** The most a vessel may be tipped — past this it would pour out sideways. */
export const MAX_TILT_RADIANS = Math.PI / 2.1;

/**
 * Past this angle the vessel actually pours. Below it the tip is high enough
 * that liquid stays put, which is what lets a student hold a full bottle and
 * walk with it without spilling.
 */
export const POUR_TILT_RADIANS = Math.PI / 5;

export function clampTilt(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  return Math.max(-MAX_TILT_RADIANS, Math.min(MAX_TILT_RADIANS, radians));
}

/** Tip the held object further, or level it back off. */
export function tiltBy(pose: HoldPose, direction: 1 | -1, steps = 1): HoldPose {
  return { ...pose, tiltRadians: clampTilt(pose.tiltRadians + direction * TILT_STEP_RADIANS * steps) };
}

/** Set the tilt directly (a pointer drag reports an absolute angle). */
export function setTilt(pose: HoldPose, radians: number): HoldPose {
  return { ...pose, tiltRadians: clampTilt(radians) };
}

/** Is the vessel tipped far enough to be pouring? */
export function isPourTilt(pose: HoldPose): boolean {
  return pose.tiltRadians >= POUR_TILT_RADIANS;
}

/** Word for the prompt: what the student is doing with what they hold. */
export function tiltLabel(pose: HoldPose): string {
  if (isPourTilt(pose)) return "Pouring";
  if (pose.tiltRadians > 0) return "Tilting";
  return "Upright";
}

/** The horizontal unit vector the student is facing, from a camera direction. */
export function horizontalForward(direction: Vec3): Vec3 {
  const length = Math.hypot(direction.x, direction.z);
  if (length < 1e-6) return { x: 0, y: 0, z: -1 };
  return { x: direction.x / length, y: 0, z: direction.z / length };
}

/**
 * Where the held object's BODY sits: a fixed point in front of the eye, slightly
 * below the line of sight, so it reads as being carried rather than floating.
 */
export function heldObjectPoint(args: { origin: Vec3; forward: Vec3 }): Vec3 {
  const forward = horizontalForward(args.forward);
  return {
    x: args.origin.x + forward.x * HOLD_FORWARD_UNITS,
    y: args.origin.y - HOLD_DROP_UNITS,
    z: args.origin.z + forward.z * HOLD_FORWARD_UNITS,
  };
}

/**
 * Where the vessel's MOUTH is, given how far it is tipped.
 *
 * Upright (`tilt` 0) the mouth sits `MOUTH_REACH_UNITS` above the body, the way
 * a bottle's neck does. As the student tips it, the mouth swings forward and
 * down along the arc of the tilt — so a pour visibly leaves the spout, and the
 * stream starts where the glass actually is rather than from the object's centre.
 * Turning the object (`yaw`) does not move the mouth: a pour leaves the spout
 * wherever it is pointed, and the aiming is done with the camera.
 */
export function pourOriginPoint(args: { origin: Vec3; forward: Vec3; pose: HoldPose }): Vec3 {
  const body = heldObjectPoint(args);
  const forward = horizontalForward(args.forward);
  const tilt = clampTilt(args.pose.tiltRadians);
  const rise = MOUTH_REACH_UNITS * Math.cos(tilt);
  const reach = MOUTH_REACH_UNITS * Math.sin(tilt);
  return {
    x: body.x + forward.x * reach,
    y: body.y + rise,
    z: body.z + forward.z * reach,
  };
}
