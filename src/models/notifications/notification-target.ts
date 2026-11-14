import { z } from "zod";
import { CommandIdSchema, FailureIdSchema, FingerprintSchema, PositiveIntSchema, RunIdSchema } from "../../rules/identity/ids.js";
import { BulkRunCommandOutcomeSchema, CommandRequestSchema, CommandResultSchema } from "../../rules/commands/commands.js";

/** Closed destinations resolved afresh from authority when the operator opens a row. */
export const NotificationTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run"), runId: RunIdSchema, day: z.iso.date() }),
  z.strictObject({ kind: z.literal("failure"), runId: RunIdSchema, failureId: FailureIdSchema, day: z.iso.date() }),
  z.strictObject({ kind: z.literal("archive"), runId: RunIdSchema, reportDigest: FingerprintSchema }),
  z.strictObject({ kind: z.literal("storage") }),
  /** The admitted command whose outcome is unknown; resending this exact request resumes it. */
  z.strictObject({ kind: z.literal("recovery"), commandId: CommandIdSchema, request: CommandRequestSchema }),
  z.strictObject({ kind: z.literal("command-result"), commandId: CommandIdSchema, day: z.iso.date().optional(), request: CommandRequestSchema, result: CommandResultSchema }),
  /** Child outcomes read back from the journal; `notAttempted` is the requested runs with no child row. */
  z.strictObject({
    kind: z.literal("bulk-result"),
    bulkCommandId: CommandIdSchema,
    type: z.enum(["retry", "pause", "resume", "cancel", "bump"]),
    requestedCount: PositiveIntSchema,
    results: z.array(BulkRunCommandOutcomeSchema),
    notAttempted: z.array(RunIdSchema),
    /** The partition day of each run that still exists, so a historical result opens its own day. */
    days: z.record(RunIdSchema, z.iso.date()),
  }),
  z.strictObject({ kind: z.literal("refused"), reason: z.enum(["wrong-actor", "notification-unavailable", "pinned", "run-unavailable", "failure-unavailable", "archive-unavailable", "target-unavailable"]) }),
]);
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
