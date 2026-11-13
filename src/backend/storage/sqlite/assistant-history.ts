import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  AssistantAcceptedTurnSchema, AssistantHistoryOperationSchema, AssistantM1MessageRecordSchema, AssistantM1ConversationViewSchema, AssistantM1SettlementSchema, assistantReplyDisplayUnits,
  type AssistantM1MessageRecord, type AssistantM1ConversationView, type AssistantM1Settlement, type AssistantAcceptedTurn,
  ASSISTANT_CHATS_MAX, ASSISTANT_CHAT_TTL_MS, type AssistantAttachmentMediaType, type AssistantAttachmentRecord, ASSISTANT_HISTORY_METADATA_MAX_UNITS, ASSISTANT_MESSAGES_MAX, AssistantConversationRecordSchema, AssistantMessageRecordSchema, AssistantM1MessagePayloadSchema, type AssistantM1MessagePayload,
  type AssistantConversationRecord, type AssistantConversationView, type AssistantDeliverySchema, type AssistantFailureCode, type AssistantHistoryOperation,
  type AssistantHistoryResult, type AssistantHistoryView, type AssistantMessageRecord,
} from "../../../models/dashboard/assistant.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { createAssistantAttachmentStore } from "./assistant-attachments.js";

export const ASSISTANT_HISTORY_MIGRATION = Object.freeze({ version: 26, statements: Object.freeze([
  `CREATE TABLE assistant_conversations (
    id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), selected_at TEXT,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), draft TEXT NOT NULL, composer TEXT NOT NULL,
    import_total INTEGER NOT NULL CHECK(import_total BETWEEN 0 AND ${String(ASSISTANT_MESSAGES_MAX)}),
    import_notice TEXT CHECK(import_notice IS NULL OR import_notice IN ('unknown','proposal-expired')),
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL CHECK(expires_at>created_at)
  ) STRICT`,
  `CREATE TABLE assistant_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK(ordinal>0), role TEXT NOT NULL CHECK(role IN ('operator','assistant')),
    kind TEXT NOT NULL CHECK(kind IN ('turn','answer','proposal','decision','inert')),
    model_text TEXT, subject_ref TEXT, action_id TEXT,
    delivery TEXT NOT NULL CHECK(delivery IN ('sending','answered','refused','delivery-unknown','settled')), code TEXT,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(conversation_id,ordinal),
    CHECK((kind='inert')=(model_text IS NULL)),
    CHECK((kind='turn')=(role='operator' AND delivery<>'settled')),
    CHECK(kind='turn' OR delivery='settled'),
    CHECK((code IS NOT NULL)=(delivery='refused')),
    CHECK(subject_ref IS NULL OR kind='turn'),
    CHECK((action_id IS NOT NULL)=(kind IN ('proposal','decision')))
  ) STRICT`,
  "CREATE UNIQUE INDEX assistant_messages_one_sending ON assistant_messages(conversation_id) WHERE delivery='sending'",
  "CREATE UNIQUE INDEX assistant_messages_one_decision ON assistant_messages(action_id) WHERE kind='decision'",
  `CREATE TRIGGER assistant_messages_settle_only BEFORE UPDATE ON assistant_messages
    WHEN NOT (OLD.delivery='sending' AND NEW.delivery IN ('answered','refused','delivery-unknown')
      AND NEW.id=OLD.id AND NEW.conversation_id=OLD.conversation_id AND NEW.ordinal=OLD.ordinal AND NEW.role=OLD.role AND NEW.kind=OLD.kind
      AND NEW.model_text IS OLD.model_text AND NEW.subject_ref IS OLD.subject_ref AND NEW.action_id IS OLD.action_id
      AND NEW.payload_json=OLD.payload_json AND NEW.created_at=OLD.created_at)
    BEGIN SELECT RAISE(ABORT,'assistant-message-immutable'); END`,
]) });

const Iso = z.iso.datetime();
const ConversationRowSchema = z.strictObject({ id: z.uuid(), profile_id: z.uuid(), revision: z.number().int().positive(), selected_at: Iso.nullable(),
  payload_json: z.string(), draft: z.string(), composer: z.string(), import_total: z.number().int(), import_notice: z.string().nullable(), created_at: Iso, expires_at: Iso });
const MessageRowSchema = z.strictObject({ id: z.uuid(), conversation_id: z.uuid(), ordinal: z.number().int(), role: z.string(), kind: z.string(),
  model_text: z.string().nullable(), subject_ref: z.string().nullable(), action_id: z.string().nullable(), delivery: z.string(), code: z.string().nullable(),
  payload_json: z.string(), created_at: Iso, updated_at: Iso });

export function assistantConversationFromRow(input: unknown): AssistantConversationRecord {
  const row = ConversationRowSchema.parse(input);
  const payload = z.strictObject({ title: z.string() }).parse(JSON.parse(row.payload_json));
  const record = AssistantConversationRecordSchema.parse({ id: row.id, profileId: row.profile_id, revision: row.revision, selectedAt: row.selected_at,
    title: payload.title, draft: row.draft, composer: row.composer, importTotal: row.import_total, importNotice: row.import_notice, createdAt: row.created_at, expiresAt: row.expires_at });
  if (Date.parse(record.expiresAt) - Date.parse(record.createdAt) !== ASSISTANT_CHAT_TTL_MS) throw new Error("assistant-conversation-expiry-invalid");
  return record;
}
export function assistantMessageFromRow(input: unknown): AssistantMessageRecord {
  const row = MessageRowSchema.parse(input);
  const payload = z.strictObject({ text: z.string() }).parse(JSON.parse(row.payload_json));
  return AssistantMessageRecordSchema.parse({ id: row.id, conversationId: row.conversation_id, ordinal: row.ordinal, role: row.role, kind: row.kind,
    modelText: row.model_text, subjectRef: row.subject_ref, actionId: row.action_id, delivery: row.delivery, code: row.code, text: payload.text,
    createdAt: row.created_at, updatedAt: row.updated_at });
}

/** Unregistered payload conversion; row ownership and correlation admission remain with the native owner. */
export function convertAssistantHistoryPayloadToM1(input: unknown): AssistantM1MessagePayload {
  const { text } = z.strictObject({ text: z.string().max(8000) }).parse(input);
  return AssistantM1MessagePayloadSchema.parse({ parts: text === "" ? [] : [{ kind: "text", runs: [{ kind: "plain", text }] }],
    recording: { kind: "unrecorded", usage: { state: "unrecorded" } } });
}

/** A refused history write; the code is a catalog code the route and service return as data. */
export class AssistantHistoryRefusal extends Error {
  constructor(readonly code: AssistantFailureCode) { super(code); this.name = "AssistantHistoryRefusal"; }
}
const refuse = (code: AssistantFailureCode): never => { throw new AssistantHistoryRefusal(code); };

type Delivery = z.infer<typeof AssistantDeliverySchema>;
type Table = "assistant_conversations" | "assistant_messages" | "assistant_attachments";
interface Ports {
  database: DatabaseSync;
  profileId(): string;
  read<T>(work: () => T): T;
  mutate<T>(table: Table, work: () => Readonly<{ result: T; changes: number }>): T;
}
export type AssistantAcceptance =
  | Readonly<{ state: "accepted"; ordinal: number; revision: number; createdAt: string }>
  | Readonly<{ state: "repeat"; ordinal: number; revision: number; delivery: Exclude<Delivery, "settled"> }>;
export type AssistantSettlement = Readonly<{ delivery: "answered" | "refused" | "delivery-unknown"; code?: AssistantFailureCode;
  reply?: Readonly<{ id: string; kind: "answer" | "proposal"; text: string; modelText: string; actionId?: string }> }>;

export function createAssistantHistoryRepository(ports: Ports) {
  const { database } = ports;
  const files = createAssistantAttachmentStore(database, () => ports.profileId(), refuse);
  const fileNames = (messageId: string) => database.prepare("SELECT id,json_extract(payload_json,'$.name') AS name FROM assistant_attachments WHERE message_id=? ORDER BY ordinal")
    .all(messageId).map(row => z.object({ id: z.uuid(), name: z.string() }).parse(row));
  const conversationRow = (id: string) => {
    const row = database.prepare("SELECT * FROM assistant_conversations WHERE id=?").get(id);
    return row === undefined ? undefined : assistantConversationFromRow(row);
  };
  /** Owned and unexpired, independently of physical cleanup. */
  const owned = (id: string, now: string) => {
    const record = conversationRow(id);
    return record === undefined || record.profileId !== ports.profileId() || record.expiresAt <= now ? undefined : record;
  };
  const requireOwned = (id: string, now: string) => owned(id, now) ?? refuse("ASSISTANT_CONVERSATION_STALE");
  const requireRevision = (id: string, expected: number, now: string) => {
    const record = requireOwned(id, now);
    if (record.revision !== expected) refuse("ASSISTANT_CONVERSATION_STALE");
    return record;
  };
  const messages = (conversationId: string) => database.prepare("SELECT * FROM assistant_messages WHERE conversation_id=? ORDER BY ordinal")
    .all(conversationId).map(assistantMessageFromRow);
  const messageRow = (id: string) => {
    const row = database.prepare("SELECT * FROM assistant_messages WHERE id=?").get(id);
    return row === undefined ? undefined : assistantMessageFromRow(row);
  };
  const nextOrdinal = (conversationId: string) => z.object({ next: z.number().int() }).parse(
    database.prepare("SELECT COALESCE(MAX(ordinal),0)+1 AS next FROM assistant_messages WHERE conversation_id=?").get(conversationId)).next;
  const bump = (id: string) => {
    database.prepare("UPDATE assistant_conversations SET revision=revision+1 WHERE id=?").run(id);
    return z.object({ revision: z.number().int().positive() }).parse(database.prepare("SELECT revision FROM assistant_conversations WHERE id=?").get(id)).revision;
  };
  const insertMessage = (message: AssistantMessageRecord) => {
    AssistantMessageRecordSchema.parse(message);
    database.prepare("INSERT INTO assistant_messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(message.id, message.conversationId, message.ordinal, message.role,
      message.kind, message.modelText, message.subjectRef, message.actionId, message.delivery, message.code, canonicalJsonStringify({ text: message.text }),
      message.createdAt, message.updatedAt);
  };
  const hasSending = (conversationId: string) => database.prepare("SELECT 1 FROM assistant_messages WHERE conversation_id=? AND delivery='sending'").get(conversationId) !== undefined;
  /** The next ordinal for `count` rows; an accepted turn keeps one slot for its reply. */
  const appendable = (conversationId: string, count = 1) => {
    const ordinal = nextOrdinal(conversationId);
    if (ordinal + count - 1 + (hasSending(conversationId) ? 1 : 0) > ASSISTANT_MESSAGES_MAX) refuse("ASSISTANT_CHAT_FULL");
    return ordinal;
  };
  const textUnits = (sql: string, now: string) => database.prepare(sql).all(ports.profileId(), now)
    .reduce<number>((sum, row) => sum + Object.values(row).reduce<number>((units, value) => units + String(value).length, 0), 0);
  /** Refuses a write that leaves the profile's unexpired titles, drafts and display text above the metadata budget. */
  const withinBudget = <T>(now: string, write: Readonly<{ result: T; changes: number }>) => {
    const units = textUnits("SELECT json_extract(payload_json,'$.title') AS title,draft,composer FROM assistant_conversations WHERE profile_id=? AND expires_at>?", now)
      + textUnits("SELECT json_extract(m.payload_json,'$.text') AS text FROM assistant_messages m JOIN assistant_conversations c ON c.id=m.conversation_id WHERE c.profile_id=? AND c.expires_at>?", now);
    if (units > ASSISTANT_HISTORY_METADATA_MAX_UNITS) refuse("ASSISTANT_HISTORY_FULL");
    return write;
  };
  const insertConversation = (record: AssistantConversationRecord) => {
    if (z.object({ count: z.number() }).parse(database.prepare("SELECT COUNT(*) AS count FROM assistant_conversations WHERE profile_id=? AND expires_at>?")
      .get(record.profileId, record.createdAt)).count >= ASSISTANT_CHATS_MAX) refuse("ASSISTANT_CHAT_LIMIT");
    database.prepare("INSERT INTO assistant_conversations VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(record.id, record.profileId, record.revision, record.selectedAt,
      canonicalJsonStringify({ title: record.title }), record.draft, record.composer, record.importTotal, record.importNotice, record.createdAt, record.expiresAt);
  };
  const newConversation = (id: string, title: string, now: string, extra: Partial<AssistantConversationRecord> = {}) => AssistantConversationRecordSchema.parse({
    id, profileId: ports.profileId(), revision: 1, selectedAt: null, title, draft: "", composer: "", importTotal: 0, importNotice: null,
    createdAt: now, expiresAt: new Date(Date.parse(now) + ASSISTANT_CHAT_TTL_MS).toISOString(), ...extra });
  const saved = (conversationId: string, revision: number): AssistantHistoryResult => ({ state: "saved", conversationId, revision });
  const sameRows = (actual: readonly AssistantMessageRecord[], expected: readonly Readonly<{ messageId: string; role: string; text: string }>[], start: number) =>
    actual.length === expected.length && expected.every((message, index) => {
      const row = actual[index];
      return row.id === message.messageId && row.ordinal === start + index && row.role === message.role && row.text === message.text && row.kind === "inert";
    });

  function apply(operation: AssistantHistoryOperation, now: string): AssistantHistoryResult {
    switch (operation.operation) {
      case "create": return ports.mutate("assistant_conversations", () => {
        const existing = conversationRow(operation.conversationId);
        if (existing !== undefined) {
          if (existing.profileId !== ports.profileId() || existing.expiresAt <= now || existing.title !== operation.title) refuse("ASSISTANT_CONVERSATION_STALE");
          return { result: saved(existing.id, existing.revision), changes: 0 };
        }
        insertConversation(newConversation(operation.conversationId, operation.title, now, { selectedAt: now }));
        return withinBudget(now, { result: saved(operation.conversationId, 1), changes: 1 });
      });
      case "rename": return ports.mutate("assistant_conversations", () => {
        requireRevision(operation.conversationId, operation.expectedRevision, now);
        database.prepare("UPDATE assistant_conversations SET payload_json=? WHERE id=?").run(canonicalJsonStringify({ title: operation.title }), operation.conversationId);
        return withinBudget(now, { result: saved(operation.conversationId, bump(operation.conversationId)), changes: 1 });
      });
      case "select": return ports.mutate("assistant_conversations", () => {
        requireRevision(operation.conversationId, operation.expectedRevision, now);
        database.prepare("UPDATE assistant_conversations SET selected_at=? WHERE id=?").run(now, operation.conversationId);
        return { result: saved(operation.conversationId, bump(operation.conversationId)), changes: 1 };
      });
      case "clear": return ports.mutate("assistant_conversations", () => {
        requireRevision(operation.conversationId, operation.expectedRevision, now);
        const sending = database.prepare("SELECT 1 FROM assistant_messages WHERE conversation_id=? AND delivery='sending'").get(operation.conversationId) !== undefined;
        database.prepare("DELETE FROM assistant_conversations WHERE id=?").run(operation.conversationId);
        return { result: { state: "cleared", conversationId: operation.conversationId, transmissionMayHaveStarted: sending }, changes: 1 };
      });
      case "draft": return ports.mutate("assistant_conversations", () => {
        const record = requireOwned(operation.conversationId, now);
        database.prepare("UPDATE assistant_conversations SET draft=?,composer=? WHERE id=?").run(operation.draft, operation.composer, operation.conversationId);
        return withinBudget(now, { result: saved(record.id, record.revision), changes: 1 });
      });
      case "local": return ports.mutate("assistant_messages", () => {
        requireRevision(operation.conversationId, operation.expectedRevision, now);
        if (messageRow(operation.messageId) !== undefined) refuse("ASSISTANT_CONVERSATION_STALE");
        insertMessage({ id: operation.messageId, conversationId: operation.conversationId, ordinal: appendable(operation.conversationId), role: "assistant", kind: "inert",
          modelText: null, subjectRef: null, actionId: null, delivery: "settled", code: null, text: operation.text, createdAt: now, updatedAt: now });
        return withinBudget(now, { result: saved(operation.conversationId, bump(operation.conversationId)), changes: 1 });
      });
      case "import": return ports.mutate("assistant_messages", () => {
        const expected = { title: operation.title, draft: operation.draft, composer: operation.composer, importTotal: operation.total, importNotice: operation.notice };
        let record = conversationRow(operation.conversationId);
        if (record === undefined) {
          if (operation.start !== 1) refuse("ASSISTANT_CONVERSATION_STALE");
          record = newConversation(operation.conversationId, operation.title, now, expected);
          insertConversation(record);
        } else if (record.profileId !== ports.profileId() || record.expiresAt <= now
          || canonicalJsonStringify({ title: record.title, draft: record.draft, composer: record.composer, importTotal: record.importTotal, importNotice: record.importNotice })
            !== canonicalJsonStringify(expected)) refuse("ASSISTANT_CONVERSATION_STALE");
        const existing = messages(operation.conversationId).filter(row => row.ordinal >= operation.start && row.ordinal < operation.start + operation.messages.length);
        if (existing.length > 0) {
          if (!sameRows(existing, operation.messages, operation.start)) refuse("ASSISTANT_CONVERSATION_STALE");
          return { result: saved(record.id, record.revision), changes: 0 };
        }
        if (appendable(operation.conversationId, operation.messages.length) !== operation.start) refuse("ASSISTANT_CONVERSATION_STALE");
        operation.messages.forEach((message, index) => {
          if (messageRow(message.messageId) !== undefined) refuse("ASSISTANT_CONVERSATION_STALE");
          insertMessage({ id: message.messageId, conversationId: operation.conversationId, ordinal: operation.start + index, role: message.role, kind: "inert",
            modelText: null, subjectRef: null, actionId: null, delivery: "settled", code: null, text: message.text, createdAt: now, updatedAt: now });
        });
        return withinBudget(now, { result: saved(record.id, operation.messages.length === 0 ? record.revision : bump(operation.conversationId)), changes: 1 });
      });
    }
  }

  return Object.freeze({
    apply,
    list(now: string): AssistantHistoryView {
      return ports.read(() => {
        const chats = database.prepare("SELECT * FROM assistant_conversations WHERE profile_id=? AND expires_at>? ORDER BY created_at DESC, id")
          .all(ports.profileId(), now).map(assistantConversationFromRow);
        const selected = [...chats].sort((left, right) => (right.selectedAt ?? "").localeCompare(left.selectedAt ?? ""))[0];
        return { chats: chats.map(chat => ({ id: chat.id, title: chat.title, revision: chat.revision, createdAt: chat.createdAt, expiresAt: chat.expiresAt })),
          selectedId: selected?.selectedAt === null || selected === undefined ? null : selected.id };
      });
    },
    conversation(id: string, now: string): AssistantConversationView | undefined {
      return ports.read(() => {
        const record = owned(id, now);
        return record === undefined ? undefined : { id: record.id, title: record.title, revision: record.revision, draft: record.draft, composer: record.composer,
          importTotal: record.importTotal, importNotice: record.importNotice,
          messages: messages(id).map(row => ({ id: row.id, ordinal: row.ordinal, role: row.role, kind: row.kind, text: row.text, delivery: row.delivery, code: row.code, actionId: row.actionId,
            attachments: row.kind === "turn" ? fileNames(row.id) : [] })) };
      });
    },
    /** Repeat first, then the new-message CAS; only an `accepted` result carries the inference right. */
    /** Stages one validated upload under an owned, unexpired chat; nothing reaches the model until a send claims it. */
    stage(input: Readonly<{ id: string; conversationId: string; mediaType: AssistantAttachmentMediaType; name: string; bytes: Uint8Array; now: string }>): AssistantAttachmentRecord {
      return ports.mutate("assistant_attachments", () => {
        const chat = requireOwned(input.conversationId, input.now);
        return { result: files.stage({ ...input, chatExpiresAt: chat.expiresAt }), changes: 1 };
      });
    },
    accept(input: Readonly<{ conversationId: string; expectedRevision: number; messageId: string; text: string; modelText: string; subjectRef: string | null;
      attachments: readonly string[]; now: string }>): AssistantAcceptance {
      return ports.mutate("assistant_messages", (): { result: AssistantAcceptance; changes: number } => {
        const record = requireOwned(input.conversationId, input.now), prior = messageRow(input.messageId);
        if (prior !== undefined) {
          if (prior.kind !== "turn" || prior.conversationId !== input.conversationId || prior.text !== input.text || prior.subjectRef !== input.subjectRef
            || prior.delivery === "settled" || canonicalJsonStringify(fileNames(prior.id).map(file => file.id)) !== canonicalJsonStringify(input.attachments)) refuse("ASSISTANT_CONVERSATION_STALE");
          return { result: { state: "repeat", ordinal: prior.ordinal, revision: record.revision, delivery: prior.delivery as Exclude<Delivery, "settled"> }, changes: 0 };
        }
        if (record.revision !== input.expectedRevision) refuse("ASSISTANT_CONVERSATION_STALE");
        if (hasSending(input.conversationId)) refuse("ASSISTANT_CONVERSATION_BUSY");
        const ordinal = appendable(input.conversationId, 2);
        insertMessage({ id: input.messageId, conversationId: input.conversationId, ordinal, role: "operator", kind: "turn", modelText: input.modelText,
          subjectRef: input.subjectRef, actionId: null, delivery: "sending", code: null, text: input.text, createdAt: input.now, updatedAt: input.now });
        files.accept(input.conversationId, input.messageId, input.attachments, record.expiresAt, input.now);
        return withinBudget(input.now, { result: { state: "accepted", ordinal, revision: bump(input.conversationId), createdAt: record.createdAt }, changes: 1 });
      });
    },
    nextOrdinal: (conversationId: string) => ports.read(() => nextOrdinal(conversationId)),
    /** The attempt is current while its conversation (same creation) is owned and unexpired and the turn is still `sending`. */
    sending(conversationId: string, createdAt: string, messageId: string, now: string): boolean {
      const row = database.prepare(`SELECT 1 FROM assistant_messages m JOIN assistant_conversations c ON c.id=m.conversation_id
        WHERE m.id=? AND c.id=? AND c.created_at=? AND c.profile_id=? AND c.expires_at>? AND m.delivery='sending'`)
        .get(messageId, conversationId, createdAt, ports.profileId(), now);
      return row !== undefined;
    },
    /** One turn's accepted attachments in send order, with authenticated bytes. */
    turnAttachments: (messageId: string) => ports.read(() => files.ofMessage(messageId)),
    /** An accepted attachment of an owned, unexpired chat; undefined when gone, foreign or expired. */
    attachment: (conversationId: string, id: string, now: string) => ports.read(() => owned(conversationId, now) === undefined ? undefined : files.accepted(conversationId, id, now)),
    /** Earlier rows with replay text, in order; never `inert` rows or the current turn. Operator turns carry their id for their attachments. */
    replay(conversationId: string, beforeOrdinal: number): readonly Readonly<{ role: "operator" | "assistant"; modelText: string; messageId?: string }>[] {
      return ports.read(() => messages(conversationId).flatMap(row => row.ordinal < beforeOrdinal && row.modelText !== null && row.delivery !== "sending"
        ? [{ role: row.role, modelText: row.modelText, ...(row.kind === "turn" ? { messageId: row.id } : {}) }] : []));
    },
    /** One guarded settlement; returns the new revision, or undefined when the turn is gone, expired or already settled. */
    settle(conversationId: string, messageId: string, settlement: AssistantSettlement, now: string): number | undefined {
      return ports.mutate("assistant_messages", () => {
        if (owned(conversationId, now) === undefined) return { result: undefined, changes: 0 };
        const changed = database.prepare("UPDATE assistant_messages SET delivery=?,code=?,updated_at=? WHERE id=? AND conversation_id=? AND delivery='sending'")
          .run(settlement.delivery, settlement.code ?? null, now, messageId, conversationId).changes;
        if (changed === 0) return { result: undefined, changes: 0 };
        const reply = settlement.reply;
        if (reply !== undefined) insertMessage({ id: reply.id, conversationId, ordinal: appendable(conversationId), role: "assistant", kind: reply.kind,
          modelText: reply.modelText, subjectRef: null, actionId: reply.actionId ?? null, delivery: "settled", code: null, text: reply.text, createdAt: now, updatedAt: now });
        return withinBudget(now, { result: bump(conversationId), changes: 1 });
      });
    },
    /** At most one caption per action; nothing when the conversation was cleared or expired; a full chat or budget refuses. `modelText` defaults to the display text. */
    appendDecision(input: Readonly<{ conversationId: string; actionId: string; messageId: string; text: string; modelText?: string; now: string }>): void {
      ports.mutate("assistant_messages", () => {
        if (owned(input.conversationId, input.now) === undefined
          || database.prepare("SELECT 1 FROM assistant_messages WHERE action_id=? AND kind='decision'").get(input.actionId) !== undefined) return { result: undefined, changes: 0 };
        insertMessage({ id: input.messageId, conversationId: input.conversationId, ordinal: appendable(input.conversationId), role: "assistant", kind: "decision",
          modelText: input.modelText ?? input.text, subjectRef: null, actionId: input.actionId, delivery: "settled", code: null, text: input.text, createdAt: input.now, updatedAt: input.now });
        bump(input.conversationId);
        return withinBudget(input.now, { result: undefined, changes: 1 });
      });
    },
    /** Startup: every unfinished send becomes `delivery-unknown`; it is never resumed. */
    settleInterrupted(now: string): number {
      return ports.mutate("assistant_messages", () => {
        const ids = database.prepare("SELECT conversation_id FROM assistant_messages WHERE delivery='sending'").all()
          .map(row => z.object({ conversation_id: z.uuid() }).parse(row).conversation_id);
        const changes = Number(database.prepare("UPDATE assistant_messages SET delivery='delivery-unknown',updated_at=? WHERE delivery='sending'").run(now).changes);
        for (const id of ids) bump(id);
        return { result: changes, changes: changes + files.reclaim(now, true) };
      });
    },
    reclaimExpired(now: string): number {
      return ports.mutate("assistant_conversations", () => {
        const changes = Number(database.prepare("DELETE FROM assistant_conversations WHERE expires_at<=?").run(now).changes);
        return { result: changes, changes: changes + files.reclaim(now, false) };
      });
    },
  });
}
export type AssistantHistoryRepository = ReturnType<typeof createAssistantHistoryRepository>;


/** Installed only by the stopped activation owner; the prepared factory never changes schema. */
export const ASSISTANT_M1_HISTORY_STATEMENTS = Object.freeze([
  "DROP TRIGGER assistant_messages_settle_only",
  `CREATE TRIGGER assistant_messages_settle_only BEFORE UPDATE ON assistant_messages
    WHEN NOT COALESCE((OLD.delivery='sending' AND NEW.delivery IN ('answered','refused','delivery-unknown')
      AND NEW.id=OLD.id AND NEW.conversation_id=OLD.conversation_id AND NEW.ordinal=OLD.ordinal AND NEW.role=OLD.role AND NEW.kind=OLD.kind
      AND NEW.model_text IS OLD.model_text AND NEW.subject_ref IS OLD.subject_ref AND NEW.action_id IS OLD.action_id AND NEW.created_at=OLD.created_at
      AND ((NEW.delivery='delivery-unknown' AND NEW.payload_json=OLD.payload_json)
        OR (json_extract(OLD.payload_json,'$.recording.kind')='accepted-turn'
          AND json_extract(OLD.payload_json,'$.recording.usage.state')='pending'
          AND json_extract(NEW.payload_json,'$.recording.usage.state') IN ('measured','unavailable')
          AND json_remove(NEW.payload_json,'$.recording.usage')=json_remove(OLD.payload_json,'$.recording.usage')))),0)
    BEGIN SELECT RAISE(ABORT,'assistant-message-immutable'); END`,
]);
export function assistantM1MessageFromRow(input: unknown): AssistantM1MessageRecord {
  const row = MessageRowSchema.parse(input);
  return AssistantM1MessageRecordSchema.parse({ id: row.id, conversationId: row.conversation_id, ordinal: row.ordinal, role: row.role, kind: row.kind,
    modelText: row.model_text, subjectRef: row.subject_ref, actionId: row.action_id, delivery: row.delivery, code: row.code,
    payload: AssistantM1MessagePayloadSchema.parse(JSON.parse(row.payload_json)), createdAt: row.created_at, updatedAt: row.updated_at });
}
export type AssistantM1Attempt = Readonly<{ conversationCreatedAt: string; acceptedTurn: AssistantAcceptedTurn }>;
export type AssistantM1Acceptance =
  | Readonly<{ state: "accepted"; ordinal: number; revision: number; conversationCreatedAt: string; acceptedTurn: AssistantAcceptedTurn }>
  | Readonly<{ state: "repeat"; ordinal: number; revision: number; delivery: Exclude<Delivery, "settled">;
    conversationCreatedAt: string; acceptedTurn: AssistantAcceptedTurn; usage: Extract<AssistantM1MessagePayload["recording"], { kind: "accepted-turn" }>["usage"] }>;

type AssistantM1RepeatInput = Readonly<{ conversationId: string; messageId: string; text: string; subjectRef: string | null; attachments: readonly string[]; now: string }>;

export function createAssistantM1HistoryRepository(ports: Ports & Readonly<{ epoch(): number; afterCommit(publish: () => void): void }>) {
  const { database } = ports, profileId = z.uuid().parse(ports.profileId());
  const liveAttempts = new Map<string, AssistantM1Attempt>();
  const files = createAssistantAttachmentStore(database, () => profileId, refuse);
  const fileNames = (messageId: string) => database.prepare("SELECT id,json_extract(payload_json,'$.name') AS name FROM assistant_attachments WHERE message_id=? ORDER BY ordinal")
    .all(messageId).map(row => z.object({ id: z.uuid(), name: z.string() }).parse(row));
  const conversationRow = (id: string) => {
    const row = database.prepare("SELECT * FROM assistant_conversations WHERE id=?").get(id);
    return row === undefined ? undefined : assistantConversationFromRow(row);
  };
  /** Owned and unexpired, independently of physical cleanup. */
  const owned = (id: string, now: string) => {
    const record = conversationRow(id);
    return record === undefined || record.profileId !== profileId || record.expiresAt <= now ? undefined : record;
  };
  const requireOwned = (id: string, now: string) => owned(id, now) ?? refuse("ASSISTANT_CONVERSATION_STALE");
  const requireRevision = (id: string, expected: number, now: string) => {
    const record = requireOwned(id, now);
    if (record.revision !== expected) refuse("ASSISTANT_CONVERSATION_STALE");
    return record;
  };
  const validateMembership = (row: AssistantM1MessageRecord, chat: AssistantConversationRecord) => {
    const recording = row.payload.recording;
    if (recording.kind === "accepted-turn" && (recording.acceptedTurn.profileId !== chat.profileId
      || recording.acceptedTurn.acceptedRevision > chat.revision)) refuse("ASSISTANT_CONVERSATION_STALE");
    if (recording.kind === "reply") {
      const raw = database.prepare("SELECT * FROM assistant_messages WHERE id=?").get(recording.acceptedMessageId);
      if (raw === undefined) refuse("ASSISTANT_CONVERSATION_STALE");
      const accepted = assistantM1MessageFromRow(raw), link = accepted.payload.recording;
      if (link.kind !== "accepted-turn" || accepted.conversationId !== chat.id || accepted.ordinal >= row.ordinal
        || link.acceptedTurn.profileId !== chat.profileId || link.acceptedTurn.acceptedRevision > chat.revision
        || accepted.delivery === "sending") refuse("ASSISTANT_CONVERSATION_STALE");
    }
    return row;
  };
  const currentAttempt = (attempt: AssistantM1Attempt, now: string) => {
    const turn = AssistantAcceptedTurnSchema.parse(attempt.acceptedTurn);
    if (liveAttempts.get(turn.messageId) !== attempt) return undefined;
    const chat = owned(turn.conversationId, now);
    const raw = database.prepare("SELECT * FROM assistant_messages WHERE id=?").get(turn.messageId);
    if (chat === undefined || chat.createdAt !== attempt.conversationCreatedAt || raw === undefined) return undefined;
    const row = validateMembership(assistantM1MessageFromRow(raw), chat), recording = row.payload.recording;
    return row.conversationId === chat.id && row.delivery === "sending" && recording.kind === "accepted-turn"
      && recording.acceptedTurn.epoch === ports.epoch() && canonicalJsonStringify(recording.acceptedTurn) === canonicalJsonStringify(turn)
      ? { chat, row } : undefined;
  };
  const messages = (conversationId: string) => {
    const chat = conversationRow(conversationId) ?? refuse("ASSISTANT_CONVERSATION_STALE");
    return database.prepare("SELECT * FROM assistant_messages WHERE conversation_id=? ORDER BY ordinal")
      .all(conversationId).map(raw => validateMembership(assistantM1MessageFromRow(raw), chat));
  };
  const messageRow = (id: string) => {
    const row = database.prepare("SELECT * FROM assistant_messages WHERE id=?").get(id);
    return row === undefined ? undefined : assistantM1MessageFromRow(row);
  };
  const duplicate = (prior: AssistantM1MessageRecord, record: AssistantConversationRecord, input: AssistantM1RepeatInput): Extract<AssistantM1Acceptance, { state: "repeat" }> => {
    const recording = prior.payload.recording;
    if (recording.kind !== "accepted-turn" || prior.kind !== "turn" || prior.role !== "operator" || prior.delivery === "settled") return refuse("ASSISTANT_CONVERSATION_STALE");
    if (prior.conversationId !== input.conversationId || recording.acceptedTurn.profileId !== profileId || recording.acceptedTurn.epoch !== ports.epoch()
      || canonicalJsonStringify(prior.payload.parts) !== canonicalJsonStringify([{ kind: "text", runs: [{ kind: "plain", text: input.text }] }])
      || prior.subjectRef !== input.subjectRef || canonicalJsonStringify(fileNames(prior.id).map(file => file.id)) !== canonicalJsonStringify(input.attachments)) refuse("ASSISTANT_CONVERSATION_STALE");
    validateMembership(prior, record);
    return { state: "repeat", ordinal: prior.ordinal, revision: record.revision, delivery: prior.delivery,
      conversationCreatedAt: record.createdAt, acceptedTurn: recording.acceptedTurn, usage: recording.usage };
  };
  const nextOrdinal = (conversationId: string) => z.object({ next: z.number().int() }).parse(
    database.prepare("SELECT COALESCE(MAX(ordinal),0)+1 AS next FROM assistant_messages WHERE conversation_id=?").get(conversationId)).next;
  const bump = (id: string) => {
    database.prepare("UPDATE assistant_conversations SET revision=revision+1 WHERE id=?").run(id);
    return z.object({ revision: z.number().int().positive() }).parse(database.prepare("SELECT revision FROM assistant_conversations WHERE id=?").get(id)).revision;
  };
  const insertMessage = (message: AssistantM1MessageRecord) => {
    AssistantM1MessageRecordSchema.parse(message);
    validateMembership(message, conversationRow(message.conversationId) ?? refuse("ASSISTANT_CONVERSATION_STALE"));
    database.prepare("INSERT INTO assistant_messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(message.id, message.conversationId, message.ordinal, message.role,
      message.kind, message.modelText, message.subjectRef, message.actionId, message.delivery, message.code, canonicalJsonStringify(message.payload),
      message.createdAt, message.updatedAt);
  };
  const hasSending = (conversationId: string) => database.prepare("SELECT 1 FROM assistant_messages WHERE conversation_id=? AND delivery='sending'").get(conversationId) !== undefined;
  /** The next ordinal for `count` rows; an accepted turn keeps one slot for its reply. */
  const appendable = (conversationId: string, count = 1) => {
    const ordinal = nextOrdinal(conversationId);
    if (ordinal + count - 1 + (hasSending(conversationId) ? 1 : 0) > ASSISTANT_MESSAGES_MAX) refuse("ASSISTANT_CHAT_FULL");
    return ordinal;
  };
  const textUnits = (sql: string, now: string) => database.prepare(sql).all(profileId, now)
    .reduce<number>((sum, row) => sum + Object.values(row).reduce<number>((units, value) => units + String(value).length, 0), 0);
  /** Refuses a write that leaves the profile's unexpired titles, drafts and display text above the metadata budget. */
  const withinBudget = <T>(now: string, write: Readonly<{ result: T; changes: number }>) => {
    const units = textUnits("SELECT json_extract(payload_json,'$.title') AS title,draft,composer FROM assistant_conversations WHERE profile_id=? AND expires_at>?", now)
      + database.prepare("SELECT m.* FROM assistant_messages m JOIN assistant_conversations c ON c.id=m.conversation_id WHERE c.profile_id=? AND c.expires_at>?")
        .all(profileId, now).reduce<number>((sum, raw) => sum + assistantReplyDisplayUnits(assistantM1MessageFromRow(raw).payload.parts), 0);
    if (units > ASSISTANT_HISTORY_METADATA_MAX_UNITS) refuse("ASSISTANT_HISTORY_FULL");
    return write;
  };
  const insertConversation = (record: AssistantConversationRecord) => {
    if (z.object({ count: z.number() }).parse(database.prepare("SELECT COUNT(*) AS count FROM assistant_conversations WHERE profile_id=? AND expires_at>?")
      .get(record.profileId, record.createdAt)).count >= ASSISTANT_CHATS_MAX) refuse("ASSISTANT_CHAT_LIMIT");
    database.prepare("INSERT INTO assistant_conversations VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(record.id, record.profileId, record.revision, record.selectedAt,
      canonicalJsonStringify({ title: record.title }), record.draft, record.composer, record.importTotal, record.importNotice, record.createdAt, record.expiresAt);
  };
  const newConversation = (id: string, title: string, now: string, extra: Partial<AssistantConversationRecord> = {}) => AssistantConversationRecordSchema.parse({
    id, profileId: profileId, revision: 1, selectedAt: null, title, draft: "", composer: "", importTotal: 0, importNotice: null,
    createdAt: now, expiresAt: new Date(Date.parse(now) + ASSISTANT_CHAT_TTL_MS).toISOString(), ...extra });
  const saved = (conversationId: string, revision: number): AssistantHistoryResult => ({ state: "saved", conversationId, revision });
  const sameRows = (actual: readonly AssistantM1MessageRecord[], expected: readonly Readonly<{ messageId: string; role: string; text: string }>[], start: number) =>
    actual.length === expected.length && expected.every((message, index) => {
      const row = actual[index];
      return row.id === message.messageId && row.ordinal === start + index && row.role === message.role && canonicalJsonStringify(row.payload) === canonicalJsonStringify(convertAssistantHistoryPayloadToM1({ text: message.text })) && row.kind === "inert";
    });

  function apply(operation: AssistantHistoryOperation, now: string): AssistantHistoryResult {
    operation = AssistantHistoryOperationSchema.parse(operation);
    switch (operation.operation) {
      case "create": return ports.mutate("assistant_conversations", () => {
        const existing = conversationRow(operation.conversationId);
        if (existing !== undefined) {
          if (existing.profileId !== profileId || existing.expiresAt <= now || existing.title !== operation.title) refuse("ASSISTANT_CONVERSATION_STALE");
          return { result: saved(existing.id, existing.revision), changes: 0 };
        }
        insertConversation(newConversation(operation.conversationId, operation.title, now, { selectedAt: now }));
        return withinBudget(now, { result: saved(operation.conversationId, 1), changes: 1 });
      });
      case "rename": return ports.mutate("assistant_conversations", () => {
        requireRevision(operation.conversationId, operation.expectedRevision, now);
        database.prepare("UPDATE assistant_conversations SET payload_json=? WHERE id=?").run(canonicalJsonStringify({ title: operation.title }), operation.conversationId);
        return withinBudget(now, { result: saved(operation.conversationId, bump(operation.conversationId)), changes: 1 });
      });
      case "select": return ports.mutate("assistant_conversations", () => {
        requireRevision(operation.conversationId, operation.expectedRevision, now);
        database.prepare("UPDATE assistant_conversations SET selected_at=? WHERE id=?").run(now, operation.conversationId);
        return { result: saved(operation.conversationId, bump(operation.conversationId)), changes: 1 };
      });
      case "clear": return ports.mutate("assistant_conversations", () => {
        requireRevision(operation.conversationId, operation.expectedRevision, now);
        const sending = database.prepare("SELECT 1 FROM assistant_messages WHERE conversation_id=? AND delivery='sending'").get(operation.conversationId) !== undefined;
        database.prepare("DELETE FROM assistant_conversations WHERE id=?").run(operation.conversationId);
        ports.afterCommit(() => {
          for (const [id, attempt] of liveAttempts) if (attempt.acceptedTurn.conversationId === operation.conversationId) liveAttempts.delete(id);
        });
        return { result: { state: "cleared", conversationId: operation.conversationId, transmissionMayHaveStarted: sending }, changes: 1 };
      });
      case "draft": return ports.mutate("assistant_conversations", () => {
        const record = requireOwned(operation.conversationId, now);
        database.prepare("UPDATE assistant_conversations SET draft=?,composer=? WHERE id=?").run(operation.draft, operation.composer, operation.conversationId);
        return withinBudget(now, { result: saved(record.id, record.revision), changes: 1 });
      });
      case "local": return ports.mutate("assistant_messages", () => {
        requireRevision(operation.conversationId, operation.expectedRevision, now);
        if (messageRow(operation.messageId) !== undefined) refuse("ASSISTANT_CONVERSATION_STALE");
        insertMessage({ id: operation.messageId, conversationId: operation.conversationId, ordinal: appendable(operation.conversationId), role: "assistant", kind: "inert",
          modelText: null, subjectRef: null, actionId: null, delivery: "settled", code: null, payload: convertAssistantHistoryPayloadToM1({ text: operation.text }), createdAt: now, updatedAt: now });
        return withinBudget(now, { result: saved(operation.conversationId, bump(operation.conversationId)), changes: 1 });
      });
      case "import": return ports.mutate("assistant_messages", () => {
        const expected = { title: operation.title, draft: operation.draft, composer: operation.composer, importTotal: operation.total, importNotice: operation.notice };
        let record = conversationRow(operation.conversationId);
        if (record === undefined) {
          if (operation.start !== 1) refuse("ASSISTANT_CONVERSATION_STALE");
          record = newConversation(operation.conversationId, operation.title, now, expected);
          insertConversation(record);
        } else if (record.profileId !== profileId || record.expiresAt <= now
          || canonicalJsonStringify({ title: record.title, draft: record.draft, composer: record.composer, importTotal: record.importTotal, importNotice: record.importNotice })
            !== canonicalJsonStringify(expected)) refuse("ASSISTANT_CONVERSATION_STALE");
        const existing = messages(operation.conversationId).filter(row => row.ordinal >= operation.start && row.ordinal < operation.start + operation.messages.length);
        if (existing.length > 0) {
          if (!sameRows(existing, operation.messages, operation.start)) refuse("ASSISTANT_CONVERSATION_STALE");
          return { result: saved(record.id, record.revision), changes: 0 };
        }
        if (appendable(operation.conversationId, operation.messages.length) !== operation.start) refuse("ASSISTANT_CONVERSATION_STALE");
        operation.messages.forEach((message, index) => {
          if (messageRow(message.messageId) !== undefined) refuse("ASSISTANT_CONVERSATION_STALE");
          insertMessage({ id: message.messageId, conversationId: operation.conversationId, ordinal: operation.start + index, role: message.role, kind: "inert",
            modelText: null, subjectRef: null, actionId: null, delivery: "settled", code: null, payload: convertAssistantHistoryPayloadToM1({ text: message.text }), createdAt: now, updatedAt: now });
        });
        return withinBudget(now, { result: saved(record.id, operation.messages.length === 0 ? record.revision : bump(operation.conversationId)), changes: 1 });
      });
    }
  }

  return Object.freeze({
    apply,
    list(now: string): AssistantHistoryView {
      return ports.read(() => {
        const chats = database.prepare("SELECT * FROM assistant_conversations WHERE profile_id=? AND expires_at>? ORDER BY created_at DESC, id")
          .all(profileId, now).map(assistantConversationFromRow);
        const selected = [...chats].sort((left, right) => (right.selectedAt ?? "").localeCompare(left.selectedAt ?? ""))[0];
        return { chats: chats.map(chat => ({ id: chat.id, title: chat.title, revision: chat.revision, createdAt: chat.createdAt, expiresAt: chat.expiresAt })),
          selectedId: selected?.selectedAt === null || selected === undefined ? null : selected.id };
      });
    },
    conversation(id: string, now: string): AssistantM1ConversationView | undefined {
      return ports.read(() => {
        const record = owned(id, now);
        return record === undefined ? undefined : AssistantM1ConversationViewSchema.parse({ id: record.id, title: record.title, revision: record.revision, draft: record.draft, composer: record.composer,
          importTotal: record.importTotal, importNotice: record.importNotice,
          messages: messages(id).map(row => ({ id: row.id, ordinal: row.ordinal, role: row.role, kind: row.kind, payload: row.payload, delivery: row.delivery, code: row.code, actionId: row.actionId,
            attachments: row.kind === "turn" ? fileNames(row.id) : [] })) });
      });
    },
    /** Stages one validated upload under an owned, unexpired chat; nothing reaches the model until a send claims it. */
    stage(input: Readonly<{ id: string; conversationId: string; mediaType: AssistantAttachmentMediaType; name: string; bytes: Uint8Array; now: string }>): AssistantAttachmentRecord {
      return ports.mutate("assistant_attachments", () => {
        const chat = requireOwned(input.conversationId, input.now);
        return { result: files.stage({ ...input, chatExpiresAt: chat.expiresAt }), changes: 1 };
      });
    },
    repeat(input: AssistantM1RepeatInput): Extract<AssistantM1Acceptance, { state: "repeat" }> | undefined {
      return ports.read(() => {
        const record = requireOwned(input.conversationId, input.now), prior = messageRow(input.messageId);
        return prior === undefined ? undefined : duplicate(prior, record, input);
      });
    },
    /** Repeats return stored facts; only a new acceptance belongs to the orchestration attempt. */
    accept(input: Readonly<{ conversationId: string; expectedRevision: number; messageId: string; text: string; modelText: string; subjectRef: string | null;
      attachments: readonly string[]; proposalAnswer: AssistantAcceptedTurn["proposalAnswer"]; now: string }>): AssistantM1Acceptance {
      return ports.mutate("assistant_messages", (): { result: AssistantM1Acceptance; changes: number } => {
        const record = requireOwned(input.conversationId, input.now), prior = messageRow(input.messageId);
        if (prior !== undefined) {
          const repeated = duplicate(prior, record, input);
          if (prior.modelText !== input.modelText || canonicalJsonStringify(repeated.acceptedTurn.proposalAnswer) !== canonicalJsonStringify(input.proposalAnswer)) refuse("ASSISTANT_CONVERSATION_STALE");
          return { result: repeated, changes: 0 };
        }
        if (record.revision !== input.expectedRevision) refuse("ASSISTANT_CONVERSATION_STALE");
        if (hasSending(input.conversationId)) refuse("ASSISTANT_CONVERSATION_BUSY");
        const ordinal = appendable(input.conversationId, 2), revision = bump(input.conversationId);
        const acceptedTurn = AssistantAcceptedTurnSchema.parse({ conversationId: input.conversationId, messageId: input.messageId,
          ordinal, acceptedRevision: revision, acceptedAt: input.now, profileId: profileId, epoch: ports.epoch(), proposalAnswer: input.proposalAnswer });
        insertMessage({ id: input.messageId, conversationId: input.conversationId, ordinal, role: "operator", kind: "turn", modelText: input.modelText,
          subjectRef: input.subjectRef, actionId: null, delivery: "sending", code: null, payload: { parts: [{ kind: "text", runs: [{ kind: "plain", text: input.text }] }],
            recording: { kind: "accepted-turn", acceptedTurn, usage: { state: "pending" } } }, createdAt: input.now, updatedAt: input.now });
        files.accept(input.conversationId, input.messageId, input.attachments, record.expiresAt, input.now);
        const result: Extract<AssistantM1Acceptance, { state: "accepted" }> = { state: "accepted", ordinal, revision, conversationCreatedAt: record.createdAt, acceptedTurn };
        const outcome = withinBudget(input.now, { result, changes: 1 });
        ports.afterCommit(() => { liveAttempts.set(result.acceptedTurn.messageId, result); });
        return outcome;
      });
    },
    nextOrdinal: (conversationId: string, now: string) => ports.read(() => { requireOwned(conversationId, now); return nextOrdinal(conversationId); }),
    sending(attempt: AssistantM1Attempt, now: string): boolean {
      return ports.read(() => currentAttempt(attempt, now) !== undefined);
    },
    /** One turn's accepted attachments in send order, with authenticated bytes. */
    turnAttachments: (messageId: string, now: string) => ports.read(() => {
      const row = messageRow(messageId) ?? refuse("ASSISTANT_CONVERSATION_STALE");
      validateMembership(row, requireOwned(row.conversationId, now));
      if (row.kind !== "turn") refuse("ASSISTANT_CONVERSATION_STALE");
      return files.ofMessage(messageId);
    }),
    /** An accepted attachment of an owned, unexpired chat; undefined when gone, foreign or expired. */
    attachment: (conversationId: string, id: string, now: string) => ports.read(() => owned(conversationId, now) === undefined ? undefined : files.accepted(conversationId, id, now)),
    /** Earlier rows with replay text, in order; never `inert` rows or the current turn. Operator turns carry their id for their attachments. */
    replay(conversationId: string, beforeOrdinal: number, now: string): readonly Readonly<{ role: "operator" | "assistant"; modelText: string; messageId?: string }>[] {
      return ports.read(() => { requireOwned(conversationId, now); return messages(conversationId).flatMap(row => row.ordinal < beforeOrdinal && row.modelText !== null && row.delivery !== "sending"
        ? [{ role: row.role, modelText: row.modelText, ...(row.kind === "turn" ? { messageId: row.id } : {}) }] : []); });
    },
    /** One guarded settlement; returns the new revision, or undefined when the turn is gone, expired or already settled. */
    settle(attempt: AssistantM1Attempt, input: AssistantM1Settlement, now: string): number | undefined {
      return ports.mutate("assistant_messages", () => {
        const current = currentAttempt(attempt, now);
        if (current === undefined) return { result: undefined, changes: 0 };
        const { chat, row } = current, conversationId = chat.id, messageId = row.id, recording = row.payload.recording;
        if (recording.kind !== "accepted-turn") refuse("ASSISTANT_CONVERSATION_STALE");
        const settlement = AssistantM1SettlementSchema.parse(input);
        const payload = AssistantM1MessagePayloadSchema.parse({ ...row.payload, recording: { ...recording, usage: settlement.usage } });
        AssistantM1MessageRecordSchema.parse({ ...row, payload, delivery: settlement.delivery, code: settlement.code ?? null, updatedAt: now });
        database.prepare("UPDATE assistant_messages SET payload_json=?,delivery=?,code=?,updated_at=? WHERE id=? AND conversation_id=? AND delivery='sending'")
          .run(canonicalJsonStringify(payload), settlement.delivery, settlement.code ?? null, now, messageId, conversationId);
        const reply = settlement.reply;
        if (reply !== undefined) insertMessage({ id: reply.id, conversationId, ordinal: appendable(conversationId), role: "assistant", kind: reply.kind,
          modelText: reply.modelText, subjectRef: null, actionId: reply.actionId ?? null, delivery: "settled", code: null,
          payload: { parts: reply.parts, recording: { kind: "reply", acceptedMessageId: messageId } }, createdAt: now, updatedAt: now });
        const outcome = withinBudget(now, { result: bump(conversationId), changes: 1 });
        ports.afterCommit(() => {
          if (liveAttempts.get(attempt.acceptedTurn.messageId) === attempt) liveAttempts.delete(attempt.acceptedTurn.messageId);
        });
        return outcome;
      });
    },
    /** At most one caption per action; nothing when the conversation was cleared or expired; a full chat or budget refuses. `modelText` defaults to the display text. */
    appendDecision(input: Readonly<{ conversationId: string; actionId: string; messageId: string; text: string; modelText?: string; now: string }>): void {
      ports.mutate("assistant_messages", () => {
        if (owned(input.conversationId, input.now) === undefined
          || database.prepare("SELECT 1 FROM assistant_messages WHERE action_id=? AND kind='decision'").get(input.actionId) !== undefined) return { result: undefined, changes: 0 };
        insertMessage({ id: input.messageId, conversationId: input.conversationId, ordinal: appendable(input.conversationId), role: "assistant", kind: "decision",
          modelText: input.modelText ?? input.text, subjectRef: null, actionId: input.actionId, delivery: "settled", code: null, payload: convertAssistantHistoryPayloadToM1({ text: input.text }), createdAt: input.now, updatedAt: input.now });
        bump(input.conversationId);
        return withinBudget(input.now, { result: undefined, changes: 1 });
      });
    },
    /** Startup: every unfinished send becomes `delivery-unknown`; it is never resumed. */
    settleInterrupted(now: string): number {
      return ports.mutate("assistant_messages", () => {
        const rows = database.prepare(`SELECT m.* FROM assistant_messages m JOIN assistant_conversations c ON c.id=m.conversation_id
          WHERE m.delivery='sending' AND c.profile_id=?`).all(profileId).map(assistantM1MessageFromRow);
        for (const row of rows) {
          validateMembership(row, conversationRow(row.conversationId) ?? refuse("ASSISTANT_CONVERSATION_STALE"));
          database.prepare("UPDATE assistant_messages SET delivery='delivery-unknown',updated_at=? WHERE id=? AND delivery='sending'").run(now, row.id);
          bump(row.conversationId);
        }
        const changes = rows.length;
        const reclaimed = files.reclaim(now, true);
        ports.afterCommit(() => { for (const row of rows) liveAttempts.delete(row.id); });
        return { result: changes, changes: changes + reclaimed };
      });
    },
    reclaimExpired(now: string): number {
      return ports.mutate("assistant_conversations", () => {
        const expired = new Set<string>();
        for (const row of database.prepare("SELECT id FROM assistant_conversations WHERE profile_id=? AND expires_at<=?").all(profileId, now)) expired.add(z.object({ id: z.uuid() }).parse(row).id);
        const changes = Number(database.prepare("DELETE FROM assistant_conversations WHERE profile_id=? AND expires_at<=?").run(profileId, now).changes);
        const reclaimed = files.reclaim(now, false);
        ports.afterCommit(() => {
          for (const [id, attempt] of liveAttempts) if (expired.has(attempt.acceptedTurn.conversationId)) liveAttempts.delete(id);
        });
        return { result: changes, changes: changes + reclaimed };
      });
    },
  });
}
export type AssistantM1HistoryRepository = ReturnType<typeof createAssistantM1HistoryRepository>;
