import { applyOlderBuildStatements } from '../../../support/fixtures/storage/older-build-authority.js';
import { installRetainedMergeFixture } from '../../../support/fixtures/storage/retained-workbook-merge.js';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SQLITE_MIGRATIONS, CURRENT_AUTHORITY_SCHEMA_VERSION, migrationTableNames, auditMigrationTableCoverage, tableClassification, deriveAuthorityUpgradePlanDigest } from '../../../../src/backend/storage/sqlite/migrations.js';
import { createWorkbookLibraryRepository, validateWorkbookLibrary } from '../../../../src/backend/storage/sqlite/workbook-library-repository.js';
import { nativeOrdinaryRecordFromRow } from '../../../../src/backend/storage/sqlite/native-record-row.js';
import { WorkflowWorkbookSelectionRecordSchema } from '../../../../src/models/dashboard/workbook-library.js';
import { SavedWorkbookSchema, CapturedWorkbookWriteSourceSchema, WorkbookOperationSchema } from '../../../../src/models/dashboard/workbooks.js';
import { canonicalJsonStringify } from '../../../../src/rules/validation/canonical-json.js';
import { WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from '../../../support/fixtures/phase1c-contract-fixtures.js';
import { WriteIntentRecordSchema, WriteAttemptRecordSchema } from '../../../../src/rules/write-safety/write-safety.js';
import { sha256Hex } from '../../../../src/rules/validation/sha256.js';

const at = '2026-11-02T00:00:00.000Z';
function fixture(version: 23 | 25 = 23) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  applyOlderBuildStatements(database, version === 25 ? 24 : 23);
  if (version === 25) {
    const migration = SQLITE_MIGRATIONS.find(migration => migration.version === 25);
    if (!migration) throw new Error('selection migration missing');
    for (const statement of migration.statements) database.exec(statement);
  }
  const transaction = <T>(work: () => T): T => {
    database.exec('BEGIN EXCLUSIVE');
    try { const result = work(); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  let changes = 0;
  const repository = createWorkbookLibraryRepository({ database, read: work => work(),
    mutate: work => transaction(() => { const result = work(); changes += result.changes; return result.result; }) });
  return { database, repository, transaction, changes: () => changes };
}
function upgrade(f: ReturnType<typeof fixture>) {
  f.transaction(() => {
    const migration = SQLITE_MIGRATIONS.find(migration => migration.version === 25);
    if (!migration) throw new Error('selection migration missing');
    for (const statement of migration.statements) f.database.exec(statement);
  });
}
function source(f: ReturnType<typeof fixture>, id = 'library') {
  return f.repository.create(SavedWorkbookSchema.parse({ libraryId: id, version: 1, createdAt: at, savedAt: at,
    workbook: { libraryId: id, name: 'Roster.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 'people', name: 'People', width: 2, hidden: [], headerRow: 1,
      columnBindings: [{ id: 'binding-eid', sourceColumn: 0, sourceHeader: 'Employee', fieldId: 'eid', basis: 'manual' },
        { id: 'binding-note', sourceColumn: 1, sourceHeader: 'Note', fieldId: null, basis: 'header' }],
      rows: [{ id: 'header', cells: [{ value: 'Employee' }, { value: 'Note' }] },
        { id: 'person', cells: [{ value: '10000001' }, { value: new Date(at), numFmt: 'yyyy-mm-dd', background: '#f0f0f0' }] }] }] } }));
}
function rows(f: ReturnType<typeof fixture>) {
  const present = new Set(f.database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => String(row.name)));
  return Object.fromEntries(migrationTableNames(23).filter(table => present.has(table)).map(table => [table, f.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function selection() {
  return { workflowId: 'person-lookup', acceptedCommandId: randomUUID(), usedAt: at,
    sources: [{ libraryId: 'library', sheetId: 'people' }, { libraryId: 'other', sheetId: 'people' }] };
}

it('adds an empty selection authority at 25 and preserves prior mappings, metadata journals, revisions and completed merge evidence exactly', () => {
  const f = fixture(), fresh = fixture();
  upgrade(fresh);
  try {
    const first = source(f), other = source(f, 'other');
    f.repository.putType({ id: 'roster', name: 'Roster', keyFieldId: 'eid', fields: ['eid'], defaultWorkbookId: null });
    f.repository.operation(first.libraryId, { operationId: 'metadata', source: { kind: 'operator' }, at,
      change: { kind: 'metadata', expectedVersion: 1, metadata: { typeId: 'roster', sharePoint: null } } });
    f.repository.operation(other.libraryId, { operationId: 'metadata-other', source: { kind: 'operator' }, at,
      change: { kind: 'metadata', expectedVersion: 1, metadata: { typeId: 'roster', sharePoint: null } } });
    const revision = f.repository.revision(first.libraryId, 1);
    const merge = installRetainedMergeFixture(f.database);
    const mergedRevision = f.repository.revision(merge.libraryId, 2);
    const sourceRevision = f.repository.revision('historical-source', 1);
    expect(mergedRevision.workbook.name).toBe('Merged.xlsx');
    const authorityReason = { version: 1, code: 'post-click-verifier-unknown', evidence: { kind: 'probe', digest: 'a'.repeat(64) } };
    const intent = WriteIntentRecordSchema.parse({ ...WRITE_INTENT_ATTEMPTING, status: 'parked', parkedCode: 'unknown', message: 'fixture unresolved submit', authorityReason });
    if (intent.status !== 'parked') throw new Error('parked fixture required');
    f.database.prepare('INSERT INTO write_intents(id,system,idempotency_key,idempotency_key_digest,status,generation,run_id,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(intent.writeIntentId, intent.system, intent.idempotencyKey, intent.idempotencyKeyDigest, intent.status, intent.generation, intent.runId, canonicalJsonStringify(intent), intent.createdAt, intent.updatedAt);
    const attempt = WriteAttemptRecordSchema.parse({ ...WRITE_ATTEMPT, outcome: { state: 'parked', code: 'unknown', message: 'fixture unresolved submit', authorityReason } });
    f.database.prepare('INSERT INTO write_attempts(id,intent_id,generation,run_id,payload_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(attempt.writeAttemptId, attempt.writeIntentId, attempt.generation, attempt.runId, canonicalJsonStringify(attempt), attempt.recordedAt);
    const before = rows(f);
    upgrade(f);
    expect(rows(f)).toEqual(before);
    expect(f.repository.revision(first.libraryId, 1)).toEqual(revision);
    expect(f.repository.libraryActionRecord(merge.libraryId, merge.action.operationId)).toEqual(merge);
    expect(f.repository.revision(merge.libraryId, 2)).toEqual(mergedRevision);
    expect(f.repository.revision('historical-source', 1)).toEqual(sourceRevision);
    expect(f.repository.libraryState('historical-source').removed).toBe(true);
    expect(validateWorkbookLibrary(f.database)).toBeGreaterThan(0);
    expect(f.repository.lastUsed('person-lookup')).toBeUndefined();
    expect(f.database.prepare('SELECT * FROM workflow_workbook_selections').all()).toEqual([]);
    expect(CURRENT_AUTHORITY_SCHEMA_VERSION).toBe(30);
    expect(migrationTableNames(25).filter(table => !migrationTableNames(24).includes(table))).toEqual(['workflow_workbook_selections']);
    expect(tableClassification('workflow_workbook_selections')).toBe('authority');
    expect(auditMigrationTableCoverage()).toEqual([]);
    const layout = (database: DatabaseSync) => database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    expect(layout(f.database)).toEqual(layout(fresh.database));
    expect(f.database.prepare('PRAGMA foreign_key_list(workflow_workbook_selections)').all()).toEqual([]);
  } finally { f.database.close(); fresh.database.close(); }
});

it('persists ordered unique source identities with strict idempotence, revisions and conflicts, retaining stale selections', () => {
  const f = fixture(25);
  try {
    source(f);
    const value = selection(), before = f.changes();
    const first = f.repository.rememberLastUsed(value);
    expect(first).toEqual({ ...value, revision: 1 });
    expect(f.repository.lastUsed(value.workflowId)).toEqual(first);
    expect(f.changes()).toBe(before + 1);
    expect(f.repository.rememberLastUsed(value)).toEqual(first);
    expect(f.changes()).toBe(before + 1);
    for (const conflicting of [{ ...value, sources: [...value.sources].reverse() }, { ...value, usedAt: '2026-11-03T00:00:00.000Z' }]) {
      expect(() => f.repository.rememberLastUsed(conflicting)).toThrow(expect.objectContaining({ code: 'WORKBOOK_OPERATION_CONFLICT' }));
    }
    expect(f.repository.lastUsed(value.workflowId)).toEqual(first);
    expect(f.repository.rememberLastUsed({ ...value, acceptedCommandId: randomUUID(), sources: [...value.sources].reverse() })).toEqual(
      expect.objectContaining({ revision: 2, sources: [...value.sources].reverse() }));
    const retained = f.repository.lastUsed(value.workflowId);
    f.repository.libraryAction('library', { operationId: 'remove', expectedRevision: 1, expectedVersion: 1, change: { kind: 'remove' } }, at);
    f.database.exec('DELETE FROM runs; DELETE FROM deleted_runs');
    expect(f.repository.lastUsed(value.workflowId)).toEqual(retained);
    const other = fixture(25);
    try { expect(other.repository.lastUsed(value.workflowId)).toBeUndefined(); } finally { other.database.close(); }
    for (const invalid of [{ ...value, sources: [] }, { ...value, sources: [value.sources[0], value.sources[0]] },
      { ...value, sources: [{ ...value.sources[0], versionId: 'original' }] }, { ...value, profileId: randomUUID() }]) {
      expect(() => f.repository.rememberLastUsed(invalid)).toThrow();
    }
    expect(WorkflowWorkbookSelectionRecordSchema.safeParse({ ...first, revision: 0 }).success).toBe(false);
  } finally { f.database.close(); }
});

it.each(['workflow_id', 'revision', 'accepted_command_id', 'used_at', 'payload_json'] as const)('refuses selection scalar/payload corruption in %s', column => {
  const f = fixture(25);
  try {
    const record = f.repository.rememberLastUsed(selection());
    const row = f.database.prepare('SELECT * FROM workflow_workbook_selections').get();
    expect(nativeOrdinaryRecordFromRow('workflow_workbook_selections', row)).toEqual(record);
    const changed = column === 'revision' ? 2 : column === 'payload_json' ? '{}' : column === 'accepted_command_id' ? randomUUID()
      : column === 'used_at' ? '2026-11-03T00:00:00.000Z' : 'other-workflow';
    f.database.prepare(`UPDATE workflow_workbook_selections SET ${column}=?`).run(changed);
    expect(() => f.repository.lastUsed(column === 'workflow_id' ? 'other-workflow' : 'person-lookup')).toThrow(
      expect.objectContaining({ code: 'WORKBOOK_STORAGE_CORRUPT' }));
  } finally { f.database.close(); }
});

it.each([
  { id: 'library:action', kind: 'operator', refused: true },
  { id: 'library:action:metadata', kind: 'operator', refused: true },
  { id: 'Library:action', kind: 'operator', refused: false },
  { id: 'operator-action', kind: 'operator', refused: false },
  { id: 'library:run-patch', kind: 'run', refused: false },
] as const)('inventories pending $kind/$id without replay; refused=$refused', ({ id, kind, refused }) => {
  const f = fixture();
  try {
    source(f);
    const operation = { operationId: id, source: kind === 'run' ? { kind, runId: randomUUID() } : { kind }, at,
      change: kind === 'run' ? { kind: 'patch', expectedVersion: 1, key: '10000001', values: { eid: '10000001' } }
        : { kind: 'metadata', expectedVersion: 1, metadata: { typeId: 'general', sharePoint: null } } };
    f.repository.enqueue('library', operation);
    const before = rows(f), layout = f.database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
    if (refused) {
      expect(() => upgrade(f)).toThrow(/workflow_workbook_selection_pending_library_operation/u);
      expect(f.database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all()).toEqual(layout);
    } else { upgrade(f); expect(f.repository.lastUsed('person-lookup')).toBeUndefined(); }
    expect(rows(f)).toEqual(before);
    const pending = f.database.prepare('SELECT digest,request_json,receipt_json FROM workbook_operations').get();
    expect(pending).toEqual({ digest: sha256Hex(canonicalJsonStringify(operation)), request_json: canonicalJsonStringify(operation), receipt_json: null });
  } finally { f.database.close(); }
});

it('binds the pending-operation guard to the plan digest while retaining historical 23 as a distinct target', () => {
  const fingerprint = '1'.repeat(64);
  expect(deriveAuthorityUpgradePlanDigest(7, fingerprint, 8)).toBe('61f8506ea8223f57ea6e272847da8cf4eb384f9b1a0de118932f277eda9d71d6');
  expect(deriveAuthorityUpgradePlanDigest(7, fingerprint, 23)).not.toBe(deriveAuthorityUpgradePlanDigest(7, fingerprint));
  expect(deriveAuthorityUpgradePlanDigest(24, fingerprint, 25)).not.toBe(deriveAuthorityUpgradePlanDigest(24, fingerprint));
});

function capturedPatch() {
  return { operationId: 'captured-patch', source: { kind: 'run-reference', runId: '11111111-1111-4111-8111-111111111111', referenceDigest: 'a'.repeat(64),
    authority: { versionId: 'original', sheetId: 'people', keyFieldId: 'email', requiredFields: ['email', 'eid'], writableFields: ['eid'] } }, at,
    change: { kind: 'patch', expectedVersion: 1, selection: { sheetId: 'people', rowId: 'person', expectedVersion: 1 }, key: 'example@example.test', values: { eid: '10000001' } } };
}
function capturedSource(f: ReturnType<typeof fixture>, extra: Record<string, unknown> = {}, eid: string | null = null) {
  return f.repository.create(SavedWorkbookSchema.parse({ libraryId: 'library', version: 1, createdAt: at, savedAt: at,
    workbook: { libraryId: 'library', name: 'Roster.xlsx', themes: [], hasFormulas: false, ...extra,
      sheets: [{ id: 'people', name: 'People', width: 2, hidden: [], headerRow: 1,
        columnBindings: ['email', 'eid'].map((fieldId, index) => ({ id: fieldId, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: 'manual' })),
        rows: [{ id: 'header', cells: [{ value: 'Email' }, { value: 'EID' }] },
          { id: 'person', cells: [{ value: 'example@example.test' }, { value: eid }] }] }] } }));
}

it('applies captured write authority to a General workbook and replays its historical revision and receipt without type ownership', () => {
  const f = fixture(25);
  try {
    capturedSource(f);
    const operation = capturedPatch();
    expect(CapturedWorkbookWriteSourceSchema.parse(operation.source)).toEqual(operation.source);
    expect(WorkbookOperationSchema.parse(operation)).toEqual(operation);
    const first = f.repository.operation('library', operation);
    expect(first.state).toBe('applied');
    expect(first.changes).toEqual([{ sheetId: 'people', rowId: 'person', fieldId: 'eid', key: 'example@example.test', oldValue: null, newValue: '10000001' }]);
    expect(f.repository.metadata('library').typeId).toBe('general');
    const second = f.repository.read('library');
    expect(second?.version).toBe(2);
    expect(f.repository.libraryState('library').versions.at(-1)?.source).toBe('workflow');
    expect(f.repository.runOperations(operation.source.runId)[0].operation).toEqual(operation);
    expect(f.repository.operation('library', operation)).toEqual(first);
    const current = f.repository.read('library');
    if (!current) throw new Error('current fixture required');
    f.repository.save({ ...current, version: 3, workbook: { ...current.workbook, name: 'Later.xlsx' } }, 2);
    expect(f.repository.revision('library', 2)).toEqual(second);
    expect(f.repository.journal('library')[0]).toEqual(first);
  } finally { f.database.close(); }
});

it.each(['read-field', 'foreign-sheet', 'missing-version', 'missing-selection', 'missing-cas', 'selection-cas', 'empty-values', 'duplicate-fields', 'missing-key', 'outside-required', 'extra-authority', 'add', 'operator'] as const)(
  'refuses invalid captured authority before journal effects: %s', fault => {
  const f = fixture(25);
  try {
    capturedSource(f);
    const operation = capturedPatch();
    const invalid = fault === 'read-field' ? { ...operation, change: { ...operation.change, values: { email: 'changed@example.test' } } }
      : fault === 'foreign-sheet' ? { ...operation, change: { ...operation.change, selection: { ...operation.change.selection, sheetId: 'other' } } }
      : fault === 'missing-version' ? { ...operation, source: { ...operation.source, authority: { ...operation.source.authority, versionId: undefined } } }
      : fault === 'missing-selection' ? { ...operation, change: { ...operation.change, selection: undefined } }
      : fault === 'missing-cas' ? { ...operation, change: { ...operation.change, expectedVersion: undefined } }
      : fault === 'selection-cas' ? { ...operation, change: { ...operation.change, selection: { ...operation.change.selection, expectedVersion: 2 } } }
      : fault === 'empty-values' ? { ...operation, change: { ...operation.change, values: {} } }
      : fault === 'duplicate-fields' ? { ...operation, source: { ...operation.source, authority: { ...operation.source.authority, requiredFields: ['email', 'email', 'eid'] } } }
      : fault === 'missing-key' ? { ...operation, source: { ...operation.source, authority: { ...operation.source.authority, requiredFields: ['eid'] } } }
      : fault === 'outside-required' ? { ...operation, source: { ...operation.source, authority: { ...operation.source.authority, writableFields: ['fullName'] } } }
      : fault === 'extra-authority' ? { ...operation, source: { ...operation.source, authority: { ...operation.source.authority, defaultWorkbookId: 'library' } } }
      : fault === 'add' ? { ...operation, change: { kind: 'add', sheetId: 'people', rowId: 'new-person', key: 'new@example.test', values: { eid: '10000002' } } }
      : { ...operation, source: { kind: 'operator' } };
    const before = rows(f), current = f.repository.read('library');
    expect(() => f.repository.operation('library', invalid)).toThrow();
    expect(rows(f)).toEqual(before);
    expect(f.repository.read('library')).toEqual(current);
  } finally { f.database.close(); }
});

it.each(['stale', 'prefilled', 'formula', 'unsupported'] as const)('retains captured write safety refusal for %s', fault => {
  const f = fixture(25);
  try {
    capturedSource(f, fault === 'formula' ? { hasFormulas: true } : fault === 'unsupported' ? { unsupportedMetadata: true } : {}, fault === 'prefilled' ? '10000002' : null);
    const operation = capturedPatch();
    if (fault === 'stale') { operation.change.expectedVersion = 2; operation.change.selection.expectedVersion = 2; }
    const before = f.repository.read('library');
    const receipt = f.repository.operation('library', operation);
    expect(receipt.state).toBe(fault === 'stale' || fault === 'prefilled' ? 'resolve-required' : 'refused');
    expect(receipt.reason).toBe(fault === 'stale' ? 'version-conflict' : fault === 'prefilled' ? 'operator-edited' : 'metadata-unsupported');
    expect(f.repository.read('library')).toEqual(before);
  } finally { f.database.close(); }
});


it('retains the exact JSON and digest of a predecessor workbook operation', () => {
  const bytes = "{\"at\":\"2026-11-02T00:00:00.000Z\",\"change\":{\"expectedVersion\":1,\"kind\":\"metadata\",\"metadata\":{\"sharePoint\":null,\"typeId\":\"general\"}},\"operationId\":\"retained-metadata\",\"source\":{\"kind\":\"operator\"}}";
  const parsed = WorkbookOperationSchema.parse(JSON.parse(bytes));
  expect(canonicalJsonStringify(parsed)).toBe(bytes);
  expect(sha256Hex(canonicalJsonStringify(parsed))).toBe('511f1b87835c06ae1db60ca44b2ad8efeffb8f786d77c2e4b94357e1eeb0b1f9');
});

it('requires resolution to retain the complete captured source authority and digest', () => {
  const f = fixture(25);
  try {
    capturedSource(f);
    const operation = capturedPatch();
    operation.change.expectedVersion = 2; operation.change.selection.expectedVersion = 2;
    const original = f.repository.operation('library', operation);
    expect(original.state).toBe('resolve-required');
    const resolving = { ...capturedPatch(), operationId: 'resolve-captured',
      change: { ...capturedPatch().change, resolves: { operationId: operation.operationId, receiptDigest: sha256Hex(canonicalJsonStringify(original)) } } };
    const altered = { ...resolving, source: { ...resolving.source, authority: { ...resolving.source.authority, writableFields: ['email', 'eid'] } } };
    expect(() => f.repository.operation('library', altered)).toThrow(expect.objectContaining({ code: 'WORKBOOK_OPERATION_CONFLICT' }));
    expect(f.repository.operation('library', resolving).state).toBe('applied');
    expect(f.repository.runOperations(operation.source.runId)).toHaveLength(2);
  } finally { f.database.close(); }
});
