import assert from 'node:assert/strict';
import { it } from 'vitest';
import { WorkbookLibraryChangeSchema, WorkbookLibraryStateSchema } from '../../../src/models/dashboard/workbook-library.js';

const state = { libraryId: 'roster', revision: 1, selectedVersionId: 'original', removed: false, origin: { kind: 'local' },
  versions: [{ id: 'original', snapshotId: '["roster","original"]', name: 'Original version', version: 1, savedAt: '2026-11-02T00:00:00.000Z', source: 'import' }] };

it('requires pin and manual tags on every library state', () => {
  assert.equal(WorkbookLibraryStateSchema.safeParse(state).success, false);
  assert.deepEqual(WorkbookLibraryStateSchema.parse({ ...state, pinned: true, tags: ['Payroll'] }), { ...state, pinned: true, tags: ['Payroll'] });
});

it('accepts pin, unpin and trimmed unique set-tags changes only', () => {
  for (const change of [{ kind: 'pin' }, { kind: 'unpin' }, { kind: 'set-tags', tags: [] }, { kind: 'set-tags', tags: ['Fall hires', 'Payroll'] }]) {
    assert.equal(WorkbookLibraryChangeSchema.safeParse(change).success, true, JSON.stringify(change));
  }
  for (const tags of [[''], [' Payroll'], ['Payroll', 'payroll'], ['x'.repeat(41)], Array.from({ length: 21 }, (_, index) => `tag ${index}`)]) {
    assert.equal(WorkbookLibraryChangeSchema.safeParse({ kind: 'set-tags', tags }).success, false, JSON.stringify(tags));
  }
  assert.equal(WorkbookLibraryChangeSchema.safeParse({ kind: 'pin', pinned: true }).success, false);
});
