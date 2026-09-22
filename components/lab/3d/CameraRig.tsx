"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ApparatusFocusKey } from "./simulation/apparatus-state";

/**
 * Camera rig: free orbit/zoom/pan plus smooth focus flights.
 *
 * Selecting an apparatus flies the camera to its inspection preset; the
 * controls stay live throughout (never locked), and Reset View returns to the
 * overview. Movement is critically-damped smoothing, not a teleport — except
 * the first mount, which starts at the overview directly.
 */

interface CameraPreset {
  position: [number, number, number];
  target: [number, number, number];
}

export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  overview: { position: [0.4, 4.4, 8.6], target: [0, 1.2, -0.3] },
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

export function CameraRig({
  focus,
  readingMode,
  resetSignal,
}: {
  focus: ApparatusFocusKey;
  /** Reading Mode: close-up on the scale with the meniscus highlighted. */
  readingMode: boolean;
  /** Increment to fly back to the overview. */
  resetSignal: number;
}) {
  const { camera, controls } = useThree((state) => ({
    camera: state.camera,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controls: state.controls as any,
  }));
  const goal = useRef({
    position: new THREE.Vector3(...CAMERA_PRESETS.overview.position),
    target: new THREE.Vector3(...CAMERA_PRESETS.overview.target),
  });

  useEffect(() => {
    const preset = presetForFocus(focus, readingMode);
    goal.current.position.set(...preset.position);
    goal.current.target.set(...preset.target);
  }, [focus, readingMode, resetSignal]);

  useFrame((_, delta) => {
    const t = 1 - Math.exp(-4.5 * Math.min(delta, 0.05));
    camera.position.lerp(goal.current.position, t);
    const target = controls?.target as THREE.Vector3 | undefined;
    if (target) {
      target.lerp(goal.current.target, t);
      controls.update?.();
    }
  });

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={0.6}
      maxDistance={16}
      maxPolarAngle={Math.PI / 2.05}
      target={[0, 1.2, -0.3]}
    />
  );
}
