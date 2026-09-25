"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { LabStateView } from "@/application/attempts/lab-state";
import { useActiveStage, useLabServer, useLabUi } from "./lab-state-provider";
import { stopcockAvailability, discardAvailability } from "./control-availability";
import {
  accumulateFlowTick,
  quantizeDeliveryMl,
  shouldStopFlow,
  type FlowMode,
} from "./3d/simulation/flow";
import { stopcockIsOpen, stopcockFlowModeFor, stopcockRateMlPerSecond } from "./3d/simulation/stopcock";
import { holdReleaseFor, type HoldableKind } from "./3d/interactions/carry";
import { isPourTilt } from "./3d/interactions/hold";
import { pourIntent, type PourTargets, type PourZone } from "./3d/interactions/pour";
import { titrationNeedsMount } from "./3d/interactions/mounting";
import { rinseBeakerAvailability, transferAvailability } from "./control-availability";
import {
  FLASK_TILE_SLOT,
  VOLUMETRIC_FLASK_SLOT,
  flaskReceivingValid,
  wastePlacementValid,
  type BenchPoint,
} from "./3d/simulation/spatial";
import {
  FIXED_SLOTS,
  guideTargetForNextAction,
  resolveFlaskPosition,
  type ApparatusFocusKey,
  type PhysicalSelectionKey,
} from "./3d/simulation/apparatus-state";
import type { Lab3DSceneProps } from "./3d/Lab3DScene";

/**
 * The 3D laboratory world.
 *
 * This component owns NO chrome. It is the canvas, the interaction wiring and
 * the derivations from public state — the HUD, the contextual prompt and the
 * drawers live beside it in `ImmersiveLab`. That separation is what makes the
 * laboratory the whole screen instead of a panel inside a dashboard.
 *
 * AUTHORITY: every prop into the Canvas comes from the public view model. The
 * scene reports gestures (look / select / drag / turn the valve) back through
 * callbacks; chemistry changes travel ONLY through the existing action protocol
 * via `perform()` — the same actions the panels send. The 3D layer never writes
 * Supabase directly and never sees a hidden value.
 *
 * THE POUR: the stopcock is a valve with intermediate openings (§12). While it
 * stands open on a live trial, a deterministic local accumulation runs at the
 * rate that opening passes; shutting it sends ONE `add_titrant` with that
 * volume, quantized to the burette graduation. Choosing the volume this way is
 * exactly as authoritative as a panel increment — the server validates it.
 */

const Lab3DCanvas = dynamic(
  () => import("./3d/Lab3DScene").then((module) => module.Lab3DCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-full items-center justify-center text-sm text-muted"
        role="status"
      >
        Entering the laboratory…
      </div>
    ),
  },
);

class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center" role="alert">
          <p className="text-sm font-medium">The 3D laboratory could not start on this device.</p>
          <p className="max-w-md text-xs text-muted">
            WebGL is unavailable here. Your progress is safe, and every step is still reachable from
            the Actions and Results drawers — this device just cannot draw the room.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Visual estimate of flask contents for drawing the liquid level ONLY. */
function estimateFlaskVolumeMl(stage: NonNullable<ReturnType<typeof useActiveStage>>): number {
  let volume = 0;
  if (stage.portion.kind === "weighed_mass") {
    if (stage.preparationState.khpTransferred) {
      volume += 30 + stage.preparationState.beakerRinses * 5;
    }
  } else if (stage.portion.recordedVolumeMl !== null) {
    volume += stage.portion.recordedVolumeMl;
  }
  if (stage.indicator.dropsAdded !== null) volume += 0.3;
  volume += stage.deliveredMl;
  return Math.min(250, volume);
}

/**
 * Transient action visual: turns on briefly when `watchKey` changes (i.e. the
 * server confirmed new state), then off. Drives the rinse pour, indicator
 * droplets and waste pulse — visible confirmation of an accepted action, never
 * a simulation value.
 */
function useActionFlash(watchKey: string, ms = 2000): boolean {
  const [active, setActive] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setActive(true);
    const id = window.setTimeout(() => setActive(false), ms);
    return () => window.clearTimeout(id);
  }, [watchKey, ms]);
  return active;
}

export function LabBench3D({ initialState }: { initialState: LabStateView }) {
  const stage = useActiveStage();
  const model = useLabServer();
  const { canWrite, pending, perform } = model;
  const {
    activeStageKey,
    stopcockAngleForStage,
    setStopcockAngleForStage,
    swirl,
    setSelectedReagentKey,
    setSelectedApparatusKey,
    selectedApparatusKey,
    focusRequest,
    flaskPos: flaskBenchPos,
    setFlaskPos: setFlaskBenchPos,
    beakerPos: beakerBenchPos,
    setBeakerPos: setBeakerBenchPos,
    readingMode,
    lookedAtKey,
    setLookedAtKey,
    carried,
    carriedRotation,
    carriedTilt,
    heldPose,
    setBuretteMounted,
    walkMode,
    stirring,
    setPointerLocked,
  } = useLabUi();

  const [valveDragging, setValveDragging] = useState(false);
  const [selection3D, setSelection3D] = useState<PhysicalSelectionKey>(null);
  const [accumulatedMl, setAccumulatedMl] = useState(0);
  const [swirlPhase, setSwirlPhase] = useState(0);
  /** Rapier sensor confirmation of the receiving zone (display only). */
  const [physicsInside, setPhysicsInside] = useState(false);
  const sending = useRef(false);
  /** Latest camera-derived landing spot for a carried vessel (no re-render). */
  const dropPointRef = useRef<BenchPoint>({ ...FIXED_SLOTS.beaker });
  const carriedBefore = useRef<typeof carried>(null);

  // Transient confirmations of accepted actions (visual only, ~2 s each).
  const rinseFlash = useActionFlash(
    `rinse:${stage?.preparationState.buretteCleaned ?? false}:${stage?.preparationState.conditioningRinses ?? 0}`,
  );
  const indicatorBurst = useActionFlash(`indicator:${stage?.indicator.dropsAdded ?? "none"}`);
  const wasteWatchKey = stage
    ? `waste:${stage.concordance.discardedTrials.length + stage.preparationState.wasteDiscards}`
    : "waste:none";
  const wastePulse = useActionFlash(wasteWatchKey);

  // Keyboard "F" support from the immersive shell arrives as a context request.
  // Focus is DERIVED during render: an external request wins while it is newer
  // than the last manual (mesh/toolbar) selection, otherwise the manual
  // selection stands — no effect-sync needed.
  const [manualFocus, setManualFocus] = useState<{
    key: ApparatusFocusKey;
    seenRequestId: number;
  } | null>(null);
  const focusRequestId = focusRequest.id;
  const setFocus = useCallback(
    (key: ApparatusFocusKey) => {
      setManualFocus({ key, seenRequestId: focusRequestId });
    },
    [focusRequestId],
  );
  const focus =
    focusRequestId > 0 && focusRequestId > (manualFocus?.seenRequestId ?? 0)
      ? focusRequest.key
      : (manualFocus?.key ?? null);

  const stopcockAngle = stopcockAngleForStage(activeStageKey);
  const stopcockOpen = stopcockIsOpen(stopcockAngle);
  const flowMode: FlowMode = stopcockFlowModeFor(stopcockAngle) ?? "MEDIUM";
  const interactive = canWrite && !pending;

  const stopcockRule = stage ? stopcockAvailability(stage, { canWrite, pending, stopcockOpen }) : null;
  const canUseStopcock = stopcockRule?.available === true;

  const serverPlaced = stage?.preparationState.flaskPlaced === true;
  const flaskSlot = useMemo(
    () => resolveFlaskPosition({ serverPlaced, draggedPos: flaskBenchPos }),
    [serverPlaced, flaskBenchPos],
  );
  const flaskInReceiving = flaskReceivingValid(flaskSlot.pos);

  const trialOpen = stage?.openTrial !== null && stage?.openTrial !== undefined;
  const buretteSetup = stage?.burette.setup === true;
  // The authoritative setup IS the physical mounting: the glass tube lives in
  // the stand's assembly, so "set up" and "clamped on" are the same fact.
  const mounted = buretteSetup;
  const mountCheck = titrationNeedsMount({ mounted, flaskInReceiving });
  const readingMl = stage?.burette.readingMl ?? null;
  const capacityMl = stage?.burette.capacityMl ?? 50;
  const graduationMl = stage?.burette.graduationMl ?? 0.1;
  const buretteRemainingMl = readingMl === null ? 0 : Math.max(0, capacityMl - readingMl);

  // The open path: the valve is off its seat, a trial is running, the burette
  // is physically mounted and the flask is under the tip. The mounting rule is
  // expressed through `mounting.ts` so the physical precondition has one home.
  const pathOpen = stopcockOpen && trialOpen && mountCheck.available && interactive && readingMl !== null;

  // Keep the UI's mounting flag in step with the authoritative setup, so the
  // prompt and the scene agree about whether the burette is up.
  useEffect(() => {
    setBuretteMounted(mounted);
  }, [mounted, setBuretteMounted]);

  // ---- Swirl clock (visual only) -------------------------------------------
  useEffect(() => {
    if (!swirl) return;
    const id = window.setInterval(() => setSwirlPhase((p) => p + 0.06), 50);
    return () => window.clearInterval(id);
  }, [swirl]);

  // ---- Flow accumulation loop ----------------------------------------------
  useEffect(() => {
    if (!stage || !pathOpen) return;
    const rate = stopcockRateMlPerSecond(stopcockAngle);
    const id = window.setInterval(() => {
      setAccumulatedMl((current) =>
        accumulateFlowTick({
          alreadyAccumulatedMl: current,
          deltaSeconds: 0.1,
          mode: flowMode,
          graduationMl,
          buretteRemainingMl,
        }).rawMl,
      );
    }, 100);
    void rate;
    return () => window.clearInterval(id);
  }, [stage, pathOpen, flowMode, stopcockAngle, graduationMl, buretteRemainingMl]);

  // Drop the unconfirmed preview whenever the server state moves on (a
  // render-time adjustment, not an effect: the preview belongs to the previous
  // revision).
  const revision = model.state.revision;
  const [clearedRevision, setClearedRevision] = useState(revision);
  if (clearedRevision !== revision) {
    setClearedRevision(revision);
    setAccumulatedMl(0);
  }

  /** Send the accumulated pour as ONE action. Does not touch the valve. */
  const confirmPour = useCallback(async () => {
    if (!stage || sending.current) return;
    const quantized = quantizeDeliveryMl(accumulatedMl, graduationMl);
    setAccumulatedMl(0);
    if (quantized > 0 && trialOpen) {
      sending.current = true;
      try {
        await perform({ type: "add_titrant", stageKey: activeStageKey, volumeMl: quantized });
      } finally {
        sending.current = false;
      }
    }
  }, [stage, accumulatedMl, graduationMl, activeStageKey, trialOpen, perform]);

  /** Turn the valve by hand. Shutting it records whatever passed. */
  const handleValveAngle = useCallback(
    (angleDeg: number) => {
      if (!canUseStopcock) return;
      const wasOpen = stopcockIsOpen(angleDeg);
      setStopcockAngleForStage(activeStageKey, angleDeg);
      if (!wasOpen && accumulatedMl > 0) void confirmPour();
    },
    [canUseStopcock, setStopcockAngleForStage, activeStageKey, accumulatedMl, confirmPour],
  );

  // Auto-stop: the burette ran dry mid-pour — record what accumulated.
  useEffect(() => {
    if (
      pathOpen &&
      stopcockOpen &&
      trialOpen &&
      shouldStopFlow({
        stopcockOpen,
        buretteRemainingMl: buretteRemainingMl - accumulatedMl,
        receiverInPosition: flaskInReceiving,
        trialOpen,
      }) &&
      accumulatedMl > 0
    ) {
      void confirmPour();
    }
  }, [pathOpen, stopcockOpen, trialOpen, buretteRemainingMl, accumulatedMl, flaskInReceiving, confirmPour]);

  // ---- Looking at things ----------------------------------------------------
  /**
   * The crosshair's answer, reported by the scene. Only a CHANGE reaches React,
   * so walking the laboratory does not re-render the world every frame.
   */
  const handleLookChange = useCallback(
    (key: PhysicalSelectionKey, dropPoint: BenchPoint) => {
      dropPointRef.current = dropPoint;
      setLookedAtKey(key);
    },
    [setLookedAtKey],
  );

  // ---- Selection bridges into the existing bench selection ------------------
  const handleSelectApparatus = useCallback(
    (key: Exclude<PhysicalSelectionKey, null>) => {
      setSelection3D(key);
      if (key === "burette") {
        setSelectedApparatusKey("burette");
        setFocus("burette");
      } else if (key === "conical_flask") {
        setSelectedApparatusKey("conical_flask");
        setFocus("flask");
      } else if (key === "analytical_balance") {
        setSelectedApparatusKey("analytical_balance");
        setFocus("balance");
      } else if (key === "graduated_cylinder") {
        setSelectedApparatusKey("graduated_cylinder");
        setFocus("cylinder");
      } else if (key === "beaker_250") {
        setSelectedApparatusKey("beaker");
      } else if (key === "volumetric_flask") {
        setSelectedApparatusKey("volumetric_flask");
      } else if (key === "waste_container") {
        setSelectedApparatusKey("waste_container");
      } else {
        setSelectedApparatusKey(null);
      }
    },
    [setSelectedApparatusKey, setFocus],
  );

  const handleSelectReagent = useCallback(
    (key: string) => {
      setSelection3D("reagent_bottle");
      setSelectedReagentKey(key);
    },
    [setSelectedReagentKey],
  );

  const handleFlaskDrop = useCallback(
    (point: BenchPoint) => {
      // Setting the flask down on the waste container discards the completed
      // trial — the same `discard_to_waste` the panel sends, gated the same way.
      if (stage && wastePlacementValid(point)) {
        const availability = discardAvailability(stage, { canWrite, pending });
        if (availability.available) {
          setFlaskBenchPos({ ...FLASK_TILE_SLOT });
          void perform({ type: "discard_to_waste", stageKey: stage.key });
          return;
        }
      }
      setFlaskBenchPos(point);
    },
    [stage, canWrite, pending, perform, setFlaskBenchPos],
  );

  const handleBeakerDrop = useCallback(
    (point: BenchPoint) => {
      setBeakerBenchPos(point);
    },
    [setBeakerBenchPos],
  );

  // ---- Setting a carried vessel down ---------------------------------------
  // The release happens when the hand empties, wherever the student is looking:
  // over the waste it discards, on the balance it lands on the pan, otherwise
  // it rests on the bench. Physical handling only — every act it implies goes
  // through the same protocol actions as the panels.
  useEffect(() => {
    const previous = carriedBefore.current;
    carriedBefore.current = carried;
    if (carried !== null || previous === null) return;
    const point = dropPointRef.current;
    const release = holdReleaseFor(previous, point);
    if (release.kind === "burette_mount") {
      setBuretteMounted(release.mounted);
      return;
    }
    if (release.kind === "discard") {
      if (stage) {
        const availability = discardAvailability(stage, { canWrite, pending });
        if (availability.available) {
          setFlaskBenchPos({ ...FLASK_TILE_SLOT });
          void perform({ type: "discard_to_waste", stageKey: stage.key });
          return;
        }
      }
      setFlaskBenchPos(release.pos);
      return;
    }
    if (previous === "flask") {
      setFlaskBenchPos(release.pos);
      return;
    }
    if (previous === "beaker") {
      setBeakerBenchPos(release.pos);
    }
  }, [carried, stage, canWrite, pending, perform, setFlaskBenchPos, setBeakerBenchPos, setBuretteMounted]);

  // ---- Pouring what the student holds ---------------------------------------
  // A tipped vessel leaves a stream aimed at whatever it is pointed at. The
  // volumes themselves are the domain's business; what the gesture produces
  // here is the SAME one-shot action the panel button sends, fired when the
  // student brings the vessel back upright — exactly how the stopcock records
  // its pour when it is shut again. Overshooting stays possible because the
  // action is still gated by the same availability rules the server enforces.
  const pourTargets: PourTargets = useMemo(
    () => ({
      flask: flaskSlot.pos,
      beaker: beakerBenchPos ?? { ...FIXED_SLOTS.beaker },
      cylinder: { ...FIXED_SLOTS.cylinder },
      volumetricFlask: { ...VOLUMETRIC_FLASK_SLOT },
    }),
    [flaskSlot.pos, beakerBenchPos],
  );
  const pouring = isPourTilt(heldPose);
  const pourArmed = useRef(false);
  const prevTilt = useRef(0);
  useEffect(() => {
    const nowPouring = isPourTilt({ yawRadians: 0, tiltRadians: carriedTilt });
    const wasPouring = isPourTilt({ yawRadians: 0, tiltRadians: prevTilt.current });
    prevTilt.current = carriedTilt;
    if (nowPouring) {
      // Tipping while holding arms the pour; nothing is sent until it is
      // levelled off, so a wobble cannot fire a stray action.
      if (carried) pourArmed.current = true;
      return;
    }
    if (!wasPouring || !pourArmed.current) return;
    pourArmed.current = false;
    if (!carried || !stage) return;
    // Read the live aim here, in an effect — not during render — so the pour
    // resolves to whatever the student was actually pointing at.
    const intent = pourIntent({
      pose: { yawRadians: 0, tiltRadians: carriedTilt },
      aimPoint: dropPointRef.current,
      targets: pourTargets,
    });
    const action = pourActionFor(carried, intent.zone, { stage, canWrite, pending });
    if (action) void perform(action);
  }, [carriedTilt, carried, stage, canWrite, pending, perform, pourTargets]);

  if (!stage) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
        No titration stage is configured for this experiment.
      </div>
    );
  }

  // ---- Public-state derivations (the ONLY data the scene receives) ----------
  const prep = stage.preparationState;
  const weighed = stage.portion.kind === "weighed_mass";
  const beakerPlus = weighed ? prep.beakerPlusKhpMassG : null;
  const beakerEmpty = weighed ? prep.beakerMassG : null;
  const khpState: Lab3DSceneProps["beaker"]["khpState"] =
    !weighed || beakerPlus === null
      ? "none"
      : !prep.khpDissolved
        ? "solid"
        : !prep.khpTransferred
          ? "dissolving"
          : "none";
  const beakerLiquidMl = !weighed
    ? 0
    : beakerPlus === null
      ? prep.beakerObtained
        ? 100
        : 0
      : !prep.khpDissolved
        ? 0
        : !prep.khpTransferred
          ? 30
          : prep.beakerRinses < 2
            ? 5
            : 0;

  const balanceDisplay =
    beakerPlus !== null
      ? beakerPlus.toFixed(2)
      : beakerEmpty !== null
        ? beakerEmpty.toFixed(2)
        : stage.portion.kind === "weighed_mass"
          ? "0.00"
          : "—";

  const showCylinder =
    stage.portion.kind === "pipetted_volume" ||
    (initialState.config.solutionDilution !== null && !model.state.publicState.solution.mixed);
  const cylinder =
    stage.portion.kind === "pipetted_volume"
      ? {
          volumeMl: stage.portion.recordedVolumeMl ?? 0,
          capacityMl: stage.portion.nominalVolumeMl,
        }
      : showCylinder
        ? {
            volumeMl: model.state.publicState.solution.stockVolumeMl ?? 0,
            capacityMl: 250,
          }
        : null;

  const titrantLabel = initialState.chemicalLabels[stage.titrantKey] ?? stage.titrantKey;
  const analyteLabel = initialState.chemicalLabels[stage.analyteKey] ?? stage.analyteKey;
  const reagents: Lab3DSceneProps["reagents"] = [
    ...(initialState.config.solutionDilution
      ? [
          {
            key: initialState.config.solutionDilution.stockKey,
            label: `${initialState.config.solutionDilution.stockMolarityM} M stock`,
            sublabel: "stock solution",
            colorHex: "#93c5fd",
            kind: "bottle" as const,
            fillFraction: model.state.publicState.solution.stockVolumeMl !== null ? 0.7 : 1,
          },
        ]
      : []),
    {
      key: stage.titrantKey,
      label: titrantLabel,
      sublabel: "titrant",
      colorHex: "#dbeafe",
      kind: "bottle" as const,
      fillFraction: 0.8,
    },
    {
      key: stage.analyteKey,
      label: analyteLabel,
      sublabel: "analyte",
      colorHex: "#fef3c7",
      kind: "bottle" as const,
      fillFraction: 0.6,
    },
    {
      key: stage.indicator.key,
      label: stage.indicator.name,
      sublabel: "indicator",
      colorHex: "#f472b6",
      kind: "dropper" as const,
      fillFraction: 0.9,
    },
    {
      key: "distilled_water",
      label: "Distilled water",
      sublabel: "wash",
      colorHex: "#e0f2fe",
      kind: "wash" as const,
      fillFraction: 0.9,
    },
  ].slice(0, 5);

  const discardedTotal = stage.concordance.discardedTrials.length + prep.wasteDiscards;
  const bubbleCleared = prep.airBubbleCleared;
  const airBubble = buretteSetup && !bubbleCleared;

  // The receiving spot lights when the flask is on it. While the flask is in
  // hand and Rapier is running, the sensor has to confirm the bodies really
  // overlap too: the green light is the student's cue that they may release,
  // so it must mean "the meshes are there", not just "the numbers say so".
  const physicsAgrees = !interactive || carried === null || serverPlaced || physicsInside;
  const zoneState: Lab3DSceneProps["zoneState"] =
    flaskInReceiving && !serverPlaced && physicsAgrees ? "valid" : "idle";

  const sceneProps: Lab3DSceneProps = {
    burette: { readingMl, capacityMl, graduationMl },
    stopcockAngleDeg: stopcockAngle,
    stopcockInteractive: canUseStopcock,
    valveDragging,
    onValveAngle: handleValveAngle,
    onValveDragChange: setValveDragging,
    airBubble,
    rinseFlash,
    indicatorBurst,
    wastePulse,
    flowing: pathOpen && accumulatedMl >= 0,
    dropwise: flowMode === "DROPWISE",
    previewDeliveredMl: accumulatedMl,
    flask: {
      volumeMl: estimateFlaskVolumeMl(stage),
      colour: stage.flask.colour,
      hasContents: stage.flask.hasContents,
    },
    flaskPos: flaskSlot.pos,
    swirling: swirl,
    swirlPhase,
    balance: { displayText: balanceDisplay, hasBeaker: weighed },
    cylinder,
    beaker: { liquidMl: beakerLiquidMl, khpState },
    beakerPos: beakerBenchPos ?? { ...FIXED_SLOTS.beaker },
    wasteDiscarded: discardedTotal,
    reagents,
    selection: selection3D ?? mapBenchSelection(selectedApparatusKey),
    lookedAt: lookedAtKey,
    focus,
    readingMode,
    dragEnabled: interactive,
    stirring,
    carriedKind: carried,
    carriedYawRadians: carriedRotation.yawRadians,
    carriedTilt,
    pouring,
    zoneState,
    physicsEnabled: interactive,
    moveEnabled: walkMode,
    onLookChange: handleLookChange,
    onPointerLockChange: setPointerLocked,
    onPhysicsZone: setPhysicsInside,
    onSelectApparatus: handleSelectApparatus,
    onSelectReagent: handleSelectReagent,
    onFlaskDrop: handleFlaskDrop,
    onBeakerDrop: handleBeakerDrop,
    guideKey: guideTargetForNextAction(stage.nextAction?.kind),
  };

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-surface">
      <SceneErrorBoundary>
        <Lab3DCanvas {...sceneProps} />
      </SceneErrorBoundary>
    </div>
  );
}

type ActiveStage = NonNullable<ReturnType<typeof useActiveStage>>;

/**
 * What a completed pour MEANS, given what is being poured and into what.
 *
 * Only pours the domain already models as a single action are mapped: tipping
 * the dissolved-KHP beaker into the flask is the transfer (or a rinse, if that
 * is what is outstanding). Actions that need a RECORDED volume — measuring
 * stock, pipetting the aliquot — deliberately stay with the recorder, because
 * a student must read and enter those numbers rather than have the gesture
 * invent them.
 */
function pourActionFor(
  kind: HoldableKind,
  zone: PourZone,
  flags: { stage: ActiveStage; canWrite: boolean; pending: boolean },
): { type: string; stageKey: string } | null {
  const gate = { canWrite: flags.canWrite, pending: flags.pending };
  if (kind === "beaker" && zone === "flask") {
    if (transferAvailability(flags.stage, gate).available) {
      return { type: "transfer_solution", stageKey: flags.stage.key };
    }
    if (rinseBeakerAvailability(flags.stage, gate).available) {
      return { type: "rinse_beaker", stageKey: flags.stage.key };
    }
    return null;
  }
  return null;
}

function mapBenchSelection(key: string | null): PhysicalSelectionKey {
  switch (key) {
    case "burette":
      return "burette";
    case "conical_flask":
      return "conical_flask";
    case "analytical_balance":
      return "analytical_balance";
    case "graduated_cylinder":
      return "graduated_cylinder";
    case "beaker":
      return "beaker_250";
    case "volumetric_flask":
      return "volumetric_flask";
    case "waste_container":
      return "waste_container";
    default:
      return null;
  }
}
