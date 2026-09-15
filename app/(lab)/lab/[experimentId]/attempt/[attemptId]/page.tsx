import { notFound } from "next/navigation";
import { requireStudent } from "@/application/auth/dal";
import { getExperimentForBriefing } from "@/application/experiments/list-experiments";
import { getStudentAttempt } from "@/application/attempts/get-attempt";
import { LabWorkspace, PendingNotice } from "@/components/laboratory/lab-workspace";
import { PageContainer } from "@/components/layout/page-container";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ATTEMPT_STATUS_LABELS, isAttemptWritable } from "@/domain/attempts";
import { EXPERIMENT_TYPE_LABELS } from "@/domain/experiments";

export const metadata = { title: "Laboratory workspace" };

/**
 * The attempt workspace. Stage 1 renders the STRUCTURE only: the six regions are
 * laid out, the attempt is loaded from the database, and the student's own
 * permissions are resolved - but no apparatus is interactive and no chemistry is
 * simulated. The titration engine slots into these regions next.
 */
export default async function AttemptWorkspacePage({
  params,
}: {
  params: Promise<{ experimentId: string; attemptId: string }>;
}) {
  const { experimentId, attemptId } = await params;

  await requireStudent(`/lab/${experimentId}/attempt/${attemptId}`);

  const [experiment, view] = await Promise.all([
    getExperimentForBriefing(experimentId),
    getStudentAttempt(attemptId),
  ]);

  if (!experiment || !view) notFound();

  // The attempt must belong to the experiment in the URL, or the page is wrong
  // regardless of who owns it.
  if (view.attempt.experimentId !== experimentId) notFound();

  const { attempt, state, canWrite } = view;
  const stepCount = experiment.procedure.length;

  return (
    <PageContainer width="wide">
      <div className="flex flex-col gap-4">
        {!canWrite ? (
          <Alert tone="info" title="This attempt is closed">
            It has been submitted, so the readings are frozen. Instructors can read them but
            nobody can change them; a returned attempt reopens for revision.
          </Alert>
        ) : null}

        <LabWorkspace
          experimentTitle={experiment.title}
          experimentNumber={experiment.number}
          experimentType={EXPERIMENT_TYPE_LABELS[experiment.type]}
          attemptStatus={ATTEMPT_STATUS_LABELS[attempt.status]}
          instructions={
            <div className="flex flex-col gap-3 text-sm">
              <p className="font-medium">{experiment.aim}</p>
              <ol className="flex list-decimal flex-col gap-1 pl-4 text-muted">
                {experiment.procedure.slice(0, 4).map((step) => (
                  <li key={step.stepNumber}>{step.title}</li>
                ))}
                {stepCount > 4 ? <li>…and {stepCount - 4} more steps</li> : null}
              </ol>
              <p className="text-xs text-muted">
                {experiment.safety.length} safety notes apply to this experiment.
              </p>
            </div>
          }
          apparatus={
            <ul className="flex flex-col gap-2 text-sm">
              {experiment.apparatus.map((item) => (
                <li key={item.key} className="flex items-center justify-between gap-2">
                  <span>{item.name}</span>
                  <Badge tone="neutral">Not selectable yet</Badge>
                </li>
              ))}
            </ul>
          }
          measurements={
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <AttemptFact label="Current step" value={state.currentStep} />
                <AttemptFact label="Trials recorded" value={String(state.trials.length)} />
                <AttemptFact label="Measurements" value={String(state.measurements.length)} />
                <AttemptFact label="Observations" value={String(state.observations.length)} />
                <AttemptFact
                  label="Score so far"
                  value={`${state.score.awarded} / ${state.score.possible}`}
                />
                <AttemptFact label="Safety events" value={String(state.safetyEvents.length)} />
              </dl>
              <PendingNotice>
                Burette readings, repeated trials and the concordance check appear here once the
                titration engine is implemented. This attempt already has a durable state record,
                so nothing recorded now would be lost.
              </PendingNotice>
            </div>
          }
          controls={
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted">
                {isAttemptWritable(attempt.status)
                  ? "Experiment controls (fill burette, add indicator, titrate, record reading) arrive with the simulation engine."
                  : "No controls are available on a closed attempt."}
              </p>
              <p className="text-xs text-muted">
                Attempt <span className="font-mono">{attempt.id.slice(0, 8)}</span> · schema
                version {state.schemaVersion} · config version {attempt.configVersion}
              </p>
            </div>
          }
        />
      </div>
    </PageContainer>
  );
}

function AttemptFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </div>
  );
}
