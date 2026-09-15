import { z } from "zod";
import { ATTEMPT_STATUSES } from "@/domain/attempts";

/**
 * Boundary schemas. Everything crossing from the browser into the server is
 * parsed with one of these before it reaches a use case, because TypeScript
 * types do not exist at runtime: a request body is untrusted input, not a
 * `StartAttemptInput`.
 */
export const experimentIdSchema = z
  .string()
  .regex(/^exp-\d{2}$/, { error: "Experiment id must look like exp-02" });

export const attemptIdSchema = z.uuid({ error: "Attempt id must be a UUID" });

export const attemptStatusSchema = z.enum(ATTEMPT_STATUSES);

export const startAttemptInputSchema = z.object({
  experimentId: experimentIdSchema,
});

export type StartAttemptInput = z.infer<typeof startAttemptInputSchema>;

/**
 * A measurement recorded by a student. Bounds mirror the database CHECK
 * constraints, so an out-of-range reading is rejected with a clear message
 * rather than a Postgres error.
 */
export const measurementInputSchema = z.object({
  attemptId: attemptIdSchema,
  trialId: attemptIdSchema.nullable().optional(),
  kind: z.enum([
    "titration_reading",
    "mass",
    "temperature",
    "conductivity",
    "volume",
    "colour",
    "other",
  ]),
  label: z.string().trim().max(120).default(""),
  value: z.number().finite().min(-1_000_000).max(1_000_000),
  unit: z.string().trim().min(1).max(24),
  recordedAt: z.iso.datetime().optional(),
});

export type MeasurementInput = z.infer<typeof measurementInputSchema>;

/** A student's report. Lengths mirror the report table's CHECK constraints. */
export const reportInputSchema = z.object({
  attemptId: attemptIdSchema,
  aim: z.string().max(20_000),
  procedure: z.string().max(40_000),
  resultsSummary: z.string().max(20_000),
  conclusion: z.string().max(20_000),
  safetyNotes: z.string().max(10_000),
});

export type ReportInput = z.infer<typeof reportInputSchema>;

/** Trial recording payload (used once the simulation engine arrives). */
export const trialInputSchema = z.object({
  attemptId: attemptIdSchema,
  trialNumber: z.number().int().min(1).max(20),
  initialReading: z.number().min(0).max(100).optional(),
  finalReading: z.number().min(0).max(100).optional(),
  endpointObserved: z.boolean().optional(),
  rejectionReason: z.string().trim().max(500).optional(),
});

export type TrialInput = z.infer<typeof trialInputSchema>;
