import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { RunExistence } from "../../../models/config/authority.js";
/** Durable actor-keyed inbox; repeats become unread and snooze preserves durable publication. */
import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import { ActorIdSchema, FingerprintSchema, IsoInstantSchema, NotificationIdSchema } from "../../../rules/identity/ids.js";
import { NotificationDeliverabilitySchema, NotificationTriggerEventSchema, notificationDeliverability, projectNotificationTrigger } from "../../../rules/notifications/notification-triggers.js";
import { NotificationRecordSchema, type NotificationRecord } from "../../../models/notifications/notifications.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";

const NotificationDeliveryOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("suppressed-snoozed"), until: IsoInstantSchema }),
  z.strictObject({ state: z.literal("no-channel") }),
  z.strictObject({ state: z.literal("not-requested-existing") }),
]);

const NotificationPublishReportSchema = z.strictObject({
  /** Always present: the durable row exists whatever delivery did. */
  notification: NotificationRecordSchema,
  durable: z.enum(["created", "folded", "existing"]),
  delivery: NotificationDeliveryOutcomeSchema,
});
export type NotificationPublishReport = z.infer<typeof NotificationPublishReportSchema>;

export interface NotificationPublication {
  readonly sourceId: string;
  readonly notification: NotificationRecord;
  readonly event: z.infer<typeof NotificationTriggerEventSchema>;
  readonly durable: "created" | "folded";
}

export interface NotificationInbox {
  onPublication(this: void, listener: (publication: NotificationPublication) => void): () => void;
  /** Takes `unknown` and parses: the trigger union is the boundary. */
  publish(event: unknown, source?: Readonly<{ identity: string; occurredAt: string }>): Promise<NotificationPublishReport>;
  list(actorId: string, status?: "unread" | "read"): readonly NotificationRecord[];
  get(notificationId: string): NotificationRecord | undefined;
  markRead(notificationId: string, expectedVersion: number): NotificationRecord;
  markUnread(notificationId: string, expectedVersion: number): NotificationRecord;
  snooze(notificationId: string, expectedVersion: number, until: string): NotificationRecord;
  clearSnooze(notificationId: string, expectedVersion: number): NotificationRecord;
}


interface NotificationAuthority {
  readonly authority: Pick<AuthorityRepositories, "notifications" | "notificationPublications">;
  afterAuthorityCommit(publish: () => void): void;
  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
}

export interface NotificationInboxDependencies {
  readonly runReader?: { read(runId: string): RunExistence };
  readonly authority: NotificationAuthority;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly actorId: string;
}

export function createNotificationInbox(
  dependencies: NotificationInboxDependencies,
): NotificationInbox {
  const listeners = new Set<(publication: NotificationPublication) => void>();
  const repository = dependencies.authority.authority.notifications;
  const actorId = ActorIdSchema.parse(dependencies.actorId);
  const now = (): string => IsoInstantSchema.parse(dependencies.clock.now().toISOString());

  const restate = (
    notificationId: string,
    expectedVersion: number,
    status: "unread" | "read",
    snooze: NotificationRecord["snooze"],
  ): NotificationRecord => repository.updateState({
    notificationId: NotificationIdSchema.parse(notificationId),
    expectedVersion,
    status,
    snooze,
    updatedAt: now(),
  });

  const current = (notificationId: string): NotificationRecord => {
    const record = repository.get(NotificationIdSchema.parse(notificationId));
    if (record === undefined) throw new Error(`notification ${notificationId} does not exist`);
    if (record.actorId !== actorId) throw new Error("NOTIFICATION_ACTOR_MISMATCH");
    return record;
  };

  return Object.freeze({
    onPublication(listener: (publication: NotificationPublication) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async publish(event: unknown, source?: Readonly<{ identity: string; occurredAt: string }>): Promise<NotificationPublishReport> {
      const trigger = NotificationTriggerEventSchema.parse(event);
      const projection = projectNotificationTrigger(trigger);
      const seenAt = now();
      const occurredAt = source === undefined ? seenAt : IsoInstantSchema.parse(source.occurredAt);
      const occurrence = source === undefined ? canonicalJsonStringify(trigger) : FingerprintSchema.parse(source.identity);
      const sourceId = sha256Hex(`hrauto:notification-source:v1\0${actorId}\0${occurrence}`);


      const settled = dependencies.authority.withAuthorityTransaction((repositories) => {
        const publications = repositories.notificationPublications;
        const replay = publications.get(sourceId);
        if (replay !== undefined) {
          if (canonicalJsonStringify(replay.event) !== canonicalJsonStringify(trigger)) throw new Error("NOTIFICATION_SOURCE_CONFLICT");
          const record = repositories.notifications.get(replay.notificationId);
          if (record === undefined) throw new Error("NOTIFICATION_SOURCE_OWNER_MISSING");
          return { durable: "existing" as const, notification: record };
        }
        if ("runId" in trigger) {
          if (dependencies.runReader === undefined) throw new Error("NOTIFICATION_RUN_READER_NOT_CONFIGURED");
          const existence = dependencies.runReader.read(trigger.runId);
          if (existence.state !== "present") {
            throw new Error(`NOTIFICATION_RUN_UNAVAILABLE: ${trigger.runId} is ${existence.state}`);
          }
          if (existence.run.envelope.runId !== trigger.runId || existence.run.envelope.workflow !== trigger.workflowId) {
            throw new Error(`NOTIFICATION_RUN_IDENTITY_MISMATCH: ${trigger.runId}`);
          }
        }
        const notifications = repositories.notifications;
        const existing = notifications.findByDedupe(actorId, projection.dedupeFingerprint);
        const remember = (record: NotificationRecord, adopted: boolean) => publications.create({
          sourceId, actorId, notificationId: record.notificationId, event: trigger, occurredAt, createdAt: seenAt, adopted,
        });

        if (existing !== undefined && (projection.trigger === "backfill-gap" ||
          (source !== undefined && occurredAt <= existing.lastSeenAt && publications.latest(existing.notificationId) === undefined))) {
          remember(existing, true);
          return { durable: "existing" as const, notification: existing };
        }
        if (existing === undefined) {
          const created = notifications.create(NotificationRecordSchema.parse({
            notificationId: NotificationIdSchema.parse(dependencies.ids.uuid()),
            actorId,
            dedupeFingerprint: projection.dedupeFingerprint,
            trigger: projection.trigger,
            channel: projection.channel,
            status: "unread",
            snooze: { state: "not-snoozed" },
            title: projection.title,
            summary: projection.summary,
            links: projection.links,
            count: 1,
            lastSeenAt: seenAt,
            version: 1,
            createdAt: seenAt,
            updatedAt: seenAt,
          }));
          remember(created.record, false);
          return { durable: "created" as const, notification: created.record };
        }
        if (projection.trigger === "backfill-gap") {
          return { durable: "existing" as const, notification: existing };
        }
        const folded = notifications.fold({
          actorId,
          dedupeFingerprint: projection.dedupeFingerprint,
          seenAt,
          title: projection.title,
          summary: projection.summary,
        });
        remember(folded.notification, false);
        return { durable: "folded" as const, notification: folded.notification };
      });
      const notification = settled.notification;
      const durable = settled.durable;

      if (durable === "existing") {
        return NotificationPublishReportSchema.parse({
          notification,
          durable,
          delivery: { state: "not-requested-existing" },
        });
      }

      /* Publish channel status after the durable transaction. */
      const deliverability = NotificationDeliverabilitySchema.parse(
        notificationDeliverability(notification, seenAt),
      );
      let delivery: z.infer<typeof NotificationDeliveryOutcomeSchema>;
      if (deliverability.state === "suppressed-snoozed") {
        delivery = { state: "suppressed-snoozed", until: deliverability.until };
      } else {
        delivery = { state: "no-channel" };
      }

      dependencies.authority.afterAuthorityCommit(() => {
        const publication = { sourceId, notification: current(notification.notificationId), event: trigger, durable };
        for (const listener of listeners) listener(publication);
      });
      return NotificationPublishReportSchema.parse({ notification, durable, delivery });
    },
    list: (listActorId: string, status?: "unread" | "read") => (status === undefined
      ? repository.listByActor(ActorIdSchema.parse(listActorId))
      : repository.listByActor(ActorIdSchema.parse(listActorId), status)),
    get: (notificationId: string) => repository.get(NotificationIdSchema.parse(notificationId)),
    // Read state and snooze are independent: marking read keeps the snooze the
    // operator set, and snoozing keeps the status the row already had.
    markRead: (notificationId: string, expectedVersion: number) =>
      restate(notificationId, expectedVersion, "read", current(notificationId).snooze),
    markUnread: (notificationId: string, expectedVersion: number) =>
      restate(notificationId, expectedVersion, "unread", current(notificationId).snooze),
    snooze: (notificationId: string, expectedVersion: number, until: string) =>
      restate(notificationId, expectedVersion, current(notificationId).status, {
        state: "snoozed",
        until: IsoInstantSchema.parse(until),
      }),
    clearSnooze: (notificationId: string, expectedVersion: number) =>
      restate(notificationId, expectedVersion, current(notificationId).status, { state: "not-snoozed" }),
  });
}
