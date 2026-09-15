import Link from "next/link";
import { requireStudent } from "@/application/auth/dal";
import { listAvailableExperiments } from "@/application/experiments/list-experiments";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { listAttemptsForStudent } from "@/infrastructure/supabase/repositories/attempts";
import { StartAttemptButton } from "@/components/experiments/start-attempt-button";
import { PageContainer, PageHeader } from "@/components/layout/page-container";
import { EmptyState } from "@/components/layout/state-views";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EXPERIMENT_TYPE_LABELS, TITRATION_SUBTYPE_LABELS } from "@/domain/experiments";

export const metadata = { title: "Experiment library" };

export default async function ExperimentLibraryPage() {
  const { profile } = await requireStudent("/student/experiments");
  const supabase = await createServerSupabaseClient();

  const [experiments, attempts] = await Promise.all([
    listAvailableExperiments(),
    listAttemptsForStudent(supabase, profile.id),
  ]);

  const activeByExperiment = new Map(
    attempts
      .filter((attempt) => attempt.status === "in_progress")
      .map((attempt) => [attempt.experimentId, attempt]),
  );

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Experiment library"
        description="Read the theory, safety notes and procedure before you start. Starting an experiment opens your own attempt: nothing you do there is visible to another student."
      />

      {experiments.length === 0 ? (
        <EmptyState
          title="No experiments are published yet"
          description="Once an experiment is published here it will appear with its aim, theory, safety notes and procedure."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {experiments.map((experiment) => {
            const active = activeByExperiment.get(experiment.id);

            return (
              <Card key={experiment.id}>
                <CardBody className="flex h-full flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">Experiment {experiment.number}</Badge>
                      <Badge tone="primary">
                        {EXPERIMENT_TYPE_LABELS[experiment.type]}
                      </Badge>
                      {experiment.subtype ? (
                        <Badge tone="neutral">
                          {TITRATION_SUBTYPE_LABELS[experiment.subtype]}
                        </Badge>
                      ) : null}
                      {experiment.accuracy === "assumed" ? (
                        <Badge tone="warning">Values unverified</Badge>
                      ) : null}
                    </div>
                    <h2 className="text-base font-semibold tracking-tight">
                      {experiment.title}
                    </h2>
                    <p className="text-sm text-muted">{experiment.description}</p>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-3">
                    <StartAttemptButton
                      experimentId={experiment.id}
                      label={active ? "Resume attempt" : "Start experiment"}
                      variant={active ? "secondary" : "primary"}
                    />
                    <Link
                      href={`/lab/${experiment.id}`}
                      className="text-sm font-medium text-primary underline"
                    >
                      Read the procedure
                    </Link>
                    {active ? (
                      <Link
                        href={`/lab/${experiment.id}/attempt/${active.id}`}
                        className="text-sm font-medium text-primary underline"
                      >
                        Open workspace
                      </Link>
                    ) : null}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
