import "server-only";
import { z } from "zod";
import { declaredQuestionsFor } from "@/domain/experiments/catalog/catalog-registry";
import { saveReportAnswers as saveAnswersRows } from "@/infrastructure/supabase/repositories/attempts";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { loadTitrationAttempt } from "./apply-simulation-action";
import { attemptIdSchema } from "./schemas";

/**
 * Report-question answers: student-written text saved as a draft.
 *
 * Each value is capped like an observation (2000 chars); unknown keys are
 * dropped so a client cannot smuggle arbitrary fields into the report row.
 * Writable only while the attempt is writable — RLS freezes answers on
 * submission exactly like the other report sections.
 */

const answersInputSchema = z.record(z.string(), z.unknown());

export type SaveReportAnswersResult = { status: "ok" } | { status: "error"; message: string };

export async function saveReportAnswers(
  rawAttemptId: string,
  rawAnswers: unknown,
): Promise<SaveReportAnswersResult> {
  const attemptId = attemptIdSchema.parse(rawAttemptId);
  const parsed = answersInputSchema.safeParse(rawAnswers);
  if (!parsed.success) {
    return { status: "error", message: "The answers could not be read. Reload and try again." };
  }

  const loaded = await loadTitrationAttempt(attemptId);
  if (!loaded.canWrite) {
    return { status: "error", message: "This attempt has already been submitted." };
  }

  const declared = new Set([
    ...declaredQuestionsFor(loaded.experimentId).map((question) => question.key),
    // Free-text sources of error: stored with the answers, never scored.
    "_error_sources",
  ]);
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!declared.has(key) || typeof value !== "string") continue;
    if (value.length > 2000) {
      return { status: "error", message: "An answer is too long. Keep each answer under 2000 characters." };
    }
    answers[key] = value;
  }

  const supabase = await createServerSupabaseClient();
  await saveAnswersRows(supabase, attemptId, answers);
  return { status: "ok" };
}
