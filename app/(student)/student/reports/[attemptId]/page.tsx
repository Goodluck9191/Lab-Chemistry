import { notFound } from "next/navigation";
import Link from "next/link";
import { requireStudent } from "@/application/auth/dal";
import { loadTitrationAttempt } from "@/application/attempts/apply-simulation-action";
import { attemptIdSchema } from "@/application/attempts/schemas";
import { toPublicJSON } from "@/domain/simulation/titration/engine";
import { experimentDefinitionFor } from "@/domain/experiments/catalog/catalog-registry";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { getExperimentBriefing } from "@/infrastructure/supabase/repositories/experiments";
import { getReportForAttempt } from "@/infrastructure/supabase/repositories/attempts";
import {
  getGradeForAttempt,
  listCalculationVerdicts,
  listFeedbackForAttempt,
} from "@/infrastructure/supabase/repositories/grades";
import { getProfileById } from "@/infrastructure/supabase/repositories/profiles";
import { buildReportModel } from "@/application/reports/report-model";
import { PageContainer, PageHeader } from "@/components/layout/page-container";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { QuestionForm } from "./question-form";

export const metadata = { title: "Experiment report" };

/**
 * Per-attempt student report.
 *
 * Server-rendered from PUBLIC data only: the attempt's public snapshot (via
 * the ownership-enforcing loader), the public catalog definition, the
 * student's own report row, and the student-visible grade/feedback rows.
 * Hidden truth (concentrations, endpoints, seeds, answer keys) is never an
 * input here, so it cannot reach the HTML. All numbers are recorded
 * measurements or domain-engine recomputations of them.
 */
export default async function AttemptReportPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  if (!attemptIdSchema.safeParse(attemptId).success) notFound();

  const { user } = await requireStudent(`/student/reports/${attemptId}`);
  const loaded = await loadTitrationAttempt(attemptId);

  const supabase = await createServerSupabaseClient();
  const [briefing, storedReport, grade, verdicts, feedback, profile] = await Promise.all([
    getExperimentBriefing(supabase, loaded.experimentId),
    getReportForAttempt(supabase, attemptId),
    getGradeForAttempt(supabase, attemptId),
    listCalculationVerdicts(supabase, attemptId),
    listFeedbackForAttempt(supabase, attemptId),
    getProfileById(supabase, user.id),
  ]);
  if (!briefing) notFound();
  const definition = experimentDefinitionFor(loaded.experimentId);
  if (!definition) notFound();

  const sections = {
    aim: storedReport?.aim ?? "",
    procedure: storedReport?.procedure ?? "",
    resultsSummary: storedReport?.resultsSummary ?? "",
    conclusion: storedReport?.conclusion ?? "",
    safetyNotes: storedReport?.safetyNotes ?? "",
  };
  const answers: Record<string, unknown> = { ...(storedReport?.answers ?? {}) };
  const model = buildReportModel({
    definition,
    config: loaded.config,
    publicState: toPublicJSON(loaded.session),
    report: { status: storedReport?.status ?? "draft", sections, answers },
    grade,
    verdicts,
    feedback,
  });

  const statusLabel =
    loaded.status === "in_progress"
      ? "In progress"
      : loaded.status === "submitted"
        ? "Submitted"
        : loaded.status === "graded"
          ? "Graded"
          : loaded.status;

  return (
    <PageContainer>
      <PageHeader
        title={`Experiment ${definition.number} Report`}
        description={definition.title}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={loaded.status === "in_progress" ? "warning" : "success"}>{statusLabel}</Badge>
        <Badge tone="neutral">Report {model.completionPercent}% complete</Badge>
        {grade?.autoScore !== null && grade?.autoScore !== undefined ? (
          <Badge tone="neutral">Automatic assessment: {grade.autoScore}/100</Badge>
        ) : null}
        {grade?.finalScore !== null && grade?.finalScore !== undefined ? (
          <Badge tone="success">Final: {grade.finalScore}/100</Badge>
        ) : null}
        <Link
          href={`/lab/${loaded.experimentId}/attempt/${attemptId}`}
          className="ms-auto text-sm font-semibold text-primary hover:underline"
        >
          {loaded.canWrite ? "Return to 3D Laboratory →" : "Open attempt →"}
        </Link>
      </div>

      {model.missingItems.length > 0 && loaded.canWrite ? (
        <Alert tone="warning" title="Still to complete">
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
            {model.missingItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <section aria-label="Student information" className="mt-6 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Student information</h2>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Name</dt><dd>{profile?.fullName ?? "—"}</dd></div>
          <div><dt className="text-muted">Registration</dt><dd>{profile?.registrationNumber ?? "—"}</dd></div>
          <div><dt className="text-muted">Attempt</dt><dd className="font-mono text-xs">{attemptId.slice(0, 8)}</dd></div>
          <div><dt className="text-muted">Submitted</dt><dd>{storedReport?.submittedAt ? new Date(storedReport.submittedAt).toLocaleString() : "Not yet submitted"}</dd></div>
        </dl>
      </section>

      <section aria-label="Aim" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Aim</h2>
        <p className="mt-1 text-sm">{definition.aim}</p>
      </section>

      <section aria-label="Theory" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Theory</h2>
        <p className="mt-1 text-sm">HA + BOH → H₂O + BA (1:1 neutralisation).</p>
        <p className="mt-1 text-sm">{definition.theory}</p>
        <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Safety</h3>
        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm">
          {definition.safety.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>

      <section aria-label="Apparatus and chemicals" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Apparatus and chemicals</h2>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Apparatus</h3>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm">
              {definition.apparatus.map((item) => (
                <li key={item.key}>{item.name}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Chemicals</h3>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm">
              {definition.chemicals.map((chemical) => (
                <li key={chemical.key}>
                  {chemical.name}
                  {chemical.concentration !== undefined && chemical.key !== "hcl_unknown"
                    ? ` (${chemical.concentration} ${chemical.concentrationUnit ?? ""})`
                    : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-label="Procedure summary" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Procedure summary</h2>
        <ol className="mt-1 flex list-decimal flex-col gap-0.5 pl-5 text-sm">
          {definition.procedure.map((step) => (
            <li key={step.stepNumber}>{step.title}</li>
          ))}
        </ol>
      </section>

      {model.stages.map((stageModel, index) => (
        <section key={stageModel.key} aria-label={stageModel.title} className="mt-4 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">
              {index === 0 ? "Part II" : `Part ${index + 1}`} — {stageModel.title}
            </h2>
            <Badge tone={stageModel.concordant ? "success" : "warning"}>
              {stageModel.concordant ? "Concordant" : "Not concordant"}
            </Badge>
          </div>

          {stageModel.analyteKind === "weighed_mass" ? (
            <p className="mt-1 text-sm">
              KHP mass by difference: <span className="font-medium">{stageModel.khpMassG ?? "—"} g</span>
            </p>
          ) : (
            <p className="mt-1 text-sm">
              HCl aliquot (measuring cylinder): <span className="font-medium">{stageModel.aliquotMl ?? "—"} mL</span>
            </p>
          )}

          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-1 pe-2">Trial</th>
                  <th className="py-1 pe-2">Initial (mL)</th>
                  <th className="py-1 pe-2">Final (mL)</th>
                  <th className="py-1 pe-2">Titre (mL)</th>
                  <th className="py-1 pe-2">Reported (mol/L)</th>
                  <th className="py-1 pe-2">Check</th>
                  <th className="py-1 pe-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {stageModel.trials.map((trial) => (
                  <tr key={trial.trialNumber} className="border-b border-line last:border-0">
                    <td className="py-1 pe-2 font-medium">{trial.trialNumber}</td>
                    <td className="py-1 pe-2 tabular-nums">{trial.initialMl?.toFixed(2) ?? "—"}</td>
                    <td className="py-1 pe-2 tabular-nums">{trial.finalMl?.toFixed(2) ?? "—"}</td>
                    <td className="py-1 pe-2 tabular-nums">{trial.titreMl?.toFixed(2) ?? "—"}</td>
                    <td className="py-1 pe-2 tabular-nums">{trial.reportedMolarityM ?? "—"}</td>
                    <td className="py-1 pe-2">
                      {trial.correct === null ? "Not yet assessed" : trial.correct ? "Agrees" : "Outside tolerance"}
                    </td>
                    <td className="py-1 pe-2">
                      {trial.status}
                      {trial.rejectionReason ? ` — ${trial.rejectionReason}` : null}
                    </td>
                  </tr>
                ))}
                {stageModel.trials.length === 0 ? (
                  <tr><td colSpan={7} className="py-2 text-muted">No trials recorded yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-xs text-muted">
            Spread {stageModel.spread ?? "—"} {stageModel.spreadUnit} (allowed {stageModel.allowedSpread}{" "}
            {stageModel.spreadUnit}); accepted trials{" "}
            {stageModel.acceptedTrials.length > 0 ? stageModel.acceptedTrials.join(", ") : "none"}
            {stageModel.discardedTrials.length > 0
              ? `; rejected (excluded from the average): ${stageModel.discardedTrials.join(", ")}`
              : ""}
            {stageModel.averageMolarityM !== null
              ? `; average of the two closest: ${stageModel.averageMolarityM} mol/L`
              : ""}
          </p>

          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Calculations</h3>
          {stageModel.calculations.map((calc) => (
            <div key={calc.trialNumber} className="mt-1 rounded border border-line px-2 py-1.5 text-xs">
              <p className="font-medium">Trial {calc.trialNumber}</p>
              {calc.inputs.map((input) => (
                <p key={input.label} className="text-muted">
                  {input.label}: <span className="text-foreground">{input.value}</span>
                </p>
              ))}
              <p className="font-mono">{calc.formula}</p>
              <p>
                Result:{" "}
                <span className="font-medium tabular-nums">
                  {calc.result !== null ? `${calc.result} ${calc.unit}` : "Awaiting standardised NaOH"}
                </span>
              </p>
            </div>
          ))}

          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Uncertainty</h3>
          <p className="mt-1 text-xs text-muted">
            Burette reading ±{stageModel.burettePrecisionMl} mL; {stageModel.samplePrecision.label} ±
            {stageModel.samplePrecision.value} {stageModel.samplePrecision.unit}; titre from two
            readings ±{(Math.sqrt(2) * stageModel.burettePrecisionMl).toFixed(3)} mL combined. Final
            molarities inherit these measurement uncertainties.
          </p>
        </section>
      ))}

      <section aria-label="Results" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Results</h2>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Standardised NaOH</dt><dd className="font-medium">{model.standardizedNaohM !== null ? `${model.standardizedNaohM} mol/L` : "—"}</dd></div>
          <div><dt className="text-muted">Unknown HCl</dt><dd className="font-medium">{model.finalHclM !== null ? `${model.finalHclM} mol/L` : "—"}</dd></div>
        </dl>
        {sections.resultsSummary ? <p className="mt-2 text-sm">{sections.resultsSummary}</p> : null}
      </section>

      <section aria-label="Observations" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Observations</h2>
        {model.observations.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No observations recorded.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {model.observations.map((observation, index) => (
              <li key={`${observation.fieldKey}-${index}`}>
                <span className="text-muted">{observation.prompt}</span> {observation.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Questions" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Questions</h2>
          <Badge tone="neutral">{model.questionsTotal}/{model.questionsMax} marks</Badge>
        </div>
        <QuestionForm
          attemptId={attemptId}
          questions={model.questions.map((question) => ({ key: question.key, prompt: question.prompt, answer: question.answer }))}
          errorSources={typeof answers._error_sources === "string" ? answers._error_sources : ""}
          canWrite={loaded.canWrite}
        />
      </section>

      <section aria-label="Conclusion" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Conclusion</h2>
        <p className="mt-1 text-sm">{sections.conclusion ? sections.conclusion : "Not written yet."}</p>
      </section>

      <section aria-label="Assessment" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Automatic assessment</h2>
        {!grade || grade.autoScore === null ? (
          <p className="mt-1 text-sm text-muted">
            The automatic assessment runs when the attempt is submitted. Nothing is marked yet.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm">
              Auto score: <span className="font-medium">{grade.autoScore}/100</span> (decision: {grade.decision})
            </p>
            {grade.instructorScore !== null ? (
              <p className="mt-1 text-sm">Instructor score: <span className="font-medium">{grade.instructorScore}/100</span></p>
            ) : null}
            {feedback.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {feedback.map((item) => (
                  <li key={item.id}><span className="text-muted">[{item.category}]</span> {item.body}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>
    </PageContainer>
  );
}
