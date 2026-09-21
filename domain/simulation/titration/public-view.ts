/**
 * Public projection of a titration configuration.
 *
 * The laboratory UI needs to know what apparatus exists, how the burette is
 * graduated, which indicator is used and what the trial rules are — all of
 * which the practical manual states openly. It must NOT see the parameters that
 * bracket the answer.
 *
 * This module is an explicit WHITELIST: every field below is copied by name. It
 * does not spread the configuration, so a field added to the config later
 * cannot leak into the browser by accident.
 *
 * DELIBERATELY EXCLUDED:
 * - `hiddenRanges` (brackets the true titrant/analyte concentration)
 * - `endpointBiasMl`, `readingNoiseMl` (simulation parameters, never manual)
 * - `assessmentWeights` (also mirrored into `attempt_secrets.rubricWeights`)
 */
import {
  maxTrialAttemptsFor,
  stageCatalogKeys,
  type AnalytePortionConfig,
  type BuretteConfig,
  type IndicatorConfig,
  type SolutionDilutionConfig,
  type TitrationExperimentConfig,
  type TitrationStageConfig,
} from "./config";

export interface PublicIndicatorView {
  key: string;
  name: string;
  acidColour: string;
  baseColour: string;
  drops: [number, number];
  /**
   * How long the endpoint colour must persist (manual: 45 to 60 s). Stated by
   * the procedure, so the student is told it — the engine itself has no clock.
   */
  endpointPersistenceSeconds: [number, number];
}

export interface PublicBuretteView {
  capacityMl: number;
  graduationMl: number;
  readingPrecisionMl: number;
  maxDeliveredMl: number;
}

export interface PublicStageView {
  key: string;
  title: string;
  reactionEquation: string;
  stoichiometry: { analyteCoefficient: number; titrantCoefficient: number };
  titrantKey: string;
  analyteKey: string;
  /**
   * The public catalog's keys for this stage's reagents — what the briefing must
   * list for the laboratory and the catalog to describe the same experiment.
   * Equal to `titrantKey`/`analyteKey` unless the configuration maps them.
   */
  catalog: { titrantKey: string; analyteKey: string };
  analytePortion: AnalytePortionConfig;
  indicator: PublicIndicatorView;
  burette: PublicBuretteView;
}

export type PublicTrialRulesView =
  | {
      minTrials: number;
      maxTrials: number;
      maxTrialAttempts: number;
      discardOnOvershoot: boolean;
      concordance: { mode: "molarity"; maxSpreadM: number; useClosestPairAverage: boolean };
    }
  | {
      minTrials: number;
      maxTrials: number;
      maxTrialAttempts: number;
      discardOnOvershoot: boolean;
      concordance: {
        mode: "titre_volume";
        toleranceMl: number;
        minConcordantCount: number;
      };
    };

export interface PublicTitrationConfigView {
  experimentNumber: number;
  /** Manual nominal strength (e.g. "~0.2 M NaOH"), shown alongside the label. */
  nominalTitrantMolarityM: number;
  /**
   * Part I working-titrant dilution, or null when the titrant is ready-made.
   * Both strengths are stated in the procedure itself; nothing here is hidden.
   */
  solutionDilution: SolutionDilutionConfig | null;
  stages: PublicStageView[];
  trialRules: PublicTrialRulesView;
}

function indicatorView(indicator: IndicatorConfig): PublicIndicatorView {
  return {
    key: indicator.key,
    name: indicator.name,
    acidColour: indicator.acidColour,
    baseColour: indicator.baseColour,
    drops: [indicator.drops[0], indicator.drops[1]],
    endpointPersistenceSeconds: [
      indicator.endpointPersistenceSeconds[0],
      indicator.endpointPersistenceSeconds[1],
    ],
  };
}

function buretteView(burette: BuretteConfig): PublicBuretteView {
  return {
    capacityMl: burette.capacityMl,
    graduationMl: burette.graduationMl,
    readingPrecisionMl: burette.readingPrecisionMl,
    maxDeliveredMl: burette.maxDeliveredMl,
  };
}

function stageView(stage: TitrationStageConfig): PublicStageView {
  return {
    key: stage.key,
    title: stage.title,
    reactionEquation: stage.reactionEquation,
    stoichiometry: {
      analyteCoefficient: stage.stoichiometry.analyteCoefficient,
      titrantCoefficient: stage.stoichiometry.titrantCoefficient,
    },
    titrantKey: stage.titrantKey,
    analyteKey: stage.analyteKey,
    catalog: stageCatalogKeys(stage),
    analytePortion: { ...stage.analytePortion },
    indicator: indicatorView(stage.indicator),
    burette: buretteView(stage.burette),
  };
}

function trialRulesView(config: TitrationExperimentConfig): PublicTrialRulesView {
  const rules = config.trialRules;
  const concordance = rules.concordance;
  // Resolved here so every reader of the public view sees one number, whether or
  // not the configuration chose to state a separate attempt cap.
  const maxTrialAttempts = maxTrialAttemptsFor(rules);
  if (concordance.mode === "molarity") {
    return {
      minTrials: rules.minTrials,
      maxTrials: rules.maxTrials,
      maxTrialAttempts,
      discardOnOvershoot: rules.discardOnOvershoot,
      concordance: {
        mode: "molarity",
        maxSpreadM: concordance.maxSpreadM,
        useClosestPairAverage: concordance.useClosestPairAverage,
      },
    };
  }
  return {
    minTrials: rules.minTrials,
    maxTrials: rules.maxTrials,
    maxTrialAttempts,
    discardOnOvershoot: rules.discardOnOvershoot,
    concordance: {
      mode: "titre_volume",
      toleranceMl: concordance.toleranceMl,
      minConcordantCount: concordance.minConcordantCount,
    },
  };
}

export function publicTitrationConfigView(
  config: TitrationExperimentConfig,
): PublicTitrationConfigView {
  return {
    experimentNumber: config.experimentNumber,
    nominalTitrantMolarityM: config.nominalTitrantMolarityM,
    solutionDilution: config.solutionDilution ? { ...config.solutionDilution } : null,
    stages: config.stages.map(stageView),
    trialRules: trialRulesView(config),
  };
}
