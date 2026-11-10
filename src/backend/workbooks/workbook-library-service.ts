import { WorkbookImportRequestSchema, WorkbookImportResultSchema, decodeEditableWorkbook, encodeEditableWorkbook, EditableWorkbookSchema, SavedWorkbookSchema, WorkbookIdSchema, WorkbookRevisionSchema, type SavedWorkbook, type WorkbookType, type WorkbookMetadata, type WorkbookOperation, type WorkbookOperationReceipt, WorkbookNamedVersionSchema, WorkbookSnapshotRequestSchema, WorkbookOperatorOperationRequestSchema, WorkbookSnapshotSchema, RunWorkbookSnapshotReferenceSchema, encodeSavedWorkbook } from "../../models/dashboard/workbooks.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../../rules/time/clock.js";
import { ERROR_CATALOG } from "../../models/failures/error-catalog.js";
import type { WorkbookOperationRecord } from "../../models/dashboard/workbooks.js";
import { RunWorkbookNamedReferenceSchema } from "../../models/dashboard/workbooks.js";
import { deriveSchemaHash, schemaBoundValueSchema, type SchemaBoundCanonicalValue } from "../../models/validation/schema-bound-value.js";
import { WorkbookReferenceReadRequestSchema, WorkbookReferenceReadSchema, encodeWorkbookReference } from "../../models/processing/workbooks/read-reference.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { WorkbookLibraryError } from "./workbook-library-error.js";
import { workbookKey, workbookMatches } from "./master-changes.js";
import { projectWorkbookCompatibility, workbookFieldCoverage, WorkbookActiveSnapshotRequestSchema, WorkbookResultsSchema, WorkbookLibraryActionSchema, WorkbookLibraryActionStatusSchema, type WorkflowWorkbookSelectionRecord, type WorkbookLibraryActionRecord, type WorkbookLibraryActionResult, type WorkbookLibraryEntry, type WorkbookLibraryState, type WorkbookLibraryVersionViewSchema, type WorkbookLibraryOriginSchema, type WorkflowWorkbookRequirementInput } from "../../models/dashboard/workbook-library.js";
import { MAX_SELECTED_WORKBOOK_SOURCES, MAX_WORKBOOK_GRID_CELLS, MAX_WORKBOOK_POPULATED_CELLS, populatedSpreadsheetValue } from "../../rules/spreadsheets/workbook-size.js";
import type { EditableWorkbookWire } from "../../models/dashboard/workbooks.js";

export interface WorkbookLibraryRepository {
  lastUsed(workflowId: string): WorkflowWorkbookSelectionRecord | undefined;
  rememberLastUsed(value: unknown): WorkflowWorkbookSelectionRecord;
  create(record: SavedWorkbook, origin?: z.infer<typeof WorkbookLibraryOriginSchema>): SavedWorkbook;
  read(libraryId: string): SavedWorkbook | undefined;
  revision(libraryId: string, version: number): SavedWorkbook;
  list(): readonly SavedWorkbook[];
  save(record: SavedWorkbook, expectedVersion: number): SavedWorkbook;
  history(libraryId: string): readonly SavedWorkbook[];
  creation(libraryId: string): SavedWorkbook | undefined;
  versions(libraryId: string): readonly z.infer<typeof WorkbookNamedVersionSchema>[];
  types(): readonly WorkbookType[];
  putType(value: unknown): WorkbookType;
  metadata(libraryId: string): WorkbookMetadata;
  enqueue(libraryId: string, value: unknown): number;
  drain(libraryId: string): void;
  operation(libraryId: string, value: unknown): WorkbookOperationReceipt;
  journal(libraryId: string): readonly WorkbookOperationReceipt[];
  snapshot(value: unknown): z.infer<typeof WorkbookSnapshotSchema>;
  runOperations(runId: string): readonly WorkbookOperationRecord[];
  catalog(): readonly WorkbookLibraryEntry[];
  libraryState(libraryId: string): WorkbookLibraryState;
  libraryVersion(libraryId: string, versionId?: string): z.infer<typeof WorkbookLibraryVersionViewSchema>;
  libraryActionRecord(libraryId: string, operationId: string): WorkbookLibraryActionRecord | undefined;
  libraryAction(libraryId: string, value: unknown, at: string, sharePointWorkbook?: EditableWorkbookWire): WorkbookLibraryActionResult;
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new WorkbookLibraryError("WORKBOOK_INVALID", { cause: parsed.error });
  return parsed.data;
}

export function createWorkbookReferenceCapture(repository: WorkbookLibraryRepository) {
  type SelectedSheet = z.infer<typeof WorkbookLibraryVersionViewSchema>["workbook"]["sheets"][number];
  const sources = new Map<string, {
    name: string;
    currentVersion: number;
    selectedVersionId: string;
    versionId: string;
    versionName: string;
    sheet: SelectedSheet;
    indexes: Map<string, Map<string, SelectedSheet["rows"][number][]>>;
    currentSheetMatches: boolean;
  }>();
  let populatedCells = 0, gridCells = 0;
  return (value: unknown) => {
    const request = input(WorkbookActiveSnapshotRequestSchema, value);
    const identity = JSON.stringify([request.libraryId, request.versionId, request.sheetId]);
    let source = sources.get(identity);
    let selectedPopulatedCells = 0, selectedGridCells = 0;
    if (source === undefined) {
      const entry = repository.catalog().find(candidate => candidate.libraryId === request.libraryId);
      if (entry === undefined || entry.state.origin.kind !== "local" || entry.state.removed) throw new WorkbookLibraryError("WORKBOOK_NOT_FOUND");
      const current = repository.read(request.libraryId);
      if (current === undefined) throw new WorkbookLibraryError("WORKBOOK_NOT_FOUND");
      if (current.version !== request.expectedVersion
        || request.writableFields.length > 0 && entry.state.selectedVersionId !== request.versionId)
        throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
      const selected = repository.libraryVersion(request.libraryId, request.versionId);
      const sheet = selected.workbook.sheets.find(candidate => candidate.id === request.sheetId);
      if (sheet === undefined) throw new WorkbookLibraryError("WORKBOOK_INVALID");
      for (const row of sheet.rows) for (const cell of row.cells) if (populatedSpreadsheetValue(cell.value)) selectedPopulatedCells++;
      selectedGridCells = sheet.rows.length * sheet.width;
      if (sources.size >= MAX_SELECTED_WORKBOOK_SOURCES || populatedCells + selectedPopulatedCells > MAX_WORKBOOK_POPULATED_CELLS
        || gridCells + selectedGridCells > MAX_WORKBOOK_GRID_CELLS) throw new WorkbookLibraryError("WORKBOOK_CAPTURE_LIMIT_EXCEEDED");
      const currentSheet = current.workbook.sheets.find(candidate => candidate.id === sheet.id);
      source = { name: entry.name, currentVersion: current.version, selectedVersionId: entry.state.selectedVersionId,
        versionId: selected.version.id, versionName: selected.version.name, sheet, indexes: new Map(),
        currentSheetMatches: canonicalJsonStringify(currentSheet === undefined ? null
          : encodeEditableWorkbook({ ...current.workbook, sheets: [currentSheet] }).sheets[0]) === canonicalJsonStringify(sheet) };
    }
    const { sheet } = source;
    if (source.currentVersion !== request.expectedVersion
      || request.writableFields.length > 0 && source.selectedVersionId !== request.versionId)
      throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
    if (request.writableFields.length > 0 && !source.currentSheetMatches) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
    if (workbookFieldCoverage(request.fields, (sheet.columnBindings ?? []).flatMap(binding =>
      binding.fieldId !== null && binding.basis !== "unmapped" ? [binding.fieldId] : [])).status !== "compatible")
      throw new WorkbookLibraryError("WORKBOOK_INVALID");
    const columns = request.fields.map(field => ({ field,
      column: sheet.columnBindings?.findIndex(binding => binding.fieldId === field && binding.basis !== "unmapped") ?? -1 }));
    const values = (row: typeof sheet.rows[number]) => Object.fromEntries(columns.map(({ field, column }) => {
      const cell = row.cells[column];
      if (cell === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
      return [field, cell.value];
    }));
    let rows: z.infer<typeof WorkbookSnapshotSchema>["rows"];
    if (request.mode === "all") {
      rows = sheet.rows.slice(sheet.headerRow ?? 1).map(row => ({ key: `${sheet.id}#${row.id}`, state: "matched",
        matches: [{ sheetId: sheet.id, rowId: row.id, values: values(row) }] }));
    } else {
      let keyIndex = source.indexes.get(request.keyFieldId);
      if (keyIndex === undefined) {
        keyIndex = new Map();
        const keyColumns = sheet.columnBindings?.flatMap((binding, index) =>
          binding.fieldId === request.keyFieldId && binding.basis !== "unmapped" ? [index] : []) ?? [];
        for (let index = sheet.headerRow ?? 1; index < sheet.rows.length; index++) {
          const row = sheet.rows[index];
          for (const key of new Set(keyColumns.map(column => workbookKey(row.cells[column]?.value)).filter((key): key is string => key !== undefined))) {
            const matches = keyIndex.get(key);
            if (matches === undefined) keyIndex.set(key, [row]);
            else matches.push(row);
          }
        }
        source.indexes.set(request.keyFieldId, keyIndex);
      }
      const indexedRows = keyIndex;
      rows = request.keys.map(key => {
        const found = (indexedRows.get(key) ?? []).map(row => ({ sheetId: sheet.id, rowId: row.id, values: values(row) }));
        return { key, state: found.length === 0 ? "missing" : found.length === 1 ? "matched" : "ambiguous", matches: found };
      });
    }
    if (request.selectedRow !== undefined && rows.flatMap(row => row.matches).filter(match =>
      match.sheetId === request.selectedRow?.sheetId && match.rowId === request.selectedRow?.rowId).length !== 1)
      throw new WorkbookLibraryError("WORKBOOK_INVALID");
    const snapshot = deepFreeze(WorkbookSnapshotSchema.parse({ libraryId: request.libraryId, version: source.currentVersion,
      versionId: source.versionId, versionName: source.versionName,
      worksheets: [{ sheetId: sheet.id, name: sheet.name }],
      type: { id: request.typeId, name: source.name, keyFieldId: request.keyFieldId,
        fields: request.fields, defaultWorkbookId: null }, rows }));
    if (!sources.has(identity)) {
      sources.set(identity, source);
      populatedCells += selectedPopulatedCells;
      gridCells += selectedGridCells;
    }
    return snapshot;
  };
}

export function snapshotWorkbookReference(repository: WorkbookLibraryRepository, value: unknown) {
  return createWorkbookReferenceCapture(repository)(value);
}

/** Retained resolver proof for historical captures that were admitted before explicit worksheet selection. */
export function snapshotRetainedWorkbookReference(repository: WorkbookLibraryRepository, value: unknown) {
  const request = input(WorkbookSnapshotRequestSchema, value);
  const snapshot = repository.snapshot(request);
  if ("selectedRow" in request && request.selectedRow !== undefined && snapshot.rows.flatMap(row => row.matches).filter(match =>
    match.sheetId === request.selectedRow?.sheetId && match.rowId === request.selectedRow?.rowId).length !== 1) {
    throw new WorkbookLibraryError('WORKBOOK_INVALID');
  }
  return deepFreeze(snapshot);
}

export function readRetainedWorkbookReference(repository: WorkbookLibraryRepository, bound: SchemaBoundCanonicalValue,
  commandValue: z.input<typeof WorkbookReferenceReadRequestSchema>) {
  const command = input(WorkbookReferenceReadRequestSchema, commandValue);
  const { request, snapshot } = schemaBoundValueSchema(RunWorkbookNamedReferenceSchema, deriveSchemaHash(RunWorkbookNamedReferenceSchema, "output")).parse(bound).value;
  if (command.typeId !== request.typeId || snapshot.versionId === undefined || snapshot.versionName === undefined
    || snapshot.type.keyFieldId === null || request.fields.some(field => !snapshot.type.fields.includes(field))) throw new WorkbookLibraryError("WORKBOOK_INVALID");
  const { readRows } = verifyRetainedNamedWorkbookReference(repository, { request, snapshot });
  const referenceDigest = sha256Hex(canonicalJsonStringify(bound));
  const reference = encodeWorkbookReference({ request: { ...request, libraryId: snapshot.libraryId, versionId: snapshot.versionId, keys: command.keys },
    snapshot: { ...snapshot, rows: readRows(command.keys) } });
  return WorkbookReferenceReadSchema.parse({ state: "read", referenceDigest, reference, sources: [{ referenceDigest, reference }] });
}

export function verifyRetainedNamedWorkbookReference(repository: WorkbookLibraryRepository,
  reference: z.infer<typeof RunWorkbookSnapshotReferenceSchema>) {
  const { request, snapshot } = reference;
  if ("mode" in request || !("versionId" in snapshot) || snapshot.versionId === undefined
    || snapshot.type.keyFieldId === null) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  const selected = repository.libraryVersion(snapshot.libraryId, snapshot.versionId);
  const selectedSheets = snapshot.worksheets.map(worksheet => selected.workbook.sheets.find(sheet => sheet.id === worksheet.sheetId));
  if (selected.libraryId !== snapshot.libraryId || selected.version.id !== snapshot.versionId
    || selectedSheets.some(sheet => sheet === undefined)
    || canonicalJsonStringify(selectedSheets.map(sheet => ({ sheetId: sheet?.id, name: sheet?.name }))) !== canonicalJsonStringify(snapshot.worksheets)) {
    throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  }
  const keyField = snapshot.type.keyFieldId;
  const readRows = (keys: readonly string[]): z.infer<typeof RunWorkbookNamedReferenceSchema>["snapshot"]["rows"] => keys.map(key => {
    const matches = workbookMatches({ ...selected.workbook, sheets: selected.workbook.sheets.filter(sheet =>
      snapshot.worksheets.some(worksheet => worksheet.sheetId === sheet.id)) }, keyField, key);
    return { key, state: matches.length === 0 ? "missing" : matches.length === 1 ? "matched" : "ambiguous",
      matches: matches.map(({ sheetId, rowId, sheet, row }) => ({ sheetId, rowId, values: Object.fromEntries(request.fields.map(field => {
        const indexes = sheet.columnBindings?.flatMap((binding, index) => binding.fieldId === field ? [index] : []) ?? [];
        if (indexes.length !== 1) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
        const column = indexes[0], cell = column === undefined ? undefined : row.cells[column];
        if (cell === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
        return [field, cell.value];
      })) })),
    };
  });
  if (canonicalJsonStringify(readRows(request.keys)) !== canonicalJsonStringify(snapshot.rows)) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  return { selected, readRows };
}

export function writeRecordedRunWorkbook(repository: WorkbookLibraryRepository, clock: Clock,
  source: Extract<WorkbookOperation['source'], { kind: 'run' | 'run-reference' }>, libraryId: string, operationId: string, value: unknown) {
  const change = input(WorkbookOperatorOperationRequestSchema, value);
  if (change.kind !== 'patch' && (source.kind === 'run-reference' || change.kind !== 'add')) throw new WorkbookLibraryError('WORKBOOK_INVALID');
  repository.drain(libraryId);
  const current = repository.read(libraryId);
  if (current === undefined) throw new WorkbookLibraryError('WORKBOOK_NOT_FOUND');
  if (current.workbook.hasFormulas || current.workbook.unsupportedMetadata) throw new WorkbookLibraryError('WORKBOOK_METADATA_UNSUPPORTED');
  const replay = repository.journal(libraryId).find(receipt => receipt.operationId === operationId);
  return repository.operation(libraryId, { operationId, source,
    at: replay?.at ?? clock.now().toISOString(), change });
}
export interface WorkbookSyncCommand {
  readonly libraryId: string;
  readonly operationId: string;
  readonly expectedVersion: number;
  readonly link: NonNullable<WorkbookMetadata["sharePoint"]>;
  readonly signal: AbortSignal;
}
export interface WorkbookSyncDownload {
  withDownload<Result>(command: WorkbookSyncCommand, use: (
    downloaded: Readonly<{ name: string; bytes: ArrayBuffer }>,
    scope: Readonly<{ signal: AbortSignal; assertCurrent(): void }>,
  ) => Promise<Result>): Promise<Result>;
}
export type WorkbookReferenceWorkflow = WorkflowWorkbookRequirementInput;
export function createWorkbookLibraryService(deps: Readonly<{ repository: WorkbookLibraryRepository; clock: Clock; sync: WorkbookSyncDownload;
  resultRun?: (runId: string) => Readonly<{ workflowId: string; enqueuedAt: string }> | undefined;
}>) {
  const read = (libraryId: string): SavedWorkbook => {
    const record = deps.repository.read(input(WorkbookIdSchema, libraryId));
    if (record === undefined) throw new WorkbookLibraryError("WORKBOOK_NOT_FOUND");
    return record;
  };
  const withDownloadedWorkbook = <T>(libraryId: string, operationId: string, signal: AbortSignal, use: (workbook: EditableWorkbookWire) => T): Promise<T> => {
    const record = read(libraryId), link = deps.repository.metadata(libraryId).sharePoint;
    if (link === null) throw new WorkbookLibraryError('WORKBOOK_SYNC_LINK_REQUIRED');
    if (record.workbook.hasFormulas || record.workbook.unsupportedMetadata) throw new WorkbookLibraryError('WORKBOOK_METADATA_UNSUPPORTED');
    signal.throwIfAborted();
    return deps.sync.withDownload({ libraryId, operationId, expectedVersion: record.version, link, signal }, async (downloaded, scope) => {
      scope.assertCurrent();
      const { importWorkbook } = await import('../../rules/spreadsheets/workbook-io.js');
      scope.assertCurrent();
      const workbook = await importWorkbook(downloaded.name, downloaded.bytes).catch((cause: unknown) => {
        throw new WorkbookLibraryError('WORKBOOK_SYNC_IMPORT_FAILED', { cause });
      });
      scope.assertCurrent();
      if (workbook.hasFormulas || workbook.unsupportedMetadata) throw new WorkbookLibraryError('WORKBOOK_METADATA_UNSUPPORTED');
      signal.throwIfAborted();
      scope.signal.throwIfAborted();
      return use(encodeSavedWorkbook({ ...record, workbook: { ...workbook, name: record.workbook.name, libraryId } }).workbook);
    });
  };
  return Object.freeze({
    compatibility(workflows: readonly WorkbookReferenceWorkflow[]) {
      return projectWorkbookCompatibilityFromRepository(deps.repository, workflows);
    },
    results() {
      return projectWorkbookResults(deps.repository.catalog(), deps.resultRun);
    },
    importWorkbook(value: unknown) {
      const request = input(WorkbookImportRequestSchema, value), workbook = decodeEditableWorkbook(request.workbook);
      if (workbook.libraryId !== undefined) throw new WorkbookLibraryError("WORKBOOK_INVALID");
      const libraryId = randomUUID(), now = deps.clock.now().toISOString();
      const record = deps.repository.create(input(SavedWorkbookSchema, { libraryId, version: 1, createdAt: now, savedAt: now, workbook: { ...workbook, libraryId } }),
        { kind: 'local' });
      return WorkbookImportResultSchema.parse({ workbook: encodeSavedWorkbook(record) });
    },
    catalog: () => deps.repository.catalog(),
    libraryVersion: (libraryId: string, versionId?: string) => deps.repository.libraryVersion(input(WorkbookIdSchema, libraryId), versionId === undefined ? undefined : input(WorkbookIdSchema, versionId)),
    libraryActionStatus(libraryId: string, operationId: string) {
      const record = deps.repository.libraryActionRecord(input(WorkbookIdSchema, libraryId), input(WorkbookIdSchema, operationId));
      return WorkbookLibraryActionStatusSchema.parse(record === undefined ? { state: 'absent' }
        : record.action.change.kind === 'merge' ? { state: 'retired', code: 'WORKBOOK_ACTION_RETIRED', message: ERROR_CATALOG.WORKBOOK_ACTION_RETIRED.text }
          : { state: 'recorded', record });
    },
    async libraryAction(libraryId: string, value: unknown, signal: AbortSignal) {
      const action = input(WorkbookLibraryActionSchema, value);
      const replay = deps.repository.libraryActionRecord(libraryId, action.operationId);
      if (replay !== undefined) return deps.repository.libraryAction(libraryId, action, replay.at);
      const record = read(libraryId), state = deps.repository.libraryState(libraryId);
      if (record.version !== action.expectedVersion || state.revision !== action.expectedRevision) throw new WorkbookLibraryError('WORKBOOK_VERSION_CONFLICT');
      signal.throwIfAborted();
      const apply = (workbook?: EditableWorkbookWire) => deps.repository.libraryAction(libraryId, action, deps.clock.now().toISOString(), workbook);
      return action.change.kind === 'sync' || action.change.kind === 'create-version' && action.change.from.kind === 'sharepoint'
        ? withDownloadedWorkbook(libraryId, action.operationId, signal, apply) : apply();
    },
    create(value: unknown): SavedWorkbook {
      const workbook = input(EditableWorkbookSchema, value);
      if (workbook.libraryId !== undefined) throw new WorkbookLibraryError("WORKBOOK_INVALID");
      const libraryId = randomUUID(), now = deps.clock.now().toISOString();
      return deps.repository.create(input(SavedWorkbookSchema, { libraryId, version: 1, createdAt: now, savedAt: now, workbook: { ...workbook, libraryId } }));
    },
    read,
    revision: (libraryId: string, version: number) => deps.repository.revision(input(WorkbookIdSchema, libraryId), input(WorkbookRevisionSchema, version)),
    list: () => deps.repository.list(),
    save(libraryId: string, expectedVersion: number, value: unknown): SavedWorkbook {
      const workbook = input(EditableWorkbookSchema, value);
      input(z.number().int().positive(), expectedVersion);
      const current = read(libraryId);
      if (current.workbook.hasFormulas || current.workbook.unsupportedMetadata || workbook.hasFormulas || workbook.unsupportedMetadata) throw new WorkbookLibraryError("WORKBOOK_METADATA_UNSUPPORTED");
      if (workbook.libraryId !== libraryId) throw new WorkbookLibraryError("WORKBOOK_INVALID");
      return deps.repository.save(input(SavedWorkbookSchema, { ...current, version: expectedVersion + 1, savedAt: deps.clock.now().toISOString(), workbook }), expectedVersion);
    },
    history(libraryId: string): readonly SavedWorkbook[] { read(libraryId); return deps.repository.history(libraryId); },
    versions: (libraryId: string) => deps.repository.versions(libraryId),
    types: () => deps.repository.types(),
    putType: (value: unknown) => deps.repository.putType(value),
    metadata: (libraryId: string) => deps.repository.metadata(libraryId),
    journal: (libraryId: string) => deps.repository.journal(libraryId),
    operatorOperation(libraryId: string, operationId: string, value: unknown) {
      const change = input(WorkbookOperatorOperationRequestSchema, value);
      if (!['save', 'metadata', 'version'].includes(change.kind)) throw new WorkbookLibraryError('WORKBOOK_INVALID');
      deps.repository.drain(libraryId);
      if (change.kind === 'save') {
        const current = read(libraryId);
        if (current.workbook.hasFormulas || current.workbook.unsupportedMetadata || change.workbook.hasFormulas || change.workbook.unsupportedMetadata) throw new WorkbookLibraryError('WORKBOOK_METADATA_UNSUPPORTED');
      }
      const replay = deps.repository.journal(libraryId).find(receipt => receipt.operationId === operationId);
      return deps.repository.operation(libraryId, { operationId, source: { kind: 'operator' }, at: replay?.at ?? deps.clock.now().toISOString(), change });
    },
    createReferenceCapture: () => createWorkbookReferenceCapture(deps.repository),
    snapshot: (value: unknown) => snapshotWorkbookReference(deps.repository, value),
    async sync(libraryId: string, operationId: string, signal: AbortSignal) {
      input(WorkbookIdSchema, operationId);
      deps.repository.drain(libraryId);
      const replay = deps.repository.journal(libraryId).find(receipt => receipt.operationId === operationId);
      if (replay) {
        if (replay.source.kind !== 'sync' || replay.source.syncId !== operationId) throw new WorkbookLibraryError('WORKBOOK_OPERATION_CONFLICT');
        return replay;
      }
      const record = read(libraryId);
      return withDownloadedWorkbook(libraryId, operationId, signal, workbook => {
        return deps.repository.operation(libraryId, { operationId, source: { kind: 'sync', syncId: operationId }, at: deps.clock.now().toISOString(),
          change: { kind: 'sync', expectedVersion: record.version, workbook } });
      });
    },
  });
}
export type WorkbookLibraryService = ReturnType<typeof createWorkbookLibraryService>;

export function projectWorkbookCompatibilityFromRepository(repository: Pick<WorkbookLibraryRepository, "catalog" | "libraryVersion" | "lastUsed">,
  workflows: readonly WorkbookReferenceWorkflow[]) {
  const catalog = repository.catalog();
  const sources = catalog.filter(entry => entry.state.origin.kind === "local" && !entry.state.removed).map(entry => {
    const selected = repository.libraryVersion(entry.libraryId, entry.state.selectedVersionId);
    return { libraryId: entry.libraryId, versionId: selected.version.id, origin: entry.state.origin,
      removed: entry.state.removed, sheets: selected.workbook.sheets.map(sheet => ({ id: sheet.id, name: sheet.name,
        mappings: (sheet.columnBindings ?? []).flatMap((binding, column) => binding.fieldId !== null && binding.basis !== "unmapped"
          ? [{ fieldId: binding.fieldId, column, basis: binding.basis }] : []),
      })) };
  });
  return projectWorkbookCompatibility(workflows.map(({ id, label, requiredWorkbookFields, workbookReference }) => ({
    id, label, requiredWorkbookFields, ...(workbookReference === undefined ? {} : { workbookReference }),
  })), sources,
    workflows.flatMap(workflow => { const saved = repository.lastUsed(workflow.id); return saved === undefined ? [] : [saved]; }));
}

function projectWorkbookResults(entries: readonly WorkbookLibraryEntry[],
  resultRun?: (runId: string) => Readonly<{ workflowId: string; enqueuedAt: string }> | undefined) {
  const workflows: z.infer<typeof WorkbookResultsSchema>['workflows'] = [];
  const unavailable: WorkbookLibraryEntry[] = [];
  const identities = new Map<string, { workflowId: string; workflowLabel: string; partitionDay: string }>();
  for (const entry of entries) {
    const origin = entry.state.origin;
    if (origin.kind === 'local') continue;
    if (origin.kind === 'unavailable') { unavailable.push(entry); continue; }
    const previous = identities.get(origin.runId);
    if (previous !== undefined && (previous.workflowId !== origin.workflowId || previous.workflowLabel !== origin.workflowLabel || previous.partitionDay !== origin.partitionDay))
      throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    identities.set(origin.runId, origin);
    let workflow = workflows.find(workflow => workflow.workflowId === origin.workflowId);
    if (workflow === undefined) {
      workflow = { workflowId: origin.workflowId, workflowLabel: origin.workflowLabel, runs: [] };
      workflows.push(workflow);
    }
    let run = workflow.runs.find(run => run.runId === origin.runId);
    if (run === undefined) {
      const authority = resultRun?.(origin.runId);
      if (authority !== undefined && authority.workflowId !== origin.workflowId) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      run = { runId: origin.runId, partitionDay: origin.partitionDay, enqueuedAt: authority === undefined ? null : IsoInstantSchema.parse(authority.enqueuedAt), entries: [] };
      workflow.runs.push(run);
    }
    run.entries.push(entry);
  }
  const byId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const newestFirst = (a: string | null, b: string | null) => {
    if (a === null) return b === null ? 0 : 1;
    return b === null ? -1 : Date.parse(b) - Date.parse(a);
  };
  for (const workflow of workflows) {
    workflow.runs.sort((a, b) => newestFirst(a.enqueuedAt, b.enqueuedAt) || byId(a.runId, b.runId));
    for (const run of workflow.runs) run.entries.sort((a, b) => newestFirst(a.updatedAt, b.updatedAt) || byId(a.libraryId, b.libraryId));
    const newestOrigin = workflow.runs[0].entries[0].state.origin;
    if (newestOrigin.kind !== 'workflow') throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    workflow.workflowLabel = newestOrigin.workflowLabel;
  }
  workflows.sort((a, b) => newestFirst(a.runs[0].enqueuedAt, b.runs[0].enqueuedAt) || byId(a.workflowId, b.workflowId));
  unavailable.sort((a, b) => byId(a.libraryId, b.libraryId));
  return WorkbookResultsSchema.parse({ workflows, unavailable });
}
