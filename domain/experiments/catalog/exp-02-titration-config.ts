import { parseTitrationConfig, type TitrationExperimentConfig } from "@/domain/simulation/titration/config";

/**
 * EXPERIMENT 2 — first reference configuration for the generic engine.
 * "Standardization of NaOH and Determination of HCl" (MUST NSCH 1103, pp.16-21).
 *
 * SOURCE TAGS per field:
 * - [MANUAL] stated verbatim in the practical manual.
 * - [STANDARD] standard chemistry data (IUPAC atomic weights, 1:1 from the
 *   manual's general HA+BOH equation applied to monoprotic KHP / HCl).
 * - [SIM] simulation parameter: required by the engine, not stated in the
 *   manual (per-attempt variation ranges, noise, rubric weights). Never
 *   presented to students as a manual value.
 *
 * NOTE: the Stage-1 UI catalog (`exp-02-standardisation.ts`) is intentionally
 * left untouched (still `accuracy: "assumed"`); promoting it to
 * manual-verified text belongs to a later stage with its migration + copy
 * review. This file is the manual-verified simulation reference.
 */
const config = {
  experimentNumber: 2, // [MANUAL] Experiment 2
  nominalTitrantMolarityM: 0.2, // [MANUAL] "~0.2M NaOH" diluted from 2M stock
  // [MANUAL] Part I: "Preparation of approximately 0.2 M NaOH from 2 M NaOH
  // solution". Both strengths are stated in the procedure; the volume of stock
  // the student measures is recorded as evidence of the step and deliberately
  // feeds NO calculation — the working strength stays the nominal value above
  // plus hidden truth, so no exact final concentration is invented.
  solutionDilution: {
    stockKey: "naoh_stock_2m",
    stockMolarityM: 2,
    nominalWorkingMolarityM: 0.2,
  },
  hiddenRanges: {
    // [SIM] keeps every attempt within one 50 mL burette filling.
    titrantMolarityM: [0.18, 0.22],
    // [SIM] unknown HCl bracketing the manual's nominal working strength.
    unknownAnalyteMolarityM: [0.15, 0.25],
  },
  readingNoiseMl: 0.02, // [MANUAL] burette read "to within ±0.02 mL"
  endpointBiasMl: 0.08, // [SIM] one-drop-scale overshoot tendency
  stages: [
    {
      key: "stage-a-khp-naoh",
      title: "Standardization of NaOH with KHP",
      family: "acid_base",
      endpointStyle: "indicator_colour",
      reactionEquation: "KHC8H4O4 + NaOH -> KNaC8H4O4 + H2O", // [STANDARD] 1:1
      stoichiometry: { analyteCoefficient: 1, titrantCoefficient: 1 }, // [STANDARD]
      titrantKey: "naoh",
      analyteKey: "khp",
      analytePortion: {
        kind: "weighed_mass",
        nominalMassG: 0.6, // [MANUAL] "Add 0.6 g of KHP"
        balancePrecisionG: 0.01, // [MANUAL] weigh "to ±0.01 g"
      },
      indicator: {
        key: "phenolphthalein",
        name: "Phenolphthalein", // [MANUAL] indicator for both stages
        acidColour: "colourless", // [MANUAL] "colorless in acidic solution"
        baseColour: "pink", // [MANUAL] "pink in basic solution"
        drops: [3, 4], // [MANUAL] "3 to 4 drops"
        endpointPersistenceSeconds: [45, 60], // [MANUAL] "faint pink ... 45 to 60 seconds"
        transitionPhRange: null, // NOT in manual: deliberately not invented
      },
      burette: {
        capacityMl: 50, // [MANUAL] "50 ml burette"
        graduationMl: 0.1, // [STANDARD] standard 50 mL burette graduation
        readingPrecisionMl: 0.02, // [MANUAL] "record ... to two decimal places", ±0.02 mL
        maxDeliveredMl: 50,
      },
    },
    {
      key: "stage-b-hcl-naoh",
      title: "Determination of HCl with standardized NaOH",
      family: "acid_base",
      endpointStyle: "indicator_colour",
      reactionEquation: "HCl + NaOH -> NaCl + H2O", // [MANUAL general equation] 1:1
      stoichiometry: { analyteCoefficient: 1, titrantCoefficient: 1 }, // [STANDARD]
      titrantKey: "naoh",
      analyteKey: "hcl",
      // The catalog holds the analyte as its inventory row `hcl_unknown`
      // ("Unknown hydrochloric acid solution", concentration deliberately NULL).
      // `hcl` is the chemistry key the engine works with; the catalog key is what
      // the briefing must list. Stating the binding keeps the coverage check
      // honest instead of comparing two different vocabularies.
      catalog: { analyteKey: "hcl_unknown" },
      analytePortion: {
        kind: "pipetted_volume",
        nominalVolumeMl: 25.0, // [MANUAL] "approximately 25.00 mL of HCl"
        volumePrecisionMl: 0.02, // [MANUAL] volume "known to two decimal places"
        // [MANUAL] "Using a measuring cylinder, transfer approximately
        // 25.00 mL". The supplied text also mentions "initial and final acid
        // burette readings" further down, but that contradicts its own
        // instruction, so no second HCl burette is modelled. The vessel names
        // the CATALOG apparatus row ("Graduated cylinder"); the laboratory's
        // wording keeps the manual's "measuring cylinder".
        vessel: "graduated_cylinder",
      },
      indicator: {
        key: "phenolphthalein",
        name: "Phenolphthalein", // [MANUAL]
        acidColour: "colourless",
        baseColour: "pink",
        drops: [3, 4], // [MANUAL]
        endpointPersistenceSeconds: [45, 60],
        transitionPhRange: null,
      },
      burette: {
        capacityMl: 50, // [MANUAL]
        graduationMl: 0.1,
        readingPrecisionMl: 0.02, // [MANUAL]
        maxDeliveredMl: 50,
      },
    },
  ],
  trialRules: {
    minTrials: 3, // [MANUAL] "Repeat the titration procedure three times"
    maxTrials: 4, // [MANUAL] "perform a fourth titration" if spread too large
    // [SIM] Attempts a stage may run, discarded overshoots included. The manual
    // counts RECORDED trials (three, or a fourth if they disagree) and says an
    // overshoot is discarded and repeated, so a discarded run must not consume
    // the manual's budget — without this, two overshoots make the experiment
    // impossible to finish. 8 leaves at most four recorded plus four repeats.
    maxTrialAttempts: 8,
    discardOnOvershoot: true, // [MANUAL] overshoot -> "discard ... and repeat"
    concordance: {
      mode: "molarity",
      maxSpreadM: 0.005, // [MANUAL] "vary by more than 0.005 M"
      useClosestPairAverage: true, // [MANUAL] "average ... using the two closest values"
    },
  },
  // [SIM] foundation weights reusing the Stage-1 assessment categories.
  assessmentWeights: {
    technique: 30,
    endpoint: 30,
    concordance: 20,
    calculations: 20,
  },
};

/** Validated at import so an invalid reference fails fast in tests/build. */
export const exp02TitrationConfig: TitrationExperimentConfig = parseTitrationConfig(config);
