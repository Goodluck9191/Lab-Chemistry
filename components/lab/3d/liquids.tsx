"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  BURETTE_TIP,
  BURETTE_TIP_Y,
  FLASK_MOUTH_UNDER_BURETTE_Y,
} from "./simulation/spatial";
import { pourOriginPoint, type HoldPose } from "./interactions/hold";
import { dropPointInFront } from "./interactions/carry";

/**
 * Liquid visuals: burette column + meniscus, flask fill, falling stream.
 *
 * All levels are derived from the props the scene passes down — which are
 * themselves derived from the server's public state (plus the unconfirmed pour
 * preview). These components position meshes; they never compute chemistry.
 */

export function BuretteLiquid({
  surfaceY,
  tubeBottomY,
  tubeRadius,
  tubeCenterX,
  highlighted,
}: {
  /** Y of the meniscus, or null when the burette is unfilled. */
  surfaceY: number | null;
  tubeBottomY: number;
  tubeRadius: number;
  tubeCenterX: number;
  /** Reading Mode: meniscus glows so it can be inspected closely. */
  highlighted: boolean;
}) {
  if (surfaceY === null) return null;
  const height = Math.max(0.001, tubeBottomY - surfaceY);
  const midY = surfaceY + height / 2;
  return (
    <group>
      <mesh position={[tubeCenterX, midY, 0]}>
        <cylinderGeometry args={[tubeRadius, tubeRadius, height, 24]} />
        <meshPhysicalMaterial
          color="#bfdbfe"
          transparent
          opacity={0.55}
          roughness={0.05}
          metalness={0}
        />
      </mesh>
      {/* Meniscus: the bottom of the curve is what the student reads */}
      <mesh position={[tubeCenterX, surfaceY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[tubeRadius * 0.92, 0.022, 12, 32]} />
        <meshBasicMaterial color={highlighted ? "#1d4ed8" : "#334155"} />
      </mesh>
      <mesh position={[tubeCenterX, surfaceY - 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[tubeRadius * 0.92, 32]} />
        <meshBasicMaterial
          color={highlighted ? "#3b82f6" : "#64748b"}
          transparent
          opacity={highlighted ? 0.9 : 0.55}
        />
      </mesh>
      {highlighted ? (
        <pointLight position={[tubeCenterX, surfaceY + 0.25, 0.5]} intensity={0.6} color="#93c5fd" />
      ) : null}
    </group>
  );
}

export function FlaskLiquid({
  heightUnits,
  baseRadius,
  neckRadius,
  coneHeight,
  colorHex,
  opacity,
  swirlPhase,
}: {
  heightUnits: number;
  baseRadius: number;
  neckRadius: number;
  coneHeight: number;
  colorHex: string;
  opacity: number;
  /** 0 when at rest; advances while the student swirls. Visual only. */
  swirlPhase: number;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!group.current) return;
    // Gentle slosh while swirling; settled otherwise. No fluid dynamics —
    // a deterministic tilt oscillation the eye reads as agitation.
    const active = swirlPhase > 0;
    group.current.rotation.z = active ? Math.sin(swirlPhase * 6) * 0.06 : 0;
    group.current.rotation.x = active ? Math.cos(swirlPhase * 5) * 0.04 : 0;
  });
  if (heightUnits <= 0.001) return null;
  const t = Math.max(0, Math.min(1, heightUnits / coneHeight));
  const surfaceRadius = Math.max(0.02, baseRadius + (neckRadius - baseRadius) * t);
  return (
    <group ref={group}>
      {/* Fill: a cone frustum widening with height, meeting the glass wall */}
      <mesh position={[0, heightUnits / 2, 0]}>
        <cylinderGeometry
          args={[surfaceRadius * 0.94, baseRadius * 0.9, Math.max(0.01, heightUnits), 28]}
        />
        <meshPhysicalMaterial
          color={colorHex}
          transparent
          opacity={opacity}
          roughness={0.15}
          metalness={0}
        />
      </mesh>
      <mesh position={[0, heightUnits, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[surfaceRadius * 0.94, 28]} />
        <meshBasicMaterial color={colorHex} transparent opacity={Math.min(1, opacity + 0.15)} />
      </mesh>
    </group>
  );
}

/**
 * Indicator droplet burst: three phenolphthalein drops falling from the
 * dropper into the flask mouth right after the student adds the indicator.
 * Rendered briefly (the caller owns the timer); deterministic phase offsets.
 */
export function IndicatorBurst3D({
  active,
  flaskPos,
  mouthY,
}: {
  active: boolean;
  flaskPos: { x: number; z: number };
  mouthY: number;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    group.current.children.forEach((child, index) => {
      const phase = ((t * 1.4 + index * 0.33) % 1 + 1) % 1;
      child.position.set(flaskPos.x, mouthY + 0.9 - phase * 0.9, flaskPos.z);
      child.scale.setScalar(0.04);
    });
  });
  if (!active) return null;
  return (
    <group ref={group}>
      {[0, 1, 2].map((i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 10, 10]} />
          <meshBasicMaterial color="#f472b6" transparent opacity={0.95} />
        </mesh>
      ))}
    </group>
  );
}
/**
 * The falling stream from burette tip to flask mouth, with deterministic
 * droplets. Droplet i falls with a fixed phase offset — no random positions:
 * the stream always connects the actual tip to the actual receiving flask.
 */
export function LiquidStream3D({
  flowing,
  dropwise,
  flaskPos,
}: {
  flowing: boolean;
  /** Dropwise mode: isolated drips instead of a continuous thread. */
  dropwise: boolean;
  /** Bench position of the receiving flask mouth. */
  flaskPos: { x: number; z: number };
}) {
  const drops = useMemo(() => [0, 1, 2, 3], []);
  const group = useRef<THREE.Group>(null);
  const tipX = BURETTE_TIP.x;
  const tipZ = BURETTE_TIP.z;
  const mouthX = flaskPos.x;
  const mouthZ = flaskPos.z;

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    group.current.children.forEach((child, index) => {
      // Each droplet cycles tip → mouth on a fixed loop.
      const span = BURETTE_TIP_Y - FLASK_MOUTH_UNDER_BURETTE_Y;
      const phase = ((t * (dropwise ? 0.9 : 2.2) + index * 0.25) % 1 + 1) % 1;
      child.position.set(
        tipX + (mouthX - tipX) * phase,
        BURETTE_TIP_Y - span * phase,
        tipZ + (mouthZ - tipZ) * phase,
      );
      const s = dropwise ? 1 : 0.8 + phase * 0.5;
      child.scale.setScalar(0.045 * s);
    });
  });

  if (!flowing) return null;
  return (
    <group>
      {/* Continuous thread in fast/steady modes */}
      {!dropwise ? (
        <mesh
          position={[
            (tipX + mouthX) / 2,
            (BURETTE_TIP_Y + FLASK_MOUTH_UNDER_BURETTE_Y) / 2,
            (tipZ + mouthZ) / 2,
          ]}
        >
          <cylinderGeometry
            args={[0.022, 0.03, BURETTE_TIP_Y - FLASK_MOUTH_UNDER_BURETTE_Y, 10]}
          />
          <meshBasicMaterial color="#93c5fd" transparent opacity={0.8} />
        </mesh>
      ) : null}
      <group ref={group}>
        {drops.map((i) => (
          <mesh key={i}>
            <sphereGeometry args={[1, 10, 10]} />
            <meshBasicMaterial color="#60a5fa" transparent opacity={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/**
 * The stream leaving a vessel the student is holding.
 *
 * It starts where the glass actually is: the mouth position comes from the same
 * `pourOriginPoint` the held mesh is drawn from, computed from the live camera
 * — so tipping the beaker swings its spout and the falling liquid follows,
 * rather than leaking from a fixed point in space. Droplets cycle mouth → aim,
 * deterministically, and it disappears the instant the vessel comes back
 * upright.
 */
export function HeldPourStream3D({
  active,
  pose,
  colour = "#93c5fd",
}: {
  active: boolean;
  /** The hand's pose: which way the vessel is tipped. */
  pose: HoldPose;
  colour?: string;
}) {
  const camera = useThree((state) => state.camera);
  const group = useRef<THREE.Group>(null);
  const thread = useRef<THREE.Mesh>(null);
  const mouth = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());
  const drops = useMemo(() => [0, 1, 2, 3, 4], []);

  useFrame(({ clock }) => {
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const origin = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    };
    const point = pourOriginPoint({
      origin,
      forward: { x: forward.x, y: forward.y, z: forward.z },
      pose,
    });
    mouth.current.set(point.x, point.y, point.z);
    // The stream falls to whatever the crosshair is over, computed live from
    // the camera rather than handed down — so pouring never re-renders React.
    const drop = dropPointInFront({
      origin,
      direction: { x: forward.x, y: forward.y, z: forward.z },
    });
    target.current.set(drop.x, 0.04, drop.z);

    if (thread.current) {
      const mid = mouth.current.clone().add(target.current).multiplyScalar(0.5);
      const length = mouth.current.distanceTo(target.current);
      thread.current.position.copy(mid);
      thread.current.scale.set(1, Math.max(0.001, length), 1);
      thread.current.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        target.current.clone().sub(mouth.current).normalize(),
      );
    }

    if (!group.current) return;
    const t = clock.elapsedTime;
    group.current.children.forEach((child, index) => {
      const phase = ((t * 1.6 + index * 0.2) % 1 + 1) % 1;
      child.position.set(
        mouth.current.x + (target.current.x - mouth.current.x) * phase,
        mouth.current.y + (target.current.y - mouth.current.y) * phase,
        mouth.current.z + (target.current.z - mouth.current.z) * phase,
      );
      child.scale.setScalar(0.05);
    });
  });

  if (!active) return null;
  return (
    <group>
      <mesh ref={thread}>
        <cylinderGeometry args={[0.02, 0.02, 1, 8]} />
        <meshBasicMaterial color={colour} transparent opacity={0.75} />
      </mesh>
      <group ref={group}>
        {drops.map((i) => (
          <mesh key={i}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color={colour} transparent opacity={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
