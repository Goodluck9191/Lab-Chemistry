import "server-only";
import { z } from "zod";
import { declaredObservationFieldsFor } from "@/domain/experiments/catalog/catalog-registry";
import { toPublicJSON, type TitrationPublicState } from "@/domain/simulation/titration/engine";
import {
  projectExperimentWorkflow,
  type WorkflowConfigInput,
} from "@/domain/simulation/titration/workflow";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import {
  getReportForAttempt,
  markAttemptSubmitted,
  submitReportForAttempt,
  upsertReportDraft,
  type ReportSections,
} from "@/infrastructure/supabase/repositories/attempts";
import { loadTitrationAttempt } from "./apply-simulation-action";
import { attemptIdSchema } from "./schemas";

export type { ReportSections };

/** Column limits from `supabase/migrations/20260915090005_outcomes.sql`. */
const reportSectionsSchema = z.object({
  aim: z.string().max(20000),
  procedure: z.string().max(40000),
  resultsSummary: z.string().max(20000),
  conclusion: z.string().max(20000),
  safetyNotes: z.string().max(10000),
});

export const EMPTY_REPORT_SECTIONS: ReportSections = {
  aim: "",
  procedure: "",
  resultsSummary: "",
  conclusion: "",
  safetyNotes: "",
};

/**
 * The submit gate, factored pure for testing: every unmet requirement in
 * student-facing words. Empty means the attempt may be submitted. The workflow
 * is derived from the PUBLIC projection, so the gate can neither leak hidden
 * values nor disagree with what the student sees.
 */
export function submitBlockersFor(
  experimentId: string,
  config: WorkflowConfigInput,
  publicState: TitrationPublicState,
): string[] {
  const required = declaredObservationFieldsFor(experimentId)
    .filter((field) => field.isRequired)
    .map((field) => ({ fieldKey: field.fieldKey, prompt: field.prompt }));
  return [...projectExperimentWorkflow(config, publicState, required).blockers];
}

export type SaveReportDraftResult = { status: "ok" } | { status: "error"; message: string };

/** Persist the student's write-up as a draft. Only on a writable attempt. */
export async function saveReportDraft(
  rawAttemptId: string,
  rawSections: unknown,
): Promise<SaveReportDraftResult> {
  const attemptId = attemptIdSchema.parse(rawAttemptId);
  const parsedSections = reportSectionsSchema.safeParse(rawSections);
  if (!parsedSections.success) {
    return {
      status: "error",
      message: "A report section is too long. Shorten it and save again.",
    };
  }

  const loaded = await loadTitrationAttempt(attemptId);
  if (!loaded.canWrite) {
    return { status: "error", message: "This attempt has already been submitted." };
  }

  const supabase = await createServerSupabaseClient();
  await upsertReportDraft(supabase, attemptId, parsedSections.data);
  return { status: "ok" };
}

export type SubmitAttemptResult =
  | { status: "ok"; alreadySubmitted: boolean }
  | { status: "blocked"; blockers: string[] }
  | { status: "error"; message: string };

/**
 * Submit an attempt: verify the workflow gate server-side, freeze the report
 * (sections + a frozen copy of the public readings), then mark the attempt
 * submitted so the laboratory turns read-only.
 *
 * ORDER MATTERS: the report is written first, because once the attempt is
 * submitted the RLS write policies no longer match the student. If the attempt
 * update fails afterwards, the student simply retries: both writes are
 * idempotent and the attempt stays writable until the transition lands.
 */
export async function submitAttempt(rawAttemptId: string): Promise<SubmitAttemptResult> {
  const attemptId = attemptIdSchema.parse(rawAttemptId);
  const loaded = await loadTitrationAttempt(attemptId);

  if (loaded.status === "submitted" || loaded.status === "graded") {
    return { status: "ok", alreadySubmitted: true };
  }
  if (!loaded.canWrite) {
    return { status: "error", message: "This attempt can no longer be submitted." };
  }

  const publicState = toPublicJSON(loaded.session);
  const blockers = submitBlockersFor(loaded.experimentId, loaded.config, publicState);
  if (blockers.length > 0) {
    return { status: "blocked", blockers };
  }

  const supabase = await createServerSupabaseClient();
  const existing = await getReportForAttempt(supabase, attemptId);
  const sections: ReportSections = {
    aim: existing?.aim ?? "",
    procedure: existing?.procedure ?? "",
    resultsSummary: existing?.resultsSummary ?? "",
    conclusion: existing?.conclusion ?? "",
    safetyNotes: existing?.safetyNotes ?? "",
  };
  // A plain-JSON frozen copy of the PUBLIC projection: safe by construction,
  // and what was marked can never change under a later edit.
  const readingsSnapshot = JSON.parse(JSON.stringify(publicState)) as Record<string, unknown>;
  await submitReportForAttempt(supabase, attemptId, sections, readingsSnapshot);
  await markAttemptSubmitted(supabase, attemptId);
  return { status: "ok", alreadySubmitted: false };
}
