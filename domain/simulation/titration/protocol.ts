/**
 * Simulation action protocol: the versioned envelope every client action
 * travels in, whether it arrives via server action or a future realtime
 * channel.
 *
 * The envelope carries the attempt id, the snapshot revision the client based
 * its action on (optimistic concurrency for autosave), and exactly one engine
 * action with server-validated parameters. The server re-validates everything:
 * identity comes from the session, hidden truth from `attempt_secrets`, and
 * scores/expected answers are never accepted from the client.
 */
import { z } from "zod";

/**
 * Bump when the envelope or action set changes so old clients fail loudly.
 *
 * v2 added `record_observation` for the Phase 4 laboratory: a stale client
 * bundle sending v1 is rejected with a clear parse error and reloads, instead
 * of streaming actions the server can no longer interpret.
 */
export const SIMULATION_PROTOCOL_VERSION = 2;

const positiveFinite = z.number().finite().positive();

export const titrationActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setup_apparatus"),
    stageKey: z.string().min(1).max(64),
    titrantKey: z.string().min(1).max(64),
    initialReadingMl: z.number().finite().min(0).max(200),
  }),
  z.object({
    type: z.literal("weigh_analyte"),
    stageKey: z.string().min(1).max(64),
    observedMassG: positiveFinite.max(1000),
  }),
  z.object({
    type: z.literal("pipette_analyte"),
    stageKey: z.string().min(1).max(64),
    observedVolumeMl: positiveFinite.max(1000),
  }),
  z.object({
    type: z.literal("add_indicator"),
    stageKey: z.string().min(1).max(64),
    drops: z.number().int().min(1).max(20),
  }),
  z.object({
    type: z.literal("start_trial"),
    stageKey: z.string().min(1).max(64),
    trialNumber: z.number().int().min(1).max(20),
    initialReadingMl: z.number().finite().min(0).max(200),
  }),
  z.object({
    type: z.literal("add_titrant"),
    stageKey: z.string().min(1).max(64),
    volumeMl: positiveFinite.max(60),
  }),
  z.object({
    type: z.literal("read_burette"),
    stageKey: z.string().min(1).max(64),
    observedFinalMl: z.number().finite().min(0).max(200),
  }),
  z.object({
    type: z.literal("observe_endpoint"),
    stageKey: z.string().min(1).max(64),
    claimedColour: z.enum(["colourless", "faint_pink", "pink", "deep_pink"]),
  }),
  z.object({
    type: z.literal("complete_trial"),
    stageKey: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("report_molarity"),
    stageKey: z.string().min(1).max(64),
    trialNumber: z.number().int().min(1).max(20),
    studentMolarityM: positiveFinite.max(50),
  }),
  z.object({
    type: z.literal("record_observation"),
    stageKey: z.string().min(1).max(64),
    fieldKey: z.string().regex(/^[a-z0-9_]{3,64}$/),
    text: z.string().min(1).max(2000),
  }),
]);

export type TitrationProtocolAction = z.infer<typeof titrationActionSchema>;

export const titrationEnvelopeSchema = z.object({
  protocolVersion: z.literal(SIMULATION_PROTOCOL_VERSION),
  attemptId: z.uuid(),
  /** Snapshot revision the client saw when it issued the action. */
  baseRevision: z.number().int().min(0),
  action: titrationActionSchema,
});

export type TitrationEnvelope = z.infer<typeof titrationEnvelopeSchema>;

/** Parse an untrusted envelope; throws a plain Error with the first issue. */
export function parseTitrationEnvelope(input: unknown): TitrationEnvelope {
  const parsed = titrationEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`invalid simulation action: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  return parsed.data;
}
