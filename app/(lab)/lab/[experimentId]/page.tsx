import { notFound } from "next/navigation";
import { requireStudent } from "@/application/auth/dal";
import { getExperimentForBriefing } from "@/application/experiments/list-experiments";
import { experimentIdSchema } from "@/application/attempts/schemas";
import { StartAttemptButton } from "@/components/experiments/start-attempt-button";
import { PageContainer, PageHeader } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { APP_NAME } from "@/lib/constants";

export const metadata = { title: "Experiment briefing" };

export default async function ExperimentBriefingPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;

  // Validate before touching the database: a malformed id is a 404, not a query.
  if (!experimentIdSchema.safeParse(experimentId).success) notFound();

  await requireStudent(`/lab/${experimentId}`);

  const experiment = await getExperimentForBriefing(experimentId);
  if (!experiment) notFound();

  return (
    <PageContainer width="wide">
      <PageHeader
        breadcrumb={<span>{APP_NAME}</span>}
        title={`Experiment ${experiment.number}: ${experiment.title}`}
        description={experiment.description}
        actions={<StartAttemptButton experimentId={experiment.id} label="Start this experiment" />}
      />

      {experiment.accuracy === "assumed" ? (
        <p className="mb-6">
          <Badge tone="warning">
            Numeric values are provisional and await verification against the practical manual
          </Badge>
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Aim" />
            <CardBody>
              <p className="text-sm">{experiment.aim}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Theory" />
            <CardBody>
              <p className="text-sm leading-relaxed">{experiment.theory}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Procedure" description="Perform these operations in order." />
            <CardBody>
              <ol className="flex flex-col gap-4">
                {experiment.procedure.map((step) => (
                  <li key={step.stepNumber} className="flex gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs font-semibold">
                      {step.stepNumber}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{step.title}</p>
                      <p className="mt-0.5 text-sm text-muted">{step.instruction}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Safety" />
            <CardBody>
              <ul className="flex list-disc flex-col gap-2 pl-4 text-sm">
                {experiment.safety.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Apparatus" />
            <CardBody>
              <ul className="flex flex-col gap-2 text-sm">
                {experiment.apparatus.map((item) => (
                  <li key={item.key} className="flex justify-between gap-3">
                    <span>{item.name}</span>
                    {item.capacityMl ? (
                      <span className="text-muted tabular-nums">{item.capacityMl} mL</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Chemicals" />
            <CardBody>
              <ul className="flex flex-col gap-2 text-sm">
                {experiment.chemicals.map((chemical) => (
                  <li key={chemical.key} className="flex flex-col">
                    <span>
                      {chemical.name}
                      {chemical.formula ? (
                        <span className="text-muted"> ({chemical.formula})</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted">
                      {chemical.role.replace(/_/g, " ")}
                      {chemical.concentration !== undefined
                        ? ` · ${chemical.concentration} ${chemical.concentrationUnit ?? ""}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
