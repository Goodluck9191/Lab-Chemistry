"use client";

import { PageContainer } from "@/components/layout/page-container";
import { RouteErrorState } from "@/components/layout/state-views";

export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PageContainer width="narrow">
      <RouteErrorState error={error} reset={reset} />
    </PageContainer>
  );
}
