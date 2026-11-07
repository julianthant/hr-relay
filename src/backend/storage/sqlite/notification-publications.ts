import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { ActorIdSchema, FingerprintSchema, IsoInstantSchema, NotificationIdSchema, NonNegativeIntSchema } from "../../../rules/identity/ids.js";
import { NotificationRecordSchema } from "../../../models/notifications/notifications.js";
import { deriveNotificationDedupeFingerprint, projectNotificationTrigger, NotificationTriggerEventSchema, StorageHealthConcernSchema } from "../../../rules/notifications/notification-triggers.js";

export const NotificationPublicationSchema = z.strictObject({
  sourceId: FingerprintSchema,
  actorId: ActorIdSchema,
  notificationId: NotificationIdSchema,
  event: NotificationTriggerEventSchema,
  occurredAt: IsoInstantSchema,
  createdAt: IsoInstantSchema,
  adopted: z.boolean(),
});
export const NotificationHealthSchema = z.strictObject({
  concern: StorageHealthConcernSchema,
  active: z.boolean(),
  occurrence: NonNegativeIntSchema,
  observedAt: IsoInstantSchema,
  samples: z.array(z.strictObject({ at: IsoInstantSchema, bytes: NonNegativeIntSchema })).max(3),
  createdAt: IsoInstantSchema,
});
const OwnerRowSchema = z.strictObject({ id: NotificationIdSchema, actor_id: ActorIdSchema, payload_json: z.string(), publications_json: z.string() });
const PublicationsSchema = z.array(NotificationPublicationSchema);
function ownerPublications(input: unknown) {
  const row = OwnerRowSchema.parse(input);
  const owner = NotificationRecordSchema.parse(JSON.parse(row.payload_json));
  const records = PublicationsSchema.parse(JSON.parse(row.publications_json));
  if (owner.notificationId !== row.id || owner.actorId !== row.actor_id) throw new Error("notification-publication-owner-mismatch");
  validateNotificationPublicationArray(owner,records);
  return { row, owner, records };
}
export function validateNotificationPublicationArray(ownerInput:unknown,publicationsInput:unknown) {
  const owner=NotificationRecordSchema.parse(ownerInput);
  const records=PublicationsSchema.parse(publicationsInput);
  const seen = new Set<string>();
  for (const record of records) {
    const projection = projectNotificationTrigger(record.event);
    if (seen.has(record.sourceId) || record.actorId !== owner.actorId || record.notificationId !== owner.notificationId
      || deriveNotificationDedupeFingerprint(record.event) !== owner.dedupeFingerprint
      || projection.trigger !== owner.trigger || projection.channel !== owner.channel
      || Date.parse(record.createdAt) < Date.parse(owner.createdAt)
      || Date.parse(record.occurredAt) > Date.parse(record.createdAt)
      || record.adopted && (record.occurredAt > owner.lastSeenAt || record.createdAt < owner.createdAt)) {
      throw new Error("notification-publication-identity-mismatch");
    }
    seen.add(record.sourceId);
  }
  return records;
}
export function createNotificationMetadataRepositories(deps: {
  database: DatabaseSync;
  mutate<T>(table: "notifications" | "notification_states", work: () => { result: T; changes: number }): T;
}) {
  const { database } = deps;
  const list = () => database.prepare("SELECT id,actor_id,payload_json,publications_json FROM notifications ORDER BY created_at,id").all()
    .flatMap(raw => ownerPublications(raw).records);
  const health = (raw: unknown) => {
    const row = z.strictObject({ id: StorageHealthConcernSchema, payload_json: z.string(), updated_at: IsoInstantSchema }).parse(raw);
    const record = NotificationHealthSchema.parse(JSON.parse(row.payload_json));
    if (record.concern !== row.id || record.observedAt !== row.updated_at) throw new Error("notification-health-identity-mismatch");
    return record;
  };
  return {
    notificationPublications: Object.freeze({
      get(id: string) { const sourceId = FingerprintSchema.parse(id); return list().find(record => record.sourceId === sourceId); },
      list,
      latest(id: string) {
        const row = database.prepare("SELECT id,actor_id,payload_json,publications_json FROM notifications WHERE id=?").get(NotificationIdSchema.parse(id));
        return row === undefined ? undefined : ownerPublications(row).records.filter(record => !record.adopted).at(-1);
      },
      create(input: unknown) { return deps.mutate("notifications", () => {
        const record = NotificationPublicationSchema.parse(input);
        const existing = list().find(saved => saved.sourceId === record.sourceId);
        if (existing !== undefined) {
          if (canonicalJsonStringify(existing) !== canonicalJsonStringify(record)) throw new Error("notification-publication-source-conflict");
          return { result: existing, changes: 0 };
        }
        const raw = database.prepare("SELECT id,actor_id,payload_json,publications_json FROM notifications WHERE id=?").get(record.notificationId);
        if (raw === undefined) throw new Error("notification-publication-owner-missing");
        const { row, records } = ownerPublications(raw);
        const next = canonicalJsonStringify([...records, record]);
        ownerPublications({ ...row, publications_json: next });
        const changes = Number(database.prepare("UPDATE notifications SET publications_json=? WHERE id=? AND publications_json=?").run(next, row.id, row.publications_json).changes);
        if (changes !== 1) throw new Error("notification-publication-version-conflict");
        return { result: record, changes };
      }); },
    }),
    notificationHealth: Object.freeze({
      get(concern: string) { const row = database.prepare("SELECT * FROM notification_states WHERE id=?").get(StorageHealthConcernSchema.parse(concern)); return row === undefined ? undefined : health(row); },
      put(input: unknown) { return deps.mutate("notification_states", () => {
        const record = NotificationHealthSchema.parse(input);
        database.prepare("INSERT INTO notification_states(id,payload_json,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at")
          .run(record.concern, canonicalJsonStringify(record), record.observedAt);
        return { result: record, changes: 1 };
      }); },
    }),
  };
}

export function validateNotificationMetadata(database: DatabaseSync): void {
  const seen = new Set<string>();
  const repositories = createNotificationMetadataRepositories({ database, mutate: () => { throw new Error("read-only notification admission"); } });
  for (const record of repositories.notificationPublications.list()) {
    if (seen.has(record.sourceId)) throw new Error("notification-publication-source-conflict");
    seen.add(record.sourceId);
  }
  for (const raw of database.prepare("SELECT id FROM notification_states").all()) {
    repositories.notificationHealth.get(z.strictObject({ id: z.string() }).parse(raw).id);
  }
}
