import { ComingLater } from "@/components/layout/coming-later";
import { PageContainer, PageHeader } from "@/components/layout/page-container";

export const metadata = { title: "Students" };

export default function InstructorStudentsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Students"
        description="Roster and per-student progress across the practical course."
      />
      <ComingLater
        stage="the instructor dashboard stage"
        available="The profiles table and its policies already let an instructor read every student profile while a student can read only their own. Cohort grouping (courses and enrolments) is a decision that stage will settle."
        preview="Once students register and start attempts, their progress - experiments started, submitted and graded - will be listed here."
      />
    </PageContainer>
  );
}
