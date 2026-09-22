"use client";

import { Component, Suspense, lazy, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
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
  VolumetricFlask3D,
  WasteContainer3D,
} from "./apparatus/Vessels3D";
import { LiquidStream3D } from "./liquids";
import { PlacementZone3D } from "./interactions";
import { FIXED_SLOTS, type ApparatusFocusKey, type PhysicalSelectionKey } from "./simulation/apparatus-state";
import { BURETTE_TIP, PLACEMENT_ZONES, type BenchPoint } from "./simulation/spatial";
import { previewBuretteReadingMl, previewFlaskVolumeMl } from "./simulation/fluidTransfer";

/**
 * The 3D laboratory scene.
 *
 * Data flows ONE way: LabBench3D derives plain props from the authoritative
 * public state (view model) and passes them in. The scene positions meshes
 * from those props and reports interactions (select / toggle / drop) back up
 * through callbacks, which route into the EXISTING action protocol — the
 * scene never touches Supabase, the engine or hidden values.
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
  stopcockOpen: boolean;
  stopcockInteractive: boolean;
  /** Open path on a live trial (stopcock + open trial + setup). */
  flowing: boolean;
  dropwise: boolean;
  /** Unconfirmed pour volume accumulated while the stopcock stands open. */
  previewDeliveredMl: number;
  flask: { volumeMl: number; colour: string | null; hasContents: boolean };
  flaskPos: BenchPoint;
  swirling: boolean;
  swirlPhase: number;
  balance: { displayText: string; hasBeaker: boolean };
  cylinder: { volumeMl: number; capacityMl: number } | null;
  beaker: { liquidMl: number; khpState: "solid" | "dissolving" | "dissolved" | "none" };
  wasteDiscarded: number;
  reagents: Reagent3DView[];
  selection: PhysicalSelectionKey;
  focus: ApparatusFocusKey;
  readingMode: boolean;
  resetSignal: number;
  dragEnabled: boolean;
  stirring: boolean;
  /** Receiving-zone highlight while placing. */
  zoneState: "idle" | "valid" | "invalid";
  /** Rapier collision layer (bench contact + zone sensor). Off degrades to math-only validation. */
  physicsEnabled: boolean;
  /** Fired by the Rapier zone sensor; confirms `spatial.ts`, never gates UX. */
  onPhysicsZone: (inside: boolean) => void;
  onSelectApparatus: (key: Exclude<PhysicalSelectionKey, null>) => void;
  onSelectReagent: (key: string) => void;
  onToggleStopcock: () => void;
  onFlaskDrop: (point: BenchPoint) => void;
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

export function Lab3DSceneContent(props: Lab3DSceneProps) {
  const {
    burette,
    stopcockOpen,
    stopcockInteractive,
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
    wasteDiscarded,
    reagents,
    selection,
    focus,
    readingMode,
    resetSignal,
    dragEnabled,
    stirring,
    zoneState,
    physicsEnabled,
    onPhysicsZone,
    onSelectApparatus,
    onSelectReagent,
    onToggleStopcock,
    onFlaskDrop,
  } = props;

  // Pour preview: the meniscus glides while the stopcock stands open; the
  // server's reading replaces it the moment the pour is confirmed.
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

  return (
    <>
      <LabLighting />
      <LabEnvironment />
      <CameraRig focus={focus} readingMode={readingMode} resetSignal={resetSignal} />

      <Burette3D
        readingMl={shownReading}
        capacityMl={burette.capacityMl}
        stopcockOpen={stopcockOpen}
        stopcockInteractive={stopcockInteractive}
        meniscusHighlighted={readingMode}
        selected={selection === "burette"}
        onSelect={() => onSelectApparatus("burette")}
        onToggleStopcock={onToggleStopcock}
      />

      <Flask3D
        flaskPos={flaskPos}
        volumeMl={shownFlaskVolume}
        colour={flask.colour}
        swirling={swirling}
        swirlPhase={swirlPhase}
        hasContents={flask.hasContents}
        selected={selection === "conical_flask"}
        dragEnabled={dragEnabled}
        onSelect={() => onSelectApparatus("conical_flask")}
        onDrop={onFlaskDrop}
      />

      <LiquidStream3D
        flowing={flowing}
        dropwise={dropwise}
        flaskPos={{ x: flaskPos.x, z: flaskPos.z }}
      />

      <PlacementZone3D zone={PLACEMENT_ZONES.buretteReceiving} state={zoneState} />

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
        selected={selection === "analytical_balance"}
        onSelect={() => onSelectApparatus("analytical_balance")}
      />

      {cylinder ? (
        <MeasuringCylinder3D
          position={[FIXED_SLOTS.cylinder.x, 0, FIXED_SLOTS.cylinder.z]}
          volumeMl={cylinder.volumeMl}
          capacityMl={cylinder.capacityMl}
          selected={selection === "graduated_cylinder"}
          onSelect={() => onSelectApparatus("graduated_cylinder")}
        />
      ) : null}

      <Beaker3D
        position={[FIXED_SLOTS.beaker.x, 0, FIXED_SLOTS.beaker.z]}
        liquidMl={beaker.liquidMl}
        khpState={beaker.khpState}
        selected={selection === "beaker_250"}
        onSelect={() => onSelectApparatus("beaker_250")}
      />

      <GlassRod3D
        position={[1.0, 0.35, 1.35]}
        stirring={stirring}
        selected={selection === "glass_rod"}
        onSelect={() => onSelectApparatus("glass_rod")}
      />

      <VolumetricFlask3D
        position={[-3.7, 0, 1.3]}
        selected={selection === "volumetric_flask"}
        onSelect={() => onSelectApparatus("volumetric_flask")}
      />

      <WasteContainer3D
        position={[FIXED_SLOTS.waste.x, 0, FIXED_SLOTS.waste.z]}
        discardedCount={wasteDiscarded}
        selected={selection === "waste_container"}
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
      shadows
      dpr={[1, 2]}
      camera={{ position: [0.4, 4.4, 8.6], fov: 45 }}
      aria-label="3D virtual chemistry laboratory"
    >
      <Suspense fallback={null}>
        <Lab3DSceneContent {...props} />
      </Suspense>
    </Canvas>
  );
}
