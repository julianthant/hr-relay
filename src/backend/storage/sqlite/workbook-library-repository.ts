import { randomUUID } from "node:crypto";
import { WorkflowWorkbookSelectionInputSchema, WorkflowWorkbookSelectionRecordSchema, WorkbookLibraryStateSchema, WorkbookLibraryEntrySchema, WorkbookLibrarySnapshotSchema, WorkbookLibraryActionSchema, WorkbookLibraryActionRecordSchema, WorkbookLibraryActionResultSchema, WorkbookLibrarySyncRecordSchema, type WorkbookLibrarySyncRecord, type WorkbookLibraryState, type WorkbookLibraryActionRecord } from "../../../models/dashboard/workbook-library.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { applyMasterChange, WorkbookOwnershipSchema, workbookKey, workbookMatches, type WorkbookOwnership, type WorkbookReplayContext } from "../../workbooks/master-changes.js";
import { WorkbookSnapshotRequestSchema, WorkbookReferenceSnapshotSchema, WorkbookNamedReferenceSnapshotSchema, WorkbookTypeSchema, WorkbookMetadataSchema, WorkbookNamedVersionSchema, WorkbookOperationSchema, WorkbookOperationReceiptSchema, decodeEditableWorkbook } from "../../../models/dashboard/workbooks.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { WorkbookLibraryError } from "../../workbooks/workbook-library-error.js";
import { type WorkbookLibraryRepository } from "../../workbooks/workbook-library-service.js";
import { decodeSavedWorkbook, encodeSavedWorkbook, EditableWorkbookWireSchema, SavedWorkbookSchema, SavedWorkbookWireSchema, type EditableWorkbookWire, type SavedWorkbook, type WorkbookOperation, type WorkbookOperationReceipt, type WorkbookType } from "../../../models/dashboard/workbooks.js";
import { WorkbookOperationRecordSchema } from "../../../models/dashboard/workbooks.js";
import { IsoInstantSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import { changeLogTriggers } from "./authority-change-log.js";

const WorkbookDigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const WorkbookReferenceSchema = z.looseObject({ workbookDigest: WorkbookDigestSchema });
const WorkbookPayloadRowSchema = z.strictObject({ digest: WorkbookDigestSchema, payload_json: z.string() });
const WorkbookHoldRowsSchema = z.array(z.strictObject({
  library_id: z.string(), version_id: z.string().nullable(), revision: z.number().int().nullable(), whole_workbook: z.union([z.literal(0), z.literal(1)]),
}));
const workbookCacheCharacters = 32 * 1024 * 1024;
/** Stores one workbook once, as canonical JSON addressed by its sha256; returns the digest. */
function storeWorkbook(database: DatabaseSync, value: unknown): string {
  // Absent optionals are dropped as the stored JSON has always dropped them.
  const json = canonicalJsonStringify(JSON.parse(JSON.stringify(EditableWorkbookWireSchema.parse(value)))), digest = sha256Hex(json);
  database.prepare('INSERT INTO workbook_payloads(digest,payload_json) VALUES(?,?) ON CONFLICT(digest) DO NOTHING').run(digest, json);
  return digest;
}
/** A stored row's payload: the record it was written from, with its workbook stored once and named by digest. */
function payloadJson(database: DatabaseSync, record: Readonly<{ workbook: unknown }>): string {
  const { workbook, ...envelope } = record;
  return JSON.stringify({ ...envelope, workbookDigest: storeWorkbook(database, workbook) });
}
/** Reads a stored row's payload back into the record it was written from; the caller parses it strictly. */
function withWorkbook(database: DatabaseSync, json: string): Record<string, unknown> {
  const { workbookDigest, ...envelope } = WorkbookReferenceSchema.parse(JSON.parse(json));
  const row = database.prepare('SELECT payload_json FROM workbook_payloads WHERE digest=?').get(workbookDigest);
  if (row === undefined) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  return { ...envelope, workbook: JSON.parse(z.strictObject({ payload_json: z.string() }).parse(row).payload_json) };
}
const savedPayloadJson = (database: DatabaseSync, record: SavedWorkbook) => payloadJson(database, encodeSavedWorkbook(record));
/** Reads a stored row's payload into the record it was written from. */
type PayloadReader = (json: string) => Record<string, unknown>;
type SavedWorkbookReader = (json: string) => SavedWorkbook;
/** Before schema 38 each row embeds its workbook. */
const embeddedPayload: PayloadReader = json => z.record(z.string(), z.unknown()).parse(JSON.parse(json));

type KeyedWorkbookChange = Extract<WorkbookOperation['change'], { kind: 'patch' | 'add' }>;
type SettledWorkbookOperation = { operation: WorkbookOperation; settled: WorkbookOperationReceipt };
type WorkbookSheet = EditableWorkbookWire['sheets'][number];
type WorkbookRow = WorkbookSheet['rows'][number];
type CellEffect = WorkbookOperationReceipt['changes'][number];
type CellKey = (value: unknown) => string | undefined;
const literalKey: CellKey = value => typeof value === 'string' ? value : undefined;

function fieldColumns(sheet: WorkbookSheet, field: string) {
  return sheet.columnBindings?.flatMap((binding, index) => binding.fieldId === field ? [index] : []) ?? [];
}

function replayKeyedSettlement(workbook: EditableWorkbookWire, version: number, change: KeyedWorkbookChange,
  receipt: WorkbookOperationReceipt, type: Pick<WorkbookType, 'keyFieldId' | 'fields'> | undefined): EditableWorkbookWire {
  if (type === undefined || type.keyFieldId === null || Object.keys(change.values).length === 0
    || Object.keys(change.values).some(field => !type.fields.includes(field))) {
    throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  }
  const keyField = type.keyFieldId;
  const address = change.kind === 'add' ? change : change.selection ?? receipt.candidates[0];
  const sheetIndex = workbook.sheets.findIndex(sheet => sheet.id === address?.sheetId);
  const sheet = workbook.sheets[sheetIndex];
  if (address === undefined || sheet === undefined) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  const rowIndex = sheet.rows.findIndex(row => row.id === address.rowId);
  if (change.kind === 'add' ? rowIndex !== -1 || receipt.candidates.length !== 0
    : rowIndex < (sheet.headerRow ?? 1) || (change.selection === undefined ? receipt.candidates.length !== 1
      : change.selection.expectedVersion !== version || !receipt.candidates.some(candidate => candidate.sheetId === address.sheetId && candidate.rowId === address.rowId))) {
    throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  }
  const sourceRow = sheet.rows[rowIndex];
  const values = new Map(Object.entries(change.values));
  if (change.kind === 'add' && !values.has(keyField)) values.set(keyField, change.key);
  const hasRecordedKey = (value: unknown) => value === change.key || workbookKey(value) === change.key;
  if ((change.kind === 'patch' && !sheet.columnBindings?.some((binding, index) => binding.fieldId === keyField
    && hasRecordedKey(sourceRow.cells[index]?.value))) || (values.has(keyField) && !hasRecordedKey(values.get(keyField)))) {
    throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  }
  const cells: (typeof sourceRow)['cells'] = change.kind === 'add'
    ? Array.from({ length: sheet.width }, () => ({ value: null })) : [...sourceRow.cells];
  for (const effect of receipt.changes) {
    const indexes = fieldColumns(sheet, effect.fieldId);
    const cell = indexes.length === 1 ? cells[indexes[0]] : undefined;
    if (effect.sheetId !== address.sheetId || effect.rowId !== address.rowId || (effect.key !== undefined && effect.key !== change.key)
      || cell === undefined || !values.has(effect.fieldId)
      || canonicalJsonStringify(cell.value) !== canonicalJsonStringify(effect.oldValue)
      || canonicalJsonStringify(values.get(effect.fieldId)) !== canonicalJsonStringify(effect.newValue)) {
      throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    }
    const { richText: _richText, hyperlink: _hyperlink, tooltip: _tooltip, ...format } = cell;
    cells[indexes[0]] = { ...format, value: effect.newValue };
    values.delete(effect.fieldId);
  }
  if (values.size !== 0) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  const rows = [...sheet.rows];
  if (change.kind === 'add') rows.push({ id: address.rowId, cells });
  else rows[rowIndex] = { ...sourceRow, cells };
  const sheets = [...workbook.sheets];
  sheets[sheetIndex] = { ...sheet, rows };
  return { ...workbook, sheets };
}

function rowsByKey(workbook: EditableWorkbookWire, keyField: string, keyOf: CellKey) {
  const byKey = new Map<string, { sheet: WorkbookSheet; row: WorkbookRow }[]>();
  for (const sheet of workbook.sheets) {
    const columns = fieldColumns(sheet, keyField);
    for (const row of sheet.rows.slice(sheet.headerRow ?? 1)) {
      for (const key of new Set(columns.map(index => keyOf(row.cells[index].value)))) {
        if (key === undefined) continue;
        const matches = byKey.get(key);
        if (matches === undefined) byKey.set(key, [{ sheet, row }]);
        else matches.push({ sheet, row });
      }
    }
  }
  return byKey;
}

function workbookCells(workbook: EditableWorkbookWire, keyField: string | null, keyOf: CellKey) {
  const rows = keyField === null ? undefined : rowsByKey(workbook, keyField, keyOf);
  const cells = new Map<string, { sheetId: string; rowId: string; fieldId: string; key?: string; value: WorkbookRow['cells'][number]['value'] }>();
  for (const sheet of workbook.sheets) {
    const keyColumn = keyField === null ? undefined : fieldColumns(sheet, keyField)[0];
    sheet.rows.forEach((row, index) => {
      const key = keyColumn === undefined ? undefined : keyOf(row.cells[keyColumn].value);
      const uniqueKey = index >= (sheet.headerRow ?? 1) && key !== undefined && rows?.get(key)?.length === 1 ? key : undefined;
      row.cells.forEach((cell, column) => {
        const fieldId = sheet.columnBindings?.[column]?.fieldId ?? `column:${column}`;
        const address = uniqueKey === undefined ? ['row', sheet.id, row.id, fieldId] : ['key', uniqueKey, fieldId];
        cells.set(JSON.stringify(address), { sheetId: sheet.id, rowId: row.id, fieldId, ...(uniqueKey === undefined ? {} : { key: uniqueKey }), value: cell.value });
      });
    });
  }
  return cells;
}

function workbookCellEffects(before: EditableWorkbookWire, after: EditableWorkbookWire, keyField: string | null, keyOf: CellKey): CellEffect[] {
  const oldCells = workbookCells(before, keyField, keyOf), newCells = workbookCells(after, keyField, keyOf);
  return [...new Set([...oldCells.keys(), ...newCells.keys()])].flatMap(id => {
    const old = oldCells.get(id), next = newCells.get(id), location = next ?? old;
    const oldValue = old?.value ?? null, newValue = next?.value ?? null;
    if (location === undefined || canonicalJsonStringify(oldValue) === canonicalJsonStringify(newValue)) return [];
    const { value: _value, ...address } = location;
    return [{ ...address, oldValue, newValue }];
  });
}

function verifySnapshotEffects(workbook: EditableWorkbookWire, receipt: WorkbookOperationReceipt,
  keyField: string | null, previous: EditableWorkbookWire | undefined) {
  if (previous !== undefined) {
    const stable = (changes: readonly CellEffect[]) => canonicalJsonStringify(changes.map(({ key: _key, ...effect }) => effect));
    const expected = stable(receipt.changes);
    if (stable(workbookCellEffects(previous, workbook, keyField, workbookKey)) !== expected
      && (keyField === null || stable(workbookCellEffects(previous, workbook, keyField, literalKey)) !== expected)) {
      throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    }
    return;
  }

  // With no independent predecessor, the exact output still proves the recorded resulting values.
  const addressOf = ({ sheetId, rowId, fieldId }: CellEffect) => JSON.stringify(['row', sheetId, rowId, fieldId]);
  const cells = workbookCells(workbook, null, literalKey);
  const written = new Map<string, CellEffect>();
  for (const effect of receipt.changes) {
    if (effect.newValue === null) continue;
    const address = addressOf(effect), cell = cells.get(address);
    if (cell === undefined || written.has(address) || canonicalJsonStringify(cell.value) !== canonicalJsonStringify(effect.newValue)) {
      throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    }
    written.set(address, effect);
  }
  for (const effect of receipt.changes) {
    if (canonicalJsonStringify(effect.oldValue) === canonicalJsonStringify(effect.newValue)) {
      throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    }
    if (effect.newValue !== null) continue;
    const address = addressOf(effect), cell = cells.get(address), replacement = written.get(address);
    // A row or field that changed identity can emit a removal and a replacement at the same address.
    if (cell !== undefined && cell.value !== null && (replacement === undefined || replacement.key === effect.key)) {
      throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    }
  }
}

// Journal-only Sync predates catalogue snapshots. Its string-key result must prove the exact stored cell changes.
function replayLiteralKeySync(input: Parameters<typeof applyMasterChange>[0], settled: WorkbookOperationReceipt) {
  const keyField = input.type?.keyFieldId;
  if (keyField === undefined || keyField === null || input.type === undefined) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  const { workbook, receipt } = applyMasterChange({ ...input, ownership: {} });
  if (receipt.state !== 'applied') throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  const before = rowsByKey(input.workbook, keyField, literalKey), after = rowsByKey(workbook, keyField, literalKey);
  const ownership: WorkbookOwnership = {};
  for (const sheet of input.workbook.sheets) {
    const [keyColumn] = fieldColumns(sheet, keyField);
    for (const row of sheet.rows.slice(sheet.headerRow ?? 1)) {
      for (const field of input.type.fields) {
        const owner = input.ownership[JSON.stringify([sheet.id, row.id, field])];
        if (owner === undefined) continue;
        const key = row.cells[keyColumn]?.value;
        const matches = typeof key === 'string' && before.get(key)?.length === 1 ? after.get(key) : undefined;
        const sourceColumns = fieldColumns(sheet, field);
        if (matches?.length !== 1 || sourceColumns.length !== 1) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
        const target = matches[0], targetColumns = fieldColumns(target.sheet, field);
        const cell = row.cells[sourceColumns[0]];
        if (targetColumns.length > 1 || owner.owner === 'relay' && canonicalJsonStringify(owner.value) !== canonicalJsonStringify(cell.value)) {
          throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
        }
        if (targetColumns.length === 0) {
          const binding = sheet.columnBindings?.[sourceColumns[0]];
          if (binding === undefined || target.sheet.columnBindings === undefined) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
          targetColumns.push(target.sheet.width++);
          target.sheet.columnBindings.push(binding);
          target.sheet.rows.forEach((item, index) => item.cells.push({ value: index === (target.sheet.headerRow ?? 1) - 1 ? binding.sourceHeader : null }));
        }
        const targetCell = target.row.cells[targetColumns[0]];
        const { richText: _richText, hyperlink: _hyperlink, tooltip: _tooltip, ...format } = targetCell;
        target.row.cells[targetColumns[0]] = { ...format, ...cell };
        ownership[JSON.stringify([target.sheet.id, target.row.id, field])] = owner;
      }
    }
  }
  const changes = workbookCellEffects(input.workbook, workbook, keyField, literalKey);
  if (settled.candidates.length !== 0 || canonicalJsonStringify(changes) !== canonicalJsonStringify(settled.changes)) {
    throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  }
  return { workbook, ownership };
}

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

export const WORKBOOK_MASTER_MIGRATION = Object.freeze({ version: 13, statements: [
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
/** Schema 30: every library state and recorded action result starts unpinned with no manual tags; a stored pin or tag is not schema-29 data and refuses the upgrade. */
export const WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION = Object.freeze({ version: 30, statements: Object.freeze([
  `CREATE TABLE workbook_pin_tags_upgrade_guard (refused INTEGER CONSTRAINT workbook_pin_tags_already_stored CHECK(refused=0)) STRICT`,
  `INSERT INTO workbook_pin_tags_upgrade_guard SELECT 1 FROM workbook_library_state
    WHERE json_type(payload_json,'$.pinned') IS NOT NULL OR json_type(payload_json,'$.tags') IS NOT NULL LIMIT 1`,
  `INSERT INTO workbook_pin_tags_upgrade_guard SELECT 1 FROM workbook_library_actions
    WHERE json_type(payload_json,'$.result.pinned') IS NOT NULL OR json_type(payload_json,'$.result.tags') IS NOT NULL LIMIT 1`,
  'DROP TABLE workbook_pin_tags_upgrade_guard',
  `UPDATE workbook_library_state SET payload_json=json_set(payload_json,'$.pinned',json('false'),'$.tags',json('[]'))`,
  'DROP TRIGGER workbook_library_actions_update',
  `UPDATE workbook_library_actions SET payload_json=json_set(payload_json,'$.result.pinned',json('false'),'$.result.tags',json('[]'))`,
  ACTION_UPDATE_GUARD,
]) });

/** Schema 36: each library state row keeps its last finished SharePoint sync; no earlier sync result was recorded, so every row starts empty. */
export const WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION = Object.freeze({ version: 36, statements: Object.freeze([
  `ALTER TABLE workbook_library_state ADD COLUMN sync_json TEXT CHECK(sync_json IS NULL OR json_valid(sync_json))`,
]) });

export const WORKBOOK_VERSION_NAMES_CONVERSION_ID = 'workbook-version-names:v1';
export const WORKBOOK_VERSION_NAMES_MIGRATION = Object.freeze({ version: 48, statements: Object.freeze([
  `SELECT '${WORKBOOK_VERSION_NAMES_CONVERSION_ID}'`,
]) });

function versionNames(versions: WorkbookLibraryState['versions']): Set<string> {
  return new Set(versions.map(version => version.name.trim()));
}

function availableVersionName(name: string, names: ReadonlySet<string>): string {
  const base = name.trim();
  if (!names.has(base)) return name;
  let suffix = 2;
  while (names.has(`${base} (${suffix})`)) suffix++;
  return `${base} (${suffix})`;
}

export function migrateWorkbookVersionNames(database: DatabaseSync): void {
  const update = database.prepare('UPDATE workbook_library_state SET payload_json=? WHERE id=?');
  const Row = z.strictObject({ id: z.string(), payload_json: z.string() });
  for (const raw of database.prepare('SELECT id,payload_json FROM workbook_library_state ORDER BY id').all()) {
    const row = Row.parse(raw), state = WorkbookLibraryStateSchema.parse(JSON.parse(row.payload_json));
    const reserved = versionNames(state.versions);
    if (reserved.size === state.versions.length) continue;
    const seen = new Set<string>();
    for (const version of state.versions) {
      const name = version.name.trim();
      if (seen.has(name)) {
        version.name = availableVersionName(name, reserved);
        reserved.add(version.name);
      }
      seen.add(name);
    }
    update.run(canonicalJsonStringify(state), row.id);
  }
}

/**
 * Before schema 13 each library row has one history row for every version 1 to its own, and the latest is the live record.
 * Migration 13 builds the creation record and named versions from that history, so a gap or a differing latest record refuses the upgrade first.
 */
export function assertPreMasterWorkbookHistory(database: DatabaseSync): void {
  const saved = (value: unknown) => stored(() => {
    const row = RowSchema.parse(value), record = decodeSavedWorkbook(SavedWorkbookWireSchema.parse(JSON.parse(row.payload_json)));
    if (record.libraryId !== row.id || record.version !== row.version || record.createdAt !== row.created_at || record.savedAt !== row.saved_at) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    return record;
  });
  const serialized = (record: SavedWorkbook) => JSON.stringify(encodeSavedWorkbook(record));
  for (const raw of database.prepare('SELECT id,version,created_at,saved_at,payload_json FROM workbook_library ORDER BY id').all()) {
    const record = saved(raw);
    const history = database.prepare('SELECT workbook_id AS id,version,created_at,saved_at,payload_json FROM workbook_library_history WHERE workbook_id=? ORDER BY version').all(record.libraryId).map(saved);
    const latest = history.at(-1);
    if (latest === undefined || history.length !== record.version || history.some((entry, index) => entry.version !== index + 1) || serialized(latest) !== serialized(record)) {
      throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    }
  }
}

/** The tables whose payload names a stored workbook by digest, with the strict schema each stored before schema 38. */
const PAYLOAD_TABLES = Object.freeze([
  { table: 'workbook_library', schema: SavedWorkbookWireSchema },
  { table: 'workbook_creations', schema: SavedWorkbookWireSchema },
  { table: 'workbook_library_history', schema: SavedWorkbookWireSchema },
  { table: 'workbook_library_snapshots', schema: WorkbookLibrarySnapshotSchema },
] as const);
/** The guards that refuse rewriting retained evidence; migration 38 drops them while it moves each workbook out and recreates them unchanged. */
const RETAINED_UPDATE_GUARDS = ['workbook_creations_immutable', 'workbook_library_history_immutable', 'workbook_library_snapshots_update'].map(name => {
  const statement = [...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements].find(candidate => candidate.startsWith(`CREATE TRIGGER ${name} `));
  if (statement === undefined) throw new Error(`workbook-retained-guard-missing:${name}`);
  return { name, statement };
});
export const WORKBOOK_PAYLOAD_CONVERSION_ID = 'workbook-payload-forward-conversion:v1';
/**
 * Schema 38: each distinct workbook is stored once in workbook_payloads as canonical JSON addressed by its sha256. The library,
 * its creation record, its named versions and its snapshots keep their payload without the workbook and name it by `workbookDigest`.
 */
/** The payload table with its guards: a payload is never rewritten, and never removed while a row still names it. */
export const WORKBOOK_PAYLOAD_TABLE = deepFreeze({ statements: [
  `CREATE TABLE workbook_payloads (digest TEXT PRIMARY KEY CHECK(length(digest)=64), payload_json TEXT NOT NULL CHECK(json_valid(payload_json))) STRICT`,
  `CREATE TRIGGER workbook_payloads_immutable BEFORE UPDATE ON workbook_payloads BEGIN SELECT RAISE(ABORT,'workbook-evidence-immutable'); END`,
  `CREATE TRIGGER workbook_payloads_retained BEFORE DELETE ON workbook_payloads WHEN ${PAYLOAD_TABLES.map(({ table }) =>
    `EXISTS(SELECT 1 FROM ${table} WHERE json_extract(payload_json,'$.workbookDigest')=OLD.digest)`).join(' OR ')} BEGIN SELECT RAISE(ABORT,'workbook-payload-referenced'); END`,
] });
export const WORKBOOK_PAYLOAD_MIGRATION = deepFreeze({ version: 38, statements: [
  ...WORKBOOK_PAYLOAD_TABLE.statements,
  ...changeLogTriggers('workbook_payloads'),
  ...RETAINED_UPDATE_GUARDS.map(({ name }) => `DROP TRIGGER ${name}`),
  `SELECT '${WORKBOOK_PAYLOAD_CONVERSION_ID}'`,
  ...RETAINED_UPDATE_GUARDS.map(({ statement }) => statement),
] });
/** The forward conversion inside migration 38: every stored workbook row is parsed strictly, its workbook stored once, and its payload rewritten. */
export function migrateWorkbookPayloads(database: DatabaseSync): void {
  for (const { table, schema } of PAYLOAD_TABLES) {
    for (const raw of database.prepare(`SELECT rowid AS row_id,payload_json FROM ${table} ORDER BY rowid`).all()) {
      const row = z.strictObject({ row_id: z.number().int(), payload_json: z.string() }).parse(raw);
      const record = schema.parse(JSON.parse(row.payload_json));
      database.prepare(`UPDATE ${table} SET payload_json=? WHERE rowid=?`).run(payloadJson(database, record), row.row_id);
    }
  }
}

const RowSchema = z.object({ id: z.string(), version: z.number().int().positive(), created_at: z.string(), saved_at: z.string(), payload_json: z.string() });
const SnapshotRowSchema = z.strictObject({ id: z.string(), workbook_id: z.string(), payload_json: z.string() });
function selectionFromRow(value: unknown) {
  const row = z.object({ workflow_id: z.string(), revision: z.number(), accepted_command_id: z.string(), used_at: z.string(), payload_json: z.string() }).parse(value);
  const record = WorkflowWorkbookSelectionRecordSchema.parse(JSON.parse(row.payload_json));
  const columns = { workflow_id: record.workflowId, revision: record.revision, accepted_command_id: record.acceptedCommandId, used_at: record.usedAt };
  for (const [column, expected] of Object.entries(columns)) if (row[column as keyof typeof columns] !== expected) throw new Error(`workflow_workbook_selections-row-${column}-mismatch`);
  return record;
}
function fromRow(read: SavedWorkbookReader, value: unknown): SavedWorkbook {
  try {
    const row = RowSchema.parse(value), record = read(row.payload_json);
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

/** Today's workbook operation queue. A null receipt_json is queued. */
export type WorkbookOperationState = 'queued' | z.infer<typeof WorkbookOperationReceiptSchema>['state'];
type WorkbookOperationPhase = 'absent' | WorkbookOperationState;
type WorkbookOperationEvent = 'enqueue-same' | 'enqueue-other' | 'settle' | 'bind-resolution';
type WorkbookOperationCell = 'queued' | 'replay' | 'replay-with-receipt' | 'operation-conflict' | 'not-queued' | 'receipt' | 'already-settled' | 'admitted';
const WORKBOOK_OPERATION_TRANSITIONS = deepFreeze({
  absent: { 'enqueue-same': 'queued', 'enqueue-other': 'queued', settle: 'not-queued', 'bind-resolution': 'operation-conflict' },
  queued: { 'enqueue-same': 'replay', 'enqueue-other': 'operation-conflict', settle: 'receipt', 'bind-resolution': 'operation-conflict' },
  applied: { 'enqueue-same': 'replay-with-receipt', 'enqueue-other': 'operation-conflict', settle: 'already-settled', 'bind-resolution': 'operation-conflict' },
  refused: { 'enqueue-same': 'replay-with-receipt', 'enqueue-other': 'operation-conflict', settle: 'already-settled', 'bind-resolution': 'operation-conflict' },
  'resolve-required': { 'enqueue-same': 'replay-with-receipt', 'enqueue-other': 'operation-conflict', settle: 'already-settled', 'bind-resolution': 'admitted' },
} as const satisfies Record<WorkbookOperationPhase, Record<WorkbookOperationEvent, WorkbookOperationCell>>);
function transitionWorkbookOperation(phase: WorkbookOperationPhase, event: WorkbookOperationEvent): WorkbookOperationCell {
  return WORKBOOK_OPERATION_TRANSITIONS[phase][event];
}
for (const phase of ['absent', 'queued', 'applied', 'resolve-required', 'refused'] as const) {
  if (WORKBOOK_OPERATION_TRANSITIONS[phase] === undefined) throw new Error(`workbook-operation-table-incomplete:${phase}`);
}

/** A stored row's JSON characters, counting the workbook payload its digest names. */
function storedCharacters(database: DatabaseSync, json: string): number {
  const { workbookDigest } = WorkbookReferenceSchema.parse(JSON.parse(json));
  const row = z.strictObject({ size: z.number().int() }).parse(database.prepare('SELECT length(payload_json) AS size FROM workbook_payloads WHERE digest=?').get(workbookDigest));
  return json.length + row.size;
}
/** Least recently used entries, kept while their stored JSON totals at most `limit` characters. */
function storedSizeCache<Value extends Readonly<{ characters: number }>>(limit: number) {
  const entries = new Map<string, Value>();
  let size = 0;
  const drop = (key: string) => {
    const value = entries.get(key);
    if (value === undefined) return;
    entries.delete(key);
    size -= value.characters;
  };
  return {
    get(key: string) {
      const value = entries.get(key);
      if (value !== undefined) { entries.delete(key); entries.set(key, value); }
      return value;
    },
    set(key: string, value: Value) {
      drop(key);
      entries.set(key, value);
      size += value.characters;
      for (const oldest of entries.keys()) { if (size <= limit) break; drop(oldest); }
    },
  };
}

type WorkbookLibraryRepositoryDeps = Readonly<{
  database: DatabaseSync;
  mutate<T>(work: () => Readonly<{ result: T; changes: number }>): T;
  read<T>(work: () => T): T;
  changeKey?(): Readonly<{ authorityGeneration: number; dataVersion: number; totalChanges: number }> | undefined;
  /** Stored JSON characters each decode cache keeps across change keys; 32 MiB by default. */
  decodedCacheCharacters?: number;
  /** Reads a store from before schema 30, whose states carry no pin or tags yet. */
  beforePinTags?: boolean;
  /** Reads a store from before schema 38, whose rows embed their workbooks. */
  embeddedWorkbooks?: boolean;
}>;

export function createWorkbookLibraryRepository(deps: WorkbookLibraryRepositoryDeps): WorkbookLibraryRepository {
  return workbookLibraryRepository(deps);
}

function workbookLibraryRepository(deps: WorkbookLibraryRepositoryDeps, inspectedSaved?: SavedWorkbookReader): WorkbookLibraryRepository {
  const { database } = deps;
  const payload: PayloadReader = deps.embeddedWorkbooks === true ? embeddedPayload : json => withWorkbook(database, json);
  const readSaved: SavedWorkbookReader = inspectedSaved ?? (json => decodeSavedWorkbook(payload(json)));
  const withPinTags = (state: unknown) => {
    if (deps.beforePinTags !== true) return state;
    // A predecessor state is strict: a pin or tags already present is not schema-29 data.
    if (typeof state !== 'object' || state === null || 'pinned' in state || 'tags' in state) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    return { ...state, pinned: false, tags: [] };
  };
  const decodedCacheCharacters = deps.decodedCacheCharacters ?? workbookCacheCharacters;
  const decodedRecords = storedSizeCache<{ row: z.infer<typeof RowSchema>; record: SavedWorkbook; characters: number }>(decodedCacheCharacters);
  const decodedSnapshots = storedSizeCache<{ row: z.infer<typeof SnapshotRowSchema>; snapshot: z.infer<typeof WorkbookLibrarySnapshotSchema>; characters: number }>(decodedCacheCharacters);
  let cache: {
    key: string;
    records: Map<string, SavedWorkbook>;
    snapshots: Map<string, z.infer<typeof WorkbookLibrarySnapshotSchema>>;
    list?: readonly SavedWorkbook[];
    catalog?: readonly z.infer<typeof WorkbookLibraryEntrySchema>[];
  } | undefined;
  const readCache = () => {
    const change = deps.changeKey?.();
    if (change === undefined) return undefined;
    const key = `${change.authorityGeneration}:${change.dataVersion}:${change.totalChanges}`;
    if (cache?.key !== key) cache = { key, records: new Map(), snapshots: new Map() };
    return cache;
  };
  const cachedFromRow = (value: unknown) => stored(() => {
    const entry = readCache(), row = RowSchema.parse(value);
    const cached = entry?.records.get(row.id);
    if (cached !== undefined) return cached;
    const previous = decodedRecords.get(row.id);
    if (entry !== undefined && previous !== undefined && row.id === previous.row.id && row.version === previous.row.version
      && row.created_at === previous.row.created_at && row.saved_at === previous.row.saved_at && row.payload_json === previous.row.payload_json) {
      entry.records.set(row.id, previous.record);
      return previous.record;
    }
    const record = fromRow(readSaved, row);
    if (entry === undefined) return record;
    // Frozen Dates still have setters; each cell read gets its own Date.
    const frozen = deepFreeze({ ...record, workbook: { ...record.workbook,
      sheets: record.workbook.sheets.map(sheet => ({ ...sheet, rows: sheet.rows.map(row => ({ ...row,
        cells: row.cells.map(cell => {
          const value = cell.value;
          if (!(value instanceof Date)) return cell;
          const time = value.getTime();
          return { ...cell, get value() { return Object.freeze(new Date(time)); } };
        }),
      })) })),
    } });
    entry.records.set(row.id, frozen);
    decodedRecords.set(row.id, { row, record: frozen, characters: storedCharacters(database, row.payload_json) });
    return frozen;
  });
  const lastUsed = (workflowId: string) => stored(() => {
    const id = WorkflowIdSchema.parse(workflowId);
    const row = database.prepare('SELECT * FROM workflow_workbook_selections WHERE workflow_id=?').get(id);
    return row === undefined ? undefined : selectionFromRow(row);
  });
  const current = (id: string) => {
    const cached = readCache()?.records.get(id);
    if (cached !== undefined) return cached;
    const row = database.prepare('SELECT * FROM workbook_library WHERE id=?').get(id);
    return row === undefined ? undefined : cachedFromRow(row);
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
  const listCurrent = () => {
    const cached = readCache();
    if (cached?.list !== undefined) return cached.list;
    const records = database.prepare('SELECT * FROM workbook_library ORDER BY saved_at DESC,id').all().map(cachedFromRow).filter(record => !libraryState(record.libraryId).removed);
    if (cached === undefined) return records;
    cached.list = Object.freeze(records);
    return cached.list;
  };
  const lastSync = (id: string): WorkbookLibrarySyncRecord | undefined => stored(() => {
    const row = z.strictObject({ sync_json: z.string().nullable() }).parse(database.prepare('SELECT sync_json FROM workbook_library_state WHERE id=?').get(id));
    return row.sync_json === null ? undefined : WorkbookLibrarySyncRecordSchema.parse(JSON.parse(row.sync_json));
  });
  const putLibraryState = (state: WorkbookLibraryState) => {
    const value = WorkbookLibraryStateSchema.parse(state);
    if (database.prepare('UPDATE workbook_library_state SET payload_json=? WHERE id=?').run(canonicalJsonStringify(value), value.libraryId).changes !== 1) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  };
  const librarySnapshot = (id: string, snapshotId: string, cacheSnapshot = true) => stored(() => {
    const entry = cacheSnapshot ? readCache() : undefined, cached = entry?.snapshots.get(snapshotId);
    if (cached !== undefined) {
      if (cached.libraryId !== id) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      return cached;
    }
    const row = SnapshotRowSchema.parse(database.prepare('SELECT id,workbook_id,payload_json FROM workbook_library_snapshots WHERE id=?').get(snapshotId));
    const previous = entry === undefined ? undefined : decodedSnapshots.get(id);
    const snapshot = previous !== undefined && row.id === previous.row.id && row.workbook_id === previous.row.workbook_id && row.payload_json === previous.row.payload_json
      ? previous.snapshot : WorkbookLibrarySnapshotSchema.parse(payload(row.payload_json));
    if (row.id !== snapshot.id || row.workbook_id !== id || snapshot.libraryId !== id) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    if (entry === undefined) return snapshot;
    const frozen = deepFreeze(snapshot);
    entry.snapshots.set(snapshotId, frozen);
    decodedSnapshots.set(id, { row, snapshot: frozen, characters: storedCharacters(database, row.payload_json) });
    return frozen;
  });
  const putLibrarySnapshot = (id: string, versionId: string, workbook: z.infer<typeof WorkbookLibrarySnapshotSchema>["workbook"]) => {
    const snapshotId = JSON.stringify([id, versionId]);
    const snapshot = WorkbookLibrarySnapshotSchema.parse({ id: snapshotId, libraryId: id, workbook });
    database.prepare('INSERT INTO workbook_library_snapshots(id,workbook_id,payload_json) VALUES(?,?,?)').run(snapshotId, id, payloadJson(database, snapshot));
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
  const phaseOf = (row: { receipt_json: string | null }): WorkbookOperationPhase => row.receipt_json === null ? 'queued' : receipt(row.receipt_json).state;
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
      const cell = transitionWorkbookOperation(phaseOf(row), row.digest === digest ? 'enqueue-same' : 'enqueue-other');
      if (cell === 'operation-conflict') throw new WorkbookLibraryError('WORKBOOK_OPERATION_CONFLICT');
      if (cell === 'replay' || cell === 'replay-with-receipt') return { result: row.sequence, changes: 0 };
      throw new Error(`workbook-operation-enqueue-${cell}`);
    }
    if (operation.change.kind === 'patch' && operation.change.resolves !== undefined) {
      const binding = operation.change.resolves;
      const raw = database.prepare('SELECT * FROM workbook_operations WHERE workbook_id=? AND operation_id=?').get(id, binding.operationId);
      const phase = raw === undefined ? 'absent' : phaseOf(queueRow.parse(raw));
      const cell = transitionWorkbookOperation(phase, 'bind-resolution');
      if (cell === 'operation-conflict') throw new WorkbookLibraryError('WORKBOOK_OPERATION_CONFLICT');
      if (cell !== 'admitted') throw new Error(`workbook-operation-bind-${cell}`);
      const original = operationRecord(id, raw);
      if ((operation.source.kind !== 'run' && operation.source.kind !== 'run-reference')
        || original.operation.change.kind !== 'patch' && original.operation.change.kind !== 'add'
        || canonicalJsonStringify(original.operation.source) !== canonicalJsonStringify(operation.source)
        || original.operation.change.key !== operation.change.key
        || canonicalJsonStringify(original.operation.change.values) !== canonicalJsonStringify(operation.change.values)
        || sha256Hex(canonicalJsonStringify(original.receipt)) !== binding.receiptDigest
        || operation.change.selection === undefined || operation.change.expectedVersion !== operation.change.selection.expectedVersion
        || database.prepare("SELECT 1 FROM workbook_operations WHERE workbook_id=? AND json_extract(request_json,'$.change.resolves.operationId')=? AND json_extract(receipt_json,'$.state')='applied'").get(id, binding.operationId) !== undefined) {
        throw new WorkbookLibraryError('WORKBOOK_OPERATION_CONFLICT');
      }
    } else if (transitionWorkbookOperation('absent', 'enqueue-same') !== 'queued') throw new Error('workbook-operation-enqueue-refused');
    const inserted = database.prepare('INSERT INTO workbook_operations(workbook_id,operation_id,digest,request_json) VALUES(?,?,?,?)').run(id, operation.operationId, digest, json);
    return { result: Number(inserted.lastInsertRowid), changes: 1 };
  };
  const enqueue = (id: string, value: unknown) => storage(() => deps.mutate(() => enqueueWork(id, value)));
  const drainWork = (id: string) => {
    let changes = 0;
    const queued = database.prepare('SELECT * FROM workbook_operations WHERE workbook_id=? AND receipt_json IS NULL ORDER BY sequence LIMIT 1').all(id).map(row => queueRow.parse(row));
    if (queued.length === 0) {
      const sample = database.prepare('SELECT receipt_json FROM workbook_operations WHERE workbook_id=? LIMIT 1').get(id);
      const phase = sample === undefined ? 'absent' : phaseOf(z.object({ receipt_json: z.string().nullable() }).parse(sample));
      const cell = transitionWorkbookOperation(phase, 'settle');
      if (cell === 'not-queued' || cell === 'already-settled') return { result: false, changes: 0 };
      throw new Error(`workbook-operation-settle-${cell}`);
    }
    for (const row of queued) {
      if (transitionWorkbookOperation('queued', 'settle') !== 'receipt') throw new Error('workbook-operation-settle-refused');
      const operation = WorkbookOperationSchema.parse(JSON.parse(row.request_json));
      if (sha256Hex(canonicalJsonStringify(JSON.parse(JSON.stringify(operation)))) !== row.digest) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      const before = required(id), meta = metadata(id);
      const owners = WorkbookOwnershipSchema.parse(JSON.parse(z.object({ ownership_json: z.string() }).parse(database.prepare('SELECT ownership_json FROM workbook_library WHERE id=?').get(id)).ownership_json));
      const context = operation.change.kind === 'sync' ? reconstructVersion(id, before.version, before) : undefined;
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
            database.prepare('INSERT INTO workbook_library_history(workbook_id,name,provenance,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?,?,?)').run(id, operation.change.name, 'operator', before.version, before.createdAt, before.savedAt, savedPayloadJson(database, before)); changes++;
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
            database.prepare('UPDATE workbook_library SET version=?,saved_at=?,payload_json=?,metadata_json=?,ownership_json=? WHERE id=?').run(updated.version, updated.savedAt, savedPayloadJson(database, updated), canonicalJsonStringify(nextMeta), canonicalJsonStringify(applied.ownership), id); changes++;
            const state = libraryState(id);
            if (state.removed) throw new WorkbookLibraryError('WORKBOOK_NOT_FOUND');
            const versionId = `revision:${updated.version}`;
            const snapshotId = operation.change.kind === 'metadata' ? undefined : putLibrarySnapshot(id, versionId, encodeSavedWorkbook(updated).workbook);
            if (snapshotId !== undefined) changes++;
            putLibraryState({ ...state, revision: state.revision + 1,
              ...(snapshotId === undefined ? {} : { selectedVersionId: versionId,
                versions: [...state.versions, { id: versionId, snapshotId,
                  name: availableVersionName(operation.source.kind === 'sync' ? 'Synced from SharePoint' : `Saved revision ${updated.version}`, versionNames(state.versions)),
                  version: updated.version, savedAt: updated.savedAt, source: operation.source.kind === 'sync' ? 'sharepoint' : operation.source.kind === 'run' || operation.source.kind === 'run-reference' ? 'workflow' : 'operator' }] }) });
            changes++;
          }
        }
      }
      const settled = database.prepare('UPDATE workbook_operations SET receipt_json=? WHERE sequence=? AND receipt_json IS NULL').run(canonicalJsonStringify(WorkbookOperationReceiptSchema.parse(result)), row.sequence);
      if (settled.changes !== 1) throw new Error('workbook-operation-settle-raced');
      changes++;
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
  const revisionBaseline = (id: string, version: number, live: SavedWorkbook) => {
    const creationRow = database.prepare('SELECT payload_json FROM workbook_creations WHERE id=?').get(id);
    const creation = decodeSavedWorkbook(payload(z.object({ payload_json: z.string() }).parse(creationRow).payload_json));
    if (creation.libraryId !== id || creation.version !== 1 || creation.createdAt !== live.createdAt) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    const migration = database.prepare("SELECT * FROM workbook_library_history WHERE workbook_id=? AND provenance='migration' AND version<=? ORDER BY version DESC LIMIT 1").get(id, version);
    const baseline = migration === undefined ? creation : fromRow(readSaved, { ...migration, id });
    if (baseline.createdAt !== live.createdAt) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    return baseline;
  };
  const readSettlement = (id: string, raw: unknown): SettledWorkbookOperation | undefined => {
    const row = queueRow.parse(raw), operation = WorkbookOperationSchema.parse(JSON.parse(row.request_json));
    if (operation.operationId !== row.operation_id || sha256Hex(canonicalJsonStringify(JSON.parse(JSON.stringify(operation)))) !== row.digest) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    if (row.receipt_json === null) return undefined;
    const settled = receipt(row.receipt_json);
    if (settled.libraryId !== id || settled.operationId !== operation.operationId || settled.sequence !== row.sequence
      || settled.at !== operation.at || canonicalJsonStringify(settled.source) !== canonicalJsonStringify(operation.source)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    return { operation, settled };
  };
  function* settledOperations(id: string, after = 0, through: number | null = null) {
    // Sorting the journal sequence can retain only row IDs, even when SQLite uses a temporary sort.
    const coordinates = database.prepare('SELECT sequence FROM workbook_operations WHERE workbook_id=? AND sequence>? AND (? IS NULL OR sequence<=?) ORDER BY sequence');
    const operationRow = database.prepare('SELECT * FROM workbook_operations WHERE workbook_id=? AND sequence=?');
    for (const { sequence } of coordinates.iterate(id, after, through, through)) {
      const entry = readSettlement(id, operationRow.get(id, z.number().parse(sequence)));
      if (entry === undefined) break;
      yield entry;
    }
  }
  const reconstructVersion = (id: string, version: number, live: SavedWorkbook) => {
    let record = encodeSavedWorkbook(revisionBaseline(id, version, live)), ownership = WorkbookOwnershipSchema.parse({}), typeId = 'general';
    const context: WorkbookReplayContext = { witnesses: [], captured: false };
    if (record.version === version && version !== live.version) return { record: decodeSavedWorkbook(record), ownership, typeId, context };
    for (const { operation, settled } of settledOperations(id)) {
      if (settled.state !== 'applied') {
        if (settled.version !== record.version) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
        continue;
      }
      const workbookType = operation.source.kind === 'run-reference' ? undefined : type(typeId);
      if ((operation.source.kind !== 'run-reference' && !workbookType) || Date.parse(operation.at) < Date.parse(record.savedAt)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      const applied = applyMasterChange({ workbook: record.workbook, ownership, version: record.version, type: workbookType,
        operation, libraryId: id, sequence: settled.sequence, context });
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
  const retainedRevisionWorkbook = (id: string, version: number, savedAt: string, createdAt: string) => {
    const snapshotId = JSON.stringify([id, `revision:${version}`]);
    if (database.prepare('SELECT 1 FROM workbook_library_snapshots WHERE id=?').get(snapshotId) !== undefined) {
      return librarySnapshot(id, snapshotId, false).workbook;
    }
    const migration = libraryState(id).versions.find(entry => entry.id === 'current' && entry.version === version);
    if (migration !== undefined) {
      if (migration.snapshotId !== JSON.stringify([id, 'current']) || migration.source !== 'retained' || migration.savedAt !== savedAt) {
        throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      }
      return librarySnapshot(id, migration.snapshotId, false).workbook;
    }
    const named = database.prepare('SELECT * FROM workbook_library_history WHERE workbook_id=? AND version=? ORDER BY name LIMIT 1').get(id, version);
    if (named === undefined) return undefined;
    const proof = fromRow(readSaved, { ...named, id });
    if (proof.createdAt !== createdAt || proof.savedAt !== savedAt) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    return encodeSavedWorkbook(proof).workbook;
  };
  type RevisionStep = SettledWorkbookOperation & { typeId: string };
  type ContentPosition = { kind: 'save' | 'sync' | 'patch' | 'add'; sequence: number; version: number; at: string };
  const settlementAt = (id: string, position: ContentPosition) => {
    const row = database.prepare('SELECT * FROM workbook_operations WHERE workbook_id=? AND sequence=?').get(id, position.sequence);
    const entry = readSettlement(id, row);
    if (entry === undefined || entry.operation.change.kind !== position.kind || entry.settled.state !== 'applied'
      || entry.settled.version !== position.version || entry.settled.at !== position.at) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    return entry;
  };
  const independentPredecessor = (baseline: SavedWorkbook, position: ContentPosition | undefined) => {
    if (position === undefined) return encodeSavedWorkbook(baseline).workbook;
    const id = baseline.libraryId;
    const retained = retainedRevisionWorkbook(id, position.version, position.at, baseline.createdAt);
    if (retained !== undefined || position.kind !== 'save') return retained;
    const { operation: { change } } = settlementAt(id, position);
    if (change.kind !== 'save') throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    return change.workbook;
  };
  const keyedAuthority = ({ operation, typeId }: RevisionStep) => operation.source.kind === 'run-reference'
    ? { keyFieldId: operation.source.authority.keyFieldId, fields: operation.source.authority.writableFields }
    : type(typeId);
  const readKeyedStep = (workbook: EditableWorkbookWire, createdAt: string, step: RevisionStep, change: KeyedWorkbookChange) => {
    const { settled } = step;
    const replayed = replayKeyedSettlement(workbook, settled.version - 1, change, settled, keyedAuthority(step));
    const retained = retainedRevisionWorkbook(settled.libraryId, settled.version, settled.at, createdAt);
    if (retained !== undefined && canonicalJsonStringify(retained) !== canonicalJsonStringify(replayed)) {
      throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    }
    return retained ?? replayed;
  };
  const replayJournalSync = (baseline: SavedWorkbook, through: ContentPosition) => {
    const id = baseline.libraryId;
    const migrationId = JSON.stringify([id, 'current']);
    const migration = libraryState(id).versions.find(entry => entry.id === 'current');
    if (database.prepare('SELECT 1 FROM workbook_library_snapshots WHERE id=? AND workbook_id=?').get(migrationId, id) === undefined
      || (migration !== undefined && through.version > migration.version)) {
      throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    }
    let workbook = encodeSavedWorkbook(baseline).workbook, ownership: WorkbookOwnership = {}, typeId = 'general';
    for (const { operation, settled } of settledOperations(id, 0, through.sequence)) {
      const { change } = operation;
      if (settled.state !== 'applied' || change.kind === 'version') continue;
      if (change.kind === 'metadata') {
        typeId = change.metadata.typeId;
        continue;
      }
      const version = settled.version - 1;
      if (operation.source.kind === 'run-reference') throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      if (change.kind === 'patch' || change.kind === 'add') {
        workbook = readKeyedStep(workbook, baseline.createdAt, { operation, settled, typeId }, change);
        for (const effect of settled.changes) {
          const address = JSON.stringify([effect.sheetId, effect.rowId, effect.fieldId]);
          const owner = ownership[address];
          if (owner?.owner === 'operator' || (owner?.owner === 'relay'
            ? canonicalJsonStringify(owner.value) !== canonicalJsonStringify(effect.oldValue) : effect.oldValue !== null && effect.oldValue !== '')) {
            throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
          }
          ownership[address] = { owner: 'relay', value: effect.newValue };
        }
        continue;
      }
      const input = { workbook, ownership, version, type: type(typeId), operation, libraryId: id, sequence: settled.sequence };
      const applied = applyMasterChange(input);
      if (change.kind === 'sync' && (applied.receipt.state !== 'applied'
        || canonicalJsonStringify({ ...applied.receipt, version: settled.version }) !== canonicalJsonStringify(settled))) {
        ({ workbook, ownership } = replayLiteralKeySync(input, settled));
      } else {
        if (applied.receipt.state !== 'applied') throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
        ({ workbook, ownership } = applied);
      }
      const retained = retainedRevisionWorkbook(id, settled.version, settled.at, baseline.createdAt);
      if (retained !== undefined && canonicalJsonStringify(retained) !== canonicalJsonStringify(workbook)) {
        throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      }
    }
    return workbook;
  };
  const revisionValue = (id: string, version: number): SavedWorkbook => {
    const live = required(id);
    if (version === live.version) return live;
    if (version > live.version) throw new WorkbookLibraryError('WORKBOOK_REVISION_UNAVAILABLE');
    const baseline = revisionBaseline(id, version, live);
    if (version === baseline.version) return baseline;
    let priorVersion = baseline.version, savedAt = baseline.savedAt, typeId = 'general', targetSequence = 0;
    let previousContent: ContentPosition | undefined;
    let anchor: { position: ContentPosition; previous: ContentPosition | undefined; typeId: string } | undefined;
    for (const { operation, settled } of settledOperations(id)) {
      const { change } = operation;
      const advances = settled.state === 'applied' && change.kind !== 'version';
      if (settled.version !== priorVersion + Number(advances) || settled.key !== ('key' in change ? change.key : undefined)
        || (settled.state === 'applied' && (Date.parse(settled.at) < Date.parse(savedAt)
          || ('expectedVersion' in change && change.expectedVersion !== undefined && change.expectedVersion !== priorVersion)))) {
        throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      }
      if ((!('key' in change) && settled.candidates.length !== 0)
        || ((change.kind === 'version' || change.kind === 'metadata') && settled.changes.length !== 0)) {
        throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      }
      if (!advances) continue;
      if (change.kind === 'metadata') {
        typeId = change.metadata.typeId;
        if (!type(typeId)) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      } else {
        const position = { kind: change.kind, sequence: settled.sequence, version: settled.version, at: settled.at };
        if (change.kind === 'save' || change.kind === 'sync') anchor = { position, previous: previousContent, typeId };
        previousContent = position;
      }
      priorVersion = settled.version;
      savedAt = settled.at;
      targetSequence = settled.sequence;
      if (priorVersion === version) break;
    }
    if (priorVersion !== version) throw new WorkbookLibraryError('WORKBOOK_REVISION_UNAVAILABLE');

    let workbook: EditableWorkbookWire;
    typeId = anchor?.typeId ?? 'general';
    if (anchor === undefined) {
      workbook = encodeSavedWorkbook(baseline).workbook;
    } else {
      const { operation: { change }, settled } = settlementAt(id, anchor.position);
      const retained = retainedRevisionWorkbook(id, settled.version, settled.at, baseline.createdAt);
      if (change.kind === 'save') {
        if (retained !== undefined && canonicalJsonStringify(retained) !== canonicalJsonStringify(change.workbook)) {
          throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
        }
        workbook = change.workbook;
      } else if (change.kind === 'sync') {
        workbook = retained ?? replayJournalSync(baseline, anchor.position);
      } else throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      if (change.kind === 'save' || retained !== undefined) {
        verifySnapshotEffects(workbook, settled, type(typeId)?.keyFieldId ?? null, independentPredecessor(baseline, anchor.previous));
      }
    }
    for (const { operation, settled } of settledOperations(id, anchor?.position.sequence ?? 0, targetSequence)) {
      if (settled.state !== 'applied') continue;
      const { change } = operation;
      if (change.kind === 'metadata') typeId = change.metadata.typeId;
      else if (change.kind === 'patch' || change.kind === 'add') {
        workbook = readKeyedStep(workbook, baseline.createdAt, { operation, settled, typeId }, change);
      }
    }
    return decodeSavedWorkbook({ ...baseline, version, savedAt, workbook });
  };
  const revision = (id: string, version: number) => storage(() => deps.read(() => stored(() => revisionValue(id, version))));
  const libraryActionRecord = (id: string, operationId: string): WorkbookLibraryActionRecord | undefined => {
    const raw = database.prepare('SELECT id,workbook_id,operation_id,digest,payload_json FROM workbook_library_actions WHERE workbook_id=? AND operation_id=?').get(id, operationId);
    if (raw === undefined) return undefined;
    return stored(() => {
      const row = z.strictObject({ id: z.string(), workbook_id: z.string(), operation_id: z.string(), digest: z.string(), payload_json: z.string() }).parse(raw);
      const parsed = z.looseObject({ result: z.looseObject({}) }).parse(JSON.parse(row.payload_json));
      const record = WorkbookLibraryActionRecordSchema.parse({ ...parsed, result: withPinTags(parsed.result) });
      if (record.libraryId !== row.workbook_id || record.action.operationId !== row.operation_id
        || row.id !== JSON.stringify([record.libraryId, record.action.operationId])
        || sha256Hex(canonicalJsonStringify(record.action)) !== row.digest) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      return record;
    });
  };
  const holds = (at: string, id: string | null = null) => {
    const rows = database.prepare(`WITH references_in_use AS (
      SELECT json_extract(reference.value,'$.value.snapshot') AS snapshot
      FROM runs,json_each(runs.lifecycle_json,'$.input.workbookReferences') reference WHERE runs.state<>'terminal'
      UNION ALL
      SELECT json_extract(reference.value,'$.value.snapshot')
      FROM run_requests,json_each(run_requests.payload_json,'$.planned') planned,json_each(planned.value,'$.workbookReferences') reference
      WHERE json_type(run_requests.payload_json,'$.consumedBy') IS NULL AND json_extract(run_requests.payload_json,'$.expiresAt')>?
    ), workbook_holds AS (
      SELECT json_extract(snapshot,'$.libraryId') AS library_id,json_extract(snapshot,'$.versionId') AS version_id,
        CASE WHEN json_type(snapshot,'$.versionId') IS NULL THEN json_extract(snapshot,'$.version') END AS revision,0 AS whole_workbook
      FROM references_in_use
      UNION
      SELECT workbook_id,NULL,NULL,1 FROM workbook_operations WHERE receipt_json IS NULL
    )
    SELECT * FROM workbook_holds WHERE library_id IS NOT NULL AND (? IS NULL OR library_id=?)`).all(at, id, id);
    return WorkbookHoldRowsSchema.parse(rows);
  };
  const holdsVersion = (hold: z.infer<typeof WorkbookHoldRowsSchema>[number], version: WorkbookLibraryState["versions"][number]) =>
    hold.whole_workbook === 1 || hold.version_id === version.id || hold.revision === version.version;
  const inUse = (id: string, at: string, version?: WorkbookLibraryState["versions"][number]) =>
    holds(at, id).some(hold => version === undefined || holdsVersion(hold, version));
  const withVersionHolds = (catalog: readonly z.infer<typeof WorkbookLibraryEntrySchema>[], at: string | undefined) => {
    if (at === undefined || catalog.every(entry => entry.state.versions.length === 1)) return catalog;
    const byLibrary = Map.groupBy(holds(at), hold => hold.library_id);
    return catalog.map(entry => {
      const relevant = byLibrary.get(entry.libraryId);
      if (relevant === undefined) return entry;
      const heldVersionIds = entry.state.versions.filter(version => version.id !== entry.state.selectedVersionId
        && relevant.some(hold => holdsVersion(hold, version))).map(version => version.id);
      return heldVersionIds.length === 0 ? entry : { ...entry, heldVersionIds };
    });
  };
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
    catalog: at => storage(() => deps.read(() => {
      const cached = readCache();
      if (cached?.catalog !== undefined) return withVersionHolds(cached.catalog, at);
      const catalog = database.prepare('SELECT * FROM workbook_library ORDER BY saved_at DESC,id').all().flatMap(raw => {
        const current = cachedFromRow(raw), state = libraryState(current.libraryId);
        if (state.removed) return [];
        const selected = state.versions.find(version => version.id === state.selectedVersionId);
        if (selected === undefined) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
        const record = librarySnapshot(current.libraryId, selected.snapshotId), meta = metadata(current.libraryId), workbookType = type(meta.typeId);
        if (workbookType === undefined) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
        const last = meta.sharePoint === null ? undefined : lastSync(current.libraryId);
        const sync = meta.sharePoint === null ? {} : { sync: last === undefined || last.url !== meta.sharePoint.url ? { state: 'idle' }
          : { state: 'idle', lastFinishedAt: last.finishedAt, lastResult: last.result, ...(last.result === 'failed' ? { lastFailureCode: last.code } : {}) } };
        return [WorkbookLibraryEntrySchema.parse({ libraryId: current.libraryId, version: current.version, name: current.workbook.name, updatedAt: selected.savedAt,
          worksheets: record.workbook.sheets.map(sheet => ({ id: sheet.id, name: sheet.name })),
          rowCount: record.workbook.sheets.reduce((count, sheet) => count + sheet.rows.length - (sheet.headerRow ?? 1), 0),
          state, metadata: meta, type: workbookType, ...sync })];
      });
      if (cached !== undefined) cached.catalog = deepFreeze(catalog);
      return withVersionHolds(catalog, at);
    })),
    libraryState: id => storage(() => deps.read(() => libraryState(id))),
    atomically: work => storage(() => deps.mutate(() => ({ result: work(), changes: 0 }))),
    recordSync: (id, value) => storage(() => deps.mutate(() => {
      const record = WorkbookLibrarySyncRecordSchema.parse(value);
      const changes = Number(database.prepare('UPDATE workbook_library_state SET sync_json=? WHERE id=?').run(canonicalJsonStringify(record), id).changes);
      if (changes !== 1) throw new WorkbookLibraryError('WORKBOOK_NOT_FOUND');
      return { result: undefined, changes };
    })),
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
          const name = change.name.trim();
          if (versionNames(state.versions).has(name)) throw new WorkbookLibraryError('WORKBOOK_VERSION_NAME_EXISTS');
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
          next.versions.push({ id: action.operationId, snapshotId, name, version, savedAt: at,
            source: change.from.kind === 'sharepoint' ? 'sharepoint' : 'operator' });
          next.selectedVersionId = change.useNow ? action.operationId : state.selectedVersionId;
        } else if (change.kind === 'sync') {
          if (sharePointWorkbook === undefined || metadata(id).sharePoint === null) throw new WorkbookLibraryError('WORKBOOK_SYNC_LINK_REQUIRED');
          apply({ operationId: `library:${action.operationId}`, source: { kind: 'sync', syncId: action.operationId }, at,
            change: { kind: 'sync', expectedVersion: before.version, workbook: sharePointWorkbook } });
        } else if (change.kind === 'rename-version') {
          selected(change.versionId);
          const name = change.name.trim();
          if (state.versions.some(version => version.id !== change.versionId && version.name.trim() === name)) {
            throw new WorkbookLibraryError('WORKBOOK_VERSION_NAME_EXISTS');
          }
          next.versions = next.versions.map(version => version.id === change.versionId ? { ...version, name } : version);
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
      const json = savedPayloadJson(database, record);
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
      return row === undefined ? undefined : stored(() => readSaved(z.object({ payload_json: z.string() }).parse(row).payload_json));
    })),
    list: () => storage(() => deps.read(listCurrent)),
    listWithType: () => storage(() => deps.read(() =>
      listCurrent().map(record => ({ record, typeId: metadata(record.libraryId).typeId })))),
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
        return stored(() => WorkbookNamedVersionSchema.parse({ ...row, snapshot: encodeSavedWorkbook(fromRow(readSaved, { ...raw, id })) }));
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
    hasQueuedOperation: (id: string) => storage(() => deps.read(() => { required(id); return database.prepare('SELECT 1 FROM workbook_operations WHERE workbook_id=? AND receipt_json IS NULL LIMIT 1').get(id) !== undefined; })),
    journal: id => storage(() => deps.read(() => { required(id); return database.prepare('SELECT receipt_json FROM workbook_operations WHERE workbook_id=? AND receipt_json IS NOT NULL ORDER BY sequence').all(id).map(row => receipt(row.receipt_json)); })),
    runOperations: runId => storage(() => deps.read(() => database.prepare("SELECT * FROM workbook_operations WHERE json_extract(request_json,'$.source.kind') IN ('run','run-reference') AND json_extract(request_json,'$.source.runId')=? ORDER BY sequence").all(runId)
      .map(raw => { const row = z.object({ workbook_id: z.string() }).parse(raw); return operationRecord(row.workbook_id, raw); }))),
  };
  return repository;
}

function validateWorkbookPayload(raw: unknown) {
  const { digest, payload_json: json } = WorkbookPayloadRowSchema.parse(raw);
  if (sha256Hex(json) !== digest) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  const workbook = EditableWorkbookWireSchema.parse(JSON.parse(json));
  if (canonicalJsonStringify(workbook) !== json) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
  return { digest, characters: json.length, workbook };
}

/** Payloads and references read in one transaction see the same immutable image. Keep every envelope check. */
function workbookInspectionReaders(database: DatabaseSync) {
  type NativeWorkbook = ReturnType<typeof decodeEditableWorkbook>;
  type InspectedPayload = ReturnType<typeof validateWorkbookPayload> & { native?: NativeWorkbook };
  const cache = storedSizeCache<InspectedPayload>(workbookCacheCharacters);
  const wireProofs = new WeakSet<object>(), nativeProofs = new WeakSet<object>();
  const wireSchema = z.custom<EditableWorkbookWire>(value => typeof value === 'object' && value !== null && wireProofs.has(value));
  const savedWire = SavedWorkbookWireSchema.safeExtend({ workbook: wireSchema });
  const savedNative = SavedWorkbookSchema.safeExtend({ workbook: z.custom<NativeWorkbook>(value => typeof value === 'object' && value !== null && nativeProofs.has(value)) });
  const snapshot = WorkbookLibrarySnapshotSchema.safeExtend({ workbook: wireSchema });
  const rowByDigest = database.prepare('SELECT digest,payload_json FROM workbook_payloads WHERE digest=?');
  const remember = (raw: unknown): InspectedPayload => {
    const entry = validateWorkbookPayload(raw);
    wireProofs.add(entry.workbook);
    cache.set(entry.digest, entry);
    return entry;
  };
  const read = (json: string) => {
    const { workbookDigest, ...envelope } = WorkbookReferenceSchema.parse(JSON.parse(json));
    const payload = cache.get(workbookDigest) ?? remember(rowByDigest.get(workbookDigest));
    return { envelope, payload };
  };
  return {
    remember,
    saved: (json: string): SavedWorkbook => {
      const { envelope, payload } = read(json);
      const record = savedWire.parse({ ...envelope, workbook: payload.workbook });
      const workbook = payload.native ??= decodeEditableWorkbook(record.workbook);
      nativeProofs.add(workbook);
      return Object.freeze(savedNative.parse({ ...record, workbook }));
    },
    snapshot(json: string) {
      const { envelope, payload } = read(json);
      return snapshot.parse({ ...envelope, workbook: payload.workbook });
    },
  };
}

/**
 * Validates the whole library in the layout of its schema: master (13), catalog (18), pin and tags (30), sync status (36), payloads (38).
 * `payloadDigests` checks only those payload rows instead of every one.
 */
export function validateWorkbookLibrary(database: DatabaseSync, master = true, catalog = true, pinTags = true, syncStatus = pinTags, payloads = syncStatus,
  payloadDigests?: ReadonlySet<string>): number {
  const read: PayloadReader = payloads ? json => withWorkbook(database, json) : embeddedPayload;
  const inspected = payloads && payloadDigests === undefined && database.isTransaction ? workbookInspectionReaders(database) : undefined;
  const readSaved: SavedWorkbookReader = inspected?.saved ?? (json => decodeSavedWorkbook(read(json)));
  if (!master) {
    const records = database.prepare('SELECT * FROM workbook_library').all().map(raw => fromRow(readSaved, raw));
    return records.reduce((total, record) => {
      const history = database.prepare('SELECT workbook_id AS id,version,created_at,saved_at,payload_json FROM workbook_library_history WHERE workbook_id=? ORDER BY version').all(record.libraryId).map(raw => fromRow(readSaved, raw));
      if (history.length !== record.version || history.some((entry, index) => entry.version !== index + 1) || canonicalJsonStringify(encodeSavedWorkbook(history[history.length - 1])) !== canonicalJsonStringify(encodeSavedWorkbook(record))) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      return total + 1 + history.length;
    }, 0);
  }
  const repository = workbookLibraryRepository({ database, read: work => work(), mutate: () => { throw new Error('workbook-validation-read-only'); }, beforePinTags: !pinTags, embeddedWorkbooks: !payloads }, readSaved);
  let count = repository.types().length;
  const payloadRows = !payloads ? [] : payloadDigests === undefined ? database.prepare('SELECT digest,payload_json FROM workbook_payloads ORDER BY digest').iterate()
    : [...payloadDigests].flatMap(digest => database.prepare('SELECT digest,payload_json FROM workbook_payloads WHERE digest=?').all(digest));
  for (const raw of payloadRows) {
    if (inspected === undefined) validateWorkbookPayload(raw);
    else inspected.remember(raw);
    count++;
  }
  const records = database.prepare('SELECT * FROM workbook_library ORDER BY id').all().map(raw => fromRow(readSaved, raw));
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
    if (!catalog) continue;
    const state = repository.libraryState(record.libraryId);
    const snapshots = database.prepare('SELECT id,workbook_id,payload_json FROM workbook_library_snapshots WHERE workbook_id=? ORDER BY id').all(record.libraryId);
    const ids = new Set<string>();
    for (const raw of snapshots) {
      const row = z.strictObject({ id: z.string(), workbook_id: z.string(), payload_json: z.string() }).parse(raw);
      const snapshot = stored(() => inspected === undefined ? WorkbookLibrarySnapshotSchema.parse(read(row.payload_json)) : inspected.snapshot(row.payload_json));
      if (snapshot.id !== row.id || snapshot.libraryId !== row.workbook_id || snapshot.libraryId !== record.libraryId) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
      ids.add(snapshot.id);
    }
    if (state.versions.some(version => !ids.has(version.snapshotId))) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    if (syncStatus) {
      const sync = z.strictObject({ sync_json: z.string().nullable() }).parse(database.prepare('SELECT sync_json FROM workbook_library_state WHERE id=?').get(record.libraryId)).sync_json;
      if (sync !== null) WorkbookLibrarySyncRecordSchema.parse(JSON.parse(sync));
    }
    count += snapshots.length;
    const actions = database.prepare('SELECT operation_id FROM workbook_library_actions WHERE workbook_id=? ORDER BY id').all(record.libraryId);
    for (const raw of actions) {
      const operationId = z.strictObject({ operation_id: z.string() }).parse(raw).operation_id;
      const action = repository.libraryActionRecord(record.libraryId, operationId);
      if (action === undefined || action.result.revision > state.revision) throw new WorkbookLibraryError('WORKBOOK_STORAGE_CORRUPT');
    }
    count += 1 + actions.length;
  }
  return count;
}
