import { z } from "zod";

/**
 * Public environment variables only. The service-role key is deliberately NOT
 * part of this module: it is read in exactly one place
 * (infrastructure/supabase/admin.ts, which is marked `server-only`).
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({
    error: "NEXT_PUBLIC_SUPABASE_URL must be the full project URL, e.g. https://xyz.supabase.co",
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, {
    error: "NEXT_PUBLIC_SUPABASE_ANON_KEY looks too short to be a Supabase anon key",
  }),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
});

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string;
};

/**
 * Returns the parsed public environment, or null when Supabase has not been
 * configured yet. Returning null (instead of throwing at import time) keeps
 * `next build` and `next dev` usable before credentials exist; pages that need
 * a database call `requirePublicEnv()` through the data access layer.
 */
export function readPublicEnv(): PublicEnv | null {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });

  if (!parsed.success) return null;

  return {
    supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    siteUrl: parsed.data.NEXT_PUBLIC_SITE_URL,
  };
}

export function isSupabaseConfigured(): boolean {
  return readPublicEnv() !== null;
}

/** Throws an actionable error instead of failing later with a cryptic one. */
export function requirePublicEnv(): PublicEnv {
  const env = readPublicEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and set " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return env;
}

/** The single place the server-only service-role key is allowed to be read. */
export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.length < 20) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It is required for privileged " +
        "server-side operations (seeding, grading) and must never be exposed to the browser.",
    );
  }
  return key;
}
