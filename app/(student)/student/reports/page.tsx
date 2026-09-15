import { requireStudent } from "@/application/auth/dal";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { listAttemptsForStudent } from "@/infrastructure/supabase/repositories/attempts";
import { PageContainer, PageHeader } from "@/components/layout/page-container";
import { EmptyState } from "@/components/layout/state-views";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const { profile } = await requireStudent("/student/reports");
  const supabase = await createServerSupabaseClient();
  const attempts = await listAttemptsForStudent(supabase, profile.id);
  const submittable = attempts.filter((attempt) => attempt.status !== "in_progress");

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        description="The written report for each completed attempt."
      />

      <Alert tone="info" title="Reporting arrives in the next stage">
        The report table, its validation rules and the data access layer are already in place.
        The report editor, automatic marking and instructor feedback screens are built with the
        assessment stage, once there are simulated readings to report on.
      </Alert>

      <div className="mt-6">
        {submittable.length === 0 ? (
          <EmptyState
            title="No submitted attempts"
            description="A report becomes available once you have submitted an attempt."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
            {submittable.map((attempt) => (
              <li key={attempt.id} className="px-5 py-3 text-sm">
                Experiment {attempt.experimentNumber}: {attempt.experimentTitle}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
