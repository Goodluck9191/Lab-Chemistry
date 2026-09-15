import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/layout/state-views";

/**
 * Honest placeholder for a screen whose data model and permissions already
 * exist but whose interface belongs to a later stage. It says what is already in
 * place and what is not, instead of faking a working dashboard.
 */
export function ComingLater({
  stage,
  available,
  preview,
}: {
  stage: string;
  available: ReactNode;
  preview: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Alert tone="info" title={`Scheduled for ${stage}`}>
        {available}
      </Alert>
      <EmptyState title="Nothing to display yet" description={preview} />
    </div>
  );
}
