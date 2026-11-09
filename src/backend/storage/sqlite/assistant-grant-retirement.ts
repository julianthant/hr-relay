import type { DatabaseSync } from "node:sqlite";

/** Schema 27: the per-card Confirm is the assistant's only authorization; the operator grant table is gone. */
export const ASSISTANT_GRANT_RETIREMENT_VERSION = 27;
export const RETIRED_ASSISTANT_GRANT_TABLE = "assistant_grants";

/** Retained grant history has no reader after schema 27; a store holding any stays at its version. */
export function assertNoAssistantGrantHistory(database: DatabaseSync): void {
  const held = [
    "SELECT 1 FROM assistant_grants LIMIT 1",
    "SELECT 1 FROM assistant_actions LIMIT 1",
    "SELECT 1 FROM commands WHERE json_type(request_json,'$.payload.assistantPermission') IS NOT NULL LIMIT 1",
    "SELECT 1 FROM command_audits WHERE json_type(payload_json,'$.request.payload.assistantPermission') IS NOT NULL LIMIT 1",
  ].some(query => database.prepare(query).get() !== undefined);
  if (held) throw new Error("assistant-grant-history-unsupported");
}

export const ASSISTANT_GRANT_RETIREMENT_MIGRATION = Object.freeze({ version: ASSISTANT_GRANT_RETIREMENT_VERSION, statements: Object.freeze([
  "SELECT 'assistant-grant-retirement:history-refused'",
  `DROP TABLE ${RETIRED_ASSISTANT_GRANT_TABLE}`,
]) });
