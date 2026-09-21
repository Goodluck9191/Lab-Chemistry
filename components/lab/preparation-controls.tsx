"use client";

import { useId, useState } from "react";
import { Droplet, FlaskConical, Scale, Wrench } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveStage, useLabServer, useLabUi, useLabViewModel } from "./lab-state-provider";
import { ControlReason, describedBy } from "./control-reason";
import {
  airBubbleAvailability,
  analytePortionAvailability,
  beakerWeighAvailability,
  buretteSetupAvailability,
  conditionBuretteAvailability,
  CONTROL_REASONS,
  dilutionAvailability,
  dissolveAvailability,
  indicatorAvailability,
  mixSolutionAvailability,
  naohPortionAvailability,
  placeFlaskAvailability,
  rinseBeakerAvailability,
  rinseBuretteAvailability,
  stockMeasureAvailability,
  transferAvailability,
} from "./control-availability";
import { ALIQUOT_VESSEL_COPY } from "./view-model";
import { ReadingInput, readingIsUsable } from "./reading-input";
import type { LabStateView } from "@/application/attempts/lab-state";

/**
 * Preparation controls: burette setup, weighing or pipetting the analyte, and
 * adding the indicator.
 *
 * Each control sends exactly one protocol action through the action controller.
 * Two deliberate properties:
 *
 *  - The weighing reading is ENTERED, not generated. The engine has no
 *    action that returns an instrument reading, so the bench shows the mass the
 *    student recorded and the server stores and validates exactly that number.
 *    Nothing is invented in the browser.
 *  - Only apparatus and reagents named by the configuration are offered, and the
 *    server still decides whether a choice is valid (a wrong titrant is rejected
 *    with `wrong_reagent`).
 *
 * The sections are exported individually so the contextual instrument panel can
 * show the block for the selected apparatus; `PreparationControls` assembles
 * all three for the full preparation view.
 */
export function PreparationControls({ initialState }: { initialState: LabStateView }) {
  const { canWrite } = useLabServer();
  return (
    <section aria-label="Preparation" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Prepare the apparatus</h3>
      <SolutionPreparationSection />
      <BurettePreparationSection />
      <BuretteSetupSection initialState={initialState} />
      <AnalyteSection initialState={initialState} />
      <IndicatorSection />
      <FlaskPlacementSection />
      {!canWrite ? (
        <Alert tone="info" title="Read-only attempt">
          This attempt has been submitted, so preparation steps are disabled.
        </Alert>
      ) : null}
    </section>
  );
}

/**
 * Burette cleaning, conditioning and air-bubble removal (manual Part 2
 * preparation). Each button sends one counted protocol action; the repeat
 * counts live server-side, so a reload resumes mid-sequence honestly.
 */
/**
 * Part I: prepare approximately 0.2 M NaOH from the 2 M stock solution.
 *
 * The three steps are the procedure's own: measure the stock, dilute it, stopper
 * and swirl to mix. The recorded stock volume is EVIDENCE the step was done — it
 * deliberately does not set the working concentration, which the configuration
 * states as approximately 0.2 M and the attempt's hidden truth refines.
 */
export function SolutionPreparationSection() {
  const solution = useLabViewModel().solution;
  const { perform, pending, canWrite } = useLabServer();
  const [stockVolume, setStockVolume] = useState("");
  const uid = useId();
  const measureReasonId = `${uid}-measure-reason`;
  const diluteReasonId = `${uid}-dilute-reason`;
  const mixReasonId = `${uid}-mix-reason`;
  // Hooks run before the early return: the section renders nothing at all for
  // an experiment whose titrant is ready-made.
  const stageKey = useActiveStage()?.key ?? null;

  if (!solution.required) return null;

  const flags = { canWrite, pending };
  const measure = stockMeasureAvailability(solution, flags);
  const dilute = dilutionAvailability(solution, flags);
  const mix = mixSolutionAvailability(solution, flags);
  const blocked = !canWrite || pending || stageKey === null;

  const status =
    `Working solution · stock ${solution.stockVolumeMl === null ? "not measured" : `${solution.stockVolumeMl} mL`}` +
    ` · ${solution.diluted ? "diluted" : "not diluted"}` +
    ` · ${solution.mixed ? "mixed" : "not mixed"}`;
  const next = blocked
    ? null
    : solution.stockVolumeMl === null
      ? `Measure the ${solution.stockMolarityM} M stock solution in the cylinder.`
      : !solution.diluted
        ? "Add distilled water to complete the dilution."
        : !solution.mixed
          ? "Stopper as far as possible and swirl to mix."
          : "The working solution is ready for the burette.";

  return (
    <div className="rounded-md border border-line px-3 py-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <FlaskConical aria-hidden="true" className="size-4 text-muted" />
        1. Prepare the working NaOH solution
      </p>
      <p className="mt-1 text-xs text-muted">
        Measure the {solution.stockMolarityM} M stock solution with the measuring cylinder, add
        distilled water to dilute it to about {solution.nominalWorkingMolarityM} M, then stopper the
        flask as far as possible and swirl to mix.
      </p>
      <InstrumentGuide status={status} next={next} />
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <ReadingInput
          id={`stock-${uid}`}
          label="Stock solution measured"
          kind="volume"
          value={stockVolume}
          onChange={setStockVolume}
          disabled={blocked || solution.stockVolumeMl !== null}
          hint="Record the volume you measured off the cylinder."
          className="w-48"
        />
        <Button
          size="sm"
          variant={solution.stockVolumeMl !== null ? "primary" : "secondary"}
          disabled={
            !measure.available || stageKey === null || !readingIsUsable(stockVolume, "volume")
          }
          aria-describedby={describedBy(measureReasonId, measure)}
          onClick={async () => {
            if (stageKey === null) return;
            await perform({
              type: "measure_naoh_stock",
              stageKey,
              observedVolumeMl: Number(stockVolume),
            });
            setStockVolume("");
          }}
        >
          Record stock volume
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={solution.diluted ? "primary" : "secondary"}
          disabled={!dilute.available || stageKey === null}
          aria-describedby={describedBy(diluteReasonId, dilute)}
          onClick={() =>
            stageKey === null ? undefined : void perform({ type: "dilute_naoh_solution", stageKey })
          }
        >
          Add distilled water
        </Button>
        <Button
          size="sm"
          variant={solution.mixed ? "primary" : "secondary"}
          disabled={!mix.available || stageKey === null}
          aria-describedby={describedBy(mixReasonId, mix)}
          onClick={() =>
            stageKey === null ? undefined : void perform({ type: "mix_naoh_solution", stageKey })
          }
        >
          Stopper and swirl
        </Button>
      </div>
      <ControlReason id={measureReasonId} reason={measure.reason} className="mt-1" />
      <ControlReason id={diluteReasonId} reason={dilute.reason} className="mt-1" />
      <ControlReason id={mixReasonId} reason={mix.reason} className="mt-1" />
    </div>
  );
}

/**
 * Clean the burette, obtain the NaOH portion the procedure covers with a watch
 * glass, then condition it. The conditioning rinses ARE that portion, which is
 * why the portion is a step rather than a sentence.
 */
export function BurettePreparationSection() {
  const stage = useActiveStage();
  const solution = useLabViewModel().solution;
  const { perform, pending, canWrite } = useLabServer();
  const uid = useId();

  if (!stage) return null;

  const flags = { canWrite, pending };
  const prep = stage.preparationState;
  const rinse = rinseBuretteAvailability(stage, flags);
  const portion = naohPortionAvailability(stage, solution, flags);
  const condition = conditionBuretteAvailability(stage, flags);
  const bubble = airBubbleAvailability(stage, flags);

  const status =
    `Burette · ${prep.buretteCleaned ? "cleaned" : "not cleaned"}` +
    ` · beaker ${prep.beakerObtained ? "filled" : "empty"}` +
    ` · conditioning ${prep.conditioningRinses}/3` +
    ` · tip ${prep.airBubbleCleared ? "cleared" : "not cleared"}`;
  const blocked = !canWrite || pending;
  const next = blocked
    ? null
    : !prep.buretteCleaned
      ? "Rinse the burette with tap water."
      : !prep.beakerObtained
        ? "Obtain the NaOH solution in a clean, dry beaker."
        : prep.conditioningRinses < 3
          ? "Condition the burette with NaOH, three times."
          : !stage.burette.setup
            ? null
            : !prep.airBubbleCleared
              ? "Clear the air bubble from the tip."
              : null;

  return (
    <div className="rounded-md border border-line px-3 py-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Wrench aria-hidden="true" className="size-4 text-muted" />
        2. Clean, fill and condition the burette
      </p>
      <p className="mt-1 text-xs text-muted">
        Rinse with tap water, obtain about 120 mL of the prepared solution in a clean, dry beaker
        under a watch glass, then rinse with three ~5 mL portions of NaOH. Fill the burette in the
        next section then clear the tip.
      </p>
      <InstrumentGuide status={status} next={next} />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={prep.buretteCleaned ? "primary" : "secondary"}
          disabled={!rinse.available}
          aria-describedby={rinse.reason ? `${uid}-rinse-reason` : undefined}
          onClick={() => void perform({ type: "rinse_burette", stageKey: stage.key })}
        >
          Rinse with tap water
        </Button>
        <Button
          size="sm"
          variant={prep.beakerObtained ? "primary" : "secondary"}
          disabled={!portion.available}
          aria-describedby={portion.reason ? `${uid}-portion-reason` : undefined}
          onClick={() => void perform({ type: "obtain_naoh_portion", stageKey: stage.key })}
        >
          Obtain NaOH in beaker
        </Button>
        <Button
          size="sm"
          variant={prep.conditioningRinses > 0 ? "primary" : "secondary"}
          disabled={!condition.available}
          aria-describedby={condition.reason ? `${uid}-condition-reason` : undefined}
          onClick={() => void perform({ type: "condition_burette", stageKey: stage.key })}
        >
          {prep.conditioningRinses >= 3
            ? "Conditioned (3/3)"
            : `Condition with NaOH (${prep.conditioningRinses}/3)`}
        </Button>
        <Button
          size="sm"
          variant={prep.airBubbleCleared ? "primary" : "secondary"}
          disabled={!bubble.available}
          aria-describedby={bubble.reason ? `${uid}-bubble-reason` : undefined}
          onClick={() => void perform({ type: "clear_air_bubble", stageKey: stage.key })}
        >
          Clear air bubble
        </Button>
      </div>
      <ControlReason id={`${uid}-rinse-reason`} reason={rinse.reason} className="mt-1" />
      <ControlReason id={`${uid}-portion-reason`} reason={portion.reason} className="mt-1" />
      <ControlReason id={`${uid}-condition-reason`} reason={condition.reason} className="mt-1" />
      <ControlReason id={`${uid}-bubble-reason`} reason={bubble.reason} className="mt-1" />
    </div>
  );
}

export function BuretteSetupSection({ initialState }: { initialState: LabStateView }) {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const { selectedReagentKey, setSelectedReagentKey } = useLabUi();
  const [initialReading, setInitialReading] = useState("");
  const uid = useId();
  const reasonId = `${uid}-burette-setup-reason`;

  if (!stage) return null;

  const titrantLabel = initialState.chemicalLabels[stage.titrantKey] ?? stage.titrantKey;
  const disabled = !canWrite || pending || stage.locked;
  const titrantSelected = selectedReagentKey === stage.titrantKey;
  // `buretteSetupAvailability` is stage-agnostic (rinsing is always the same
  // motion), so the stage-order lock is applied here at the call site.
  const availability = stage.locked
    ? { available: false, reason: CONTROL_REASONS.stageLocked }
    : buretteSetupAvailability({ canWrite, pending });

  return (
    <div className="rounded-md border border-line px-3 py-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Wrench aria-hidden="true" className="size-4 text-muted" />
        3. Fill the burette and record the initial reading
      </p>
      <p className="mt-1 text-xs text-muted">
        Burette, {stage.burette.capacityMl} mL, graduated to {stage.burette.graduationMl} mL.
        Readings are recorded to {stage.burette.readingPrecisionMl} mL.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={titrantSelected ? "primary" : "secondary"}
          aria-pressed={titrantSelected}
          disabled={disabled}
          onClick={() => setSelectedReagentKey(titrantSelected ? null : stage.titrantKey)}
        >
          {titrantSelected ? `Selected: ${titrantLabel}` : `Select ${titrantLabel}`}
        </Button>
        {stage.burette.setup ? <Badge tone="success">Filled</Badge> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <ReadingInput
          id={`initial-${stage.key}`}
          label="Initial burette reading"
          kind="burette"
          value={initialReading}
          onChange={setInitialReading}
          disabled={disabled}
          className="w-48"
        />
        <Button
          size="sm"
          disabled={
            !availability.available || !initialReading || !readingIsUsable(initialReading, "burette")
          }
          aria-describedby={describedBy(reasonId, availability)}
          onClick={async () => {
            const parsed = Number(initialReading);
            await perform({
              type: "setup_apparatus",
              stageKey: stage.key,
              titrantKey: stage.titrantKey,
              initialReadingMl: parsed,
            });
            setInitialReading("");
          }}
        >
          Fill burette
        </Button>
        <ControlReason id={reasonId} reason={availability.reason} className="w-full" />
      </div>
      {stage.burette.readingMl !== null ? (
        <p className="mt-2 text-xs text-muted">
          Meniscus is drawn near {stage.burette.readingMl.toFixed(2)} mL on the scale. Read it
          yourself before recording.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Instrument status and next-step guidance (§44: what am I using, what state
 * is it in, what can I do, what next). Purely descriptive: every line reflects
 * UI guide state or authoritative state, never an invented measurement.
 */
function InstrumentGuide({ status, next }: { status: string; next: string | null }) {
  return (
    <div className="mt-2 rounded border border-line bg-surface-muted/40 px-2 py-1.5 text-xs">
      <p>
        <span className="font-medium">Status:</span> {status}
      </p>
      {next ? (
        <p className="mt-0.5 text-muted">
          <span className="font-medium text-foreground">Next:</span> {next}
        </p>
      ) : null}
    </div>
  );
}

function BalanceGuide({
  balanceStep,
  availabilityAvailable,
}: {
  balanceStep: "none" | "empty" | "tared" | "loaded";
  availabilityAvailable: boolean;
}) {
  const status =
    balanceStep === "none"
      ? "Balance · weighing bottle missing"
      : balanceStep === "empty"
        ? "Balance · bottle on the pan · not tared"
        : balanceStep === "tared"
          ? "Balance · tared · reads 0.00 g until the sample is added"
          : "Balance · sample added · read the display";
  const next = !availabilityAvailable
    ? null
    : balanceStep === "none"
      ? "Place the weighing bottle on the pan."
      : balanceStep === "empty"
        ? "Tare the balance to zero."
        : balanceStep === "tared"
          ? "Add the standard, then read the display."
          : "Read the display and enter each weighing below.";
  return <InstrumentGuide status={status} next={next} />;
}

/**
 * Guided aliquot flow, worded for whichever ware the configuration names. The
 * pipette's extra safety step (attach the filler; never pipette by mouth) only
 * exists for a pipette — a measuring cylinder has no filler to attach.
 */
function AliquotGuide({
  vessel,
  aliquotStage,
  fillerAttached,
  availabilityAvailable,
}: {
  vessel: "graduated_cylinder" | "pipette";
  aliquotStage: "resting" | "measured" | "delivered";
  fillerAttached: boolean;
  availabilityAvailable: boolean;
}) {
  const isPipette = vessel === "pipette";
  const contents =
    aliquotStage === "measured" ? "Filled" : aliquotStage === "delivered" ? "Delivered" : "Empty";
  const next = !availabilityAvailable
    ? null
    : isPipette && !fillerAttached
      ? "Attach the pipette filler."
      : aliquotStage === "resting"
        ? isPipette
          ? "Draw the solution up to the mark."
          : "Pour the solution into the cylinder up to the mark."
        : aliquotStage === "measured"
          ? "Deliver into the conical flask."
          : "Enter the volume you delivered and record it.";
  const status = isPipette
    ? `Pipette · filler ${fillerAttached ? "attached" : "not attached"} · ${contents}`
    : `Measuring cylinder · ${contents}`;
  return <InstrumentGuide status={status} next={next} />;
}

/**
 * The two by-difference weighings. Each reading is entered and recorded
 * separately; the laboratory derives the sample mass from the difference, so
 * the student can never set it directly.
 */
function WeighBeakerInputs() {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const [emptyReading, setEmptyReading] = useState("");
  const [fullReading, setFullReading] = useState("");
  const uid = useId();
  const reasonId = `${uid}-beaker-weigh-reason`;

  if (!stage || stage.portion.kind !== "weighed_mass") return null;

  const prep = stage.preparationState;
  const availability = beakerWeighAvailability(stage, { canWrite, pending });
  const emptyDone = prep.beakerMassG !== null;
  const fullDone = prep.beakerPlusKhpMassG !== null;

  const record = async (observedMassG: number, clear: () => void) => {
    await perform({ type: "weigh_beaker", stageKey: stage.key, observedMassG });
    clear();
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <ReadingInput
          id={`empty-beaker-${stage.key}`}
          label="Empty beaker mass"
          kind="mass"
          unit="g"
          value={emptyReading}
          onChange={setEmptyReading}
          disabled={!canWrite || pending || emptyDone}
          className="w-48"
        />
        <Button
          size="sm"
          disabled={
            !availability.available || emptyDone || !readingIsUsable(emptyReading, "mass")
          }
          aria-describedby={describedBy(reasonId, availability)}
          onClick={() => void record(Number(emptyReading), () => setEmptyReading(""))}
        >
          Record empty weighing
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <ReadingInput
          id={`full-beaker-${stage.key}`}
          label="Beaker plus KHP mass"
          kind="mass"
          unit="g"
          value={fullReading}
          onChange={setFullReading}
          disabled={!canWrite || pending || !emptyDone || fullDone}
          className="w-48"
        />
        <Button
          size="sm"
          disabled={
            !availability.available ||
            !emptyDone ||
            fullDone ||
            !readingIsUsable(fullReading, "mass")
          }
          aria-describedby={describedBy(reasonId, availability)}
          onClick={() => void record(Number(fullReading), () => setFullReading(""))}
        >
          Record KHP weighing
        </Button>
      </div>
      <ControlReason id={reasonId} reason={availability.reason} className="w-full" />
      {emptyDone ? (
        <p className="text-xs text-muted">
          Empty beaker: <span className="font-medium tabular-nums">{prep.beakerMassG} g</span>
          {fullDone ? (
            <>
              {" · "}beaker plus KHP:{" "}
              <span className="font-medium tabular-nums">{prep.beakerPlusKhpMassG} g</span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** Dissolve the KHP, transfer it to the flask and rinse the beaker twice. */
function KhpSolutionSteps() {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const uid = useId();

  if (!stage || stage.portion.kind !== "weighed_mass") return null;

  const flags = { canWrite, pending };
  const prep = stage.preparationState;
  const dissolve = dissolveAvailability(stage, flags);
  const transfer = transferAvailability(stage, flags);
  const rinse = rinseBeakerAvailability(stage, flags);

  const blocked = !canWrite || pending;
  const next = blocked
    ? null
    : stage.portion.recordedMassG === null
      ? "Weigh the sample by difference first."
      : !prep.khpDissolved
        ? "Dissolve the KHP in distilled water."
        : !prep.khpTransferred
          ? "Transfer the solution to the Erlenmeyer flask."
          : prep.beakerRinses < 2
            ? "Rinse the beaker into the flask, twice."
            : null;

  return (
    <div className="mt-3">
      <InstrumentGuide
        status={
          `KHP solution · ${prep.khpDissolved ? "dissolved" : "not dissolved"}` +
          ` · ${prep.khpTransferred ? "transferred" : "in the beaker"}` +
          ` · beaker rinses ${prep.beakerRinses}/2`
        }
        next={next}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={prep.khpDissolved ? "primary" : "secondary"}
          disabled={!dissolve.available}
          aria-describedby={dissolve.reason ? `${uid}-dissolve-reason` : undefined}
          onClick={() => void perform({ type: "dissolve_khp", stageKey: stage.key })}
        >
          Dissolve in water
        </Button>
        <Button
          size="sm"
          variant={prep.khpTransferred ? "primary" : "secondary"}
          disabled={!transfer.available}
          aria-describedby={transfer.reason ? `${uid}-transfer-reason` : undefined}
          onClick={() => void perform({ type: "transfer_solution", stageKey: stage.key })}
        >
          Transfer to flask
        </Button>
        <Button
          size="sm"
          variant={prep.beakerRinses > 0 ? "primary" : "secondary"}
          disabled={!rinse.available}
          aria-describedby={rinse.reason ? `${uid}-rinse-reason` : undefined}
          onClick={() => void perform({ type: "rinse_beaker", stageKey: stage.key })}
        >
          {prep.beakerRinses >= 2 ? "Rinsed (2/2)" : `Rinse beaker (${prep.beakerRinses}/2)`}
        </Button>
      </div>
      <ControlReason id={`${uid}-dissolve-reason`} reason={dissolve.reason} className="mt-1" />
      <ControlReason id={`${uid}-transfer-reason`} reason={transfer.reason} className="mt-1" />
      <ControlReason id={`${uid}-rinse-reason`} reason={rinse.reason} className="mt-1" />
    </div>
  );
}

/** Place the flask under the burette before the first trial. */
export function FlaskPlacementSection() {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const uid = useId();
  const reasonId = `${uid}-place-reason`;

  if (!stage) return null;

  const availability = placeFlaskAvailability(stage, { canWrite, pending });
  const prep = stage.preparationState;

  return (
    <div className="rounded-md border border-line px-3 py-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <FlaskConical aria-hidden="true" className="size-4 text-muted" />
        6. Place the flask under the burette
      </p>
      <InstrumentGuide
        status={`Flask · ${prep.flaskPlaced ? "under the burette" : "not placed"}`}
        next={
          !canWrite || pending
            ? null
            : prep.flaskPlaced
              ? null
              : "Set the flask on the white tile, aligned under the tip."
        }
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={prep.flaskPlaced ? "primary" : "secondary"}
          disabled={!availability.available}
          aria-describedby={describedBy(reasonId, availability)}
          onClick={() => void perform({ type: "place_flask", stageKey: stage.key })}
        >
          Place under burette
        </Button>
      </div>
      <ControlReason id={reasonId} reason={availability.reason} className="mt-1" />
    </div>
  );
}

export function AnalyteSection({ initialState }: { initialState: LabStateView }) {  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const { aliquotStage, setAliquotStage, fillerAttached, setFillerAttached } = useLabUi();
  const [volumeReading, setVolumeReading] = useState("");
  // UI-only workflow staging for the balance: place, tare, add, read. The
  // sequence guides the practical; the reading entered below is still the only
  // number the laboratory records.
  const [balanceStep, setBalanceStep] = useState<"none" | "empty" | "tared" | "loaded">("none");
  const uid = useId();
  const reasonId = `${uid}-analyte-reason`;

  if (!stage) return null;

  const analyteLabel = initialState.chemicalLabels[stage.analyteKey] ?? stage.analyteKey;
  // The procedure names the ware for the aliquot, so the copy follows it.
  const vesselCopy = ALIQUOT_VESSEL_COPY[
    stage.portion.kind === "pipetted_volume" ? stage.portion.vessel : "pipette"
  ];
  const isPipette = stage.portion.kind === "pipetted_volume" && stage.portion.vessel === "pipette";
  const disabled = !canWrite || pending;
  // The engine refuses both a weighing and a pipetting until the burette is
  // ready, so the whole portion section is gated on that same rule.
  const availability = analytePortionAvailability(stage, { canWrite, pending });

  return (
    <div className="rounded-md border border-line px-3 py-3">
      {stage.portion.kind === "weighed_mass" ? (
        <>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Scale aria-hidden="true" className="size-4 text-muted" />
            4. Weigh the KHP by difference
          </p>
          <p className="mt-1 text-xs text-muted">
            Weigh the empty beaker, add about {stage.portion.nominalMassG} g of {analyteLabel},
            then weigh again — all to ±{stage.portion.precision} g. The sample mass is the difference.
          </p>
          <ControlReason id={reasonId} reason={availability.reason} className="mt-1" />
          <BalanceGuide balanceStep={balanceStep} availabilityAvailable={availability.available} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={balanceStep !== "none" ? "primary" : "secondary"}
              onClick={() => setBalanceStep("empty")}
              disabled={!availability.available || balanceStep !== "none"}
            >
              Place weighing bottle
            </Button>
            <Button
              size="sm"
              variant={balanceStep === "tared" || balanceStep === "loaded" ? "primary" : "secondary"}
              onClick={() => setBalanceStep("tared")}
              disabled={!availability.available || balanceStep !== "empty"}
            >
              Tare the balance
            </Button>
            <Button
              size="sm"
              variant={balanceStep === "loaded" ? "primary" : "secondary"}
              onClick={() => setBalanceStep("loaded")}
              disabled={!availability.available || balanceStep !== "tared"}
            >
              {`Add ${analyteLabel}`}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted">
            The balance sequence is a guide for the practical; each reading you enter below is
            recorded by the laboratory, and the sample mass is their difference.
          </p>
          <WeighBeakerInputs />
          <KhpSolutionSteps />
          {stage.portion.recordedMassG !== null ? (
            <p className="mt-2 text-xs text-success">
              KHP sample by difference: {stage.portion.recordedMassG} g
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm font-medium">
            <FlaskConical aria-hidden="true" className="size-4 text-muted" />
            4. Measure the aliquot with the {vesselCopy.name}
          </p>
          <p className="mt-1 text-xs text-muted">
            {stage.portion.nominalVolumeMl} mL of {analyteLabel}, measured with the{" "}
            {vesselCopy.name} into the conical flask. Volume known to{" "}
            {stage.portion.precision} mL.
          </p>
          <ControlReason id={reasonId} reason={availability.reason} className="mt-1" />
          <AliquotGuide
            vessel={stage.portion.vessel}
            aliquotStage={aliquotStage}
            fillerAttached={fillerAttached}
            availabilityAvailable={availability.available}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {isPipette ? (
              <Button
                size="sm"
                variant={fillerAttached ? "primary" : "secondary"}
                disabled={!availability.available || fillerAttached}
                onClick={() => setFillerAttached(true)}
              >
                Attach filler
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={aliquotStage === "measured" ? "primary" : "secondary"}
              disabled={
                !availability.available ||
                (isPipette && !fillerAttached) ||
                aliquotStage !== "resting"
              }
              onClick={() => setAliquotStage("measured")}
            >
              {isPipette ? "Draw up solution" : "Measure in the cylinder"}
            </Button>
            <Button
              size="sm"
              variant={aliquotStage === "delivered" ? "primary" : "secondary"}
              disabled={!availability.available || aliquotStage !== "measured"}
              onClick={() => setAliquotStage("delivered")}
            >
              Deliver into the flask
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <ReadingInput
              id={`volume-${stage.key}`}
              label="Volume delivered"
              kind="volume"
              value={volumeReading}
              onChange={setVolumeReading}
              disabled={disabled}
              hint={`Record the volume you actually delivered, to ${stage.portion.precision} mL.`}
              className="w-48"
            />
            <Button
              size="sm"                disabled={
                  !availability.available ||
                  aliquotStage !== "delivered" ||
                  !readingIsUsable(volumeReading, "volume")
                }
              aria-describedby={describedBy(reasonId, availability)}
              onClick={async () => {
                await perform({
                  type: "pipette_analyte",
                  stageKey: stage.key,
                  observedVolumeMl: Number(volumeReading),
                });
                setVolumeReading("");
              }}
            >
              Record volume
            </Button>
          </div>
          {stage.portion.recordedVolumeMl !== null ? (
            <p className="mt-2 text-xs text-success">
              Recorded aliquot: {stage.portion.recordedVolumeMl} mL
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export function IndicatorSection() {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const [drops, setDrops] = useState(3);
  const uid = useId();
  const reasonId = `${uid}-indicator-reason`;

  if (!stage) return null;

  const indicatorLabel = stage.indicator.name;
  const disabled = !canWrite || pending;
  const availability = indicatorAvailability(stage, { canWrite, pending });

  return (
    <div className="rounded-md border border-line px-3 py-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Droplet aria-hidden="true" className="size-4 text-muted" />
        5. Add the indicator
      </p>
      <p className="mt-1 text-xs text-muted">
        {indicatorLabel} — {stage.indicator.dropsRange[0]} to {stage.indicator.dropsRange[1]}{" "}
        drops. Colourless in acid, pink in alkali.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Drops
          <input
            type="number"
            min={1}
            max={20}
            value={drops}
            disabled={disabled}
            onChange={(event) => setDrops(Number(event.target.value))}
            className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm"
            aria-label="Number of indicator drops"
          />
        </label>
        <Button
          size="sm"
          disabled={
            !availability.available || !Number.isInteger(drops) || drops < 1 || drops > 20
          }
          aria-describedby={describedBy(reasonId, availability)}
          onClick={() => void perform({ type: "add_indicator", stageKey: stage.key, drops })}
        >
          Add drops
        </Button>
        {stage.indicator.dropsAdded !== null ? (
          <Badge tone="success">{stage.indicator.dropsAdded} drops added</Badge>
        ) : null}
        <ControlReason id={reasonId} reason={availability.reason} className="w-full" />
      </div>
    </div>
  );
}
