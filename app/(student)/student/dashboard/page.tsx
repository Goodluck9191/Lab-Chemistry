import Link from "next/link";
import { requireStudent } from "@/application/auth/dal";
import { listAvailableExperiments } from "@/application/experiments/list-experiments";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { listAttemptsForStudent } from "@/infrastructure/supabase/repositories/attempts";
import { PageContainer, PageHeader } from "@/components/layout/page-container";
import { EmptyState } from "@/components/layout/state-views";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ATTEMPT_STATUS_LABELS } from "@/domain/attempts";

export const metadata = { title: "Student dashboard" };

export default async function StudentDashboardPage() {
  const { profile } = await requireStudent("/student/dashboard");
  const supabase = await createServerSupabaseClient();

  const [experiments, attempts] = await Promise.all([
    listAvailableExperiments(),
    listAttemptsForStudent(supabase, profile.id),
  ]);

  const inProgress = attempts.filter((attempt) => attempt.status === "in_progress");
  const awaitingReview = attempts.filter(
    (attempt) => attempt.status === "submitted",
  );

  return (
    <PageContainer>
      <PageHeader
        title={`Welcome, ${profile.fullName || profile.email}`}
        description="Your practicals, attempts in progress and results."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Experiments available" value={experiments.length} />
        <StatCard label="Attempts in progress" value={inProgress.length} />
        <StatCard label="Awaiting review" value={awaitingReview.length} />
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Continue where you left off"
          description="Attempts you have already started."
          actions={
            <Link
              href="/student/experiments"
              className="text-sm font-medium text-primary underline"
            >
              All experiments
            </Link>
          }
        />
        <CardBody className="flex flex-col gap-3">
          {inProgress.length === 0 ? (
            <EmptyState
              title="No attempt in progress"
              description="Open the experiment library and start one when you are ready."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {inProgress.map((attempt) => (
                <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      Experiment {attempt.experimentNumber}: {attempt.experimentTitle}
                    </p>
                    <p className="text-xs text-muted">
                      Last activity {new Date(attempt.lastActivityAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone="primary">{ATTEMPT_STATUS_LABELS[attempt.status]}</Badge>
                    <Link
                      href={`/lab/${attempt.experimentId}/attempt/${attempt.id}`}
                      className="text-sm font-medium text-primary underline"
                    >
                      Resume
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Available experiments" description="Published practicals." />
        <CardBody>
          {experiments.length === 0 ? (
            <EmptyState
              title="No experiments published yet"
              description="Your instructor has not published any practicals, or the seed data has not been applied."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {experiments.map((experiment) => (
                <li key={experiment.id} className="py-3">
                  <p className="text-sm font-medium">
                    Experiment {experiment.number}: {experiment.title}
                  </p>
                  <p className="mt-1 text-xs text-muted">{experiment.description}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardBody>
    </Card>
  );
}
