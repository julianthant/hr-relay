// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { it } from 'vitest';
import { SavedWorkbookSchema, type SavedWorkbook } from '../../../../src/models/dashboard/workbooks.js';
import { newEditableWorkbook } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { useSpreadsheetVersions } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-versions-model.js';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
it('reloads a reopened history and excludes a late result from the previous request', async () => {
  const host = document.createElement('div'), root = createRoot(host);
  const pending: { resolve: (records: SavedWorkbook[]) => void; reject: (error: Error) => void }[] = [];
  const read = () => new Promise<SavedWorkbook[]>((resolve, reject) => pending.push({ resolve, reject }));
  let held: ReturnType<typeof useSpreadsheetVersions> | undefined;
  const state = () => { assert(held); return held; };
  function Probe({ id }: { id: string | null }) { held = useSpreadsheetVersions(id, read); return null; }
  const record = SavedWorkbookSchema.parse({ libraryId: 'book', version: 1, createdAt: '2026-10-01T00:00:00Z', savedAt: '2026-10-01T00:00:00Z', workbook: { ...newEditableWorkbook(), libraryId: 'book' } });
  try {
    await act(async () => root.render(createElement(Probe, { id: 'book' })));
    await act(async () => pending[0].resolve([record])); assert.equal(state().state, 'loaded');
    await act(async () => root.render(createElement(Probe, { id: null })));
    await act(async () => root.render(createElement(Probe, { id: 'book' }))); assert.equal(state().state, 'loading');
    await act(async () => root.render(createElement(Probe, { id: 'other' })));
    await act(async () => pending[1].resolve([record])); assert.equal(state().state, 'loading');
    await act(async () => pending[2].reject(new Error('History unavailable')));
    assert.deepEqual(state(), { request: { libraryId: 'other', read }, state: 'failed', message: 'History unavailable' });
  } finally { await act(async () => root.unmount()); }
});
