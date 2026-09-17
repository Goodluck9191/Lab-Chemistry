"use client";

import { cn } from "@/lib/utils";
import type { ControlAvailability } from "./control-availability";

/**
 * The visible explanation for a control that cannot be used yet.
 *
 * Rendered as ordinary text rather than a tooltip, because a tooltip is
 * unreachable by touch and invisible to a keyboard user who has not hovered.
 * `describedBy` returns the matching id so the control announces the reason as
 * its description.
 *
 * Deliberately NOT `role="alert"`: a reason is a standing property of the
 * control, not an event, and shouting every one of them at a screen reader as
 * the page renders would bury the messages that matter.
 */
export function ControlReason({
  id,
  reason,
  className,
}: {
  id: string;
  reason: string | null;
  className?: string;
}) {
  if (!reason) return null;
  return (
    <p id={id} className={cn("text-xs text-warning", className)}>
      {reason}
    </p>
  );
}

/** `aria-describedby` value for a control, or undefined when it is available. */
export function describedBy(id: string, availability: ControlAvailability): string | undefined {
  return availability.available ? undefined : id;
}
