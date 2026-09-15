import "server-only";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { getExperimentBriefing, listPublishedExperiments } from "@/infrastructure/supabase/repositories/experiments";
import type { ExperimentBriefing, ExperimentSummary } from "@/domain/experiments";

/** Published experiments visible to the signed-in user (RLS enforces it too). */
export async function listAvailableExperiments(): Promise<ExperimentSummary[]> {
  const supabase = await createServerSupabaseClient();
  return listPublishedExperiments(supabase);
}

export async function getExperimentForBriefing(
  experimentId: string,
): Promise<ExperimentBriefing | null> {
  const supabase = await createServerSupabaseClient();
  return getExperimentBriefing(supabase, experimentId);
}
