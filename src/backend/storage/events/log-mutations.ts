import { z } from "zod";
import { TimelineEventRecordSchema } from "../../../models/events/timeline.js";
import { RunIdSchema } from "../../../rules/identity/ids.js";

export const LOG_DATABASE_NAMES = Object.freeze(["timeline", "dashboard"] as const);
export const PROFILE_LOG_FILES = Object.freeze(LOG_DATABASE_NAMES.flatMap(name =>
  ["", "-wal", "-shm", "-journal"].map(suffix => `${name}.db${suffix}`)));

export const MirrorLogRecordSchema = TimelineEventRecordSchema.refine(
  record => record.payload.kind !== "operation-confirmed",
  { message: "operation-confirmed is state evidence" },
);
export const LogMutationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("append"), row: MirrorLogRecordSchema }),
  z.strictObject({ kind: z.literal("remove"), table: z.enum(["timeline_events", "debug_events"]),
    cursors: z.array(z.number().int().positive()).min(1) }),
  z.strictObject({ kind: z.literal("purge-runs"), runIds: z.array(RunIdSchema).min(1) }),
]);
export type LogMutation = z.infer<typeof LogMutationSchema>;

export class WorkerLogChannelError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "worker-log-channel-failed", { cause });
    this.name = "WorkerLogChannelError";
  }
}

const sequence = z.number().int().positive();
export const LogWriterRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("append"), sequence, mutation: LogMutationSchema }),
  z.strictObject({ kind: z.enum(["flush", "reconcile", "close"]), sequence }),
]);
export type LogWriterRequest = z.infer<typeof LogWriterRequestSchema>;
export const LogWriterReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ready") }),
  z.strictObject({ kind: z.literal("committed"), through: sequence }),
]);
export const LogWriterStartSchema = z.strictObject({ statePath: z.string().min(1), root: z.string().min(1), maxWaitMs: z.number().int().positive() });
