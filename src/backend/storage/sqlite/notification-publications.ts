import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { ActorIdSchema, FingerprintSchema, IsoInstantSchema, NotificationIdSchema, NonNegativeIntSchema } from "../../../rules/identity/ids.js";
import { NotificationTriggerEventSchema, StorageHealthConcernSchema } from "../../../rules/notifications/notification-triggers.js";

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
export const NOTIFICATION_PUBLICATIONS_DDL = `CREATE TABLE notification_publications (
  record_key TEXT PRIMARY KEY, notification_id TEXT NOT NULL REFERENCES notifications(record_key),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL
) STRICT`;
export const NOTIFICATION_HEALTH_DDL = `CREATE TABLE notification_health (
  record_key TEXT PRIMARY KEY, record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL
) STRICT`;
const JsonRow = z.object({ record_json: z.string() });
export function createNotificationMetadataRepositories(deps: {
  database: DatabaseSync;
  mutate<T>(table: "notification_publications" | "notification_health", work: () => { result: T; changes: number }): T;
}) {
  const { database } = deps;
  const publication = (row: unknown) => NotificationPublicationSchema.parse(JSON.parse(JsonRow.parse(row).record_json));
  const health = (row: unknown) => NotificationHealthSchema.parse(JSON.parse(JsonRow.parse(row).record_json));
  return {
    notificationPublications: Object.freeze({
      get: (id: string) => { const row = database.prepare("SELECT record_json FROM notification_publications WHERE record_key=?").get(FingerprintSchema.parse(id)); return row === undefined ? undefined : publication(row); },
      list: () => database.prepare("SELECT record_json FROM notification_publications ORDER BY rowid").all().map(publication),
      latest: (id: string) => { const row = database.prepare("SELECT record_json FROM notification_publications WHERE notification_id=? AND json_extract(record_json,'$.adopted')=0 ORDER BY rowid DESC LIMIT 1").get(NotificationIdSchema.parse(id)); return row === undefined ? undefined : publication(row); },
      create: (input: unknown) => deps.mutate("notification_publications", () => {
        const record = NotificationPublicationSchema.parse(input);
        const owner = database.prepare("SELECT actor_id FROM notifications WHERE record_key=?").get(record.notificationId);
        if (owner === undefined || z.object({ actor_id: ActorIdSchema }).parse(owner).actor_id !== record.actorId) throw new Error("notification-publication-owner-mismatch");
        database.prepare("INSERT INTO notification_publications(record_key,notification_id,record_json,created_at) VALUES (?,?,?,?)")
          .run(record.sourceId, record.notificationId, canonicalJsonStringify(record), record.createdAt);
        return { result: record, changes: 1 };
      }),
    }),
    notificationHealth: Object.freeze({
      get: (concern: string) => { const row = database.prepare("SELECT record_json FROM notification_health WHERE record_key=?").get(StorageHealthConcernSchema.parse(concern)); return row === undefined ? undefined : health(row); },
      put: (input: unknown) => deps.mutate("notification_health", () => {
        const record = NotificationHealthSchema.parse(input);
        database.prepare("INSERT INTO notification_health(record_key,record_json,created_at) VALUES (?,?,?) ON CONFLICT(record_key) DO UPDATE SET record_json=excluded.record_json")
          .run(record.concern, canonicalJsonStringify(record), record.createdAt);
        return { result: record, changes: 1 };
      }),
    }),
  };
}

/** Strict ownership/key validation also runs on restored and converted authorities. */
export function validateNotificationMetadata(database: DatabaseSync): void {
  for (const raw of database.prepare("SELECT p.*, n.actor_id FROM notification_publications p LEFT JOIN notifications n ON n.record_key=p.notification_id").all()) {
    const row = z.object({ record_key: FingerprintSchema, notification_id: NotificationIdSchema, record_json: z.string(), created_at: IsoInstantSchema, actor_id: ActorIdSchema }).parse(raw);
    const record = NotificationPublicationSchema.parse(JSON.parse(row.record_json));
    if (record.sourceId !== row.record_key || record.notificationId !== row.notification_id || record.actorId !== row.actor_id || record.createdAt !== row.created_at) throw new Error("notification-publication-identity-mismatch");
  }
  for (const raw of database.prepare("SELECT * FROM notification_health").all()) {
    const row = z.object({ record_key: StorageHealthConcernSchema, record_json: z.string(), created_at: IsoInstantSchema }).parse(raw);
    const record = NotificationHealthSchema.parse(JSON.parse(row.record_json));
    if (record.concern !== row.record_key || record.createdAt !== row.created_at) throw new Error("notification-health-identity-mismatch");
  }
}
