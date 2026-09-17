"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ExperimentNotFoundError, startAttempt } from "./start-attempt";
import { applyTitrationAction, type TitrationActionResult } from "./apply-simulation-action";
import { getLabState, type LabStateView } from "./lab-state";
import {
  isControlFlowError,
  runLabAction,
  type LabActionOutcome,
} from "./lab-transport";
import { attemptIdSchema, experimentIdSchema } from "./schemas";
import type { StartAttemptFormState } from "./types";

/**
 * Server action used by the experiment library and the briefing page.
 *
 * Note the shape: the fallible call is wrapped in try/catch, and `redirect()` is
 * called *after* it. `redirect()` works by throwing a control-flow signal, so
 * calling it inside the try block would swallow the navigation.
 */
export async function startAttemptAction(
  _previous: StartAttemptFormState,
  formData: FormData,
): Promise<StartAttemptFormState> {
  const parsed = experimentIdSchema.safeParse(formData.get("experimentId"));
  if (!parsed.success) {
    return { status: "error", message: "That experiment could not be identified." };
  }

  let attemptId: string;
  try {
    const result = await startAttempt({ experimentId: parsed.data });
    attemptId = result.attemptId;
  } catch (error) {
    if (error instanceof ExperimentNotFoundError) {
      return { status: "error", message: "That experiment is not available." };
    }
    return { status: "error", message: "The attempt could not be started. Please try again." };
  }

  revalidatePath("/student/dashboard");
  revalidatePath("/student/experiments");
  redirect(`/lab/${parsed.data}/attempt/${attemptId}`);
}

/**
 * Autosave transport for the future laboratory UI: accepts one protocol
 * envelope, applies it through the full persistence unit, and returns the new
 * revision plus the safe public projection.
 *
 * Errors are thrown, not swallowed: the caller distinguishes a revision
 * conflict (refetch and retry) from an authorisation failure by the error
 * name (`RevisionConflictError` vs redirect to login/unauthorized).
 */
export async function applyTitrationActionAction(input: unknown): Promise<TitrationActionResult> {
  return applyTitrationAction(input);
}

/** Result of the laboratory read path: resumable state, or why it is unavailable. */
export type LabStateOutcome =
  | { status: "ok"; state: LabStateView }
  | { status: "error"; code: string; message: string };

/**
 * Laboratory read path. Used when the page resumes an attempt and whenever the
 * action controller has to reconcile after a revision conflict, so the browser
 * always has ONE way to obtain authoritative state.
 */
export async function getLabStateAction(rawAttemptId: unknown): Promise<LabStateOutcome> {
  try {
    const attemptId = attemptIdSchema.parse(rawAttemptId);
    return { status: "ok", state: await getLabState(attemptId) };
  } catch (error) {
    // redirect()/notFound() work by throwing: never convert those into data.
    if (isControlFlowError(error)) throw error;
    return {
      status: "error",
      code: "lab_state_unavailable",
      message: "The laboratory could not be loaded. Reload the page to try again.",
    };
  }
}

/**
 * Laboratory write path. Wraps the Phase 3 autosave unit in a discriminated
 * result so the UI can distinguish a stale revision from a real failure and
 * reconcile instead of overwriting.
 */
export async function submitLabActionAction(input: unknown): Promise<LabActionOutcome> {
  const attemptId =
    typeof input === "object" && input !== null && "attemptId" in input
      ? String((input as { attemptId: unknown }).attemptId)
      : "";

  return runLabAction(
    {
      apply: applyTitrationActionAction,
      reload: async (id) => {
        const state = await getLabState(id);
        return { revision: state.revision, publicState: state.publicState };
      },
    },
    { attemptId },
    input,
  );
}
