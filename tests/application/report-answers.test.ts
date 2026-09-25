import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { saveReportAnswers } from "@/application/attempts/report-answers";
import { loadTitrationAttempt } from "@/application/attempts/apply-simulation-action";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { createPrivilegeCheckingClient } from "../helpers/postgrest-privilege-fake";

vi.mock("@/application/attempts/apply-simulation-action", () => ({
  loadTitrationAttempt: vi.fn(),
}));

vi.mock("@/infrastructure/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

const ATTEMPT_ID = "123e4567-e89b-12d3-a456-426614174000";

function mockLoaded(canWrite: boolean) {
  vi.mocked(loadTitrationAttempt).mockResolvedValue({
    attemptId: ATTEMPT_ID,
    experimentId: "exp-02",
    status: canWrite ? "in_progress" : "submitted",
    config: {},
    session: {},
    revision: 1,
    canWrite,
  } as never);
}

describe("report answers save path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores declared answers through the granted columns", async () => {
    mockLoaded(true);
    const fake = createPrivilegeCheckingClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

    const outcome = await saveReportAnswers(ATTEMPT_ID, {
      q_aim: "Determine the concentration.",
      _error_sources: "Splash once.",
    });
    expect(outcome).toEqual({ status: "ok" });
    const rows = fake.rows("reports");
    expect(rows).toHaveLength(1);
    expect(rows[0].answers).toEqual({
      q_aim: "Determine the concentration.",
      _error_sources: "Splash once.",
    });
  });

  it("drops unknown keys and rejects oversize answers", async () => {
    mockLoaded(true);
    const fake = createPrivilegeCheckingClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

    const outcome = await saveReportAnswers(ATTEMPT_ID, {
      q_aim: "Fine.",
      injected: "nope",
      auto_score: 100,
    });
    expect(outcome).toEqual({ status: "ok" });
    expect(fake.rows("reports")[0].answers).toEqual({ q_aim: "Fine." });

    const long = await saveReportAnswers(ATTEMPT_ID, { q_aim: "x".repeat(2001) });
    expect(long.status).toBe("error");
  });

  it("refuses writes on a submitted attempt", async () => {
    mockLoaded(false);
    const fake = createPrivilegeCheckingClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

    const outcome = await saveReportAnswers(ATTEMPT_ID, { q_aim: "Too late." });
    expect(outcome.status).toBe("error");
    expect(fake.rows("reports")).toHaveLength(0);
  });
});
