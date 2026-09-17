import type { TitrationPublicState } from "@/domain/simulation/titration/engine";
import { RevisionConflictError, type TitrationActionResult } from "./apply-simulation-action";

/**
 * Client-facing transport for the laboratory.
 *
 * WHY THIS EXISTS: a thrown server action error is deliberately masked by the
 * framework in production (the client only sees a digest), so a component cannot
 * reliably tell "your revision is stale" from "the database is down". Phase 3's
 * `applyTitrationActionAction` therefore keeps its throwing contract, and this
 * module wraps it into a discriminated result the action controller can act on
 * without guessing:
 *
 *   ok        — accepted or rejected by the engine, with the new public state
 *   conflict  — the revision moved; the fresh public state is included so the
 *               client can reconcile instead of retrying blindly
 *   rejected  — nothing was written; show the message and let the student retry
 *
 * The dependencies are injected so the mapping can be tested without a database.
 */

export interface LabActionOk {
  status: "ok";
  accepted: boolean;
  code: string | null;
  message: string | null;
  colour: string | null;
  calculationCorrect: boolean | null;
  revision: number;
  publicState: TitrationPublicState;
}

export interface LabActionConflict {
  status: "conflict";
  message: string;
  revision: number;
  publicState: TitrationPublicState;
}

export interface LabActionRejected {
  status: "rejected";
  code: string;
  message: string;
}

export type LabActionOutcome = LabActionOk | LabActionConflict | LabActionRejected;

export interface LabStateSnapshot {
  revision: number;
  publicState: TitrationPublicState;
}

export interface LabActionDependencies {
  /** Phase 3's full autosave unit. Must throw RevisionConflictError on a stale base. */
  apply: (input: unknown) => Promise<TitrationActionResult>;
  /** Read path used to reconcile after a conflict. */
  reload: (attemptId: string) => Promise<LabStateSnapshot>;
}

export interface LabRequestContext {
  attemptId: string;
}

const CONFLICT_MESSAGE =
  "This attempt changed in another session. The laboratory has been refreshed with the " +
  "latest saved state — check your readings and repeat the last action.";

const PROTOCOL_MESSAGE =
  "This page is out of date with the simulation protocol. Reload the laboratory to continue.";

const FAILURE_MESSAGE =
  "The action could not be saved. Check your connection and try again.";

/** True for the framework's control-flow errors, which must never be swallowed. */
export function isControlFlowError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}

/**
 * Run one laboratory action and normalise every outcome the UI has to handle.
 * Nothing is silently swallowed: a conflict carries the authoritative state, and
 * any other failure carries the reference of the attempt that failed.
 */
export async function runLabAction(
  deps: LabActionDependencies,
  context: LabRequestContext,
  input: unknown,
): Promise<LabActionOutcome> {
  try {
    const result = await deps.apply(input);
    return {
      status: "ok",
      accepted: result.accepted,
      code: result.code,
      message: result.message,
      colour: result.colour,
      calculationCorrect: result.calculationCorrect,
      revision: result.revision,
      publicState: result.public,
    };
  } catch (error) {
    if (isControlFlowError(error)) throw error;

    if (error instanceof RevisionConflictError) {
      try {
        const fresh = await deps.reload(error.attemptId || context.attemptId);
        return {
          status: "conflict",
          message: CONFLICT_MESSAGE,
          revision: fresh.revision,
          publicState: fresh.publicState,
        };
      } catch (reloadError) {
        if (isControlFlowError(reloadError)) throw reloadError;
        return {
          status: "rejected",
          code: "conflict_reload_failed",
          message:
            "This attempt changed in another session, and the refreshed state could not be loaded. " +
            "Reload the laboratory to continue.",
        };
      }
    }

    if (error instanceof Error && error.message.includes("invalid simulation action")) {
      return { status: "rejected", code: "protocol_mismatch", message: PROTOCOL_MESSAGE };
    }

    return { status: "rejected", code: "action_failed", message: FAILURE_MESSAGE };
  }
}
