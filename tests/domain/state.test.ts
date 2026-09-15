import { describe, expect, it } from "vitest";
import {
  SIMULATION_STATE_SCHEMA_VERSION,
  createInitialSimulationState,
  simulationStateSchema,
} from "@/domain/simulation";

describe("simulation state contract", () => {
  it("creates a structurally valid initial state", () => {
    const state = createInitialSimulationState();
    expect(() => simulationStateSchema.parse(state)).not.toThrow();
    expect(state.schemaVersion).toBe(SIMULATION_STATE_SCHEMA_VERSION);
    expect(state.currentStep).toBe("not-started");
    expect(state.trials).toEqual([]);
    expect(state.score).toEqual({ awarded: 0, possible: 0, events: [] });
  });

  it("contains every field the running experiment will need", () => {
    const state = createInitialSimulationState();
    const expectedKeys = [
      "schemaVersion",
      "currentStep",
      "apparatus",
      "chemicals",
      "solutionVolumes",
      "concentrations",
      "temperature",
      "colours",
      "precipitates",
      "measurements",
      "trials",
      "observations",
      "calculations",
      "safetyEvents",
      "score",
    ];
    expect(Object.keys(state).sort()).toEqual(expectedKeys.sort());
  });

  it("accepts a populated state", () => {
    const state = createInitialSimulationState();
    state.currentStep = "step-6";
    state.trials = [
      {
        trialNumber: 1,
        status: "recorded",
        initialReading: 0.05,
        finalReading: 22.4,
        titreVolume: 22.35,
        endpointObserved: true,
      },
    ];
    state.measurements = [
      {
        kind: "titration_reading",
        label: "Final burette reading",
        value: 22.4,
        unit: "mL",
        recordedAt: new Date().toISOString(),
      },
    ];
    expect(() => simulationStateSchema.parse(state)).not.toThrow();
  });

  it("rejects a snapshot that has been tampered with or corrupted", () => {
    const state = createInitialSimulationState() as unknown as Record<string, unknown>;
    expect(() => simulationStateSchema.parse({ ...state, schemaVersion: 0 })).toThrow();
    expect(() => simulationStateSchema.parse({ ...state, temperature: 25 })).toThrow();
    expect(() => simulationStateSchema.parse({ ...state, trials: [{ trialNumber: 0, status: "open" }] })).toThrow();
    expect(
      () =>
        simulationStateSchema.parse({
          ...state,
          measurements: [
            { kind: "mass", label: "x", value: Number.POSITIVE_INFINITY, unit: "g", recordedAt: "now" },
          ],
        }),
    ).toThrow();
  });
});
