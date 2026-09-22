"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LabStateView } from "@/application/attempts/lab-state";
import { useActiveStage, useLabServer, useLabUi } from "./lab-state-provider";
import { stopcockAvailability } from "./control-availability";
import {
  FLOW_MODES,
  accumulateFlowTick,
  quantizeDeliveryMl,
  shouldStopFlow,
  type FlowMode,
} from "./3d/simulation/flow";
import {
  FLASK_TILE_SLOT,
  FLASK_UNDER_BURETTE_SLOT,
  flaskReceivingValid,
  type BenchPoint,
} from "./3d/simulation/spatial";
import {
  resolveFlaskPosition,
  type ApparatusFocusKey,
  type PhysicalSelectionKey,
} from "./3d/simulation/apparatus-state";
import type { Lab3DSceneProps } from "./3d/Lab3DScene";

/**
 * The 3D laboratory bench: real-time interactive visualisation over the SAME
 * authoritative state as the 2D bench.
 *
 * AUTHORITY: every prop into the Canvas is derived from the public view model.
 * The scene reports gestures (select / toggle / drop) back through callbacks;
 * chemistry changes travel ONLY through the existing action protocol via
 * `perform()` — the same `setup_apparatus`, `add_titrant`, `place_flask`…
 * actions the panels send. The 3D layer never writes Supabase directly and
 * never sees hidden values.
 *
 * The pour interaction: opening the 3D stopcock starts a deterministic local
 * accumulation (flow mode × elapsed time, quantized to the burette
 * graduation). Closing it sends ONE `add_titrant` with that volume. Picking
 * the volume this way is exactly as authoritative as the panel's delivery
 * buttons — the server validates the volume and computes the colour.
 */

const Lab3DCanvas = dynamic(
  () => import("./3d/Lab3DScene").then((module) => module.Lab3DCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-full min-h-[420px] items-center justify-center text-sm text-muted"
        role="status"
      >
        3D laboratory loading…
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
        <div
          className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 p-6 text-center"
          role="alert"
        >
          <p className="text-sm font-medium">The 3D laboratory could not start on this device.</p>
          <p className="text-xs text-muted">
            Your progress is safe — switch back to the 2D bench to continue the experiment.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Visual estimate of flask contents for drawing the liquid level ONLY. */
function estimateFlaskVolumeMl(
  stage: NonNullable<ReturnType<typeof useActiveStage>>,
): number {
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

export function LabBench3D({ initialState }: { initialState: LabStateView }) {
  const stage = useActiveStage();
  const model = useLabServer();
  const { canWrite, pending, perform } = model;
  const {
    activeStageKey,
    stopcockOpenForStage,
    toggleStopcock,
    swirl,
    setSelectedReagentKey,
    setSelectedApparatusKey,
    selectedApparatusKey,
  } = useLabUi();

  // ---- Physical (UI-only) state -------------------------------------------
  const [flaskBenchPos, setFlaskBenchPos] = useState<BenchPoint | null>(null);
  const [flowMode, setFlowMode] = useState<FlowMode>("MEDIUM");
  const [focus, setFocus] = useState<ApparatusFocusKey>(null);
  const [readingMode, setReadingMode] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [selection3D, setSelection3D] = useState<PhysicalSelectionKey>(null);
  const [stirring, setStirring] = useState(false);
  const [accumulatedMl, setAccumulatedMl] = useState(0);
  const [swirlPhase, setSwirlPhase] = useState(0);
  /** Rapier sensor confirmation of the receiving zone (display only). */
  const [physicsInside, setPhysicsInside] = useState(false);
  const sending = useRef(false);

  const stopcockOpen = stopcockOpenForStage === activeStageKey;
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
  const readingMl = stage?.burette.readingMl ?? null;
  const capacityMl = stage?.burette.capacityMl ?? 50;
  const graduationMl = stage?.burette.graduationMl ?? 0.1;
  const buretteRemainingMl = readingMl === null ? 0 : Math.max(0, capacityMl - readingMl);

  // The open path: same condition as the 2D bench, plus the flask physically
  // under the tip — otherwise the pour would miss the vessel.
  const pathOpen =
    stopcockOpen && trialOpen && buretteSetup && interactive && flaskInReceiving && readingMl !== null;

  // ---- Swirl clock (visual only) -------------------------------------------
  useEffect(() => {
    if (!swirl) return;
    const id = window.setInterval(() => setSwirlPhase((p) => p + 0.06), 50);
    return () => window.clearInterval(id);
  }, [swirl]);

  // ---- Flow accumulation loop ----------------------------------------------
  // While the stopcock stands open on a live trial, accumulate the pour at the
  // selected flow-mode rate. Closing the stopcock confirms ONE `add_titrant`.
  useEffect(() => {
    if (!stage || !pathOpen) return;
    const id = window.setInterval(() => {
      setAccumulatedMl((current) => {
        const tick = accumulateFlowTick({
          alreadyAccumulatedMl: current,
          deltaSeconds: 0.1,
          mode: flowMode,
          graduationMl,
          buretteRemainingMl,
        });
        return tick.rawMl;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [stage, pathOpen, flowMode, graduationMl, buretteRemainingMl]);

  // Drop the unconfirmed preview whenever the server state moves on (a render-time
  // adjustment, not an effect: the preview belongs to the previous revision).
  const revision = model.state.revision;
  const [clearedRevision, setClearedRevision] = useState(revision);
  if (clearedRevision !== revision) {
    setClearedRevision(revision);
    setAccumulatedMl(0);
  }

  const confirmPour = useCallback(async () => {
    if (!stage || sending.current) return;
    const quantized = quantizeDeliveryMl(accumulatedMl, graduationMl);
    toggleStopcock(activeStageKey);
    setAccumulatedMl(0);
    if (quantized > 0 && trialOpen) {
      sending.current = true;
      try {
        await perform({ type: "add_titrant", stageKey: activeStageKey, volumeMl: quantized });
      } finally {
        sending.current = false;
      }
    }
  }, [stage, accumulatedMl, graduationMl, toggleStopcock, activeStageKey, trialOpen, perform]);

  const handleToggleStopcock = useCallback(() => {
    if (!canUseStopcock) return;
    if (stopcockOpen) {
      void confirmPour();
    } else {
      toggleStopcock(activeStageKey);
    }
  }, [canUseStopcock, stopcockOpen, confirmPour, toggleStopcock, activeStageKey]);

  // Auto-stop: the burette ran dry mid-pour — confirm what accumulated.
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
    [setSelectedApparatusKey],
  );

  const handleSelectReagent = useCallback(
    (key: string) => {
      setSelection3D("reagent_bottle");
      setSelectedReagentKey(key);
    },
    [setSelectedReagentKey],
  );

  const handleFlaskDrop = useCallback((point: BenchPoint) => {
    setFlaskBenchPos(point);
  }, []);

  if (!stage) {
    return (
      <div className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-muted">
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
  const beakerLiquidMl =
    !weighed
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

  const discardedTotal = model.state.publicState
    ? stage.concordance.discardedTrials.length + prep.wasteDiscards
    : 0;

  const zoneState: Lab3DSceneProps["zoneState"] =
    flaskInReceiving && !serverPlaced ? "valid" : "idle";

  const sceneProps: Lab3DSceneProps = {
    burette: { readingMl, capacityMl, graduationMl },
    stopcockOpen,
    stopcockInteractive: canUseStopcock,
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
    wasteDiscarded: discardedTotal,
    reagents,
    selection: selection3D ?? mapBenchSelection(selectedApparatusKey),
    focus,
    readingMode,
    resetSignal,
    dragEnabled: interactive,
    stirring,
    zoneState,
    physicsEnabled: interactive,
    onPhysicsZone: setPhysicsInside,
    onSelectApparatus: handleSelectApparatus,
    onSelectReagent: handleSelectReagent,
    onToggleStopcock: handleToggleStopcock,
    onFlaskDrop: handleFlaskDrop,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* 3D toolbar: camera + flow mode + reading mode. Chemistry actions stay
          in the existing panels, so every 3D gesture has a panel equivalent. */}
      <div className="flex flex-wrap items-center gap-2 text-xs" role="toolbar" aria-label="3D laboratory controls">
        <span className="font-semibold">Camera:</span>
        {(
          [
            ["burette", "Focus burette"],
            ["flask", "Focus flask"],
            ["balance", "Focus balance"],
            ["cylinder", "Focus cylinder"],
          ] as Array<[ApparatusFocusKey, string]>
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={focus === key ? "primary" : "secondary"}
            aria-pressed={focus === key}
            onClick={() => {
              setFocus(key);
              setReadingMode(false);
            }}
          >
            {label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={readingMode ? "primary" : "secondary"}
          aria-pressed={readingMode}
          onClick={() => {
            setFocus("burette");
            setReadingMode((mode) => !mode);
          }}
        >
          Reading mode
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setFocus(null);
            setReadingMode(false);
            setResetSignal((n) => n + 1);
          }}
        >
          Reset view
        </Button>
        <span className="ms-2 font-semibold">Flow:</span>
        {(
          Object.keys(FLOW_MODES) as Array<FlowMode>
        ).map((mode) => (
          <Button
            key={mode}
            size="sm"
            variant={flowMode === mode ? "primary" : "secondary"}
            aria-pressed={flowMode === mode}
            title={FLOW_MODES[mode].label}
            onClick={() => setFlowMode(mode)}
          >
            {mode.charAt(0) + mode.slice(1).toLowerCase()}
          </Button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          disabled={!interactive}
          title="Accessible alternative to dragging: place the flask under the burette"
          onClick={() => setFlaskBenchPos({ ...FLASK_UNDER_BURETTE_SLOT })}
        >
          Place flask under burette
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!interactive}
          title="Accessible alternative to dragging: return the flask to the tile"
          onClick={() => setFlaskBenchPos({ ...FLASK_TILE_SLOT })}
        >
          Flask to tile
        </Button>
        <Button
          size="sm"
          variant={stirring ? "primary" : "secondary"}
          aria-pressed={stirring}
          disabled={!interactive}
          title="Visual stirring with the glass rod (dissolution itself is recorded in the preparation panel)"
          onClick={() => setStirring((value) => !value)}
        >
          {stirring ? "Stop stirring" : "Stir with rod"}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-line bg-surface">
        <div className="h-full max-h-[72vh] min-h-[420px] w-full">
          <SceneErrorBoundary>
            <Lab3DCanvas {...sceneProps} />
          </SceneErrorBoundary>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="neutral">Flask: {stage.flask.label}</Badge>
        <Badge tone="neutral">Stopcock: {stopcockOpen ? "open" : "closed"}</Badge>
        <Badge tone="neutral">
          Burette: {readingMl === null ? "not filled" : `${readingMl.toFixed(2)} mL`}
        </Badge>
        {stopcockOpen && trialOpen ? (
          <span className="text-muted" role="status">
            Pouring ({FLOW_MODES[flowMode].label.toLowerCase()}):{" "}
            {quantizeDeliveryMl(accumulatedMl, graduationMl).toFixed(2)} mL unconfirmed — close
            the stopcock to record it.
          </span>
        ) : null}
        {!flaskInReceiving && trialOpen ? (
          <span className="text-warning">The flask is not under the burette — drag it into the highlighted zone.</span>
        ) : null}
        {flaskInReceiving && physicsInside ? (
          <span className="text-muted">Bench contact confirmed.</span>
        ) : null}
        {stopcockRule?.reason && !canUseStopcock ? (
          <span className="text-warning">{stopcockRule.reason}</span>
        ) : null}
        {swirl ? <span className="text-muted">Swirling.</span> : null}
        <span className="ms-auto text-muted">
          Drag to orbit · scroll to zoom · right-drag to pan · click apparatus to inspect.
        </span>
      </div>
    </div>
  );
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
