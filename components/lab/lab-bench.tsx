"use client";

import { memo, useCallback, useId, useMemo } from "react";
import type { KeyboardEvent } from "react";
import { Expand } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveStage, useLabServer, useLabUi, useLabViewModel } from "./lab-state-provider";
import { ControlReason, describedBy } from "./control-reason";
import {
  focusModeAvailability,
  stopcockAvailability,
  swirlAvailability,
} from "./control-availability";
import { BuretteSvg } from "./svg/burette-svg";
import { FlaskSvg } from "./svg/flask-svg";
import { BalanceSvg } from "./svg/balance-svg";
import { PipetteSvg } from "./svg/pipette-svg";
import { GraduatedCylinderSvg } from "./svg/graduated-cylinder-svg";
import {
  BeakerSvg,
  DropperBottleSvg,
  PipetteRackSvg,
  ReagentBottleSvg,
  VolumetricFlaskSvg,
  WashBottleSvg,
  WasteContainerSvg,
  WeighingBottleSvg,
  WhiteTileSvg,
} from "./svg/bench-parts";
import type { LabStateView } from "@/application/attempts/lab-state";

/**
 * The bench.
 *
 * A 2D SVG scene at a fixed viewBox, scaled to its container, so the same
 * drawing works on a phone and on a workstation. Every apparatus piece renders
 * from the public view model only.
 *
 * INTERACTION HONESTY: the liquid stream and the flask ripple render while the
 * stopcock stands open on a live trial — they represent the open path, not a
 * transferred volume. Volumes, colours and readings all arrive from the server
 * after each accepted action, which is what moves the meniscus and the liquid.
 *
 * PERFORMANCE: the burette and the flask are memoised and their handlers are
 * stable, so turning a tab, hovering a bottle or typing in a field does not
 * redraw the two components that change most often — and the two that DO change
 * only re-render when the server state they depend on changes.
 */
const MemoBurette = memo(BuretteSvg);
const MemoFlask = memo(FlaskSvg);

const VIEW_BOX = "0 0 1000 700";
const SURFACE_Y = 620;

export function LabBench({ initialState }: { initialState: LabStateView }) {
  const stage = useActiveStage();
  const model = useLabViewModel();
  const { canWrite, pending } = useLabServer();
  const {
    activeStageKey,
    stopcockOpenForStage,
    toggleStopcock,
    swirl,
    setSwirl,
    selectedReagentKey,
    setSelectedReagentKey,
    selectedApparatusKey,
    setSelectedApparatusKey,
    setFocusedApparatus,
    aliquotStage,
    fillerAttached,
  } = useLabUi();
  const focusReasonId = `${useId()}-bench-focus-reason`;

  const stopcockOpen = stopcockOpenForStage === activeStageKey;
  const interactive = canWrite && !pending;

  // Resolved above the early return so the SVG handlers and the footnotes obey
  // exactly the same rules as the panel, from a single source.
  const flags = { canWrite, pending, stopcockOpen };
  const stopcock = stage ? stopcockAvailability(stage, flags) : null;
  const swirling = stage ? swirlAvailability(stage, flags) : null;
  const focus = focusModeAvailability(flags);
  // Primitives, so the memoised handler and the SVG props have stable inputs.
  const canSwirl = swirling?.available === true;
  const canUseStopcock = stopcock?.available === true;
  const stopcockReason = stopcock?.reason ?? null;

  const handleFlaskClick = useCallback(() => {
    setSelectedApparatusKey("conical_flask");
    // Swirling is a real gesture only while a titration is running; before that
    // the click selects the flask, and the bench says why it did not swirl.
    if (canSwirl) setSwirl((current) => !current);
  }, [canSwirl, setSelectedApparatusKey, setSwirl]);

  const handleAliquotVesselClick = useCallback(() => {
    // Selecting only: measuring the solution is a guided panel step, so a bench
    // click never fills the ware by itself.
    setSelectedApparatusKey(stage?.portion.kind === "pipetted_volume" ? stage.portion.vessel : null);
  }, [setSelectedApparatusKey, stage]);

  const handleBuretteSelect = useCallback(() => {
    setSelectedApparatusKey("burette");
  }, [setSelectedApparatusKey]);

  const handleBuretteKeyDown = useCallback(
    (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleBuretteSelect();
      }
    },
    [handleBuretteSelect],
  );

  const titrantLabel = stage
    ? (initialState.chemicalLabels[stage.titrantKey] ?? stage.titrantKey)
    : "";
  const analyteLabel = stage
    ? (initialState.chemicalLabels[stage.analyteKey] ?? stage.analyteKey)
    : "";
  const indicatorLabel = stage?.indicator.name ?? "";

  const reagentBottles = useMemo(
    () =>
      stage
        ? [
            { key: stage.titrantKey, label: titrantLabel, x: 776, kind: "bottle" as const },
            { key: stage.analyteKey, label: analyteLabel, x: 842, kind: "bottle" as const },
            { key: stage.indicator.key, label: indicatorLabel, x: 908, kind: "dropper" as const },
            { key: "distilled_water", label: "Distilled water", x: 950, kind: "wash" as const },
          ]
        : [],
    [stage, titrantLabel, analyteLabel, indicatorLabel],
  );

  if (!stage) {
    return (
      <div className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-muted">
        No titration stage is configured for this experiment.
      </div>
    );
  }

  // Discarded trials across every stage: overshot solutions and completed
  // trials poured off go to waste, so the waste level is drawn from the
  // persisted trials and waste-disposal counts, never invented.
  const discardedTotal = model.stages.reduce(
    (total, entry) =>
      total + entry.concordance.discardedTrials.length + entry.preparationState.wasteDiscards,
    0,
  );

  // The open path: stopcock turned, a trial running, burette prepared. This is
  // the only condition under which flow visuals may render.
  const pathOpen =
    stopcockOpen && stage.openTrial !== null && stage.burette.setup && interactive;
  const buretteSelected = selectedApparatusKey === "burette";
  const flaskSelected = selectedApparatusKey === "conical_flask";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-x-auto rounded-md border border-line bg-surface">
        <svg
          viewBox={VIEW_BOX}
          role="group"
          aria-label={`Laboratory bench for ${stage.title}`}
          className="h-full max-h-[72vh] min-h-[420px] w-full min-w-[520px]"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Wall and reagent shelf */}
          <rect x={0} y={0} width={1000} height={SURFACE_Y} fill="var(--lab-wall)" />
          <rect x={770} y={112} width={220} height={8} rx={2} fill="var(--foreground)" opacity={0.3} />
          <text x={778} y={104} fontSize={11} fill="var(--lab-scale)" fontWeight={500}>
            reagent shelf
          </text>

          {/* Bench surface */}
          <rect x={0} y={SURFACE_Y} width={1000} height={80} fill="var(--surface)" />
          <line x1={0} y1={SURFACE_Y} x2={1000} y2={SURFACE_Y} stroke="var(--foreground)" strokeWidth={2.5} opacity={0.35} />

          {/* Burette stand */}
          <g>
            <rect x={64} y={SURFACE_Y - 16} width={220} height={16} rx={3} fill="var(--foreground)" opacity={0.2} />
            <rect x={86} y={120} width={12} height={SURFACE_Y - 136} fill="var(--foreground)" opacity={0.25} />
            <rect x={98} y={160} width={120} height={12} rx={3} fill="var(--foreground)" opacity={0.4} />
            <title>Burette stand and clamp</title>
          </g>

          {/* Burette */}
          <MemoBurette
            view={stage.burette}
            opened={stopcockOpen}
            flowing={pathOpen}
            selected={buretteSelected}
            x={190}
            y={60}
            // The stopcock is a control only when the domain would accept the
            // action behind it; otherwise it is a drawing with a name.
            interactive={canUseStopcock}
            onToggleStopcock={() => toggleStopcock(activeStageKey)}
          />
          {interactive ? (
            <g
              role="button"
              tabIndex={0}
              aria-label={`Burette body. ${buretteSelected ? "Selected." : "Activate to select the burette."}`}
              onClick={handleBuretteSelect}
              onKeyDown={handleBuretteKeyDown}
              className="cursor-pointer"
            >
              <rect x={218} y={100} width={40} height={260} rx={8} fill="transparent" />
            </g>
          ) : null}

          {/* Flask on the white tile */}
          <WhiteTileSvg x={150} y={SURFACE_Y - 12} width={180} />
          <MemoFlask
            view={stage.flask}
            swirling={swirl}
            pouring={pathOpen && stage.flask.hasContents}
            selected={flaskSelected}
            x={240}
            y={470}
            onSelect={interactive ? handleFlaskClick : undefined}
            selectHint={
              canSwirl
                ? "Activate to swirl."
                : "Activate to bring the flask's controls into the action panel."
            }
          />

          {/* The aliquot ware the PROCEDURE names: a measuring cylinder here, a
              pipette for a configuration that calls for one. */}
          {stage.portion.kind === "pipetted_volume" && stage.portion.vessel === "pipette" ? (
            <>
              <PipetteRackSvg x={400} y={556} />
              <PipetteSvg
                nominalVolumeMl={stage.portion.nominalVolumeMl}
                stage={aliquotStage}
                fillerAttached={fillerAttached}
                selected={selectedApparatusKey === "pipette"}
                x={414}
                y={400}
                onSelect={interactive ? handleAliquotVesselClick : undefined}
              />
            </>
          ) : null}
          {stage.portion.kind === "pipetted_volume" && stage.portion.vessel === "graduated_cylinder" ? (
            <GraduatedCylinderSvg
              nominalVolumeMl={stage.portion.nominalVolumeMl}
              stage={aliquotStage}
              selected={selectedApparatusKey === "graduated_cylinder"}
              x={412}
              y={392}
              onSelect={interactive ? handleAliquotVesselClick : undefined}
            />
          ) : null}

          <BeakerSvg x={490} y={564} fillFraction={0} />
          {interactive ? (
            <g
              role="button"
              tabIndex={0}
              aria-label="Beaker. Activate to bring up its guidance."
              onClick={() => setSelectedApparatusKey("beaker")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedApparatusKey("beaker");
                }
              }}
              className="cursor-pointer"
            >
              <rect x={486} y={560} width={58} height={78} rx={8} fill="transparent" />
            </g>
          ) : null}
          <VolumetricFlaskSvg x={556} y={520} />
          {interactive ? (
            <g
              role="button"
              tabIndex={0}
              aria-label="Volumetric flask. Activate to bring up its guidance."
              onClick={() => setSelectedApparatusKey("volumetric_flask")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedApparatusKey("volumetric_flask");
                }
              }}
              className="cursor-pointer"
            >
              <rect x={550} y={514} width={58} height={122} rx={8} fill="transparent" />
            </g>
          ) : null}

          {/* Balance with the weighing bottle */}
          <BalanceSvg
            recordedMassG={stage.portion.kind === "weighed_mass" ? stage.portion.recordedMassG : null}
            precisionG={stage.portion.kind === "weighed_mass" ? stage.portion.precision : 0.01}
            selected={selectedApparatusKey === "analytical_balance"}
            hasBottle={stage.portion.kind === "weighed_mass"}
            x={660}
            y={434}
            onSelect={
              interactive ? () => setSelectedApparatusKey("analytical_balance") : undefined
            }
          />
          <WeighingBottleSvg x={540} y={580} filled={stage.portion.kind === "weighed_mass" && stage.portion.recordedMassG !== null} />

          {/* Reagents */}
          {reagentBottles.map((bottle) => {
            const selected = selectedReagentKey === bottle.key;
            const onSelect = interactive ? () => setSelectedReagentKey(selected ? null : bottle.key) : undefined;
            if (bottle.kind === "dropper") {
              return (
                <DropperBottleSvg
                  key={bottle.key}
                  label={bottle.label}
                  selected={selected}
                  x={bottle.x}
                  y={22}
                  onSelect={onSelect}
                />
              );
            }
            if (bottle.kind === "wash") {
              return (
                <WashBottleSvg
                  key={bottle.key}
                  label={bottle.label}
                  selected={selected}
                  x={bottle.x}
                  y={22}
                  onSelect={onSelect}
                />
              );
            }
            return (
              <ReagentBottleSvg
                key={bottle.key}
                label={bottle.label}
                sublabel={bottle.key === stage.titrantKey ? "titrant" : "analyte"}
                selected={selected}
                x={bottle.x}
                y={22}
                onSelect={onSelect}
              />
            );
          })}

          <WasteContainerSvg x={916} y={546} discardedCount={discardedTotal} />
          {interactive ? (
            <g
              role="button"
              tabIndex={0}
              aria-label="Waste container. Activate to bring up its guidance."
              onClick={() => setSelectedApparatusKey("waste_container")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedApparatusKey("waste_container");
                }
              }}
              className="cursor-pointer"
            >
              <rect x={912} y={542} width={72} height={100} rx={8} fill="transparent" />
            </g>
          ) : null}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="neutral">Flask: {stage.flask.label}</Badge>
        <Badge tone="neutral">Stopcock: {stopcockOpen ? "open" : "closed"}</Badge>
        <Badge tone="neutral">
          Burette: {stage.burette.readingMl === null ? "not filled" : `${stage.burette.readingMl.toFixed(2)} mL`}
        </Badge>
        {selectedReagentKey ? (
          <span className="text-muted">
            Selected reagent:{" "}
            {reagentBottles.find((bottle) => bottle.key === selectedReagentKey)?.label ??
              selectedReagentKey}
          </span>
        ) : null}
        {swirl ? <span className="text-muted">Swirling.</span> : null}
        {pathOpen ? <span className="text-muted">Titrant path open.</span> : null}
        {/* Why the stopcock on the drawing does not respond yet. */}
        {stopcockReason ? <span className="text-warning">{stopcockReason}</span> : null}
        <span className="ms-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!focus.available}
            aria-describedby={describedBy(focusReasonId, focus)}
            onClick={() => setFocusedApparatus("burette")}
          >
            <Expand aria-hidden="true" className="size-4" />
            Enlarge burette
          </Button>
          <ControlReason id={focusReasonId} reason={focus.reason} />
        </span>
      </div>
    </div>
  );
}
