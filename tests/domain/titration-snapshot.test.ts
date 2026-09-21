import { describe, expect, it } from "vitest";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  addIndicator,
  addTitrant,
  completeTrial,
  createTitrationSession,
  readBurette,
  reportMolarity,
  setupApparatus,
  startTrialAction,
  weighAnalyte,
} from "@/domain/simulation/titration/engine";
import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";
import {
  hiddenFromSecrets,
  resumeSessionFromSnapshot,
  secretsForStorage,
  snapshotFromSession,
} from "@/domain/simulation/titration/snapshot";
import { trialRowFor, trialRowNumber } from "@/domain/simulation/titration/persistence";

const STAGE_A = "stage-a-khp-naoh";
const STAGE_B = "stage-b-hcl-naoh";

function workedSession() {
  const session = createTitrationSession(exp02TitrationConfig, "snapshot-seed");
  setupApparatus(session, STAGE_A, "naoh", 0);
  weighAnalyte(session, STAGE_A, 0.6);
  addIndicator(session, STAGE_A, 3);
  startTrialAction(session, STAGE_A, 1, 0);
  const target = session.hidden.stages[STAGE_A].observableMl;
  addTitrant(session, STAGE_A, target);
  readBurette(session, STAGE_A, target);
  completeTrial(session, STAGE_A);
  return session;
}

describe("secrets serialisation", () => {
  it("round-trips hidden state through storage shape", () => {
    const session = createTitrationSession(exp02TitrationConfig, "roundtrip-seed");
    const secrets = secretsForStorage("roundtrip-seed", session);
    expect(secrets.seed).toBe("roundtrip-seed");
    expect(Object.keys(secrets.rubricWeights)).toContain("technique");
    const restored = hiddenFromSecrets(secrets, exp02TitrationConfig);
    expect(restored).toEqual(session.hidden);
  });

  it("covers both stages (weighed mass and pipetted volume)", () => {
    const session = createTitrationSession(exp02TitrationConfig, "both-stages");
    const secrets = secretsForStorage("both-stages", session);
    expect(secrets.trueValues[`${STAGE_A}__analyte_mass_g`]).toBeGreaterThan(0);
    expect(secrets.trueValues[`${STAGE_B}__analyte_M`]).toBeGreaterThan(0);
    expect(secrets.expectedEndpoint[`${STAGE_B}__observable_ml`]).toBeGreaterThan(0);
  });

  it("fails loudly on corrupt secrets", () => {
    const session = createTitrationSession(exp02TitrationConfig, "corrupt");
    const secrets = secretsForStorage("corrupt", session);
    expect(() => hiddenFromSecrets({ ...secrets, seed: "" }, exp02TitrationConfig)).toThrow();
    const missing = { ...secrets, trueValues: {} };
    expect(() => hiddenFromSecrets(missing, exp02TitrationConfig)).toThrow();
  });
});

describe("snapshot round-trip (autosave/resume)", () => {
  it("resumes an identical public session after persist and reload", () => {
    const session = workedSession();
    const target = session.hidden.stages[STAGE_A].observableMl;
    const expected = 0.6 / 204.2223 / (target / 1000);
    reportMolarity(session, STAGE_A, 1, expected);

    const snapshot = snapshotFromSession(session);
    const secrets = secretsForStorage("snapshot-seed", session);
    const resumed = resumeSessionFromSnapshot(exp02TitrationConfig, secrets, snapshot);

    expect(resumed.public).toEqual(JSON.parse(JSON.stringify(session.public)));
    expect(resumed.hidden).toEqual(session.hidden);
    expect(resumed.config.experimentNumber).toBe(2);
  });

  it("projects trials, measurements and calculations into the generic arrays", () => {
    const snapshot = snapshotFromSession(workedSession());
    expect(snapshot.trials).toHaveLength(1);
    expect(snapshot.trials[0].status).toBe("recorded");
    expect(snapshot.measurements.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.calculations).toHaveLength(0);
  });

  it("refuses snapshots from another experiment or without titration state", () => {
    const session = workedSession();
    const secrets = secretsForStorage("snapshot-seed", session);
    const snapshot = snapshotFromSession(session);
    const tampered = { ...snapshot, titration: { ...snapshot.titration!, experimentNumber: 99 } };
    expect(() =>
      resumeSessionFromSnapshot(exp02TitrationConfig, secrets, tampered),
    ).toThrow();
    const { titration: _dropped, ...bare } = snapshot;
    void _dropped;
    expect(() => resumeSessionFromSnapshot(exp02TitrationConfig, secrets, bare)).toThrow();
  });

  it("numbers trial rows per stage within the 1..20 table range", () => {
    // Each stage owns an EQUAL block of the 1..20 range, so a stage may run more
    // attempts than it records (an overshoot is repeated) without its re-runs
    // ever colliding with the next stage's first trial.
    expect(trialRowNumber(exp02TitrationConfig, STAGE_A, 1)).toBe(1);
    expect(trialRowNumber(exp02TitrationConfig, STAGE_A, 8)).toBe(8);
    expect(trialRowNumber(exp02TitrationConfig, STAGE_B, 1)).toBe(11);
    expect(trialRowNumber(exp02TitrationConfig, STAGE_B, 8)).toBe(18);
    expect(() => trialRowNumber(exp02TitrationConfig, STAGE_B, 11)).toThrow();
    const session = workedSession();
    const row = trialRowFor(exp02TitrationConfig, session.public.stages[STAGE_A].trials[0]);
    expect(row.trialNumber).toBe(1);
    expect(row.endpointObserved).toBe(true);
  });

  it("maps discarded overshoots to rejected rows with a reason", () => {
    const session = createTitrationSession(exp02TitrationConfig, "overshoot-rows");
    setupApparatus(session, STAGE_A, "naoh", 0);
    weighAnalyte(session, STAGE_A, 0.6);
    addIndicator(session, STAGE_A, 3);
    startTrialAction(session, STAGE_A, 1, 0);
    addTitrant(session, STAGE_A, 40);
    readBurette(session, STAGE_A, 40);
    completeTrial(session, STAGE_A);
    const row = trialRowFor(exp02TitrationConfig, session.public.stages[STAGE_A].trials[0]);
    expect(row.status).toBe("rejected");
    expect(row.rejectionReason).toMatch(/overshot/i);
  });

  it("never persists hidden keys, seeds or answer-key details in the snapshot", () => {
    const session = workedSession();
    // Wrong molarity on purpose: the recorded error detail must not leak truth.
    reportMolarity(session, STAGE_A, 1, 0.0001);
    const serialised = JSON.stringify(snapshotFromSession(session));
    for (const key of HIDDEN_KEY_DENYLIST) {
      expect(serialised).not.toContain(`"${key}"`);
    }
    expect(serialised).not.toContain("snapshot-seed");
    // The student's own titre legitimately approximates the endpoint; what must
    // never appear is an answer-key framing of any number.
    expect(serialised.toLowerCase()).not.toContain("expected");
    expect(serialised).not.toContain("answer key");
  });
});
