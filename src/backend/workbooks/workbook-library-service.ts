import { WorkbookImportResultSchema, decodeEditableWorkbook, encodeEditableWorkbook, EditableWorkbookSchema, SavedWorkbookSchema, WorkbookIdSchema, WorkbookRevisionSchema, type SavedWorkbook, type WorkbookType, type WorkbookMetadata, type WorkbookOperation, type WorkbookOperationReceipt, WorkbookNamedVersionSchema, WorkbookNamedReferenceSnapshotSchema, WorkbookSnapshotRequestSchema, WorkbookOperatorOperationRequestSchema, WorkbookSnapshotSchema, RunWorkbookSnapshotReferenceSchema, encodeSavedWorkbook } from "../../models/dashboard/workbooks.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../../rules/time/clock.js";
import { ERROR_CATALOG, ErrorCatalogCodeSchema, catalogCodeForThrown, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import type { WorkbookOperationRecord } from "../../models/dashboard/workbooks.js";
import { RunWorkbookNamedReferenceSchema } from "../../models/dashboard/workbooks.js";
import { deriveSchemaHash, schemaBoundValueSchema, type SchemaBoundCanonicalValue } from "../../models/validation/schema-bound-value.js";
import { WorkbookReferenceReadRequestSchema, WorkbookReferenceReadSchema, encodeWorkbookReference } from "../../models/processing/workbooks/read-reference.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { WorkbookLibraryError } from "./workbook-library-error.js";
import { copyColumnMapping } from "../../rules/spreadsheets/column-mapping.js";
import { workbookKey } from "./master-changes.js";
import { projectWorkbookCompatibility, workbookFieldCoverage, WorkbookActiveSnapshotRequestSchema, WorkbookLibraryActionSchema, WorkbookLibraryActionStatusSchema, type WorkflowWorkbookSelectionRecord, type WorkbookLibraryActionRecord, type WorkbookLibraryActionResult, type WorkbookLibraryEntry, type WorkbookLibraryState, type WorkbookLibrarySyncRecord, type WorkbookLibraryVersionViewSchema, type WorkbookLibraryOriginSchema, type WorkflowWorkbookRequirementInput } from "../../models/dashboard/workbook-library.js";
import { MAX_SELECTED_WORKBOOK_SOURCES, MAX_WORKBOOK_GRID_CELLS, MAX_WORKBOOK_POPULATED_CELLS, populatedSpreadsheetValue } from "../../rules/spreadsheets/workbook-size.js";
import type { EditableWorkbookWire } from "../../models/dashboard/workbooks.js";
import { WorkbookCloneRequestSchema, WorkbookLocalImportRequestSchema, WorkbookSharePointImportRequestSchema } from "../../models/dashboard/workbook-library.js";
import type { WorkbookCompatibilitySource } from "../../models/dashboard/workbook-library.js";

export interface WorkbookLibraryRepository {
  lastUsed(workflowId: string): WorkflowWorkbookSelectionRecord | undefined;
  rememberLastUsed(value: unknown): WorkflowWorkbookSelectionRecord;
  create(record: SavedWorkbook, origin?: z.infer<typeof WorkbookLibraryOriginSchema>): SavedWorkbook;
  read(libraryId: string): SavedWorkbook | undefined;
  revision(libraryId: string, version: number): SavedWorkbook;
  list(): readonly SavedWorkbook[];
  listWithType(): readonly Readonly<{ record: SavedWorkbook; typeId: WorkbookMetadata["typeId"] }>[];
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
  /** Whether an operation for the entry is admitted but not yet settled. */
  hasQueuedOperation(libraryId: string): boolean;
  snapshot(value: unknown): z.infer<typeof WorkbookSnapshotSchema>;
  runOperations(runId: string): readonly WorkbookOperationRecord[];
  catalog(at?: string): readonly WorkbookLibraryEntry[];
  libraryState(libraryId: string): WorkbookLibraryState;
  /** Replaces the entry's last finished SharePoint sync. */
  recordSync(libraryId: string, record: WorkbookLibrarySyncRecord): void;
  libraryVersion(libraryId: string, versionId?: string): z.infer<typeof WorkbookLibraryVersionViewSchema>;
  libraryActionRecord(libraryId: string, operationId: string): WorkbookLibraryActionRecord | undefined;
  libraryAction(libraryId: string, value: unknown, at: string, sharePointWorkbook?: EditableWorkbookWire): WorkbookLibraryActionResult;
  /** Runs `work`'s repository writes as one write: all of them commit or none do. */
  atomically<T>(work: () => T): T;
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
  const selectedVersions = new Map<string, string>();
  const readEntry = (libraryId: string) => {
    const entry = repository.catalog().find(candidate => candidate.libraryId === libraryId);
    if (entry === undefined || entry.state.origin.kind !== "local" || entry.state.removed) throw new WorkbookLibraryError("WORKBOOK_NOT_FOUND");
    return entry;
  };
  let populatedCells = 0, gridCells = 0;
  return (value: unknown) => {
    const request = input(WorkbookActiveSnapshotRequestSchema, value);
    const suppliedVersion = request.versionId ?? selectedVersions.get(request.libraryId);
    const defaultEntry = suppliedVersion === undefined ? readEntry(request.libraryId) : undefined;
    const versionId = defaultEntry?.state.selectedVersionId ?? suppliedVersion;
    const identity = JSON.stringify([request.libraryId, versionId, request.sheetId]);
    let source = sources.get(identity);
    let selectedPopulatedCells = 0, selectedGridCells = 0;
    if (source === undefined) {
      const entry = defaultEntry ?? readEntry(request.libraryId);
      const current = repository.read(request.libraryId);
      if (current === undefined) throw new WorkbookLibraryError("WORKBOOK_NOT_FOUND");
      if (current.version !== request.expectedVersion
        || request.writableFields.length > 0 && entry.state.selectedVersionId !== versionId)
        throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
      const selected = repository.libraryVersion(request.libraryId, versionId);
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
      || request.writableFields.length > 0 && source.selectedVersionId !== versionId)
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
    const snapshot = deepFreeze(WorkbookNamedReferenceSnapshotSchema.parse({ libraryId: request.libraryId, version: source.currentVersion,
      versionId: source.versionId, versionName: source.versionName,
      worksheets: [{ sheetId: sheet.id, name: sheet.name }],
      type: { id: request.typeId, name: source.name, keyFieldId: request.keyFieldId,
        fields: request.fields, defaultWorkbookId: null }, rows }));
    if (!sources.has(identity)) {
      sources.set(identity, source);
      if (!selectedVersions.has(request.libraryId)) selectedVersions.set(request.libraryId, source.selectedVersionId);
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
  const { readRows } = verifyRetainedNamedWorkbookReference(repository, { request, snapshot }, "retained");
  const referenceDigest = sha256Hex(canonicalJsonStringify(bound));
  const reference = encodeWorkbookReference({ request: { ...request, libraryId: snapshot.libraryId, versionId: snapshot.versionId, keys: command.keys },
    snapshot: { ...snapshot, rows: readRows(command.keys) } });
  return WorkbookReferenceReadSchema.parse({ state: "read", referenceDigest, reference, sources: [{ referenceDigest, reference }] });
}

export function verifyRetainedNamedWorkbookReference(repository: WorkbookLibraryRepository,
  reference: z.infer<typeof RunWorkbookSnapshotReferenceSchema>, mode: "current" | "retained" = "current") {
  const { request, snapshot } = reference;
  if ("mode" in request || !("versionId" in snapshot) || snapshot.versionId === undefined
    || snapshot.type.keyFieldId === null) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  const selected = repository.libraryVersion(snapshot.libraryId, snapshot.versionId);
  const worksheetIds = new Set(snapshot.worksheets.map(worksheet => worksheet.sheetId));
  const sheets = selected.workbook.sheets.filter(sheet => worksheetIds.has(sheet.id));
  const sheetNames = new Map(sheets.map(sheet => [sheet.id, sheet.name]));
  if (selected.libraryId !== snapshot.libraryId || selected.version.id !== snapshot.versionId
    || snapshot.worksheets.some(sheet => sheetNames.get(sheet.sheetId) !== sheet.name)) {
    throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  }
  const keyField = snapshot.type.keyFieldId;
  type Sheet = EditableWorkbookWire["sheets"][number];
  type Match = { sheet: Sheet; row: Sheet["rows"][number]; rowNumber: number };
  type SnapshotRow = z.infer<typeof RunWorkbookNamedReferenceSchema>["snapshot"]["rows"][number];
  const rowsByKey = new Map<string, Match[]>(), rowsById = new Map<string, Map<string, Match>>();
  const fieldColumns = new Map<string, Map<string, number[]>>();
  for (const sheet of sheets) {
    const columns = new Map<string, number[]>(), byId = new Map<string, Match>();
    fieldColumns.set(sheet.id, columns);
    rowsById.set(sheet.id, byId);
    sheet.columnBindings?.forEach(({ fieldId }, index) => {
      if (fieldId === null) return;
      const indexes = columns.get(fieldId);
      if (indexes === undefined) columns.set(fieldId, [index]);
      else indexes.push(index);
    });
    const keyColumns = columns.get(keyField) ?? [];
    for (let index = sheet.headerRow ?? 1; index < sheet.rows.length; index++) {
      const row = sheet.rows[index], match = { sheet, row, rowNumber: index + 1 };
      byId.set(row.id, match);
      for (const key of new Set(keyColumns.map(column => workbookKey(row.cells[column]?.value)))) {
        if (key === undefined) continue;
        const matches = rowsByKey.get(key);
        if (matches === undefined) rowsByKey.set(key, [match]);
        else matches.push(match);
      }
    }
  }
  const projectMatch = ({ sheet, row }: Match): SnapshotRow["matches"][number] => ({
    sheetId: sheet.id, rowId: row.id, values: Object.fromEntries(request.fields.map(field => {
      const indexes = fieldColumns.get(sheet.id)?.get(field);
      const cell = indexes?.length === 1 ? row.cells[indexes[0]] : undefined;
      if (cell === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
      return [field, cell.value];
    })),
  });
  const matchesFor = (key: string): readonly Match[] => rowsByKey.get(key) ?? [];
  const captured = new Map<string, SnapshotRow>();
  const readRows = (keys: readonly string[]): SnapshotRow[] => keys.map(key => {
    const saved = captured.get(key);
    if (saved !== undefined) return saved;
    const matches = matchesFor(key).map(projectMatch);
    return { key, state: matches.length === 0 ? "missing" : matches.length === 1 ? "matched" : "ambiguous", matches };
  });
  if (mode === "current") {
    if (canonicalJsonStringify(readRows(request.keys)) !== canonicalJsonStringify(snapshot.rows)) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
  } else {
    // Retained matches carry the lookup decision; the immutable sheet supplies the row and its values.
    for (const row of snapshot.rows) {
      const seen = new Set<Match>();
      for (const saved of row.matches) {
        const match = rowsById.get(saved.sheetId)?.get(saved.rowId);
        if (match === undefined || fieldColumns.get(saved.sheetId)?.has(keyField) !== true || seen.has(match)
          || canonicalJsonStringify(projectMatch(match)) !== canonicalJsonStringify(saved)) {
          throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
        }
        seen.add(match);
      }
      captured.set(row.key, row);
    }
  }
  return { selected, readRows, matchesFor };
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
/** The first catalog code on the failure or its causes; a failure without one records WORKBOOK_SYNC_FAILED. */
function syncFailureCode(error: unknown): ErrorCatalogCode {
  const seen = new Set<unknown>();
  for (let current = error; current instanceof Error && !seen.has(current); current = current.cause) {
    seen.add(current);
    const code = ErrorCatalogCodeSchema.safeParse(Reflect.get(current, 'code'));
    if (code.success) return code.data;
  }
  return catalogCodeForThrown(error) ?? 'WORKBOOK_SYNC_FAILED';
}
type SyncOutcome = Readonly<{ result: 'ok' } | { result: 'failed'; code: ErrorCatalogCode }>;
/** A legacy sync resolves with its receipt; only an applied receipt is a successful sync. */
function receiptOutcome(receipt: WorkbookOperationReceipt): SyncOutcome {
  if (receipt.state === 'applied') return { result: 'ok' };
  return { result: 'failed', code: receipt.reason === 'version-conflict' ? 'WORKBOOK_VERSION_CONFLICT'
    : receipt.reason === 'metadata-unsupported' ? 'WORKBOOK_METADATA_UNSUPPORTED' : 'WORKBOOK_SYNC_NOT_APPLIED' };
}
export function createWorkbookLibraryService(deps: Readonly<{ repository: WorkbookLibraryRepository; clock: Clock; sync: WorkbookSyncDownload }>) {
  const encoded = new WeakMap<SavedWorkbook, ReturnType<typeof encodeSavedWorkbook>>();
  const read = (libraryId: string): SavedWorkbook => {
    const record = deps.repository.read(input(WorkbookIdSchema, libraryId));
    if (record === undefined) throw new WorkbookLibraryError("WORKBOOK_NOT_FOUND");
    return record;
  };
  const running = new Map<string, number>();
  /** Serves the entry as running while `work` downloads its SharePoint link, then records how that sync finished: `outcome` judges a resolved result. */
  const tracked = async <T>(libraryId: string, work: () => Promise<T>, outcome: (value: T) => SyncOutcome = () => ({ result: 'ok' })): Promise<T> => {
    const link = deps.repository.metadata(libraryId).sharePoint;
    if (link === null) return work();
    const finish = (result: SyncOutcome) =>
      deps.repository.recordSync(libraryId, { url: link.url, finishedAt: IsoInstantSchema.parse(deps.clock.now().toISOString()), ...result });
    running.set(libraryId, (running.get(libraryId) ?? 0) + 1);
    try {
      let value: T;
      try { value = await work(); } catch (error) { finish({ result: 'failed', code: syncFailureCode(error) }); throw error; }
      finish(outcome(value));
      return value;
    } finally {
      const remaining = (running.get(libraryId) ?? 1) - 1;
      if (remaining === 0) running.delete(libraryId); else running.set(libraryId, remaining);
    }
  };
  const assertNameAvailable = (name: string) => {
    if (deps.repository.catalog().some(entry => entry.name.trim().toLowerCase() === name.trim().toLowerCase()))
      throw new WorkbookLibraryError('WORKBOOK_NAME_EXISTS');
  };
  const importLocalWorkbook = (workbook: z.infer<typeof EditableWorkbookSchema>, tags: readonly string[] = [], libraryId = randomUUID()) => {
    if (workbook.libraryId !== undefined) throw new WorkbookLibraryError('WORKBOOK_INVALID');
    const now = deps.clock.now().toISOString();
    const record = deps.repository.create(input(SavedWorkbookSchema, { libraryId, version: 1, createdAt: now, savedAt: now,
      workbook: { ...workbook, libraryId } }), { kind: 'local' });
    if (tags.length > 0) deps.repository.libraryAction(libraryId, { operationId: randomUUID(), expectedVersion: 1, expectedRevision: 1,
      change: { kind: 'set-tags', tags } }, now);
    return WorkbookImportResultSchema.parse({ workbook: encodeSavedWorkbook(record) });
  };
  const withImportedDownload = <T>(command: WorkbookSyncCommand, use: (workbook: z.infer<typeof EditableWorkbookSchema>, assertCurrent: () => void) => T): Promise<T> => {
    command.signal.throwIfAborted();
    return deps.sync.withDownload(command, async (downloaded, scope) => {
      scope.assertCurrent();
      const { importWorkbook } = await import('../../rules/spreadsheets/workbook-io.js');
      scope.assertCurrent();
      const workbook = await importWorkbook(downloaded.name, downloaded.bytes).catch((cause: unknown) => {
        throw new WorkbookLibraryError('WORKBOOK_SYNC_IMPORT_FAILED', { cause });
      });
      scope.assertCurrent();
      if (workbook.hasFormulas || workbook.unsupportedMetadata) throw new WorkbookLibraryError('WORKBOOK_METADATA_UNSUPPORTED');
      command.signal.throwIfAborted();
      scope.signal.throwIfAborted();
      return use(input(EditableWorkbookSchema, workbook), scope.assertCurrent);
    });
  };
  const withDownloadedWorkbook = async <T>(libraryId: string, operationId: string, signal: AbortSignal, use: (workbook: EditableWorkbookWire) => T): Promise<T> => {
    const record = read(libraryId), link = deps.repository.metadata(libraryId).sharePoint;
    if (link === null) throw new WorkbookLibraryError('WORKBOOK_SYNC_LINK_REQUIRED');
    if (record.workbook.hasFormulas || record.workbook.unsupportedMetadata) throw new WorkbookLibraryError('WORKBOOK_METADATA_UNSUPPORTED');
    const { workbook, assertCurrent } = await withImportedDownload({ libraryId, operationId, expectedVersion: record.version, link, signal },
      (workbook, assertCurrent) => ({ workbook, assertCurrent }));
    assertCurrent();
    signal.throwIfAborted();
    return use(encodeSavedWorkbook({ ...record, workbook: { ...workbook, name: record.workbook.name, libraryId } }).workbook);
  };
  const save = (libraryId: string, expectedVersion: number, value: unknown): SavedWorkbook => {
    const workbook = input(EditableWorkbookSchema, value);
    input(z.number().int().positive(), expectedVersion);
    const current = read(libraryId);
    if (current.workbook.hasFormulas || current.workbook.unsupportedMetadata || workbook.hasFormulas || workbook.unsupportedMetadata) throw new WorkbookLibraryError("WORKBOOK_METADATA_UNSUPPORTED");
    if (workbook.libraryId !== libraryId) throw new WorkbookLibraryError("WORKBOOK_INVALID");
    return deps.repository.save(input(SavedWorkbookSchema, { ...current, version: expectedVersion + 1, savedAt: deps.clock.now().toISOString(), workbook }), expectedVersion);
  };
  return Object.freeze({
    compatibility(workflows: readonly WorkbookReferenceWorkflow[]) {
      return projectWorkbookCompatibilityFromRepository(deps.repository, workflows);
    },
    importWorkbook(value: unknown) {
      const request = input(WorkbookLocalImportRequestSchema, value), workbook = decodeEditableWorkbook(request.workbook);
      return importLocalWorkbook(workbook, request.tags);
    },
    async importSharePoint(value: unknown, signal: AbortSignal) {
      const request = input(WorkbookSharePointImportRequestSchema, value);
      assertNameAvailable(request.name);
      const libraryId = randomUUID(), operationId = randomUUID();
      const link = { url: request.url, verifiedAt: IsoInstantSchema.parse(deps.clock.now().toISOString()) };
      // The provider still checks its context after this callback returns, so nothing is written until it settles.
      const { workbook, assertCurrent } = await withImportedDownload({ libraryId, operationId, expectedVersion: 1, link, signal },
        (workbook, assertCurrent) => ({ workbook, assertCurrent }));
      return deps.repository.atomically(() => {
        assertCurrent();
        signal.throwIfAborted();
        assertNameAvailable(request.name);
        importLocalWorkbook({ ...workbook, name: request.name }, request.tags, libraryId);
        const apply = (change: z.infer<typeof WorkbookLibraryActionSchema>['change']) => deps.repository.libraryAction(libraryId,
          { operationId: randomUUID(), expectedVersion: read(libraryId).version, expectedRevision: deps.repository.libraryState(libraryId).revision, change },
          deps.clock.now().toISOString(), encodeEditableWorkbook({ ...workbook, name: request.name, libraryId }));
        apply({ kind: 'link', url: request.url });
        apply({ kind: 'sync' });
        deps.repository.recordSync(libraryId, { url: request.url, finishedAt: IsoInstantSchema.parse(deps.clock.now().toISOString()), result: 'ok' });
        return WorkbookImportResultSchema.parse({ workbook: encodeSavedWorkbook(read(libraryId)) });
      });
    },
    cloneWorkbook(libraryId: string, value: unknown) {
      const request = input(WorkbookCloneRequestSchema, value);
      read(libraryId);
      assertNameAvailable(request.name);
      const source = deps.repository.libraryVersion(libraryId);
      return importLocalWorkbook(decodeEditableWorkbook({ ...source.workbook, libraryId: undefined, name: request.name }), request.tags);
    },
    catalog: () => deps.repository.catalog(deps.clock.now().toISOString()).map(entry => entry.sync !== undefined && running.has(entry.libraryId)
      ? { ...entry, sync: { ...entry.sync, state: 'running' as const } } : entry),
    libraryVersion: (libraryId: string, versionId?: string) => deps.repository.libraryVersion(input(WorkbookIdSchema, libraryId), versionId === undefined ? undefined : input(WorkbookIdSchema, versionId)),
    libraryActionRecord: (libraryId: string, operationId: string) => deps.repository.libraryActionRecord(input(WorkbookIdSchema, libraryId), input(WorkbookIdSchema, operationId)),
    libraryActionStatus(libraryId: string, operationId: string) {
      const record = deps.repository.libraryActionRecord(input(WorkbookIdSchema, libraryId), input(WorkbookIdSchema, operationId));
      return WorkbookLibraryActionStatusSchema.parse(record === undefined ? { state: 'absent' }
        : record.action.change.kind === 'merge' ? { state: 'retired', code: 'WORKBOOK_ACTION_RETIRED', message: ERROR_CATALOG.WORKBOOK_ACTION_RETIRED.text }
          : { state: 'recorded', record });
    },
    /** Uses the library command's CAS and journal inside the caller's authority transaction. */
    localLibraryAction(libraryId: string, value: unknown, at: string) {
      const action = input(WorkbookLibraryActionSchema, value);
      const { change } = action;
      if (change.kind === "sync" || change.kind === "create-version" && change.from.kind === "sharepoint") throw new WorkbookLibraryError("WORKBOOK_INVALID");
      const replay = deps.repository.libraryActionRecord(libraryId, action.operationId);
      return deps.repository.libraryAction(libraryId, action, replay?.at ?? at);
    },
    /** `assertCurrent` runs after any SharePoint download and import and immediately before the repository write. */
    async libraryAction(libraryId: string, value: unknown, signal: AbortSignal, assertCurrent: () => void = () => {}) {
      const action = input(WorkbookLibraryActionSchema, value);
      const replay = deps.repository.libraryActionRecord(libraryId, action.operationId);
      if (replay !== undefined) return deps.repository.libraryAction(libraryId, action, replay.at);
      const record = read(libraryId), state = deps.repository.libraryState(libraryId);
      if (record.version !== action.expectedVersion || state.revision !== action.expectedRevision) throw new WorkbookLibraryError('WORKBOOK_VERSION_CONFLICT');
      signal.throwIfAborted();
      const apply = (workbook?: EditableWorkbookWire) => { assertCurrent(); return deps.repository.libraryAction(libraryId, action, deps.clock.now().toISOString(), workbook); };
      if (action.change.kind === 'sync') return tracked(libraryId, () => withDownloadedWorkbook(libraryId, action.operationId, signal, apply));
      if (action.change.kind === 'create-version' && action.change.from.kind === 'sharepoint') {
        const name = action.change.name.trim();
        if (state.versions.some(version => version.name.trim() === name)) throw new WorkbookLibraryError('WORKBOOK_VERSION_NAME_EXISTS');
        return withDownloadedWorkbook(libraryId, action.operationId, signal, apply);
      }
      return apply();
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
    listWithType: () => deps.repository.listWithType(),
    listWire: () => deps.repository.list().map(record => {
      const cached = encoded.get(record);
      if (cached !== undefined) return cached;
      const wire = deepFreeze(encodeSavedWorkbook(record));
      encoded.set(record, wire);
      return wire;
    }),
    save,
    /** Saves a new version in which every worksheet with `worksheetId`'s headers takes its column mapping. */
    copyMapping(libraryId: string, expectedVersion: number, worksheetId: string): SavedWorkbook {
      const current = read(libraryId);
      if (current.version !== expectedVersion) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
      if (!current.workbook.sheets.some(sheet => sheet.id === worksheetId && sheet.columnBindings !== undefined)) throw new WorkbookLibraryError("WORKBOOK_INVALID");
      return save(libraryId, expectedVersion, copyColumnMapping(current.workbook, worksheetId));
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
      return tracked(libraryId, () => withDownloadedWorkbook(libraryId, operationId, signal, workbook => {
        return deps.repository.operation(libraryId, { operationId, source: { kind: 'sync', syncId: operationId }, at: deps.clock.now().toISOString(),
          change: { kind: 'sync', expectedVersion: record.version, workbook } });
      }), receiptOutcome);
    },
  });
}
export type WorkbookLibraryService = ReturnType<typeof createWorkbookLibraryService>;

type WorkbookCompatibilityRepository = Pick<WorkbookLibraryRepository, "catalog" | "libraryVersion" | "lastUsed">;
const compatibilitySources = new WeakMap<WorkbookCompatibilityRepository, Readonly<{
  catalog: readonly WorkbookLibraryEntry[];
  sources: readonly WorkbookCompatibilitySource[];
}>>();

export function projectWorkbookCompatibilityFromRepository(repository: WorkbookCompatibilityRepository,
  workflows: readonly WorkbookReferenceWorkflow[]) {
  const catalog = repository.catalog();
  const cached = compatibilitySources.get(repository);
  const sources = cached?.catalog === catalog ? cached.sources : catalog.filter(entry => entry.state.origin.kind === "local" && !entry.state.removed).map(entry => {
    const selected = repository.libraryVersion(entry.libraryId, entry.state.selectedVersionId);
    return { libraryId: entry.libraryId, versionId: selected.version.id, origin: entry.state.origin,
      removed: entry.state.removed, sheets: selected.workbook.sheets.map(sheet => ({ id: sheet.id, name: sheet.name,
        mappings: (sheet.columnBindings ?? []).flatMap((binding, column) => binding.fieldId !== null && binding.basis !== "unmapped"
          ? [{ fieldId: binding.fieldId, column, basis: binding.basis }] : []),
      })) };
  });
  if (cached?.catalog !== catalog && Object.isFrozen(catalog)) compatibilitySources.set(repository, { catalog, sources });
  return projectWorkbookCompatibility(workflows.map(({ id, label, requiredWorkbookFields, workbookReference }) => ({
    id, label, requiredWorkbookFields, ...(workbookReference === undefined ? {} : { workbookReference }),
  })), sources,
    workflows.flatMap(workflow => { const saved = repository.lastUsed(workflow.id); return saved === undefined ? [] : [saved]; }));
}
