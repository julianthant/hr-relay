import { randomUUID } from "node:crypto";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { applyMasterChange, WorkbookOwnershipSchema, workbookMatches } from "../../workbooks/master-changes.js";
import { WorkbookSnapshotRequestSchema, WorkbookReferenceSnapshotSchema, WorkbookTypeSchema, WorkbookMetadataSchema, WorkbookNamedVersionSchema, WorkbookOperationSchema, WorkbookOperationReceiptSchema, decodeEditableWorkbook } from "../../../models/dashboard/workbooks.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { WorkbookLibraryError, type WorkbookLibraryRepository } from "../../workbooks/workbook-library-service.js";
import { decodeSavedWorkbook, encodeSavedWorkbook, SavedWorkbookSchema, type SavedWorkbook } from "../../../models/dashboard/workbooks.js";
import { WorkbookOperationRecordSchema } from "../../../models/dashboard/workbooks.js";
const serializeSavedWorkbook = (record: SavedWorkbook) => JSON.stringify(encodeSavedWorkbook(record));

export const WORKBOOK_LIBRARY_MIGRATION = Object.freeze({
  id: "workbook-library",
  statements: Object.freeze([
    `CREATE TABLE workbook_library (
      id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version>0),
      created_at TEXT NOT NULL, saved_at TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
    ) STRICT`,
    `CREATE TABLE workbook_library_history (
      workbook_id TEXT NOT NULL REFERENCES workbook_library(id), version INTEGER NOT NULL CHECK(version>0),
      created_at TEXT NOT NULL, saved_at TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), PRIMARY KEY(workbook_id,version)
    ) STRICT`,
    `CREATE TRIGGER workbook_library_history_immutable BEFORE UPDATE ON workbook_library_history BEGIN SELECT RAISE(ABORT,'workbook-history-immutable'); END`,
    `CREATE TRIGGER workbook_library_history_retained BEFORE DELETE ON workbook_library_history BEGIN SELECT RAISE(ABORT,'workbook-history-retained'); END`,
    `CREATE TRIGGER workbook_library_history_no_replace BEFORE INSERT ON workbook_library_history WHEN EXISTS(SELECT 1 FROM workbook_library_history WHERE workbook_id=NEW.workbook_id AND version=NEW.version) BEGIN SELECT RAISE(ABORT,'workbook-history-immutable'); END`,
  ]),
});

export const INITIAL_WORKBOOK_TYPE = Object.freeze({ id: 'general', name: 'General workbook', keyFieldId: null, fields: Object.freeze([]), defaultWorkbookId: null });

export function hasOnlyInitialWorkbookType(database: DatabaseSync): boolean {
  const rows = database.prepare('SELECT id,payload_json FROM workbook_types').all();
  if (rows.length !== 1) return false;
  const row = z.strictObject({ id: z.string(), payload_json: z.string() }).parse(rows[0]);
  const value = WorkbookTypeSchema.parse(JSON.parse(row.payload_json));
  return row.id === INITIAL_WORKBOOK_TYPE.id && canonicalJsonStringify(value) === canonicalJsonStringify(INITIAL_WORKBOOK_TYPE);
}

export const WORKBOOK_MASTER_MIGRATION = Object.freeze({ statements: [
  `ALTER TABLE workbook_library ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{"typeId":"general","sharePoint":null}' CHECK(json_valid(metadata_json))`,
  `ALTER TABLE workbook_library ADD COLUMN ownership_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(ownership_json))`,
  `CREATE TABLE workbook_creations (id TEXT PRIMARY KEY REFERENCES workbook_library(id), payload_json TEXT NOT NULL CHECK(json_valid(payload_json))) STRICT`,
  `INSERT INTO workbook_creations SELECT workbook_id,payload_json FROM workbook_library_history WHERE version=1`,
  `CREATE TABLE workbook_versions (workbook_id TEXT NOT NULL REFERENCES workbook_library(id), name TEXT NOT NULL, provenance TEXT NOT NULL CHECK(provenance IN ('operator','migration')), version INTEGER NOT NULL, created_at TEXT NOT NULL, saved_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), PRIMARY KEY(workbook_id,name)) STRICT`,
  `INSERT INTO workbook_versions SELECT workbook_id,'Saved revision '||version,'migration',version,created_at,saved_at,payload_json FROM workbook_library_history`,
  `DROP TRIGGER workbook_library_history_retained`, `DROP TABLE workbook_library_history`,
  `ALTER TABLE workbook_versions RENAME TO workbook_library_history`,
  `CREATE TABLE workbook_types (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL CHECK(json_valid(payload_json))) STRICT`,
  `INSERT INTO workbook_types(id,payload_json) VALUES('${INITIAL_WORKBOOK_TYPE.id}','${JSON.stringify(INITIAL_WORKBOOK_TYPE)}')`,
  `CREATE TABLE workbook_operations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, workbook_id TEXT NOT NULL REFERENCES workbook_library(id), operation_id TEXT NOT NULL, digest TEXT NOT NULL, request_json TEXT NOT NULL CHECK(json_valid(request_json)), receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json)), UNIQUE(workbook_id,operation_id)) STRICT`,
  ...['workbook_creations', 'workbook_library_history'].flatMap(table => [
    `CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'workbook-evidence-immutable'); END`,
    `CREATE TRIGGER ${table}_retained BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'workbook-evidence-retained'); END`,
  ]),
  `CREATE TRIGGER workbook_library_history_no_replace BEFORE INSERT ON workbook_library_history WHEN EXISTS(SELECT 1 FROM workbook_library_history WHERE workbook_id=NEW.workbook_id AND name=NEW.name) BEGIN SELECT RAISE(ABORT,'workbook-evidence-immutable'); END`,
  `CREATE TRIGGER workbook_creations_no_replace BEFORE INSERT ON workbook_creations WHEN EXISTS(SELECT 1 FROM workbook_creations WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'workbook-evidence-immutable'); END`,
  `CREATE TRIGGER workbook_operations_immutable BEFORE UPDATE ON workbook_operations WHEN OLD.receipt_json IS NOT NULL OR NEW.sequence IS NOT OLD.sequence OR NEW.workbook_id IS NOT OLD.workbook_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.digest IS NOT OLD.digest OR NEW.request_json IS NOT OLD.request_json BEGIN SELECT RAISE(ABORT,'workbook-operation-immutable'); END`,
  `CREATE TRIGGER workbook_operations_retained BEFORE DELETE ON workbook_operations BEGIN SELECT RAISE(ABORT,'workbook-operation-retained'); END`,
] });

const RowSchema = z.object({ id: z.string(), version: z.number().int().positive(), created_at: z.string(), saved_at: z.string(), payload_json: z.string() });
function fromRow(value: unknown): SavedWorkbook {
  try {
    const row = RowSchema.parse(value), record = decodeSavedWorkbook(JSON.parse(row.payload_json));
    if (record.libraryId !== row.id || record.version !== row.version || record.createdAt !== row.created_at || record.savedAt !== row.saved_at) throw new Error('workbook-column-conflict');
    return record;
  } catch (cause) { throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT', { cause }); }
}
function storage<T>(work: () => T): T {
  try { return work(); } catch (cause) {
    if (cause instanceof WorkbookLibraryError) throw cause;
    throw new WorkbookLibraryError('WORKBOOK_STORAGE_FAILED', { cause });
  }
}
function stored<T>(work: () => T): T {
  try { return work(); } catch (cause) {
    if (cause instanceof WorkbookLibraryError) throw cause;
    throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT', { cause });
  }
}
export function createWorkbookLibraryRepository(deps: Readonly<{
  database: DatabaseSync;
  mutate<T>(work: () => Readonly<{ result: T; changes: number }>): T;
  read<T>(work: () => T): T;
}>): WorkbookLibraryRepository {
  const { database } = deps;
  const current = (id: string) => {
    const row = database.prepare('SELECT * FROM workbook_library WHERE id=?').get(id);
    return row === undefined ? undefined : fromRow(row);
  };
  const required = (id: string) => {
    const record = current(id);
    if (!record) throw new WorkbookLibraryError('WORKBOOK_NOT_FOUND');
    return record;
  };
  const metadata = (id: string) => stored(() => WorkbookMetadataSchema.parse(JSON.parse(z.object({ metadata_json: z.string() }).parse(database.prepare('SELECT metadata_json FROM workbook_library WHERE id=?').get(id)).metadata_json)));
  const type = (id: string) => {
    const row = database.prepare('SELECT payload_json FROM workbook_types WHERE id=?').get(id);
    return row === undefined ? undefined : stored(() => WorkbookTypeSchema.parse(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json)));
  };
  const receipt = (value: unknown) => stored(() => WorkbookOperationReceiptSchema.parse(JSON.parse(z.string().parse(value))));
  const queueRow = z.object({ sequence: z.number(), operation_id: z.string(), digest: z.string(), request_json: z.string(), receipt_json: z.string().nullable() });
  const operationRecord = (id: string, value: unknown) => stored(() => {
    const row = queueRow.parse(value), operation = WorkbookOperationSchema.parse(JSON.parse(row.request_json));
    const settled = receipt(row.receipt_json);
    if (operation.operationId !== row.operation_id || sha256Hex(canonicalJsonStringify(operation)) !== row.digest
      || settled.libraryId !== id || settled.operationId !== operation.operationId || settled.sequence !== row.sequence
      || settled.at !== operation.at || canonicalJsonStringify(settled.source) !== canonicalJsonStringify(operation.source)) {
      throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    }
    return WorkbookOperationRecordSchema.parse({ libraryId: id, operation, receipt: settled });
  });
  const enqueue = (id: string, value: unknown) => storage(() => deps.mutate(() => {
    required(id);
    const operation = WorkbookOperationSchema.parse(value), json = canonicalJsonStringify(JSON.parse(JSON.stringify(operation))), digest = sha256Hex(json);
    const existing = database.prepare('SELECT * FROM workbook_operations WHERE workbook_id=? AND operation_id=?').get(id, operation.operationId);
    if (existing !== undefined) {
      const row = queueRow.parse(existing);
      if (row.digest !== digest) throw new WorkbookLibraryError('WORKBOOK_OPERATION_CONFLICT');
      return { result: row.sequence, changes: 0 };
    }
    if (operation.change.kind === 'patch' && operation.change.resolves !== undefined) {
      const binding = operation.change.resolves;
      const raw = database.prepare('SELECT * FROM workbook_operations WHERE workbook_id=? AND operation_id=?').get(id, binding.operationId);
      if (raw === undefined) throw new WorkbookLibraryError('WORKBOOK_OPERATION_CONFLICT');
      const original = operationRecord(id, raw);
      if (original.receipt.state !== 'resolve-required' || operation.source.kind !== 'run'
        || original.operation.change.kind !== 'patch' && original.operation.change.kind !== 'add'
        || canonicalJsonStringify(original.operation.source) !== canonicalJsonStringify(operation.source)
        || original.operation.change.key !== operation.change.key
        || canonicalJsonStringify(original.operation.change.values) !== canonicalJsonStringify(operation.change.values)
        || sha256Hex(canonicalJsonStringify(original.receipt)) !== binding.receiptDigest
        || operation.change.selection === undefined || operation.change.expectedVersion !== operation.change.selection.expectedVersion
        || database.prepare("SELECT 1 FROM workbook_operations WHERE workbook_id=? AND json_extract(request_json,'$.change.resolves.operationId')=? AND json_extract(receipt_json,'$.state')='applied'").get(id, binding.operationId) !== undefined) {
        throw new WorkbookLibraryError('WORKBOOK_OPERATION_CONFLICT');
      }
    }
    const inserted = database.prepare('INSERT INTO workbook_operations(workbook_id,operation_id,digest,request_json) VALUES(?,?,?,?)').run(id, operation.operationId, digest, json);
    return { result: Number(inserted.lastInsertRowid), changes: 1 };
  }));
  const drain = (id: string) => {
    while (storage(() => deps.mutate(() => {
    let changes = 0;
    const queued = database.prepare('SELECT * FROM workbook_operations WHERE workbook_id=? AND receipt_json IS NULL ORDER BY sequence LIMIT 1').all(id).map(row => queueRow.parse(row));
    for (const row of queued) {
      const operation = WorkbookOperationSchema.parse(JSON.parse(row.request_json));
      if (sha256Hex(canonicalJsonStringify(JSON.parse(JSON.stringify(operation)))) !== row.digest) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      const before = required(id), meta = metadata(id);
      const owners = WorkbookOwnershipSchema.parse(JSON.parse(z.object({ ownership_json: z.string() }).parse(database.prepare('SELECT ownership_json FROM workbook_library WHERE id=?').get(id)).ownership_json));
      const applied = applyMasterChange({ workbook: encodeSavedWorkbook(before).workbook, ownership: owners, version: before.version,
        type: type(meta.typeId), operation, libraryId: id, sequence: row.sequence });
      let result = applied.receipt;
      if (Date.parse(operation.at) < Date.parse(before.savedAt)) result = { ...result, state: 'refused', reason: 'invalid', version: before.version, changes: [] };
      if (result.state === 'applied') {
        if (operation.change.kind === 'version') {
          if (database.prepare('SELECT 1 FROM workbook_library_history WHERE workbook_id=? AND name=?').get(id, operation.change.name))
            result = { ...result, state: 'refused', reason: 'invalid' };
          else {
            database.prepare('INSERT INTO workbook_library_history(workbook_id,name,provenance,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?,?,?)').run(id, operation.change.name, 'operator', before.version, before.createdAt, before.savedAt, serializeSavedWorkbook(before)); changes++;
          }
        } else {
          let nextMeta = meta;
          if (operation.change.kind === 'metadata') {
            nextMeta = operation.change.metadata;
            if (!type(nextMeta.typeId)) result = { ...result, state: 'refused', reason: 'invalid' };
          }
          if (result.state === 'applied') {
            if (nextMeta.typeId !== meta.typeId) {
              const previousType = type(meta.typeId);
              if (previousType?.defaultWorkbookId === id) {
                database.prepare('UPDATE workbook_types SET payload_json=? WHERE id=?').run(canonicalJsonStringify({ ...previousType, defaultWorkbookId: null }), previousType.id); changes++;
              }
            }
            const updated = SavedWorkbookSchema.parse({ ...before, version: before.version + 1, savedAt: operation.at,
              workbook: decodeEditableWorkbook(applied.workbook) });
            result = { ...result, version: updated.version };
            database.prepare('UPDATE workbook_library SET version=?,saved_at=?,payload_json=?,metadata_json=?,ownership_json=? WHERE id=?').run(updated.version, updated.savedAt, serializeSavedWorkbook(updated), canonicalJsonStringify(nextMeta), canonicalJsonStringify(applied.ownership), id); changes++;
          }
        }
      }
      database.prepare('UPDATE workbook_operations SET receipt_json=? WHERE sequence=? AND receipt_json IS NULL').run(canonicalJsonStringify(WorkbookOperationReceiptSchema.parse(result)), row.sequence); changes++;
    }
    return { result: queued.length > 0, changes };
    }))) { /* Each transaction settles only the admitted head. */ }
  };
  const operation = (id: string, value: unknown) => {
    const sequence = enqueue(id, value); drain(id);
    return storage(() => deps.read(() => receipt(z.object({ receipt_json: z.string() }).parse(database.prepare('SELECT receipt_json FROM workbook_operations WHERE sequence=?').get(sequence)).receipt_json)));
  };
  const revision = (id: string, version: number): SavedWorkbook => storage(() => deps.read(() => stored(() => {
    const live = required(id);
    if (version > live.version) throw new WorkbookLibraryError('WORKBOOK_REVISION_UNAVAILABLE');
    if (version === live.version) return live;
    const creationRow = database.prepare('SELECT payload_json FROM workbook_creations WHERE id=?').get(id);
    const creation = decodeSavedWorkbook(JSON.parse(z.object({ payload_json: z.string() }).parse(creationRow).payload_json));
    if (creation.libraryId !== id || creation.version !== 1 || creation.createdAt !== live.createdAt) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    const migration = database.prepare("SELECT * FROM workbook_library_history WHERE workbook_id=? AND provenance='migration' AND version<=? ORDER BY version DESC LIMIT 1").get(id, version);
    const baseline = migration === undefined ? creation : fromRow({ ...migration, id });
    if (baseline.createdAt !== live.createdAt) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    let record = encodeSavedWorkbook(baseline), ownership = WorkbookOwnershipSchema.parse({}), typeId = 'general';
    if (record.version === version) return decodeSavedWorkbook(record);
    for (const raw of database.prepare('SELECT * FROM workbook_operations WHERE workbook_id=? ORDER BY sequence').all(id)) {
      const row = queueRow.parse(raw), operation = WorkbookOperationSchema.parse(JSON.parse(row.request_json));
      if (operation.operationId !== row.operation_id || sha256Hex(canonicalJsonStringify(JSON.parse(JSON.stringify(operation)))) !== row.digest) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      if (row.receipt_json === null) break;
      const settled = receipt(row.receipt_json);
      if (settled.libraryId !== id || settled.operationId !== operation.operationId || settled.sequence !== row.sequence
        || settled.at !== operation.at || canonicalJsonStringify(settled.source) !== canonicalJsonStringify(operation.source)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      if (settled.state !== 'applied') {
        if (settled.version !== record.version) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
        continue;
      }
      const workbookType = type(typeId);
      if (!workbookType || Date.parse(operation.at) < Date.parse(record.savedAt)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      const applied = applyMasterChange({ workbook: record.workbook, ownership, version: record.version, type: workbookType,
        operation, libraryId: id, sequence: row.sequence });
      const advances = operation.change.kind !== 'version';
      const expected = { ...applied.receipt, version: record.version + (advances ? 1 : 0) };
      if (applied.receipt.state !== 'applied' || canonicalJsonStringify(expected) !== canonicalJsonStringify(settled)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      if (operation.change.kind === 'metadata') {
        typeId = operation.change.metadata.typeId;
        if (!type(typeId)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      }
      if (advances) record = { ...record, version: expected.version, savedAt: operation.at, workbook: applied.workbook };
      ownership = applied.ownership;
      if (record.version === version) return decodeSavedWorkbook(record);
    }
    throw new WorkbookLibraryError('WORKBOOK_REVISION_UNAVAILABLE');
  })));
  const repository: WorkbookLibraryRepository = {
    create: recordValue => storage(() => deps.mutate(() => {
      const record = SavedWorkbookSchema.parse(recordValue);
      if (record.version !== 1 || current(record.libraryId)) throw new WorkbookLibraryError('WORKBOOK_VERSION_CONFLICT');
      const json = serializeSavedWorkbook(record);
      database.prepare('INSERT INTO workbook_library(id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)').run(record.libraryId, record.version, record.createdAt, record.savedAt, json);
      database.prepare('INSERT INTO workbook_creations(id,payload_json) VALUES(?,?)').run(record.libraryId, json);
      return { result: record, changes: 2 };
    })),
    read: id => storage(() => deps.read(() => current(id))),
    revision,
    creation: id => storage(() => deps.read(() => {
      const row = database.prepare('SELECT payload_json FROM workbook_creations WHERE id=?').get(id);
      return row === undefined ? undefined : stored(() => decodeSavedWorkbook(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json)));
    })),
    list: () => storage(() => deps.read(() => database.prepare('SELECT * FROM workbook_library ORDER BY saved_at DESC,id').all().map(fromRow))),
    save: (record, expectedVersion) => {
      const result = operation(record.libraryId, { operationId: randomUUID(), source: { kind: 'operator' }, at: record.savedAt,
        change: { kind: 'save', expectedVersion, workbook: encodeSavedWorkbook(record).workbook } });
      if (result.state !== 'applied') throw new WorkbookLibraryError(result.reason === 'version-conflict' ? 'WORKBOOK_VERSION_CONFLICT' : 'WORKBOOK_INVALID');
      return SavedWorkbookSchema.parse(record);
    },
    history: id => repository.versions(id).map(entry => decodeSavedWorkbook(entry.snapshot)),
    versions: id => storage(() => deps.read(() => {
      required(id);
      return database.prepare('SELECT * FROM workbook_library_history WHERE workbook_id=? ORDER BY version,name').all(id).map(raw => {
        const row = z.object({ name: z.string(), provenance: z.string() }).parse(raw);
        return stored(() => WorkbookNamedVersionSchema.parse({ ...row, snapshot: encodeSavedWorkbook(fromRow({ ...raw, id })) }));
      });
    })),
    types: () => storage(() => deps.read(() => database.prepare('SELECT payload_json FROM workbook_types ORDER BY id').all().map(row => WorkbookTypeSchema.parse(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json))))),
    putType: value => storage(() => deps.mutate(() => {
      const record = WorkbookTypeSchema.parse(value);
      if (record.defaultWorkbookId !== null && metadata(record.defaultWorkbookId).typeId !== record.id) throw new WorkbookLibraryError('WORKBOOK_INVALID');
      const before = type(record.id);
      if (before && canonicalJsonStringify({ ...before, name: record.name, defaultWorkbookId: record.defaultWorkbookId }) !== canonicalJsonStringify(record)) throw new WorkbookLibraryError('WORKBOOK_INVALID');
      database.prepare('INSERT INTO workbook_types(id,payload_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json').run(record.id, canonicalJsonStringify(record));
      return { result: record, changes: 1 };
    })),
    metadata: id => storage(() => deps.read(() => { required(id); return metadata(id); })),
    snapshot: value => storage(() => deps.read(() => {
      const request = WorkbookSnapshotRequestSchema.parse(value), workbookType = type(request.typeId);
      if (!workbookType || workbookType.keyFieldId === null || request.fields.some(field => !workbookType.fields.includes(field))) throw new WorkbookLibraryError('WORKBOOK_INVALID');
      const id = request.libraryId ?? workbookType.defaultWorkbookId;
      if (!id) throw new WorkbookLibraryError('WORKBOOK_NOT_FOUND');
      const record = required(id);
      if ("mode" in request && request.expectedVersion !== record.version) throw new WorkbookLibraryError('WORKBOOK_VERSION_CONFLICT');
      if (metadata(id).typeId !== workbookType.id) throw new WorkbookLibraryError('WORKBOOK_INVALID');
      const workbook = encodeSavedWorkbook(record).workbook, keyField = workbookType.keyFieldId;
      const values = (sheet: typeof workbook.sheets[number], row: typeof workbook.sheets[number]["rows"][number]) =>
        Object.fromEntries(request.fields.map(field => {
          const indexes = sheet.columnBindings?.flatMap((binding, index) => binding.fieldId === field ? [index] : []) ?? [];
          if (indexes.length !== 1) throw new WorkbookLibraryError('WORKBOOK_INVALID');
          return [field, row.cells[indexes[0]].value];
        }));
      return WorkbookReferenceSnapshotSchema.parse({ libraryId: id, version: record.version, type: workbookType,
        worksheets: workbook.sheets.map(sheet => ({ sheetId: sheet.id, name: sheet.name })),
        rows: "mode" in request ? workbook.sheets.flatMap(sheet => sheet.rows.slice(sheet.headerRow ?? 1).map(row => ({
          key: `${sheet.id}#${row.id}`, state: "matched", matches: [{ sheetId: sheet.id, rowId: row.id, values: values(sheet, row) }],
        }))) : request.keys.map(key => {
          const matches = workbookMatches(workbook, keyField, key);
          return { key, state: matches.length === 0 ? 'missing' : matches.length === 1 ? 'matched' : 'ambiguous',
            matches: matches.map(({ sheetId, rowId, sheet, row }) => ({ sheetId, rowId,
              values: values(sheet, row) })) };
        }) });
    })),
    enqueue, drain, operation,
    journal: id => storage(() => deps.read(() => { required(id); return database.prepare('SELECT receipt_json FROM workbook_operations WHERE workbook_id=? AND receipt_json IS NOT NULL ORDER BY sequence').all(id).map(row => receipt(row.receipt_json)); })),
    runOperations: runId => storage(() => deps.read(() => database.prepare("SELECT * FROM workbook_operations WHERE json_extract(request_json,'$.source.kind')='run' AND json_extract(request_json,'$.source.runId')=? ORDER BY sequence").all(runId)
      .map(raw => { const row = z.object({ workbook_id: z.string() }).parse(raw); return operationRecord(row.workbook_id, raw); }))),
  };
  return Object.freeze(repository);
}

export function validateWorkbookLibrary(database: DatabaseSync, master = true): number {
  if (!master) {
    const records = database.prepare('SELECT * FROM workbook_library').all().map(fromRow);
    return records.reduce((total, record) => {
      const history = database.prepare('SELECT workbook_id AS id,version,created_at,saved_at,payload_json FROM workbook_library_history WHERE workbook_id=? ORDER BY version').all(record.libraryId).map(fromRow);
      if (history.length !== record.version || history.some((entry, index) => entry.version !== index + 1) || serializeSavedWorkbook(history[history.length - 1]) !== serializeSavedWorkbook(record)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      return total + 1 + history.length;
    }, 0);
  }
  const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: () => { throw new Error('workbook-validation-read-only'); } });
  let count = repository.types().length;
  for (const record of repository.list()) {
    const creation = repository.creation(record.libraryId), metadata = repository.metadata(record.libraryId);
    if (!creation || creation.version !== 1 || creation.createdAt !== record.createdAt || (!repository.types().some(type => type.id === metadata.typeId))) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    WorkbookOwnershipSchema.parse(JSON.parse(z.object({ ownership_json: z.string() }).parse(database.prepare('SELECT ownership_json FROM workbook_library WHERE id=?').get(record.libraryId)).ownership_json));
    count += 2 + repository.versions(record.libraryId).length + repository.journal(record.libraryId).length;
    for (const raw of database.prepare('SELECT * FROM workbook_operations WHERE workbook_id=? ORDER BY sequence').all(record.libraryId)) {
      const row = z.object({ sequence: z.number(), operation_id: z.string(), digest: z.string(), request_json: z.string(), receipt_json: z.string().nullable() }).parse(raw);
      const operation = WorkbookOperationSchema.parse(JSON.parse(row.request_json));
      if (operation.operationId !== row.operation_id || sha256Hex(canonicalJsonStringify(JSON.parse(JSON.stringify(operation)))) !== row.digest) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      if (row.receipt_json !== null) {
        const receipt = WorkbookOperationReceiptSchema.parse(JSON.parse(row.receipt_json));
        if (receipt.sequence !== row.sequence || receipt.libraryId !== record.libraryId || receipt.operationId !== row.operation_id || receipt.version > record.version) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      }
    }
  }
  return count;
}
