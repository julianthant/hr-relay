import { expect, it } from 'vitest';
import { deriveSchemaHash } from '../../../src/models/validation/schema-bound-value.js';
import { canonicalJsonStringify } from '../../../src/rules/validation/canonical-json.js';
import { sha256Hex } from '../../../src/rules/validation/sha256.js';
import { FingerprintSchema } from '../../../src/rules/identity/ids.js';
import { RunWorkbookNamedReferenceSchema, RunWorkbookNamedAllRowsReferenceSchema, bindRunWorkbookReference, parseRunWorkbookReference } from '../../../src/models/dashboard/workbooks.js';

const reference = {
  request: { typeId: 'roster', libraryId: 'library', versionId: 'fall-hires', keys: ['10000001'], fields: ['eid'] },
  snapshot: { libraryId: 'library', version: 3, versionId: 'fall-hires', versionName: 'Fall hires',
    worksheets: [{ sheetId: 'people', name: 'People' }],
    type: { id: 'roster', name: 'Roster', keyFieldId: 'eid', fields: ['eid'], defaultWorkbookId: 'library' },
    rows: [{ key: '10000001', state: 'matched', matches: [{ sheetId: 'people', rowId: 'person', values: { eid: '10000001' } }] }] },
};

it('retains a named version separately from the current workbook CAS revision', () => {
  expect(RunWorkbookNamedReferenceSchema.parse(reference)).toEqual(reference);
  expect(RunWorkbookNamedReferenceSchema.safeParse({ ...reference, snapshot: { ...reference.snapshot, versionId: 'another-version' } }).success).toBe(false);
  expect(RunWorkbookNamedReferenceSchema.safeParse({ ...reference, snapshot: { ...reference.snapshot, versionName: undefined } }).success).toBe(false);
});

it('allows default selection while retaining the exact server-selected named version', () => {
  const request = { ...reference.request, versionId: undefined };
  expect(RunWorkbookNamedReferenceSchema.parse({ ...reference, request }).snapshot.versionId).toBe('fall-hires');
});

it('retains named all-row identity under its own hash and refuses mismatched or unknown authority', () => {
  const request = { mode: 'all', typeId: 'roster', libraryId: 'library', versionId: 'fall-hires', expectedVersion: 3, fields: ['eid'] };
  const bound = bindRunWorkbookReference(request, reference.snapshot);
  expect(parseRunWorkbookReference(bound)).toEqual({ request, snapshot: reference.snapshot });
  expect(RunWorkbookNamedAllRowsReferenceSchema.safeParse({ request, snapshot: { ...reference.snapshot, versionId: 'other' } }).success).toBe(false);
  expect(RunWorkbookNamedAllRowsReferenceSchema.safeParse({ request, snapshot: { ...reference.snapshot, versionName: undefined } }).success).toBe(false);
  expect(RunWorkbookNamedAllRowsReferenceSchema.safeParse({ request, snapshot: { ...reference.snapshot, version: 4 } }).success).toBe(false);
  expect(() => parseRunWorkbookReference({ ...bound, schemaHash: FingerprintSchema.parse('a'.repeat(64)) })).toThrow();
});

it.each([false, true])('reads the published selected-keyed schema without changing retained bytes or digest; explicit=%s', explicit => {
  const schemaHash = FingerprintSchema.parse('64e6bab94d4bcf27c4e5c5328eff093840ede504eac806de297b253b51f37b7f');
  expect(deriveSchemaHash(RunWorkbookNamedReferenceSchema, 'output')).toBe(schemaHash);
  const { versionId: _requested, ...defaultRequest } = reference.request;
  const value = { ...reference, request: explicit ? reference.request : defaultRequest };
  const bound = { schemaHash, value };
  const bytes = canonicalJsonStringify(bound);
  const digest = explicit ? '4edb16b0c834168a161f714c9e069d115e8232f7536e0266213f92267bde2fbb'
    : 'bf5316868a7ef4cf6428017b4dda605d8b9424368d4218e10737cab893f19b7a';
  expect(sha256Hex(bytes)).toBe(digest);
  expect(parseRunWorkbookReference(bound)).toEqual(value);
  expect(canonicalJsonStringify(bound)).toBe(bytes);
  expect(sha256Hex(canonicalJsonStringify(bound))).toBe(digest);
  expect(() => parseRunWorkbookReference({ ...bound, schemaHash: FingerprintSchema.parse('a'.repeat(64)) })).toThrow();
  const partial = structuredClone(bound); Reflect.deleteProperty(partial.value.snapshot, 'versionName');
  expect(() => parseRunWorkbookReference(partial)).toThrow();
});

it('retains published selected-keyed acceptance of paired metadata absence', () => {
  const { versionId: _requestId, ...request } = reference.request;
  const { versionId: _sourceId, versionName: _sourceName, ...snapshot } = reference.snapshot;
  const bound = { schemaHash: FingerprintSchema.parse('64e6bab94d4bcf27c4e5c5328eff093840ede504eac806de297b253b51f37b7f'), value: { request, snapshot } };
  expect(parseRunWorkbookReference(bound)).toEqual(bound.value);
});
