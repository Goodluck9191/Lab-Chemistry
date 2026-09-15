"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ExperimentNotFoundError, startAttempt } from "./start-attempt";
import { experimentIdSchema } from "./schemas";
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
