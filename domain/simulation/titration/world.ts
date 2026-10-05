/**
 * The PHYSICAL WORLD of the laboratory, kept rigorously apart from the
 * experimental record and from the student's academic work (§28, §29).
 *
 * Three kinds of number exist in this project, and they must never merge:
 *
 *   WORLD OBSERVATION  what the apparatus actually shows — the meniscus on the
 *                      scale, the balance display, the level in the cylinder.
 *                      Physical, deterministic, not client-settable.
 *                      (this module)
 *   EXPERIMENTAL RECORD what the STUDENT wrote down after reading it — their
 *                      initial reading, their weighing, their aliquot volume.
 *                      (the stage's recorded fields, unchanged)
 *   ACADEMIC WORK      the student's own calculations and answers. (the report)
 *
 * The world is what makes the practical real: the simulator provides the
 * measurement, the student reads it, and the difference between the two is what
 * `measurements.deviation` records for assessment. Nothing here is an answer
 * key — the meniscus is visible in the glass, the pan reading is visible on the
 * display, and neither reveals the true titrant concentration or the endpoint.
 *
 * NOTHING HERE IS PERSISTED as a derived value: the observation is recomputed
 * from the persisted session on every projection, so it can never go stale.
 */
import type { TitrationExperimentConfig, TitrationStageConfig } from "./config";
import type { StageHiddenTruth } from "./hidden";
import type { StageSession } from "./engine";

/**
 * The persisted PHYSICAL placement facts of one stage's bench.
 *
 * These are the things a student does with their hands that the domain has to
 * know about to be honest: is the burette clamped on the stand, how far is the
 * stopcock turned, how much liquid is standing in the measuring cylinder, how
 * much has been tipped into the waste container.
 *
 * Persisted rather than UI-only because §33 requires the room to reconstruct
 * itself meaningfully: a resumed attempt must not show a burette in its cradle
 * when the student had hung it on the clamp, or an open tap that the server
 * thinks is shut. High-frequency render state (camera, animation phase, what is
 * in a hand) is deliberately NOT here.
 */
export interface StageWorld {
  /** The burette hangs on the stand. A real precondition for filling it. */
  buretteMounted: boolean;
  /** Stopcock handle angle in degrees; 0 is shut, 90 is fully open. */
  stopcockAngleDeg: number;
  /** Liquid standing in the measuring cylinder, mL. */
  cylinderVolumeMl: number;
  /** Solution tipped into the waste container, mL. */
  wasteMl: number;
  /**
   * Titrant run out of the burette while no trial was open, mL. A real mistake
   * with a real consequence: the meniscus drops, so the student's next reading
   * no longer matches what they actually delivered.
   */
  spilledMl: number;
}

export function emptyStageWorld(): StageWorld {
  return {
    buretteMounted: false,
    stopcockAngleDeg: 0,
    cylinderVolumeMl: 0,
    wasteMl: 0,
    spilledMl: 0,
  };
}

/**
 * What the instruments SHOW right now. The student reads these and records
 * their own value; nothing downstream treats them as the student's answer.
 */
export interface StageWorldObservation {
  /** Scale value at the liquid surface, or null while the burette is empty. */
  buretteReadingMl: number | null;
  /** What the balance displays, or null when there is nothing on the pan. */
  balanceDisplayG: number | null;
  /** True when the beaker is standing on the pan. */
  balanceHasBeaker: boolean;
  /** Liquid standing in the cylinder, mL. */
  cylinderVolumeMl: number;
  /** mL tipped into the waste container so far. */
  wasteMl: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function stageConfigFor(
  config: TitrationExperimentConfig,
  stageKey: string,
): TitrationStageConfig {
  const stage = config.stages.find((entry) => entry.key === stageKey);
  if (!stage) throw new Error(`unknown stage ${stageKey}`);
  return stage;
}

/**
 * The meniscus the scale shows.
 *
 * Before the burette is filled there is nothing to read. Afterwards the level is
 * the fill level the attempt drew, plus everything delivered so far: the glass
 * and the world agree by construction, and a resumed attempt shows the level it
 * left behind rather than the last number the student typed.
 */
export function worldBuretteReadingMl(args: {
  config: TitrationExperimentConfig;
  stageKey: string;
  stage: StageSession;
  hidden: StageHiddenTruth;
}): number | null {
  const cfg = stageConfigFor(args.config, args.stageKey);
  if (!args.stage.apparatusReady) return null;
  return round2(
    clamp(
      args.hidden.buretteFillLevelMl +
        args.stage.deliveredSoFarMl +
        (args.stage.world?.spilledMl ?? 0),
      0,
      cfg.burette.capacityMl,
    ),
  );
}

/**
 * What the balance reads.
 *
 * The pan is honest: nothing on it reads nothing, the dry beaker reads its own
 * tare, and once the standard has been tipped in it reads tare plus the sample
 * the attempt actually weighed out. The sample mass itself stays the student's
 * own subtraction of the two readings they record.
 */
export function worldBalanceDisplayG(args: {
  stage: StageSession;
  hidden: StageHiddenTruth;
  beakerTareG: number;
}): number | null {
  const prep = args.stage.preparation;
  if (!prep.beakerOnBalance) return null;
  const material = args.hidden.trueAnalyteMassG ?? 0;
  return round2(args.beakerTareG + (prep.khpAdded ? material : 0));
}

/** Project the world the laboratory is drawing for one stage. */
export function stageWorldObservation(args: {
  config: TitrationExperimentConfig;
  stageKey: string;
  stage: StageSession;
  hidden: StageHiddenTruth;
  beakerTareG: number;
}): StageWorldObservation {
  const world = args.stage.world;
  const balanceDisplayG = worldBalanceDisplayG({
    stage: args.stage,
    hidden: args.hidden,
    beakerTareG: args.beakerTareG,
  });
  return {
    buretteReadingMl: worldBuretteReadingMl(args),
    balanceDisplayG,
    balanceHasBeaker: args.stage.preparation.beakerOnBalance,
    cylinderVolumeMl: world.cylinderVolumeMl,
    wasteMl: world.wasteMl,
  };
}

/**
 * How far a recorded value sits from what the instrument showed.
 *
 * Used only to populate `measurements.deviation` — an accuracy signal for
 * assessment. It is never rendered to the student during the practical and it
 * never corrects a reading: the student's own number is what the experiment
 * carries forward, mistakes included (§9, §24).
 */
export function readingDeviationMl(recordedValue: number, worldValue: number): number {
  return Math.round(Math.abs(recordedValue - worldValue) * 100) / 100;
}

/** Clamp an angle reported by a dragged valve into the physical quarter turn. */
export function clampStopcockAngle(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) return 0;
  return clamp(angleDeg, 0, 90);
}
