import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

/**
 * Live persistence tests for the Phase 3 write pattern. Repository modules
 * cannot be imported here (they are `server-only`), so this suite exercises
 * the same statements through a signed-in student client: it PROVES the
 * migrated grants and policies actually permit the autosave unit
 * (revision-guarded snapshot write, trial upsert, measurement append,
 * calculation self-write without the answer key) and still refuse secrets and
 * forged columns.
 *
 * Requires the same environment as tests/integration/rls.test.ts. Skips
 * loudly when credentials are absent.
 */
const env = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  studentAEmail: process.env.SUPABASE_TEST_STUDENT_A_EMAIL,
  studentAPassword: process.env.SUPABASE_TEST_STUDENT_A_PASSWORD,
};

const configured = Object.values(env).every((value) => typeof value === "string" && value.length > 0);

if (!configured) {
  console.warn(
    "[persistence.test] SKIPPED: live Supabase credentials are not set, so the autosave " +
      "write pattern has NOT been verified against a real database. Set the variables " +
      "listed in tests/integration/persistence.test.ts to run these checks.",
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

async function ownAttemptId(student: SupabaseClient): Promise<string> {
  const { data: user } = await student.auth.getUser();
  if (!user.user) throw new Error("test student has no session");

  const existing = await student
    .from("experiment_attempts")
    .select("id")
    .eq("experiment_id", "exp-02")
    .eq("status", "in_progress")
    .maybeSingle();
  if (existing.data) return (existing.data as { id: string }).id;

  const { data, error } = await student
    .from("experiment_attempts")
    .insert({ student_id: user.user.id, experiment_id: "exp-02", config_version: 1 })
    .select("id")
    .single();
  if (error) throw new Error(`Could not start attempt: ${error.message}`);
  const attemptId = (data as { id: string }).id;
  await student.from("attempt_state").insert({ attempt_id: attemptId, snapshot: {} });
  return attemptId;
}

describe.skipIf(!configured)("persistence write pattern (live database)", () => {
  it("revision-guards the snapshot: matching write wins, stale write touches nothing", async () => {
    const student = await signIn(env.studentAEmail as string, env.studentAPassword as string);
    const attemptId = await ownAttemptId(student);

    const before = await student
      .from("attempt_state")
      .select("revision")
      .eq("attempt_id", attemptId)
      .maybeSingle();
    const baseRevision = ((before.data as { revision: number } | null)?.revision ?? 0) as number;

    const fresh = await student
      .from("attempt_state")
      .update({ revision: baseRevision + 1, snapshot: { schemaVersion: 1, probe: true } })
      .eq("attempt_id", attemptId)
      .eq("revision", baseRevision)
      .select("revision");
    expect((fresh.data ?? []).length).toBe(1);

    const stale = await student
      .from("attempt_state")
      .update({ revision: baseRevision + 1, snapshot: { schemaVersion: 1, probe: false } })
      .eq("attempt_id", attemptId)
      .eq("revision", baseRevision)
      .select("revision");
    expect(stale.data ?? []).toEqual([]);

    // Restore the exact revision so repeated runs stay consistent.
    const current = await student
      .from("attempt_state")
      .select("revision")
      .eq("attempt_id", attemptId)
      .maybeSingle();
    expect(((current.data as { revision: number } | null)?.revision ?? 0) as number).toBe(
      baseRevision + 1,
    );
  });

  it("upserts trial rows and appends measurements without privileged columns", async () => {
    const student = await signIn(env.studentAEmail as string, env.studentAPassword as string);
    const attemptId = await ownAttemptId(student);

    const trial = await student.from("experiment_trials").upsert(
      {
        attempt_id: attemptId,
        trial_number: 1,
        status: "recorded",
        initial_reading: 0,
        final_reading: 14.5,
        titre_volume: 14.5,
        endpoint_observed: true,
      },
      { onConflict: "attempt_id,trial_number" },
    );
    expect(trial.error).toBeNull();

    const measurement = await student.from("measurements").insert({
      attempt_id: attemptId,
      kind: "titration_reading",
      label: "persistence probe titre",
      value: 14.5,
      unit: "mL",
    });
    expect(measurement.error).toBeNull();

    // server_validated is outside the student grant: forging audit flags fails.
    const forged = await student.from("measurements").insert({
      attempt_id: attemptId,
      kind: "titration_reading",
      label: "persistence probe forged",
      value: 14.5,
      unit: "mL",
      server_validated: true,
    });
    expect(forged.error).not.toBeNull();
  });

  it("lets students store their own values but never the answer key", async () => {
    const student = await signIn(env.studentAEmail as string, env.studentAPassword as string);
    const attemptId = await ownAttemptId(student);

    const own = await student.from("calculation_submissions").upsert(
      {
        attempt_id: attemptId,
        question_key: "persistence probe molarity",
        student_value: 0.2,
        student_unit: "mol/L",
        attempt_number: 1,
      },
      { onConflict: "attempt_id,question_key" },
    );
    expect(own.error).toBeNull();

    const key = await student.from("calculation_submissions").upsert(
      {
        attempt_id: attemptId,
        question_key: "persistence probe molarity",
        student_value: 0.2,
        student_unit: "mol/L",
        attempt_number: 1,
        expected_value: 0.2,
        is_correct: true,
      },
      { onConflict: "attempt_id,question_key" },
    );
    expect(key.error).not.toBeNull();
  });

  it("keeps attempt_secrets unreachable with a student token", async () => {
    const student = await signIn(env.studentAEmail as string, env.studentAPassword as string);
    const attemptId = await ownAttemptId(student);

    const read = await student.from("attempt_secrets").select("seed").eq("attempt_id", attemptId);
    expect(read.data ?? []).toEqual([]);

    const write = await student.from("attempt_secrets").upsert({
      attempt_id: attemptId,
      seed: "attacker",
      true_values: {},
      expected_endpoint: {},
      rubric_weights: {},
    });
    expect(write.error).not.toBeNull();
  });
});
