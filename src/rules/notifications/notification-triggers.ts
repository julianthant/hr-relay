/** The pure projection from a durable server-side event onto the ONE notification row it owns; the trigger set is closed, so a concern that is not on the list is a new decision. */
import { z } from "zod";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import {
  CommandIdSchema,
  ErrorCodeSchema,
  FailureFingerprintSchema,
  FailureIdSchema,
  FingerprintSchema,
  GateIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  ProjectionCursorSchema,
  RunIdSchema,
  WorkflowIdSchema,
  WriteIntentIdSchema,
} from "../identity/ids.js";
import { operatorFailureSentence } from "../../models/failures/error-catalog.js";
import { NotificationRecordSchema, NotificationTriggerSchema } from "../../models/notifications/notifications.js";
import { sha256Hex } from "../validation/sha256.js";

/** The enumerated concerns — storage degradation, stalled lease/outbox, failed backup — and a concern that is not on this list is not a notification. */
export const StorageHealthConcernSchema = z.enum([
  "disk-space",
  "wal-growth",
  "integrity-check",
  "backup",
  "outbox-stalled",
  "lease-stalled",
]);

export const BackfillGapTriggerEventSchema = z.strictObject({
  kind: z.literal("backfill-gap"),
  detector: z.literal("server-resume"),
  reason: z.enum(["cursor-expired", "snapshot-boundary"]),
  topic: z.literal("dashboard-day"),
  requestedCursor: ProjectionCursorSchema,
  currentCursor: ProjectionCursorSchema,
  projectionGeneration: PositiveIntSchema,
}).superRefine((gap, context) => {
  const requested = Number(gap.requestedCursor.slice(3));
  const current = Number(gap.currentCursor.slice(3));
  if (requested >= current) {
    context.addIssue({
      code: "custom",
      path: ["requestedCursor"],
      message: "a backfill gap requires a historical requested cursor before the current cursor",
    });
  }
});

export const NotificationTriggerEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("run-failed"),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    failureId: FailureIdSchema,
    failureFingerprint: FailureFingerprintSchema,
    code: ErrorCodeSchema,
  }),
  z.strictObject({
    kind: z.literal("subject-mismatch"),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    failureId: FailureIdSchema,
    failureFingerprint: FailureFingerprintSchema,
  }),
  z.strictObject({
    kind: z.literal("gate-opened"),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    gateId: GateIdSchema,
  }),
  z.strictObject({
    kind: z.literal("write-parked"),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    writeIntentId: WriteIntentIdSchema,
  }),
  z.strictObject({
    kind: z.literal("repeating-failure"),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    failureId: FailureIdSchema,
    failureFingerprint: FailureFingerprintSchema,
    occurrences: PositiveIntSchema,
    threshold: PositiveIntSchema,
  }),
  z.strictObject({
    kind: z.literal("storage-degraded"),
    concern: StorageHealthConcernSchema,
    state: z.enum(["degraded", "failed"]),
    diagnosticFingerprint: FingerprintSchema,
  }),
  z.strictObject({
    kind: z.literal("verified-done"),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
  }),
  BackfillGapTriggerEventSchema,
  z.strictObject({ kind: z.literal("command-refused"), commandId: CommandIdSchema, outcome: z.enum(["rejected", "conflict"]) }),
  z.strictObject({ kind: z.literal("command-unknown"), commandId: CommandIdSchema }),
  z.strictObject({ kind: z.literal("bulk-incomplete"), bulkCommandId: CommandIdSchema, summary: z.string().min(1).max(1_000).optional() }),
]);
export type NotificationTriggerEvent = z.infer<typeof NotificationTriggerEventSchema>;

export const NotificationProjectionSchema = z.strictObject({
  trigger: NotificationTriggerSchema,
  channel: NotificationRecordSchema.shape.channel,
  dedupeFingerprint: FingerprintSchema,
  title: NotificationRecordSchema.shape.title,
  summary: NotificationRecordSchema.shape.summary,
  links: NotificationRecordSchema.shape.links,
});
export type NotificationProjection = z.infer<typeof NotificationProjectionSchema>;

/** The identity two firings share when they are "the same trigger": domain separated and versioned, so a later identity change is a visible migration. */
export function deriveNotificationDedupeFingerprint(input: unknown): string {
  const event = NotificationTriggerEventSchema.parse(input);
  const identity = ((): Record<string, string> => {
    switch (event.kind) {
      case "run-failed":
      case "subject-mismatch":
        return { kind: event.kind, runId: event.runId, failureFingerprint: event.failureFingerprint };
      case "gate-opened":
        return { kind: event.kind, runId: event.runId, gateId: event.gateId };
      case "write-parked":
        return { kind: event.kind, runId: event.runId, writeIntentId: event.writeIntentId };
      // Class-level, deliberately NOT run-scoped: the alert is "this failure
      // keeps happening", which is exactly one inbox item however many runs hit it.
      case "repeating-failure":
        return { kind: event.kind, failureFingerprint: event.failureFingerprint };
      case "storage-degraded":
        return { kind: event.kind, concern: event.concern, diagnosticFingerprint: event.diagnosticFingerprint };
      case "verified-done":
        return { kind: event.kind, runId: event.runId };
      case "backfill-gap":
        return {
          kind: event.kind,
          detector: event.detector,
          topic: event.topic,
          requestedCursor: event.requestedCursor,
          projectionGeneration: String(event.projectionGeneration),
        };
      case "command-refused":
      case "command-unknown":
        return { kind: event.kind, commandId: event.commandId };
      case "bulk-incomplete":
        return { kind: event.kind, bulkCommandId: event.bulkCommandId };
    }
  })();
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:notification-dedupe:v1\0${canonicalJsonStringify(identity)}`,
  ));
}

/** The ratified routing, re-checked by the durable record, so a wrong channel here fails at the boundary too. */
export function projectNotificationTrigger(input: unknown): NotificationProjection {
  const event = NotificationTriggerEventSchema.parse(input);
  const projection = ((): Omit<NotificationProjection, "dedupeFingerprint"> => {
    switch (event.kind) {
      case "run-failed":
        return {
          trigger: "failed",
          channel: "ping",
          title: `Run failed — ${event.workflowId}`,
          summary: operatorFailureSentence(event.code),
          links: [{ kind: "failure", failureId: event.failureId, runId: event.runId }],
        };
      case "subject-mismatch":
        return {
          trigger: "failed",
          channel: "ping",
          title: `Subject mismatch — ${event.workflowId}`,
          summary: `${event.workflowId} run ${event.runId} observed a different subject than it bound. Nothing was submitted; confirm the person before retrying.`,
          links: [{ kind: "failure", failureId: event.failureId, runId: event.runId }],
        };
      case "gate-opened":
        return {
          trigger: "gate-waiting",
          channel: "ping",
          title: `Needs you — ${event.workflowId}`,
          summary: `${event.workflowId} run ${event.runId} is waiting at gate "${event.gateId}".`,
          links: [{ kind: "run", runId: event.runId }],
        };
      case "write-parked":
        return {
          trigger: "write-parked",
          channel: "ping",
          title: `Write parked — ${event.workflowId}`,
          summary: `${event.workflowId} run ${event.runId} has an unknown write outcome on intent ${event.writeIntentId}. It needs typed proof or a confirmed absence before it can move.`,
          links: [{ kind: "run", runId: event.runId }],
        };
      case "repeating-failure":
        return {
          trigger: "repeating",
          channel: "ping",
          title: "Repeating failure crossed its threshold",
          summary: `Failure fingerprint ${event.failureFingerprint} has now occurred ${String(event.occurrences)} times against a threshold of ${String(event.threshold)}.`,
          links: [{ kind: "failure", failureId: event.failureId, runId: event.runId }],
        };
      case "storage-degraded":
        return {
          trigger: "storage",
          channel: "ping",
          title: `Storage ${event.state} — ${event.concern}`,
          summary: `The ${event.concern} health check reported ${event.state}. Durable state is irreplaceable; resolve before starting new work.`,
          links: [{ kind: "storage", diagnosticFingerprint: event.diagnosticFingerprint }],
        };
      case "verified-done":
        return {
          trigger: "verified-done",
          channel: "inbox",
          title: `Done — ${event.workflowId}`,
          summary: `${event.workflowId} run ${event.runId} completed with every declared completion criterion evidenced.`,
          links: [{ kind: "run", runId: event.runId }],
        };
      case "backfill-gap":
        return {
          trigger: "backfill-gap",
          channel: "ping",
          title: "Notification history is incomplete",
          summary: "The dashboard could not backfill part of the event stream. Resnapshot and reconcile the affected work before relying on dashboard history.",
          links: [],
        };
      case "command-refused":
        return {
          trigger: "command",
          channel: "ping",
          title: "Not done",
          summary: event.outcome === "conflict"
            ? "This changed before Relay got to it, so nothing was done. Check it and try again."
            : "Relay did not do this, so nothing changed.",
          links: [{ kind: "command-result", commandId: event.commandId }],
        };
      case "command-unknown":
        return {
          trigger: "command",
          channel: "ping",
          title: "Result unknown",
          summary: "Relay could not confirm whether this finished. Open it to check before trying again.",
          links: [{ kind: "recovery", commandId: event.commandId }],
        };
      case "bulk-incomplete":
        return {
          trigger: "command",
          channel: "ping",
          title: "Batch not fully done",
          summary: event.summary ?? "Some items in this batch were not done. Open it to see each one.",
          links: [{ kind: "bulk-result", bulkCommandId: event.bulkCommandId }],
        };
    }
  })();
  return NotificationProjectionSchema.parse({
    ...projection,
    dedupeFingerprint: deriveNotificationDedupeFingerprint(event),
  });
}

export const NotificationDeliverabilitySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("deliverable") }),
  z.strictObject({ state: z.literal("suppressed-snoozed"), until: IsoInstantSchema }),
]);
export type NotificationDeliverability = z.infer<typeof NotificationDeliverabilitySchema>;

/** Snooze suppresses DELIVERY and nothing else; read state is not consulted, and there is no arm that could return "do not record it". */
export function notificationDeliverability(recordInput: unknown, nowInput: unknown): NotificationDeliverability {
  const record = NotificationRecordSchema.parse(recordInput);
  const now = Date.parse(IsoInstantSchema.parse(nowInput));
  if (!Number.isFinite(now)) throw new Error("notification deliverability requires a real instant");
  if (record.snooze.state === "snoozed" && Date.parse(record.snooze.until) > now) {
    return NotificationDeliverabilitySchema.parse({ state: "suppressed-snoozed", until: record.snooze.until });
  }
  return NotificationDeliverabilitySchema.parse({ state: "deliverable" });
}
