import { experimentDefinitionSchema } from "../schema";
import type { ExperimentDefinition } from "../types";

/**
 * Experiment 2 catalog definition: ACID-BASE TITRATION — STANDARDIZATION OF
 * ACID AND BASE SOLUTIONS (Parts I-III of the supplied practical procedure).
 *
 * The procedure, chemicals and apparatus below mirror supabase/seed.sql by
 * hand until the config-to-database seeder exists; the Phase 4.8 migration
 * carries the same repair for databases seeded earlier.
 *
 * CHEMISTRY NOTICE: constants that the supplied procedure does not state
 * (e.g. dilution volumes, cylinder size) are NOT invented here: quantities
 * the source leaves unspecified stay out, and `accuracy: "assumed"` marks
 * this for verification against the manual.
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
      title: "Measure the 2 M NaOH stock",
      instruction:
        "Using a measuring cylinder, measure out the 2 M NaOH stock solution for dilution to approximately 0.2 M.",
      isRequired: true,
    },
    {
      stepNumber: 2,
      title: "Dilute to approximately 0.2 M NaOH",
      instruction:
        "Transfer the measured stock to a clean flask and add distilled water to complete the dilution.",
      isRequired: true,
    },
    {
      stepNumber: 3,
      title: "Swirl to mix",
      instruction:
        "Stopper the flask as much as possible and swirl to mix the contents thoroughly.",
      isRequired: true,
    },
    {
      stepNumber: 4,
      title: "Clean the burette",
      instruction:
        "Rinse the burette with several portions of about 10 mL tap water and drain.",
      isRequired: true,
    },
    {
      stepNumber: 5,
      title: "Obtain NaOH in a beaker",
      instruction:
        "Obtain about 120 mL of the prepared NaOH solution in a clean, dry 250 mL beaker and cover with a watch glass.",
      isRequired: true,
    },
    {
      stepNumber: 6,
      title: "Condition the burette",
      instruction:
        "Rinse the burette with three portions of about 5 mL of the NaOH solution, draining each portion.",
      isRequired: true,
    },
    {
      stepNumber: 7,
      title: "Fill the burette",
      instruction:
        "Fill the burette with the prepared NaOH to slightly above the zero mark and clamp the burette vertically.",
      isRequired: true,
    },
    {
      stepNumber: 8,
      title: "Remove air bubbles",
      instruction:
        "Drain NaOH through the tip into a small beaker until no air bubbles remain.",
      isRequired: true,
    },
    {
      stepNumber: 9,
      title: "Record the initial burette reading",
      instruction:
        "Read the bottom of the meniscus to within ±0.02 mL and record the initial reading to two decimal places.",
      isRequired: true,
    },
    {
      stepNumber: 10,
      title: "Weigh the empty beaker",
      instruction:
        "Weigh a clean and dry 250 mL beaker on the analytical balance to ±0.01 g and record the mass.",
      isRequired: true,
    },
    {
      stepNumber: 11,
      title: "Add KHP and re-weigh",
      instruction:
        "Add about 0.6 g of dried KHP to the beaker and re-weigh to ±0.01 g. The sample mass is the difference of the two weighings.",
      isRequired: true,
    },
    {
      stepNumber: 12,
      title: "Dissolve the KHP",
      instruction:
        "Add about 30 mL distilled water to the beaker and stir with a glass rod until the solution is clear.",
      isRequired: true,
    },
    {
      stepNumber: 13,
      title: "Transfer to the Erlenmeyer flask",
      instruction:
        "Transfer the KHP solution into a clean 250 mL Erlenmeyer flask.",
      isRequired: true,
    },
    {
      stepNumber: 14,
      title: "Rinse the beaker twice",
      instruction:
        "Rinse the beaker twice with about 5 mL distilled water, transferring each rinse into the flask.",
      isRequired: true,
    },
    {
      stepNumber: 15,
      title: "Add phenolphthalein",
      instruction:
        "Add 3 to 4 drops of phenolphthalein indicator to the flask.",
      isRequired: true,
    },
    {
      stepNumber: 16,
      title: "Place the flask under the burette",
      instruction:
        "Place the flask on the white tile, aligned under the burette tip.",
      isRequired: true,
    },
    {
      stepNumber: 17,
      title: "Titrate with swirling",
      instruction:
        "Add NaOH from the burette with continuous swirling until a faint pink colour appears.",
      isRequired: true,
    },
    {
      stepNumber: 18,
      title: "Observe the endpoint",
      instruction:
        "The faint pink must persist 45 to 60 seconds, with a one-drop difference between colourless and pink. An overshot endpoint is discarded and repeated.",
      isRequired: true,
    },
    {
      stepNumber: 19,
      title: "Record the final burette reading",
      instruction:
        "Read the bottom of the meniscus to within ±0.02 mL and record the final reading to two decimal places.",
      isRequired: true,
    },
    {
      stepNumber: 20,
      title: "Discard into the waste container",
      instruction:
        "Discard the flask contents into the waste container so the next trial starts clean.",
      isRequired: true,
    },
    {
      stepNumber: 21,
      title: "Repeat the titration",
      instruction:
        "Repeat for three trials. Perform a fourth titration if the calculated molarities vary by more than 0.005 M.",
      isRequired: true,
    },
    {
      stepNumber: 22,
      title: "Calculate the NaOH molarity",
      instruction:
        "Calculate the NaOH molarity for each valid trial and average the two closest values.",
      isRequired: true,
    },
    {
      stepNumber: 23,
      title: "Refill and zero the burette",
      instruction:
        "Refill the burette with the standardized NaOH and prepare it for the HCl determination.",
      isRequired: true,
    },
    {
      stepNumber: 24,
      title: "Record the initial NaOH reading",
      instruction:
        "Read the bottom of the meniscus to within ±0.02 mL and record to two decimal places.",
      isRequired: true,
    },
    {
      stepNumber: 25,
      title: "Measure the HCl aliquot",
      instruction:
        "Using the measuring cylinder, transfer approximately 25.00 mL of the unknown HCl solution into a clean, dry flask.",
      isRequired: true,
    },
    {
      stepNumber: 26,
      title: "Record the HCl volume",
      instruction:
        "Record the actual delivered HCl volume, known to two decimal places.",
      isRequired: true,
    },
    {
      stepNumber: 27,
      title: "Add phenolphthalein to the HCl",
      instruction:
        "Add 3 to 4 drops of phenolphthalein indicator to the flask.",
      isRequired: true,
    },
    {
      stepNumber: 28,
      title: "Titrate the HCl to the endpoint",
      instruction:
        "Place the flask under the NaOH burette and titrate with swirling to the faint pink endpoint.",
      isRequired: true,
    },
    {
      stepNumber: 29,
      title: "Record the final NaOH reading",
      instruction:
        "Read the bottom of the meniscus to within ±0.02 mL and record to two decimal places.",
      isRequired: true,
    },
    {
      stepNumber: 30,
      title: "Discard, repeat and calculate HCl",
      instruction:
        "Discard into waste. Repeat for three trials (a fourth if the spread exceeds 0.005 M), average the two closest HCl molarities, and note the measurement uncertainties.",
      isRequired: true,
    },
  ],
  chemicals: [
    {
      key: "naoh",
      name: "Sodium hydroxide working solution (~0.2 M)",
      formula: "NaOH",
      role: "titrant",
      concentration: 0.2,
      concentrationUnit: "mol/L",
      hazardCodes: ["H290", "H314"],
      isRequired: true,
    },
    {
      key: "naoh_stock_2m",
      name: "Sodium hydroxide stock solution (2 M)",
      formula: "NaOH",
      role: "reagent",
      concentration: 2,
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
      key: "hcl_unknown",
      name: "Unknown hydrochloric acid solution",
      formula: "HCl",
      role: "analyte",
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
    {
      key: "tap_water",
      name: "Tap water",
      formula: "H2O",
      role: "wash",
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
    { key: "beaker_250", name: "Beaker, 250 mL", capacityMl: 250, isRequired: true },
    { key: "glass_rod", name: "Glass stirring rod", isRequired: true },
    { key: "watch_glass", name: "Watch glass", isRequired: true },
    { key: "graduated_cylinder", name: "Graduated cylinder", isRequired: true },
    { key: "waste_container", name: "Waste container", isRequired: true },
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
