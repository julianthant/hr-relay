import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  ASSISTANT_ATTACHMENT_PROFILE_MAX_BYTES, ASSISTANT_ATTACHMENT_STAGE_TTL_MS, ASSISTANT_ATTACHMENT_TYPES, ASSISTANT_ATTACHMENTS_PER_SEND, AssistantAttachmentRecordSchema,
  type AssistantAttachmentMediaType, type AssistantAttachmentRecord,
} from "../../../models/dashboard/assistant.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

const MEDIA_TYPES = Object.keys(ASSISTANT_ATTACHMENT_TYPES).map(type => `'${type}'`).join(",");

export const ASSISTANT_ATTACHMENTS_MIGRATION = Object.freeze({ version: 24, statements: Object.freeze([
  `CREATE TABLE assistant_attachments (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES assistant_messages(id) ON DELETE CASCADE,
    ordinal INTEGER CHECK(ordinal IS NULL OR ordinal BETWEEN 1 AND ${String(ASSISTANT_ATTACHMENTS_PER_SEND)}),
    media_type TEXT NOT NULL CHECK(media_type IN (${MEDIA_TYPES})), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    byte_length INTEGER NOT NULL CHECK(byte_length>0), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    bytes BLOB NOT NULL CHECK(typeof(bytes)='blob' AND length(bytes)=byte_length),
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL CHECK(expires_at>created_at),
    UNIQUE(message_id,ordinal), CHECK((message_id IS NULL)=(ordinal IS NULL))
  ) STRICT`,
  "CREATE INDEX assistant_attachments_message ON assistant_attachments(message_id)",
  `CREATE TRIGGER assistant_attachments_accept_only BEFORE UPDATE ON assistant_attachments
    WHEN NOT (OLD.message_id IS NULL AND NEW.message_id IS NOT NULL
      AND NEW.id=OLD.id AND NEW.conversation_id=OLD.conversation_id AND NEW.media_type=OLD.media_type AND NEW.payload_json=OLD.payload_json
      AND NEW.byte_length=OLD.byte_length AND NEW.sha256=OLD.sha256 AND NEW.bytes=OLD.bytes AND NEW.created_at=OLD.created_at)
    BEGIN SELECT RAISE(ABORT,'assistant-attachment-immutable'); END`,
]) });

const RowSchema = z.strictObject({ id: z.uuid(), conversation_id: z.uuid(), message_id: z.uuid().nullable(), ordinal: z.number().int().nullable(),
  media_type: z.string(), payload_json: z.string(), byte_length: z.number().int(), sha256: z.string(), bytes: z.instanceof(Uint8Array),
  created_at: z.iso.datetime(), expires_at: z.iso.datetime() });

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Validates metadata and authenticates the stored bytes against their recorded length and digest. */
export function assistantAttachmentFromRow(input: unknown): AssistantAttachmentRecord & Readonly<{ bytes: Uint8Array }> {
  const row = RowSchema.parse(input);
  const payload = z.strictObject({ name: z.string() }).parse(JSON.parse(row.payload_json));
  const record = AssistantAttachmentRecordSchema.parse({ id: row.id, conversationId: row.conversation_id, messageId: row.message_id, ordinal: row.ordinal,
    mediaType: row.media_type, name: payload.name, byteLength: row.byte_length, sha256: row.sha256, createdAt: row.created_at, expiresAt: row.expires_at });
  if (row.bytes.byteLength !== record.byteLength || digest(row.bytes) !== record.sha256) throw new Error("assistant-attachment-bytes-invalid");
  return { ...record, bytes: row.bytes };
}

/** A native row in hashable form: each BLOB becomes its length and SHA-256, so fingerprints cover the actual bytes. */
export function byteAwareRow(row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? { byteLength: value.byteLength, sha256: digest(value) } : value]));
}

/** Stores, claims and reads chat attachments; every call runs inside the caller's authority transaction or read snapshot. */
export function createAssistantAttachmentStore(database: DatabaseSync, profileId: () => string, refuse: (code: "ASSISTANT_ATTACHMENT_UNAVAILABLE" | "ASSISTANT_ATTACHMENT_STORAGE_LIMIT") => never) {
  const read = (sql: string, ...params: (string | number | null)[]) => database.prepare(sql).all(...params).map(assistantAttachmentFromRow);
  const storedBytes = (now: string) => z.object({ bytes: z.number() }).parse(database.prepare(`SELECT COALESCE(SUM(a.byte_length),0) AS bytes FROM assistant_attachments a
    JOIN assistant_conversations c ON c.id=a.conversation_id WHERE c.profile_id=? AND a.expires_at>?`).get(profileId(), now)).bytes;
  return Object.freeze({
    /** Stages validated bytes under an owned, unexpired chat until the earlier of 15 minutes and the chat's expiry. */
    stage(input: Readonly<{ id: string; conversationId: string; chatExpiresAt: string; mediaType: AssistantAttachmentMediaType; name: string; bytes: Uint8Array; now: string }>): AssistantAttachmentRecord {
      if (storedBytes(input.now) + input.bytes.byteLength > ASSISTANT_ATTACHMENT_PROFILE_MAX_BYTES) refuse("ASSISTANT_ATTACHMENT_STORAGE_LIMIT");
      const stageEnd = new Date(Date.parse(input.now) + ASSISTANT_ATTACHMENT_STAGE_TTL_MS).toISOString();
      const record = AssistantAttachmentRecordSchema.parse({ id: input.id, conversationId: input.conversationId, messageId: null, ordinal: null, mediaType: input.mediaType,
        name: input.name, byteLength: input.bytes.byteLength, sha256: digest(input.bytes), createdAt: input.now,
        expiresAt: stageEnd < input.chatExpiresAt ? stageEnd : input.chatExpiresAt });
      database.prepare("INSERT INTO assistant_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(record.id, record.conversationId, null, null, record.mediaType,
        canonicalJsonStringify({ name: record.name }), record.byteLength, record.sha256, input.bytes, record.createdAt, record.expiresAt);
      return record;
    },
    /** Claims owned, unexpired stages for a new turn in send order; any missing, foreign, consumed or expired stage refuses the whole send. */
    accept(conversationId: string, messageId: string, ids: readonly string[], chatExpiresAt: string, now: string): void {
      ids.forEach((id, index) => {
        const changed = database.prepare(`UPDATE assistant_attachments SET message_id=?,ordinal=?,expires_at=? WHERE id=? AND conversation_id=? AND message_id IS NULL AND expires_at>?`)
          .run(messageId, index + 1, chatExpiresAt, id, conversationId, now).changes;
        if (changed !== 1) refuse("ASSISTANT_ATTACHMENT_UNAVAILABLE");
      });
    },
    /** The accepted attachments of one turn, in send order, with authenticated bytes. */
    ofMessage: (messageId: string) => read("SELECT * FROM assistant_attachments WHERE message_id=? ORDER BY ordinal", messageId),
    /** Stages and expired rows that no live send can claim. */
    reclaim(now: string, startup: boolean): number {
      return Number(database.prepare(`DELETE FROM assistant_attachments WHERE expires_at<=?${startup ? " OR message_id IS NULL" : ""}`).run(now).changes);
    },
  });
}
export type AssistantAttachmentStore = ReturnType<typeof createAssistantAttachmentStore>;
