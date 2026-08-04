import { z } from "zod";
import {
  ActorIdSchema,
  FailureIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NotificationIdSchema,
  PositiveIntSchema,
  RunIdSchema,
} from "./ids.js";

export const NotificationTriggerSchema = z.enum([
  "failed",
  "gate-waiting",
  "write-parked",
  "repeating",
  "storage",
  "verified-done",
]);

const NotificationLinkSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run"), runId: RunIdSchema }),
  z.strictObject({ kind: z.literal("failure"), failureId: FailureIdSchema, runId: RunIdSchema }),
  z.strictObject({ kind: z.literal("storage"), diagnosticFingerprint: FingerprintSchema }),
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
  links: z.array(NotificationLinkSchema).min(1),
  /**
   * D134 (doc 03 §2.6, doc 12 §6): a repeated identical trigger folds into the
   * ONE row its `(actorId, dedupeFingerprint)` already owns. `count` is how many
   * times the trigger fired and `lastSeenAt` is the newest firing — neither is
   * derivable from an insert-only history, because the folded firings leave no
   * separate rows behind. This is deliberately NOT ledger semantics: a
   * notification is operator-facing derived state, never a transaction record.
   */
  count: PositiveIntSchema,
  lastSeenAt: IsoInstantSchema,
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
}).superRefine((notification, context) => {
  const expectedChannel = notification.trigger === "verified-done" ? "inbox" : "ping";
  if (notification.channel !== expectedChannel) {
    context.addIssue({ code: "custom", path: ["channel"], message: `${notification.trigger} notifications require ${expectedChannel}` });
  }
  if (Date.parse(notification.updatedAt) < Date.parse(notification.createdAt)) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "notification updatedAt cannot precede createdAt" });
  }
  if (notification.snooze.state === "snoozed" && Date.parse(notification.snooze.until) <= Date.parse(notification.updatedAt)) {
    context.addIssue({ code: "custom", path: ["snooze", "until"], message: "notification snooze must end after updatedAt" });
  }
  if (Date.parse(notification.lastSeenAt) < Date.parse(notification.createdAt)) {
    context.addIssue({ code: "custom", path: ["lastSeenAt"], message: "notification lastSeenAt cannot precede createdAt" });
  }
  if (Date.parse(notification.lastSeenAt) > Date.parse(notification.updatedAt)) {
    context.addIssue({ code: "custom", path: ["lastSeenAt"], message: "notification lastSeenAt cannot follow updatedAt" });
  }
});

/**
 * The two mutations doc 03 §2.6 requires of a durable notification, each CAS-ed
 * on the row's exact current version. `fold` is the repeat-trigger path;
 * `state` is the operator's read/snooze path. Neither may touch identity.
 */
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
  updatedAt: IsoInstantSchema,
});

export const NotificationRecordOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("created"), notification: NotificationRecordSchema }),
  z.strictObject({ state: z.literal("folded"), notification: NotificationRecordSchema }),
]);

export type NotificationRecord = z.infer<typeof NotificationRecordSchema>;
export type NotificationRecordOutcome = z.infer<typeof NotificationRecordOutcomeSchema>;
