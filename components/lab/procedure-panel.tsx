"use client";

import { useMemo, useState } from "react";
import { Check, CircleDot, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useActiveStage, useLabServer } from "./lab-state-provider";
import {
  experimentPhaseFor,
  projectExperimentWorkflow,
  type ExperimentPhase,
} from "@/domain/simulation/titration/workflow";
import { cn } from "@/lib/utils";
import type { LabStateView } from "@/application/attempts/lab-state";

const PHASE_LABELS: Record<ExperimentPhase, string> = {
  PREPARATION: "Preparation",
  APPARATUS_SETUP: "Apparatus setup",
  SOLUTION_PREPARATION: "Solution preparation",
  TITRATION_READY: "Titration ready",
  TITRATION: "Titrating",
  TRIAL_RECORDED: "Trial recorded",
  NEXT_TRIAL: "Next trial",
  CONCORDANCE: "Concordance",
  CALCULATION: "Calculation",
  NEXT_PART: "Next part",
  RESULT_REVIEW: "Result review",
};

/**
 * Procedure panel: Part I / Part II / Part III checklist.
 *
 * Part I is the attempt-level working-solution preparation; Parts II and III
 * are the workflow stages (KHP standardisation, HCl determination). Every row
 * is derived LIVE from the server's public state via the same
 * `projectExperimentWorkflow` projection the submit gate uses, so the ticks,
 * locks, trial counts and concordance status can never disagree with grading.
 * The panel renders state and guidance only — all transitions stay in the
 * domain/application layers.
 */
export function ProcedurePanel({
  procedure,
  initialState,
}: {
  procedure: Array<{ stepNumber: number; title: string; instruction: string; isRequired: boolean }>;
  initialState?: LabStateView;
}) {
  const stage = useActiveStage();
  const { state } = useLabServer();

  const [collapsed, setCollapsed] = useState(false);

  const workflow = useMemo(() => {
    if (!initialState) return null;
    const required = initialState.declaredObservations
      .filter((field) => field.isRequired)
      .map((field) => ({ fieldKey: field.fieldKey, prompt: field.prompt }));
    return projectExperimentWorkflow(initialState.config, state.publicState, required);
  }, [initialState, state.publicState]);

  const phase: ExperimentPhase | null = useMemo(() => {
    if (!initialState || !workflow) return null;
    return experimentPhaseFor(initialState.config, state.publicState, workflow);
  }, [initialState, state.publicState, workflow]);

  const solutionRequirement = workflow?.stages[0]?.requirements.find(
    (requirement) => requirement.key === "prepare_solution",
  );

  return (
    <aside
      aria-label="Procedure"
      className={cn(
        "flex shrink-0 flex-col border-r border-line bg-surface transition-all duration-200",
        collapsed ? "w-10" : "w-64"
      )}
    >
      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex h-10 items-center justify-center border-b border-line text-muted hover:bg-surface-muted"
        aria-label={collapsed ? "Expand procedure panel" : "Collapse procedure panel"}
      >
        {collapsed ? (
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        ) : (
          <PanelLeftClose aria-hidden="true" className="size-4" />
        )}
      </button>

      {collapsed ? (
        /* Collapsed: step indicators only */
        <div className="flex flex-1 flex-col items-center gap-1.5 py-3">
          {stage?.preparation.map((step) => (
            <div
              key={step.key}
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-[10px]",
                step.done
                  ? "border-success bg-success/10 text-success"
                  : step.current
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-line text-muted"
              )}
              title={step.label}
            >
              {step.done ? <Check className="size-3" /> : step.current ? <CircleDot className="size-3" /> : ""}
            </div>
          ))}
        </div>
      ) : (
        /* Expanded: Part I / II / III workflow */
        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Procedure</h2>
            {phase ? (
              <p className="mt-0.5 text-[10px] text-muted" role="status">
                Current phase: <span className="font-medium text-foreground">{PHASE_LABELS[phase]}</span>
                {workflow ? ` · ${workflow.label}` : null}
              </p>
            ) : stage ? (
              <p className="mt-0.5 text-[10px] text-muted">
                Stage {String.fromCharCode(65 + stage.index)}
              </p>
            ) : null}
          </div>

          {workflow ? (
            <ol className="flex flex-1 flex-col gap-2 px-2 pb-3">
              {/* PART I — working solution (attempt-level) */}
              {solutionRequirement ? (
                <li className="rounded border border-line px-2 py-1.5 text-xs">
                  <p className="flex flex-wrap items-center gap-1.5 font-medium">
                    <span aria-hidden="true">{solutionRequirement.done ? "✓" : "●"}</span>
                    Part I — NaOH preparation
                  </p>
                  <p className="mt-0.5 text-[10px] leading-snug text-muted">
                    {solutionRequirement.done
                      ? "Working solution prepared from the stock solution."
                      : solutionRequirement.label}
                  </p>
                </li>
              ) : null}

              {workflow.stages.map((workflowStage, index) => {
                const publicSession = state.publicState.stages[workflowStage.key];
                const rejectedCount =
                  publicSession?.trials.filter(
                    (trial) => trial.status === "rejected" || trial.status === "discarded_overshoot",
                  ).length ?? 0;
                const partLabel = index === 0 ? "Part II" : index === 1 ? "Part III" : `Part ${index + 1}`;
                const isCurrent = workflowStage.key === workflow.activeStageKey && !workflowStage.complete;
                return (
                  <li
                    key={workflowStage.key}
                    className={cn(
                      "rounded border border-line px-2 py-1.5 text-xs",
                      isCurrent && "ring-1 ring-primary/20",
                    )}
                  >
                    <p className="flex flex-wrap items-center gap-1.5 font-medium">
                      <span aria-hidden="true">
                        {workflowStage.complete ? "✓" : isCurrent ? "●" : workflowStage.locked ? "🔒" : "○"}
                      </span>
                      {partLabel} — {workflowStage.title}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted">
                      {workflowStage.complete
                        ? `Complete · ${workflowStage.recordedTrials}/${workflowStage.requiredTrials} trials`
                        : workflowStage.locked
                          ? `Locked — finish Stage ${workflowStage.lockedByTitle ?? "before"} first`
                          : `Trial ${workflowStage.recordedTrials + 1} of ${workflowStage.requiredTrials} · ${workflowStage.reportedTrials}/${workflowStage.recordedTrials} reported`}
                      {rejectedCount > 0 ? ` · ${rejectedCount} rejected (excluded from average)` : null}
                      {workflowStage.averageMolarityM !== null
                        ? ` · avg ${workflowStage.averageMolarityM} mol/L`
                        : null}
                    </p>
                    <ul className="mt-1 flex flex-col gap-0.5 text-[10px] text-muted">
                      {workflowStage.requirements
                        .filter((requirement) => requirement.key !== "prepare_solution")
                        .map((requirement) => (
                          <li key={requirement.key}>
                            <span aria-hidden="true">{requirement.done ? "✓ " : "○ "}</span>
                            {requirement.done
                              ? requirement.key === "prepare_burette"
                                ? "Burette cleaned, conditioned, filled"
                                : requirement.key === "prepare_sample"
                                  ? "Sample prepared and transferred"
                                  : requirement.key === "prepare_flask"
                                    ? "Indicator added, flask placed"
                                    : requirement.key === "trials"
                                      ? `${workflowStage.recordedTrials}/${workflowStage.requiredTrials} trials recorded`
                                      : requirement.key === "report"
                                        ? "Concentrations reported"
                                        : "Concordant within 0.005 M"
                              : requirement.label}
                          </li>
                        ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          ) : stage ? (
            <ol className="flex flex-1 flex-col gap-0.5 px-2 pb-3">
              {stage.preparation.map((step) => (
                <li
                  key={step.key}
                  className={cn(
                    "flex items-start gap-2 rounded px-2 py-1.5 text-xs",
                    step.current && "bg-primary/5 ring-1 ring-primary/20",
                    !step.done && !step.current && "opacity-50"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[8px]",
                      step.done
                        ? "border-success text-success"
                        : step.current
                          ? "border-primary text-primary"
                          : "border-line text-muted"
                    )}
                  >
                    {step.done ? <Check className="size-2.5" /> : step.current ? <CircleDot className="size-2.5" /> : ""}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{step.label}</p>
                    {step.current ? (
                      <p className="mt-0.5 text-[10px] leading-snug text-muted">{step.detail}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-3 text-xs text-muted">No stage configured.</p>
          )}

          {/* Current instruction */}
          {stage?.nextAction ? (
            <div className="border-t border-line px-3 py-2" role="status">
              <p className="text-[10px] uppercase tracking-wide text-muted">Next</p>
              <p className="mt-0.5 text-xs font-medium">{stage.nextAction.title}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted">{stage.nextAction.description}</p>
            </div>
          ) : null}

          {/* Written procedure (compact) */}
          <div className="border-t border-line px-3 py-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">Written procedure</h3>
            <ol className="mt-1 flex flex-col gap-1">
              {procedure.map((step) => (
                <li key={step.stepNumber} className="flex gap-1.5 text-[10px] text-muted">
                  <span className="shrink-0 font-semibold">{step.stepNumber}.</span>
                  <span className="leading-snug">{step.title}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </aside>
  );
}
