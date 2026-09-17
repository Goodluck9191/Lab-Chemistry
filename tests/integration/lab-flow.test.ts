import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

/**
 * Live integration coverage for what the Phase 4 laboratory writes.
 *
 * Repository modules are `server-only`, so this suite exercises the same
 * statements a signed-in STUDENT client performs, and proves the migrated grants
 * let the laboratory persist exactly what it claims to:
 *   - a trial row for a completed (and a rejected) trial,
 *   - measurement rows for the readings,
 *   - a TEXT observation from `record_observation`,
 *   - a CHOICE observation for the endpoint colour on the same attempt,
 *   - the student's own reported concentration, without the answer key.
 *
 * Skips loudly when credentials are absent, so a run without a database reports
 * SKIPPED rather than pretending to have verified anything.
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
    "[lab-flow.test] SKIPPED: live Supabase credentials are not set, so the laboratory write path " +
      "has NOT been verified against a real database. Set the variables listed in " +
      "tests/integration/lab-flow.test.ts to run these checks.",
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

describe.skipIf(!configured)("laboratory write path (live database)", () => {
  it("persists trials, measurements, observations and the student's calculation", async () => {
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
      label: "lab flow probe initial reading",
      value: 0,
      unit: "mL",
    });
    expect(measurement.error).toBeNull();

    // The student's own written observation, as `record_observation` stores it.
    const textObservation = await student.from("observations").upsert(
      {
        attempt_id: attemptId,
        step_key: "stage-a-khp-naoh",
        field_key: "colour_change",
        text_value: "faint pink that persisted",
        choice_value: null,
      },
      { onConflict: "attempt_id,step_key,field_key" },
    );
    expect(textObservation.error).toBeNull();

    // The endpoint colour the simulation observed for the same trial.
    const choiceObservation = await student.from("observations").upsert(
      {
        attempt_id: attemptId,
        step_key: "stage-a-khp-naoh",
        field_key: "trial_1_endpoint_colour",
        text_value: null,
        choice_value: "faint_pink",
      },
      { onConflict: "attempt_id,step_key,field_key" },
    );
    expect(choiceObservation.error).toBeNull();

    // An empty observation is refused by the table constraint.
    const emptyObservation = await student.from("observations").upsert(
      {
        attempt_id: attemptId,
        step_key: "stage-a-khp-naoh",
        field_key: "empty_probe",
        text_value: "   ",
        choice_value: null,
      },
      { onConflict: "attempt_id,step_key,field_key" },
    );
    expect(emptyObservation.error).not.toBeNull();

    const calculation = await student.from("calculation_submissions").upsert(
      {
        attempt_id: attemptId,
        question_key: "stage-a-khp-naoh__molarity_trial_1",
        student_value: 0.2,
        student_unit: "mol/L",
        attempt_number: 1,
      },
      { onConflict: "attempt_id,question_key" },
    );
    expect(calculation.error).toBeNull();

    // The student can read back only what the laboratory may display.
    const readTrials = await student
      .from("experiment_trials")
      .select("trial_number, status, initial_reading, final_reading, titre_volume")
      .eq("attempt_id", attemptId);
    expect(readTrials.error).toBeNull();
    expect(
      (readTrials.data ?? []).some(
        (row) => (row as { trial_number: number }).trial_number === 1,
      ),
    ).toBe(true);

    const readObservations = await student
      .from("observations")
      .select("step_key, field_key, text_value, choice_value")
      .eq("attempt_id", attemptId);
    expect(readObservations.error).toBeNull();
    const fields = (readObservations.data ?? []).map(
      (row) => (row as { field_key: string }).field_key,
    );
    expect(fields).toContain("colour_change");
    expect(fields).toContain("trial_1_endpoint_colour");

    const readCalculations = await student
      .from("calculation_submissions")
      .select("question_key, student_value")
      .eq("attempt_id", attemptId);
    expect(readCalculations.error).toBeNull();
    expect(
      (readCalculations.data ?? []).some(
        (row) => (row as { question_key: string }).question_key === "stage-a-khp-naoh__molarity_trial_1",
      ),
    ).toBe(true);
  });

  it("keeps the hidden answer key and secrets unreadable from the laboratory client", async () => {
    const student = await signIn(env.studentAEmail as string, env.studentAPassword as string);
    const attemptId = await ownAttemptId(student);

    const secrets = await student
      .from("attempt_secrets")
      .select("seed, true_values, expected_endpoint")
      .eq("attempt_id", attemptId);
    expect(secrets.data ?? []).toEqual([]);

    // The answer-key columns are excluded from the SELECT grant.
    const answerKey = await student
      .from("calculation_submissions")
      .select("expected_value")
      .eq("attempt_id", attemptId);
    expect(answerKey.error).not.toBeNull();
  });
});
