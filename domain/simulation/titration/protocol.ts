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
 *
 * v3 added the Experiment 2 preparation actions (burette cleaning and
 * conditioning, air-bubble removal, weighing by difference, dissolution,
 * transfer, beaker rinses, flask placement and waste disposal) for the
 * procedure-accurate laboratory: a stale bundle that cannot perform the
 * preparation is rejected the same way.
 *
 * v4 added Part I: the working titrant is measured from stock, diluted and
 * mixed before any burette work, and a portion of it is drawn into the beaker
 * the burette is served from.
 */
export const SIMULATION_PROTOCOL_VERSION = 4;

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
  // Part I: the working titrant is prepared from stock. These belong to the
  // ATTEMPT rather than to one titration stage — the same solution serves every
  // stage — so they carry the stage the student is working in only so the
  // envelope stays uniform and the stage-order rule still applies.
  z.object({
    type: z.literal("measure_naoh_stock"),
    stageKey: z.string().min(1).max(64),
    /** Volume of stock the student measured off the cylinder, in mL. */
    observedVolumeMl: positiveFinite.max(2000),
  }),
  z.object({
    type: z.literal("dilute_naoh_solution"),
    stageKey: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("mix_naoh_solution"),
    stageKey: z.string().min(1).max(64),
  }),
  // Experiment 2 preparation (Part 2): counted steps with server-side order.
  z.object({
    type: z.literal("obtain_naoh_portion"),
    stageKey: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("rinse_burette"),
    stageKey: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("condition_burette"),
    stageKey: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("clear_air_bubble"),
    stageKey: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("weigh_beaker"),
    stageKey: z.string().min(1).max(64),
    observedMassG: positiveFinite.max(1000),
  }),
  z.object({
    type: z.literal("dissolve_khp"),
    stageKey: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("transfer_solution"),
    stageKey: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("rinse_beaker"),
    stageKey: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("place_flask"),
    stageKey: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("discard_to_waste"),
    stageKey: z.string().min(1).max(64),
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
