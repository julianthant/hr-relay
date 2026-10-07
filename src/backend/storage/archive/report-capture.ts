import { z } from "zod";
import { NoteWireSchema, projectNoteForOperator } from "../../../models/events/types.js";
import { hasProtectedTransactionInput, retainedRunProtectedBindings, valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../sqlite/storage-records.js";
import { ArchiveReportSectionSchema, sealArchiveReport, type ArchiveReport, type ArchiveReportCell } from "../../../models/archive/report.js";
import { JsonValueSchema, canonicalJsonStringify, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { LifecycleSourceSnapshotSchema, lifecycleSourceDigest, type LifecycleSourceSnapshot } from "../../../models/archive/lifecycle-source.js";
import { RunRuntimeVersionStampSchema } from "../../../models/archive/runtime-version.js";

type Section = ArchiveReport["content"]["sections"][number];
/** Flatten structure into labelled, typed cells. No live schema is needed to view it. */
export function genericArchiveSection(title: string, value: JsonValue): Section {
  const rows: { label: string; value: ArchiveReportCell }[] = [];
  const visit = (entry: JsonValue, path: string): void => {
    if (entry === null || typeof entry !== "object") { rows.push({ label: path || "Value", value: entry }); return; }
    const entries = Object.entries(entry);
    if (entries.length === 0) { rows.push({ label: path || "Value", value: entry }); return; }
    for (const [key, child] of entries) visit(child, path ? `${path}.${key}` : key);
  };
  visit(value, "");
  return { kind: "values", title, values: rows };
}

/** Source bytes and their digest stay private; display data is projected before sealing. */
export function captureArchiveReport(input: Readonly<{
  manualArchive?: ArchiveReport["content"]["manualArchive"];
  versionChange?: ArchiveReport["content"]["versionChange"];
  adoptedRuntimeVersion?: z.input<typeof RunRuntimeVersionStampSchema>;
  snapshot: LifecycleSourceSnapshot; transferId: string; capturedAt: string;
  sections: ArchiveReport["content"]["sections"]; files: ArchiveReport["content"]["files"];
}>): ArchiveReport {
  const snapshot = LifecycleSourceSnapshotSchema.parse(input.snapshot);
  const { run } = snapshot;
  if (run.runtimeVersion !== undefined && input.adoptedRuntimeVersion !== undefined) throw new Error("archive-runtime-version-attribution-conflict");
  const runtimeVersion = run.runtimeVersion ?? input.adoptedRuntimeVersion;
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
  // Free-form resolution notes are protected independently of input values.
  // Collect them before projection so command/audit copies and supplied sections
  // cannot reintroduce text withheld from the live operator view.
  const protectedNotes = new Set<string>();
  const collectNotes = (value: JsonValue): void => {
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "note" && typeof child === "string" && child.length > 0) protectedNotes.add(child);
      else collectNotes(child);
    }
  };
  if (hasProtectedTransactionInput(run)) collectNotes(JsonValueSchema.parse(original));
  const scrub = (value: JsonValue): JsonValue => {
    if (typeof value === "string") {
      let text = value;
      for (const note of protectedNotes) text = text.replaceAll(note, "Protected resolution note withheld.");
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
  const member = (value: JsonValue | undefined, key: string): JsonValue | undefined =>
    value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Readonly<Record<string, JsonValue>>)[key] : undefined;
  const envelope = member(safe.run, "envelope");
  const frozenInput = member(safe.run, "input");
  const settingsIndex = snapshot.records.findIndex(group => group.table === "settings_snapshots");
  const retainedSettings = settingsIndex < 0 ? undefined : member(safe.records[settingsIndex], "rows");
  const settingsRows: readonly JsonValue[] = Array.isArray(retainedSettings) ? retainedSettings as JsonValue[] : [];
  const settings = settingsRows.length === 1 ? member(settingsRows[0], "value") : undefined;
  const runMode = member(envelope, "dryRun");
  const submittedInput = member(frozenInput, "raw");
  const parsedInput = member(member(frozenInput, "parsed"), "value");
  const inputSection: Section = { kind: "values", title: "Inputs & settings", values: [
    { label: "Run mode", value: runMode === true ? "Dry run" : runMode === false ? "Live run" : "Unavailable" },
    { label: "Submitted input", value: submittedInput === undefined ? { state: "unavailable", reason: "Submitted input was not retained" } : submittedInput },
    { label: "Parsed input", value: parsedInput === undefined ? { state: "unavailable", reason: "Parsed input was not retained" } : parsedInput },
    { label: "Captured settings", value: member(settings, "config") ?? { state: "unavailable", reason: "No settings snapshot was retained for this run" } },
  ] };
  const receiptsIndex = snapshot.records.findIndex(group => group.table === "run_receipts");
  const receiptRows = receiptsIndex < 0 ? undefined : member(safe.records[receiptsIndex], "rows");
  const receipts = Array.isArray(receiptRows) ? receiptRows as JsonValue[] : [];
  const candidateReceipt = receipts.length === 1 ? member(receipts[0], "value") : undefined;
  const receipt = member(candidateReceipt, "runId") === run.envelope.runId ? candidateReceipt : undefined;
  const receiptResult = member(receipt, "result");
  const verification = receipts.length === 0 ? "Not recorded" : receipts.length > 1 ? "Unavailable: multiple receipts retained"
    : typeof receiptResult === "string" && ["verified-done", "done-with-warnings", "failed", "cancelled", "partial"].includes(receiptResult)
      ? ({ "verified-done": "Verified", "done-with-warnings": "Completed with warnings", failed: "Failed", cancelled: "Cancelled", partial: "Partial" } as Record<string, string>)[receiptResult]
      : "Unavailable: retained receipt result or identity is invalid";
  const enqueuedAt = member(envelope, "enqueuedAt");
  const lifecycle = member(safe.run, "lifecycle");
  const endedAt = member(lifecycle, "endedAt");
  const elapsed = typeof enqueuedAt === "string" && typeof endedAt === "string"
    && Number.isFinite(Date.parse(enqueuedAt)) && Number.isFinite(Date.parse(endedAt)) && Date.parse(endedAt) >= Date.parse(enqueuedAt)
    ? Date.parse(endedAt) - Date.parse(enqueuedAt) : null;
  const summarySection: Section = { kind: "values", title: "Run summary", values: [
    { label: "Outcome", value: run.lifecycle.outcome },
    { label: "Verification result", value: verification },
    { label: "Queued", value: typeof enqueuedAt === "string" ? enqueuedAt : "Not recorded" },
    { label: "Completed", value: typeof endedAt === "string" ? endedAt : "Not recorded" },
    { label: "Total elapsed", value: elapsed ?? "Not recorded" },
    { label: "Run mode", value: runMode === true ? "Dry run" : runMode === false ? "Live run" : "Not recorded" },
    { label: "Attempt", value: run.envelope.attempt },
  ] };
  const actions = member(receipt, "actions");
  const relationships: Section = { kind: "values", title: "Retained file relationships", values: [] };
  if (Array.isArray(actions)) for (const rawAction of actions) {
    const action = JsonValueSchema.parse(rawAction);
    const artifactId = member(action, "artifactId");
    const taskId = member(action, "taskId");
    const actionId = member(action, "id");
    if (typeof artifactId !== "string" || typeof taskId !== "string" || typeof actionId !== "string") continue;
    for (const file of files) if (file.artifactIds.includes(artifactId) && !relationships.values.some(row => row.label === file.digest && JSON.stringify(row.value) === JSON.stringify({ taskId, actionId }))) relationships.values.push({ label: file.digest, value: { taskId, actionId } });
  }
  const sections: Section[] = [genericArchiveSection("Run and frozen inputs", safe.run), summarySection, inputSection];
  if (relationships.values.length > 0) sections.push(relationships);
  for (const [index, group] of snapshot.records.entries()) {
    sections.push(group.rows.length === 0
      ? { kind: "unavailable", title: group.table, reason: "No source record was retained at capture" }
      : genericArchiveSection(group.table, safe.records[index]));
  }
  sections.push(...safe.sections);
  return sealArchiveReport({ schemaVersion: runtimeVersion === undefined ? 1 : 2, runId: run.envelope.runId, transferId: input.transferId,
    workflow: run.envelope.workflow, itemId: run.envelope.itemId, attempt: run.envelope.attempt, runNumber: run.runNumber ?? null,
    title: z.string().parse(scrub(run.displayName ?? run.envelope.workflow)), descriptorVersion: String(run.envelope.descriptorVersion),
    outcome: run.lifecycle.outcome, completedAt: run.lifecycle.endedAt, capturedAt: input.capturedAt,
    sourceDigest: lifecycleSourceDigest(snapshot), sources: [{ kind: "authority-snapshot", json, digest: sha256Hex(json) }],
    sections, files, ...(input.manualArchive === undefined ? {} : { manualArchive: input.manualArchive }), ...(input.versionChange === undefined ? {} : { versionChange: input.versionChange }),
    ...(runtimeVersion === undefined ? {} : { runtimeVersion: { state: run.runtimeVersion === undefined ? "adopted" : "stamped", ...RunRuntimeVersionStampSchema.parse(runtimeVersion) } }),
  });
}
