import { describe, expect, it } from "vitest";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  preparationMeasurementRows,
  solutionMeasurementRows,
} from "@/domain/simulation/titration/persistence";
import {
  clearAirBubble,
  conditionBurette,
  discardToWaste,
  diluteWorkingSolution,
  dissolveKhp,
  measureStockVolume,
  mixWorkingSolution,
  obtainTitrantPortion,
  placeFlask,
  preparationBlockersForTrial,
  rinseBeaker,
  rinseBurette,
  transferSolution,
  weighBeakerMass,
  REQUIRED_BEAKER_RINSES,
  REQUIRED_CONDITIONING_RINSES,
} from "@/domain/simulation/titration/engine";
import {
  FIXTURE_STOCK_VOLUME_ML,
  freshSession,
  provisionStageA,
  provisionWorkingSolution,
  runTrial,
  setup,
  STAGE_A,
  STAGE_B,
} from "../helpers/titration-fixtures";

/**
 * Part I at the engine level: measure the stock, dilute it, mix it, then take
 * the portion the burette is served from. Attempt-level, so it is done once and
 * reused by every stage.
 */
describe("working solution preparation (Part I)", () => {
  it("runs measure, dilute and mix in order, once each", () => {
    const session = freshSession();
    // Nothing to dilute and nothing to portion before the stock is measured.
    expect(obtainTitrantPortion(session, STAGE_A).ok).toBe(false);
    expect(measureStockVolume(session, STAGE_A, FIXTURE_STOCK_VOLUME_ML)).toMatchObject({
      ok: true,
    });
    expect(session.public.solution.stockVolumeMl).toBe(FIXTURE_STOCK_VOLUME_ML);
    expect(measureStockVolume(session, STAGE_A, 20).ok).toBe(false);

    provisionWorkingSolution(session, STAGE_A);
    expect(session.public.solution).toMatchObject({ diluted: true, mixed: true });
  });

  it("refuses the dilution steps out of order", () => {
    const session = freshSession();
    expect(conditionBurette(session, STAGE_A).ok).toBe(false);
    expect(rinseBurette(session, STAGE_A)).toMatchObject({ ok: true });
    // Cleaning is not enough: the conditioning rinses ARE the titrant, so the
    // portion has to exist first.
    expect(conditionBurette(session, STAGE_A).ok).toBe(false);
    provisionWorkingSolution(session, STAGE_A);
    expect(obtainTitrantPortion(session, STAGE_A)).toMatchObject({ ok: true });
    expect(obtainTitrantPortion(session, STAGE_A).ok).toBe(false);
    expect(conditionBurette(session, STAGE_A)).toMatchObject({ ok: true });
  });

  it("records the measured stock volume as evidence, never as chemistry", () => {
    const session = freshSession();
    provisionWorkingSolution(session, STAGE_A);
    const rows = solutionMeasurementRows(session.public.solution);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "volume", value: FIXTURE_STOCK_VOLUME_ML, unit: "mL" });
    // No stage quantity is derived from it: the analyte mass and the titre are
    // untouched by the volume the student measured.
    expect(session.public.stages[STAGE_A].analyteMassG).toBeNull();
    expect(session.public.stages[STAGE_A].deliveredSoFarMl).toBe(0);

    // Nor is any concentration: an attempt that measures 30 mL instead of 10
    // has the SAME hidden titrant strength and endpoint volume. The procedure
    // states no final concentration, so the simulator must not invent one from
    // the student's reading.
    const other = freshSession();
    expect(measureStockVolume(other, STAGE_A, 30).ok).toBe(true);
    expect(diluteWorkingSolution(other, STAGE_A).ok).toBe(true);
    expect(mixWorkingSolution(other, STAGE_A).ok).toBe(true);
    expect(other.public.solution.stockVolumeMl).toBe(30);
    expect(other.hidden.stages[STAGE_A]).toEqual(session.hidden.stages[STAGE_A]);
  });

  it("takes a portion per stage from the one prepared solution", () => {
    const session = freshSession();
    provisionWorkingSolution(session, STAGE_A);
    expect(obtainTitrantPortion(session, STAGE_A).ok).toBe(true);
    // Stage B draws its own portion from the SAME solution: Part I is not redone.
    expect(obtainTitrantPortion(session, STAGE_B).ok).toBe(true);
    expect(session.public.stages[STAGE_A].preparation.beakerObtained).toBe(true);
    expect(session.public.stages[STAGE_B].preparation.beakerObtained).toBe(true);
  });
});

/**
 * Procedure preparation at the engine level. Each function validates only its
 * own slot; cross-step order is enforced by the dispatch trial gate (covered
 * in `titration-prep-gating.test.ts`), so these tests pin the slot rules.
 */
describe("burette preparation", () => {
  it("cleans once, then counts exactly three conditioning rinses", () => {
    const session = freshSession();
    provisionWorkingSolution(session, STAGE_A);
    expect(rinseBurette(session, STAGE_A)).toMatchObject({ ok: true });
    expect(rinseBurette(session, STAGE_A).ok).toBe(false);
    expect(session.public.stages[STAGE_A].preparation.buretteCleaned).toBe(true);
    expect(obtainTitrantPortion(session, STAGE_A).ok).toBe(true);

    for (let rinse = 1; rinse <= REQUIRED_CONDITIONING_RINSES; rinse += 1) {
      expect(conditionBurette(session, STAGE_A).ok).toBe(true);
      expect(session.public.stages[STAGE_A].preparation.conditioningRinses).toBe(rinse);
    }
    expect(conditionBurette(session, STAGE_A).ok).toBe(false);
  });

  it("refuses conditioning before cleaning", () => {
    expect(conditionBurette(freshSession(), STAGE_A).ok).toBe(false);
  });

  it("clears the air bubble only after the burette is filled", () => {
    const session = freshSession();
    expect(clearAirBubble(session, STAGE_A).ok).toBe(false);
    setup(session);
    expect(clearAirBubble(session, STAGE_A).ok).toBe(true);
    expect(clearAirBubble(session, STAGE_A).ok).toBe(false);
  });
});

describe("weighing by difference", () => {
  it("derives the sample mass from the two weighings", () => {
    const session = freshSession();
    setup(session);
    expect(weighBeakerMass(session, STAGE_A, 52.34).ok).toBe(true);
    expect(session.public.stages[STAGE_A].analyteMassG).toBeNull();
    expect(weighBeakerMass(session, STAGE_A, 52.94).ok).toBe(true);
    expect(session.public.stages[STAGE_A].analyteMassG).toBe(0.6);
    expect(session.public.stages[STAGE_A].phase).toBe("analyte_ready");
  });

  it("refuses a second weighing at or below the empty beaker", () => {
    const session = freshSession();
    setup(session);
    expect(weighBeakerMass(session, STAGE_A, 52.34).ok).toBe(true);
    const outcome = weighBeakerMass(session, STAGE_A, 52.0);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid_sequence");
    expect(session.public.stages[STAGE_A].analyteMassG).toBeNull();
  });

  it("refuses a third weighing once the pair is complete", () => {
    const session = freshSession();
    setup(session);
    weighBeakerMass(session, STAGE_A, 52.34);
    weighBeakerMass(session, STAGE_A, 52.94);
    expect(weighBeakerMass(session, STAGE_A, 53.0).ok).toBe(false);
  });

  it("refuses weighing on a pipetted stage and before setup", () => {
    expect(weighBeakerMass(freshSession(), STAGE_B, 50).ok).toBe(false);
    expect(weighBeakerMass(freshSession(), STAGE_A, 50).ok).toBe(false);
  });
});

describe("KHP solution handling", () => {
  it("runs dissolve, transfer and two rinses in order", () => {
    const session = freshSession();
    setup(session);
    expect(dissolveKhp(session, STAGE_A).ok).toBe(false);
    weighBeakerMass(session, STAGE_A, 52.34);
    weighBeakerMass(session, STAGE_A, 52.94);
    expect(transferSolution(session, STAGE_A).ok).toBe(false);
    expect(dissolveKhp(session, STAGE_A).ok).toBe(true);
    expect(rinseBeaker(session, STAGE_A).ok).toBe(false);
    expect(transferSolution(session, STAGE_A).ok).toBe(true);
    expect(rinseBeaker(session, STAGE_A).ok).toBe(true);
    expect(rinseBeaker(session, STAGE_A).ok).toBe(true);
    expect(rinseBeaker(session, STAGE_A).ok).toBe(false);
    const prep = session.public.stages[STAGE_A].preparation;
    expect(prep.beakerRinses).toBe(REQUIRED_BEAKER_RINSES);
  });

  it("places the flask only after the burette is filled", () => {
    const session = freshSession();
    expect(placeFlask(session, STAGE_A).ok).toBe(false);
    setup(session);
    expect(placeFlask(session, STAGE_A).ok).toBe(true);
    expect(placeFlask(session, STAGE_A).ok).toBe(false);
  });
});

describe("waste disposal", () => {
  it("requires a completed trial and fires once per trial", () => {
    const session = freshSession();
    expect(discardToWaste(session, STAGE_A).ok).toBe(false);
    provisionStageA(session);
    expect(discardToWaste(session, STAGE_A).ok).toBe(false);
    runTrial(session, { trialNumber: 1, deliveredMl: 15 });
    expect(discardToWaste(session, STAGE_A)).toMatchObject({ ok: true });
    expect(discardToWaste(session, STAGE_A).ok).toBe(false);
    const prep = session.public.stages[STAGE_A].preparation;
    expect(prep.wasteDiscards).toBe(1);
    expect(prep.lastTrialDiscarded).toBe(true);
  });
});

describe("preparation measurement rows", () => {
  it("records both weighings plus the derived sample mass", () => {
    const session = freshSession();
    setup(session);
    weighBeakerMass(session, STAGE_A, 52.34);
    weighBeakerMass(session, STAGE_A, 52.94);
    const stage = session.public.stages[STAGE_A];
    const rows = preparationMeasurementRows(STAGE_A, stage.preparation, stage.analyteMassG);
    expect(rows.map((row) => row.label)).toEqual([
      `${STAGE_A} empty beaker mass`,
      `${STAGE_A} beaker plus khp mass`,
      `${STAGE_A} khp sample mass by difference`,
    ]);
    expect(rows.map((row) => row.value)).toEqual([52.34, 52.94, 0.6]);
    expect(rows.every((row) => row.unit === "g" && row.trialRowNumber === null)).toBe(true);
  });

  it("omits rows for weighings that never happened", () => {
    const session = freshSession();
    const stage = session.public.stages[STAGE_A];
    expect(preparationMeasurementRows(STAGE_A, stage.preparation, stage.analyteMassG)).toEqual(
      [],
    );
  });
});

describe("preparationBlockersForTrial", () => {
  it("lists every missing step on a fresh stage and none when provisioned", () => {
    const fresh = freshSession();
    const blockers = preparationBlockersForTrial(
      exp02TitrationConfig,
      STAGE_A,
      fresh.public.stages[STAGE_A],
      fresh.public.solution,
    );
    expect(blockers.length).toBeGreaterThan(3);
    // Part I comes first in the procedure, so it is the first thing named.
    expect(blockers[0]).toMatch(/measure the .* stock solution/i);
    expect(blockers.some((blocker) => /clean the burette/i.test(blocker))).toBe(true);
    expect(blockers.some((blocker) => /portion of the working solution/i.test(blocker))).toBe(
      true,
    );

    const ready = freshSession();
    provisionStageA(ready);
    expect(
      preparationBlockersForTrial(
        exp02TitrationConfig,
        STAGE_A,
        ready.public.stages[STAGE_A],
        ready.public.solution,
      ),
    ).toEqual([]);
  });
});
