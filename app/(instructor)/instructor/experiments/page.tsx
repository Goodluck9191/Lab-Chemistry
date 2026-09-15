import { ComingLater } from "@/components/layout/coming-later";
import { PageContainer, PageHeader } from "@/components/layout/page-container";

export const metadata = { title: "Experiments" };

export default function InstructorExperimentsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Experiments"
        description="The experiment catalog, its chemical and apparatus requirements, and the marking scheme."
      />
      <ComingLater
        stage="the experiment configuration stage"
        available="The catalog tables (experiments, steps, chemicals, apparatus) exist, are readable by instructors, and are writable by no client at all - definitions change only through reviewed migrations or the service role."
        preview="This screen will list each experiment with its type, its required apparatus and chemicals, and the rubric that marks it."
      />
    </PageContainer>
  );
}
