import { ComingLater } from "@/components/layout/coming-later";
import { PageContainer, PageHeader } from "@/components/layout/page-container";

export const metadata = { title: "Submissions" };

export default function InstructorSubmissionsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Submissions"
        description="Attempts waiting for review, with readings, trials, safety events and the auto-marked breakdown."
      />
      <ComingLater
        stage="the assessment stage"
        available="Instructors may already read every attempt and its trials, measurements, observations, calculations and reports, and only instructors may write grades and feedback. Students can read their own results but can never write them."
        preview="Submitted attempts will queue here, ordered by submission time, with the automatic score breakdown shown next to each criterion so a mark can be adjusted with its justification."
      />
    </PageContainer>
  );
}
