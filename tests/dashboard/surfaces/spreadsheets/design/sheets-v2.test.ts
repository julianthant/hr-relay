// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { WorkbookLibraryEntrySchema } from '../../../../../src/models/dashboard/workbook-library.js';
import { ToastProvider, TooltipProvider } from '../../../../../src/dashboard/ds/ui.js';

const wiring = vi.hoisted(() => ({ catalogLoading: false }));
const entry = WorkbookLibraryEntrySchema.parse({ libraryId: 'roster', version: 1, name: 'Roster.xlsx', updatedAt: '2026-11-01T00:00:00Z', rowCount: 1,
  worksheets: [{ id: 'people', name: 'People' }], metadata: { typeId: 'roster-type', sharePoint: null },
  type: { id: 'roster-type', name: 'Roster', keyFieldId: 'email', fields: ['email'], defaultWorkbookId: 'roster' },
  state: { libraryId: 'roster', revision: 1, selectedVersionId: 'current', removed: false, origin: { kind: 'local' },
    versions: [{ id: 'current', name: 'current', snapshotId: 'current', version: 1, savedAt: '2026-11-01T00:00:00Z', source: 'operator' }] } });
vi.mock('../../../../../src/dashboard/state/spreadsheet-wiring-adapter.js', () => ({
  useSpreadsheetWiringAdapter: () => ({ adapter: {}, catalog: wiring.catalogLoading ? [] : [entry], compatibility: undefined, catalogLoading: wiring.catalogLoading,
    catalogError: undefined, openError: undefined, draft: undefined, pendingLibraries: [] }),
}));
const { SheetsV2 } = await import('../../../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2.js');

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
let host: HTMLElement;
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => root?.render(createElement(ToastProvider, null, createElement(TooltipProvider, null, createElement(SheetsV2)))));

it('shows a skeleton while the spreadsheet list loads', async () => {
  wiring.catalogLoading = true;
  await render();
  const loading = host.querySelector('[role="status"][aria-busy="true"][aria-label="Loading spreadsheets"]');
  assert.ok(loading, 'a labelled loading region');
  assert.ok(loading.querySelector('[data-slot="skeleton"]'), 'skeleton rows');
  assert.doesNotMatch(host.textContent ?? '', /Loading spreadsheets…/u);
});

it('shows a skeleton while an opened spreadsheet loads', async () => {
  wiring.catalogLoading = false;
  await render();
  const row = host.querySelector<HTMLElement>('li[aria-label="Roster.xlsx"]'); assert.ok(row);
  await act(async () => row.click());
  assert.ok(host.querySelector('[role="status"][aria-busy="true"][aria-label="Opening Roster.xlsx"]'), 'a labelled loading region');
  assert.doesNotMatch(host.textContent ?? '', /Opening…|Back/u);
});
