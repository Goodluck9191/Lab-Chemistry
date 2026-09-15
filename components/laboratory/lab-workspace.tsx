import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * STRUCTURAL PLACEHOLDER ONLY.
 *
 * This is the layout skeleton for the virtual laboratory: the six regions the
 * finished workspace will have. No apparatus is interactive and no chemistry is
 * simulated here - the titration engine, the burette, measurements and trials
 * arrive in later stages. Defining the regions now fixes the layout so the
 * simulation can be dropped into a stable frame.
 */
export function LabWorkspace({
  experimentTitle,
  experimentNumber,
  experimentType,
  attemptStatus,
  instructions,
  apparatus,
  controls,
  measurements,
}: {
  experimentTitle: string;
  experimentNumber: number;
  experimentType: string;
  attemptStatus: string;
  instructions: ReactNode;
  apparatus: ReactNode;
  controls: ReactNode;
  measurements: ReactNode;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Experiment header */}
      <header className="lg:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">
            Experiment {experimentNumber}
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight">{experimentTitle}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{experimentType}</Badge>
          <Badge tone="primary">{attemptStatus}</Badge>
        </div>
      </header>

      {/* Instructions panel */}
      <LabPanel title="Instructions" description="Aim, theory, safety and procedure">
        {instructions}
      </LabPanel>

      {/* Laboratory canvas */}
      <LabPanel
        title="Laboratory canvas"
        description="The virtual bench will be rendered here"
        className="lg:col-start-1"
      >
        <div className="lab-canvas-grid flex min-h-64 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong bg-surface-muted/40 p-6 text-center">
          <FlaskConical aria-hidden="true" className="size-6 text-muted" />
          <p className="text-sm font-medium">Interactive bench not built yet</p>
          <p className="max-w-sm text-xs text-muted">
            Apparatus, solutions and simulated chemical changes belong to the next stage. The
            layout, experiment configuration and security model around it are already in place.
          </p>
        </div>
      </LabPanel>

      {/* Apparatus area */}
      <LabPanel title="Apparatus" description="Available equipment for this experiment">
        {apparatus}
      </LabPanel>

      {/* Measurement panel */}
      <LabPanel
        title="Measurements and trials"
        description="Readings, repeated trials and concordance"
        className="lg:col-start-1"
      >
        {measurements}
      </LabPanel>

      {/* Experiment controls */}
      <LabPanel title="Experiment controls" description="Actions available right now">
        {controls}
      </LabPanel>
    </div>
  );
}

function LabPanel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn("flex flex-col rounded-lg border border-line bg-surface", className)}
    >
      <header className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </header>
      <div className="min-h-32 flex-1 px-4 py-4">{children}</div>
    </section>
  );
}

/** A read-only, "not yet implemented" placeholder list for the lab panels. */
export function PendingNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-line-strong px-3 py-6 text-center text-xs text-muted">
      {children}
    </p>
  );
}
