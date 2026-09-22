"use client";

import { useRef, useState, type ReactNode } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  BALANCE_SLOT,
  BEAKER_SLOT,
  BURETTE_TIP,
  CYLINDER_SLOT,
  FLASK_TILE_SLOT,
  WASTE_SLOT,
  type BenchPoint,
  type ZoneRect,
} from "./simulation/spatial";
import type { PhysicalSelectionKey } from "./simulation/apparatus-state";

/**
 * Shared 3D interaction primitives.
 *
 * - `Selectable3DObject`: hover outline + click/keyboard selection. The visual
 *   highlight is the ONLY thing it owns; what selection MEANS stays in the
 *   bench state (mirroring the SVG bench's selection keys).
 * - `DraggableOnBench`: pointer drag constrained to the bench-top plane, with
 *   clamping so objects cannot leave the bench or sink through it. Pure
 *   spatial math (`spatial.ts`) decides validity — never the renderer.
 * - `PlacementZone3D`: a floor ring that signals valid (green) / invalid
 *   (amber) / idle states. Text labels accompany it in the DOM toolbar, so the
 *   signal is never colour-only.
 */

export function Selectable3DObject({
  selected,
  onSelect,
  name,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const group = useRef<THREE.Group>(null);

  return (
    <group
      ref={group}
      // NOTE: no <title> here — inside an R3F Canvas lowercase elements must
      // be THREE objects. The accessible name lives in the DOM toolbar; the
      // THREE object name below is for debugging/raycast identification only.
      name={name}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "auto";
      }}
    >
      {children}
      {/* Selection/hover halo at the bench surface */}
      {selected || hovered ? (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, selected ? 0.66 : 0.62, 40]} />
          <meshBasicMaterial
            color={selected ? "#2563eb" : "#93c5fd"}
            transparent
            opacity={selected ? 0.95 : 0.6}
            depthWrite={false}
          />
        </mesh>
      ) : null}
    </group>
  );
}

export function PlacementZone3D({
  zone,
  state,
  y = 0.02,
}: {
  zone: ZoneRect;
  /** idle | valid | invalid */
  state: "idle" | "valid" | "invalid";
  y?: number;
}) {
  if (state === "idle") return null;
  const width = zone.maxX - zone.minX;
  const depth = zone.maxZ - zone.minZ;
  const cx = (zone.minX + zone.maxX) / 2;
  const cz = (zone.minZ + zone.maxZ) / 2;
  return (
    <mesh position={[cx, y, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial
        color={state === "valid" ? "#22c55e" : "#f59e0b"}
        transparent
        opacity={0.22}
        depthWrite={false}
      />
    </mesh>
  );
}
/** Small floating marker used while a drag is over a valid zone. */
export function DropMarker({ position, valid }: { position: [number, number, number]; valid: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.y = position[1] + Math.sin(clock.elapsedTime * 4) * 0.03;
    }
  });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.07, 16, 16]} />
      <meshBasicMaterial color={valid ? "#22c55e" : "#f59e0b"} />
    </mesh>
  );
}

/**
 * Subtle task marker: a soft pulsing ring on the bench beneath the apparatus
 * the current procedure step points at. Guidance without arrows — one ring,
 * low opacity, hidden when there is nothing to point at. Positions come from
 * the same slot constants the scene uses, so the ring can never drift from
 * the apparatus (the flask ring follows the dragged flask).
 */
export function GuideMarker3D({
  guideKey,
  flaskPos,
}: {
  guideKey: Exclude<PhysicalSelectionKey, null> | null;
  flaskPos: BenchPoint;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const material = ref.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.28 + Math.sin(clock.elapsedTime * 2.2) * 0.12;
    }
  });
  if (!guideKey) return null;
  const at: BenchPoint =
    guideKey === "burette"
      ? { x: BURETTE_TIP.x, z: BURETTE_TIP.z }
      : guideKey === "conical_flask"
        ? flaskPos
        : guideKey === "analytical_balance"
          ? BALANCE_SLOT
          : guideKey === "graduated_cylinder"
            ? CYLINDER_SLOT
            : guideKey === "beaker_250"
              ? BEAKER_SLOT
              : guideKey === "waste_container"
                ? WASTE_SLOT
                : guideKey === "reagent_bottle"
                  ? { x: 2.4, z: 0.6 }
                  : FLASK_TILE_SLOT;
  return (
    <mesh ref={ref} position={[at.x, 0.04, at.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.5, 0.62, 40]} />
      <meshBasicMaterial color="#eab308" transparent opacity={0.3} depthWrite={false} />
    </mesh>
  );
}
