import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHEMICAL_ROLES,
  EXPERIMENT_STATUSES,
  EXPERIMENT_TYPES,
  TITRATION_SUBTYPES,
  type ExperimentBriefing,
  type ExperimentSummary,
} from "@/domain/experiments";

/**
 * Rows are validated with Zod rather than trusted from a generated database
 * type: TypeScript types vanish at runtime, and a schema drift (a dropped
 * column, a renamed enum member) should fail loudly here instead of producing a
 * half-populated experiment in a student's lab.
 */
const experimentRowSchema = z.object({
  id: z.string(),
  experiment_number: z.number().int(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  aim: z.string(),
  theory: z.string(),
  safety: z.array(z.string()),
  type: z.enum(EXPERIMENT_TYPES),
  subtype: z.enum(TITRATION_SUBTYPES).nullable(),
  status: z.enum(EXPERIMENT_STATUSES),
  order_index: z.number().int(),
  config_version: z.number().int(),
  accuracy: z.enum(["assumed", "manual-verified"]),
});

const stepRowSchema = z.object({
  step_number: z.number().int(),
  title: z.string(),
  instruction: z.string(),
  is_required: z.boolean(),
});

const chemicalRowSchema = z.object({
  chemical_key: z.string(),
  name: z.string(),
  formula: z.string().nullable(),
  role: z.enum(CHEMICAL_ROLES),
  concentration: z.number().nullable(),
  concentration_unit: z.string().nullable(),
  hazard_codes: z.array(z.string()),
  is_required: z.boolean(),
});

const apparatusRowSchema = z.object({
  apparatus_key: z.string(),
  name: z.string(),
  capacity_ml: z.number().nullable(),
  graduation_ml: z.number().nullable(),
  is_required: z.boolean(),
});

const SUMMARY_COLUMNS =
  "id, experiment_number, slug, title, description, type, subtype, status, order_index, accuracy";

export async function listPublishedExperiments(
  client: SupabaseClient,
): Promise<ExperimentSummary[]> {
  const { data, error } = await client
    .from("experiments")
    .select(SUMMARY_COLUMNS)
    .eq("status", "published")
    .order("order_index", { ascending: true });

  if (error) throw new Error(`Failed to list experiments: ${error.message}`);

  return z.array(experimentRowSchema.pick({
    id: true,
    experiment_number: true,
    slug: true,
    title: true,
    description: true,
    type: true,
    subtype: true,
    status: true,
    order_index: true,
    accuracy: true,
  })).parse(data ?? []).map((row) => ({
    id: row.id,
    number: row.experiment_number,
    slug: row.slug,
    title: row.title,
    description: row.description,
    type: row.type,
    subtype: row.subtype,
    status: row.status,
    orderIndex: row.order_index,
    accuracy: row.accuracy,
  }));
}

export async function getExperimentBriefing(
  client: SupabaseClient,
  experimentId: string,
): Promise<ExperimentBriefing | null> {
  const { data: experiment, error } = await client
    .from("experiments")
    .select(
      "id, experiment_number, slug, title, description, aim, theory, safety, type, subtype, " +
        "status, order_index, config_version, accuracy",
    )
    .eq("id", experimentId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load experiment ${experimentId}: ${error.message}`);
  if (!experiment) return null;

  const parsed = experimentRowSchema.parse(experiment);

  const [steps, chemicals, apparatus] = await Promise.all([
    client
      .from("experiment_steps")
      .select("step_number, title, instruction, is_required")
      .eq("experiment_id", experimentId)
      .order("step_number", { ascending: true }),
    client
      .from("experiment_chemicals")
      .select("chemical_key, name, formula, role, concentration, concentration_unit, hazard_codes, is_required")
      .eq("experiment_id", experimentId),
    client
      .from("experiment_apparatus")
      .select("apparatus_key, name, capacity_ml, graduation_ml, is_required")
      .eq("experiment_id", experimentId),
  ]);

  for (const result of [steps, chemicals, apparatus]) {
    if (result.error) throw new Error(`Failed to load experiment detail: ${result.error.message}`);
  }

  return {
    id: parsed.id,
    number: parsed.experiment_number,
    slug: parsed.slug,
    title: parsed.title,
    description: parsed.description,
    aim: parsed.aim,
    theory: parsed.theory,
    safety: parsed.safety,
    type: parsed.type,
    subtype: parsed.subtype,
    status: parsed.status,
    orderIndex: parsed.order_index,
    configVersion: parsed.config_version,
    accuracy: parsed.accuracy,
    procedure: z.array(stepRowSchema).parse(steps.data ?? []).map((row) => ({
      stepNumber: row.step_number,
      title: row.title,
      instruction: row.instruction,
      isRequired: row.is_required,
    })),
    chemicals: z.array(chemicalRowSchema).parse(chemicals.data ?? []).map((row) => ({
      key: row.chemical_key,
      name: row.name,
      formula: row.formula ?? undefined,
      role: row.role,
      concentration: row.concentration ?? undefined,
      concentrationUnit: row.concentration_unit ?? undefined,
      hazardCodes: row.hazard_codes,
      isRequired: row.is_required,
    })),
    apparatus: z.array(apparatusRowSchema).parse(apparatus.data ?? []).map((row) => ({
      key: row.apparatus_key,
      name: row.name,
      capacityMl: row.capacity_ml ?? undefined,
      graduationMl: row.graduation_ml ?? undefined,
      isRequired: row.is_required,
    })),
  };
}
