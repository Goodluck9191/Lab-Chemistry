import type { TitrationExperimentConfig } from "@/domain/simulation/titration/config";
import { exp02TitrationConfig } from "./exp-02-titration-config";

/**
 * Which experiments run on the generic titration engine, and with what
 * configuration. Kept in the catalog so experiment identity lives in exactly
 * one place; application code resolves through `titrationConfigForExperiment`
 * and treats a `null` as "not a titration experiment".
 */
const TITRATION_CONFIGS: Record<string, TitrationExperimentConfig> = {
  "exp-02": exp02TitrationConfig,
};

export function titrationConfigForExperiment(
  experimentId: string,
): TitrationExperimentConfig | null {
  return TITRATION_CONFIGS[experimentId] ?? null;
}
