import { z } from "zod";
import { NoteWireSchema, projectNoteForOperator } from "../../events/types.js";
import { hasProtectedTransactionInput, retainedRunProtectedBindings, valueFreeProtectedData } from "../../domain/protected-input.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../infra/sqlite/storage-records.js";
import { ArchiveReportSectionSchema, sealArchiveReport, type ArchiveReport } from "../../domain/archive/report.js";
import { JsonValueSchema, canonicalJsonStringify, type JsonValue } from "../../domain/canonical-json.js";
import { sha256Hex } from "../../domain/sha256.js";
import { LifecycleSourceSnapshotSchema, lifecycleSourceDigest, type LifecycleSourceSnapshot } from "../../core/run-lifecycle-storage.js";

type Section = ArchiveReport["content"]["sections"][number];
type Cell = string | number | boolean | null;

/** Flatten structure into labelled, typed cells. No live schema is needed to view it. */
export function genericArchiveSection(title: string, value: JsonValue): Section {
  const rows: { label: string; value: Cell }[] = [];
  const visit = (entry: JsonValue, path: string): void => {
    if (entry === null || typeof entry !== "object") { rows.push({ label: path || "Value", value: entry }); return; }
    const entries = Object.entries(entry);
    if (entries.length === 0) { rows.push({ label: path || "Value", value: Array.isArray(entry) ? "Empty list" : "Empty record" }); return; }
    for (const [key, child] of entries) visit(child, path ? `${path}.${key}` : key);
  };
  visit(value, "");
  return { kind: "values", title, values: rows };
}

/** Source bytes and their digest stay private; display data is projected before sealing. */
export function captureArchiveReport(input: Readonly<{
  versionChange?: ArchiveReport["content"]["versionChange"];
  snapshot: LifecycleSourceSnapshot; transferId: string; capturedAt: string;
  sections: ArchiveReport["content"]["sections"]; files: ArchiveReport["content"]["files"];
}>): ArchiveReport {
  const snapshot = LifecycleSourceSnapshotSchema.parse(input.snapshot);
  const { run } = snapshot;
  if (run.lifecycle.state !== "terminal") throw new Error("archive-source-not-terminal");
  if (new Set(snapshot.records.map(group => group.table)).size !== snapshot.records.length) throw new Error("archive-source-group-duplicate");
  const json = canonicalJsonStringify(snapshot);
  const files = input.files.map(file => ({ ...file, artifactIds: [...(file.artifactIds ?? [])] }));
  for (const row of snapshot.records.find(group => group.table === "diagnostic_files")?.rows ?? []) {
    const { attachment } = DiagnosticAttachmentStorageRecordSchema.parse(JSON.parse(row.json));
    const retained = files.find(file => file.digest === attachment.digest && file.byteLength === attachment.byteLength && file.mediaType === attachment.mediaType);
    if (retained === undefined) throw new Error("archive-capture-file-omitted");
    if (!retained.artifactIds.includes(attachment.artifactId)) retained.artifactIds.push(attachment.artifactId);
  }
  const bindings = retainedRunProtectedBindings(run);
  const decodeRecord = (table: string, json: string): JsonValue => {
    if (table === "notes_files") return JsonValueSchema.parse(projectNoteForOperator(NoteWireSchema.parse(JSON.parse(json)), hasProtectedTransactionInput(run)));
    if (table === "archive_transactions") {
      const wrapper = z.strictObject({ json: z.string().nullable(), digest: z.string().nullable() }).parse(JSON.parse(json));
      return wrapper.json === null ? { state: "unavailable", reason: "Historical transaction supplement absent" } : JsonValueSchema.parse(JSON.parse(wrapper.json));
    }
    return JsonValueSchema.parse(JSON.parse(json));
  };
  const records = snapshot.records.map(group => ({ table: group.table, rows: group.rows.map(row => ({ key: row.key,
    value: decodeRecord(group.table, row.json),
  })) }));
  // Project one combined object so protected values repeated in text/derived data
  // are removed even when their declaration is in a different source group.
  const original = { run, records, sections: input.sections };
  const secrets = bindings.flatMap(binding => {
    const raw = run.input.raw;
    const parsed = run.input.parsed.value;
    return [raw, parsed].flatMap(value => {
      if (value === null || typeof value !== "object") return [];
      const secret: unknown = Reflect.get(value, binding.inputPath);
      return typeof secret === "string" && secret.length > 0 ? [secret] : [];
    });
  });
  const scrub = (value: JsonValue): JsonValue => {
    if (typeof value === "string") {
      let text = value;
      for (const secret of secrets) text = text.replaceAll(secret, "[protected]").replaceAll(sha256Hex(secret), "[protected digest]");
      return secrets.length > 0 ? text.replace(/[a-f0-9]{64}/giu, "[protected digest]") : text;
    }
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(entry => scrub(JsonValueSchema.parse(entry)));
    if (secrets.length > 0 && typeof Reflect.get(value, "label") === "string"
      && /digest|fingerprint/iu.test(String(Reflect.get(value, "label")))) return { ...value, value: "[protected digest]" };
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      secrets.length > 0 && /digest|fingerprint/iu.test(key) ? "[protected digest]" : scrub(JsonValueSchema.parse(child))]));
  };
  const safe = z.object({ run: JsonValueSchema, records: z.array(JsonValueSchema), sections: z.array(ArchiveReportSectionSchema) })
    .parse(scrub(valueFreeProtectedData(original, bindings)));
  const sections: Section[] = [genericArchiveSection("Run and frozen inputs", safe.run)];
  for (const [index, group] of snapshot.records.entries()) {
    sections.push(group.rows.length === 0
      ? { kind: "unavailable", title: group.table, reason: "No source record was retained at capture" }
      : genericArchiveSection(group.table, safe.records[index]));
  }
  sections.push(...safe.sections);
  return sealArchiveReport({ schemaVersion: 1, runId: run.envelope.runId, transferId: input.transferId,
    workflow: run.envelope.workflow, itemId: run.envelope.itemId, attempt: run.envelope.attempt, runNumber: run.runNumber ?? null,
    title: z.string().parse(scrub(run.displayName ?? run.envelope.workflow)), descriptorVersion: String(run.envelope.descriptorVersion),
    outcome: run.lifecycle.outcome, completedAt: run.lifecycle.endedAt, capturedAt: input.capturedAt,
    sourceDigest: lifecycleSourceDigest(snapshot), sources: [{ kind: "authority-snapshot", json, digest: sha256Hex(json) }],
    sections, files, ...(input.versionChange === undefined ? {} : { versionChange: input.versionChange }),
  });
}
