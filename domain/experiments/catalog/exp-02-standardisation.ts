import { experimentDefinitionSchema } from "../schema";
import type { ExperimentDefinition } from "../types";

/**
 * Sample experiment used by Stage 1 to verify the architecture end to end
 * (student sees it -> starts an attempt -> the attempt is stored).
 *
 * CHEMISTRY NOTICE: every constant below is a plausible textbook value, not one
 * taken from the university practical manual. `accuracy: "assumed"` marks this
 * for verification against the manual. The titration engine and the hidden
 * per-attempt parameters are deliberately absent; they belong to a later stage.
 */
const definition = {
  id: "exp-02",
  number: 2,
  slug: "standardisation-of-naoh-with-khp",
  title: "Standardisation of sodium hydroxide solution using potassium hydrogen phthalate",
  description:
    "Standardise a sodium hydroxide solution against potassium hydrogen phthalate (KHP), an acid primary standard.",
  aim: "To determine the exact concentration of a sodium hydroxide solution by titration against weighed portions of potassium hydrogen phthalate, and to compare replicate titres for concordance.",
  theory:
    "Potassium hydrogen phthalate (KHC8H4O4, molar mass approximately 204.22 g/mol) is a monoprotic weak acid and a suitable primary standard: it is pure, stable, non-hygroscopic and of high molar mass, so weighing errors are small. Sodium hydroxide absorbs carbon dioxide from air and cannot be prepared to an exact concentration, so it must be standardised against a primary standard. The neutralisation is 1:1 (KHC8H4O4 + NaOH -> KNaC8H4O4 + H2O), so at the equivalence point the moles of NaOH equal the moles of KHP. Phenolphthalein is colourless in acid and pink in alkali, so a persistent pale pink marks the endpoint.",
  safety: [
    "Wear safety goggles and a laboratory coat at all times.",
    "Sodium hydroxide is corrosive: rinse skin contact immediately with plenty of water.",
    "Never pipette by mouth; always use a pipette filler.",
    "Handle the burette with care; it is fragile and expensive.",
    "Read every label before dispensing a reagent.",
  ],
  status: "published",
  orderIndex: 2,
  type: "titration",
  subtype: "acid_base",
  engine: {
    kind: "titration",
    family: "acid_base_strong_strong",
    parameters: {
      titrant: "NaOH",
      analyte: "KHP",
      stoichiometricRatio: 1,
      indicator: "phenolphthalein",
      requiredTrials: 3,
    },
  },
  procedure: [
    {
      stepNumber: 1,
      title: "Rinse and fill the burette",
      instruction:
        "Rinse the burette with a little of the sodium hydroxide solution, fill it, and expel air bubbles from the tip.",
      isRequired: true,
    },
    {
      stepNumber: 2,
      title: "Record the initial reading",
      instruction:
        "Read the bottom of the meniscus against a light background and record the initial burette reading to two decimal places.",
      isRequired: true,
    },
    {
      stepNumber: 3,
      title: "Weigh the primary standard",
      instruction:
        "Weigh accurately, by difference, between 0.4 g and 0.6 g of dried potassium hydrogen phthalate into a clean conical flask.",
      isRequired: true,
    },
    {
      stepNumber: 4,
      title: "Dissolve the standard",
      instruction:
        "Dissolve the weighed KHP in about 50 mL of distilled water and swirl until the solution is clear.",
      isRequired: true,
    },
    {
      stepNumber: 5,
      title: "Add the indicator",
      instruction: "Add two to three drops of phenolphthalein indicator to the flask.",
      isRequired: true,
    },
    {
      stepNumber: 6,
      title: "Titrate to the endpoint",
      instruction:
        "Titrate with sodium hydroxide, swirling continuously, until a pale pink colour persists for 30 seconds.",
      isRequired: true,
    },
    {
      stepNumber: 7,
      title: "Record the final reading and repeat",
      instruction:
        "Record the final burette reading, then repeat the titration until three concordant titres are obtained.",
      isRequired: true,
    },
  ],
  chemicals: [
    {
      key: "naoh",
      name: "Sodium hydroxide solution",
      formula: "NaOH",
      role: "titrant",
      concentration: 0.1,
      concentrationUnit: "mol/L",
      hazardCodes: ["H290", "H314"],
      isRequired: true,
    },
    {
      key: "khp",
      name: "Potassium hydrogen phthalate",
      formula: "KHC8H4O4",
      role: "primary_standard",
      hazardCodes: [],
      isRequired: true,
    },
    {
      key: "phenolphthalein",
      name: "Phenolphthalein indicator",
      formula: "C20H14O4",
      role: "indicator",
      concentration: 0.5,
      concentrationUnit: "% w/v",
      hazardCodes: [],
      isRequired: true,
    },
    {
      key: "distilled_water",
      name: "Distilled water",
      formula: "H2O",
      role: "solvent",
      hazardCodes: [],
      isRequired: true,
    },
  ],
  apparatus: [
    {
      key: "burette_50",
      name: "Burette, 50 mL",
      capacityMl: 50,
      graduationMl: 0.1,
      isRequired: true,
    },
    {
      key: "conical_flask_250",
      name: "Conical flask, 250 mL",
      capacityMl: 250,
      isRequired: true,
    },
    { key: "weighing_bottle", name: "Weighing bottle", isRequired: true },
    { key: "analytical_balance", name: "Analytical balance (0.1 mg)", isRequired: true },
    { key: "wash_bottle", name: "Wash bottle", isRequired: true },
  ],
  calculations: [
    {
      key: "moles_khp",
      prompt: "Calculate the moles of potassium hydrogen phthalate used in trial 1.",
      unit: "mol",
      decimalPlaces: 6,
      tolerance: { kind: "relative", value: 0.005 },
    },
    {
      key: "conc_naoh",
      prompt: "Calculate the concentration of the sodium hydroxide solution from trial 1.",
      unit: "mol/L",
      decimalPlaces: 4,
      tolerance: { kind: "relative", value: 0.01 },
    },
  ],
  observations: [
    {
      stepKey: "step-6",
      fieldKey: "colour_change",
      prompt: "Describe the colour change observed at the endpoint.",
      kind: "text",
      expectKeywords: ["pink", "colourless"],
      isRequired: true,
    },
  ],
  gradingRules: [
    { key: "apparatus_selection", category: "apparatus", points: 10,
      description: "Correct apparatus selected for each operation." },
    { key: "chemical_selection", category: "chemicals", points: 5,
      description: "Correct reagents and indicator chosen." },
    { key: "safety_compliance", category: "safety", points: 10,
      description: "No unsafe handling recorded." },
    { key: "sequence", category: "sequence", points: 10,
      description: "Operations performed in a valid order." },
    { key: "technique", category: "technique", points: 15,
      description: "Burette and flask handled correctly; readings recorded accurately." },
    { key: "endpoint", category: "endpoint", points: 20,
      description: "Endpoint detected within the accepted window." },
    { key: "concordance", category: "concordance", points: 10,
      description: "At least three trials agreeing within the concordance tolerance." },
    { key: "calculations", category: "calculations", points: 15,
      description: "Calculations correct within tolerance and to the required precision." },
    { key: "observations", category: "observations", points: 3,
      description: "Observations recorded and chemically plausible." },
    { key: "report", category: "report", points: 2, description: "Report complete." },
  ],
  configVersion: 1,
  accuracy: "assumed",
} satisfies ExperimentDefinition;

/**
 * Parsed at module load so an invalid definition fails fast in tests and at
 * build time rather than at an arbitrary moment during a student's experiment.
 */
export const exp02Standardisation = experimentDefinitionSchema.parse(definition);
