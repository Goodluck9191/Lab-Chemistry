"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveStage, useLabServer } from "./lab-state-provider";
import { ReadingInput, readingIsUsable } from "./reading-input";
import type { LabStateView } from "@/application/attempts/lab-state";

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
