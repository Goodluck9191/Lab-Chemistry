import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AlertTone = "info" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<AlertTone, string> = {
  info: "border-line-strong text-foreground",
  success: "border-line-strong text-success",
  warning: "border-line-strong text-warning",
  danger: "border-line-strong text-danger",
};

/** `role="alert"` only for problems, so a message is announced without nagging. */
export function Alert({
  children,
  tone = "info",
  title,
}: {
  children: ReactNode;
  tone?: AlertTone;
  title?: string;
}) {
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : undefined}
      className={cn("rounded-md border bg-surface px-4 py-3 text-sm", TONE_CLASSES[tone])}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}
