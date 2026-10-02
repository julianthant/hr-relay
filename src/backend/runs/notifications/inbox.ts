import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { sha256Hex } from "../../../domain/sha256.js";
import type { RunExistence } from "../../../domain/authority.js";
/**
 * Ref dashboard-surfaces §2.6 / §10.4 (D79b) and ref operator-trust §6 — the durable, actor-keyed inbox.
 *
 * **The ordering is the whole contract.** A notification is a durable record
 * first and a desktop delivery second: the row is committed to authority
 * BEFORE any OS delivery is attempted, and a delivery that fails may never roll
 * the row back, flip its status, or decrement its count. An operator who missed
 * the toast has to still find an unread item — that, not the toast, is the
 * alert. `publish` therefore has no arm in which a delivery outcome reaches the
 * durable write, and the delivery call is made only after the transaction has
 * returned.
 *
 * The fold is the repeat path (ref operator-trust §6.1, D134): one row per
 * `(actorId, dedupeFingerprint)`, `count` incremented, `lastSeenAt` advanced,
 * `status` back to `unread` because a repeat is news again. This is derived
 * operator-facing state and is deliberately NOT the ledger's immutability —
 * nothing here can touch a filed transaction record.
 *
 * Snooze suppresses DELIVERY only. It never changes read state, and it never
 * prevents the durable write.
 */
import { z } from "zod";
import type { Clock } from "../../../domain/clock.js";
import type { IdFactory } from "../../../domain/identifiers.js";
import { ActorIdSchema, FingerprintSchema, IsoInstantSchema, NotificationIdSchema } from "../../../domain/ids.js";
import {
  NotificationDeliverabilitySchema,
  NotificationTriggerEventSchema,
  notificationDeliverability,
  projectNotificationTrigger,
} from "../../../domain/notification-triggers.js";
import {
  NotificationRecordSchema,
  type NotificationRecord,
} from "../../../domain/notifications.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";

/**
 * The OS delivery seam. It is allowed to fail, and the only thing the inbox
 * does with that failure is REPORT it — ref guards-and-tests §3.10 explicitly says no
 * per-attempt delivery state is required, and storing one would invite a retry
 * loop that mutates the record the operator is reading.
 */
export interface OsNotificationDelivery {
  deliver(record: NotificationRecord): Promise<void>;
}

export const NotificationDeliveryOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("delivered") }),
  z.strictObject({ state: z.literal("suppressed-snoozed"), until: IsoInstantSchema }),
  z.strictObject({ state: z.literal("no-channel") }),
  z.strictObject({ state: z.literal("not-requested-existing") }),
  z.strictObject({ state: z.literal("failed"), detail: z.string().min(1) }),
]);

export const NotificationPublishReportSchema = z.strictObject({
  /** Always present: the durable row exists whatever delivery did. */
  notification: NotificationRecordSchema,
  durable: z.enum(["created", "folded", "existing"]),
  delivery: NotificationDeliveryOutcomeSchema,
});
export type NotificationPublishReport = z.infer<typeof NotificationPublishReportSchema>;

export interface NotificationInbox {
  /** Takes `unknown` and parses: the trigger union is the boundary. */
  publish(event: unknown, source?: Readonly<{ identity: string; occurredAt: string }>): Promise<NotificationPublishReport>;
  list(actorId: string, status?: "unread" | "read"): readonly NotificationRecord[];
  get(notificationId: string): NotificationRecord | undefined;
  markRead(notificationId: string, expectedVersion: number): NotificationRecord;
  markUnread(notificationId: string, expectedVersion: number): NotificationRecord;
  snooze(notificationId: string, expectedVersion: number, until: string): NotificationRecord;
  clearSnooze(notificationId: string, expectedVersion: number): NotificationRecord;
}

/**
 * The authority surface the inbox needs; `AuthorityDatabase` satisfies it.
 * The transaction handle is not optional: "find the dedupe row, then create or
 * fold it" has to be one atomic decision or two triggers firing at once would
 * both take the create branch and collide on the unique index.
 */
export interface NotificationAuthority {
  readonly authority: Pick<AuthorityRepositories, "notifications" | "notificationPublications">;
  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
}

export interface NotificationInboxDependencies {
  readonly runReader?: { read(runId: string): RunExistence };
  readonly authority: NotificationAuthority;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly actorId: string;
  /** Absent means "no desktop channel configured", never "delivery succeeded". */
  readonly delivery?: OsNotificationDelivery;
}

export function createNotificationInbox(
  dependencies: NotificationInboxDependencies,
): NotificationInbox {
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
    async publish(event: unknown, source?: Readonly<{ identity: string; occurredAt: string }>): Promise<NotificationPublishReport> {
      const trigger = NotificationTriggerEventSchema.parse(event);
      const projection = projectNotificationTrigger(trigger);
      const seenAt = now();
      const occurredAt = source === undefined ? seenAt : IsoInstantSchema.parse(source.occurredAt);
      const occurrence = source === undefined ? canonicalJsonStringify(trigger) : FingerprintSchema.parse(source.identity);
      const sourceId = sha256Hex(`hrauto:notification-source:v1\0${actorId}\0${occurrence}`);

      /* ── phase 1: durable, and complete before anything is delivered ───── */
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
        // Historical facts already covered by a row adopt source custody without replaying it.
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

      /* ── phase 2: best-effort delivery, over an already-committed row ──── */
      const deliverability = NotificationDeliverabilitySchema.parse(
        notificationDeliverability(notification, seenAt),
      );
      let delivery: z.infer<typeof NotificationDeliveryOutcomeSchema>;
      if (deliverability.state === "suppressed-snoozed") {
        delivery = { state: "suppressed-snoozed", until: deliverability.until };
      } else if (notification.channel === "inbox" || dependencies.delivery === undefined) {
        delivery = { state: "no-channel" };
      } else {
        try {
          await dependencies.delivery.deliver(notification);
          delivery = { state: "delivered" };
        } catch (error) {
          // Reported, never swallowed into success — and deliberately never
          // written back onto the row. The unread item IS the surviving alert.
          delivery = {
            state: "failed",
            detail: error instanceof Error ? error.message : `desktop delivery threw ${String(error)}`,
          };
        }
      }

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
