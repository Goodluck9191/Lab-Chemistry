import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/layout/state-views";

export default function NotFound() {
  return (
    <PageContainer width="narrow" className="flex flex-1 flex-col justify-center">
      <EmptyState
        title="Page not found"
        description="The page you asked for does not exist, or you no longer have access to it."
        action={
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-4 text-sm font-medium"
          >
            Back to the start
          </Link>
        }
      />
    </PageContainer>
  );
}
