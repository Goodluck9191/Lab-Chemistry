"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLabUi } from "../../lab-state-provider";
import { cn } from "@/lib/utils";

/**
 * The minimal procedure card (§25).
 *
 * The procedure says WHAT has to happen; the student decides HOW to do it in
 * the room. So this shows exactly one written step at a time, with Previous /
 * Next to move through the manual and a link to the full procedure drawer. It
 * is deliberately NOT a list of action buttons: nothing here performs a step,
 * and nothing here is phrased as "click here to add KHP".
 *
 * The step the student is reading is UI-first and persisted with their next
 * action (the provider attaches it to the envelope), so leaving and returning
 * opens the manual where they left it — without a second write path (§33).
 */
export interface StepCardStep {
  stepNumber: number;
  title: string;
  instruction: string;
  isRequired: boolean;
}

export function StepCard({
  procedure,
  onOpenProcedure,
  onOpenHelp,
}: {
  procedure: StepCardStep[];
  onOpenProcedure: () => void;
  onOpenHelp: () => void;
}) {
  const { procedureStep, setProcedureStep, readingMode, promptOpen } = useLabUi();
  const [collapsed, setCollapsed] = useState(false);

  if (procedure.length === 0) return null;
  // Reading Mode already uses the upper screen for the meniscus; the card would
  // crowd it, so it stands down while the student is reading the scale.
  if (readingMode) return null;

  const index = Math.min(Math.max(procedureStep, 1), procedure.length);
  const step = procedure[index - 1];
  const total = procedure.length;

  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-24 z-30 max-w-[19rem] rounded-lg border border-line bg-surface/92 shadow-lg backdrop-blur",
        // The contextual prompt opens bottom-centre; the card keeps out of the
        // way by tucking to the left whenever that surface is up.
        promptOpen ? "left-2 opacity-90" : "left-2",
      )}
      role="status"
      aria-label="Current procedure step"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Step {index} of {total}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto h-6 w-6 p-0"
          aria-label={collapsed ? "Expand the step card" : "Collapse the step card"}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? (
            <ChevronUp aria-hidden="true" className="size-4" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-4" />
          )}
        </Button>
      </div>

      {collapsed ? null : (
        <div className="px-2.5 pb-2">
          <p className="text-xs font-medium leading-snug">{step.title}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">{step.instruction}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-[11px]"
              disabled={index <= 1}
              onClick={() => setProcedureStep(Math.max(1, index - 1))}
            >
              <ChevronLeft aria-hidden="true" className="size-3" />
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-[11px]"
              disabled={index >= total}
              onClick={() => setProcedureStep(Math.min(total, index + 1))}
            >
              Next
              <ChevronRight aria-hidden="true" className="size-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={onOpenProcedure}
            >
              Full procedure
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={onOpenHelp}
            >
              <LifeBuoy aria-hidden="true" className="size-3" />
              Help
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
