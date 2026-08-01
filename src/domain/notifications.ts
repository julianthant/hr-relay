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
});

export type NotificationRecord = z.infer<typeof NotificationRecordSchema>;
