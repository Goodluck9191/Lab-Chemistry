import type { SimulationState } from "./types";

/** Bump when the shape of SimulationState changes, so old snapshots can be
 * migrated rather than silently mis-read. */
export const SIMULATION_STATE_SCHEMA_VERSION = 1;

/**
 * A blank, structurally valid experiment state. No chemistry happens here: the
 * engines populate this as the student works. Having one pure factory keeps the
 * database, the tests and (later) the engines agreeing on one shape.
 */
export function createInitialSimulationState(): SimulationState {
  return {
    schemaVersion: SIMULATION_STATE_SCHEMA_VERSION,
    currentStep: "not-started",
    apparatus: [],
    chemicals: [],
    solutionVolumes: [],
    concentrations: [],
    temperature: null,
    colours: [],
    precipitates: [],
    measurements: [],
    trials: [],
    observations: [],
    calculations: [],
    safetyEvents: [],
    score: { awarded: 0, possible: 0, events: [] },
  };
}
