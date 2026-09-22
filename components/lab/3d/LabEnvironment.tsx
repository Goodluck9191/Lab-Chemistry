"use client";

import { ContactShadows } from "@react-three/drei";

/**
 * The laboratory room: bench, wall, reagent shelf and white tile.
 *
 * Deliberately calm — the experiment is the subject, not the room. All
 * geometry is primitive-based and procedural (see `public/models/README.md`
 * for the GLB drop-in contract that will replace these parts with
 * Blender-authored models without touching interaction code).
 */
export function LabEnvironment() {
  return (
    <group>
      {/* Back wall */}
      <mesh position={[0, 3, -3.4]} receiveShadow>
        <planeGeometry args={[16, 9]} />
        <meshStandardMaterial color="#e8edf2" roughness={0.95} />
      </mesh>
      {/* Floor */}
      <mesh position={[0, -1.2, 2]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[18, 12]} />
        <meshStandardMaterial color="#dbe2ea" roughness={1} />
      </mesh>
      {/* Bench top */}
      <mesh position={[0, -0.15, 0]} receiveShadow castShadow>
        <boxGeometry args={[10.4, 0.3, 6]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.6} />
      </mesh>
      {/* Bench front edge */}
      <mesh position={[0, -1.05, 2.6]}>
        <boxGeometry args={[10.4, 1.5, 0.25]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.8} />
      </mesh>
      {/* Reagent shelf */}
      <mesh position={[2.6, 2.5, -2.9]} castShadow>
        <boxGeometry args={[5.4, 0.12, 0.9]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.7} />
      </mesh>
      <mesh position={[0.2, 1.7, -2.95]}>
        <boxGeometry args={[0.12, 1.6, 0.7]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.7} />
      </mesh>
      <mesh position={[5.0, 1.7, -2.95]}>
        <boxGeometry args={[0.12, 1.6, 0.7]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.7} />
      </mesh>
      {/* White tile under the flask area */}
      <mesh position={[-1.35, 0.015, -0.2]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.6, 2.2]} />
        <meshStandardMaterial color="#ffffff" roughness={0.35} />
      </mesh>
      {/* Soft grounding under the apparatus */}
      <ContactShadows position={[0, 0.02, 0]} opacity={0.42} scale={11} blur={2.4} far={4} />
    </group>
  );
}
