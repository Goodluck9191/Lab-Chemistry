import { describe, expect, it } from "vitest";
import {
  parseTitrationEnvelope,
  SIMULATION_PROTOCOL_VERSION,
  titrationEnvelopeSchema,
} from "@/domain/simulation/titration/protocol";

const ATTEMPT_ID = "123e4567-e89b-12d3-a456-426614174000";

function baseEnvelope(action: unknown) {
  return {
    protocolVersion: SIMULATION_PROTOCOL_VERSION,
    attemptId: ATTEMPT_ID,
    baseRevision: 3,
    action,
  };
}

describe("action protocol", () => {
  it("parses a well-formed envelope", () => {
    const envelope = parseTitrationEnvelope(
      baseEnvelope({ type: "add_titrant", stageKey: "stage-a-khp-naoh", volumeMl: 1 }),
    );
    expect(envelope.baseRevision).toBe(3);
    expect(envelope.action.type).toBe("add_titrant");
  });

  it("rejects a wrong protocol version", () => {
    expect(() =>
      parseTitrationEnvelope({ ...baseEnvelope({ type: "complete_trial", stageKey: "s" }), protocolVersion: 999 }),
    ).toThrow();
  });

  it("rejects a non-UUID attempt id and a negative base revision", () => {
    expect(() =>
      parseTitrationEnvelope(
        baseEnvelope({ type: "complete_trial", stageKey: "s" }),
      ),
    ).not.toThrow();
    expect(
      titrationEnvelopeSchema.safeParse({
        ...baseEnvelope({ type: "complete_trial", stageKey: "s" }),
        attemptId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      titrationEnvelopeSchema.safeParse({
        ...baseEnvelope({ type: "complete_trial", stageKey: "s" }),
        baseRevision: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown action types and out-of-range parameters", () => {
    expect(
      titrationEnvelopeSchema.safeParse(baseEnvelope({ type: "set_score", score: 100 })).success,
    ).toBe(false);
    expect(
      titrationEnvelopeSchema.safeParse(
        baseEnvelope({ type: "add_indicator", stageKey: "s", drops: 0 }),
      ).success,
    ).toBe(false);
    expect(
      titrationEnvelopeSchema.safeParse(
        baseEnvelope({ type: "add_titrant", stageKey: "s", volumeMl: 500 }),
      ).success,
    ).toBe(false);
    expect(
      titrationEnvelopeSchema.safeParse(
        baseEnvelope({ type: "report_molarity", stageKey: "s", trialNumber: 1, studentMolarityM: -2 }),
      ).success,
    ).toBe(false);
  });

  it("accepts every engine action shape", () => {
    const actions = [
      { type: "setup_apparatus", stageKey: "s", titrantKey: "naoh", initialReadingMl: 0 },
      { type: "weigh_analyte", stageKey: "s", observedMassG: 0.6 },
      { type: "pipette_analyte", stageKey: "s", observedVolumeMl: 25 },
      { type: "add_indicator", stageKey: "s", drops: 3 },
      { type: "start_trial", stageKey: "s", trialNumber: 1, initialReadingMl: 0 },
      { type: "add_titrant", stageKey: "s", volumeMl: 1 },
      { type: "read_burette", stageKey: "s", observedFinalMl: 14.5 },
      { type: "observe_endpoint", stageKey: "s", claimedColour: "faint_pink" },
      { type: "complete_trial", stageKey: "s" },
      { type: "report_molarity", stageKey: "s", trialNumber: 1, studentMolarityM: 0.2 },
    ];
    for (const action of actions) {
      expect(parseTitrationEnvelope(baseEnvelope(action)).action.type).toBe(action.type);
    }
  });

  it("silently drops smuggled hidden fields instead of honouring them", () => {
    const envelope = parseTitrationEnvelope({
      ...baseEnvelope({ type: "complete_trial", stageKey: "s" }),
      seed: "attacker-seed",
      expectedEndpoint: { "s__observable_ml": 1 },
      finalScore: 100,
    });
    expect(envelope).not.toHaveProperty("seed");
    expect(envelope).not.toHaveProperty("expectedEndpoint");
    expect(envelope).not.toHaveProperty("finalScore");
  });
});
