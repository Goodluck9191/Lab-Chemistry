"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { LabStateView } from "@/application/attempts/lab-state";
import { LabStateProvider } from "./lab-state-provider";
import type { LabActionSender, LabStateLoader } from "./lab-action-controller";
import { ActionConsole } from "./action-console";
import { LabHeader } from "./lab-header";
import { LabNotices } from "./lab-notices";
import { LabBench } from "./lab-bench";
import { ProcedurePanel } from "./procedure-panel";
import { TitrationControls } from "./titration-controls";
import { PreparationControls } from "./preparation-controls";
import { ApparatusTray } from "./apparatus-tray";
import { ActionPanel } from "./action-panel";
import { FocusMode } from "./focus-mode";
import { TrialTable } from "./trial-table";
import { ConcordancePanel } from "./concordance-panel";
import { MeasurementPanel } from "./measurement-panel";
import { ObservationPanel } from "./observation-panel";
import { CalculationPanel } from "./calculation-panel";
import { ReviewSubmitPanel } from "./review-submit-panel";

/**
 * The laboratory workspace.
 *
 * Desktop: 3-column layout
 *   LEFT  (260px) — collapsible procedure sidebar
 *   CENTER (flex) — large SVG laboratory bench
 *   RIGHT (280px) — contextual actions, apparatus tray, controls
 *
 * Bottom: expandable results panel
 *
 * Mobile: single-column with the lab bench taking maximum space.
 * Procedure and controls stack vertically below.
 *
 * The transport is injectable (`send`/`loadState`) so the development preview can
 * drive this exact workspace from scenarios. The real route passes neither, and
 * the controller then uses the persisted server actions.
 */
export function LabWorkspace({
  initialState,
  send,
  loadState,
  heightClassName = "h-[100dvh]",
}: {
  initialState: LabStateView;
  /** Test/preview seam. Omitted in the real laboratory. */
  send?: LabActionSender;
  loadState?: LabStateLoader;
  /** The real route owns the viewport; an embedding shell supplies its own. */
  heightClassName?: string;
}) {
  return (
    <LabStateProvider initialState={initialState} send={send} loadState={loadState}>
      <LabWorkspaceBody initialState={initialState} heightClassName={heightClassName} />
    </LabStateProvider>
  );
}

function LabWorkspaceBody({
  initialState,
  heightClassName,
}: {
  initialState: LabStateView;
  heightClassName: string;
}) {
  const [resultsExpanded, setResultsExpanded] = useState(false);

  return (
    <div className={`flex flex-col overflow-hidden ${heightClassName}`}>
      {/* Compact sticky header */}
      <LabHeader initialState={initialState} />

      {/* Notices: only visible when there's something to say */}
      <LabNotices initialState={initialState} />

      {/* Main workspace: 3-column on desktop */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT: Procedure sidebar (desktop only) */}
        <div className="hidden lg:flex">
          <ProcedurePanel procedure={initialState.procedure} initialState={initialState} />
        </div>

        {/* CENTER: Virtual laboratory — this must dominate */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* The SVG bench fills available space */}
          <div className="relative min-h-0 flex-1 overflow-auto p-2 sm:p-3">
            <LabBench initialState={initialState} />
          </div>

          {/* What the laboratory is doing, in chemistry terms */}
          <ActionConsole />

          {/* Mobile: procedure below the lab */}
          <div className="lg:hidden">
            <div className="border-t border-line bg-surface">
              <ProcedurePanel procedure={initialState.procedure} initialState={initialState} />
            </div>
          </div>

          {/* Mobile: controls below procedure */}
          <div className="border-t border-line bg-surface p-3 lg:hidden">
            <PreparationControls initialState={initialState} />
            <TitrationControls />
          </div>

          {/* Expandable bottom results panel */}
          <div className="border-t border-line bg-surface">
            <button
              type="button"
              onClick={() => setResultsExpanded((e) => !e)}
              className="flex w-full items-center justify-between px-4 py-2 text-xs font-semibold text-muted hover:bg-surface-muted"
              aria-expanded={resultsExpanded}
            >
              <span>Results & Data</span>
              {resultsExpanded ? (
                <ChevronDown aria-hidden="true" className="size-4" />
              ) : (
                <ChevronUp aria-hidden="true" className="size-4" />
              )}
            </button>

            {resultsExpanded ? (
              <div className="max-h-[35vh] overflow-y-auto border-t border-line px-4 pb-4 pt-3">
                <div className="grid gap-4 md:grid-cols-2">
                  <MeasurementPanel />
                  <ConcordancePanel />
                  <div className="md:col-span-2">
                    <TrialTable />
                  </div>
                  <div className="md:col-span-2">
                    <ObservationPanel initialState={initialState} />
                  </div>
                  <div className="md:col-span-2">
                    <CalculationPanel initialState={initialState} />
                  </div>
                  <div className="md:col-span-2">
                    <ReviewSubmitPanel initialState={initialState} />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT: Action panel (desktop only) */}
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface lg:flex xl:w-80">
          {/* Apparatus tray */}
          <div className="border-b border-line px-3 py-3">
            <ApparatusTray initialState={initialState} />
          </div>

          {/* Contextual instrument actions */}
          <div className="px-3 py-3">
            <ActionPanel initialState={initialState} />
          </div>
        </aside>
      </div>

      {/* Burette focus mode: read the meniscus large, then act */}
      <FocusMode initialState={initialState} />
    </div>
  );
}
