"use client";

import { AlertTriangle, CheckCircle2, CloudOff, Loader2 } from "lucide-react";
import { useLabServer } from "./lab-state-provider";
import { cn } from "@/lib/utils";

/**
 * Autosave status.
 *
 * This indicator only ever reflects what the SERVER reported. `Saved` appears
 * after the action response carried a new revision — never because local React
 * state changed — and `Save failed` appears when the write did not happen.
 * The revision is shown so the state on screen can be tied to a stored one.
 */
export function AutosaveIndicator({ className }: { className?: string }) {
  const { saveStatus, state } = useLabServer();

  const config = {
    idle: {
      icon: CloudOff,
      label: "Not saved yet",
      detail: "No action has been recorded on this attempt in this session.",
      tone: "text-muted",
    },
    saving: {
      icon: Loader2,
      label: "Saving…",
      detail: "Waiting for the server to confirm the write.",
      tone: "text-muted",
    },
    saved: {
      icon: CheckCircle2,
      label: "Saved",
      detail: `Stored as revision ${state.revision}.`,
      tone: "text-success",
    },
    failed: {
      icon: AlertTriangle,
      label: "Save failed",
      detail: "The last action was not stored. Retry it before continuing.",
      tone: "text-danger",
    },
  }[saveStatus];

  const Icon = config.icon;

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-2 text-xs", className)}
      title={config.detail}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-4", config.tone, saveStatus === "saving" && "animate-spin")}
      />
      <span className={cn("font-medium", config.tone)}>{config.label}</span>
      <span className="text-muted">
        {saveStatus === "saved" && state.lastSavedAt
          ? `· rev ${state.revision} · ${new Date(state.lastSavedAt).toLocaleTimeString()}`
          : `· rev ${state.revision}`}
      </span>
    </p>
  );
}
