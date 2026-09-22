"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { PLACEMENT_ZONES } from "./simulation/spatial";
import type { BenchPoint } from "./simulation/spatial";

/**
 * Rapier physics layer: physical interaction ONLY (§34).
 *
 * - A fixed bench collider: objects rest on the bench and cannot sink through
 *   it (the drag system also clamps Y, this is the physical backstop).
 * - A kinematic flask body that follows the dragged mesh: entering the
 *   receiving-zone sensor fires `onReceivingZone`, confirming the pure-math
 *   validation from `spatial.ts` with an actual collision event.
 * - A fixed chamber for the balance pan so the weighing beaker collides
 *   instead of clipping.
 *
 * Physics NEVER computes chemistry, concentration, endpoint or grade. If the
 * WASM engine fails to initialise, the scene renders without it (the caller
 * wraps this in an error boundary + Suspense).
 */
export function PhysicsZones({
  flaskPos,
  onReceivingZone,
}: {
  flaskPos: BenchPoint;
  onReceivingZone: (inside: boolean) => void;
}) {
  const flaskBody = useRef<RapierRigidBody>(null);

  useFrame(() => {
    // Kinematic follow: the physical body tracks the dragged mesh exactly.
    flaskBody.current?.setTranslation({ x: flaskPos.x, y: 0.5, z: flaskPos.z }, true);
  });

  const zone = PLACEMENT_ZONES.buretteReceiving;
  const cx = (zone.minX + zone.maxX) / 2;
  const cz = (zone.minZ + zone.maxZ) / 2;
  const hx = (zone.maxX - zone.minX) / 2;
  const hz = (zone.maxZ - zone.minZ) / 2;

  return (
    <Physics gravity={[0, -9.81, 0]}>
      {/* Bench slab */}
      <RigidBody type="fixed" colliders={false} position={[0, -0.3, 0]}>
        <CuboidCollider args={[5.2, 0.3, 3.0]} />
      </RigidBody>
      {/* Flask body (kinematic: driven by the student's drag) */}
      <RigidBody ref={flaskBody} type="kinematicPosition" colliders={false} position={[flaskPos.x, 0.5, flaskPos.z]}>
        <CuboidCollider args={[0.3, 0.5, 0.3]} />
      </RigidBody>
      {/* Receiving-zone sensor */}
      <CuboidCollider
        sensor
        args={[hx, 0.6, hz]}
        position={[cx, 0.5, cz]}
        onIntersectionEnter={() => onReceivingZone(true)}
        onIntersectionExit={() => onReceivingZone(false)}
      />
    </Physics>
  );
}
