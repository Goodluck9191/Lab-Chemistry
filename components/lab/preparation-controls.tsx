"use client";

import { useId, useState } from "react";
import { Droplet, FlaskConical, Scale, Wrench } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveStage, useLabServer, useLabUi } from "./lab-state-provider";
import { ControlReason, describedBy } from "./control-reason";
import {
  analytePortionAvailability,
  buretteSetupAvailability,
  indicatorAvailability,
} from "./control-availability";
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
      <BuretteSetupSection initialState={initialState} />
      <AnalyteSection initialState={initialState} />
      <IndicatorSection />
      {!canWrite ? (
        <Alert tone="info" title="Read-only attempt">
          This attempt has been submitted, so preparation steps are disabled.
        </Alert>
      ) : null}
    </section>
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
  const disabled = !canWrite || pending;
  const titrantSelected = selectedReagentKey === stage.titrantKey;
  const availability = buretteSetupAvailability({ canWrite, pending });

  return (
    <div className="rounded-md border border-line px-3 py-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Wrench aria-hidden="true" className="size-4 text-muted" />
        1. Rinse, fill and clamp the burette
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

export function AnalyteSection({ initialState }: { initialState: LabStateView }) {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const { pipetteStage, setPipetteStage } = useLabUi();
  const [massReading, setMassReading] = useState("");
  const [volumeReading, setVolumeReading] = useState("");
  // UI-only workflow staging for the balance: place, tare, add, read.
  const [balanceStep, setBalanceStep] = useState<"empty" | "tared" | "loaded">("empty");
  const uid = useId();
  const reasonId = `${uid}-analyte-reason`;

  if (!stage) return null;

  const analyteLabel = initialState.chemicalLabels[stage.analyteKey] ?? stage.analyteKey;
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
            2. Weigh the sample
          </p>
          <p className="mt-1 text-xs text-muted">
            Target about {stage.portion.nominalMassG} g of {analyteLabel}, weighed to ±
            {stage.portion.precision} g.
          </p>
          <ControlReason id={reasonId} reason={availability.reason} className="mt-1" />
          <div className="mt-2 flex flex-wrap gap-2">
            {(["empty", "tared", "loaded"] as const).map((stepKey) => (
              <Button
                key={stepKey}
                size="sm"
                variant={balanceStep === stepKey ? "primary" : "secondary"}
                onClick={() => setBalanceStep(stepKey)}
                disabled={!availability.available}
              >
                {stepKey === "empty"
                  ? "Place weighing bottle"
                  : stepKey === "tared"
                    ? "Tare the balance"
                    : `Add ${analyteLabel}`}
              </Button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">
            The balance sequence is a guide for the practical; the reading you enter below is the
            number the laboratory records.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <ReadingInput
              id={`mass-${stage.key}`}
              label="Mass you obtained"
              kind="mass"
              unit="g"
              value={massReading}
              onChange={setMassReading}
              disabled={disabled}
              className="w-48"
            />
            <Button
              size="sm"
              disabled={!availability.available || !readingIsUsable(massReading, "mass")}
              aria-describedby={describedBy(reasonId, availability)}
              onClick={async () => {
                await perform({
                  type: "weigh_analyte",
                  stageKey: stage.key,
                  observedMassG: Number(massReading),
                });
                setMassReading("");
              }}
            >
              Record mass
            </Button>
          </div>
          {stage.portion.recordedMassG !== null ? (
            <p className="mt-2 text-xs text-success">
              Recorded on the balance: {stage.portion.recordedMassG} g
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm font-medium">
            <FlaskConical aria-hidden="true" className="size-4 text-muted" />
            2. Pipette the aliquot
          </p>
          <p className="mt-1 text-xs text-muted">
            {stage.portion.nominalVolumeMl} mL of {analyteLabel}, delivered with the pipette
            filler into the conical flask. Volume known to {stage.portion.precision} mL.
          </p>
          <ControlReason id={reasonId} reason={availability.reason} className="mt-1" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={pipetteStage === "filled" ? "primary" : "secondary"}
              disabled={!availability.available || pipetteStage === "delivered"}
              onClick={() => setPipetteStage("filled")}
            >
              Draw up solution
            </Button>
            <Button
              size="sm"
              variant={pipetteStage === "delivered" ? "primary" : "secondary"}
              disabled={!availability.available || pipetteStage !== "filled"}
              onClick={() => setPipetteStage("delivered")}
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
              size="sm"
              disabled={
                !availability.available ||
                pipetteStage !== "delivered" ||
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
        3. Add the indicator
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
