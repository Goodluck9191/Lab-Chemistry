"use client";

import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveStage, useLabServer, useLabUi, useLabViewModel } from "../lab-state-provider";
import { ControlReason, describedBy } from "../control-reason";
import { stopcockNotchFor } from "./simulation/stopcock";
import { FLASK_TILE_SLOT, FLASK_UNDER_BURETTE_SLOT } from "./simulation/spatial";
import { panSlot } from "./interactions/carry";
import {
  airBubbleAvailability,
  analytePortionAvailability,
  beakerWeighAvailability,
  buretteSetupAvailability,
  completionAvailability,
  conditionBuretteAvailability,
  dilutionAvailability,
  discardAvailability,
  dissolveAvailability,
  indicatorAvailability,
  mixSolutionAvailability,
  naohPortionAvailability,
  observationAvailability,
  placeFlaskAvailability,
  readingAvailability,
  rinseBeakerAvailability,
  rinseBuretteAvailability,
  startTrialAvailability,
  stopcockAvailability,
  stockMeasureAvailability,
  transferAvailability,
  type LabControlFlags,
} from "../control-availability";
import { ReadingInput, readingIsUsable } from "../reading-input";
import type { FlaskColour } from "@/domain/simulation/titration/endpoint";

/**
 * Contextual actions for the 3D laboratory view.
 *
 * The 3D meshes are for inspecting, positioning and pouring; THIS panel is what
 * makes the whole Experiment 2 playable without leaving the 3D view. Every
 * button sends the IDENTICAL protocol payload the 2D panels send, through the
 * same `perform()`, gated by the same `control-availability` rules that mirror
 * the engine. No chemistry logic lives here: availability text comes from the
 * shared helpers, validation happens server-side.
 *
 * Sections follow the bench selection (set by clicking 3D meshes or by the
 * picker below, which is also the keyboard-accessible selection path).
 */

const OBSERVE_COLOURS: FlaskColour[] = ["colourless", "faint_pink", "pink", "deep_pink"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line px-2 py-2">
      <p className="text-xs font-semibold">{title}</p>
      <div className="mt-1.5 flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function useFlags(): LabControlFlags {
  const { canWrite, pending } = useLabServer();
  const { activeStageKey, stopcockOpenForStage } = useLabUi();
  return { canWrite, pending, stopcockOpen: stopcockOpenForStage === activeStageKey };
}

function SolutionActions() {
  const solution = useLabViewModel().solution;
  const stage = useActiveStage();
  const { perform } = useLabServer();
  const flags = useFlags();
  const [stockVolume, setStockVolume] = useState("");
  const uid = useId();
  if (!solution.required) return null;
  const stageKey = stage?.key ?? null;
  const measure = stockMeasureAvailability(solution, flags);
  const dilute = dilutionAvailability(solution, flags);
  const mix = mixSolutionAvailability(solution, flags);
  return (
    <Section title="Part I — working solution">
      <div className="flex flex-wrap items-end gap-2">
        <ReadingInput
          id={`${uid}-3d-stock`}
          label="Stock volume measured"
          kind="volume"
          value={stockVolume}
          onChange={setStockVolume}
          disabled={!flags.canWrite || flags.pending}
          className="w-40"
        />
        <Button
          size="sm"
          disabled={!measure.available || stageKey === null || !readingIsUsable(stockVolume, "volume")}
          aria-describedby={describedBy(`${uid}-3d-stock-r`, measure)}
          onClick={async () => {
            if (stageKey === null) return;
            await perform({ type: "measure_naoh_stock", stageKey, observedVolumeMl: Number(stockVolume) });
            setStockVolume("");
          }}
        >
          Record stock
        </Button>
      </div>
      <ControlReason id={`${uid}-3d-stock-r`} reason={measure.reason} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!dilute.available || stageKey === null}
          aria-describedby={describedBy(`${uid}-3d-dilute-r`, dilute)}
          onClick={() => (stageKey === null ? undefined : void perform({ type: "dilute_naoh_solution", stageKey }))}
        >
          Add distilled water
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!mix.available || stageKey === null}
          aria-describedby={describedBy(`${uid}-3d-mix-r`, mix)}
          onClick={() => (stageKey === null ? undefined : void perform({ type: "mix_naoh_solution", stageKey }))}
        >
          Stopper and swirl
        </Button>
      </div>
      <ControlReason id={`${uid}-3d-dilute-r`} reason={dilute.reason} />
      <ControlReason id={`${uid}-3d-mix-r`} reason={mix.reason} />
    </Section>
  );
}

function BuretteActions() {
  const stage = useActiveStage();
  const solution = useLabViewModel().solution;
  const { perform } = useLabServer();
  const {
    activeStageKey,
    toggleStopcock,
    stopcockAngleForStage,
    readingMode,
    setReadingMode,
  } = useLabUi();
  const flags = useFlags();
  const [initial, setInitial] = useState("");
  const [trialInitial, setTrialInitial] = useState("");
  const [final, setFinal] = useState("");
  const [claimed, setClaimed] = useState<FlaskColour>("faint_pink");
  const uid = useId();
  if (!stage) return null;

  const rinse = rinseBuretteAvailability(stage, flags);
  const portion = naohPortionAvailability(stage, solution, flags);
  const condition = conditionBuretteAvailability(stage, flags);
  const setup = buretteSetupAvailability(flags);
  const bubble = airBubbleAvailability(stage, flags);
  const start = startTrialAvailability(stage, flags);
  const observe = observationAvailability(stage, flags);
  const reading = readingAvailability(stage, flags);
  const completion = completionAvailability(stage, flags);
  const openTrial = stage.openTrial;

  const valveAngle = stopcockAngleForStage(stage.key);
  const valve = stopcockNotchFor(valveAngle);
  // The valve is only a control when the domain would accept a delivery behind
  // it; otherwise it explains itself instead of turning and doing nothing.
  const valveRule = stopcockAvailability(stage, {
    canWrite: flags.canWrite,
    pending: flags.pending,
    stopcockOpen: valve.flowMode !== null,
  });

  return (
    <Section title="Burette">
      {/* The valve, reachable without a steady hand on the 3D handle. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Stopcock: {valve.label}</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!valveRule.available}
          aria-describedby={describedBy(`${uid}-v`, valveRule)}
          onClick={() => toggleStopcock(stage.key)}
        >
          {valve.flowMode === null ? "Open the stopcock" : "Turn the stopcock"}
        </Button>
        <ControlReason id={`${uid}-v`} reason={valveRule.reason} />
        <Button
          size="sm"
          variant={readingMode ? "primary" : "secondary"}
          aria-pressed={readingMode}
          onClick={() => setReadingMode(!readingMode)}
        >
          Reading mode
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!rinse.available} aria-describedby={describedBy(`${uid}-r`, rinse)} onClick={() => void perform({ type: "rinse_burette", stageKey: stage.key })}>
          Rinse with tap water
        </Button>
        <Button size="sm" variant="secondary" disabled={!portion.available} aria-describedby={describedBy(`${uid}-p`, portion)} onClick={() => void perform({ type: "obtain_naoh_portion", stageKey: stage.key })}>
          Obtain NaOH portion
        </Button>
        <Button size="sm" variant="secondary" disabled={!condition.available} aria-describedby={describedBy(`${uid}-c`, condition)} onClick={() => void perform({ type: "condition_burette", stageKey: stage.key })}>
          Condition ({stage.preparationState.conditioningRinses}/3)
        </Button>
        <Button size="sm" variant="secondary" disabled={!bubble.available} aria-describedby={describedBy(`${uid}-b`, bubble)} onClick={() => void perform({ type: "clear_air_bubble", stageKey: stage.key })}>
          Expel air bubble
        </Button>
      </div>
      <ControlReason id={`${uid}-r`} reason={rinse.reason} />
      <ControlReason id={`${uid}-p`} reason={portion.reason} />
      <ControlReason id={`${uid}-c`} reason={condition.reason} />
      <ControlReason id={`${uid}-b`} reason={bubble.reason} />
      <div className="flex flex-wrap items-end gap-2">
        <ReadingInput id={`${uid}-fill`} label="Initial reading" kind="burette" value={initial} onChange={setInitial} disabled={!flags.canWrite || flags.pending} className="w-36" />
        <Button size="sm" disabled={!setup.available || !readingIsUsable(initial, "burette")} onClick={async () => { await perform({ type: "setup_apparatus", stageKey: stage.key, titrantKey: stage.titrantKey, initialReadingMl: Number(initial) }); setInitial(""); }}>
          Fill burette
        </Button>
      </div>
      {stage.nextTrialNumber !== null && !openTrial ? (
        <div className="flex flex-wrap items-end gap-2">
          <ReadingInput id={`${uid}-start`} label={`Trial ${stage.nextTrialNumber} initial`} kind="burette" value={trialInitial} onChange={setTrialInitial} disabled={!flags.canWrite || flags.pending} className="w-36" />
          <Button size="sm" disabled={!start.available || !readingIsUsable(trialInitial, "burette")} aria-describedby={describedBy(`${uid}-s`, start)} onClick={async () => { await perform({ type: "start_trial", stageKey: stage.key, trialNumber: stage.nextTrialNumber, initialReadingMl: Number(trialInitial) }); setTrialInitial(""); }}>
            Start trial {stage.nextTrialNumber}
          </Button>
        </div>
      ) : null}
      <ControlReason id={`${uid}-s`} reason={start.reason} />
      {openTrial ? (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted">Endpoint colour:</span>
            {OBSERVE_COLOURS.map((colour) => (
              <Button key={colour} size="sm" variant={claimed === colour ? "primary" : "secondary"} aria-pressed={claimed === colour} disabled={!observe.available} onClick={() => setClaimed(colour)}>
                {colour.replace(/_/g, " ")}
              </Button>
            ))}
            <Button size="sm" disabled={!observe.available} aria-describedby={describedBy(`${uid}-o`, observe)} onClick={() => void perform({ type: "observe_endpoint", stageKey: activeStageKey, claimedColour: claimed })}>
              Record
            </Button>
          </div>
          <ControlReason id={`${uid}-o`} reason={observe.reason} />
          <div className="flex flex-wrap items-end gap-2">
            <ReadingInput id={`${uid}-final`} label="Final reading" kind="burette" value={final} onChange={setFinal} disabled={!flags.canWrite || flags.pending} className="w-36" />
            <Button size="sm" disabled={!reading.available || !readingIsUsable(final, "burette")} aria-describedby={describedBy(`${uid}-rd`, reading)} onClick={async () => { await perform({ type: "read_burette", stageKey: activeStageKey, observedFinalMl: Number(final) }); setFinal(""); }}>
              Record final
            </Button>
            <Button size="sm" variant="secondary" disabled={!completion.available} aria-describedby={describedBy(`${uid}-cp`, completion)} onClick={() => void perform({ type: "complete_trial", stageKey: activeStageKey })}>
              Complete trial
            </Button>
          </div>
          <ControlReason id={`${uid}-rd`} reason={reading.reason} />
          <ControlReason id={`${uid}-cp`} reason={completion.reason} />
        </>
      ) : null}
    </Section>
  );
}

function WeighingActions() {
  const stage = useActiveStage();
  const { perform } = useLabServer();
  const flags = useFlags();
  const { setBeakerPos, beakerPos } = useLabUi();
  const [mass, setMass] = useState("");
  const uid = useId();
  if (!stage || stage.portion.kind !== "weighed_mass") return null;
  const weigh = beakerWeighAvailability(stage, flags);
  const dissolve = dissolveAvailability(stage, flags);
  const transfer = transferAvailability(stage, flags);
  const rinseBeaker = rinseBeakerAvailability(stage, flags);
  const firstDone = stage.preparationState.beakerMassG !== null;
  return (
    <Section title="Balance & beaker — KHP by difference">
      <div className="flex flex-wrap items-end gap-2">
        <ReadingInput id={`${uid}-mass`} label={firstDone ? "Beaker + KHP (g)" : "Empty beaker (g)"} kind="mass" value={mass} onChange={setMass} disabled={!flags.canWrite || flags.pending} className="w-40" />
        <Button size="sm" disabled={!weigh.available || !readingIsUsable(mass, "mass")} aria-describedby={describedBy(`${uid}-w`, weigh)} onClick={async () => { await perform({ type: "weigh_beaker", stageKey: stage.key, observedMassG: Number(mass) }); setMass(""); }}>
          Record weighing
        </Button>
      </div>
      <ControlReason id={`${uid}-w`} reason={weigh.reason} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!flags.canWrite || flags.pending}
          onClick={() => setBeakerPos(panSlot())}
        >
          Set the beaker on the balance
        </Button>
        {/* Physical honesty: a balance reads what is on its pan, so say so
            rather than letting the student record a mass for a beaker that is
            still across the bench. */}
        {beakerPos === null ? (
          <span className="text-xs text-muted">
            The beaker is on its resting spot — set it on the pan to take a reading.
          </span>
        ) : (
          <span className="text-xs text-muted">The beaker is on the pan.</span>
        )}
        <Button size="sm" variant="secondary" disabled={!dissolve.available} aria-describedby={describedBy(`${uid}-d`, dissolve)} onClick={() => void perform({ type: "dissolve_khp", stageKey: stage.key })}>
          Dissolve KHP
        </Button>
        <Button size="sm" variant="secondary" disabled={!transfer.available} aria-describedby={describedBy(`${uid}-t`, transfer)} onClick={() => void perform({ type: "transfer_solution", stageKey: stage.key })}>
          Transfer to flask
        </Button>
        <Button size="sm" variant="secondary" disabled={!rinseBeaker.available} aria-describedby={describedBy(`${uid}-rb`, rinseBeaker)} onClick={() => void perform({ type: "rinse_beaker", stageKey: stage.key })}>
          Rinse beaker ({stage.preparationState.beakerRinses}/2)
        </Button>
      </div>
      <ControlReason id={`${uid}-d`} reason={dissolve.reason} />
      <ControlReason id={`${uid}-t`} reason={transfer.reason} />
      <ControlReason id={`${uid}-rb`} reason={rinseBeaker.reason} />
    </Section>
  );
}

function AliquotActions() {
  const stage = useActiveStage();
  const { perform } = useLabServer();
  const flags = useFlags();
  const [volume, setVolume] = useState("");
  const uid = useId();
  if (!stage || stage.portion.kind !== "pipetted_volume") return null;
  const availability = analytePortionAvailability(stage, flags);
  return (
    <Section title="Measuring cylinder — HCl aliquot">
      <div className="flex flex-wrap items-end gap-2">
        <ReadingInput id={`${uid}-aliquot`} label="Aliquot delivered (mL)" kind="volume" value={volume} onChange={setVolume} disabled={!flags.canWrite || flags.pending} className="w-40" />
        <Button size="sm" disabled={!availability.available || !readingIsUsable(volume, "volume")} aria-describedby={describedBy(`${uid}-a`, availability)} onClick={async () => { await perform({ type: "pipette_analyte", stageKey: stage.key, observedVolumeMl: Number(volume) }); setVolume(""); }}>
          Record aliquot
        </Button>
      </div>
      <ControlReason id={`${uid}-a`} reason={availability.reason} />
    </Section>
  );
}

function IndicatorActions() {
  const stage = useActiveStage();
  const { selectedReagentKey } = useLabUi();
  const { perform } = useLabServer();
  const flags = useFlags();
  const [drops, setDrops] = useState(3);
  const uid = useId();
  if (!stage) return null;
  // Bench selection is mutually exclusive: choosing a reagent clears the
  // apparatus key, so this section keys off the reagent itself.
  if (selectedReagentKey !== stage.indicator.key) return null;
  const availability = indicatorAvailability(stage, flags);
  const dropsUsable = Number.isInteger(drops) && drops >= 1 && drops <= 20;
  return (
    <Section title={`${stage.indicator.name} — ${stage.indicator.dropsRange[0]}–${stage.indicator.dropsRange[1]} drops`}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-2 text-sm">
          Drops
          <input
            type="number"
            min={1}
            max={20}
            value={drops}
            disabled={!flags.canWrite || flags.pending}
            onChange={(event) => setDrops(Number(event.target.value))}
            className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm"
            aria-label="Number of indicator drops"
          />
        </label>
        <Button size="sm" disabled={!availability.available || !dropsUsable} aria-describedby={describedBy(`${uid}-i`, availability)} onClick={() => void perform({ type: "add_indicator", stageKey: stage.key, drops })}>
          Add drops
        </Button>
      </div>
      <ControlReason id={`${uid}-i`} reason={availability.reason} />
    </Section>
  );
}

function FlaskActions() {
  const stage = useActiveStage();
  const { perform } = useLabServer();
  const flags = useFlags();
  const uid = useId();
  const {
    swirl,
    setSwirl,
    stirring,
    setStirring,
    setFlaskPos,
    carried,
    setCarried,
  } = useLabUi();
  if (!stage) return null;
  const place = placeFlaskAvailability(stage, flags);
  const discard = discardAvailability(stage, flags);
  return (
    <Section title="Erlenmeyer flask">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!place.available} aria-describedby={describedBy(`${uid}-pl`, place)} onClick={() => void perform({ type: "place_flask", stageKey: stage.key })}>
          Place under burette
        </Button>
        <Button size="sm" variant="secondary" disabled={!discard.available} aria-describedby={describedBy(`${uid}-di`, discard)} onClick={() => void perform({ type: "discard_to_waste", stageKey: stage.key })}>
          Discard into waste
        </Button>
      </div>
      {/* Handling: the same physical moves the mouse can make, on buttons. */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={swirl ? "primary" : "secondary"}
          aria-pressed={swirl}
          onClick={() => setSwirl((current) => !current)}
        >
          {swirl ? "Stop swirling" : "Swirl the flask"}
        </Button>
        <Button
          size="sm"
          variant={stirring ? "primary" : "secondary"}
          aria-pressed={stirring}
          onClick={() => setStirring(!stirring)}
        >
          {stirring ? "Stop stirring" : "Stir with the rod"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!flags.canWrite || flags.pending}
          onClick={() => setCarried(carried === "flask" ? null : "flask")}
        >
          {carried === "flask" ? "Set the flask down" : "Pick the flask up"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!flags.canWrite || flags.pending}
          onClick={() => {
            setFlaskPos({ ...FLASK_UNDER_BURETTE_SLOT });
            setCarried(null);
          }}
        >
          Stand it under the burette
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!flags.canWrite || flags.pending}
          onClick={() => {
            setFlaskPos({ ...FLASK_TILE_SLOT });
            setCarried(null);
          }}
        >
          Return it to the tile
        </Button>
      </div>
      <ControlReason id={`${uid}-pl`} reason={place.reason} />
      <ControlReason id={`${uid}-di`} reason={discard.reason} />
    </Section>
  );
}

function ReportActions() {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const [values, setValues] = useState<Record<number, string>>({});
  if (!stage) return null;
  const unreported = stage.trials.filter(
    (trial: (typeof stage.trials)[number]) => trial.status === "recorded" && trial.reportedMolarityM === null,
  );
  if (unreported.length === 0) return null;
  const disabled = !canWrite || pending;
  return (
    <Section title="Report concentrations">
      {unreported.map((trial) => {
        const value = values[trial.trialNumber] ?? "";
        return (
          <div key={trial.trialNumber} className="flex flex-wrap items-end gap-2">
            <ReadingInput id={`3d-report-${trial.trialNumber}`} label={`Trial ${trial.trialNumber} (mol/L)`} kind="concentration" value={value} onChange={(next: string) => setValues((current) => ({ ...current, [trial.trialNumber]: next }))} disabled={disabled} className="w-40" />
            <Button size="sm" disabled={disabled || !readingIsUsable(value, "concentration")} onClick={async () => { await perform({ type: "report_molarity", stageKey: stage.key, trialNumber: trial.trialNumber, studentMolarityM: Number(value) }); setValues((current) => ({ ...current, [trial.trialNumber]: "" })); }}>
              Submit trial {trial.trialNumber}
            </Button>
          </div>
        );
      })}
    </Section>
  );
}

/**
 * Compact trial/concordance readout for the 3D view header. Numbers come from
 * the server-computed concordance in the view model — the same object the
 * grading path reads. Rejected trials are named so the student sees they are
 * excluded from the average.
 */
export function Lab3DConcordanceStrip() {
  const stage = useActiveStage();
  if (!stage) return null;
  const concordance = stage.concordance;
  const status =
    concordance.status === "concordant"
      ? "Concordant"
      : concordance.status === "not_concordant"
        ? "Additional trial required"
        : concordance.status === "insufficient_evidence"
          ? `Need ${concordance.trialsStillNeeded} more`
          : "Not started";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" role="status" aria-label="Trial progress">
      <Badge tone={concordance.status === "concordant" ? "success" : "neutral"}>
        Trial {Math.min(concordance.recordedTrials + 1, concordance.requiredTrials + 1)} · {concordance.recordedTrials}/{concordance.requiredTrials} recorded
      </Badge>
      <Badge tone={concordance.status === "concordant" ? "success" : concordance.status === "not_concordant" ? "warning" : "neutral"}>
        {status}
      </Badge>
      {concordance.averageMolarityM !== null ? (
        <span className="text-muted">Avg (two closest): <span className="font-medium tabular-nums">{concordance.averageMolarityM} mol/L</span></span>
      ) : null}
      {concordance.discardedTrials.length > 0 ? (
        <span className="text-muted">Rejected: {concordance.discardedTrials.join(", ")} (excluded)</span>
      ) : null}
    </div>
  );
}

const PICKER: Array<{ key: string; label: string }> = [
  { key: "burette", label: "Burette" },
  { key: "conical_flask", label: "Flask" },
  { key: "analytical_balance", label: "Balance" },
  { key: "beaker", label: "Beaker" },
  { key: "graduated_cylinder", label: "Cylinder" },
  { key: "volumetric_flask", label: "Prep flask" },
  { key: "waste_container", label: "Waste" },
  { key: "reagent_bottle", label: "Reagents" },
];

export function Lab3DActions({ reagents }: { reagents: Array<{ key: string; label: string }> }) {
  const { selectedApparatusKey, setSelectedApparatusKey, selectedReagentKey, setSelectedReagentKey } = useLabUi();
  const solution = useLabViewModel().solution;
  const showSolution =
    (solution.required && !solution.ready) ||
    selectedApparatusKey === "volumetric_flask" ||
    (selectedReagentKey !== null && selectedReagentKey === solution.stockKey);

  return (
    <div className="flex flex-col gap-2" aria-label="3D contextual actions">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Select apparatus">
        <span className="text-xs font-semibold">Work with:</span>
        {PICKER.map((entry) => (
          <Button
            key={entry.key}
            size="sm"
            variant={selectedApparatusKey === entry.key ? "primary" : "secondary"}
            aria-pressed={selectedApparatusKey === entry.key}
            onClick={() => setSelectedApparatusKey(entry.key)}
          >
            {entry.label}
          </Button>
        ))}
        {selectedReagentKey ? <Badge tone="neutral">Reagent: {selectedReagentKey.replace(/_/g, " ")}</Badge> : null}
      </div>
      {/* The shelf is always reachable from the prompt: a student should be
          able to take a reagent off it without first selecting the bottle. */}
      {reagents.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Choose reagent">
          <span className="text-xs text-muted">Reagent:</span>
          {reagents.map((reagent) => (
            <Button
              key={reagent.key}
              size="sm"
              variant={selectedReagentKey === reagent.key ? "primary" : "secondary"}
              aria-pressed={selectedReagentKey === reagent.key}
              onClick={() => {
                setSelectedReagentKey(reagent.key);
              }}
            >
              {reagent.label}
            </Button>
          ))}
        </div>
      ) : null}

      {(showSolution || selectedApparatusKey === "volumetric_flask") ? <SolutionActions /> : null}
      {selectedApparatusKey === "burette" ? <BuretteActions /> : null}
      {selectedApparatusKey === "analytical_balance" || selectedApparatusKey === "beaker" ? <WeighingActions /> : null}
      {selectedApparatusKey === "graduated_cylinder" ? <AliquotActions /> : null}
      <IndicatorActions />
      {selectedApparatusKey === "conical_flask" ? <FlaskActions /> : null}
      <ReportActions />
    </div>
  );
}
