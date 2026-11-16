import type { DatabaseSync } from 'node:sqlite';
import { WorkbookLibraryActionRecordSchema, WorkbookLibrarySnapshotSchema, WorkbookLibraryStateSchema } from '../../../../src/models/dashboard/workbook-library.js';
import { SavedWorkbookWireSchema, WorkbookOperationSchema, WorkbookOperationReceiptSchema } from '../../../../src/models/dashboard/workbooks.js';
import { canonicalJsonStringify } from '../../../../src/rules/validation/canonical-json.js';
import { sha256Hex } from '../../../../src/rules/validation/sha256.js';

const at = '2026-11-02T00:00:00.000Z';
const targetId = 'historical-target', sourceId = 'historical-source';
const actionDigest = '373b761365c75ff7a19c20fe745ef2f4f3af139acc3c9b6c1c99d3a3d7199a23';
const sheetId = JSON.stringify([targetId, 'people']);
const originalSheet = { id: 'people', name: 'People', width: 1, hidden: [],
  rows: [{ id: 'header', cells: [{ value: 'Value' }] }, { id: 'person', cells: [{ value: 'Target' }] }] };
const target = SavedWorkbookWireSchema.parse({ libraryId: targetId, version: 1, createdAt: at, savedAt: at,
  workbook: { libraryId: targetId, name: 'Target.xlsx', themes: [], hasFormulas: false, sheets: [originalSheet] } });
const source = SavedWorkbookWireSchema.parse({ ...target, libraryId: sourceId,
  workbook: { ...target.workbook, libraryId: sourceId, name: 'Source.xlsx', sheets: [{ ...originalSheet,
    rows: [originalSheet.rows[0], { id: 'person', cells: [{ value: 'Source' }] }] }] } });
const merged = SavedWorkbookWireSchema.parse({ ...target, version: 2,
  workbook: { ...target.workbook, name: 'Merged.xlsx', sheets: [{ ...originalSheet, id: sheetId,
    rows: [originalSheet.rows[0],
      { id: JSON.stringify([targetId, 'people', 'person']), cells: [{ value: 'Target' }] },
      { id: JSON.stringify([sourceId, 'people', 'person']), cells: [{ value: 'Source' }] }] }] } });
const version = (libraryId: string, id: string, name: string, revision: number, origin: 'import' | 'operator' | 'retained') => ({
  id, name, version: revision, snapshotId: JSON.stringify([libraryId, id]), savedAt: at, source: origin,
});
const targetState = WorkbookLibraryStateSchema.parse({ libraryId: targetId, revision: 2, selectedVersionId: 'revision:2',
  origin: { kind: 'local' }, removed: false, pinned: false, tags: [], versions: [version(targetId, 'original', 'Original version', 1, 'import'),
    version(targetId, 'revision:2', 'Saved revision 2', 2, 'operator'), version(targetId, `merge:${sourceId}`, 'From Source.xlsx', 1, 'retained')] });
const sourceState = WorkbookLibraryStateSchema.parse({ libraryId: sourceId, revision: 2, selectedVersionId: 'original',
  origin: { kind: 'local' }, removed: true, pinned: false, tags: [], versions: [version(sourceId, 'original', 'Original version', 1, 'import')] });
const record = WorkbookLibraryActionRecordSchema.parse({ libraryId: targetId, at,
  action: { operationId: 'merge', expectedRevision: 1, expectedVersion: 1,
    change: { kind: 'merge', name: 'Merged.xlsx', duplicates: 'keep-both', sources: [{ libraryId: sourceId, expectedRevision: 1, expectedVersion: 1 }] } }, result: targetState });
const save = WorkbookOperationSchema.parse({ operationId: 'library:merge', source: { kind: 'operator' }, at,
  change: { kind: 'save', expectedVersion: 1, workbook: merged.workbook } });
const metadata = WorkbookOperationSchema.parse({ operationId: 'library:merge:metadata', source: { kind: 'operator' }, at,
  change: { kind: 'metadata', expectedVersion: 2, metadata: { typeId: 'general', sharePoint: null } } });
const saveChanges = [
  { sheetId: 'people', rowId: 'header', fieldId: 'column:0', oldValue: 'Value', newValue: null },
  { sheetId: 'people', rowId: 'person', fieldId: 'column:0', oldValue: 'Target', newValue: null },
  { sheetId, rowId: 'header', fieldId: 'column:0', oldValue: null, newValue: 'Value' },
  { sheetId, rowId: JSON.stringify([targetId, 'people', 'person']), fieldId: 'column:0', oldValue: null, newValue: 'Target' },
  { sheetId, rowId: JSON.stringify([sourceId, 'people', 'person']), fieldId: 'column:0', oldValue: null, newValue: 'Source' },
];

export function installRetainedMergeFixture(database: DatabaseSync) {
  for (const [creation, current, state] of [[target, { ...merged, version: 3 }, targetState], [source, source, sourceState]] as const) {
    database.prepare('INSERT INTO workbook_library(id,version,created_at,saved_at,payload_json,ownership_json) VALUES(?,?,?,?,?,?)')
      .run(current.libraryId, current.version, at, at, canonicalJsonStringify(SavedWorkbookWireSchema.parse(current)),
        canonicalJsonStringify(current.libraryId === targetId ? { '["people","header","column:0"]': { owner: 'operator' }, '["people","person","column:0"]': { owner: 'operator' } } : {}));
    database.prepare('INSERT INTO workbook_creations(id,payload_json) VALUES(?,?)').run(creation.libraryId, canonicalJsonStringify(creation));
    database.prepare('INSERT INTO workbook_library_state(id,payload_json) VALUES(?,?)').run(state.libraryId, canonicalJsonStringify(state));
  }
  for (const [libraryId, id, workbook] of [[targetId, 'original', target.workbook], [sourceId, 'original', source.workbook],
    [targetId, 'revision:2', merged.workbook], [targetId, `merge:${sourceId}`, { ...source.workbook, libraryId: targetId }]] as const) {
    const snapshot = WorkbookLibrarySnapshotSchema.parse({ id: JSON.stringify([libraryId, id]), libraryId, workbook });
    database.prepare('INSERT INTO workbook_library_snapshots(id,workbook_id,payload_json) VALUES(?,?,?)').run(snapshot.id, libraryId, canonicalJsonStringify(snapshot));
  }
  for (const [operation, changes, revision] of [[save, saveChanges, 2], [metadata, [], 3]] as const) {
    const inserted = database.prepare('INSERT INTO workbook_operations(workbook_id,operation_id,digest,request_json) VALUES(?,?,?,?)')
      .run(targetId, operation.operationId, sha256Hex(canonicalJsonStringify(operation)), canonicalJsonStringify(operation));
    const receipt = WorkbookOperationReceiptSchema.parse({ libraryId: targetId, operationId: operation.operationId,
      sequence: Number(inserted.lastInsertRowid), state: 'applied', version: revision, candidates: [], changes, source: operation.source, at });
    database.prepare('UPDATE workbook_operations SET receipt_json=? WHERE sequence=?').run(canonicalJsonStringify(receipt), receipt.sequence);
  }
  database.prepare('INSERT INTO workbook_library_actions(id,workbook_id,operation_id,digest,payload_json) VALUES(?,?,?,?,?)')
    .run(JSON.stringify([targetId, record.action.operationId]), targetId, record.action.operationId, actionDigest, canonicalJsonStringify(record));
  return record;
}
