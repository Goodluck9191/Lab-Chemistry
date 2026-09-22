"use client";

import { useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  clampToBench,
  flaskReceivingValid,
  snapFlaskOnDrop,
  type BenchPoint,
} from "../simulation/spatial";
import { flaskColourHex, flaskColourOpacity, flaskLiquidHeight } from "../simulation/volume-mapping";
import { FlaskLiquid } from "../liquids";
import { Selectable3DObject } from "../interactions";

/**
 * The 3D Erlenmeyer flask: cone body, neck, liquid, swirl, drag and carry.
 *
 * - Liquid level and colour come from public state (volume + observed colour).
 * - Two ways to move it. DRAGGING slides it across the bench under the pointer.
 *   CARRYING (`heldInHand`) lifts it off the bench into the student's view and
 *   keeps it in front of the camera while they walk, turn it with R, and set it
 *   down with Space. Both are physical positioning only; the authoritative
 *   `place_flask` still runs through the action protocol.
 * - Swirl: while `swirling` the whole flask rocks gently and the liquid sloshes
 *   (deterministic tilt, no fluid dynamics).
 */

export const FLASK_CONE_HEIGHT = 0.85;
export const FLASK_BASE_RADIUS = 0.42;
export const FLASK_NECK_RADIUS = 0.14;
const FLASK_CONE_CAPACITY_ML = 250;

/** How far in front of the eye a carried vessel rides, and how far below it. */
const CARRY_FORWARD_UNITS = 0.85;
const CARRY_DROP_UNITS = 0.42;

export function Flask3D({
  flaskPos,
  volumeMl,
  colour,
  swirling,
  swirlPhase,
  hasContents,
  selected,
  dragEnabled,
  heldInHand = false,
  heldYawRadians = 0,
  onSelect,
  onDrop,
}: {
  flaskPos: BenchPoint;
  /** Current flask contents volume (server state + pour preview), mL. */
  volumeMl: number;
  colour: string | null;
  swirling: boolean;
  /** Advancing clock value while swirling; frozen otherwise. */
  swirlPhase: number;
  hasContents: boolean;
  selected: boolean;
  dragEnabled: boolean;
  /** True while the flask is physically in the student's hand. */
  heldInHand?: boolean;
  /** How the carried flask is turned in the hand, radians. */
  heldYawRadians?: number;
  onSelect: () => void;
  onDrop: (point: BenchPoint) => void;
}) {
  const [dragPos, setDragPos] = useState<BenchPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const offset = useRef({ x: 0, z: 0 });
  const rock = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const yaw = useRef(0);

  const shown = dragPos ?? flaskPos;
  const liquidHeight = flaskLiquidHeight(volumeMl, {
    coneHeight: FLASK_CONE_HEIGHT,
    coneCapacityMl: FLASK_CONE_CAPACITY_ML,
  });

  useFrame((_, delta) => {
    // In the hand: ride in front of the eye, at a believable distance, turned
    // by the student. On the bench: sit exactly where the bench state says.
    if (root.current) {
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
        root.current.position.set(shown.x, 0, shown.z);
      }
      const targetYaw = heldInHand ? heldYawRadians : 0;
      yaw.current += (targetYaw - yaw.current) * Math.min(1, delta * 10);
      root.current.rotation.y = yaw.current;
    }
    if (!rock.current) return;
    const target = swirling && !dragging ? Math.sin(swirlPhase * 6) * 0.08 : 0;
    rock.current.rotation.z += (target - rock.current.rotation.z) * Math.min(1, delta * 8);
  });

  const beginDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!dragEnabled || heldInHand) return;
    event.stopPropagation();
    offset.current = { x: shown.x - event.point.x, z: shown.z - event.point.z };
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
    onDrop(snapFlaskOnDrop(dropped));
  };

  const receiving = flaskReceivingValid(shown);

  return (
    <group ref={root} position={[shown.x, 0, shown.z]}>
      <Selectable3DObject
        selected={selected}
        onSelect={onSelect}
        name={`Conical flask${hasContents ? ", contents visible" : ", empty"}`}
      >
        <group
          ref={rock}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        >
          {/* Cone body */}
          <mesh position={[0, FLASK_CONE_HEIGHT / 2, 0]} castShadow name="FlaskCone">
            <cylinderGeometry
              args={[FLASK_NECK_RADIUS, FLASK_BASE_RADIUS, FLASK_CONE_HEIGHT, 28, 1, true]}
            />
            <meshPhysicalMaterial
              color="#e2e8f0"
              transparent
              opacity={0.3}
              roughness={0.05}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Base */}
          <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[FLASK_BASE_RADIUS, 28]} />
            <meshPhysicalMaterial color="#e2e8f0" transparent opacity={0.4} roughness={0.1} />
          </mesh>
          {/* Neck */}
          <mesh position={[0, FLASK_CONE_HEIGHT + 0.18, 0]} name="FlaskNeck">
            <cylinderGeometry args={[FLASK_NECK_RADIUS, FLASK_NECK_RADIUS, 0.4, 20, 1, true]} />
            <meshPhysicalMaterial
              color="#e2e8f0"
              transparent
              opacity={0.3}
              roughness={0.05}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Rim */}
          <mesh position={[0, FLASK_CONE_HEIGHT + 0.38, 0]}>
            <torusGeometry args={[FLASK_NECK_RADIUS, 0.02, 10, 24]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.3} />
          </mesh>
          <FlaskLiquid
            heightUnits={liquidHeight}
            baseRadius={FLASK_BASE_RADIUS}
            neckRadius={FLASK_NECK_RADIUS}
            coneHeight={FLASK_CONE_HEIGHT}
            colorHex={flaskColourHex(colour)}
            opacity={flaskColourOpacity(colour)}
            swirlPhase={swirling ? swirlPhase : 0}
          />
        </group>
      </Selectable3DObject>
      {/* Receiving-zone hint while dragging */}
      {dragging ? (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.58, 36]} />
          <meshBasicMaterial
            color={receiving ? "#22c55e" : "#94a3b8"}
            transparent
            opacity={0.9}
            depthWrite={false}
          />
        </mesh>
      ) : null}
    </group>
  );
}
