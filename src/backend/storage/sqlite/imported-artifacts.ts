import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { ImportedArtifactSchema, importedArtifact, type ImportedArtifact } from "../../../models/intake/imported-artifact.js";
import { IntakeSessionSchema } from "../../../models/intake/session.js";
import { IntakePlanManifestSchema } from "../../../models/intake/manifest.js";

interface ImportedArtifactPorts {
  database: DatabaseSync;
  mutate<T>(this: void, work: () => Readonly<{ result: T; changes: number }>): T;
}
const RowSchema = z.strictObject({ id: z.string(), kind: z.literal("imported"), workflow: z.string(), source_sha256: z.string(),
  source_page: z.null(), form_type: z.null(), page_kind: z.null(), page_fingerprint: z.null(), source_kind: z.null(),
  session_id: z.string().nullable(), manifest_id: z.string().nullable(), sink_id: z.null(), export_id: z.null(),
  version: z.number().int().positive(), payload_json: z.string(), created_at: z.string() });
function artifactVersion(record: ImportedArtifact) { return record.preparationJson === null ? 1 : IntakeSessionSchema.parse(JSON.parse(record.preparationJson)).version; }
export function importedArtifactFromRow(row: unknown): ImportedArtifact | undefined {
  if (row === undefined) return undefined;
  const columns = RowSchema.parse(row);
  const record = ImportedArtifactSchema.parse(JSON.parse(columns.payload_json));
  if (columns.id !== record.importId || columns.workflow !== record.workflow || columns.source_sha256 !== record.sourceSha256
    || columns.session_id !== record.sessionId || columns.manifest_id !== record.manifestId || columns.version !== artifactVersion(record)
    || columns.created_at !== record.createdAt) throw new Error("imported-artifact-row-identity-mismatch");
  return record;
}
export function insertImportedArtifact(database: DatabaseSync, record: ImportedArtifact): void {
  database.prepare(`INSERT INTO artifacts(id,kind,session_id,manifest_id,workflow,source_sha256,version,payload_json,created_at)
    VALUES(?,'imported',?,?,?,?,?,?,?)`).run(record.importId, record.sessionId, record.manifestId, record.workflow,
    record.sourceSha256, artifactVersion(record), canonicalJsonStringify(record), record.createdAt);
}

export function createImportedArtifactRepositories(ports: ImportedArtifactPorts) {
  const { database, mutate } = ports;
  const find = (column: "session_id" | "manifest_id", id: string) => importedArtifactFromRow(database.prepare(
    `SELECT * FROM artifacts WHERE kind='imported' AND ${column}=?`).get(id));
  const save = (old: ImportedArtifact, record: ImportedArtifact) => {
    const changes = Number(database.prepare(`UPDATE artifacts SET payload_json=?,version=?,session_id=?,manifest_id=? WHERE kind='imported' AND id=? AND payload_json=?`)
      .run(canonicalJsonStringify(record), artifactVersion(record), record.sessionId, record.manifestId, old.importId, canonicalJsonStringify(old)).changes);
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
          if (previous.workbookSource?.libraryId !== session.workbookSource?.libraryId || previous.workbookSource?.version !== session.workbookSource?.version) throw new Error("imported-artifact-workbook-source-immutable");
          if (previous.workflow !== session.workflow || canonicalJsonStringify(previous.artifact) !== canonicalJsonStringify(session.artifact)) throw new Error("imported-artifact-source-immutable");
          save(old, importedArtifact(canonicalJsonStringify(session), old.submittedJson));
          return { result: session, changes: 1 };
        });
      },
      findActiveBySource(source: string) {
        return database.prepare("SELECT * FROM artifacts WHERE kind='imported' AND source_sha256=? ORDER BY created_at,id").all(source)
          .map(importedArtifactFromRow).flatMap((r) => r?.preparationJson == null ? [] : [IntakeSessionSchema.parse(JSON.parse(r.preparationJson))])
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
        return database.prepare("SELECT * FROM artifacts WHERE kind='imported' AND source_sha256=? ORDER BY created_at,id").all(source)
          .map(importedArtifactFromRow).flatMap((r) => r?.submittedJson == null ? [] : [IntakePlanManifestSchema.parse(JSON.parse(r.submittedJson))]);
      },
    }),
  });
}
