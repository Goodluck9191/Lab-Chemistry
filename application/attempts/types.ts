/** State returned by the start-attempt server action. */
export interface StartAttemptFormState {
  status: "idle" | "error";
  message?: string;
}

export const IDLE_START_ATTEMPT_STATE: StartAttemptFormState = { status: "idle" };
