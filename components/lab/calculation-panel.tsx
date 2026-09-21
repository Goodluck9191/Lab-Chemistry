"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveStage, useLabServer, useLabViewModel } from "./lab-state-provider";
import { ReadingInput, readingIsUsable } from "./reading-input";
import type { LabStateView } from "@/application/attempts/lab-state";

/** Round for display only; the graded value is whatever the student submits. */
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Calculation workspace.
 *
 * WHAT THE SERVER CAN GRADE: the concentration the student reports for a
 * recorded trial. That is submitted with the existing protocol action
 * `report_molarity`, which checks it against the hidden reality and answers
 * correct / not correct — it never sends the expected value back.
 *
 * WHAT IT CANNOT: the intermediate moles step has no protocol action at all, so
 * this panel presents it as formula guidance to work out by hand instead of
 * pretending to mark it. The check for that is honest and prominent rather than
 * a fake "submitted" state.
 *
 * The formulas shown are the reaction equation and the stoichiometry the
 * configuration declares, plus the standard molar mass the domain already uses —
 * no expected answer is displayed before submission.
 */
export function CalculationPanel({ initialState }: { initialState: LabStateView }) {
  const stage = useActiveStage();
  const stages = useLabViewModel().stages;
  const { perform, pending, canWrite, state } = useLabServer();
  const [values, setValues] = useState<Record<string, string>>({});

  if (!stage) return null;

  const guidance = initialState.formulaGuidance.find((entry) => entry.stageKey === stage.key);
  const prompts = initialState.calculationPrompts.filter((prompt) => prompt.stageKey === stage.key);
  const ungraded = initialState.ungradedCalculations;
  const disabled = !canWrite || pending;

  const lastOutcome = state.lastOutcome;

  return (
    <section aria-label="Calculations" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Calculations</h3>

      {guidance ? (
        <div className="rounded-md border border-line px-3 py-3 text-xs">
          <p className="font-medium text-foreground">What you are calculating</p>
          <p className="mt-1 text-muted">
            Reaction: <span className="font-mono text-foreground">{guidance.reactionEquation}</span>
          </p>
          <p className="mt-1 text-muted">
            Stoichiometry from the configuration: {guidance.stoichiometry.analyteCoefficient} mol of{" "}
            {guidance.analyteKey} reacts with {guidance.stoichiometry.titrantCoefficient} mol of{" "}
            {guidance.titrantKey}.
          </p>
          {guidance.analyteMolarMassGPerMol !== null ? (
            <p className="mt-1 text-muted">
              Molar mass of {guidance.analyteKey}: {guidance.analyteMolarMassGPerMol} g/mol (standard
              chemistry data).
            </p>
          ) : null}
          <p className="mt-1 text-muted">
            Concentration: c = n ÷ V, with the volume of titrant in litres.
          </p>
        </div>
      ) : null}

      {prompts.length === 0 ? (
        <Alert tone="info">
          Complete a trial on this stage and the concentration prompt will appear here. The
          laboratory only marks submissions that belong to a recorded trial.
        </Alert>
      ) : null}

      <TrialWorkingBreakdown
        stageKey={stage.key}
        stageTitle={stage.title}
        portion={stage.portion}
        trials={stage.trials}
        reactionEquation={guidance?.reactionEquation ?? ""}
        analyteMolarMassGPerMol={guidance?.analyteMolarMassGPerMol ?? null}
        standardisedNaohMolarityM={
          stages.find((other) => other.key !== stage.key && other.concordance.averageMolarityM !== null)
            ?.concordance.averageMolarityM ?? null
        }
      />

      {prompts.map((prompt) => {
        const draftKey = prompt.questionKey;
        const value = values[draftKey] ?? "";
        const trial = stage.trials.find((row) => row.trialNumber === prompt.trialNumber);
        const alreadyReported = trial?.reportedMolarityM ?? null;
        return (
          <div key={draftKey} className="rounded-md border border-line px-3 py-3">
            <p className="text-sm font-medium">{prompt.label}</p>
            <p className="mt-1 text-xs text-muted">
              Use your own readings from trial {prompt.trialNumber}. The laboratory checks the value
              against the simulation and tells you whether it agrees; it never shows the value it
              expected.
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <ReadingInput
                id={`calculation-${draftKey}`}
                label="Your value"
                kind="concentration"
                unit={prompt.unit}
                value={value}
                onChange={(next) => setValues((current) => ({ ...current, [draftKey]: next }))}
                disabled={disabled}
                className="w-56"
              />
              <Button
                size="sm"
                disabled={disabled || !readingIsUsable(value, "concentration")}
                onClick={async () => {
                  await perform({
                    type: "report_molarity",
                    stageKey: prompt.stageKey,
                    trialNumber: prompt.trialNumber,
                    studentMolarityM: Number(value),
                  });
                  setValues((current) => ({ ...current, [draftKey]: "" }));
                }}
              >
                Submit value
              </Button>
              {alreadyReported !== null ? (
                <Badge tone="neutral">Submitted: {alreadyReported} mol/L</Badge>
              ) : null}
            </div>
          </div>
        );
      })}

      {lastOutcome !== null && lastOutcome.calculationCorrect !== null ? (
        <p
          className={
            "text-xs " + (lastOutcome.calculationCorrect ? "text-success" : "text-warning")
          }
          role="status"
        >
          {lastOutcome.calculationCorrect
            ? "The last concentration you submitted agrees with the simulation within the accepted tolerance."
            : "The last concentration you submitted is outside the accepted tolerance. Check the readings and your arithmetic."}
        </p>
      ) : null}

      {ungraded.length > 0 ? (
        <div className="rounded-md border border-dashed border-line-strong px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Worked out by hand (not marked)
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
            {ungraded.map((calculation) => (
              <li key={calculation.key}>
                {calculation.prompt}{" "}
                <span className="opacity-80">
                  (unit {calculation.unit}, to {calculation.decimalPlaces} decimal places)
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            There is no submission action for these intermediate steps yet, so the laboratory cannot
            mark them. Carry the value forward yourself and submit the concentration above.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Per-trial INPUTS → FORMULA → RESULT → UNIT → VALIDATION workspace.
 *
 * Everything shown comes from the student's OWN recorded measurements (public
 * state) plus the standard molar mass and reaction equation from the public
 * configuration. The RESULT preview is the student's working, recomputed
 * locally so it can be checked before submitting — it is NOT the server's
 * expected value, which never leaves the server. The graded value remains the
 * concentration submitted through `report_molarity`.
 */
function TrialWorkingBreakdown({
  stageKey,
  stageTitle,
  portion,
  trials,
  reactionEquation,
  analyteMolarMassGPerMol,
  standardisedNaohMolarityM,
}: {
  stageKey: string;
  stageTitle: string;
  portion:
    | { kind: "weighed_mass"; recordedMassG: number | null; nominalMassG: number; precision: number }
    | {
        kind: "pipetted_volume";
        recordedVolumeMl: number | null;
        nominalVolumeMl: number;
        precision: number;
        vessel: string;
      };
  trials: Array<{
    trialNumber: number;
    status: string;
    statusLabel: string;
    initialReadingMl: number | null;
    finalReadingMl: number | null;
    titreMl: number | null;
    reportedMolarityM: number | null;
  }>;
  reactionEquation: string;
  analyteMolarMassGPerMol: number | null;
  standardisedNaohMolarityM: number | null;
}) {
  const recorded = trials.filter((trial) => trial.status === "recorded");
  if (recorded.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" aria-label="Trial working">
      {recorded.map((trial) => {
        const titreL = trial.titreMl !== null ? trial.titreMl / 1000 : null;
        let inputs: string;
        let formula: string;
        let preview: string | null;
        if (portion.kind === "weighed_mass") {
          inputs =
            portion.recordedMassG !== null && trial.titreMl !== null
              ? `KHP mass ${portion.recordedMassG} g · initial ${trial.initialReadingMl ?? "—"} mL · final ${trial.finalReadingMl ?? "—"} mL · titre ${trial.titreMl} mL`
              : "Weigh the KHP by difference and record the burette readings first.";
          formula = `n(KHP) = m ÷ ${analyteMolarMassGPerMol ?? "204.2223"} g/mol; M(NaOH) = n ÷ V (1:1)`;
          preview =
            portion.recordedMassG !== null &&
            analyteMolarMassGPerMol !== null &&
            titreL !== null &&
            titreL > 0
              ? `${round6(portion.recordedMassG / analyteMolarMassGPerMol / titreL)}`
              : null;
        } else {
          inputs =
            portion.recordedVolumeMl !== null && trial.titreMl !== null
              ? `HCl aliquot ${portion.recordedVolumeMl} mL · NaOH titre ${trial.titreMl} mL · standardised NaOH ${standardisedNaohMolarityM !== null ? `${standardisedNaohMolarityM} mol/L` : "pending"}`
              : "Measure the HCl aliquot and record the NaOH titre first.";
          formula = "n(NaOH) = M × V; M(HCl) = n ÷ V(HCl) (1:1)";
          preview =
            portion.recordedVolumeMl !== null &&
            portion.recordedVolumeMl > 0 &&
            titreL !== null &&
            standardisedNaohMolarityM !== null
              ? `${round6(((standardisedNaohMolarityM * titreL) / (portion.recordedVolumeMl / 1000)))}`
              : null;
        }
        return (
          <div key={`${stageKey}-working-${trial.trialNumber}`} className="rounded-md border border-line px-3 py-2 text-xs">
            <p className="font-medium">
              Trial {trial.trialNumber} working — {stageTitle}
            </p>
            <dl className="mt-1 grid gap-1">
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold text-muted">Inputs:</dt>
                <dd>{inputs}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold text-muted">Formula:</dt>
                <dd className="font-mono">{reactionEquation ? `${reactionEquation}; ` : ""}{formula}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold text-muted">Result:</dt>
                <dd>
                  {preview !== null ? (
                    <span>
                      <span className="font-medium tabular-nums">{preview}</span> mol/L (your working —
                      check it, then submit below)
                    </span>
                  ) : (
                    <span className="text-muted">Not enough recorded measurements yet.</span>
                  )}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold text-muted">Unit:</dt>
                <dd>mol/L</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="shrink-0 font-semibold text-muted">Validation:</dt>
                <dd>
                  {trial.statusLabel}
                  {trial.reportedMolarityM !== null
                    ? ` · submitted ${trial.reportedMolarityM} mol/L`
                    : " · not submitted yet"}
                </dd>
              </div>
            </dl>
          </div>
        );
      })}
    </div>
  );
}
