"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import {
  saveReportDraftAction,
  submitAttemptAction,
} from "@/application/attempts/actions";
import type { LabStateView } from "@/application/attempts/lab-state";
import { projectExperimentWorkflow } from "@/domain/simulation/titration/workflow";
import { useLabServer } from "./lab-state-provider";

/**
 * Review and submit panel.
 *
 * Three jobs, in manual order: (1) show the experiment checklist — every stage
 * with its requirements, derived LIVE from the saved public state so a freshly
 * recorded trial ticks the list without a reload; (2) edit and save the
 * report draft; (3) submit the attempt.
 *
 * Nothing here decides whether submission is allowed: the button always asks
 * the server, and the server's verdict (ok / blocked with reasons / error) is
 * what renders. A blocked submission lists exactly what is still missing.
 */
export function ReviewSubmitPanel({ initialState }: { initialState: LabStateView }) {
  const { attemptId, state, canWrite, pending: actionPending, refresh } = useLabServer();
  const [reportPending, startReportTransition] = useTransition();
  const [sections, setSections] = useState(() => ({
    aim: initialState.report?.aim ?? "",
    procedure: initialState.report?.procedure ?? "",
    resultsSummary: initialState.report?.resultsSummary ?? "",
    conclusion: initialState.report?.conclusion ?? "",
    safetyNotes: initialState.report?.safetyNotes ?? "",
  }));
  const [draftSaved, setDraftSaved] = useState(false);
  const [submitBlockers, setSubmitBlockers] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const requiredObservations = useMemo(
    () =>
      initialState.declaredObservations
        .filter((field) => field.isRequired)
        .map((field) => ({ fieldKey: field.fieldKey, prompt: field.prompt })),
    [initialState.declaredObservations],
  );
  // Live: recomputed from the controller's public state, so bench work done
  // after the page loaded is reflected without a reload.
  const workflow = useMemo(
    () => projectExperimentWorkflow(initialState.config, state.publicState, requiredObservations),
    [initialState.config, state.publicState, requiredObservations],
  );

  const frozen = !canWrite || submitted;
  const pending = actionPending || reportPending;

  function setSection(key: keyof typeof sections, value: string) {
    setSections((current) => ({ ...current, [key]: value }));
    setDraftSaved(false);
  }

  function handleSaveDraft() {
    setProblem(null);
    startReportTransition(async () => {
      const outcome = await saveReportDraftAction(attemptId, sections);
      if (outcome.status === "ok") {
        setDraftSaved(true);
      } else {
        setProblem(outcome.message);
      }
    });
  }

  function handleSubmit() {
    setProblem(null);
    setSubmitBlockers(null);
    startReportTransition(async () => {
      const outcome = await submitAttemptAction(attemptId);
      if (outcome.status === "ok") {
        setSubmitted(true);
        await refresh();
      } else if (outcome.status === "blocked") {
        setSubmitBlockers(outcome.blockers);
      } else {
        setProblem(outcome.message);
      }
    });
  }

  if (frozen) {
    return (
      <section aria-label="Review and submit" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Review &amp; submit</h3>
          <Badge tone="success">Submitted</Badge>
        </div>
        <p className="text-sm text-muted">
          This attempt has been submitted and the readings are frozen.
          {initialState.report?.submittedAt
            ? ` Submitted ${new Date(initialState.report.submittedAt).toLocaleString()}.`
            : null}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Review and submit" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Review &amp; submit</h3>
        <Badge tone={workflow.canSubmit ? "success" : "neutral"}>
          {workflow.canSubmit ? "Ready to submit" : "Work remaining"}
        </Badge>
      </div>

      <ol className="flex flex-col gap-2">
        {workflow.stages.map((stage) => (
          <li key={stage.key} className="rounded border border-line px-2 py-1.5 text-xs">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              <span aria-hidden="true">{stage.complete ? "✓" : "○"}</span>
              Stage {stage.letter} — {stage.title}
              <Badge tone={stage.complete ? "success" : stage.locked ? "neutral" : "warning"}>
                {stage.complete ? "Complete" : stage.locked ? "Locked" : "In progress"}
              </Badge>
            </p>
            <ul className="mt-1 flex flex-col gap-0.5 text-muted">
              {stage.requirements.map((requirement) => (
                <li key={requirement.key}>
                  <span aria-hidden="true">{requirement.done ? "✓ " : "○ "}</span>
                  {requirement.label}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {workflow.missingObservations.length > 0 ? (
        <p className="text-xs text-muted">
          Still to record in the observations panel:{" "}
          {workflow.missingObservations.map((missing) => missing.prompt).join("; ")}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Report</h4>
        <Field label="Aim" htmlFor="report-aim">
          <Textarea
            id="report-aim"
            value={sections.aim}
            onChange={(event) => setSection("aim", event.target.value)}
            disabled={pending}
            placeholder="What the experiment sets out to determine."
          />
        </Field>
        <Field label="Procedure" htmlFor="report-procedure">
          <Textarea
            id="report-procedure"
            value={sections.procedure}
            onChange={(event) => setSection("procedure", event.target.value)}
            disabled={pending}
            placeholder="What was done, in order."
          />
        </Field>
        <Field label="Results summary" htmlFor="report-results">
          <Textarea
            id="report-results"
            value={sections.resultsSummary}
            onChange={(event) => setSection("resultsSummary", event.target.value)}
            disabled={pending}
            placeholder="Titres, concordance and the standardised concentrations."
          />
        </Field>
        <Field label="Conclusion" htmlFor="report-conclusion">
          <Textarea
            id="report-conclusion"
            value={sections.conclusion}
            onChange={(event) => setSection("conclusion", event.target.value)}
            disabled={pending}
            placeholder="What the results establish."
          />
        </Field>
        <Field label="Safety notes" htmlFor="report-safety">
          <Textarea
            id="report-safety"
            value={sections.safetyNotes}
            onChange={(event) => setSection("safetyNotes", event.target.value)}
            disabled={pending}
            placeholder="Hazards handled and precautions taken."
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={handleSaveDraft} disabled={pending}>
            {reportPending ? "Saving…" : "Save report draft"}
          </Button>
          {draftSaved ? (
            <p className="text-xs text-muted" role="status">
              Draft saved.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleSubmit} disabled={pending}>
            {reportPending ? "Submitting…" : "Submit attempt"}
          </Button>
        </div>
        <p className="text-xs text-muted">
          Submission freezes the readings. The server checks every requirement first and tells
          you exactly what is missing.
        </p>
        {submitBlockers ? (
          <Alert tone="warning" title="Not ready to submit yet">
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
              {submitBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {problem ? (
          <Alert tone="danger" title="Something went wrong">
            {problem}
          </Alert>
        ) : null}
      </div>
    </section>
  );
}
