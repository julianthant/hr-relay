import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

/** Schema 34: a failure resolution command carries no note; stored commands and audits drop it. The resolved failure keeps its note. */
export const FAILURE_NOTE_REMOVAL_SCHEMA_VERSION = 34;
const ObjectSchema = z.record(z.string(), z.unknown());

function request(input: unknown) {
  const value = ObjectSchema.parse(input);
  if (value.family !== "failure-resolution" || value.type !== "annotate-failure") return value;
  const { note: _note, ...payload } = ObjectSchema.parse(value.payload);
  return { ...value, payload };
}
function audit(input: unknown) {
  const value = ObjectSchema.parse(input);
  return { ...value, request: request(value.request) };
}

/** Converts one stored row of a predecessor below schema 34; used by stopped inspection and the forward migration. */
export function convertFailureNoteRow(table: string, input: unknown): Record<string, unknown> {
  const row = ObjectSchema.parse(input);
  if (table === "commands" && row.family === "failure-resolution") {
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
    const stored = ObjectSchema.safeParse(value.request);
    if (stored.success && stored.data.family === "failure-resolution") return { ...row, payload_json: canonicalJsonStringify(audit(value)) };
  }
  return row;
}

/** The forward conversion; runs inside migration 34 while the audit immutability trigger is dropped. Rows without a note stay byte-identical. */
export function migrateFailureNotes(database: DatabaseSync): void {
  for (const table of ["commands", "command_audits"]) {
    for (const raw of database.prepare(`SELECT * FROM ${table}`).all()) {
      const row = convertFailureNoteRow(table, raw);
      if (canonicalJsonStringify(row) === canonicalJsonStringify(raw)) continue;
      if (table === "commands") database.prepare("UPDATE commands SET request_json=?,request_digest=?,outcome_json=? WHERE id=?")
        .run(z.string().parse(row.request_json), z.string().parse(row.request_digest), z.string().nullable().parse(row.outcome_json), z.string().parse(row.id));
      else database.prepare("UPDATE command_audits SET payload_json=? WHERE id=?").run(z.string().parse(row.payload_json), z.string().parse(row.id));
    }
  }
}

export const FAILURE_NOTE_REMOVAL_CONVERSION_ID = "failure-note-removal-forward-conversion:v1";
export const FAILURE_NOTE_REMOVAL_MIGRATION = Object.freeze({ version: FAILURE_NOTE_REMOVAL_SCHEMA_VERSION, statements: Object.freeze([
  "DROP TRIGGER command_audits_immutable",
  `SELECT '${FAILURE_NOTE_REMOVAL_CONVERSION_ID}'`,
  `CREATE TRIGGER command_audits_immutable BEFORE UPDATE ON command_audits
      BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END`,
]) });
