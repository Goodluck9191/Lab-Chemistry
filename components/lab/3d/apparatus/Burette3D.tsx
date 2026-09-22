"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { BURETTE_BASE, BURETTE_TIP } from "../simulation/spatial";
import { buretteLiquidSurfaceY, type BuretteTubeGeometry } from "../simulation/volume-mapping";
import {
  STOPCOCK_MAX_ANGLE_DEG,
  clampStopcockAngle,
  stopcockAngleFromDrag,
  stopcockIsOpen,
  stopcockNotchFor,
} from "../simulation/stopcock";
import { BuretteLiquid } from "../liquids";
import { Selectable3DObject } from "../interactions";

/**
 * The 3D burette: stand, clamp, glass tube, scale, liquid, meniscus, stopcock,
 * tip. Named parts follow `public/models/README.md` (GlassTube, Scale, Liquid,
 * Meniscus, StopcockBody, StopcockHandle, Tip, ClampMount) so a
 * Blender-authored GLB can replace this procedural assembly later without
 * changing interaction code.
 *
 * THE VALVE (§12): the handle turns through a quarter turn, and where it stops
 * decides how fast the titrant leaves the tip. Dragging it is the physical
 * gesture; the handle click, and the stepper in the contextual card, are the
 * accessible equivalents — all three land on the same angle.
 *
 * Props are public-state derivations only: reading, capacity, valve angle,
 * selection and callbacks.
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

/**
 * The stopcock. Vertical pointer travel sweeps the handle; the barrel turns to
 * follow it and the colour names the opening, so the state is never conveyed by
 * angle alone.
 */
function Stopcock({
  angleDeg,
  interactive,
  onAngle,
  onDragChange,
}: {
  angleDeg: number;
  interactive: boolean;
  onAngle: (angleDeg: number) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const handle = useRef<THREE.Group>(null);
  const [dragging, setDragging] = useState(false);
  const startAngle = useRef(0);
  const startY = useRef(0);
  // The render angle follows the authoritative angle a frame later; mirroring
  // it in an effect keeps the mesh out of the render pass's way.
  const angleRef = useRef(angleDeg);
  useEffect(() => {
    angleRef.current = angleDeg;
  }, [angleDeg]);

  const open = stopcockIsOpen(angleDeg);
  const notch = stopcockNotchFor(angleDeg);

  // Smoothed render angle: the mesh follows the value, it never leads it.
  useFrame((_, delta) => {
    if (!handle.current) return;
    const target = (clampStopcockAngle(angleRef.current) / STOPCOCK_MAX_ANGLE_DEG) * (Math.PI / 2);
    const current = handle.current.rotation.z;
    // While dragging, follow the pointer immediately so the hand and the glass
    // agree; otherwise settle with a light spring.
    const factor = dragging ? 1 : Math.min(1, delta * 10);
    handle.current.rotation.z = current + (target - current) * factor;
  });

  const beginDrag = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!interactive) return;
      event.stopPropagation();
      startAngle.current = angleRef.current;
      startY.current = event.clientY;
      setDragging(true);
      onDragChange(true);
      document.body.style.cursor = "grabbing";
    },
    [interactive, onDragChange],
  );

  // The drag is followed on the window, not on the mesh: the pointer regularly
  // leaves the handle, and a valve that stops turning when the cursor slips off
  // is worse than no valve at all.
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      onAngle(
        stopcockAngleFromDrag({
          startAngleDeg: startAngle.current,
          deltaYPixels: event.clientY - startY.current,
        }),
      );
    };
    const end = () => {
      setDragging(false);
      onDragChange(false);
      document.body.style.cursor = "auto";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging, onAngle, onDragChange]);

  return (
    <group name="StopcockBody" position={[TUBE_CENTER_X, 2.38, 0]}>
      {/* Barrel through the tube */}
      <mesh
        rotation={[0, 0, Math.PI / 2]}
        onPointerDown={beginDrag}
        onPointerUp={(event: ThreeEvent<PointerEvent>) => {
          if (!interactive) return;
          event.stopPropagation();
          // A click (no drag) steps to the next opening, so the valve is
          // operable without a steady hand.
          if (dragging) return;
          onAngle(clampStopcockAngle(angleDeg) === 0 ? 20 : 0);
        }}
      >
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
      {/* The opening is named in the world too, so it is never colour-only. */}
      <Text
        position={[0, -0.22, 0.34]}
        fontSize={0.11}
        color="#1f2937"
        anchorX="center"
        anchorY="middle"
      >
        {notch.label}
      </Text>
    </group>
  );
}

export function Burette3D({
  readingMl,
  capacityMl,
  stopcockAngleDeg,
  stopcockInteractive,
  meniscusHighlighted,
  selected,
  onSelect,
  onValveAngle,
  onValveDragChange,
  airBubble,
  rinseFlash,
}: {
  readingMl: number | null;
  capacityMl: number;
  /** Valve handle angle in degrees: 0 shut, 90 wide open. */
  stopcockAngleDeg: number;
  stopcockInteractive: boolean;
  meniscusHighlighted: boolean;
  selected: boolean;
  onSelect: () => void;
  onValveAngle: (angleDeg: number) => void;
  onValveDragChange: (dragging: boolean) => void;
  /** True while the tip still holds air: a visible bubble until expelled. */
  airBubble: boolean;
  /** Brief water pour overlay right after a rinse/conditioning action. */
  rinseFlash: boolean;
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
        {/* Air bubble: visible until the student expels it through the tip */}
        {airBubble ? (
          <mesh position={[TUBE_CENTER_X, 2.3, 0]} name="AirBubble">
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
          </mesh>
        ) : null}
      </Selectable3DObject>

      {/* Rinse pour overlay: water entering the tube after rinse/condition */}
      {rinseFlash ? (
        <mesh position={[TUBE_CENTER_X, 4.05, 0]} name="RinsePour">
          <cylinderGeometry args={[0.09, 0.12, 0.7, 12]} />
          <meshBasicMaterial color="#7dd3fc" transparent opacity={0.55} depthWrite={false} />
        </mesh>
      ) : null}

      <Stopcock
        angleDeg={stopcockAngleDeg}
        interactive={stopcockInteractive}
        onAngle={onValveAngle}
        onDragChange={onValveDragChange}
      />
    </group>
  );
}
