import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getProfileById } from "@/infrastructure/supabase/repositories/profiles";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import type { UserProfile } from "@/domain/profiles";
import { canAccessInstructorArea, canAccessStudentArea } from "./access";

/**
 * The Data Access Layer. Every server component, server action and route handler
 * that touches user data goes through here.
 *
 * Why a single module instead of scattering checks about:
 *  - Next's own guidance is that layouts are NOT a security boundary (they can
 *    be bypassed by navigating between children), and that a proxy should not be
 *    used for authorisation. So authorisation is re-checked on every entry point
 *    by calling these functions.
 *  - `getUser()` validates the token with Supabase Auth. `getSession()` only
 *    decodes the cookie, so it must never be used for authorisation.
 *  - `cache()` means the checks cost one request-deduplicated round trip even
 *    when several components ask for the current user.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // An invalid or expired session is simply "not signed in".
  if (error) return null;
  return user;
});

export const getCurrentProfile = cache(async (): Promise<UserProfile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createServerSupabaseClient();
  return getProfileById(supabase, user.id);
});

function loginPath(nextPath?: string): string {
  return nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login";
}

/** Requires any signed-in user; otherwise sends them to the login page. */
export async function requireUser(nextPath?: string) {
  const user = await getCurrentUser();
  if (!user) redirect(loginPath(nextPath));
  return user;
}

export interface StudentContext {
  user: User;
  profile: UserProfile;
}

/**
 * Requires a signed-in STUDENT. A signed-in instructor who opens a student page
 * is sent to /unauthorized rather than being silently granted access.
 */
export async function requireStudent(nextPath?: string): Promise<StudentContext> {
  const user = await requireUser(nextPath);
  const profile = await getCurrentProfile();

  if (!profile || !canAccessStudentArea(profile.role)) redirect("/unauthorized");

  return { user, profile };
}

/**
 * Requires a signed-in INSTRUCTOR. The role always comes from the `profiles`
 * table read through RLS, never from a cookie, header or request body.
 */
export async function requireInstructor(nextPath?: string): Promise<StudentContext> {
  const user = await requireUser(nextPath);
  const profile = await getCurrentProfile();

  if (!profile || !canAccessInstructorArea(profile.role)) redirect("/unauthorized");

  return { user, profile };
}
