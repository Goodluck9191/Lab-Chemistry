"use client";

import { Component, Suspense, lazy, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LabLighting } from "./LabLighting";
import { LabEnvironment } from "./LabEnvironment";
import { CameraRig } from "./CameraRig";
import { Burette3D } from "./apparatus/Burette3D";
import { Flask3D } from "./apparatus/Flask3D";
import {
  Balance3D,
  Beaker3D,
  GlassRod3D,
  MeasuringCylinder3D,
  ReagentBottle3D,
  RubberStopper3D,
  VolumetricFlask3D,
  WatchGlass3D,
  WasteContainer3D,
} from "./apparatus/Vessels3D";
import { LiquidStream3D, IndicatorBurst3D, HeldPourStream3D } from "./liquids";
import { PlacementZone3D, GuideMarker3D } from "./interactions";
import { lookCandidates, lookTargetFor } from "./interactions/lookTarget";
import { dropPointInFront, type HoldableKind } from "./interactions/carry";
import type { HoldPose } from "./interactions/hold";
import {
  FIXED_SLOTS,
  type ApparatusFocusKey,
  type PhysicalSelectionKey,
} from "./simulation/apparatus-state";
import {
  BURETTE_TIP,
  FLASK_MOUTH_UNDER_BURETTE_Y,
  PLACEMENT_ZONES,
  type BenchPoint,
} from "./simulation/spatial";
import { previewBuretteReadingMl, previewFlaskVolumeMl } from "./simulation/fluidTransfer";

/**
 * The 3D laboratory scene.
 *
 * Data flows ONE way: LabBench3D derives plain props from the authoritative
 * public state (view model) and passes them in. The scene positions meshes from
 * those props and reports interactions (look / select / drag / turn the valve)
 * back up through callbacks, which route into the EXISTING action protocol —
 * the scene never touches Supabase, the engine or hidden values.
 */

export interface Reagent3DView {
  key: string;
  label: string;
  sublabel: string;
  colorHex: string;
  kind: "bottle" | "dropper" | "wash";
  fillFraction: number;
}

export interface Lab3DSceneProps {
  burette: { readingMl: number | null; capacityMl: number; graduationMl: number };
  /** Stopcock handle angle: 0 shut, 90 fully open. Intermediate values pass less. */
  stopcockAngleDeg: number;
  stopcockInteractive: boolean;
  /** True while the student is dragging the handle (suspends orbiting). */
  valveDragging: boolean;
  onValveAngle: (angleDeg: number) => void;
  onValveDragChange: (dragging: boolean) => void;
  /** Air trapped in the tip: drawn until the student expels it. */
  airBubble: boolean;
  /** Brief rinse pour overlay right after a rinse/conditioning action. */
  rinseFlash: boolean;
  /** Brief indicator droplet burst right after adding the indicator. */
  indicatorBurst: boolean;
  /** Brief highlight on the waste container right after a disposal. */
  wastePulse: boolean;
  /** Open path on a live trial (valve open + open trial + setup). */
  flowing: boolean;
  dropwise: boolean;
  /** Unconfirmed pour volume accumulated while the valve stands open. */
  previewDeliveredMl: number;
  flask: { volumeMl: number; colour: string | null; hasContents: boolean };
  flaskPos: BenchPoint;
  swirling: boolean;
  swirlPhase: number;
  balance: { displayText: string; hasBeaker: boolean };
  cylinder: { volumeMl: number; capacityMl: number } | null;
  beaker: { liquidMl: number; khpState: "solid" | "dissolving" | "dissolved" | "none" };
  /** Physical beaker position on the bench (set down or resting slot). */
  beakerPos: BenchPoint;
  wasteDiscarded: number;
  reagents: Reagent3DView[];
  selection: PhysicalSelectionKey;
  /** What the crosshair is on right now — highlighted like a selection. */
  lookedAt: PhysicalSelectionKey;
  focus: ApparatusFocusKey;
  readingMode: boolean;
  dragEnabled: boolean;
  stirring: boolean;
  /** Object physically in the student's hand, or null. */
  carriedKind: HoldableKind | null;
  /** How the carried object is turned in the hand. */
  carriedYawRadians: number;
  /** How far the carried object is tipped out of the hand (how it pours). */
  carriedTilt: number;
  /** True while the held object is tipped far enough to be pouring. */
  pouring: boolean;
  /** Receiving-zone highlight while placing. */
  zoneState: "idle" | "valid" | "invalid";
  /** WASD walking plus mouse-look; off leaves free orbit. */
  moveEnabled: boolean;
  /** Subtle task marker target (from the current procedure step), if any. */
  guideKey: PhysicalSelectionKey;
  /** Rapier collision layer (bench contact + zone sensor). Off degrades to math-only validation. */
  physicsEnabled: boolean;
  /** Fired by the Rapier zone sensor; confirms `spatial.ts`, never gates UX. */
  onPhysicsZone: (inside: boolean) => void;
  /** Fired when the crosshair enters a new object, or the landing spot moves. */
  onLookChange: (key: PhysicalSelectionKey, dropPoint: BenchPoint) => void;
  /** Whether the browser captured the pointer for mouse-look. */
  onPointerLockChange: (locked: boolean) => void;
  onSelectApparatus: (key: Exclude<PhysicalSelectionKey, null>) => void;
  onSelectReagent: (key: string) => void;
  onFlaskDrop: (point: BenchPoint) => void;
  onBeakerDrop: (point: BenchPoint) => void;
}

const SHELF_Y = 2.56;
const SHELF_Z = -2.9;

/** Lazy so the WASM physics engine never blocks (or breaks) scene load. */
const PhysicsZones = lazy(() =>
  import("./LabPhysics").then((module) => ({ default: module.PhysicsZones })),
);

/** A Rapier failure degrades to math-only validation — never a blank canvas. */
class PhysicsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The crosshair's senses.
 *
 * Once per frame it asks the pure `lookTargetFor` what the camera is pointing
 * at, and where a carried vessel would land. Only a CHANGE is reported upward,
 * so walking the laboratory never re-renders the React tree — the prompt moves
 * when the student's attention moves, and not otherwise.
 */
function LookSensor({
  flaskPos,
  onLookChange,
}: {
  flaskPos: BenchPoint;
  onLookChange: (key: PhysicalSelectionKey, dropPoint: BenchPoint) => void;
}) {
  const camera = useThree((state) => state.camera);
  const lastKey = useRef<PhysicalSelectionKey | undefined>(undefined);
  const lastPoint = useRef<BenchPoint>({ x: Number.NaN, z: Number.NaN });
  // Where the flask could be is a pure function of where it is, so it is
  // derived during render and the refs below stay strictly "inside a frame"
  // work.
  const candidates = lookCandidates(flaskPos);

  useFrame(() => {
    const origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const direction = camera.getWorldDirection(new THREE.Vector3());

    const key = lookTargetFor({ origin, direction, candidates });
    const dropPoint = dropPointInFront({ origin, direction });
    const moved =
      Math.hypot(dropPoint.x - lastPoint.current.x, dropPoint.z - lastPoint.current.z) > 0.06;
    const first = lastKey.current === undefined;
    if (first || key !== lastKey.current || moved) {
      lastKey.current = key;
      lastPoint.current = dropPoint;
      onLookChange(key, dropPoint);
    }
  });

  return null;
}

export function Lab3DSceneContent(props: Lab3DSceneProps) {
  const {
    burette,
    stopcockAngleDeg,
    stopcockInteractive,
    valveDragging,
    onValveAngle,
    onValveDragChange,
    airBubble,
    rinseFlash,
    indicatorBurst,
    wastePulse,
    flowing,
    dropwise,
    previewDeliveredMl,
    flask,
    flaskPos,
    swirling,
    swirlPhase,
    balance,
    cylinder,
    beaker,
    beakerPos,
    wasteDiscarded,
    reagents,
    selection,
    lookedAt,
    focus,
    readingMode,
    dragEnabled,
    stirring,
    carriedKind,
    carriedYawRadians,
    carriedTilt,
    pouring,
    zoneState,
    moveEnabled,
    guideKey,
    physicsEnabled,
    onPhysicsZone,
    onLookChange,
    onPointerLockChange,
    onSelectApparatus,
    onSelectReagent,
    onFlaskDrop,
    onBeakerDrop,
  } = props;

  // Pour preview: the meniscus glides while the valve stands open; the server's
  // reading replaces it the moment the pour is confirmed.
  const shownReading = previewBuretteReadingMl({
    serverReadingMl: burette.readingMl,
    accumulatedMl: previewDeliveredMl,
    capacityMl: burette.capacityMl,
  });
  const shownFlaskVolume = previewFlaskVolumeMl({
    serverVolumeMl: flask.volumeMl,
    accumulatedMl: previewDeliveredMl,
    graduationMl: burette.graduationMl,
  });

  const flaskHighlighted = selection === "conical_flask" || lookedAt === "conical_flask";
  const beakerHighlighted = selection === "beaker_250" || lookedAt === "beaker_250";

  return (
    <>
      <LabLighting />
      <LabEnvironment />
      <CameraRig
        focus={focus}
        readingMode={readingMode}
        moveEnabled={moveEnabled}
        suspended={valveDragging}
        onPointerLockChange={onPointerLockChange}
      />
      <LookSensor flaskPos={flaskPos} onLookChange={onLookChange} />

      <Burette3D
        readingMl={shownReading}
        capacityMl={burette.capacityMl}
        stopcockAngleDeg={stopcockAngleDeg}
        stopcockInteractive={stopcockInteractive}
        meniscusHighlighted={readingMode}
        selected={selection === "burette" || lookedAt === "burette"}
        onSelect={() => onSelectApparatus("burette")}
        onValveAngle={onValveAngle}
        onValveDragChange={onValveDragChange}
        airBubble={airBubble}
        rinseFlash={rinseFlash}
      />

      <Flask3D
        flaskPos={flaskPos}
        volumeMl={shownFlaskVolume}
        colour={flask.colour}
        swirling={swirling}
        swirlPhase={swirlPhase}
        hasContents={flask.hasContents}
        selected={flaskHighlighted}
        dragEnabled={dragEnabled && carriedKind === null}
        heldInHand={carriedKind === "flask"}
        heldYawRadians={carriedYawRadians}
        heldTiltRadians={carriedTilt}
        onSelect={() => onSelectApparatus("conical_flask")}
        onDrop={onFlaskDrop}
      />

      {/* The held vessel's own stream: it leaves the glass where the glass
          actually is, and only while the student is tipping it. */}
      <HeldPourStream3D
        active={pouring && carriedKind !== null}
        pose={{ yawRadians: carriedYawRadians, tiltRadians: carriedTilt } satisfies HoldPose}
      />

      <LiquidStream3D
        flowing={flowing}
        dropwise={dropwise}
        flaskPos={{ x: flaskPos.x, z: flaskPos.z }}
      />

      <IndicatorBurst3D
        active={indicatorBurst}
        flaskPos={{ x: flaskPos.x, z: flaskPos.z }}
        mouthY={FLASK_MOUTH_UNDER_BURETTE_Y}
      />

      {wastePulse ? (
        <mesh
          position={[FIXED_SLOTS.waste.x, 0.05, FIXED_SLOTS.waste.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.55, 0.7, 40]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.85} depthWrite={false} />
        </mesh>
      ) : null}

      <PlacementZone3D zone={PLACEMENT_ZONES.buretteReceiving} state={zoneState} />
      <GuideMarker3D guideKey={carriedKind === null ? guideKey : null} flaskPos={flaskPos} />

      {physicsEnabled ? (
        <PhysicsBoundary>
          <Suspense fallback={null}>
            <PhysicsZones flaskPos={flaskPos} onReceivingZone={onPhysicsZone} />
          </Suspense>
        </PhysicsBoundary>
      ) : null}

      <Balance3D
        position={[FIXED_SLOTS.balance.x, 0, FIXED_SLOTS.balance.z]}
        displayText={balance.displayText}
        hasBeaker={balance.hasBeaker}
        selected={selection === "analytical_balance" || lookedAt === "analytical_balance"}
        onSelect={() => onSelectApparatus("analytical_balance")}
      />

      {cylinder ? (
        <MeasuringCylinder3D
          position={[FIXED_SLOTS.cylinder.x, 0, FIXED_SLOTS.cylinder.z]}
          volumeMl={cylinder.volumeMl}
          capacityMl={cylinder.capacityMl}
          selected={selection === "graduated_cylinder" || lookedAt === "graduated_cylinder"}
          onSelect={() => onSelectApparatus("graduated_cylinder")}
        />
      ) : null}

      <Beaker3D
        position={[beakerPos.x, 0, beakerPos.z]}
        liquidMl={beaker.liquidMl}
        khpState={beaker.khpState}
        selected={beakerHighlighted}
        onSelect={() => onSelectApparatus("beaker_250")}
        dragEnabled={dragEnabled && carriedKind === null}
        heldInHand={carriedKind === "beaker"}
        heldYawRadians={carriedYawRadians}
        heldTiltRadians={carriedTilt}
        onDrop={onBeakerDrop}
      />

      <GlassRod3D
        position={[1.0, 0.35, 1.35]}
        stirring={stirring}
        selected={selection === "glass_rod" || lookedAt === "glass_rod"}
        onSelect={() => onSelectApparatus("glass_rod")}
      />

      {/* The manual's own ware: a watch glass over the beaker while it holds
          solution, and a stopper for the swirl-and-mix step. */}
      <WatchGlass3D
        position={[beakerPos.x, 0, beakerPos.z]}
        covering={beaker.liquidMl > 1}
        selected={false}
        onSelect={() => onSelectApparatus("beaker_250")}
      />
      <RubberStopper3D
        position={[-3.15, 0, 1.05]}
        selected={false}
        onSelect={() => onSelectApparatus("volumetric_flask")}
      />

      <VolumetricFlask3D
        position={[-3.7, 0, 1.3]}
        selected={selection === "volumetric_flask" || lookedAt === "volumetric_flask"}
        onSelect={() => onSelectApparatus("volumetric_flask")}
      />

      <WasteContainer3D
        position={[FIXED_SLOTS.waste.x, 0, FIXED_SLOTS.waste.z]}
        discardedCount={wasteDiscarded}
        selected={selection === "waste_container" || lookedAt === "waste_container"}
        onSelect={() => onSelectApparatus("waste_container")}
      />

      {/* Reagent shelf */}
      {reagents.map((reagent, index) => (
        <ReagentBottle3D
          key={reagent.key}
          position={[-0.2 + index * 1.05, SHELF_Y, SHELF_Z]}
          label={reagent.label}
          sublabel={reagent.sublabel}
          colorHex={reagent.colorHex}
          kind={reagent.kind}
          fillFraction={reagent.fillFraction}
          selected={selection === "reagent_bottle"}
          onSelect={() => onSelectReagent(reagent.key)}
        />
      ))}
      {/* Burette tip marker for stream alignment debugging (invisible in normal use) */}
      <mesh position={[BURETTE_TIP.x, 0.02, BURETTE_TIP.z]} visible={false}>
        <sphereGeometry args={[0.05, 8, 8]} />
      </mesh>
    </>
  );
}

export function Lab3DCanvas(props: Lab3DSceneProps) {
  return (
    <Canvas
      // Shadow type is named rather than left as `shadows`: the boolean form
      // asks three for PCFSoftShadowMap, which three r186 removed, so it warns
      // on every scene and silently falls back to this anyway.
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: [0.4, 1.62, 4.4], fov: 60 }}
      aria-label="3D virtual chemistry laboratory"
    >
      <Suspense fallback={null}>
        <Lab3DSceneContent {...props} />
      </Suspense>
    </Canvas>
  );
}
