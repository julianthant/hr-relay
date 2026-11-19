import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AssistantActionRecordSchema, AssistantChatRecordSchema } from "../../../models/profiles/assistant-authorization.js";
import { CommandAuditRecordSchema } from "../../../rules/commands/commands.js";
import { commandResultEffect } from "../../../rules/commands/command-lifecycle.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";

/** Schema 29: the per-card Confirm is the assistant's only authorization; the operator grant table is gone. */
export const ASSISTANT_GRANT_RETIREMENT_VERSION = 29;
export const RETIRED_ASSISTANT_GRANT_TABLE = "assistant_grants";

const LegacyActionPayload = z.looseObject({ binding: z.looseObject({
  grantId: z.uuid(), policyRevision: z.number().int().positive(), mode: z.enum(["every-action", "before-submits", "without-asking"]),
}) });

/** Prove terminal rows before leaving their original bytes in the verified pre-upgrade backup. */
export function assertAssistantHistoryRetirable(database: DatabaseSync): void {
  const held = [
    "SELECT 1 FROM assistant_grants LIMIT 1",
    "SELECT 1 FROM assistant_actions WHERE state NOT IN ('settled','cancelled') LIMIT 1",
    "SELECT 1 FROM commands WHERE json_type(request_json,'$.payload.assistantPermission') IS NOT NULL LIMIT 1",
    "SELECT 1 FROM command_audits WHERE json_type(payload_json,'$.request.payload.assistantPermission') IS NOT NULL LIMIT 1",
  ].some(query => database.prepare(query).get() !== undefined);
  if (held) throw new Error("assistant-grant-history-unsupported");
  for (const row of database.prepare("SELECT * FROM assistant_actions").iterate()) {
    const payload = LegacyActionPayload.safeParse(JSON.parse(z.string().parse(row.payload_json)));
    if (!payload.success) throw new Error("assistant-grant-history-unsupported");
    const { grantId: _grant, policyRevision: _revision, mode: _mode, ...binding } = payload.data.binding;
    const record = nativeOrdinaryRecordFromRow("assistant_actions", { ...row, payload_json: canonicalJsonStringify({ ...payload.data, binding }) });
    const action = AssistantActionRecordSchema.parse(record);
    const chat = AssistantChatRecordSchema.parse(nativeOrdinaryRecordFromRow("assistant_chats", database.prepare("SELECT * FROM assistant_chats WHERE id=?").get(action.chatId)));
    if (chat.profileId !== action.binding.profileId || chat.epoch !== action.binding.accountSessionEpoch
      || chat.profileId !== database.prepare("SELECT profile_id FROM database_states WHERE id=1").get()?.profile_id) throw new Error("assistant-action-chat-mismatch");
    const command = database.prepare("SELECT request_json, outcome_json FROM commands WHERE id=?").get(action.command.commandId);
    const audits = database.prepare("SELECT * FROM command_audits WHERE command_id=?").all(action.command.commandId);
    if (action.state === "cancelled" && command === undefined && audits.length === 0) continue;
    if (action.state !== "settled" || action.result === null || commandResultEffect(action.result) === "unknown"
      || command === undefined || audits.length !== 1 || command.outcome_json !== audits[0]?.payload_json) throw new Error("assistant-grant-history-unsupported");
    const audit = CommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits", audits[0]));
    if (command.request_json !== canonicalJsonStringify(action.command) || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(action.command)
      || canonicalJsonStringify(audit.result) !== canonicalJsonStringify(action.result)) throw new Error("assistant-grant-history-unsupported");
  }
}

export const ASSISTANT_GRANT_RETIREMENT_MIGRATION = Object.freeze({ version: ASSISTANT_GRANT_RETIREMENT_VERSION, statements: Object.freeze([
  "SELECT 'assistant-grant-retirement:history-refused'",
  `DROP TABLE ${RETIRED_ASSISTANT_GRANT_TABLE}`,
]) });
