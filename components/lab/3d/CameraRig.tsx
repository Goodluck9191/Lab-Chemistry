"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ApparatusFocusKey } from "./simulation/apparatus-state";
import {
  WALK_SPEED_UNITS_PER_SEC,
  clampMoveTarget,
  computeMoveOffset,
  isTypingTarget,
  moveKeyForCode,
  NO_MOVE,
  type MoveKeys,
} from "./simulation/movement";

/**
 * The camera: three views over one laboratory (§27).
 *
 *   LAB VIEW      first person. The pointer is captured, the mouse looks
 *                 around, WASD walks the bench. This is the default, because
 *                 "I entered the lab" is the whole point of the phase.
 *
 *   INSPECTION    free orbit with smooth focus flights. Selecting an apparatus
 *                 (or pressing F) flies in close; the controls stay live.
 *
 *   READING       the same orbit rig, flown to the burette scale with the
 *                 meniscus highlighted.
 *
 * Walking and orbiting are deliberately exclusive: two cameras fighting over
 * one mouse is how a 3D scene ends up feeling broken. Asking to inspect
 * something is what switches you out of first person, and letting go of the
 * focus returns you to the bench overview.
 *
 * Motion is critically damped rather than springy, and the pointer is never
 * captured without an explicit click — a laboratory that traps the cursor is a
 * laboratory the student cannot leave.
 */

interface CameraPreset {
  position: [number, number, number];
  target: [number, number, number];
}

export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  overview: { position: [0.4, 1.9, 4.6], target: [0, 1.1, -0.3] },
  burette: { position: [-2.0, 2.9, 2.6], target: [-2.0, 2.5, -0.5] },
  buretteReading: { position: [-1.35, 2.75, 0.9], target: [-2.02, 2.62, -0.5] },
  flask: { position: [-0.4, 2.2, 3.2], target: [-1.7, 0.7, -0.3] },
  balance: { position: [2.2, 2.4, 2.4], target: [2.2, 0.9, -0.6] },
  cylinder: { position: [0.9, 2.1, 2.2], target: [0.9, 1.0, -0.9] },
};

function presetForFocus(focus: ApparatusFocusKey, readingMode: boolean): CameraPreset {
  if (focus === "burette") return readingMode ? CAMERA_PRESETS.buretteReading : CAMERA_PRESETS.burette;
  if (focus === "flask") return CAMERA_PRESETS.flask;
  if (focus === "balance") return CAMERA_PRESETS.balance;
  if (focus === "cylinder") return CAMERA_PRESETS.cylinder;
  return CAMERA_PRESETS.overview;
}

/** Eye height above the bench top, in scene units. */
export const EYE_HEIGHT_UNITS = 1.62;
/** Radians of view rotation per pixel of mouse movement. */
const LOOK_SENSITIVITY = 0.0025;
const MAX_PITCH_RADIANS = 1.2;

export function CameraRig({
  focus,
  readingMode,
  moveEnabled = false,
  suspended = false,
  onPointerLockChange,
}: {
  focus: ApparatusFocusKey;
  /** Reading Mode: close-up on the scale with the meniscus highlighted. */
  readingMode: boolean;
  /** First-person walking with the pointer captured. */
  moveEnabled?: boolean;
  /** A gesture in the world owns the pointer for the moment (e.g. the valve). */
  suspended?: boolean;
  onPointerLockChange?: (locked: boolean) => void;
}) {
  const { camera, gl, controls } = useThree((state) => ({
    camera: state.camera,
    gl: state.gl,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controls: state.controls as any,
  }));

  // Asking to inspect something (or to read the scale) takes over the camera.
  const inspecting = focus !== null || readingMode;
  const walking = moveEnabled && !inspecting && !suspended;

  const goal = useRef({
    position: new THREE.Vector3(...CAMERA_PRESETS.overview.position),
    target: new THREE.Vector3(...CAMERA_PRESETS.overview.target),
  });
  const yaw = useRef(0);
  const pitch = useRef(-0.18);
  const locked = useRef(false);

  // ------------------------------------------------------------------ walking
  useEffect(() => {
    if (!walking) {
      if (locked.current) {
        document.exitPointerLock?.();
      }
      locked.current = false;
      onPointerLockChange?.(false);
      return;
    }
    // Stand at eye height, looking across the bench.
    camera.position.set(0.4, EYE_HEIGHT_UNITS, 4.4);
    camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");

    const element = gl.domElement;
    const requestLock = () => element.requestPointerLock?.();
    const onLockChange = () => {
      locked.current = document.pointerLockElement === element;
      onPointerLockChange?.(locked.current);
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!locked.current) return;
      yaw.current -= event.movementX * LOOK_SENSITIVITY;
      pitch.current = Math.max(
        -MAX_PITCH_RADIANS,
        Math.min(MAX_PITCH_RADIANS, pitch.current - event.movementY * LOOK_SENSITIVITY),
      );
      camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");
    };

    element.addEventListener("click", requestLock);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMouseMove);
    return () => {
      element.removeEventListener("click", requestLock);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMouseMove);
      if (document.pointerLockElement === element) document.exitPointerLock?.();
      locked.current = false;
      onPointerLockChange?.(false);
    };
  }, [walking, camera, gl, onPointerLockChange]);

  // Walking keys: read from the window, ignored while typing a reading.
  const held = useRef<MoveKeys>({ ...NO_MOVE });
  useEffect(() => {
    if (!walking) {
      held.current = { ...NO_MOVE };
      return;
    }
    const down = (event: KeyboardEvent) => {
      if (event.repeat || isTypingTarget(document.activeElement)) return;
      const key = moveKeyForCode(event.code);
      if (key) held.current[key] = true;
    };
    const up = (event: KeyboardEvent) => {
      const key = moveKeyForCode(event.code);
      if (key) held.current[key] = false;
    };
    const blur = () => {
      held.current = { ...NO_MOVE };
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [walking]);

  // ---------------------------------------------------------------- inspection
  useEffect(() => {
    if (!inspecting) return;
    const preset = presetForFocus(focus, readingMode);
    goal.current.position.set(...preset.position);
    goal.current.target.set(...preset.target);
  }, [focus, readingMode, inspecting]);

  useFrame((state, delta) => {
    // The camera is posed here rather than through the hook's value: a frame is
    // the only place three.js expects the pose to be written.
    const camera = state.camera;
    if (walking) {
      const keys = held.current;
      if (keys.forward || keys.back || keys.left || keys.right) {
        const step = computeMoveOffset({
          keys,
          yawRadians: yaw.current,
          speedUnitsPerSec: WALK_SPEED_UNITS_PER_SEC,
          deltaSeconds: delta,
        });
        const next = clampMoveTarget({
          x: camera.position.x + step.dx,
          z: camera.position.z + step.dz,
        });
        camera.position.x = next.x;
        camera.position.z = next.z;
      }
      // Eye height is fixed: the student is standing at a bench, not flying.
      camera.position.y = EYE_HEIGHT_UNITS;
      camera.lookAt(
        camera.position.x - Math.sin(yaw.current) * 2,
        camera.position.y + Math.tan(pitch.current) * 2,
        camera.position.z - Math.cos(yaw.current) * 2,
      );
      return;
    }
    if (!inspecting) return;
    const t = 1 - Math.exp(-4.5 * Math.min(delta, 0.05));
    camera.position.lerp(goal.current.position, t);
    const target = controls?.target as THREE.Vector3 | undefined;
    if (target) {
      target.lerp(goal.current.target, t);
      controls.update?.();
    }
  });

  if (walking) return null;

  return (
    <OrbitControls
      makeDefault
      enabled={!suspended}
      enableDamping
      dampingFactor={0.12}
      minDistance={0.6}
      maxDistance={16}
      maxPolarAngle={Math.PI / 2.05}
      target={[0, 1.1, -0.3]}
    />
  );
}
