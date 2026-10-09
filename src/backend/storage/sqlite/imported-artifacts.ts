import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { ImportedArtifactSchema, importedArtifact, type ImportedArtifact } from "../../../models/intake/imported-artifact.js";
import { IntakeSessionSchema } from "../../../models/intake/session.js";
import { IntakePlanManifestSchema } from "../../../models/intake/manifest.js";

export const IMPORTED_ARTIFACT_DDL = `CREATE TABLE imported_artifacts (
  record_key TEXT PRIMARY KEY,
  session_id TEXT UNIQUE,
  manifest_id TEXT UNIQUE,
  workflow TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  created_at TEXT NOT NULL,
  CHECK(record_key IS json_extract(record_json,'$.importId')),
  CHECK(session_id IS json_extract(record_json,'$.sessionId')),
  CHECK(manifest_id IS json_extract(record_json,'$.manifestId')),
  CHECK(workflow IS json_extract(record_json,'$.workflow')),
  CHECK(source_sha256 IS json_extract(record_json,'$.sourceSha256')),
  CHECK(created_at IS json_extract(record_json,'$.createdAt'))
) STRICT`;
export const IMPORTED_ARTIFACT_TRIGGERS = [
  `CREATE TRIGGER imported_artifacts_insert_conflict BEFORE INSERT ON imported_artifacts
   WHEN EXISTS(SELECT 1 FROM imported_artifacts WHERE record_key=NEW.record_key OR session_id=NEW.session_id OR manifest_id=NEW.manifest_id)
   BEGIN SELECT RAISE(ABORT,'imported artifact insert conflicts with retained identity'); END`,
  `CREATE TRIGGER imported_artifacts_submission_retained BEFORE DELETE ON imported_artifacts
   WHEN json_type(OLD.record_json,'$.submittedJson') = 'text'
   BEGIN SELECT RAISE(ABORT,'submitted imports are never deleted'); END`,
  `CREATE TRIGGER imported_artifacts_submission_immutable BEFORE UPDATE ON imported_artifacts
   WHEN json_type(OLD.record_json,'$.submittedJson') = 'text' AND
     (json_extract(NEW.record_json,'$.submittedJson') IS NOT json_extract(OLD.record_json,'$.submittedJson')
      OR NEW.record_key IS NOT OLD.record_key OR NEW.session_id IS NOT OLD.session_id
      OR NEW.manifest_id IS NOT OLD.manifest_id OR NEW.source_sha256 IS NOT OLD.source_sha256)
   BEGIN SELECT RAISE(ABORT,'imported-artifact-submission-immutable'); END`,
  `CREATE INDEX imported_artifacts_source_idx ON imported_artifacts(source_sha256,created_at)`,
] as const;

interface ImportedArtifactPorts {
  database: DatabaseSync;
  mutate<T>(this: void, work: () => Readonly<{ result: T; changes: number }>): T;
}
const RowSchema = z.strictObject({ record_json: z.string() });
function readRow(row: unknown): ImportedArtifact | undefined {
  return row === undefined ? undefined : ImportedArtifactSchema.parse(JSON.parse(RowSchema.parse(row).record_json));
}
export function insertImportedArtifact(database: DatabaseSync, record: ImportedArtifact): void {
  database.prepare(`INSERT INTO imported_artifacts(record_key,session_id,manifest_id,workflow,source_sha256,record_json,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(record.importId, record.sessionId, record.manifestId, record.workflow,
    record.sourceSha256, canonicalJsonStringify(record), record.createdAt);
}

/** Must be called inside the stopped upgrade transaction, before dropping either historical table. */
export function convertImportedArtifacts(database: DatabaseSync): void {
  const sessions = database.prepare("SELECT record_json FROM intake_sessions ORDER BY record_key").all();
  const manifests = new Map(database.prepare("SELECT record_key,record_json FROM intake_manifests ORDER BY record_key").all()
    .map((raw) => { const row = z.strictObject({ record_key: z.string(), record_json: z.string() }).parse(raw); return [row.record_key, row.record_json]; }));
  const used = new Set<string>();
  for (const raw of sessions) {
    const json = RowSchema.parse(raw).record_json;
    const session = IntakeSessionSchema.parse(JSON.parse(json));
    const id = session.reservedManifestId ?? session.intakeManifestId;
    const submitted = id === undefined ? undefined : manifests.get(id);
    if (submitted !== undefined && ((id !== undefined && used.has(id)) || session.state !== "enqueued")) throw new Error("imported-artifact-linkage-invalid");
    insertImportedArtifact(database, importedArtifact(json, submitted ?? null));
    if (submitted !== undefined && id !== undefined) used.add(id);
  }
  for (const [id, json] of manifests) if (!used.has(id)) insertImportedArtifact(database, importedArtifact(null, json));
}

export function createImportedArtifactRepositories(ports: ImportedArtifactPorts) {
  const { database, mutate } = ports;
  const find = (column: "session_id" | "manifest_id", id: string) => readRow(database.prepare(
    `SELECT record_json FROM imported_artifacts WHERE ${column}=?`).get(id));
  const save = (old: ImportedArtifact, record: ImportedArtifact) => {
    const changes = Number(database.prepare(`UPDATE imported_artifacts SET record_json=? WHERE record_key=? AND record_json=?`)
      .run(canonicalJsonStringify(record), old.importId, canonicalJsonStringify(old)).changes);
    if (changes !== 1) throw new Error("imported-artifact-version-conflict");
  };
  return Object.freeze({
    sessions: Object.freeze({
      create(input: unknown) {
        const session = IntakeSessionSchema.parse(input);
        if (session.reservedManifestId === undefined) throw new Error(`intake session ${session.intakeSessionId} cannot be created with reserved manifest id absent`);
        if (session.state !== "mapping" || session.version !== 1) throw new Error("intake session must be created in mapping state at version 1");
        return mutate(() => { insertImportedArtifact(database, importedArtifact(canonicalJsonStringify(session), null)); return { result: session, changes: 1 }; });
      },
      get(id: string) {
        const record = find("session_id", id);
        return record?.preparationJson == null ? undefined : IntakeSessionSchema.parse(JSON.parse(record.preparationJson));
      },
      update(input: unknown) {
        const session = IntakeSessionSchema.parse(input);
        return mutate(() => {
          const old = find("session_id", session.intakeSessionId);
          if (old?.preparationJson == null) throw new Error("intake session update raced past its expected predecessor");
          const previous = IntakeSessionSchema.parse(JSON.parse(old.preparationJson));
          if (previous.reservedManifestId !== session.reservedManifestId) throw new Error(`intake session ${session.intakeSessionId} cannot change reserved manifest id from ${previous.reservedManifestId ?? "absent"} to ${session.reservedManifestId ?? "absent"}`);
          if (previous.version !== session.version - 1) throw new Error("intake session update raced past its expected predecessor");
          if (previous.state === "enqueued") throw new Error("imported-artifact-submission-immutable");
          if (previous.workflow !== session.workflow || canonicalJsonStringify(previous.artifact) !== canonicalJsonStringify(session.artifact)) throw new Error("imported-artifact-source-immutable");
          save(old, importedArtifact(canonicalJsonStringify(session), old.submittedJson));
          return { result: session, changes: 1 };
        });
      },
      findActiveBySource(source: string) {
        return database.prepare("SELECT record_json FROM imported_artifacts WHERE source_sha256=? ORDER BY created_at,record_key").all(source)
          .map(readRow).flatMap((r) => r?.preparationJson == null ? [] : [IntakeSessionSchema.parse(JSON.parse(r.preparationJson))])
          .filter((s) => s.state === "mapping" || s.state === "validated");
      },
    }),
    manifests: Object.freeze({
      insert(input: unknown) {
        const manifest = IntakePlanManifestSchema.parse(input); const json = canonicalJsonStringify(manifest);
        return mutate<{ state: "existing" | "inserted"; record: z.output<typeof IntakePlanManifestSchema> }>(() => {
          const old = find("manifest_id", manifest.manifestId);
          if (old?.submittedJson != null) {
            if (canonicalJsonStringify(JSON.parse(old.submittedJson)) !== json) throw new Error(`intake manifest ${manifest.manifestId} already exists with different content`);
            return { result: { state: "existing" as const, record: manifest }, changes: 0 };
          }
          if (old === undefined) insertImportedArtifact(database, importedArtifact(null, json));
          else save(old, importedArtifact(old.preparationJson, json));
          return { result: { state: "inserted" as const, record: manifest }, changes: 1 };
        });
      },
      get(id: string) {
        const record = find("manifest_id", id);
        return record?.submittedJson == null ? undefined : IntakePlanManifestSchema.parse(JSON.parse(record.submittedJson));
      },
      findBySource(source: string) {
        return database.prepare("SELECT record_json FROM imported_artifacts WHERE source_sha256=? ORDER BY created_at,record_key").all(source)
          .map(readRow).flatMap((r) => r?.submittedJson == null ? [] : [IntakePlanManifestSchema.parse(JSON.parse(r.submittedJson))]);
      },
    }),
  });
}
