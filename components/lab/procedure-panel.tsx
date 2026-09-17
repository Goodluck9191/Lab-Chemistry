"use client";

import { useState } from "react";
import { Check, CircleDot, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useActiveStage } from "./lab-state-provider";
import { cn } from "@/lib/utils";

/**
 * Compact collapsible procedure panel.
 *
 * Shows the experiment steps as a numbered checklist with the current step
 * highlighted. Collapses to a thin vertical strip that the student can expand
 * when needed. The collapsed state is remembered locally.
 */
export function ProcedurePanel({ procedure }: { procedure: Array<{ stepNumber: number; title: string; instruction: string; isRequired: boolean }> }) {
  const stage = useActiveStage();

  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      aria-label="Procedure"
      className={cn(
        "flex shrink-0 flex-col border-r border-line bg-surface transition-all duration-200",
        collapsed ? "w-10" : "w-64"
      )}
    >
      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex h-10 items-center justify-center border-b border-line text-muted hover:bg-surface-muted"
        aria-label={collapsed ? "Expand procedure panel" : "Collapse procedure panel"}
      >
        {collapsed ? (
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        ) : (
          <PanelLeftClose aria-hidden="true" className="size-4" />
        )}
      </button>

      {collapsed ? (
        /* Collapsed: step indicators only */
        <div className="flex flex-1 flex-col items-center gap-1.5 py-3">
          {stage?.preparation.map((step) => (
            <div
              key={step.key}
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-[10px]",
                step.done
                  ? "border-success bg-success/10 text-success"
                  : step.current
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-line text-muted"
              )}
              title={step.label}
            >
              {step.done ? <Check className="size-3" /> : step.current ? <CircleDot className="size-3" /> : ""}
            </div>
          ))}
        </div>
      ) : (
        /* Expanded: full procedure */
        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Procedure</h2>
            {stage ? (
              <p className="mt-0.5 text-[10px] text-muted">
                Stage {String.fromCharCode(65 + stage.index)}
              </p>
            ) : null}
          </div>

          {stage ? (
            <ol className="flex flex-1 flex-col gap-0.5 px-2 pb-3">
              {stage.preparation.map((step) => (
                <li
                  key={step.key}
                  className={cn(
                    "flex items-start gap-2 rounded px-2 py-1.5 text-xs",
                    step.current && "bg-primary/5 ring-1 ring-primary/20",
                    !step.done && !step.current && "opacity-50"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[8px]",
                      step.done
                        ? "border-success text-success"
                        : step.current
                          ? "border-primary text-primary"
                          : "border-line text-muted"
                    )}
                  >
                    {step.done ? <Check className="size-2.5" /> : step.current ? <CircleDot className="size-2.5" /> : ""}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{step.label}</p>
                    {step.current ? (
                      <p className="mt-0.5 text-[10px] leading-snug text-muted">{step.detail}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-3 text-xs text-muted">No stage configured.</p>
          )}

          {/* Current instruction */}
          {stage?.nextAction ? (
            <div className="border-t border-line px-3 py-2" role="status">
              <p className="text-[10px] uppercase tracking-wide text-muted">Next</p>
              <p className="mt-0.5 text-xs font-medium">{stage.nextAction.title}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted">{stage.nextAction.description}</p>
            </div>
          ) : null}

          {/* Written procedure (compact) */}
          <div className="border-t border-line px-3 py-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">Written procedure</h3>
            <ol className="mt-1 flex flex-col gap-1">
              {procedure.map((step) => (
                <li key={step.stepNumber} className="flex gap-1.5 text-[10px] text-muted">
                  <span className="shrink-0 font-semibold">{step.stepNumber}.</span>
                  <span className="leading-snug">{step.title}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </aside>
  );
}
