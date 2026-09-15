import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/layout/state-views";

export const metadata = { title: "Not authorised" };

export default function UnauthorizedPage() {
  return (
    <PageContainer width="narrow" className="flex flex-1 flex-col justify-center">
      <EmptyState
        title="You are not authorised to view that page"
        description="Your account role does not grant access. Students see the student area; instructors see the instructor area."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/student/dashboard"
              className="inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-4 text-sm font-medium"
            >
              Student dashboard
            </Link>
            <Link
              href="/instructor/dashboard"
              className="inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-4 text-sm font-medium"
            >
              Instructor dashboard
            </Link>
          </div>
        }
      />
    </PageContainer>
  );
}
