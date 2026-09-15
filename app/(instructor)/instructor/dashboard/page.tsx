import { requireInstructor } from "@/application/auth/dal";
import { PageContainer, PageHeader } from "@/components/layout/page-container";
import { EmptyState } from "@/components/layout/state-views";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Instructor dashboard" };

export default async function InstructorDashboardPage() {
  const { profile } = await requireInstructor("/instructor/dashboard");

  return (
    <PageContainer>
      <PageHeader
        title="Instructor dashboard"
        description="Cohort progress, the submission queue and marking, once students have attempts to review."
      />

      <Alert tone="info" title="Marking tools arrive with the assessment stage">
        You are signed in as <strong>{profile.fullName || profile.email}</strong> with the
        instructor role, and the database already permits instructors - and nobody else - to read
        every attempt and to write grades and feedback. What is missing is the review interface:
        it needs real readings and a rubric to show.
      </Alert>

      <div className="mt-6">
        <EmptyState
          title="No submissions to review yet"
          description="When a student submits an attempt it will appear in the submissions queue with its readings, safety events and auto-marked score breakdown."
        />
      </div>
    </PageContainer>
  );
}
