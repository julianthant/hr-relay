// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { WorkbookLibraryEntrySchema } from '../../../../../src/models/dashboard/workbook-library.js';
import { ToastProvider, TooltipProvider } from '../../../../../src/dashboard/ds/ui.js';

const wiring = vi.hoisted(() => ({ adapter: {} as Record<string, ReturnType<typeof vi.fn>>, catalog: [] as unknown[], loading: false, error: undefined as string | undefined, pending: [] as string[] }));
const LINK = 'https://contoso.sharepoint.com/sites/hr/roster.xlsx';
const version = (id: string, n: number) => ({ id, name: `v${n}`, snapshotId: id, version: n, savedAt: `2026-11-0${n}T00:00:00Z`, source: 'operator' });
const make = (libraryId: string, name: string, options: { pinned?: boolean; linked?: boolean } = {}) => WorkbookLibraryEntrySchema.parse({ libraryId, version: 2, name, updatedAt: '2026-11-02T00:00:00Z', rowCount: 1,
  worksheets: [{ id: 'people', name: 'People' }], metadata: { typeId: 't', sharePoint: options.linked ? { url: LINK, verifiedAt: '2026-11-01T00:00:00Z' } : null },
  type: { id: 't', name: 'Roster', keyFieldId: 'email', fields: ['email'], defaultWorkbookId: 'roster' },
  state: { libraryId, revision: 1, selectedVersionId: 'v2', removed: false, origin: { kind: 'local' }, pinned: options.pinned ?? false, tags: [], versions: [version('v1', 1), version('v2', 2)] } });
vi.mock('../../../../../src/dashboard/state/spreadsheet-wiring-adapter.js', () => ({
  useSpreadsheetWiringAdapter: () => ({ adapter: wiring.adapter, catalog: wiring.catalog, compatibility: undefined, catalogLoading: wiring.loading,
    catalogError: wiring.error, openError: undefined, draft: undefined, pendingLibraries: wiring.pending }),
}));
const { SheetsV2 } = await import('../../../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2.js');

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  wiring.adapter = { changeLibrary: vi.fn(async () => ({ state: 'refused', message: 'No.' })), refreshCatalog: vi.fn(async () => undefined), snapshot: vi.fn(() => ({ pendingLibraries: [] })) };
  wiring.catalog = [make('roster', 'Roster.xlsx', { pinned: true, linked: true })];
  wiring.loading = false; wiring.error = undefined; wiring.pending = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
const render = () => act(async () => root?.render(createElement(ToastProvider, null, createElement(TooltipProvider, null, createElement(SheetsV2)))));
const click = (element: Element | null | undefined) => { assert.ok(element); return act(async () => { (element as HTMLElement).click(); }); };

it('shows a loading frame with the table header', async () => {
  wiring.loading = true; await render();
  assert.ok(host.querySelector('[role="status"][aria-label="Loading spreadsheets"] .sv2-head'));
});

it('shows a failure notice with one Retry button when the list cannot be read', async () => {
  wiring.error = 'down'; await render();
  assert.match(host.textContent ?? '', /Couldn't load spreadsheets\./);
  const retry = [...host.querySelectorAll('button')].filter(node => node.textContent?.trim() === 'Retry');
  assert.equal(retry.length, 1);
  await click(retry[0]);
  assert.equal(wiring.adapter.refreshCatalog.mock.calls.length, 1);
});

it('titles a failed sync as a sync', async () => {
  await render();
  await click(host.querySelector('button[aria-label="Actions for Roster.xlsx"]'));
  await click([...document.body.querySelectorAll('[role="menuitem"]')].find(node => node.textContent?.trim() === 'Sync now'));
  assert.match(document.body.textContent ?? '', /Couldn't sync Roster\.xlsx/);
  assert.doesNotMatch(document.body.textContent ?? '', /Couldn't save the change/);
});

it('puts the unconfirmed notice under the heading, not above it', async () => {
  wiring.pending = ['roster']; await render();
  const heading = host.querySelector('h1');
  assert.ok(heading);
  const notice = [...host.querySelectorAll('span')].find(node => /isn't confirmed yet/.test(node.textContent ?? ''));
  assert.ok(notice);
  assert.ok(heading.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING);
});

it('offers Import inside an empty library', async () => {
  wiring.catalog = []; await render();
  assert.ok(host.querySelector('[class*="border-ui-stroke"] button')?.textContent?.includes('Import'));
});

it('hides the search box in an empty library', async () => {
  wiring.catalog = []; await render();
  assert.equal(host.querySelector('input[aria-label="Search spreadsheets"]'), null);
});
