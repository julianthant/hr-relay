import { EditableWorkbookSchema, SavedWorkbookSchema, WorkbookIdSchema, type SavedWorkbook, type WorkbookType, type WorkbookMetadata, type WorkbookOperationReceipt, WorkbookNamedVersionSchema, WorkbookOperationSchema, WorkbookReferenceRequestSchema, WorkbookOperatorOperationRequestSchema, WorkbookReferenceSnapshotSchema, encodeSavedWorkbook } from "../../models/dashboard/workbooks.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { RunIdSchema } from "../../rules/identity/ids.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../../rules/time/clock.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";

export class WorkbookLibraryError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, `WORKBOOK_${string}`>, options?: ErrorOptions) {
    super(ERROR_CATALOG[code].text, options);
    this.name = "WorkbookLibraryError";
  }
}

export interface WorkbookLibraryRepository {
  create(record: SavedWorkbook): SavedWorkbook;
  read(libraryId: string): SavedWorkbook | undefined;
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
  snapshot(value: unknown): z.infer<typeof WorkbookReferenceSnapshotSchema>;
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new WorkbookLibraryError("WORKBOOK_INVALID", { cause: parsed.error });
  return parsed.data;
}
export function createWorkbookLibraryService(deps: Readonly<{ repository: WorkbookLibraryRepository; clock: Clock; downloadSharePoint?: (link: NonNullable<WorkbookMetadata["sharePoint"]>, signal: AbortSignal) => Promise<Readonly<{ name: string; bytes: ArrayBuffer }>> }>) {
  const read = (libraryId: string): SavedWorkbook => {
    const record = deps.repository.read(input(WorkbookIdSchema, libraryId));
    if (record === undefined) throw new WorkbookLibraryError("WORKBOOK_NOT_FOUND");
    return record;
  };
  return Object.freeze({
    create(value: unknown): SavedWorkbook {
      const workbook = input(EditableWorkbookSchema, value);
      if (workbook.libraryId !== undefined) throw new WorkbookLibraryError("WORKBOOK_INVALID");
      const libraryId = randomUUID(), now = deps.clock.now().toISOString();
      return deps.repository.create(input(SavedWorkbookSchema, { libraryId, version: 1, createdAt: now, savedAt: now, workbook: { ...workbook, libraryId } }));
    },
    read,
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
    writeRun(runIdValue: unknown, libraryId: string, operationId: string, value: unknown) {
      const runId = input(RunIdSchema, runIdValue), change = input(WorkbookOperatorOperationRequestSchema, value);
      if (change.kind !== 'patch' && change.kind !== 'add') throw new WorkbookLibraryError('WORKBOOK_INVALID');
      deps.repository.drain(libraryId);
      if (read(libraryId).workbook.hasFormulas || read(libraryId).workbook.unsupportedMetadata) throw new WorkbookLibraryError('WORKBOOK_METADATA_UNSUPPORTED');
      const replay = deps.repository.journal(libraryId).find(receipt => receipt.operationId === operationId);
      return deps.repository.operation(libraryId, { operationId, source: { kind: 'run', runId }, at: replay?.at ?? deps.clock.now().toISOString(), change });
    },
    snapshot: (value: unknown) => deepFreeze(deps.repository.snapshot(input(WorkbookReferenceRequestSchema, value))),
    async sync(libraryId: string, operationId: string, signal: AbortSignal) {
      input(WorkbookIdSchema, operationId);
      deps.repository.drain(libraryId);
      const replay = deps.repository.journal(libraryId).find(receipt => receipt.operationId === operationId);
      if (replay) {
        if (replay.source.kind !== 'sync' || replay.source.syncId !== operationId) throw new WorkbookLibraryError('WORKBOOK_OPERATION_CONFLICT');
        return replay;
      }
      const record = read(libraryId), link = deps.repository.metadata(libraryId).sharePoint;
      if (!link || !deps.downloadSharePoint) throw new WorkbookLibraryError('WORKBOOK_SYNC_UNAVAILABLE');
      signal.throwIfAborted();
      const downloaded = await deps.downloadSharePoint(link, signal);
      const { importWorkbook } = await import('../../rules/spreadsheets/workbook-io.js');
      const workbook = await importWorkbook(downloaded.name, downloaded.bytes);
      if (record.workbook.hasFormulas || record.workbook.unsupportedMetadata || workbook.hasFormulas || workbook.unsupportedMetadata) throw new WorkbookLibraryError('WORKBOOK_METADATA_UNSUPPORTED');
      signal.throwIfAborted();
      return deps.repository.operation(libraryId, { operationId, source: { kind: 'sync', syncId: operationId }, at: deps.clock.now().toISOString(),
        change: { kind: 'sync', expectedVersion: record.version, workbook: encodeSavedWorkbook({ ...record, workbook: { ...workbook, libraryId } }).workbook } });
    },
  });
}
export type WorkbookLibraryService = ReturnType<typeof createWorkbookLibraryService>;
