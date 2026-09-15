"use client";

import { useActionState } from "react";
import { startAttemptAction } from "@/application/attempts/actions";
import { IDLE_START_ATTEMPT_STATE } from "@/application/attempts/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Starts or resumes an attempt. The experiment id travels in a hidden field and
 * is validated with Zod on the server; the student id is never sent, because the
 * server takes it from the authenticated session.
 */
export function StartAttemptButton({
  experimentId,
  label = "Start experiment",
  variant = "primary",
}: {
  experimentId: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [state, formAction, pending] = useActionState(startAttemptAction, IDLE_START_ATTEMPT_STATE);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="experimentId" value={experimentId} />
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? "Opening…" : label}
      </Button>
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}
    </form>
  );
}
