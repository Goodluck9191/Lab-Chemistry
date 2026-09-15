import { ComingLater } from "@/components/layout/coming-later";
import { PageContainer, PageHeader } from "@/components/layout/page-container";

export const metadata = { title: "Reports" };

export default function InstructorReportsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        description="Cohort and per-experiment summaries for teaching review."
      />
      <ComingLater
        stage="the assessment stage"
        available="Report rows, their length limits and their permissions are in place, along with grades and instructor feedback."
        preview="Cohort summaries - for example a systematic overshoot of the endpoint across a class - will be built on top of the graded attempts."
      />
    </PageContainer>
  );
}
