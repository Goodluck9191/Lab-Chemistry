import Link from "next/link";
import { requireStudent } from "@/application/auth/dal";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { listAttemptsForStudent } from "@/infrastructure/supabase/repositories/attempts";
import { PageContainer, PageHeader } from "@/components/layout/page-container";
import { EmptyState } from "@/components/layout/state-views";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { ATTEMPT_STATUS_LABELS } from "@/domain/attempts";

export const metadata = { title: "Progress" };

const TONE_BY_STATUS = {
  in_progress: "primary",
  submitted: "warning",
  graded: "success",
  returned: "danger",
  abandoned: "neutral",
} as const;

export default async function ProgressPage() {
  const { profile } = await requireStudent("/student/progress");
  const supabase = await createServerSupabaseClient();
  const attempts = await listAttemptsForStudent(supabase, profile.id);

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Progress"
        description="Every attempt you have made, with its current state. Scores and per-criterion feedback appear here once an instructor has reviewed your submission."
      />

      {attempts.length === 0 ? (
        <EmptyState
          title="No attempts yet"
          description="Start an experiment from the library and your attempts will be listed here."
        />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-2xl border-collapse text-sm">
              <caption className="sr-only">Your experiment attempts</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="px-5 py-3 font-medium">Experiment</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 font-medium">Started</th>
                  <th scope="col" className="px-5 py-3 font-medium">Submitted</th>
                  <th scope="col" className="px-5 py-3 font-medium">Score</th>
                  <th scope="col" className="px-5 py-3 font-medium">Open</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      Experiment {attempt.experimentNumber}: {attempt.experimentTitle}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={TONE_BY_STATUS[attempt.status]}>
                        {ATTEMPT_STATUS_LABELS[attempt.status]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {new Date(attempt.startedAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {attempt.submittedAt
                        ? new Date(attempt.submittedAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-5 py-3 tabular-nums">
                      {attempt.finalScore === null ? "—" : `${attempt.finalScore}%`}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/lab/${attempt.experimentId}/attempt/${attempt.id}`}
                        className="font-medium text-primary underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </PageContainer>
  );
}
