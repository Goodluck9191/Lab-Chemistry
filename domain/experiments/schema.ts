import { z } from "zod";
import {
  ASSESSMENT_CATEGORIES,
  CHEMICAL_ROLES,
  EXPERIMENT_STATUSES,
  EXPERIMENT_TYPES,
  TITRATION_SUBTYPES,
  TOTAL_GRADE_POINTS,
} from "./constants";

export const procedureStepSchema = z.object({
  stepNumber: z.number().int().min(1),
  title: z.string().min(1).max(200),
  instruction: z.string().min(1).max(4000),
  isRequired: z.boolean(),
});

export const chemicalSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  formula: z.string().max(120).optional(),
  role: z.enum(CHEMICAL_ROLES),
  concentration: z.number().nonnegative().optional(),
  concentrationUnit: z.string().max(24).optional(),
  hazardCodes: z.array(z.string().max(24)),
  isRequired: z.boolean(),
});

export const apparatusSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  capacityMl: z.number().positive().optional(),
  graduationMl: z.number().positive().optional(),
  isRequired: z.boolean(),
});

export const calculationSchema = z.object({
  key: z.string().min(1).max(64),
  prompt: z.string().min(1).max(600),
  unit: z.string().min(1).max(24),
  decimalPlaces: z.number().int().min(0).max(8),
  tolerance: z.object({
    kind: z.enum(["relative", "absolute"]),
    value: z.number().positive(),
  }),
});

export const observationSchema = z.object({
  stepKey: z.string().min(1).max(64),
  fieldKey: z.string().min(1).max(64),
  prompt: z.string().min(1).max(400),
  kind: z.enum(["text", "choice"]),
  expectKeywords: z.array(z.string().max(60)).optional(),
  choices: z.array(z.string().max(120)).optional(),
  isRequired: z.boolean(),
});

export const gradingRuleSchema = z.object({
  key: z.string().min(1).max(64),
  category: z.enum(ASSESSMENT_CATEGORIES),
  points: z.number().nonnegative().max(100),
  description: z.string().min(1).max(400),
});

const baseDefinitionSchema = z.object({
  id: z.string().regex(/^exp-\d{2}$/, { error: "experiment id must look like exp-02" }),
  number: z.number().int().min(1).max(99),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: "slug must be kebab-case" }),
  title: z.string().min(3).max(300),
  description: z.string().max(2000),
  aim: z.string().min(1).max(2000),
  theory: z.string().min(1).max(20000),
  safety: z.array(z.string().min(1).max(500)).min(1),
  status: z.enum(EXPERIMENT_STATUSES),
  orderIndex: z.number().int().min(0).max(999),
  engine: z.object({
    kind: z.enum(EXPERIMENT_TYPES),
    family: z.string().min(1).max(64),
    parameters: z.record(z.string(), z.unknown()),
  }),
  procedure: z.array(procedureStepSchema).min(1),
  chemicals: z.array(chemicalSchema).min(1),
  apparatus: z.array(apparatusSchema).min(1),
  calculations: z.array(calculationSchema).min(1),
  observations: z.array(observationSchema),
  gradingRules: z.array(gradingRuleSchema).min(1),
  configVersion: z.number().int().min(1),
  accuracy: z.enum(["assumed", "manual-verified"]),
});

export const experimentDefinitionSchema = z
  .discriminatedUnion("type", [
    baseDefinitionSchema.extend({ type: z.literal("titration"), subtype: z.enum(TITRATION_SUBTYPES) }),
    baseDefinitionSchema.extend({ type: z.literal("gravimetric"), subtype: z.null() }),
    baseDefinitionSchema.extend({ type: z.literal("synthesis"), subtype: z.null() }),
    baseDefinitionSchema.extend({ type: z.literal("conductometry"), subtype: z.null() }),
  ])
  .refine((definition) => definition.engine.kind === definition.type, {
    error: "engine.kind must match the experiment type",
    path: ["engine", "kind"],
  })
  .refine(
    (definition) =>
      definition.gradingRules.reduce((total, rule) => total + rule.points, 0) === TOTAL_GRADE_POINTS,
    {
      error: `grading rule points must total exactly ${TOTAL_GRADE_POINTS}`,
      path: ["gradingRules"],
    },
  )
  .refine(
    (definition) =>
      new Set(definition.procedure.map((step) => step.stepNumber)).size ===
      definition.procedure.length,
    { error: "procedure step numbers must be unique", path: ["procedure"] },
  );

export type ExperimentDefinitionInput = z.input<typeof experimentDefinitionSchema>;
