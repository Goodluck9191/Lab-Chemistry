/**
 * Hidden per-attempt experimental parameters.
 *
 * SECURITY CONTRACT
 * -----------------
 * - Values are generated server-side when an attempt starts (later stage) and
 *   stored ONLY in the `attempt_secrets` table, which has Row Level Security
 *   enabled and zero policies, with all grants revoked from `anon` and
 *   `authenticated`. PostgREST therefore cannot read it with a student's token.
 * - Only server-side code (SECURITY DEFINER database functions or the
 *   service-role client in `infrastructure/supabase/admin.ts`, marked
 *   `server-only`) may construct or read this type.
 * - `SimulationEngine.view()` must never include these values; it returns the
 *   sanitised `EngineView` only.
 */
export interface AttemptSecrets {
  /** Deterministic RNG seed, so an attempt replays identically. */
  seed: string;
  /** e.g. { naoh_concentration: 0.1023 } - never sent to the browser. */
  trueValues: Record<string, number>;
  /** Achievable endpoint window derived from the true values. */
  expectedEndpoint: Record<string, number | string>;
  /** Rubric weights, so grading logic is not client-visible either. */
  rubricWeights: Record<string, number>;
}

export const EMPTY_ATTEMPT_SECRETS: AttemptSecrets = {
  seed: "",
  trueValues: {},
  expectedEndpoint: {},
  rubricWeights: {},
};
