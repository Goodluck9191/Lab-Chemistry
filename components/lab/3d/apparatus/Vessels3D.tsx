"use client";

import { useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { straightWallLiquidHeight } from "../simulation/volume-mapping";
import { clampToBench, snapBeakerOnDrop, type BenchPoint } from "../simulation/spatial";
import { Selectable3DObject } from "../interactions";

/**
 * Supporting vessels and instruments. Every piece renders from public-state
 * derivations passed as props — none of them computes chemistry, and none
 * receives hidden values.
 */

/** How far in front of the eye a carried vessel rides, and how far below it. */
const CARRY_FORWARD_UNITS = 0.85;
const CARRY_DROP_UNITS = 0.42;

// ---------------------------------------------------------------------------
// 250 mL beaker with KHP solid → dissolving → dissolved states
// ---------------------------------------------------------------------------

export function Beaker3D({
  position,
  liquidMl,
  khpState,
  selected,
  onSelect,
  dragEnabled = false,
  heldInHand = false,
  heldYawRadians = 0,
  onDrop,
}: {
  position: [number, number, number];
  liquidMl: number;
  /** solid | dissolving | dissolved | none */
  khpState: "solid" | "dissolving" | "dissolved" | "none";
  selected: boolean;
  onSelect: () => void;
  /** Slide it across the bench under the pointer (physical only). */
  dragEnabled?: boolean;
  /** Carried in the student's hand: it rides in front of the eye instead. */
  heldInHand?: boolean;
  /** How the carried beaker is turned in the hand, radians. */
  heldYawRadians?: number;
  onDrop?: (point: BenchPoint) => void;
}) {
  const liquidH = straightWallLiquidHeight(liquidMl, {
    bottomY: 0,
    heightUnits: 0.85,
    capacityMl: 250,
  });
  const [dragPos, setDragPos] = useState<BenchPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const offset = useRef({ x: 0, z: 0 });
  const root = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const yaw = useRef(0);
  const shownX = dragPos?.x ?? position[0];
  const shownZ = dragPos?.z ?? position[2];

  useFrame((_, delta) => {
    if (!root.current) return;
    if (heldInHand) {
      const forward = camera.getWorldDirection(new THREE.Vector3());
      forward.y = 0;
      forward.normalize();
      root.current.position.set(
        camera.position.x + forward.x * CARRY_FORWARD_UNITS,
        camera.position.y - CARRY_DROP_UNITS,
        camera.position.z + forward.z * CARRY_FORWARD_UNITS,
      );
    } else {
      root.current.position.set(shownX, 0, shownZ);
    }
    const targetYaw = heldInHand ? heldYawRadians : 0;
    yaw.current += (targetYaw - yaw.current) * Math.min(1, delta * 10);
    root.current.rotation.y = yaw.current;
  });

  const beginDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!dragEnabled || heldInHand) return;
    event.stopPropagation();
    offset.current = { x: shownX - event.point.x, z: shownZ - event.point.z };
    setDragging(true);
    document.body.style.cursor = "grabbing";
  };
  const moveDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    event.stopPropagation();
    setDragPos(clampToBench({ x: event.point.x + offset.current.x, z: event.point.z + offset.current.z }));
  };
  const endDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    event.stopPropagation();
    setDragging(false);
    document.body.style.cursor = "auto";
    const dropped = clampToBench({
      x: event.point.x + offset.current.x,
      z: event.point.z + offset.current.z,
    });
    setDragPos(null);
    onDrop?.(snapBeakerOnDrop(dropped));
  };

  return (
    <group ref={root} position={[shownX, 0, shownZ]}>
      <Selectable3DObject selected={selected} onSelect={onSelect} name="Beaker, 250 mL">
        <group onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag}>
        <mesh position={[0, 0.45, 0]} castShadow name="BeakerWall">
          <cylinderGeometry args={[0.34, 0.32, 0.9, 24, 1, true]} />
          <meshPhysicalMaterial
            color="#e2e8f0"
            transparent
            opacity={0.3}
            roughness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.32, 24]} />
          <meshPhysicalMaterial color="#e2e8f0" transparent opacity={0.45} roughness={0.1} />
        </mesh>
        {liquidH > 0.001 ? (
          <mesh position={[0, liquidH / 2 + 0.02, 0]}>
            <cylinderGeometry args={[0.3, 0.29, liquidH, 24]} />
            <meshPhysicalMaterial color="#e0f2fe" transparent opacity={0.6} roughness={0.15} />
          </mesh>
        ) : null}
        {khpState === "solid" || khpState === "dissolving" ? (
          <group position={[0, 0.08, 0]} scale={khpState === "dissolving" ? 0.55 : 1}>
            {[
              [0, 0, 0],
              [0.12, 0.02, 0.05],
              [-0.11, 0.01, 0.07],
              [0.03, 0.06, -0.1],
              [-0.04, 0.03, -0.02],
            ].map((p, i) => (
              <mesh key={i} position={[p[0], p[1], p[2]]} rotation={[0.4 * i, 0.7 * i, 0]}>
                <icosahedronGeometry args={[0.07, 0]} />
                <meshStandardMaterial
                  color="#f8fafc"
                  roughness={0.6}
                  transparent={khpState === "dissolving"}
                  opacity={khpState === "dissolving" ? 0.6 : 1}
                />
              </mesh>
            ))}
          </group>
        ) : null}
        </group>
      </Selectable3DObject>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Watch glass (covers the beaker the procedure says to cover)
// ---------------------------------------------------------------------------

export function WatchGlass3D({
  position,
  covering,
  selected,
  onSelect,
}: {
  position: [number, number, number];
  /** Raised onto the beaker when true; resting on the bench otherwise. */
  covering: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const lift = covering ? 0.92 : 0.02;
  return (
    <group position={position}>
      <Selectable3DObject selected={selected} onSelect={onSelect} name="Watch glass">
        <mesh position={[0, lift, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <sphereGeometry args={[0.24, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2.6]} />
          <meshPhysicalMaterial
            color="#e2e8f0"
            transparent
            opacity={0.3}
            roughness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
      </Selectable3DObject>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Rubber stopper (seals the flask the manual says to stopper and swirl)
// ---------------------------------------------------------------------------

export function RubberStopper3D({
  position,
  selected,
  onSelect,
}: {
  position: [number, number, number];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <group position={position}>
      <Selectable3DObject selected={selected} onSelect={onSelect} name="Rubber stopper">
        <mesh position={[0, 0.06, 0]} castShadow>
          <cylinderGeometry args={[0.075, 0.095, 0.14, 16]} />
          <meshStandardMaterial color="#3f3f46" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.14, 0]}>
          <cylinderGeometry args={[0.11, 0.11, 0.03, 16]} />
          <meshStandardMaterial color="#52525b" roughness={0.8} />
        </mesh>
      </Selectable3DObject>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Analytical balance with live display (public mass only)
// ---------------------------------------------------------------------------

export function Balance3D({
  position,
  displayText,
  hasBeaker,
  selected,
  onSelect,
}: {
  position: [number, number, number];
  /** Exact text for the display: already-formatted public mass, never hidden. */
  displayText: string;
  hasBeaker: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <group position={position}>
      <Selectable3DObject selected={selected} onSelect={onSelect} name="Analytical balance">
        <mesh position={[0, 0.2, 0]} castShadow name="BalanceBody">
          <boxGeometry args={[1.0, 0.4, 0.8]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.4} />
        </mesh>
        {/* Draft-shield glass */}
        <mesh position={[0, 0.75, 0]} name="BalanceChamber">
          <boxGeometry args={[0.9, 0.7, 0.7]} />
          <meshPhysicalMaterial color="#e2e8f0" transparent opacity={0.22} roughness={0.05} />
        </mesh>
        {/* Pan */}
        <mesh position={[0, 0.48, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 0.04, 24]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.3} metalness={0.6} />
        </mesh>
        {hasBeaker ? (
          <mesh position={[0, 0.62, 0]}>
            <cylinderGeometry args={[0.2, 0.18, 0.24, 20, 1, true]} />
            <meshPhysicalMaterial
              color="#e2e8f0"
              transparent
              opacity={0.4}
              roughness={0.05}
              side={THREE.DoubleSide}
            />
          </mesh>
        ) : null}
        {/* Display: DOM overlay showing the public mass */}
        <Html position={[0, 0.28, 0.42]} center distanceFactor={6} occlude>
          <div
            aria-hidden="true"
            style={{
              background: "#0f172a",
              color: "#4ade80",
              fontFamily: "monospace",
              fontSize: 13,
              padding: "3px 10px",
              borderRadius: 4,
              whiteSpace: "nowrap",
            }}
          >
            {displayText} g
          </div>
        </Html>
      </Selectable3DObject>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Measuring cylinder with liquid level
// ---------------------------------------------------------------------------

export function MeasuringCylinder3D({
  position,
  volumeMl,
  capacityMl,
  selected,
  onSelect,
}: {
  position: [number, number, number];
  volumeMl: number;
  capacityMl: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const h = straightWallLiquidHeight(volumeMl, { bottomY: 0, heightUnits: 1.5, capacityMl });
  return (
    <group position={position}>
      <Selectable3DObject
        selected={selected}
        onSelect={onSelect}
        name={`Measuring cylinder, ${capacityMl} mL`}
      >
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.3, 0.34, 0.12, 20]} />
          <meshStandardMaterial color="#475569" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.87, 0]} castShadow name="CylinderTube">
          <cylinderGeometry args={[0.2, 0.2, 1.5, 20, 1, true]} />
          <meshPhysicalMaterial
            color="#e2e8f0"
            transparent
            opacity={0.3}
            roughness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
        {h > 0.001 ? (
          <mesh position={[0, 0.12 + h / 2, 0]}>
            <cylinderGeometry args={[0.175, 0.175, h, 20]} />
            <meshPhysicalMaterial color="#bfdbfe" transparent opacity={0.6} roughness={0.15} />
          </mesh>
        ) : null}
        {/* Spout */}
        <mesh position={[0.2, 1.65, 0]} rotation={[0, 0, -0.5]}>
          <coneGeometry args={[0.06, 0.18, 12, 1, true]} />
          <meshPhysicalMaterial color="#e2e8f0" transparent opacity={0.35} roughness={0.05} />
        </mesh>
      </Selectable3DObject>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Reagent bottles (stock, working titrant, indicator dropper, analyte, wash)
// ---------------------------------------------------------------------------

export function ReagentBottle3D({
  position,
  label,
  sublabel,
  colorHex,
  kind,
  fillFraction,
  selected,
  onSelect,
}: {
  position: [number, number, number];
  label: string;
  sublabel: string;
  colorHex: string;
  kind: "bottle" | "dropper" | "wash";
  fillFraction: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const fillH = Math.max(0, Math.min(1, fillFraction)) * 0.62;
  return (
    <group position={position}>
      <Selectable3DObject selected={selected} onSelect={onSelect} name={`Reagent bottle: ${label}`}>
        <mesh position={[0, 0.4, 0]} castShadow>
          <boxGeometry args={[0.5, 0.8, 0.5]} />
          <meshPhysicalMaterial
            color="#f1f5f9"
            transparent
            opacity={kind === "wash" ? 0.85 : 0.45}
            roughness={0.15}
          />
        </mesh>
        {fillH > 0.01 ? (
          <mesh position={[0, 0.1 + fillH / 2, 0]}>
            <boxGeometry args={[0.42, fillH, 0.42]} />
            <meshStandardMaterial color={colorHex} transparent opacity={0.75} roughness={0.3} />
          </mesh>
        ) : null}
        {kind === "dropper" ? (
          <group position={[0, 0.95, 0]}>
            <mesh>
              <cylinderGeometry args={[0.05, 0.05, 0.3, 12]} />
              <meshStandardMaterial color="#1f2937" roughness={0.4} />
            </mesh>
            <mesh position={[0, 0.2, 0]}>
              <sphereGeometry args={[0.07, 12, 12]} />
              <meshStandardMaterial color="#1f2937" roughness={0.5} />
            </mesh>
          </group>
        ) : (
          <mesh position={[0, 0.88, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.16, 14]} />
            <meshStandardMaterial
              color={kind === "wash" ? "#0ea5e9" : "#475569"}
              roughness={0.4}
            />
          </mesh>
        )}
        <Html position={[0, 0.42, 0.26]} center distanceFactor={7}>
          <div
            aria-hidden="true"
            style={{
              background: "rgba(255,255,255,0.92)",
              border: "1px solid #cbd5e1",
              borderRadius: 3,
              fontSize: 10,
              padding: "1px 6px",
              whiteSpace: "nowrap",
              textAlign: "center",
            }}
          >
            <div style={{ fontWeight: 700 }}>{label}</div>
            <div style={{ color: "#64748b" }}>{sublabel}</div>
          </div>
        </Html>
      </Selectable3DObject>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Glass stirring rod (selectable; spins while the stir action runs)
// ---------------------------------------------------------------------------

export function GlassRod3D({
  position,
  stirring,
  selected,
  onSelect,
}: {
  position: [number, number, number];
  stirring: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const rod = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!rod.current) return;
    rod.current.rotation.y = stirring ? clock.elapsedTime * 7 : 0;
    rod.current.position.y = position[1] + (stirring ? Math.sin(clock.elapsedTime * 7) * 0.03 : 0);
  });
  return (
    <group position={position}>
      <Selectable3DObject selected={selected} onSelect={onSelect} name="Glass stirring rod">
        <group ref={rod}>
          <mesh rotation={[0, 0, Math.PI / 2.2]} castShadow>
            <cylinderGeometry args={[0.035, 0.035, 1.1, 12]} />
            <meshPhysicalMaterial color="#e2e8f0" transparent opacity={0.5} roughness={0.05} />
          </mesh>
        </group>
      </Selectable3DObject>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Waste container (fill grows with discarded trials — persisted counts only)
// ---------------------------------------------------------------------------

export function WasteContainer3D({
  position,
  discardedCount,
  selected,
  onSelect,
}: {
  position: [number, number, number];
  discardedCount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const fillH = Math.min(0.7, discardedCount * 0.12);
  return (
    <group position={position}>
      <Selectable3DObject selected={selected} onSelect={onSelect} name="Waste container">
        <mesh position={[0, 0.45, 0]} castShadow>
          <cylinderGeometry args={[0.34, 0.28, 0.9, 20, 1, true]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
        {fillH > 0.01 ? (
          <mesh position={[0, 0.05 + fillH / 2, 0]}>
            <cylinderGeometry args={[0.28, 0.26, fillH, 20]} />
            <meshStandardMaterial color="#92400e" transparent opacity={0.7} roughness={0.4} />
          </mesh>
        ) : null}
        <Html position={[0, 1.05, 0]} center distanceFactor={7}>
          <div
            aria-hidden="true"
            style={{
              background: "#451a03",
              color: "#fde68a",
              fontSize: 10,
              fontWeight: 700,
              padding: "1px 8px",
              borderRadius: 3,
              whiteSpace: "nowrap",
            }}
          >
            WASTE{discardedCount > 0 ? ` · ${discardedCount}` : ""}
          </div>
        </Html>
      </Selectable3DObject>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Volumetric flask (reserve ware for the procedure)
// ---------------------------------------------------------------------------

export function VolumetricFlask3D({
  position,
  selected,
  onSelect,
}: {
  position: [number, number, number];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <group position={position}>
      <Selectable3DObject selected={selected} onSelect={onSelect} name="Volumetric flask">
        <mesh position={[0, 0.28, 0]} castShadow>
          <sphereGeometry args={[0.3, 20, 16]} />
          <meshPhysicalMaterial
            color="#e2e8f0"
            transparent
            opacity={0.3}
            roughness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 0.72, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.6, 14, 1, true]} />
          <meshPhysicalMaterial
            color="#e2e8f0"
            transparent
            opacity={0.3}
            roughness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
      </Selectable3DObject>
    </group>
  );
}
