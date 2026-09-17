"use client";

import { CheckCircle2, Info, Loader2, TriangleAlert } from "lucide-react";
import { useLabServer } from "./lab-state-provider";
import { cn } from "@/lib/utils";
import type { ActionFeedbackTone } from "./action-feedback";

/**
 * The laboratory console.
 *
 * One line, always the truth about the last thing that happened: what is running
 * now, what the laboratory just did in chemistry terms, or silence when an
 * action was refused or never reached storage. It is a polite live region, so a
 * screen reader hears "Titrant delivered: 1.00 mL. The flask is now faint pink."
 * rather than noticing the drawings change.
 *
 * It deliberately does NOT restate autosave status — `AutosaveIndicator` owns
 * that — and it never words a refusal, because the engine's own student-facing
 * message is already shown as an alert.
 */
const TONE_CLASSES: Record<ActionFeedbackTone, string> = {
  info: "text-muted",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

const TONE_ICONS: Record<ActionFeedbackTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: TriangleAlert,
};

export function ActionConsole({ className }: { className?: string }) {
  const { pending, state } = useLabServer();
  const feedback = state.lastFeedback;

  const tone: ActionFeedbackTone = feedback?.tone ?? "info";
  const Icon = pending ? Loader2 : TONE_ICONS[tone];
  const message = feedback?.message ?? "Ready — the bench is idle.";

  return (
    <p
      role="status"
      aria-live="polite"
      aria-busy={pending}
      className={cn(
        "flex items-center gap-2 border-t border-line bg-surface px-3 py-1.5 text-xs",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-3.5 shrink-0", pending ? "animate-spin text-muted" : TONE_CLASSES[tone])}
      />
      <span className={cn("min-w-0 truncate", TONE_CLASSES[tone])}>{message}</span>
    </p>
  );
}
