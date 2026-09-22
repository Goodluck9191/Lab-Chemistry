"use client";

import { useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { BURETTE_BASE, BURETTE_TIP } from "../simulation/spatial";
import { buretteLiquidSurfaceY, type BuretteTubeGeometry } from "../simulation/volume-mapping";
import { BuretteLiquid } from "../liquids";
import { Selectable3DObject } from "../interactions";

/**
 * The 3D burette: stand, clamp, glass tube, scale, liquid, meniscus, stopcock,
 * tip. Named parts follow `public/models/README.md` (GlassTube, Scale,
 * Liquid, Meniscus, StopcockBody, StopcockHandle, Tip, ClampMount) so a
 * Blender-authored GLB can replace this procedural assembly later without
 * changing interaction code.
 *
 * Props are public-state derivations only: reading, capacity, stopcock UI
 * state, flow flag for the open-path stream, selection and callbacks.
 */

const TUBE_TOP_Y = 3.7;
const TUBE_BOTTOM_Y = 2.45;
const TUBE_RADIUS = 0.16;
const TUBE_CENTER_X = BURETTE_TIP.x;

const GEOMETRY: BuretteTubeGeometry = {
  topY: TUBE_TOP_Y,
  bottomY: TUBE_BOTTOM_Y,
  capacityMl: 50,
};

function ScaleTicks({ capacityMl }: { capacityMl: number }) {
  const ticks: Array<{ value: number; y: number; major: boolean }> = [];
  const span = TUBE_BOTTOM_Y - TUBE_TOP_Y;
  const steps = Math.min(Math.round(capacityMl), 100);
  for (let ml = 0; ml <= steps; ml += 1) {
    ticks.push({
      value: ml,
      y: TUBE_TOP_Y + (ml / capacityMl) * span,
      major: ml % 10 === 0,
    });
  }
  return (
    <group name="Scale">
      {ticks.map((tick) => (
        <mesh
          key={tick.value}
          position={[TUBE_CENTER_X + TUBE_RADIUS + (tick.major ? 0.045 : 0.025), tick.y, 0.1]}
        >
          <boxGeometry args={[tick.major ? 0.09 : 0.05, 0.008, 0.008]} />
          <meshBasicMaterial color="#334155" />
        </mesh>
      ))}
      {ticks
        .filter((tick) => tick.major)
        .map((tick) => (
          <Text
            key={`label-${tick.value}`}
            position={[TUBE_CENTER_X - TUBE_RADIUS - 0.16, tick.y, 0.1]}
            fontSize={0.09}
            color="#334155"
            anchorX="center"
            anchorY="middle"
          >
            {tick.value}
          </Text>
        ))}
    </group>
  );
}

function StopcockHandle({
  open,
  interactive,
  onToggle,
}: {
  open: boolean;
  interactive: boolean;
  onToggle: () => void;
}) {
  const handle = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!handle.current) return;
    // CLOSED: handle across the tube (rotation 0). OPEN: rotated 90°.
    const target = open ? Math.PI / 2 : 0;
    const current = handle.current.rotation.z;
    const next = current + (target - current) * Math.min(1, delta * 10);
    handle.current.rotation.z = next;
  });
  // NOTE: keyboard access to the stopcock lives in the DOM toolbar/panels
  // (R3F groups have no key handlers); the 3D handle is pointer-operated.
  return (
    <group
      name="StopcockBody"
      position={[TUBE_CENTER_X, 2.38, 0]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        if (!interactive) return;
        event.stopPropagation();
        onToggle();
      }}
    >
      {/* Barrel through the tube */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.055, 0.055, 0.5, 16]} />
        <meshStandardMaterial color={open ? "#2563eb" : "#64748b"} roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Rotating handle */}
      <group ref={handle} name="StopcockHandle">
        <mesh position={[0, 0, 0.17]}>
          <boxGeometry args={[0.34, 0.07, 0.06]} />
          <meshStandardMaterial color={open ? "#1d4ed8" : "#334155"} roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

export function Burette3D({
  readingMl,
  capacityMl,
  stopcockOpen,
  stopcockInteractive,
  meniscusHighlighted,
  selected,
  onSelect,
  onToggleStopcock,
}: {
  readingMl: number | null;
  capacityMl: number;
  stopcockOpen: boolean;
  stopcockInteractive: boolean;
  meniscusHighlighted: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleStopcock: () => void;
}) {
  const surfaceY = buretteLiquidSurfaceY(readingMl, { ...GEOMETRY, capacityMl });
  return (
    <group position={[0, 0, -0.5]}>
      {/* Stand: base, rod, clamp arm */}
      <mesh position={[BURETTE_BASE.x, 0.08, -0.4]} castShadow receiveShadow name="StandBase">
        <boxGeometry args={[1.1, 0.16, 0.7]} />
        <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[BURETTE_BASE.x, 1.9, -0.4]} castShadow name="StandRod">
        <cylinderGeometry args={[0.05, 0.05, 3.8, 12]} />
        <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.7} />
      </mesh>
      <mesh
        position={[(BURETTE_BASE.x + TUBE_CENTER_X) / 2, 3.35, -0.25]}
        castShadow
        name="ClampMount"
      >
        <boxGeometry args={[Math.abs(TUBE_CENTER_X - BURETTE_BASE.x) + 0.1, 0.09, 0.09]} />
        <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[TUBE_CENTER_X, 3.35, -0.25]} name="ClampJaw">
        <torusGeometry args={[0.2, 0.045, 10, 20]} />
        <meshStandardMaterial color="#1f2937" roughness={0.5} metalness={0.5} />
      </mesh>

      <Selectable3DObject selected={selected} onSelect={onSelect} name="Burette">
        {/* GlassTube */}
        <mesh position={[TUBE_CENTER_X, (TUBE_TOP_Y + TUBE_BOTTOM_Y) / 2, 0]} name="GlassTube">
          <cylinderGeometry
            args={[TUBE_RADIUS, TUBE_RADIUS, TUBE_BOTTOM_Y - TUBE_TOP_Y, 28, 1, true]}
          />
          <meshPhysicalMaterial
            color="#e2e8f0"
            transparent
            opacity={0.28}
            roughness={0.05}
            metalness={0}
            side={THREE.DoubleSide}
          />
        </mesh>
        <ScaleTicks capacityMl={capacityMl} />
        <group name="Liquid">
          <BuretteLiquid
            surfaceY={surfaceY}
            tubeBottomY={TUBE_BOTTOM_Y}
            tubeRadius={TUBE_RADIUS * 0.88}
            tubeCenterX={TUBE_CENTER_X}
            highlighted={meniscusHighlighted}
          />
        </group>
        {/* Tip */}
        <mesh position={[TUBE_CENTER_X, 2.18, 0]} name="Tip">
          <coneGeometry args={[0.09, 0.24, 16, 1, true]} />
          <meshPhysicalMaterial
            color="#e2e8f0"
            transparent
            opacity={0.35}
            roughness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
      </Selectable3DObject>

      <StopcockHandle open={stopcockOpen} interactive={stopcockInteractive} onToggle={onToggleStopcock} />
    </group>
  );
}
