import { z } from "zod";
import { ConfirmedActionEventSchema } from "../events/confirmed-action.js";
import { DashboardStreamEnvelopeSchema } from "./subscription.js";
import { RunIdSchema } from "../../rules/identity/ids.js";

export const CompositeCursorSchema = z.string().regex(/^mc:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{64}:(?:0|[1-9]\d*)$/u)
  .refine(cursor => Number.isSafeInteger(Number(cursor.slice(cursor.lastIndexOf(":") + 1))),
    "composite cursor ordinal must be a safe integer");
export const RunLogsSnapshotSchema = z.strictObject({
  runId: RunIdSchema,
  events: z.array(ConfirmedActionEventSchema).max(200),
  hasEarlier: z.boolean(),
});
export const CompositeStreamEnvelopeSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("control"), transportCursor: CompositeCursorSchema,
    type: z.enum(["hello", "reset-required", "health"]),
    reason: z.enum(["cursor-expired", "generation-changed", "topic-changed", "overflow"]).optional(),
    state: z.enum(["live", "recovering", "degraded"]).optional() }),
  z.strictObject({ source: z.literal("dashboard-day"), transportCursor: CompositeCursorSchema,
    envelope: DashboardStreamEnvelopeSchema }),
  z.strictObject({ source: z.literal("run-logs"), transportCursor: CompositeCursorSchema,
    type: z.enum(["snapshot", "delta"]), runId: RunIdSchema,
    snapshot: RunLogsSnapshotSchema.optional(), event: ConfirmedActionEventSchema.optional() }),
]).superRefine((message, context) => {
  if (message.source === "control") {
    if (message.type === "reset-required" ? message.reason === undefined : message.reason !== undefined) {
      context.addIssue({ code: "custom", message: "reset reason mismatch" });
    }
    if (message.type === "health" ? message.state === undefined : message.state !== undefined) {
      context.addIssue({ code: "custom", message: "health state mismatch" });
    }
  }
  if (message.source === "run-logs") {
    if (message.type === "snapshot" ? message.snapshot === undefined || message.event !== undefined
      : message.event === undefined || message.snapshot !== undefined) {
      context.addIssue({ code: "custom", message: "run logs payload mismatch" });
    }
    if (message.snapshot !== undefined && message.snapshot.runId !== message.runId
      || message.event !== undefined && message.event.action.runId !== message.runId) {
      context.addIssue({ code: "custom", message: "run logs owner mismatch" });
    }
  }
});
export type CompositeStreamEnvelope = z.infer<typeof CompositeStreamEnvelopeSchema>;

/** Apply one bounded snapshot/delta stream; identities beat wall-clock ties. */
export interface RunLogsMergeState {
  readonly runId: string;
  readonly events: readonly z.infer<typeof ConfirmedActionEventSchema>[];
  readonly hasEarlier: boolean;
}

export function emptyRunLogsMergeState(runId: string): RunLogsMergeState {
  return { runId: RunIdSchema.parse(runId), events: [], hasEarlier: false };
}

export function mergeRunLogs(
  current: RunLogsMergeState,
  change: Readonly<{ type: "snapshot"; runId: string; events: readonly z.infer<typeof ConfirmedActionEventSchema>[]; hasEarlier: boolean }>
    | Readonly<{ type: "delta"; runId: string; event: z.infer<typeof ConfirmedActionEventSchema> }>,
): RunLogsMergeState {
  if (RunIdSchema.parse(change.runId) !== current.runId) throw new Error("run-log-selection-mismatch");
  const candidates = change.type === "snapshot" ? change.events : [...current.events, change.event];
  const byId = new Map<string, z.infer<typeof ConfirmedActionEventSchema>>();
  for (const candidate of candidates) {
    const event = ConfirmedActionEventSchema.parse(candidate);
    if (event.action.runId !== current.runId) throw new Error("run-log-event-owner-mismatch");
    const previous = byId.get(event.eventId);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error("run-log-event-id-conflict");
    byId.set(event.eventId, event);
  }
  const ordered = [...byId.values()].sort((a, b) =>
    a.action.attempt - b.action.attempt || a.action.claimGeneration - b.action.claimGeneration
    || a.workerStreamId.localeCompare(b.workerStreamId) || a.sequence - b.sequence);
  return Object.freeze({ runId: current.runId, events: Object.freeze(ordered.slice(-200)),
    hasEarlier: (change.type === "snapshot" ? change.hasEarlier : current.hasEarlier) || ordered.length > 200 });
}
