import { z } from "zod";
import { titrationPublicStateSchema } from "./titration/schema";

/**
 * Runtime validation for persisted simulation state. `attempt_state.snapshot`
 * is jsonb, so anything could be in there (an older schema version, a manual
 * edit, a corrupt write). Parsing on read turns that into a clear error instead
 * of a mysterious crash deep inside an experiment.
 */
const selectedApparatusSchema = z.object({
  key: z.string(),
  mountedAt: z.string(),
  contents: z.array(z.string()),
});

const chemicalQuantitySchema = z.object({
  key: z.string(),
  amount: z.number(),
  unit: z.string(),
  vesselKey: z.string(),
});

const solutionVolumeSchema = z.object({
  vesselKey: z.string(),
  volumeMl: z.number().nonnegative(),
  species: z.array(z.string()),
});

const concentrationSchema = z.object({
  species: z.string(),
  molarity: z.number().nonnegative(),
});

const temperatureSchema = z.object({ celsius: z.number(), recordedAt: z.string() });

const colourSchema = z.object({
  vesselKey: z.string(),
  colour: z.string(),
  description: z.string(),
});

const precipitateSchema = z.object({
  vesselKey: z.string(),
  formula: z.string(),
  description: z.string(),
});

const measurementSchema = z.object({
  id: z.string().optional(),
  trialId: z.string().nullable().optional(),
  kind: z.enum([
    "titration_reading",
    "mass",
    "temperature",
    "conductivity",
    "volume",
    "colour",
    "other",
  ]),
  label: z.string(),
  value: z.number().finite(),
  unit: z.string(),
  recordedAt: z.string(),
  serverValidated: z.boolean().optional(),
  deviation: z.number().nonnegative().optional(),
});

const trialSchema = z.object({
  trialNumber: z.number().int().min(1),
  status: z.enum(["open", "recorded", "rejected"]),
  initialReading: z.number().nonnegative().optional(),
  finalReading: z.number().nonnegative().optional(),
  titreVolume: z.number().nonnegative().optional(),
  endpointObserved: z.boolean().optional(),
  rejectionReason: z.string().optional(),
});

const observationSchema = z.object({
  stepKey: z.string(),
  fieldKey: z.string(),
  textValue: z.string().optional(),
  choiceValue: z.string().optional(),
});

const calculationResultSchema = z.object({
  questionKey: z.string(),
  studentValue: z.number().finite(),
  unit: z.string(),
  isCorrect: z.boolean().optional(),
  attemptNumber: z.number().int().min(1),
});

const scoreEventSchema = z.object({
  ruleKey: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  points: z.number(),
  message: z.string(),
  at: z.string(),
});

const safetyEventSchema = scoreEventSchema.extend({
  recordedForInstructor: z.boolean(),
  blockedNextStep: z.boolean(),
});

export const simulationStateSchema = z.object({
  schemaVersion: z.number().int().min(1),
  currentStep: z.string(),
  apparatus: z.array(selectedApparatusSchema),
  chemicals: z.array(chemicalQuantitySchema),
  solutionVolumes: z.array(solutionVolumeSchema),
  concentrations: z.array(concentrationSchema),
  temperature: temperatureSchema.nullable(),
  colours: z.array(colourSchema),
  precipitates: z.array(precipitateSchema),
  measurements: z.array(measurementSchema),
  trials: z.array(trialSchema),
  observations: z.array(observationSchema),
  calculations: z.array(calculationResultSchema),
  safetyEvents: z.array(safetyEventSchema),
  score: z.object({
    awarded: z.number(),
    possible: z.number(),
    events: z.array(scoreEventSchema),
  }),
  titration: titrationPublicStateSchema.optional(),
});
