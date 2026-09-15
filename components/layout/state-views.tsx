import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Nothing to show yet, with a nudge towards the action that fills it. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-5 py-6 text-sm text-muted">
      <Spinner label={label} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Alert tone="danger" title={title}>
        {description ?? "Please try again. If it keeps failing, tell your instructor."}
      </Alert>
      {action}
    </div>
  );
}

/** Used by route-level error boundaries, which receive an error and a reset. */
export function RouteErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="This page could not be loaded"
      description={error.message}
      action={
        <form action={reset}>
          <button
            type="submit"
            className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
        </form>
      }
    />
  );
}
