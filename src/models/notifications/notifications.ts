import { z } from "zod";
import {
  ActorIdSchema,
  CommandIdSchema,
  FailureIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NotificationIdSchema,
  PositiveIntSchema,
  RunIdSchema,
} from "../../rules/identity/ids.js";

export const NotificationTriggerSchema = z.enum([
  "failed",
  "gate-waiting",
  "write-parked",
  "repeating",
  "storage",
  "verified-done",
  "backfill-gap",
  "command",
]);

const NotificationLinkSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run"), runId: RunIdSchema }),
  z.strictObject({ kind: z.literal("failure"), failureId: FailureIdSchema, runId: RunIdSchema }),
  z.strictObject({ kind: z.literal("storage"), diagnosticFingerprint: FingerprintSchema }),
  z.strictObject({ kind: z.literal("recovery"), commandId: CommandIdSchema }),
  z.strictObject({ kind: z.literal("command-result"), commandId: CommandIdSchema }),
  z.strictObject({ kind: z.literal("bulk-result"), bulkCommandId: CommandIdSchema }),
]);

const NotificationSnoozeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("not-snoozed") }),
  z.strictObject({ state: z.literal("snoozed"), until: IsoInstantSchema }),
]);

export const NotificationRecordSchema = z.strictObject({
  notificationId: NotificationIdSchema,
  actorId: ActorIdSchema,
  dedupeFingerprint: FingerprintSchema,
  trigger: NotificationTriggerSchema,
  channel: z.enum(["ping", "inbox"]),
  status: z.enum(["unread", "read"]),
  snooze: NotificationSnoozeSchema,
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1_000),
  links: z.array(NotificationLinkSchema),
    /* A repeated identical trigger folds into the ONE row its `(actorId, dedupeFingerprint)` already owns; `count` and `lastSeenAt` are not derivable from an insert-only history. */
  count: PositiveIntSchema,
  lastSeenAt: IsoInstantSchema,
  /** The person cleared it from the bell; a repeat folds it back in as news. */
  clearedAt: IsoInstantSchema.optional(),
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
}).superRefine((notification, context) => {
  const expectedChannel = notification.trigger === "verified-done" ? "inbox" : "ping";
  if (notification.channel !== expectedChannel) {
    context.addIssue({ code: "custom", path: ["channel"], message: `${notification.trigger} notifications require ${expectedChannel}` });
  }
  const expectsNoLink = notification.trigger === "backfill-gap";
  if (expectsNoLink !== (notification.links.length === 0)) {
    context.addIssue({
      code: "custom",
      path: ["links"],
      message: expectsNoLink
        ? "backfill-gap notifications cannot invent a navigation target"
        : `${notification.trigger} notifications require an evidence link`,
    });
  }
  if (notification.trigger === "backfill-gap" && notification.status !== "unread") {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "a pinned backfill gap must remain unread",
    });
  }
  if (notification.trigger === "backfill-gap" && notification.clearedAt !== undefined) {
    context.addIssue({ code: "custom", path: ["clearedAt"], message: "a pinned backfill gap cannot be cleared" });
  }
  if (notification.clearedAt !== undefined && Date.parse(notification.clearedAt) > Date.parse(notification.updatedAt)) {
    context.addIssue({ code: "custom", path: ["clearedAt"], message: "notification clearedAt cannot follow updatedAt" });
  }
  if (notification.trigger === "backfill-gap" && notification.snooze.state !== "not-snoozed") {
    context.addIssue({
      code: "custom",
      path: ["snooze"],
      message: "a pinned backfill gap cannot be snoozed",
    });
  }
  if (Date.parse(notification.updatedAt) < Date.parse(notification.createdAt)) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "notification updatedAt cannot precede createdAt" });
  }
  if (notification.snooze.state === "snoozed" && Date.parse(notification.snooze.until) <= Date.parse(notification.createdAt)) {
    context.addIssue({ code: "custom", path: ["snooze", "until"], message: "notification snooze must end after createdAt" });
  }
  if (Date.parse(notification.lastSeenAt) < Date.parse(notification.createdAt)) {
    context.addIssue({ code: "custom", path: ["lastSeenAt"], message: "notification lastSeenAt cannot precede createdAt" });
  }
  if (Date.parse(notification.lastSeenAt) > Date.parse(notification.updatedAt)) {
    context.addIssue({ code: "custom", path: ["lastSeenAt"], message: "notification lastSeenAt cannot follow updatedAt" });
  }
});

/** The two mutations required of a durable notification, each CAS-ed on the row's exact current version; neither may touch identity. */
export const NotificationFoldRequestSchema = z.strictObject({
  actorId: ActorIdSchema,
  dedupeFingerprint: FingerprintSchema,
  seenAt: IsoInstantSchema,
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1_000),
});

export const NotificationStateRequestSchema = z.strictObject({
  notificationId: NotificationIdSchema,
  expectedVersion: PositiveIntSchema,
  status: z.enum(["unread", "read"]),
  snooze: NotificationSnoozeSchema,
  /** Present only to clear the row; otherwise the row keeps its clearedAt. */
  clearedAt: IsoInstantSchema.optional(),
  updatedAt: IsoInstantSchema,
});

export const NotificationRecordOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("created"), notification: NotificationRecordSchema }),
  z.strictObject({ state: z.literal("folded"), notification: NotificationRecordSchema }),
]);

export type NotificationRecord = z.infer<typeof NotificationRecordSchema>;
export type NotificationRecordOutcome = z.infer<typeof NotificationRecordOutcomeSchema>;

/** Permanent safety facts admit no update, including a same-state version bump. */
export function requireMutableNotification(input: unknown): NotificationRecord {
  const record = NotificationRecordSchema.parse(input);
  if (record.trigger === "backfill-gap") {
    throw new Error(`notification ${record.notificationId} is a pinned backfill gap and cannot be mutated`);
  }
  return record;
}

export const NotificationObservationStatusSchema = z.strictObject({
  state: z.enum(["ready", "failed", "stopped"]),
  code: z.enum(["NOTIFICATION_OBSERVATION_FAILED", "NOTIFICATION_RECEIPT_MISSING"]).optional(),
  pending: z.number().int().nonnegative(),
});

export const NotificationCollectionOperationSchema = z.enum(["read", "unread", "snooze", "unsnooze"]);
export type NotificationCollectionOperation = z.infer<typeof NotificationCollectionOperationSchema>;
export const NotificationCollectionTargetSchema = z.strictObject({
  actorId: ActorIdSchema,
  members: z.array(z.strictObject({ notificationId: NotificationIdSchema, expectedVersion: PositiveIntSchema })),
  matchingCount: z.number().int().nonnegative(),
}).superRefine((target, context) => {
  if (target.matchingCount > target.members.length || target.members.some((row, index) => index > 0 && row.notificationId <= target.members[index - 1].notificationId)) {
    context.addIssue({ code: "custom", message: "notification-collection-membership-invalid" });
  }
});
export type NotificationCollectionTarget = z.infer<typeof NotificationCollectionTargetSchema>;
/** Members are exactly the rows to clear, at the versions the operator saw. */
export const NotificationClearTargetSchema = NotificationCollectionTargetSchema.refine(
  target => target.members.length > 0 && target.matchingCount === target.members.length, "notification-clear-members-invalid");

/** What a row's standing reads: the linked run's lifecycle state, and for storage the concern its latest publication names and whether that concern is still active. */
export type NotificationStandingSources = Readonly<{
  runState(runId: string): string | undefined;
  storageConcern(notificationId: string): string | undefined;
  concernActive(concern: string): boolean | undefined;
  /** Whether the command has its result; undefined when the command is not stored. */
  commandSettled(commandId: string): boolean | undefined;
}>;
/** Still waiting on the operator: an open gate or parked write the run still holds, a recovery command still unsettled, or a storage problem still active.
 * A storage row whose concern or health cannot be read stands, since nothing proves it handled. */
export function notificationStanding(row: NotificationRecord, sources: NotificationStandingSources): boolean {
  const link = row.links[0];
  if (row.trigger === "gate-waiting" || row.trigger === "write-parked") {
    return link !== undefined && "runId" in link && sources.runState(link.runId) === (row.trigger === "gate-waiting" ? "parked-gate" : "parked-write");
  }
  if (row.trigger === "command") return link?.kind === "recovery" && sources.commandSettled(link.commandId) === false;
  if (row.trigger !== "storage") return false;
  const concern = sources.storageConcern(row.notificationId);
  return concern === undefined || sources.concernActive(concern) !== false;
}
export function notificationMatchesCollection(row: NotificationRecord, operation: NotificationCollectionOperation): boolean {
  if (row.trigger === "backfill-gap" || row.clearedAt !== undefined) return false;
  return operation === "read" ? row.status === "unread" : operation === "unread" ? row.status === "read"
    : operation === "unsnooze" ? row.snooze.state === "snoozed" : true;
}
/** Every listed row is a member, so any change to the inbox refuses a stale collection; a cleared row is no longer listed. */
export function notificationCollectionTarget(records: readonly NotificationRecord[], actorId: string, operation: NotificationCollectionOperation): NotificationCollectionTarget {
  const rows = records.map(row => NotificationRecordSchema.parse(row)).filter(row => row.clearedAt === undefined);
  if (rows.some(row => row.actorId !== actorId)) throw new Error("notification-collection-actor-mismatch");
  return NotificationCollectionTargetSchema.parse({ actorId,
    members: rows.map(row => ({ notificationId: row.notificationId, expectedVersion: row.version })).sort((a, b) => a.notificationId < b.notificationId ? -1 : a.notificationId > b.notificationId ? 1 : 0),
    matchingCount: rows.filter(row => notificationMatchesCollection(row, operation)).length });
}
