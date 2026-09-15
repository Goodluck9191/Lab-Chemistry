import { createBrowserClient } from "@supabase/ssr";
import { requirePublicEnv } from "@/lib/env";

/**
 * Browser-side Supabase client. Uses only the public URL and anon key, so it can
 * never bypass Row Level Security. Stage 1 forms use server actions instead (see
 * application/auth/actions.ts); this client exists for interactive features in
 * later stages (streaming readings, realtime attempt state).
 */
export function createBrowserSupabaseClient() {
  const env = requirePublicEnv();
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
