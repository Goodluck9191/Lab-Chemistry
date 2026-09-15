import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requirePublicEnv } from "@/lib/env";

/**
 * Request-scoped server client. It authenticates as the signed-in user, so every
 * query it makes is still filtered by Row Level Security - the database remains
 * the authority on what a student may read or write.
 *
 * A new client must be created for each request; never cache or share one.
 */
export async function createServerSupabaseClient() {
  const env = requirePublicEnv();
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. That is expected here: the
          // proxy refreshes the session and writes updated cookies on the
          // response, so token rotation still works.
        }
      },
    },
  });
}
