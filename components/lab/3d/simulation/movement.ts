/**
 * Keyboard movement math for the immersive laboratory camera.
 *
 * PURE, dependency-free, fully tested. The camera stays an orbit camera
 * (OrbitControls): movement slides both the camera and its target across the
 * bench plane, so orbiting, zooming and walking compose instead of fighting.
 * Yaw comes from the camera itself, so W always walks "into the screen".
 */

export interface MoveKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

/** No keys held. */
export const NO_MOVE: MoveKeys = { forward: false, back: false, left: false, right: false };

/** Walking speed across the bench, scene units per second. */
export const WALK_SPEED_UNITS_PER_SEC = 3.2;

/** Where the camera target may roam: the bench plus its surroundings. */
export interface MoveBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const CAMERA_MOVE_BOUNDS: MoveBounds = { minX: -8, maxX: 8, minZ: -6, maxZ: 8 };

/** Map a keyboard event to a movement direction. Null when unrelated. */
export function moveKeyForCode(code: string): keyof MoveKeys | null {
  switch (code) {
    case "KeyW":
    case "ArrowUp":
      return "forward";
    case "KeyS":
    case "ArrowDown":
      return "back";
    case "KeyA":
    case "ArrowLeft":
      return "left";
    case "KeyD":
    case "ArrowRight":
      return "right";
    default:
      return null;
  }
}

/**
 * True while the student is typing in a form field: movement keys must not
 * walk the camera while a reading is being recorded.
 */
export function isTypingTarget(element: { tagName?: string } | null): boolean {
  const tag = element?.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Planar offset for one frame from the held keys and the camera yaw.
 * Yaw 0 means looking toward −Z; forward is always "into the screen".
 */
export function computeMoveOffset(args: {
  keys: MoveKeys;
  yawRadians: number;
  speedUnitsPerSec: number;
  deltaSeconds: number;
}): { dx: number; dz: number } {
  const forwardX = -Math.sin(args.yawRadians);
  const forwardZ = -Math.cos(args.yawRadians);
  const rightX = Math.cos(args.yawRadians);
  const rightZ = -Math.sin(args.yawRadians);
  const along = (args.keys.forward ? 1 : 0) - (args.keys.back ? 1 : 0);
  const side = (args.keys.right ? 1 : 0) - (args.keys.left ? 1 : 0);
  if (along === 0 && side === 0) return { dx: 0, dz: 0 };
  const dt = Math.max(0, Math.min(args.deltaSeconds, 0.05));
  const speed = Math.max(0, args.speedUnitsPerSec) * dt;
  const length = Math.hypot(along, side);
  const nx = (forwardX * along + rightX * side) / length;
  const nz = (forwardZ * along + rightZ * side) / length;
  return { dx: nx * speed, dz: nz * speed };
}

/** Keep the camera target inside the walkable area. */
export function clampMoveTarget(
  point: { x: number; z: number },
  bounds: MoveBounds = CAMERA_MOVE_BOUNDS,
): { x: number; z: number } {
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, point.x)),
    z: Math.max(bounds.minZ, Math.min(bounds.maxZ, point.z)),
  };
}
