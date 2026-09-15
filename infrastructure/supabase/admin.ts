import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requirePublicEnv, requireServiceRoleKey } from "@/lib/env";

/**
 * Service-role client. It BYPASSES Row Level Security and can read hidden
 * experimental parameters, so:
 *
 *  - `server-only` makes any accidental client import a build error;
 *  - it must never be used for a request whose result is returned to a student
 *    without filtering;
 *  - legitimate uses are limited to privileged operations such as seeding dev
 *    accounts, grading, and generating hidden per-attempt parameters.
 */
export function createAdminSupabaseClient() {
  const env = requirePublicEnv();
  return createClient(env.supabaseUrl, requireServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
