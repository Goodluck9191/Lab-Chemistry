import type { LabStateView } from "@/application/attempts/lab-state";
import { exp02Standardisation } from "@/domain/experiments/catalog/exp-02-standardisation";
import { publicTitrationConfigView } from "@/domain/simulation/titration/public-view";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { toPublicJSON, type TitrationSession } from "@/domain/simulation/titration/engine";
import { projectExperimentWorkflow } from "@/domain/simulation/titration/workflow";
import { molarMassForChemical } from "@/domain/chemistry/molar-masses";

/**
 * Build a `LabStateView` shaped exactly like the server's, from a session the
 * tests control.
 *
 * Only TYPES are imported from the server module (`import type` is erased), so a
 * jsdom component test never pulls `server-only`, Supabase or Next runtime code
 * into the browser environment. The literal below mirrors `getLabState`, and the
 * security suite compares its keys against the hidden-value denylist.
 */
export function labStateViewFor(
  session: TitrationSession,
  {
    attemptId = "123e4567-e89b-12d3-a456-426614174000",
    experimentId = "exp-02",
    canWrite = true,
    revision = 4,
    chemicalLabels = {
      naoh: "Sodium hydroxide solution",
      khp: "Potassium hydrogen phthalate",
      phenolphthalein: "Phenolphthalein indicator",
      distilled_water: "Distilled water",
    },
    apparatusLabels = {
      burette_50: "Burette, 50 mL",
      conical_flask_250: "Conical flask, 250 mL",
      weighing_bottle: "Weighing bottle",
      analytical_balance: "Analytical balance (0.1 mg)",
      wash_bottle: "Wash bottle",
    },
    notices = [],
    report = null,
  }: {
    attemptId?: string;
    experimentId?: string;
    canWrite?: boolean;
    revision?: number;
    chemicalLabels?: Record<string, string>;
    apparatusLabels?: Record<string, string>;
    notices?: string[];
    report?: LabStateView["report"];
  } = {},
): LabStateView {
  const config = publicTitrationConfigView(exp02TitrationConfig);
  const publicState = toPublicJSON(session);
  const declaredObservations = exp02Standardisation.observations.map((observation) => ({
    stepKey: observation.stepKey,
    fieldKey: observation.fieldKey,
    prompt: observation.prompt,
    kind: observation.kind,
    isRequired: observation.isRequired,
  }));

  return {
    attemptId,
    experimentId,
    experimentNumber: exp02Standardisation.number,
    experimentTitle: exp02Standardisation.title,
    attemptStatus: canWrite ? "in_progress" : "submitted",
    attemptStatusLabel: canWrite ? "In Progress" : "Submitted",
    canWrite,
    revision,
    accuracy: "manual-verified",
    chemicalLabels,
    apparatusLabels,
    config,
    publicState,
    workflow: projectExperimentWorkflow(
      config,
      publicState,
      declaredObservations
        .filter((field) => field.isRequired)
        .map((field) => ({ fieldKey: field.fieldKey, prompt: field.prompt })),
    ),
    report: report ?? null,
    procedure: exp02Standardisation.procedure.map((step) => ({ ...step })),
    declaredObservations,
    ungradedCalculations: exp02Standardisation.calculations.map((calculation) => ({
      key: calculation.key,
      prompt: calculation.prompt,
      unit: calculation.unit,
      decimalPlaces: calculation.decimalPlaces,
    })),
    calculationPrompts: config.stages.flatMap((stage) => {
      const session = publicState.stages[stage.key];
      return (session?.trials ?? [])
        .filter((trial) => trial.status === "recorded")
        .map((trial) => ({
          questionKey: `${stage.key}__molarity_trial_${trial.trialNumber}`,
          stageKey: stage.key,
          stageTitle: stage.title,
          trialNumber: trial.trialNumber,
          label: `Concentration of the titrant (${stage.titrantKey}) from ${stage.title}, trial ${trial.trialNumber}`,
          unit: "mol/L",
        }));
    }),
    formulaGuidance: config.stages.map((stage) => ({
      stageKey: stage.key,
      stageTitle: stage.title,
      reactionEquation: stage.reactionEquation,
      stoichiometry: { ...stage.stoichiometry },
      analyteKey: stage.analyteKey,
      titrantKey: stage.titrantKey,
      analyteMolarMassGPerMol:
        stage.analytePortion.kind === "weighed_mass"
          ? molarMassForChemical(stage.analyteKey)
          : null,
    })),
    notices,
  };
}
