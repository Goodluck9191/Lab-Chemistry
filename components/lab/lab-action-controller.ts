"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  getLabStateAction,
  submitLabActionAction,
  type LabStateOutcome,
} from "@/application/attempts/actions";
import type { LabActionOutcome } from "@/application/attempts/lab-transport";
import { SIMULATION_PROTOCOL_VERSION } from "@/domain/simulation/titration/protocol";
import type { TitrationPublicState } from "@/domain/simulation/titration/engine";
import {
  CONFLICT_FEEDBACK,
  feedbackForOutcome,
  feedbackForStart,
  type ActionFeedback,
  type LabActionInput,
} from "./action-feedback";

/**
 * THE action controller.
 *
 * Every meaningful laboratory interaction goes through `perform()`, which:
 *
 *   1. builds the versioned envelope (attempt id + the revision the client saw
 *      + one engine action) — no component ever constructs one;
 *   2. sends it through the server action, which runs the Phase 3 autosave unit;
 *   3. replaces the client's server-state with the returned public projection.
 *
 * It also owns the things the UI must not guess at: whether a save is in flight,
 * whether the last save succeeded, and what to do about a stale revision. Only
 * ONE action may be in flight at a time, so two fast clicks can never race on the
 * same base revision.
 */

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

export interface LabNotice {
  tone: "info" | "success" | "warning" | "danger";
  title: string;
  message: string;
}

export interface LabControllerState {
  revision: number;
  publicState: TitrationPublicState;
  saveStatus: SaveStatus;
  /** Display-only client clock; persistence is proven by `saveStatus`. */
  lastSavedAt: string | null;
  pendingActionType: string | null;
  notice: LabNotice | null;
  /**
   * What the laboratory last did, in chemistry terms. Null means silence: the
   * stream never claims an action that was refused or never reached storage.
   */
  lastFeedback: ActionFeedback | null;
  lastOutcome: {
    accepted: boolean;
    code: string | null;
    message: string | null;
    calculationCorrect: boolean | null;
  } | null;
}

type ReducerAction =
  | { type: "action_started"; action: LabActionInput }
  | {
      type: "action_succeeded";
      revision: number;
      publicState: TitrationPublicState;
      outcome: LabActionOutcome & { status: "ok" };
      /** The action the student sent, so the feedback can word it. */
      action: LabActionInput;
      at: string;
    }
  | {
      type: "action_conflicted";
      revision: number;
      publicState: TitrationPublicState;
      message: string;
      at: string;
    }
  | { type: "action_rejected"; message: string; tone: LabNotice["tone"]; title: string }
  | { type: "refresh_succeeded"; revision: number; publicState: TitrationPublicState }
  | { type: "notice_cleared" };

export const initialLabControllerState = (
  revision: number,
  publicState: TitrationPublicState,
): LabControllerState => ({
  revision,
  publicState,
  saveStatus: "idle",
  lastSavedAt: null,
  pendingActionType: null,
  notice: null,
  lastFeedback: null,
  lastOutcome: null,
});

function reducer(state: LabControllerState, action: ReducerAction): LabControllerState {
  switch (action.type) {
    case "action_started":
      return {
        ...state,
        saveStatus: "saving",
        pendingActionType: action.action.type,
        // Immediately replaced by the outcome: the student is told what is
        // happening rather than watching a disabled button.
        lastFeedback: { tone: "info", message: feedbackForStart(action.action) },
      };
    case "action_succeeded": {
      const { outcome } = action;
      let notice: LabNotice | null = null;
      if (!outcome.accepted) {
        // The engine refused the action. Its message is written for students and
        // never contains a hidden value; the authoritative state is unchanged.
        notice = {
          tone: "warning",
          title: "The laboratory did not accept that",
          message: outcome.message ?? "That action is not valid right now.",
        };
      } else if (outcome.calculationCorrect === true) {
        notice = {
          tone: "success",
          title: "Calculation accepted",
          message: "That value agrees with the simulation within the accepted tolerance.",
        };
      } else if (outcome.calculationCorrect === false) {
        notice = {
          tone: "warning",
          title: "Calculation not accepted",
          message:
            "That value is outside the accepted tolerance. Check your arithmetic and the readings you used.",
        };
      }
      return {
        ...state,
        revision: action.revision,
        publicState: action.publicState,
        saveStatus: "saved",
        lastSavedAt: action.at,
        pendingActionType: null,
        notice,
        // Wording is derived from the action the student sent and the state the
        // server returned. A refused action words nothing: the engine's own
        // message is shown by the notices instead of being said twice.
        lastFeedback: feedbackForOutcome({
          action: action.action,
          accepted: outcome.accepted,
          colour: outcome.colour,
          calculationCorrect: outcome.calculationCorrect,
          publicState: action.publicState,
        }),
        lastOutcome: {
          accepted: outcome.accepted,
          code: outcome.code,
          message: outcome.message,
          calculationCorrect: outcome.calculationCorrect,
        },
      };
    }
    case "action_conflicted":
      return {
        ...state,
        revision: action.revision,
        publicState: action.publicState,
        saveStatus: "saved",
        lastSavedAt: action.at,
        pendingActionType: null,
        notice: {
          tone: "info",
          title: "Saved state refreshed",
          message: action.message,
        },
        lastFeedback: CONFLICT_FEEDBACK,
        lastOutcome: null,
      };
    case "action_rejected":
      return {
        ...state,
        saveStatus: "failed",
        pendingActionType: null,
        // Nothing was stored, so the stream goes quiet rather than leaving a
        // stale description of work the laboratory never did.
        lastFeedback: null,
        notice: { tone: action.tone, title: action.title, message: action.message },
      };
    case "refresh_succeeded":
      return {
        ...state,
        revision: action.revision,
        publicState: action.publicState,
        pendingActionType: null,
        lastFeedback: null,
      };
    case "notice_cleared":
      return { ...state, notice: null };
  }
}

export type LabActionSender = (input: unknown) => Promise<LabActionOutcome>;
export type LabStateLoader = (attemptId: string) => Promise<LabStateOutcome>;

/**
 * Build the versioned envelope. Exported so a test can assert the exact shape
 * that reaches the server, and so no component has to know it.
 */
export function buildActionEnvelope(
  attemptId: string,
  baseRevision: number,
  action: Record<string, unknown>,
) {
  return {
    protocolVersion: SIMULATION_PROTOCOL_VERSION,
    attemptId,
    baseRevision,
    action,
  };
}

export function useLabActionController({
  attemptId,
  revision,
  publicState,
  send = submitLabActionAction,
  loadState = getLabStateAction,
}: {
  attemptId: string;
  revision: number;
  publicState: TitrationPublicState;
  send?: LabActionSender;
  loadState?: LabStateLoader;
}) {
  const [state, dispatch] = useReducer(
    reducer,
    { revision, publicState },
    (seed) => initialLabControllerState(seed.revision, seed.publicState),
  );

  // A ref keeps the freshest revision available to the submission path without
  // making the callback depend on it (which would re-render every consumer). It
  // is synced in an effect, never during render.
  const revisionRef = useRef(revision);
  useEffect(() => {
    revisionRef.current = state.revision;
  }, [state.revision]);
  // Only one action may be in flight, so two fast clicks cannot race on the same
  // base revision even if the ref were momentarily behind.
  const inFlight = useRef(false);

  const perform = useCallback(
    async (action: Record<string, unknown> & { type: string }): Promise<LabActionOutcome | null> => {
      if (inFlight.current) {
        // The UI disables controls while pending; this is the belt-and-braces
        // guard against a double submit from a keyboard or a slow frame.
        return null;
      }
      inFlight.current = true;
      dispatch({ type: "action_started", action });
      try {
        const outcome = await send(buildActionEnvelope(attemptId, revisionRef.current, action));
        const at = new Date().toISOString();
        if (outcome.status === "ok") {
          dispatch({
            type: "action_succeeded",
            revision: outcome.revision,
            publicState: outcome.publicState,
            outcome,
            action,
            at,
          });
        } else if (outcome.status === "conflict") {
          dispatch({
            type: "action_conflicted",
            revision: outcome.revision,
            publicState: outcome.publicState,
            message: outcome.message,
            at,
          });
        } else {
          dispatch({
            type: "action_rejected",
            message: outcome.message,
            tone: outcome.code === "protocol_mismatch" ? "danger" : "warning",
            title:
              outcome.code === "protocol_mismatch"
                ? "Reload required"
                : "The action was not saved",
          });
        }
        return outcome;
      } catch (error) {
        // Only unexpected transport problems reach here (redirects and framework
        // control flow are re-thrown by the transport itself).
        dispatch({
          type: "action_rejected",
          message:
            error instanceof Error && error.message
              ? `${error.message} — nothing was saved. Try again.`
              : "The action could not be sent. Nothing was saved. Try again.",
          tone: "danger",
          title: "Save failed",
        });
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [attemptId, send],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    dispatch({ type: "action_started", action: { type: "refresh" } });
    try {
      const outcome = await loadState(attemptId);
      if (outcome.status === "ok") {
        dispatch({
          type: "refresh_succeeded",
          revision: outcome.state.revision,
          publicState: outcome.state.publicState,
        });
        return true;
      }
      dispatch({
        type: "action_rejected",
        message: outcome.message,
        tone: "danger",
        title: "Reload failed",
      });
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [attemptId, loadState]);

  const clearNotice = useCallback(() => dispatch({ type: "notice_cleared" }), []);

  return {
    state,
    /** True while any action or refresh is in flight. */
    pending: state.pendingActionType !== null,
    perform,
    refresh,
    clearNotice,
  };
}
