import { Spinner } from "@/components/ui/spinner";
import { PageContainer } from "@/components/layout/page-container";

/**
 * Loading state for the laboratory.
 *
 * The page is server-rendered from the saved attempt, so this is what a student
 * sees while the attempt is read back — deliberately shaped like the bench that
 * is about to appear, so the layout does not jump.
 */
export default function LaboratoryLoading() {
  return (
    <PageContainer width="wide">
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Laboratory</p>
            <p className="text-lg font-semibold tracking-tight">Opening your bench…</p>
          </div>
          <span className="flex items-center gap-2 text-xs text-muted">
            <Spinner label="Loading the laboratory" />
            Loading the saved attempt
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className="h-64 animate-pulse rounded-lg border border-line bg-surface-muted" />
          <div className="h-64 animate-pulse rounded-lg border border-line bg-surface-muted" />
        </div>
      </div>
    </PageContainer>
  );
}
