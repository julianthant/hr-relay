import { SettingsCommandRequestSchema } from "../../../rules/commands/commands.js";
import { readAppSettings } from "./settings-storage.js";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { AssistantActionRecordSchema, AssistantChatRecordSchema, AssistantGrantRecordSchema, type AssistantActionRecord } from "../../../models/profiles/assistant-authorization.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";

type Table = "assistant_grants" | "assistant_chats" | "assistant_actions";
interface Ports {
  database: DatabaseSync;
  mutate<T>(table: Table, work: () => { result: T; changes: number }): T;
}
export function createAssistantAuthorizationRepository(ports: Ports) {
  const read = (table: Table, id: string): unknown => {
    const row = ports.database.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    return row === undefined ? undefined : nativeOrdinaryRecordFromRow(table, row);
  };
  const grant = (pendingCommandId?: string) => {
    const value = read("assistant_grants", "current");
    if (value === undefined && ports.database.prepare("SELECT 1 FROM commands WHERE state='succeeded' AND json_type(request_json,'$.payload.assistantPermission')='object' AND id IS NOT ? LIMIT 1").get(pendingCommandId ?? null) !== undefined) throw new Error("assistant-grant-missing-with-history");
    return value === undefined ? undefined : AssistantGrantRecordSchema.parse(value);
  };
  return Object.freeze({
    grant: () => grant(),
    grantBySettings(input: unknown) {
      const record = AssistantGrantRecordSchema.parse(input);
      return ports.mutate("assistant_grants", () => {
        const prior = grant(record.commandId);
        const revision = prior?.policy.revision ?? 0;
        if (readAppSettings(ports.database)?.saved?.commandId !== record.commandId
          || (prior !== undefined && AssistantGrantRecordSchema.parse(prior).commandId === record.commandId)) throw new Error("assistant-grant-current-settings-command-required");
        const owner = z.object({ profile_id: z.uuid() }).parse(ports.database.prepare("SELECT profile_id FROM database_states WHERE id=1").get());
        if (record.profileId !== owner.profile_id) throw new Error("assistant-grant-profile-owner-mismatch");
        if (record.policy.revision !== revision + 1) throw new Error("assistant-grant-revision-conflict");
        const command = z.object({ request_json: z.string(), state: z.literal("succeeded") }).parse(
          ports.database.prepare("SELECT request_json,state FROM commands WHERE id=?").get(record.commandId));
        const request = SettingsCommandRequestSchema.parse(JSON.parse(command.request_json));
        const selected = request.payload.assistantPermission;
        if (request.requestedBy !== "local-operator" || selected === undefined || selected.mode !== record.policy.mode
          || selected.expectedPolicyRevision !== revision) throw new Error("assistant-grant-command-mismatch");
        ports.database.prepare("INSERT INTO assistant_grants(id,profile_id,revision,command_id,payload_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id,revision=excluded.revision,command_id=excluded.command_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at")
          .run(record.id, record.profileId, record.policy.revision, record.commandId, canonicalJsonStringify(record), record.updatedAt);
        return { result: record, changes: 1 };
      });
    },
    chat(id: string) {
      const value = read("assistant_chats", z.uuid().parse(id));
      return value === undefined ? undefined : AssistantChatRecordSchema.parse(value);
    },
    createChat(input: unknown) {
      const record = AssistantChatRecordSchema.parse(input);
      return ports.mutate("assistant_chats", () => {
        const owner = z.object({ profile_id: z.uuid() }).parse(ports.database.prepare("SELECT profile_id FROM database_states WHERE id=1").get());
        if (record.profileId !== owner.profile_id) throw new Error("assistant-chat-profile-owner-mismatch");
        ports.database.prepare("INSERT INTO assistant_chats(id,profile_id,epoch,payload_json,created_at,expires_at) VALUES(?,?,?,?,?,?)")
          .run(record.id, record.profileId, record.epoch, canonicalJsonStringify(record), record.createdAt, record.expiresAt);
        return { result: record, changes: 1 };
      });
    },
    actionByCommand(commandId: string) {
      const row = ports.database.prepare("SELECT * FROM assistant_actions WHERE command_id=?").get(z.uuid().parse(commandId));
      return row === undefined ? undefined : AssistantActionRecordSchema.parse(nativeOrdinaryRecordFromRow("assistant_actions", row));
    },
    action(id: string) {
      const value = read("assistant_actions", z.uuid().parse(id));
      return value === undefined ? undefined : AssistantActionRecordSchema.parse(value);
    },
    createAction(input: unknown) {
      const record = AssistantActionRecordSchema.parse(input);
      if (record.revision !== 1 || record.state !== "prepared") throw new Error("assistant-action-initial-state-invalid");
      return ports.mutate("assistant_actions", () => {
        const owner = AssistantChatRecordSchema.parse(read("assistant_chats", record.chatId));
        if (owner.profileId !== record.binding.profileId || owner.epoch !== record.binding.accountSessionEpoch) throw new Error("assistant-action-chat-owner-mismatch");
        ports.database.prepare("INSERT INTO assistant_actions(id,chat_id,command_id,revision,state,payload_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
          .run(record.id, record.chatId, record.command.commandId, record.revision, record.state, canonicalJsonStringify(record), record.createdAt, record.expiresAt);
        return { result: record, changes: 1 };
      });
    },
    transition(id: string, revision: number, state: AssistantActionRecord["state"], result: AssistantActionRecord["result"] = null) {
      return ports.mutate("assistant_actions", () => {
        const prior = AssistantActionRecordSchema.parse(read("assistant_actions", id));
        const allowed = prior.state === "prepared" ? ["approved", "cancelled"]
          : prior.state === "approved" ? ["claimed", "cancelled"] : prior.state === "claimed" ? ["settled", "unknown"] : prior.state === "unknown" ? ["settled"] : [];
        if (prior.revision !== revision || !allowed.includes(state)) throw new Error("assistant-action-state-conflict");
        const record = AssistantActionRecordSchema.parse({ ...prior, revision: revision + 1, state, result });
        const update = ports.database.prepare("UPDATE assistant_actions SET revision=?,state=?,payload_json=? WHERE id=? AND revision=? AND state=?")
          .run(record.revision, record.state, canonicalJsonStringify(record), id, revision, prior.state);
        if (update.changes !== 1) throw new Error("assistant-action-state-conflict");
        return { result: record, changes: 1 };
      });
    },
  });
}
