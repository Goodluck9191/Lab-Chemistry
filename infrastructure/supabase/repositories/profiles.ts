import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { USER_ROLES, type UserProfile } from "@/domain/profiles";

const profileRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  full_name: z.string(),
  registration_number: z.string().nullable(),
  role: z.enum(USER_ROLES),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * A user's own profile. RLS also lets instructors read profiles, so callers that
 * must not do that pass the id they are interested in rather than listing.
 */
export async function getProfileById(
  client: SupabaseClient,
  userId: string,
): Promise<UserProfile | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id, email, full_name, registration_number, role, created_at, updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load profile ${userId}: ${error.message}`);
  if (!data) return null;

  const row = profileRowSchema.parse(data);

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    registrationNumber: row.registration_number,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
