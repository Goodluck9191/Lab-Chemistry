import { ATTEMPT_STATUSES, type AttemptStatus } from "./types";

/**
 * The attempt lifecycle, as pure data plus pure functions. Keeping it here (and
 * not in a React component or a route handler) is what makes it testable and
 * keeps one authority for what a status means.
 *
 *   in_progress -> submitted -> graded            (final)
 *                            -> returned -> in_progress   (resubmission)
 *   in_progress -> abandoned                      (student gives up)
 */
export const ATTEMPT_TRANSITIONS: Record<AttemptStatus, readonly AttemptStatus[]> = {
  in_progress: ["submitted", "abandoned"],
  submitted: ["graded", "returned"],
  graded: [],
  returned: ["in_progress"],
  abandoned: [],
};

export class InvalidAttemptTransitionError extends Error {
  constructor(
    readonly from: AttemptStatus,
    readonly to: AttemptStatus,
  ) {
    super(`Attempt status cannot change from "${from}" to "${to}"`);
    this.name = "InvalidAttemptTransitionError";
  }
}

export function isAttemptStatus(value: unknown): value is AttemptStatus {
  return typeof value === "string" && (ATTEMPT_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: AttemptStatus, to: AttemptStatus): boolean {
  return ATTEMPT_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: AttemptStatus, to: AttemptStatus): void {
  if (!canTransition(from, to)) throw new InvalidAttemptTransitionError(from, to);
}

export function nextStatuses(from: AttemptStatus): readonly AttemptStatus[] {
  return ATTEMPT_TRANSITIONS[from];
}

/** Students may keep working only in these states. Mirrors the database policy
 * `can_write_attempt()` and the RLS UPDATE policy, so UI and database agree. */
export function isAttemptWritable(status: AttemptStatus): boolean {
  return status === "in_progress" || status === "returned";
}

/** Once submitted the readings are frozen; instructors read but never edit them. */
export function isAttemptReadOnly(status: AttemptStatus): boolean {
  return !isAttemptWritable(status);
}

export function isAttemptTerminal(status: AttemptStatus): boolean {
  return status === "graded" || status === "abandoned";
}
