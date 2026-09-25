import Link from "next/link";
import { requireStudent } from "@/application/auth/dal";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { listAttemptsForStudent } from "@/infrastructure/supabase/repositories/attempts";
import { PageContainer, PageHeader } from "@/components/layout/page-container";
import { EmptyState } from "@/components/layout/state-views";

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
        description="The written report for each completed attempt, built from your actual measurements."
      />

      <div className="mt-6">
        {submittable.length === 0 ? (
          <EmptyState
            title="No submitted attempts"
            description="A report becomes available once you have submitted an attempt."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
            {submittable.map((attempt) => (
              <li key={attempt.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                <span>
                  Experiment {attempt.experimentNumber}: {attempt.experimentTitle}
                </span>
                <span className="text-muted">({attempt.status})</span>
                <Link
                  href={`/student/reports/${attempt.id}`}
                  className="ms-auto font-semibold text-primary hover:underline"
                >
                  Open report →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
