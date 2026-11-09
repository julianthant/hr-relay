import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

/** Schema 25: the assistant effort scale becomes light|medium|high|xhigh|max; a stored "low" is "light". */
export const ASSISTANT_EFFORT_SCALE_VERSION = 25;
const ObjectSchema = z.record(z.string(), z.unknown());
const FAMILY = "assistant-model-preference";

function preference(input: unknown) {
  const value = ObjectSchema.parse(input);
  return value.effort === "low" ? { ...value, effort: "light" } : value;
}
function request(input: unknown) {
  const value = ObjectSchema.parse(input);
  return value.family === FAMILY ? { ...value, payload: preference(value.payload) } : value;
}
function audit(input: unknown) {
  const value = ObjectSchema.parse(input);
  return { ...value, request: request(value.request) };
}

/** Converts one stored row of a predecessor below schema 25; used by stopped inspection and the forward migration. */
export function convertAssistantEffortRow(table: string, input: unknown): Record<string, unknown> {
  const row = ObjectSchema.parse(input);
  if (table === "assistant_model_preference") {
    const value = ObjectSchema.parse(JSON.parse(z.string().parse(row.payload_json)));
    return { ...row, payload_json: canonicalJsonStringify({ ...value, preference: preference(value.preference) }) };
  }
  if (table === "commands" && row.family === FAMILY) {
    const before = ObjectSchema.parse(JSON.parse(z.string().parse(row.request_json)));
    if (sha256Hex(canonicalJsonStringify(before)) !== row.request_digest) throw new Error("command-row-identity-mismatch");
    const json = canonicalJsonStringify(request(before));
    if (row.outcome_json === null) return { ...row, request_json: json, request_digest: sha256Hex(json) };
    const outcome = ObjectSchema.parse(JSON.parse(z.string().parse(row.outcome_json)));
    if (canonicalJsonStringify(outcome.request) !== canonicalJsonStringify(before)) throw new Error("command-row-outcome-mismatch");
    return { ...row, request_json: json, request_digest: sha256Hex(json), outcome_json: canonicalJsonStringify(audit(outcome)) };
  }
  if (table === "command_audits") {
    const value = ObjectSchema.parse(JSON.parse(z.string().parse(row.payload_json)));
    if (ObjectSchema.safeParse(value.request).success && ObjectSchema.parse(value.request).family === FAMILY) return { ...row, payload_json: canonicalJsonStringify(audit(value)) };
  }
  return row;
}

/** The forward conversion; runs inside migration 25 while the preference and audit triggers are dropped. */
export function migrateAssistantEffortScale(database: DatabaseSync): void {
  for (const table of ["assistant_model_preference", "commands", "command_audits"]) {
    for (const raw of database.prepare(`SELECT * FROM ${table}`).all()) {
      const row = convertAssistantEffortRow(table, raw);
      if (canonicalJsonStringify(row) === canonicalJsonStringify(raw)) continue;
      if (table === "commands") database.prepare("UPDATE commands SET request_json=?,request_digest=?,outcome_json=? WHERE id=?")
        .run(z.string().parse(row.request_json), z.string().parse(row.request_digest), z.string().nullable().parse(row.outcome_json), z.string().parse(row.id));
      else database.prepare(`UPDATE ${table} SET payload_json=? WHERE id=?`).run(z.string().parse(row.payload_json), z.string().parse(row.id));
    }
  }
}

export const ASSISTANT_EFFORT_SCALE_MIGRATION = Object.freeze({ version: ASSISTANT_EFFORT_SCALE_VERSION, statements: Object.freeze([
  "DROP TRIGGER command_audits_immutable",
  "DROP TRIGGER assistant_model_preference_monotonic",
  "SELECT 'assistant-effort-scale-forward-conversion:light-medium-high-xhigh-max'",
  `CREATE TRIGGER command_audits_immutable BEFORE UPDATE ON command_audits
      BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END`,
  `CREATE TRIGGER assistant_model_preference_monotonic BEFORE UPDATE ON assistant_model_preference
      WHEN NEW.id IS NOT OLD.id OR NEW.profile_id IS NOT OLD.profile_id OR NEW.revision != OLD.revision+1
        OR NEW.command_id=OLD.command_id OR NEW.audit_id=OLD.audit_id
      BEGIN SELECT RAISE(ABORT,'assistant-preference-revision-conflict'); END`,
]) });
