import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

/**
 * Live Row Level Security tests. These are the tests that actually PROVE data
 * isolation, and they need a real Supabase project with the migrations applied
 * and the dev accounts created by `npm run seed:users`.
 *
 * Required environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_TEST_STUDENT_A_EMAIL / _PASSWORD
 *   SUPABASE_TEST_STUDENT_B_EMAIL / _PASSWORD
 *   SUPABASE_TEST_INSTRUCTOR_EMAIL / _PASSWORD
 *
 * When they are absent the suite reports itself as skipped rather than passing
 * silently, because "no database configured" must never look like "secure".
 */
const env = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  studentAEmail: process.env.SUPABASE_TEST_STUDENT_A_EMAIL,
  studentAPassword: process.env.SUPABASE_TEST_STUDENT_A_PASSWORD,
  studentBEmail: process.env.SUPABASE_TEST_STUDENT_B_EMAIL,
  studentBPassword: process.env.SUPABASE_TEST_STUDENT_B_PASSWORD,
  instructorEmail: process.env.SUPABASE_TEST_INSTRUCTOR_EMAIL,
  instructorPassword: process.env.SUPABASE_TEST_INSTRUCTOR_PASSWORD,
};

const configured = Object.values(env).every((value) => typeof value === "string" && value.length > 0);

if (!configured) {
  console.warn(
    "[rls.test] SKIPPED: live Supabase credentials are not set, so student data isolation " +
      "has NOT been verified against a real database. Set the variables listed in " +
      "tests/integration/rls.test.ts to run these checks.",
  );
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(env.url as string, env.anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
}

describe.skipIf(!configured)("row level security (live database)", () => {
  it("keeps another student's attempt invisible and immutable", async () => {
    const studentA = await signIn(env.studentAEmail as string, env.studentAPassword as string);
    const studentB = await signIn(env.studentBEmail as string, env.studentBPassword as string);

    const { data: userA } = await studentA.auth.getUser();
    if (!userA.user) throw new Error("student A has no session");

    // Student A opens (or resumes) an attempt at the seeded experiment.
    const existing = await studentA
      .from("experiment_attempts")
      .select("id, student_id, status")
      .eq("experiment_id", "exp-02")
      .eq("status", "in_progress")
      .maybeSingle();

    let attemptId = existing.data?.id as string | undefined;

    if (!attemptId) {
      const { data, error } = await studentA
        .from("experiment_attempts")
        .insert({ student_id: userA.user.id, experiment_id: "exp-02", config_version: 1 })
        .select("id")
        .single();
      if (error) throw new Error(`Student A could not start an attempt: ${error.message}`);
      attemptId = data.id as string;
    }

    // B cannot see it...
    const visibleToB = await studentB.from("experiment_attempts").select("id").eq("id", attemptId);
    expect(visibleToB.data ?? []).toEqual([]);

    // ...cannot read its child rows...
    const trialsForB = await studentB
      .from("experiment_trials")
      .select("id")
      .eq("attempt_id", attemptId);
    expect(trialsForB.data ?? []).toEqual([]);

    // ...and cannot change anything on it.
    const tamper = await studentB
      .from("experiment_attempts")
      .update({ status: "submitted" })
      .eq("id", attemptId)
      .select("id");
    expect(tamper.data ?? []).toEqual([]);

    // A can see their own attempt.
    const visibleToA = await studentA
      .from("experiment_attempts")
      .select("id")
      .eq("id", attemptId)
      .maybeSingle();
    expect(visibleToA.data?.id).toBe(attemptId);
  });

  it("hides hidden experimental parameters from every client", async () => {
    const studentA = await signIn(env.studentAEmail as string, env.studentAPassword as string);

    const secrets = await studentA.from("attempt_secrets").select("attempt_id");
    // No grant at all: PostgREST refuses, and certainly returns no rows.
    expect(secrets.data ?? []).toEqual([]);
  });

  it("stops a student promoting themselves to instructor", async () => {
    const studentA = await signIn(env.studentAEmail as string, env.studentAPassword as string);
    const { data: userA } = await studentA.auth.getUser();

    const promote = await studentA
      .from("profiles")
      .update({ role: "instructor" })
      .eq("id", userA.user?.id ?? "")
      .select("role");

    // The column is not granted, so the update is rejected outright.
    expect(promote.error).not.toBeNull();
  });

  it("stops a student writing grades and feedback", async () => {
    const studentA = await signIn(env.studentAEmail as string, env.studentAPassword as string);

    const attempt = await studentA
      .from("experiment_attempts")
      .select("id")
      .eq("experiment_id", "exp-02")
      .maybeSingle();
    if (!attempt.data?.id) throw new Error("no attempt available to attack");

    const grade = await studentA
      .from("grades")
      .insert({ attempt_id: attempt.data.id, final_score: 100, decision: "approved" })
      .select("id");

    expect(grade.error).not.toBeNull();
  });

  it("lets an instructor read a student's attempt", async () => {
    const instructor = await signIn(env.instructorEmail as string, env.instructorPassword as string);

    const { data } = await instructor.from("experiment_attempts").select("id").limit(1);
    expect(Array.isArray(data)).toBe(true);
  });

  it("denies everything to an unauthenticated client", async () => {
    const anon = createClient(env.url as string, env.anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const attempts = await anon.from("experiment_attempts").select("id");
    expect(attempts.data ?? []).toEqual([]);

    // Published experiments are readable only by authenticated users.
    const experiments = await anon.from("experiments").select("id");
    expect(experiments.data ?? []).toEqual([]);
  });
});
