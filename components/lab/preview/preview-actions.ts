"use server";

import { z } from "zod";
import type { LabActionOutcome } from "@/application/attempts/lab-transport";
import type { LabStateView } from "@/application/attempts/lab-state";
import {
  parseTitrationEnvelope,
  titrationActionSchema,
} from "@/domain/simulation/titration/protocol";
import { PREVIEW_DISABLED_MESSAGE, previewIsEnabled } from "./preview-gate";
import { PREVIEW_BASE_REVISION, buildPreviewState, scenarioStateFor } from "./scenarios";

/**
 * DEVELOPMENT-ONLY. The two server actions the preview harness needs.
 *
 * WHY THE HARNESS IS STATELESS: the client holds only its own ACCEPTED actions —
 * the same values a student types anyway — and sends them back with each request.
 * The server rebuilds the scenario from its fixed seed, replays those actions
 * through the same protocol router the real laboratory uses, applies the new one,
 * and returns the public projection.
 *
 * That is what makes it safe by construction: no session on the client, no second
 * simulation engine, no persistence, nothing to clean up. The hidden reality
 * (seed, true concentration, observable endpoint) is created inside the request
 * and discarded with it — exactly as it never leaves the server in the real
 * laboratory.
 *
 * Both entry points ask `previewIsEnabled()` rather than testing `NODE_ENV`
 * themselves, so the switch cannot be forgotten in one of them.
 */

const requestSchema = z.object({
  scenarioId: z.string().min(1).max(64),
  /** Previously accepted actions, oldest first. Re-validated, never trusted. */
  history: z.array(titrationActionSchema).max(500),
  envelope: z.unknown(),
});

function rejected(code: string, message: string): LabActionOutcome {
  return { status: "rejected", code, message };
}

/** Load one scenario from its seed. Used by the switcher and the reset control. */
export async function loadPreviewScenario(scenarioId: string): Promise<LabStateView | null> {
  if (!previewIsEnabled()) return null;
  const parsed = z.string().min(1).max(64).safeParse(scenarioId);
  if (!parsed.success) return null;
  return scenarioStateFor(parsed.data);
}

export async function replayPreviewLabAction(input: unknown): Promise<LabActionOutcome> {
  if (!previewIsEnabled()) {
    return rejected("preview_disabled", PREVIEW_DISABLED_MESSAGE);
  }

  const request = requestSchema.safeParse(input);
  if (!request.success) {
    return rejected(
      "protocol_mismatch",
      `The preview received a malformed request: ${request.error.issues[0]?.message ?? "unknown"}`,
    );
  }

  // The envelope is validated by the SAME parser the real action uses, so a
  // preview action cannot be shaped differently from a persisted one.
  let envelope;
  try {
    envelope = parseTitrationEnvelope(request.data.envelope);
  } catch (error) {
    return rejected(
      "protocol_mismatch",
      error instanceof Error ? error.message : "invalid simulation action",
    );
  }

  const { scenarioId, history } = request.data;
  const expectedRevision = PREVIEW_BASE_REVISION + history.length;

  if (envelope.baseRevision !== expectedRevision) {
    // The client's revision disagrees with the replay. Hand back the state it
    // should have been working from so the controller reconciles, rather than
    // applying an action to the wrong base.
    return {
      status: "conflict",
      message:
        "The preview was replayed from an unexpected revision, so the scenario has been rebuilt. " +
        "Check the bench and repeat the action if it is still needed.",
      revision: expectedRevision,
      publicState: scenarioStateFor(scenarioId).publicState,
    };
  }

  const result = buildPreviewState(scenarioId, history, envelope.action);
  return {
    status: "ok",
    accepted: result.accepted,
    code: result.code,
    message: result.message,
    colour: result.colour,
    calculationCorrect: result.calculationCorrect,
    revision: result.revision,
    publicState: result.state.publicState,
  };
}
