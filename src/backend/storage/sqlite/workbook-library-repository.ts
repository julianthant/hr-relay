import { randomUUID } from "node:crypto";
import { WorkflowWorkbookSelectionInputSchema, WorkflowWorkbookSelectionRecordSchema, WorkbookLibraryStateSchema, WorkbookLibraryEntrySchema, WorkbookLibrarySnapshotSchema, WorkbookLibraryActionSchema, WorkbookLibraryActionRecordSchema, WorkbookLibraryActionResultSchema, type WorkbookLibraryState, type WorkbookLibraryActionRecord } from "../../../models/dashboard/workbook-library.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { applyMasterChange, WorkbookOwnershipSchema, workbookMatches, type WorkbookReplayContext } from "../../workbooks/master-changes.js";
import { WorkbookSnapshotRequestSchema, WorkbookReferenceSnapshotSchema, WorkbookNamedReferenceSnapshotSchema, WorkbookTypeSchema, WorkbookMetadataSchema, WorkbookNamedVersionSchema, WorkbookOperationSchema, WorkbookOperationReceiptSchema, decodeEditableWorkbook } from "../../../models/dashboard/workbooks.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { WorkbookLibraryError } from "../../workbooks/workbook-library-error.js";
import { type WorkbookLibraryRepository } from "../../workbooks/workbook-library-service.js";
import { decodeSavedWorkbook, encodeSavedWorkbook, SavedWorkbookSchema, type SavedWorkbook } from "../../../models/dashboard/workbooks.js";
import { WorkbookOperationRecordSchema } from "../../../models/dashboard/workbooks.js";
import { IsoInstantSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
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

export const WORKBOOK_LIBRARY_CATALOG_MIGRATION = Object.freeze({ statements: [
  `CREATE TABLE workbook_library_state (id TEXT PRIMARY KEY REFERENCES workbook_library(id), payload_json TEXT NOT NULL CHECK(json_valid(payload_json))) STRICT`,
  `CREATE TABLE workbook_library_actions (id TEXT PRIMARY KEY, workbook_id TEXT NOT NULL REFERENCES workbook_library(id), operation_id TEXT NOT NULL, digest TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), UNIQUE(workbook_id,operation_id)) STRICT`,
  `CREATE TABLE workbook_library_snapshots (id TEXT PRIMARY KEY, workbook_id TEXT NOT NULL REFERENCES workbook_library(id), payload_json TEXT NOT NULL CHECK(json_valid(payload_json))) STRICT`,
  `INSERT INTO workbook_library_snapshots SELECT json_array(id,'current'),id,json_object('id',printf('%s',json_array(id,'current')),'libraryId',id,'workbook',json_extract(payload_json,'$.workbook')) FROM workbook_library`,
  `INSERT INTO workbook_library_snapshots SELECT json_array(workbook_id,'retained:'||name),workbook_id,json_object('id',printf('%s',json_array(workbook_id,'retained:'||name)),'libraryId',workbook_id,'workbook',json_extract(payload_json,'$.workbook')) FROM workbook_library_history`,
  `INSERT INTO workbook_library_state SELECT id,json_object('libraryId',id,'revision',1,'selectedVersionId','current','removed',json('false'),
    'origin',json(CASE WHEN id LIKE 'workflow:%' THEN '{"kind":"unavailable","code":"WORKBOOK_OUTPUT_SOURCE_UNAVAILABLE"}' ELSE '{"kind":"local"}' END),
    'versions',json_array(json_object('id','current','snapshotId',printf('%s',json_array(id,'current')),'name','Saved revision '||version,'version',version,'savedAt',saved_at,'source','retained')))
    FROM workbook_library`,
  `UPDATE workbook_library_state SET payload_json=json_set(payload_json,'$.versions',json(
    (SELECT json_group_array(json(value)) FROM (
      SELECT value FROM json_each(workbook_library_state.payload_json,'$.versions')
      UNION ALL SELECT json_object('id','retained:'||name,'snapshotId',printf('%s',json_array(workbook_id,'retained:'||name)),'name',name,'version',version,'savedAt',saved_at,'source','retained')
        FROM workbook_library_history WHERE workbook_id=workbook_library_state.id
    ))))`,
  ...['UPDATE', 'DELETE'].map(operation => `CREATE TRIGGER workbook_library_actions_${operation.toLowerCase()} BEFORE ${operation} ON workbook_library_actions BEGIN SELECT RAISE(ABORT,'workbook-library-action-immutable'); END`),
  ...['UPDATE', 'DELETE'].map(operation => `CREATE TRIGGER workbook_library_snapshots_${operation.toLowerCase()} BEFORE ${operation} ON workbook_library_snapshots BEGIN SELECT RAISE(ABORT,'workbook-library-snapshot-immutable'); END`),
] });

const ACTION_UPDATE_GUARD = `CREATE TRIGGER workbook_library_actions_update BEFORE UPDATE ON workbook_library_actions BEGIN SELECT RAISE(ABORT,'workbook-library-action-immutable'); END`;
/** Schema 30: every library state and recorded action result starts unpinned with no manual tags. */
export const WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION = Object.freeze({ version: 30, statements: Object.freeze([
  `UPDATE workbook_library_state SET payload_json=json_set(payload_json,'$.pinned',json('false'),'$.tags',json('[]'))`,
  'DROP TRIGGER workbook_library_actions_update',
  `UPDATE workbook_library_actions SET payload_json=json_set(payload_json,'$.result.pinned',json('false'),'$.result.tags',json('[]'))`,
  ACTION_UPDATE_GUARD,
]) });

const RowSchema = z.object({ id: z.string(), version: z.number().int().positive(), created_at: z.string(), saved_at: z.string(), payload_json: z.string() });
function selectionFromRow(value: unknown) {
  const row = z.object({ workflow_id: z.string(), revision: z.number(), accepted_command_id: z.string(), used_at: z.string(), payload_json: z.string() }).parse(value);
  const record = WorkflowWorkbookSelectionRecordSchema.parse(JSON.parse(row.payload_json));
  const columns = { workflow_id: record.workflowId, revision: record.revision, accepted_command_id: record.acceptedCommandId, used_at: record.usedAt };
  for (const [column, expected] of Object.entries(columns)) if (row[column as keyof typeof columns] !== expected) throw new Error(`workflow_workbook_selections-row-${column}-mismatch`);
  return record;
}
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
  /** Reads a store from before schema 30, whose states carry no pin or tags yet. */
  beforePinTags?: boolean;
}>): WorkbookLibraryRepository {
  const { database } = deps;
  const withPinTags = (state: unknown) => {
    if (deps.beforePinTags !== true) return state;
    // A predecessor state is strict: a pin or tags already present is not schema-29 data.
    if (typeof state !== 'object' || state === null || 'pinned' in state || 'tags' in state) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    return { ...state, pinned: false, tags: [] };
  };
  const lastUsed = (workflowId: string) => stored(() => {
    const id = WorkflowIdSchema.parse(workflowId);
    const row = database.prepare('SELECT * FROM workflow_workbook_selections WHERE workflow_id=?').get(id);
    return row === undefined ? undefined : selectionFromRow(row);
  });
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
  const libraryState = (id: string): WorkbookLibraryState => stored(() => {
    const row = z.strictObject({ payload_json: z.string() }).parse(database.prepare('SELECT payload_json FROM workbook_library_state WHERE id=?').get(id));
    const state = WorkbookLibraryStateSchema.parse(withPinTags(JSON.parse(row.payload_json)));
    if (state.libraryId !== id) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    return state;
  });
  const putLibraryState = (state: WorkbookLibraryState) => {
    const value = WorkbookLibraryStateSchema.parse(state);
    if (database.prepare('UPDATE workbook_library_state SET payload_json=? WHERE id=?').run(canonicalJsonStringify(value), value.libraryId).changes !== 1) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  };
  const librarySnapshot = (id: string, snapshotId: string) => stored(() => {
    const row = z.strictObject({ id: z.string(), workbook_id: z.string(), payload_json: z.string() }).parse(database.prepare('SELECT id,workbook_id,payload_json FROM workbook_library_snapshots WHERE id=?').get(snapshotId));
    const snapshot = WorkbookLibrarySnapshotSchema.parse(JSON.parse(row.payload_json));
    if (row.id !== snapshot.id || row.workbook_id !== id || snapshot.libraryId !== id) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    return snapshot;
  });
  const putLibrarySnapshot = (id: string, versionId: string, workbook: z.infer<typeof WorkbookLibrarySnapshotSchema>["workbook"]) => {
    const snapshotId = JSON.stringify([id, versionId]);
    const snapshot = WorkbookLibrarySnapshotSchema.parse({ id: snapshotId, libraryId: id, workbook });
    database.prepare('INSERT INTO workbook_library_snapshots(id,workbook_id,payload_json) VALUES(?,?,?)').run(snapshotId, id, JSON.stringify(snapshot));
    return snapshotId;
  };
  const libraryVersion = (id: string, versionId?: string) => {
    const state = libraryState(id);
    if (state.removed) throw new WorkbookLibraryError('WORKBOOK_NOT_FOUND');
    const version = state.versions.find(version => version.id === (versionId ?? state.selectedVersionId));
    if (version === undefined) throw new WorkbookLibraryError('WORKBOOK_REVISION_UNAVAILABLE');
    return { libraryId: id, version, workbook: librarySnapshot(id, version.snapshotId).workbook };
  };
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
  const enqueueWork = (id: string, value: unknown) => {
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
      if (original.receipt.state !== 'resolve-required' || (operation.source.kind !== 'run' && operation.source.kind !== 'run-reference')
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
  };
  const enqueue = (id: string, value: unknown) => storage(() => deps.mutate(() => enqueueWork(id, value)));
  const drainWork = (id: string) => {
    let changes = 0;
    const queued = database.prepare('SELECT * FROM workbook_operations WHERE workbook_id=? AND receipt_json IS NULL ORDER BY sequence LIMIT 1').all(id).map(row => queueRow.parse(row));
    for (const row of queued) {
      const operation = WorkbookOperationSchema.parse(JSON.parse(row.request_json));
      if (sha256Hex(canonicalJsonStringify(JSON.parse(JSON.stringify(operation)))) !== row.digest) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      const before = required(id), meta = metadata(id);
      const owners = WorkbookOwnershipSchema.parse(JSON.parse(z.object({ ownership_json: z.string() }).parse(database.prepare('SELECT ownership_json FROM workbook_library WHERE id=?').get(id)).ownership_json));
      const context = operation.change.kind === 'sync' ? reconstructVersion(id, before.version) : undefined;
      if (context !== undefined && (canonicalJsonStringify(encodeSavedWorkbook(context.record)) !== canonicalJsonStringify(encodeSavedWorkbook(before))
        || canonicalJsonStringify(context.ownership) !== canonicalJsonStringify(owners)
        || context.typeId !== meta.typeId)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      const applied = applyMasterChange({ workbook: encodeSavedWorkbook(before).workbook, ownership: owners, version: before.version,
        type: operation.source.kind === 'run-reference' ? undefined : type(meta.typeId), operation, libraryId: id, sequence: row.sequence,
        ...(context === undefined ? {} : { context: context.context }) });
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
            const state = libraryState(id);
            if (state.removed) throw new WorkbookLibraryError('WORKBOOK_NOT_FOUND');
            const versionId = `revision:${updated.version}`;
            const snapshotId = operation.change.kind === 'metadata' ? undefined : putLibrarySnapshot(id, versionId, encodeSavedWorkbook(updated).workbook);
            if (snapshotId !== undefined) changes++;
            putLibraryState({ ...state, revision: state.revision + 1,
              ...(snapshotId === undefined ? {} : { selectedVersionId: versionId,
                versions: [...state.versions, { id: versionId, snapshotId, name: operation.source.kind === 'sync' ? 'Synced from SharePoint' : `Saved revision ${updated.version}`,
                  version: updated.version, savedAt: updated.savedAt, source: operation.source.kind === 'sync' ? 'sharepoint' : operation.source.kind === 'run' || operation.source.kind === 'run-reference' ? 'workflow' : 'operator' }] }) });
            changes++;
          }
        }
      }
      database.prepare('UPDATE workbook_operations SET receipt_json=? WHERE sequence=? AND receipt_json IS NULL').run(canonicalJsonStringify(WorkbookOperationReceiptSchema.parse(result)), row.sequence); changes++;
    }
    return { result: queued.length > 0, changes };
  };
  const drain = (id: string) => {
    while (storage(() => deps.mutate(() => drainWork(id)))) { /* Each transaction settles only the admitted head. */ }
  };
  const operation = (id: string, value: unknown) => {
    const sequence = enqueue(id, value); drain(id);
    return storage(() => deps.read(() => receipt(z.object({ receipt_json: z.string() }).parse(database.prepare('SELECT receipt_json FROM workbook_operations WHERE sequence=?').get(sequence)).receipt_json)));
  };
  const reconstructVersion = (id: string, version: number) => {
    const live = required(id);
    if (version > live.version) throw new WorkbookLibraryError('WORKBOOK_REVISION_UNAVAILABLE');
    const creationRow = database.prepare('SELECT payload_json FROM workbook_creations WHERE id=?').get(id);
    const creation = decodeSavedWorkbook(JSON.parse(z.object({ payload_json: z.string() }).parse(creationRow).payload_json));
    if (creation.libraryId !== id || creation.version !== 1 || creation.createdAt !== live.createdAt) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    const migration = database.prepare("SELECT * FROM workbook_library_history WHERE workbook_id=? AND provenance='migration' AND version<=? ORDER BY version DESC LIMIT 1").get(id, version);
    const baseline = migration === undefined ? creation : fromRow({ ...migration, id });
    if (baseline.createdAt !== live.createdAt) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    let record = encodeSavedWorkbook(baseline), ownership = WorkbookOwnershipSchema.parse({}), typeId = 'general';
    const context: WorkbookReplayContext = { witnesses: [], captured: false };
    if (record.version === version && version !== live.version) return { record: decodeSavedWorkbook(record), ownership, typeId, context };
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
      const workbookType = operation.source.kind === 'run-reference' ? undefined : type(typeId);
      if ((operation.source.kind !== 'run-reference' && !workbookType) || Date.parse(operation.at) < Date.parse(record.savedAt)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      const applied = applyMasterChange({ workbook: record.workbook, ownership, version: record.version, type: workbookType,
        operation, libraryId: id, sequence: row.sequence, context });
      const advances = operation.change.kind !== 'version';
      const expected = { ...applied.receipt, version: record.version + (advances ? 1 : 0) };
      if (applied.receipt.state !== 'applied' || canonicalJsonStringify(expected) !== canonicalJsonStringify(settled)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      if (operation.change.kind === 'metadata') {
        typeId = operation.change.metadata.typeId;
        if (!type(typeId)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      }
      if (advances) record = { ...record, version: expected.version, savedAt: operation.at, workbook: applied.workbook };
      ownership = applied.ownership;
      if (record.version === version && version !== live.version) return { record: decodeSavedWorkbook(record), ownership, typeId, context };
    }
    if (record.version === version) return { record: decodeSavedWorkbook(record), ownership, typeId, context };
    throw new WorkbookLibraryError('WORKBOOK_REVISION_UNAVAILABLE');
  };
  const revisionValue = (id: string, version: number): SavedWorkbook => version === required(id).version
    ? required(id) : reconstructVersion(id, version).record;
  const revision = (id: string, version: number) => storage(() => deps.read(() => stored(() => revisionValue(id, version))));
  const libraryActionRecord = (id: string, operationId: string): WorkbookLibraryActionRecord | undefined => {
    const raw = database.prepare('SELECT id,workbook_id,operation_id,digest,payload_json FROM workbook_library_actions WHERE workbook_id=? AND operation_id=?').get(id, operationId);
    if (raw === undefined) return undefined;
    return stored(() => {
      const row = z.strictObject({ id: z.string(), workbook_id: z.string(), operation_id: z.string(), digest: z.string(), payload_json: z.string() }).parse(raw);
      const payload = z.looseObject({ result: z.looseObject({}) }).parse(JSON.parse(row.payload_json));
      const record = WorkbookLibraryActionRecordSchema.parse({ ...payload, result: withPinTags(payload.result) });
      if (record.libraryId !== row.workbook_id || record.action.operationId !== row.operation_id
        || row.id !== JSON.stringify([record.libraryId, record.action.operationId])
        || sha256Hex(canonicalJsonStringify(record.action)) !== row.digest) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      return record;
    });
  };
  const inUse = (id: string, at: string, version?: WorkbookLibraryState["versions"][number]) => database.prepare('SELECT 1 FROM workbook_operations WHERE workbook_id=? AND receipt_json IS NULL LIMIT 1').get(id) !== undefined
    || database.prepare(`SELECT 1 FROM runs,json_each(runs.lifecycle_json,'$.input.workbookReferences') reference
    WHERE runs.state<>'terminal' AND json_extract(reference.value,'$.value.snapshot.libraryId')=?
      AND (? IS NULL OR json_extract(reference.value,'$.value.snapshot.versionId')=?
        OR (json_type(reference.value,'$.value.snapshot.versionId') IS NULL AND json_extract(reference.value,'$.value.snapshot.version')=?)) LIMIT 1`)
      .get(id, version?.id ?? null, version?.id ?? null, version?.version ?? null) !== undefined
    || database.prepare(`SELECT 1 FROM run_requests,json_each(run_requests.payload_json,'$.planned') planned,
      json_each(planned.value,'$.workbookReferences') reference
      WHERE json_type(run_requests.payload_json,'$.consumedBy') IS NULL
        AND json_extract(run_requests.payload_json,'$.expiresAt')>?
        AND json_extract(reference.value,'$.value.snapshot.libraryId')=?
        AND (? IS NULL OR json_extract(reference.value,'$.value.snapshot.versionId')=?
          OR (json_type(reference.value,'$.value.snapshot.versionId') IS NULL AND json_extract(reference.value,'$.value.snapshot.version')=?)) LIMIT 1`)
      .get(at, id, version?.id ?? null, version?.id ?? null, version?.version ?? null) !== undefined;
  const repository: WorkbookLibraryRepository = {
    lastUsed: workflowId => storage(() => deps.read(() => lastUsed(workflowId))),
    rememberLastUsed: value => storage(() => deps.mutate(() => {
      const input = WorkflowWorkbookSelectionInputSchema.parse(value);
      const prior = lastUsed(input.workflowId);
      if (prior?.acceptedCommandId === input.acceptedCommandId) {
        if (prior.usedAt !== input.usedAt || canonicalJsonStringify(prior.sources) !== canonicalJsonStringify(input.sources)) {
          throw new WorkbookLibraryError('WORKBOOK_OPERATION_CONFLICT');
        }
        return { result: prior, changes: 0 };
      }
      const record = WorkflowWorkbookSelectionRecordSchema.parse({ ...input, revision: (prior?.revision ?? 0) + 1 });
      database.prepare(`INSERT INTO workflow_workbook_selections(workflow_id,revision,accepted_command_id,used_at,payload_json) VALUES(?,?,?,?,?)
        ON CONFLICT(workflow_id) DO UPDATE SET revision=excluded.revision,accepted_command_id=excluded.accepted_command_id,used_at=excluded.used_at,payload_json=excluded.payload_json`)
        .run(record.workflowId, record.revision, record.acceptedCommandId, record.usedAt, canonicalJsonStringify(record));
      return { result: record, changes: 1 };
    })),
    catalog: () => storage(() => deps.read(() => database.prepare('SELECT * FROM workbook_library ORDER BY saved_at DESC,id').all().flatMap(raw => {
      const current = fromRow(raw), state = libraryState(current.libraryId);
      if (state.removed) return [];
      const selected = state.versions.find(version => version.id === state.selectedVersionId);
      if (selected === undefined) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      const record = librarySnapshot(current.libraryId, selected.snapshotId), meta = metadata(current.libraryId), workbookType = type(meta.typeId);
      if (workbookType === undefined) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      return [WorkbookLibraryEntrySchema.parse({ libraryId: current.libraryId, version: current.version, name: current.workbook.name, updatedAt: selected.savedAt,
        worksheets: record.workbook.sheets.map(sheet => ({ id: sheet.id, name: sheet.name })),
        rowCount: record.workbook.sheets.reduce((count, sheet) => count + sheet.rows.length - (sheet.headerRow ?? 1), 0),
        state, metadata: meta, type: workbookType })];
    }))),
    libraryState: id => storage(() => deps.read(() => libraryState(id))),
    libraryVersion: (id, versionId) => storage(() => deps.read(() => libraryVersion(id, versionId))),
    libraryActionRecord: (id, operationId) => storage(() => deps.read(() => libraryActionRecord(id, operationId))),
    libraryAction: (id, value, atValue, sharePointWorkbook) => {
      const parsed = WorkbookLibraryActionSchema.safeParse(value);
      if (!parsed.success) throw new WorkbookLibraryError('WORKBOOK_INVALID', { cause: parsed.error });
      const action = parsed.data;
      return storage(() => deps.mutate(() => {
        const at = IsoInstantSchema.parse(atValue);
        const replay = libraryActionRecord(id, action.operationId);
        if (replay !== undefined) {
          if (canonicalJsonStringify(replay.action) !== canonicalJsonStringify(action)) throw new WorkbookLibraryError('WORKBOOK_OPERATION_CONFLICT');
          return { result: WorkbookLibraryActionResultSchema.parse(replay), changes: 0 };
        }
        const state = libraryState(id), before = required(id), change = action.change;
        if (state.removed) throw new WorkbookLibraryError('WORKBOOK_NOT_FOUND');
        if (state.revision !== action.expectedRevision || before.version !== action.expectedVersion) throw new WorkbookLibraryError('WORKBOOK_VERSION_CONFLICT');
        let next = structuredClone(state), changes = 0;
        const apply = (operation: z.infer<typeof WorkbookOperationSchema>) => {
          changes += enqueueWork(id, operation).changes;
          let drained;
          do { drained = drainWork(id); changes += drained.changes; } while (drained.result);
          const result = receipt(z.object({ receipt_json: z.string() }).parse(database.prepare('SELECT receipt_json FROM workbook_operations WHERE workbook_id=? AND operation_id=?').get(id, operation.operationId)).receipt_json);
          if (result.state !== 'applied') throw new WorkbookLibraryError(result.reason === 'metadata-unsupported' ? 'WORKBOOK_METADATA_UNSUPPORTED' : 'WORKBOOK_INVALID');
          next = libraryState(id);
        };
        const selected = (versionId: string) => {
          const version = state.versions.find(version => version.id === versionId);
          if (version === undefined) throw new WorkbookLibraryError('WORKBOOK_REVISION_UNAVAILABLE');
          return version;
        };
        if (change.kind === 'create-version') {
          let version: number, snapshotId: string;
          if (change.from.kind === 'sharepoint') {
            const meta = metadata(id);
            if (sharePointWorkbook === undefined || meta.sharePoint === null) throw new WorkbookLibraryError('WORKBOOK_SYNC_LINK_REQUIRED');
            const mapped = applyMasterChange({ workbook: encodeSavedWorkbook(before).workbook, ownership: {}, version: before.version,
              type: type(meta.typeId), libraryId: id, sequence: 1,
              operation: { operationId: action.operationId, source: { kind: 'sync', syncId: action.operationId }, at,
                change: { kind: 'sync', expectedVersion: before.version, workbook: sharePointWorkbook } } });
            if (mapped.receipt.state !== 'applied') throw new WorkbookLibraryError('WORKBOOK_SYNC_LAYOUT_CHANGED');
            snapshotId = putLibrarySnapshot(id, action.operationId, mapped.workbook);
            changes++;
            version = before.version;
          } else if (change.from.kind === 'values') {
            const workbook = change.from.workbook;
            if (workbook.libraryId !== id || workbook.hasFormulas || workbook.unsupportedMetadata || Object.values(workbook.themes).length
              || workbook.sheets.some(sheet => sheet.rows.some(row => row.cells.some(cell => Object.keys(cell).some(key => key !== 'value'))))) throw new WorkbookLibraryError('WORKBOOK_INVALID');
            snapshotId = putLibrarySnapshot(id, action.operationId, workbook);
            version = before.version;
            changes++;
          } else {
            const source = selected(change.from.versionId);
            version = source.version;
            snapshotId = source.snapshotId;
          }
          if (change.useNow && snapshotId !== selected(state.selectedVersionId).snapshotId) {
            const snapshot = librarySnapshot(id, snapshotId);
            apply({ operationId: `library:${action.operationId}`, source: { kind: 'operator' }, at,
              change: { kind: 'save', expectedVersion: before.version, workbook: { ...snapshot.workbook, name: before.workbook.name } } });
            next.versions = [...state.versions];
          }
          next.versions.push({ id: action.operationId, snapshotId, name: change.name, version, savedAt: at,
            source: change.from.kind === 'sharepoint' ? 'sharepoint' : 'operator' });
          next.selectedVersionId = change.useNow ? action.operationId : state.selectedVersionId;
        } else if (change.kind === 'sync') {
          if (sharePointWorkbook === undefined || metadata(id).sharePoint === null) throw new WorkbookLibraryError('WORKBOOK_SYNC_LINK_REQUIRED');
          apply({ operationId: `library:${action.operationId}`, source: { kind: 'sync', syncId: action.operationId }, at,
            change: { kind: 'sync', expectedVersion: before.version, workbook: sharePointWorkbook } });
        } else if (change.kind === 'rename-version') {
          selected(change.versionId);
          next.versions = next.versions.map(version => version.id === change.versionId ? { ...version, name: change.name } : version);
        } else if (change.kind === 'delete-version') {
          const version = selected(change.versionId);
          if (state.selectedVersionId === version.id || inUse(id, at, version)) throw new WorkbookLibraryError('WORKBOOK_VERSION_IN_USE');
          next.versions = next.versions.filter(candidate => candidate.id !== version.id);
        } else if (change.kind === 'use-version') {
          const version = selected(change.versionId), snapshot = librarySnapshot(id, version.snapshotId);
          apply({ operationId: `library:${action.operationId}`, source: { kind: 'operator' }, at,
            change: { kind: 'save', expectedVersion: before.version, workbook: { ...snapshot.workbook, name: before.workbook.name } } });
          next.versions = [...state.versions];
          next.selectedVersionId = version.id;
        } else if (change.kind === 'rename') {
          apply({ operationId: `library:${action.operationId}`, source: { kind: 'operator' }, at,
            change: { kind: 'save', expectedVersion: before.version, workbook: encodeSavedWorkbook({ ...before, workbook: { ...before.workbook, name: change.name } }).workbook } });
        } else if (change.kind === 'metadata') {
          apply({ operationId: `library:${action.operationId}`, source: { kind: 'operator' }, at,
            change: { kind: 'metadata', expectedVersion: before.version, metadata: change.metadata } });
        } else if (change.kind === 'pin' || change.kind === 'unpin') {
          next.pinned = change.kind === 'pin';
        } else if (change.kind === 'set-tags') {
          next.tags = change.tags;
        } else if (change.kind === 'link' || change.kind === 'unlink') {
          apply({ operationId: `library:${action.operationId}`, source: { kind: 'operator' }, at,
            change: { kind: 'metadata', expectedVersion: before.version, metadata: { ...metadata(id), sharePoint: change.kind === 'unlink' ? null : { url: change.url, verifiedAt: at } } } });
        } else {
          if (inUse(id, at)) throw new WorkbookLibraryError('WORKBOOK_LIBRARY_IN_USE');
          next.removed = true;
          const workbookType = type(metadata(id).typeId);
          if (workbookType?.defaultWorkbookId === id) {
            database.prepare('UPDATE workbook_types SET payload_json=? WHERE id=?').run(canonicalJsonStringify({ ...workbookType, defaultWorkbookId: null }), workbookType.id);
            changes++;
          }
        }
        next.revision = state.revision + 1;
        putLibraryState(next);
        const result = WorkbookLibraryActionResultSchema.parse({ libraryId: id, action, at, result: next });
        database.prepare('INSERT INTO workbook_library_actions(id,workbook_id,operation_id,digest,payload_json) VALUES(?,?,?,?,?)')
          .run(JSON.stringify([id, action.operationId]), id, action.operationId, sha256Hex(canonicalJsonStringify(action)), canonicalJsonStringify(result));
        return { result, changes: changes + 2 };
      }));
    },
    create: (recordValue, origin = { kind: 'local' }) => storage(() => deps.mutate(() => {
      const record = SavedWorkbookSchema.parse(recordValue);
      if (record.version !== 1 || current(record.libraryId)) throw new WorkbookLibraryError('WORKBOOK_VERSION_CONFLICT');
      const json = serializeSavedWorkbook(record);
      database.prepare('INSERT INTO workbook_library(id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)').run(record.libraryId, record.version, record.createdAt, record.savedAt, json);
      database.prepare('INSERT INTO workbook_creations(id,payload_json) VALUES(?,?)').run(record.libraryId, json);
      const state = WorkbookLibraryStateSchema.parse({ libraryId: record.libraryId, revision: 1, selectedVersionId: 'original', removed: false, pinned: false, tags: [], origin,
        versions: [{ id: 'original', snapshotId: JSON.stringify([record.libraryId, 'original']), name: 'Original version', version: 1, savedAt: record.savedAt, source: 'import' }] });
      database.prepare('INSERT INTO workbook_library_state(id,payload_json) VALUES(?,?)').run(record.libraryId, canonicalJsonStringify(state));
      putLibrarySnapshot(record.libraryId, 'original', encodeSavedWorkbook(record).workbook);
      return { result: required(record.libraryId), changes: 4 };
    })),
    read: id => storage(() => deps.read(() => {
      const record = current(id);
      return record === undefined || libraryState(id).removed ? undefined : record;
    })),
    revision,
    creation: id => storage(() => deps.read(() => {
      const row = database.prepare('SELECT payload_json FROM workbook_creations WHERE id=?').get(id);
      return row === undefined ? undefined : stored(() => decodeSavedWorkbook(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json)));
    })),
    list: () => storage(() => deps.read(() => database.prepare('SELECT * FROM workbook_library ORDER BY saved_at DESC,id').all().map(fromRow).filter(record => !libraryState(record.libraryId).removed))),
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
      if (!record.fields.length) throw new WorkbookLibraryError('WORKBOOK_INVALID');
      const before = type(record.id);
      if (before && (before.keyFieldId !== record.keyFieldId || canonicalJsonStringify(before.fields) !== canonicalJsonStringify(record.fields))
        && (record.id === 'general' || database.prepare("SELECT 1 FROM workbook_operations WHERE json_extract(request_json,'$.change.metadata.typeId')=? LIMIT 1").get(record.id))) throw new WorkbookLibraryError('WORKBOOK_TYPE_IN_USE');
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
      if (libraryState(id).removed) throw new WorkbookLibraryError('WORKBOOK_NOT_FOUND');
      if ("mode" in request && request.expectedVersion !== record.version) throw new WorkbookLibraryError('WORKBOOK_VERSION_CONFLICT');
      if (metadata(id).typeId !== workbookType.id) throw new WorkbookLibraryError('WORKBOOK_INVALID');
      const selected = "versionId" in request ? libraryVersion(id, request.versionId) : undefined;
      const workbook = selected === undefined ? encodeSavedWorkbook(record).workbook : selected.workbook, keyField = workbookType.keyFieldId;
      const values = (sheet: typeof workbook.sheets[number], row: typeof workbook.sheets[number]["rows"][number]) =>
        Object.fromEntries(request.fields.map(field => {
          const indexes = sheet.columnBindings?.flatMap((binding, index) => binding.fieldId === field ? [index] : []) ?? [];
          if (indexes.length !== 1) throw new WorkbookLibraryError('WORKBOOK_INVALID');
          return [field, row.cells[indexes[0]].value];
        }));
      const schema = selected === undefined ? WorkbookReferenceSnapshotSchema : WorkbookNamedReferenceSnapshotSchema;
      const { fieldLabels: _labels, requiredFields: _required, ...referenceType } = workbookType;
      return deepFreeze(schema.parse({ libraryId: id, version: record.version, type: referenceType,
        ...(selected === undefined ? {} : { versionId: selected.version.id, versionName: selected.version.name }),
        worksheets: workbook.sheets.map(sheet => ({ sheetId: sheet.id, name: sheet.name })),
        rows: "mode" in request ? workbook.sheets.flatMap(sheet => sheet.rows.slice(sheet.headerRow ?? 1).map(row => ({
          key: `${sheet.id}#${row.id}`, state: "matched", matches: [{ sheetId: sheet.id, rowId: row.id, values: values(sheet, row) }],
        }))) : request.keys.map(key => {
          const matches = workbookMatches(workbook, keyField, key);
          return { key, state: matches.length === 0 ? 'missing' : matches.length === 1 ? 'matched' : 'ambiguous',
            matches: matches.map(({ sheetId, rowId, sheet, row }) => ({ sheetId, rowId,
              values: values(sheet, row) })) };
        }) }));
    })),
    enqueue, drain, operation,
    journal: id => storage(() => deps.read(() => { required(id); return database.prepare('SELECT receipt_json FROM workbook_operations WHERE workbook_id=? AND receipt_json IS NOT NULL ORDER BY sequence').all(id).map(row => receipt(row.receipt_json)); })),
    runOperations: runId => storage(() => deps.read(() => database.prepare("SELECT * FROM workbook_operations WHERE json_extract(request_json,'$.source.kind') IN ('run','run-reference') AND json_extract(request_json,'$.source.runId')=? ORDER BY sequence").all(runId)
      .map(raw => { const row = z.object({ workbook_id: z.string() }).parse(raw); return operationRecord(row.workbook_id, raw); }))),
  };
  return repository;
}

export function validateWorkbookLibrary(database: DatabaseSync, master = true, catalog = true, pinTags = true): number {
  if (!master) {
    const records = database.prepare('SELECT * FROM workbook_library').all().map(fromRow);
    return records.reduce((total, record) => {
      const history = database.prepare('SELECT workbook_id AS id,version,created_at,saved_at,payload_json FROM workbook_library_history WHERE workbook_id=? ORDER BY version').all(record.libraryId).map(fromRow);
      if (history.length !== record.version || history.some((entry, index) => entry.version !== index + 1) || serializeSavedWorkbook(history[history.length - 1]) !== serializeSavedWorkbook(record)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      return total + 1 + history.length;
    }, 0);
  }
  const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: () => { throw new Error('workbook-validation-read-only'); }, beforePinTags: !pinTags });
  let count = repository.types().length;
  const records = database.prepare('SELECT * FROM workbook_library ORDER BY id').all().map(fromRow);
  for (const record of records) {
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
    if (catalog) {
      const state = repository.libraryState(record.libraryId);
      const snapshots = database.prepare('SELECT id,workbook_id,payload_json FROM workbook_library_snapshots WHERE workbook_id=? ORDER BY id').all(record.libraryId);
      const ids = new Set<string>();
      for (const raw of snapshots) {
        const row = z.strictObject({ id: z.string(), workbook_id: z.string(), payload_json: z.string() }).parse(raw);
        const snapshot = WorkbookLibrarySnapshotSchema.parse(JSON.parse(row.payload_json));
        if (snapshot.id !== row.id || snapshot.libraryId !== row.workbook_id || snapshot.libraryId !== record.libraryId) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
        ids.add(snapshot.id);
      }
      if (state.versions.some(version => !ids.has(version.snapshotId))) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      count += snapshots.length;
      const actions = database.prepare('SELECT operation_id FROM workbook_library_actions WHERE workbook_id=? ORDER BY id').all(record.libraryId);
      for (const raw of actions) {
        const operationId = z.strictObject({ operation_id: z.string() }).parse(raw).operation_id;
        const action = repository.libraryActionRecord(record.libraryId, operationId);
        if (action === undefined || action.result.revision > state.revision) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      }
      count += 1 + actions.length;
    }
  }
  return count;
}
