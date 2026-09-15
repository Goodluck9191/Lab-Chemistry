import type { AssessmentCategory, ChemicalRole } from "./types";

/** Experiment runtimes. Adding a new experiment of an existing kind must not
 * require engine changes anywhere in the system. */
export const EXPERIMENT_TYPES = ["titration", "gravimetric", "synthesis", "conductometry"] as const;

/** Only meaningful when type === "titration". */
export const TITRATION_SUBTYPES = ["acid_base", "redox", "precipitation", "complexometric"] as const;

export const EXPERIMENT_STATUSES = ["draft", "published", "archived"] as const;

export const CHEMICAL_ROLES = [
  "titrant",
  "analyte",
  "indicator",
  "reagent",
  "primary_standard",
  "solvent",
  "wash",
  "drying_agent",
  "other",
] as const satisfies readonly ChemicalRole[];

export const ASSESSMENT_CATEGORIES = [
  "apparatus",
  "chemicals",
  "safety",
  "sequence",
  "technique",
  "endpoint",
  "concordance",
  "calculations",
  "observations",
  "report",
] as const satisfies readonly AssessmentCategory[];

export const EXPERIMENT_TYPE_LABELS: Record<(typeof EXPERIMENT_TYPES)[number], string> = {
  titration: "Titration",
  gravimetric: "Gravimetric analysis",
  synthesis: "Chemical synthesis",
  conductometry: "Conductometry",
};

export const TITRATION_SUBTYPE_LABELS: Record<(typeof TITRATION_SUBTYPES)[number], string> = {
  acid_base: "Acid-base",
  redox: "Redox",
  precipitation: "Precipitation",
  complexometric: "Complexometric",
};

export const ASSESSMENT_CATEGORY_LABELS: Record<AssessmentCategory, string> = {
  apparatus: "Apparatus selection",
  chemicals: "Chemical selection",
  safety: "Safety",
  sequence: "Sequence of operations",
  technique: "Technique",
  endpoint: "Endpoint detection",
  concordance: "Concordance of trials",
  calculations: "Calculations",
  observations: "Observations",
  report: "Report",
};

/** Points across all grading rules must total exactly this. */
export const TOTAL_GRADE_POINTS = 100;
