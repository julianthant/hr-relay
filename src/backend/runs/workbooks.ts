import { z } from "zod";
import type { AuthorityDatabase, AuthorityRepositories } from "../storage/sqlite/authority-database.js";
import { RunWorkbookReferenceSchema, type WorkbookOperationReceipt, type WorkbookOperationRecord } from "../../models/dashboard/workbooks.js";
import { RunWorkbookWritesWireSchema, type RunWorkbookWritesWire } from "../../models/dashboard/run-detail.js";
import { WorkbookReferenceWriteSchema } from "../../models/processing/workbooks/read-result.js";
import { ReadWorkbookReference, WorkbookReferenceReadSchema } from "../../models/processing/workbooks/read-reference.js";
import { schemaBoundValueSchema, deriveSchemaHash } from "../../models/validation/schema-bound-value.js";
import type { RunRecord } from "../../models/run/record.js";
import type { CommandRequest } from "../../rules/commands/commands.js";
import { deriveStableUuid } from "../../rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { localDatePart, type Clock } from "../../rules/time/clock.js";
import { WorkbookLibraryError, snapshotWorkbookReference, writeRunWorkbook } from "../workbooks/workbook-library-service.js";
import { rejectCommandRequest } from "./commands/command-refusal.js";

type Reference = z.infer<typeof RunWorkbookReferenceSchema>;
type RowCommand = Extract<CommandRequest, { type: "resolve-workbook-row" }>;
const referenceHash = deriveSchemaHash(RunWorkbookReferenceSchema, "output");

function references(run: RunRecord): readonly Readonly<{ value: Reference; digest: string }>[] {
  const parsed = (run.input.workbookReferences ?? []).map(bound => ({
    value: schemaBoundValueSchema(RunWorkbookReferenceSchema, referenceHash).parse(bound).value,
    digest: sha256Hex(canonicalJsonStringify(bound)),
  }));
  if (new Set(parsed.map(reference => reference.value.request.typeId)).size !== parsed.length) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  return parsed;
}

function referenceFor(run: RunRecord, typeId: string) {
  const found = references(run).find(reference => reference.value.request.typeId === typeId);
  if (found === undefined) throw new WorkbookLibraryError("WORKBOOK_INVALID");
  return found;
}

function referenceOfOperation(run: RunRecord, entry: WorkbookOperationRecord) {
  const source = entry.operation.source;
  const found = source.kind !== "run" || source.runId !== run.envelope.runId ? undefined
    : references(run).find(reference => reference.digest === source.referenceDigest && reference.value.snapshot.libraryId === entry.libraryId);
  if (found === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  const change = entry.operation.change;
  if ((change.kind !== "patch" && change.kind !== "add") || !found.value.request.keys.includes(change.key)
    || Object.keys(change.values).some(field => !found.value.request.fields.includes(field))) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  return found;
}

function operationEventId(runId: string, libraryId: string, operationId: string) {
  return deriveStableUuid("run-workbook-write", canonicalJsonStringify({ runId, libraryId, operationId }));
}

function appendReceipt(repositories: AuthorityRepositories, run: RunRecord, receipt: WorkbookOperationReceipt, resolvedBy?: string) {
  const eventId = operationEventId(run.envelope.runId, receipt.libraryId, receipt.operationId);
  const digest = sha256Hex(canonicalJsonStringify(receipt));
  const existing = repositories.timelineEvents.get(eventId);
  if (existing !== undefined) {
    if (existing.payload.kind !== "workbook-write-recorded" || existing.payload.runId !== run.envelope.runId
      || existing.payload.libraryId !== receipt.libraryId || existing.payload.operationId !== receipt.operationId
      || existing.payload.receiptDigest !== digest) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    return;
  }
  repositories.timelineEvents.append({ schemaVersion: 1, eventId, workflow: run.envelope.workflow,
    scope: { kind: "run", runId: run.envelope.runId }, occurredAt: receipt.at, recordedAt: receipt.at,
    retentionDate: localDatePart(new Date(receipt.at)), source: { kind: "native" },
    payload: { kind: "workbook-write-recorded", runId: run.envelope.runId, workflow: run.envelope.workflow,
      attempt: run.envelope.attempt, traceId: run.envelope.traceId, claimGeneration: run.claimGeneration,
      libraryId: receipt.libraryId, operationId: receipt.operationId, receiptDigest: digest, at: receipt.at,
      ...(resolvedBy === undefined ? {} : { resolvedBy }) } });
}

function capturedOperations(repositories: AuthorityRepositories, run: RunRecord) {
  const entries = repositories.workbooks.runOperations(run.envelope.runId)
    .filter(entry => entry.operation.source.kind === "run" && entry.operation.source.referenceDigest !== undefined);
  for (const entry of entries) referenceOfOperation(run, entry);
  return entries;
}

function hasResolution(entries: readonly WorkbookOperationRecord[], entry: WorkbookOperationRecord): boolean {
  return entries.some(candidate => candidate.libraryId === entry.libraryId && candidate.receipt.state === "applied"
    && candidate.operation.change.kind === "patch" && candidate.operation.change.resolves?.operationId === entry.operation.operationId);
}

function liveCandidates(repositories: AuthorityRepositories, reference: Reference, key: string) {
  const live = snapshotWorkbookReference(repositories.workbooks, { ...reference.request, libraryId: reference.snapshot.libraryId, keys: [key] });
  if (live.type.keyFieldId !== reference.snapshot.type.keyFieldId) throw new WorkbookLibraryError("WORKBOOK_INVALID");
  const sheets = new Set(reference.snapshot.worksheets.map(sheet => sheet.sheetId));
  const record = repositories.workbooks.read(live.libraryId);
  if (record === undefined || record.version !== live.version) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
  const matches = live.rows[0];
  if (matches === undefined || matches.key !== key) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  return { version: live.version, candidates: matches.matches.filter(match => sheets.has(match.sheetId)).map(match => {
    const sheet = record.workbook.sheets.find(sheet => sheet.id === match.sheetId);
    const row = sheet?.rows.findIndex(row => row.id === match.rowId);
    if (sheet === undefined || row === undefined || row < 0) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    return { sheetId: match.sheetId, rowId: match.rowId, label: `${sheet.name} · Row ${row + 1}` };
  }) };
}

export function buildRunWorkbookSection(repositories: AuthorityRepositories, run: RunRecord): RunWorkbookWritesWire {
  const entries = capturedOperations(repositories, run);
  return RunWorkbookWritesWireSchema.parse({ runId: run.envelope.runId, operations: entries.map(entry => {
    const event = repositories.timelineEvents.get(operationEventId(run.envelope.runId, entry.libraryId, entry.operation.operationId));
    if (event?.payload.kind !== "workbook-write-recorded" || event.payload.runId !== run.envelope.runId
      || event.payload.attempt > run.envelope.attempt || event.payload.traceId !== run.envelope.traceId
      || event.payload.receiptDigest !== sha256Hex(canonicalJsonStringify(entry.receipt))) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    const native = { eventId: event.eventId, order: event.cursor, runId: run.envelope.runId,
      attempt: event.payload.attempt, traceId: event.payload.traceId, spanPath: run.envelope.traceId };
    const base = { receipt: entry.receipt, native };
    if (entry.receipt.state !== "resolve-required") return { ...base, resolution: { state: "not-required" } };
    if (hasResolution(entries, entry)) return { ...base, resolution: { state: "resolved" } };
    const reference = referenceOfOperation(run, entry).value;
    const change = entry.operation.change;
    if (change.kind !== "patch" && change.kind !== "add") throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    const live = liveCandidates(repositories, reference, change.key);
    if (live.candidates.length === 0) return { ...base, resolution: { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE" } };
    const target = { runId: run.envelope.runId, expectedVersion: run.version, libraryId: entry.libraryId,
      operationId: entry.operation.operationId, receiptDigest: sha256Hex(canonicalJsonStringify(entry.receipt)), workbookVersion: live.version };
    return { ...base, resolution: { state: "available", target, candidates: live.candidates, action: {
      kind: "command", key: "resolve-workbook-row", command: "resolve-workbook-row", label: "Choose a row", intent: "primary", icon: "resolve",
      placement: ["review"], expectedVersion: run.version, workbookTarget: target,
      confirm: { title: "Apply the captured workbook change to this row", body: "Relay checks the current key, worksheet, revision and cell ownership before applying the retained values.", confirmLabel: "Apply change", tone: "neutral" },
    } } };
  }) });
}

export function createRunWorkbookService(deps: Readonly<{ database: AuthorityDatabase; clock: Clock }>) {
  return Object.freeze({
    read(captured: RunRecord, value: z.infer<typeof WorkbookReferenceReadSchema>) {
      const command = WorkbookReferenceReadSchema.parse(value);
      return deps.database.withAuthorityReadSnapshot(() => {
        const repositories = deps.database.authority, run = repositories.runs.get(captured.envelope.runId);
        if (run?.lifecycle.state !== "running" || run.cancelRequested === true
          || run.envelope.attempt !== captured.envelope.attempt || run.claimGeneration !== captured.claimGeneration
          || canonicalJsonStringify(run.input) !== canonicalJsonStringify(captured.input)) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const reference = referenceFor(run, command.typeId).value;
        if (canonicalJsonStringify(command.fields) !== canonicalJsonStringify(reference.request.fields)
          || reference.snapshot.type.keyFieldId === null) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const versionId: unknown = Reflect.get(reference.snapshot, "versionId"), versionName: unknown = Reflect.get(reference.snapshot, "versionName");
        const version = z.strictObject({ versionId: z.string().min(1), versionName: z.string().min(1) }).safeParse({ versionId, versionName });
        if (!version.success) throw new WorkbookLibraryError("WORKBOOK_REVISION_UNAVAILABLE");
        const snapshot = snapshotWorkbookReference(repositories.workbooks, { ...reference.request, libraryId: reference.snapshot.libraryId,
          versionId: version.data.versionId, keys: command.keys, fields: command.fields });
        if (Reflect.get(snapshot, "versionId") !== version.data.versionId
          || snapshot.type.id !== reference.snapshot.type.id || snapshot.type.keyFieldId !== reference.snapshot.type.keyFieldId
          || canonicalJsonStringify(snapshot.worksheets) !== canonicalJsonStringify(reference.snapshot.worksheets)) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
        return ReadWorkbookReference.output.parse({ state: "read", reference: {
          libraryId: reference.snapshot.libraryId, version: reference.snapshot.version,
          ...version.data, typeId: reference.snapshot.type.id, keyFieldId: reference.snapshot.type.keyFieldId,
          worksheets: snapshot.worksheets, rows: snapshot.rows.map(row => ({ ...row,
            matches: row.matches.map(match => ({ sheetId: match.sheetId, rowId: match.rowId,
              cells: Object.entries(match.values).map(([fieldId, value]) => ({ fieldId, value })) })),
          })),
        } });
      });
    },
    write(captured: RunRecord, value: z.infer<typeof WorkbookReferenceWriteSchema>): WorkbookOperationReceipt {
      const command = WorkbookReferenceWriteSchema.parse(value);
      return deps.database.withAuthorityTransaction(repositories => {
        const run = repositories.runs.get(captured.envelope.runId);
        if (run?.lifecycle.state !== "running" || run.envelope.attempt !== captured.envelope.attempt
          || Number(run.claimGeneration) !== Number(captured.claimGeneration)
          || canonicalJsonStringify(run.input) !== canonicalJsonStringify(captured.input)) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const reference = referenceFor(run, command.typeId);
        const operationId = deriveStableUuid("run-workbook-write-request", canonicalJsonStringify({ runId: run.envelope.runId, writeId: command.writeId }));
        const previous = repositories.workbooks.runOperations(run.envelope.runId).find(entry => entry.operation.operationId === operationId);
        if (previous !== undefined && previous.libraryId !== reference.value.snapshot.libraryId) throw new WorkbookLibraryError("WORKBOOK_OPERATION_CONFLICT");
        if (previous === undefined) {
          const currentType = repositories.workbooks.types().find(type => type.id === reference.value.snapshot.type.id);
          if (currentType === undefined || currentType.keyFieldId !== reference.value.snapshot.type.keyFieldId
            || repositories.workbooks.metadata(reference.value.snapshot.libraryId).typeId !== currentType.id
            || reference.value.request.fields.some(field => !currentType.fields.includes(field))) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        }
        const row = reference.value.snapshot.rows.find(row => row.key === command.key);
        if (row === undefined || command.values.some(cell => !reference.value.request.fields.includes(cell.fieldId))) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const match = row.state === "matched" ? row.matches[0] : undefined;
        const receipt = writeRunWorkbook(repositories.workbooks, deps.clock, run.envelope.runId, reference.value.snapshot.libraryId, operationId,
          { kind: "patch", key: command.key, values: Object.fromEntries(command.values.map(cell => [cell.fieldId, cell.value])), expectedVersion: reference.value.snapshot.version,
            ...(match === undefined ? {} : { selection: { sheetId: match.sheetId, rowId: match.rowId, expectedVersion: reference.value.snapshot.version } }) }, reference.digest);
        appendReceipt(repositories, run, receipt);
        return receipt;
      });
    },
    resolve(repositories: AuthorityRepositories, command: RowCommand): WorkbookOperationReceipt {
      const run = repositories.runs.get(command.target.runId);
      if (run === undefined || repositories.deletedRuns.get(command.target.runId) !== undefined || run.version !== command.target.expectedVersion) {
        rejectCommandRequest(command, "invalid-state", "The workbook run changed. Reload its row choice.");
      }
      const entries = capturedOperations(repositories, run);
      const original = entries.find(entry => entry.libraryId === command.target.libraryId && entry.operation.operationId === command.target.operationId);
      if (original === undefined || original.receipt.state !== "resolve-required" || hasResolution(entries, original)
        || sha256Hex(canonicalJsonStringify(original.receipt)) !== command.target.receiptDigest) {
        rejectCommandRequest(command, "invalid-state", "The retained workbook choice changed.");
      }
      const reference = referenceOfOperation(run, original);
      const change = original.operation.change;
      if (change.kind !== "patch" && change.kind !== "add") throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
      const live = liveCandidates(repositories, reference.value, change.key);
      if (live.version !== command.target.workbookVersion || !live.candidates.some(candidate => candidate.sheetId === command.payload.sheetId && candidate.rowId === command.payload.rowId)) {
        rejectCommandRequest(command, "invalid-state", "The live workbook row changed. Reload its row choice.");
      }
      const receipt = writeRunWorkbook(repositories.workbooks, deps.clock, run.envelope.runId, original.libraryId,
        deriveStableUuid("run-workbook-row-resolution", command.commandId), { kind: "patch", key: change.key, values: change.values,
          expectedVersion: live.version, selection: { ...command.payload, expectedVersion: live.version },
          resolves: { operationId: original.operation.operationId, receiptDigest: command.target.receiptDigest } }, reference.digest);
      if (receipt.state !== "applied") rejectCommandRequest(command, "invalid-state", "The selected row cannot accept the captured change; operator-owned cells remain protected.");
      appendReceipt(repositories, run, receipt, command.commandId);
      return receipt;
    },
  });
}
