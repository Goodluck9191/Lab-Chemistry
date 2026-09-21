import type { PublicTitrationConfigView } from "@/domain/simulation/titration/public-view";

/**
 * The public catalog and the simulation configuration are two descriptions of
 * one experiment, kept in two places on purpose: the catalog is the inventory the
 * university publishes (reagent names, strengths, ware), the configuration is
 * what the laboratory actually simulates. When they disagree the student is told
 * — as a fact about the two sources, never as invented chemistry.
 *
 * Kept free of server imports so the comparison can be tested on its own.
 */

/** The parts of a briefing this comparison reads: the catalog's keys. */
export interface CatalogCoverageSources {
  chemicals: Array<{ key: string }>;
  apparatus: Array<{ key: string }>;
}

/**
 * Compare the public catalog with the simulation configuration and describe any
 * mismatch in plain language. Nothing is invented: every notice is a fact about
 * the two sources this attempt actually runs on.
 */
export function catalogNotices(
  briefing: CatalogCoverageSources,
  config: PublicTitrationConfigView,
): string[] {
  const notices: string[] = [];
  const chemicalKeys = new Set(briefing.chemicals.map((chemical) => chemical.key));
  const missingChemicals = new Set<string>();
  const missingApparatus = new Set<string>();

  // Part I draws on a stock solution as well as the working titrant.
  if (config.solutionDilution && !chemicalKeys.has(config.solutionDilution.stockKey)) {
    missingChemicals.add(config.solutionDilution.stockKey);
  }

  for (const stage of config.stages) {
    // `catalog` holds the CATALOG's keys for this stage's reagents — the same
    // keys unless the configuration maps them (chemistry names one reagent
    // `hcl`, the inventory calls it `hcl_unknown`). Comparing the catalog keys
    // is what keeps this notice a fact about a missing row rather than a
    // vocabulary mismatch.
    if (!chemicalKeys.has(stage.catalog.titrantKey)) {
      missingChemicals.add(stage.catalog.titrantKey);
    }
    if (!chemicalKeys.has(stage.catalog.analyteKey)) {
      missingChemicals.add(stage.catalog.analyteKey);
    }
    // `vessel` is an apparatus key, so the check is exact: if the experiment
    // does not list the ware its stage uses, the student is told.
    const portion = stage.analytePortion;
    if (
      portion.kind === "pipetted_volume" &&
      !briefing.apparatus.some((item) => item.key === portion.vessel)
    ) {
      missingApparatus.add(portion.vessel);
    }
  }

  if (missingChemicals.size > 0) {
    notices.push(
      `The public experiment catalog does not list these reagents, which the simulation for this experiment uses: ${[
        ...missingChemicals,
      ].join(", ")}. The laboratory uses the manual-verified titration configuration; the catalog entry has not been updated to match.`,
    );
  }
  if (missingApparatus.size > 0) {
    notices.push(
      `The public experiment catalog does not list the apparatus this stage needs (${[
        ...missingApparatus,
      ].join(", ")}). It is drawn on the bench from the titration configuration.`,
    );
  }
  return notices;
}
