"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { getProfileById } from "@/infrastructure/supabase/repositories/profiles";
import { readPublicEnv } from "@/lib/env";
import { dashboardPathForRole } from "./access";
import type { AuthFormState } from "./types";

const credentialsSchema = z.object({
  email: z.email({ error: "Enter a valid email address" }).max(320),
  password: z.string().min(8, { error: "Password must be at least 8 characters" }).max(200),
});

const registrationSchema = credentialsSchema.extend({
  fullName: z.string().trim().min(2, { error: "Enter your full name" }).max(120),
  registrationNumber: z.string().trim().max(40).optional(),
});

/**
 * Only relative, single-slash paths are accepted as a `next` destination. Without
 * this check a crafted link could bounce a signed-in user to another site after
 * login (an open redirect).
 */
function safeNextPath(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: field(formData, "email"),
    password: field(formData, "password"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Deliberately generic: never reveal whether an address is registered.
    return { status: "error", message: "Those credentials did not match an account." };
  }

  const profile = await getProfileById(supabase, data.user.id);
  const next = safeNextPath(formData.get("next"));

  revalidatePath("/", "layout");
  redirect(next ?? dashboardPathForRole(profile?.role));
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registrationSchema.safeParse({
    email: field(formData, "email"),
    password: field(formData, "password"),
    fullName: field(formData, "fullName"),
    registrationNumber: field(formData, "registrationNumber") ?? undefined,
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const env = readPublicEnv();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // The database trigger reads these to build the profile row. It ignores
      // any role supplied here and always creates a STUDENT.
      data: {
        full_name: parsed.data.fullName,
        registration_number: parsed.data.registrationNumber ?? null,
      },
      emailRedirectTo: env ? env.siteUrl : undefined,
    },
  });

  if (error) {
    return { status: "error", message: error.message };
  }

  if (!data.session) {
    return {
      status: "success",
      message:
        "Account created. Check your email and follow the confirmation link, then sign in.",
    };
  }

  revalidatePath("/", "layout");
  redirect(dashboardPathForRole("student"));
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/login");
}
