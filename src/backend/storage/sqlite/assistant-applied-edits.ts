import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { WorkbookIdSchema } from "../../../models/dashboard/workbooks.js";
import { AssistantAcceptedTurnSchema, AssistantValueSourceSchema } from "../../../models/dashboard/assistant.js";
import { ActorIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../rules/validation/canonical-json.js";

export const ASSISTANT_APPLIED_EDITS_TABLE = "assistant_applied_edits";

export const ASSISTANT_APPLIED_EDITS_STATEMENTS = [
  `CREATE TABLE assistant_applied_edits (
    id TEXT PRIMARY KEY, accepted_message_id TEXT NOT NULL UNIQUE, committed_at TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
  ) STRICT`,
  "CREATE INDEX assistant_applied_edits_time ON assistant_applied_edits(committed_at,id)",
  `CREATE TRIGGER assistant_applied_edits_immutable BEFORE UPDATE ON assistant_applied_edits
    BEGIN SELECT RAISE(ABORT,'assistant-applied-edit-immutable'); END`,
];

const SettingValue = z.union([z.strictObject({ set: JsonValueSchema }), z.strictObject({ clear: z.literal(true) })]);
const NoticeValue = z.strictObject({ status: z.enum(["read", "unread"]),
  snooze: z.discriminatedUnion("state", [z.strictObject({ state: z.literal("not-snoozed") }),
    z.strictObject({ state: z.literal("snoozed"), until: IsoInstantSchema })]) });
const WorkbookRevision = z.strictObject({ version: PositiveIntSchema, revision: PositiveIntSchema });
const EditDetailsSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("settings"), path: z.string().min(1), command: z.literal("apply-settings"),
    revision: PositiveIntSchema, prior: SettingValue, next: SettingValue }),
  z.strictObject({ kind: z.literal("notifications"), notificationId: z.uuid(), command: z.enum(["notification-read", "notification-unread"]),
    revision: PositiveIntSchema, prior: NoticeValue, next: NoticeValue }),
  z.strictObject({ kind: z.literal("spreadsheets"), libraryId: WorkbookIdSchema, location: z.union([
    z.strictObject({ kind: z.literal("workbook") }),
    z.strictObject({ kind: z.literal("version"), versionId: WorkbookIdSchema }),
    z.strictObject({ kind: z.literal("cell"), sheetId: WorkbookIdSchema, rowId: WorkbookIdSchema, column: z.number().int().nonnegative() }),
  ]), command: z.enum(["rename", "metadata", "link", "use-version", "rename-version", "create-version", "save"]),
    ownerRevision: WorkbookRevision, prior: JsonValueSchema, next: JsonValueSchema,
    attachment: z.strictObject({ id: z.uuid(), sha256: FingerprintSchema }).optional() }),
]);
export type AssistantEditDetails = z.infer<typeof EditDetailsSchema>;

const RecordSchema = z.strictObject({
  id: z.uuid(),
  turn: AssistantAcceptedTurnSchema,
  actorId: ActorIdSchema,
  committedAt: IsoInstantSchema,
  label: z.string().min(1).max(500),
  source: AssistantValueSourceSchema.optional(),
  details: EditDetailsSchema,
});
export type AssistantAppliedEdit = z.infer<typeof RecordSchema>;
export type AssistantAppliedEditInput = z.input<typeof RecordSchema>;
export const AssistantAppliedEditRowSchema = z.strictObject({
  id: z.uuid(), accepted_message_id: z.uuid(), committed_at: IsoInstantSchema,
  payload_json: z.string().transform((text, context) => {
    try { const value: unknown = JSON.parse(text); return value; }
    catch { context.addIssue({ code: "custom", message: "assistant-edit-payload-invalid" }); return z.NEVER; }
  }).pipe(RecordSchema),
}).refine(row => row.id === row.payload_json.id && row.accepted_message_id === row.payload_json.turn.messageId
  && row.committed_at === row.payload_json.committedAt, "assistant-edit-row-mismatch");

export function createAssistantAppliedEditRepository(ports: Readonly<{
  database: DatabaseSync;
  profileId(): string;
  read<T>(work: () => T): T;
  mutate<T>(table: typeof ASSISTANT_APPLIED_EDITS_TABLE, work: () => Readonly<{ result: T; changes: number }>): T;
}>) {
  const { database } = ports;
  const owned = (record: AssistantAppliedEdit) => {
    if (record.turn.profileId !== ports.profileId()) throw new Error("assistant-edit-profile-mismatch");
    return record;
  };
  return Object.freeze({
    insert(input: AssistantAppliedEditInput) {
      const record = owned(RecordSchema.parse(input));
      return ports.mutate(ASSISTANT_APPLIED_EDITS_TABLE, () => {
        const inserted = database.prepare("INSERT INTO assistant_applied_edits VALUES (?,?,?,?)")
          .run(record.id, record.turn.messageId, record.committedAt, canonicalJsonStringify(record));
        return { result: record, changes: Number(inserted.changes) };
      });
    },
    list(since: string) {
      return ports.read(() => database.prepare("SELECT * FROM assistant_applied_edits WHERE committed_at>=? ORDER BY committed_at DESC,id")
        .all(IsoInstantSchema.parse(since)).map(row => owned(AssistantAppliedEditRowSchema.parse(row).payload_json)));
    },
  });
}

export type AssistantAppliedEditRepository = ReturnType<typeof createAssistantAppliedEditRepository>;
