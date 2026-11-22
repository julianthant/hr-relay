// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { WorkbookLibraryEntrySchema } from '../../../../../src/models/dashboard/workbook-library.js';
import type { EditableWorkbook } from '../../../../../src/rules/spreadsheets/workbook-io.js';
import { ToastProvider, TooltipProvider } from '../../../../../src/dashboard/ds/ui.js';

const wiring = vi.hoisted(() => ({ adapter: {} as Record<string, ReturnType<typeof vi.fn>>, catalog: [] as unknown[], loading: false, error: undefined as string | undefined, pending: [] as string[], draft: undefined as { document: EditableWorkbook } | undefined }));
const LINK = 'https://contoso.sharepoint.com/sites/hr/roster.xlsx';
const version = (id: string, n: number) => ({ id, name: `v${n}`, snapshotId: id, version: n, savedAt: `2026-11-0${n}T00:00:00Z`, source: 'operator' });
const make = (libraryId: string, name: string, options: { pinned?: boolean; linked?: boolean } = {}) => WorkbookLibraryEntrySchema.parse({ libraryId, version: 2, name, updatedAt: '2026-11-02T00:00:00Z', rowCount: 1,
  worksheets: [{ id: 'people', name: 'People' }], metadata: { typeId: 't', sharePoint: options.linked ? { url: LINK, verifiedAt: '2026-11-01T00:00:00Z' } : null },
  type: { id: 't', name: 'Roster', keyFieldId: 'email', fields: ['email'], defaultWorkbookId: 'roster' },
  state: { libraryId, revision: 1, selectedVersionId: 'v2', removed: false, origin: { kind: 'local' }, pinned: options.pinned ?? false, tags: [], versions: [version('v1', 1), version('v2', 2)] } });
vi.mock('../../../../../src/dashboard/state/spreadsheet-wiring-adapter.js', () => ({
  useSpreadsheetWiringAdapter: () => ({ adapter: wiring.adapter, catalog: wiring.catalog, compatibility: undefined, catalogLoading: wiring.loading,
    catalogError: wiring.error, openError: undefined, draft: wiring.draft, pendingLibraries: wiring.pending }),
}));
vi.mock('../../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-import-client.js', () => ({ importSpreadsheetInWorker: () => new Promise<never>(() => {}) }));
const { SheetsV2 } = await import('../../../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2.js');

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  wiring.adapter = { changeLibrary: vi.fn(async () => ({ state: 'refused', message: 'No.' })), refreshCatalog: vi.fn(async () => undefined), snapshot: vi.fn(() => ({ pendingLibraries: [] })) };
  wiring.catalog = [make('roster', 'Roster.xlsx', { pinned: true, linked: true })];
  wiring.loading = false; wiring.error = undefined; wiring.pending = []; wiring.draft = undefined;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
const render = () => act(async () => root?.render(createElement(ToastProvider, null, createElement(TooltipProvider, null, createElement(SheetsV2)))));
const click = (element: Element | null | undefined) => { assert.ok(element); return act(async () => { (element as HTMLElement).click(); }); };

it('draws nothing while the list is first read: a busy region, no guessed search bar, table or rows', async () => {
  wiring.loading = true; await render();
  const frame = host.querySelector('[role="status"][aria-busy="true"][aria-label="Loading spreadsheets"]');
  assert.ok(frame);
  assert.equal(frame.childElementCount, 0);
  assert.equal(host.querySelector('[data-slot="skeleton"], .ds-table-toolbar, .sv2-card, .sv2-row'), null);
});

it('shows an opening sheet\'s heading at once and a loading frame only where its grid will be', async () => {
  await render();
  await click(host.querySelector('li[aria-label="Roster.xlsx"]'));
  const frame = host.querySelector('[role="status"][aria-busy="true"][aria-label="Opening Roster.xlsx"]');
  assert.ok(frame);
  const heading = [...host.querySelectorAll('h1')].find(node => node.textContent === 'Roster.xlsx');
  assert.ok(heading, 'the name is already known from the list');
  assert.equal(frame.contains(heading), false);
  assert.ok(host.querySelector('button[aria-label="Versions, now v2"]'), 'the heading actions are the opened sheet\'s');
  assert.ok(frame.querySelector('.ds-toolbar-row [data-slot="skeleton"]'), 'the grid toolbar keeps its place');
  assert.ok(frame.querySelector('.sv2-card [data-slot="skeleton"]'));
});

it('keeps the opened sheet\'s heading mounted, focus included, when its workbook arrives', async () => {
  await render();
  await click(host.querySelector('li[aria-label="Roster.xlsx"]'));
  const versions = host.querySelector<HTMLButtonElement>('button[aria-label="Versions, now v2"]');
  assert.ok(versions);
  versions.focus();
  wiring.draft = { document: { name: 'Roster.xlsx', themes: [], hasFormulas: false, sheets: [{ id: 'people', name: 'People', width: 2, hidden: [], headerRow: 1,
    columnBindings: [{ id: 'email', sourceColumn: 0, sourceHeader: 'Email', fieldId: 'email', basis: 'manual' }],
    rows: [{ id: 'header', cells: [{ value: 'Email' }, { value: 'Name' }] }, { id: 'sample', cells: [{ value: 'avery@example.test' }, { value: 'Example, Avery' }] }] }] } };
  await render();
  assert.equal(host.querySelector('[aria-label="Opening Roster.xlsx"]'), null);
  assert.ok(host.querySelector('section[aria-label="Preview"]'), 'the grid replaced the loading frame');
  assert.equal(host.querySelector('button[aria-label="Versions, now v2"]'), versions, 'the same heading node');
  assert.equal(document.activeElement, versions);
});

it('holds the picked file\'s row as a loading frame while the file is read, with Next disabled', async () => {
  await render();
  await click([...host.querySelectorAll('button')].find(node => node.textContent?.trim() === 'Import'));
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(input);
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'Large roster.csv', size: 9_000_000, arrayBuffer: async () => new ArrayBuffer(1) }] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  const frame = document.body.querySelector('[role="status"][aria-busy="true"][aria-label="Reading the file"]');
  assert.ok(frame);
  assert.equal(frame.querySelectorAll('.rounded-md.border').length, 1, 'one row, where the file will show');
  const buttons = [...document.body.querySelectorAll('button')];
  assert.equal(buttons.some(node => node.textContent?.trim() === 'Choose file'), false);
  assert.equal(buttons.find(node => node.textContent?.trim() === 'Next')?.disabled, true);
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
  assert.match(host.textContent ?? '', /No spreadsheets yet/);
  assert.ok([...host.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Import' && button.closest('header') === null));
});

it('hides the search box in an empty library', async () => {
  wiring.catalog = []; await render();
  assert.equal(host.querySelector('input[aria-label="Search spreadsheets"]'), null);
});
