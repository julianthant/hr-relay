// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act,createElement,createRef,useState } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { afterEach,beforeEach,it,vi } from 'vitest';
import { ViewNavigationContext,type ViewRoute } from '../../../../src/dashboard/app/navigation/view-route-model.js';
import { createDashboardClient,type DashboardClient } from '../../../../src/dashboard/client/index.js';
import { ToastProvider } from '../../../../src/dashboard/ds/ui.js';
import { DashboardClientProvider } from '../../../../src/dashboard/state/client-context.js';
import { useSpreadsheetWiringAdapter } from '../../../../src/dashboard/state/spreadsheet-wiring-adapter.js';
import { SettingsPage } from '../../../../src/dashboard/surfaces/settings/settings.js';
import { newEditableWorkbook } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { type EditableWorkbook } from '../../../../src/rules/spreadsheets/workbook-io.js';
import { exportSpreadsheetInWorker,importSpreadsheetInWorker } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-import-client.js';
import { SpreadsheetTypeDialog, SpreadsheetsSettings } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheets.js';
import { SavedWorkbookSchema,WorkbookTypeSchema,WorkbookCreateRequestSchema,decodeEditableWorkbook,encodeSavedWorkbook,type SavedWorkbook, type WorkbookType } from '../../../../src/models/dashboard/workbooks.js';
import { ERROR_CATALOG } from '../../../../src/models/failures/error-catalog.js';
import { WorkbookLibraryEntrySchema, type WorkbookLibraryEntry } from '../../../../src/models/dashboard/workbook-library.js';
import { FIXTURE_EDITABLE_SETTINGS } from '../../../parity/helpers/fixture-settings.js';
import { FixtureCommandBinding } from '../../../support/helpers/dashboard/command-binding.js';
import { MeasurementFreeResizeObserver } from '../../../support/helpers/settings-storage-doctor-fixtures.js';
import { spreadsheetTypeColumn } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-type-model.js';
vi.mock('../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-import-client.js', () => ({ importSpreadsheetInWorker: vi.fn(), exportSheetInWorker: vi.fn(), exportSpreadsheetInWorker: vi.fn() }));
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal('ResizeObserver', MeasurementFreeResizeObserver); });
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (name: string) => { const node = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name); assert(node, name); return node; };
const click = (name: string) => act(async () => button(name).click());
async function menu(name: string, item: string) {
  await click(name); const entry = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(node => node.textContent?.trim() === item); assert(entry, item); await act(async () => entry.click());
}
async function edit(value: string) {
  const cell = document.querySelector<HTMLInputElement>('input[aria-label="A2"]'); assert(cell);
  await act(async () => { cell.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(cell, value); cell.dispatchEvent(new Event('input', { bubbles: true })); });
}
function workbookRequest(body: unknown) {
  assert(body && typeof body === "object");
  const workbook: unknown = Reflect.get(body, "workbook");
  return WorkbookCreateRequestSchema.parse({ workbook }).workbook;
}
const rosterType = { id: 'roster', name: 'Roster', keyFieldId: 'eid', fields: ['eid'], defaultWorkbookId: null };
function catalogEntry(record: SavedWorkbook) {
  return WorkbookLibraryEntrySchema.parse({ libraryId: record.libraryId, version: record.version, name: record.workbook.name,
    rowCount: 0, worksheets: record.workbook.sheets.map(sheet => ({ id: sheet.id, name: sheet.name })),
    type: rosterType, metadata: { typeId: rosterType.id, sharePoint: null }, state: { libraryId: record.libraryId, revision: record.version,
      origin: { kind: 'local' }, removed: false, selectedVersionId: 'current', versions: [{ id: 'current', name: 'Current version',
        snapshotId: 'current', version: record.version, savedAt: record.savedAt, source: 'operator' }] } });
}
function world() {
  const base = newEditableWorkbook();
  let record: SavedWorkbook = SavedWorkbookSchema.parse({ libraryId: 'served-book', version: 2, createdAt: '2026-10-01T00:00:00Z', savedAt: '2026-10-15T00:00:00Z', workbook: { ...base, name: 'Served.xlsx', libraryId: 'served-book' } });
  let outcome: 'ok' | 'lost' | 'conflict' = 'ok';
  let postGate: Promise<void> | undefined;
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const clientOptions: Parameters<typeof createDashboardClient>[0] = { baseUrl: 'http://spreadsheets.test', fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname; const method = init?.method ?? 'GET'; const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined; calls.push({ path, method, body });
    if (path.endsWith('/settings/editable')) return Response.json(FIXTURE_EDITABLE_SETTINGS);
    if (path.endsWith('/catalog')) return Response.json([catalogEntry(record)]);
    if (path.endsWith('/types')) return Response.json([rosterType]);
    if (method === 'POST') {
      await postGate;
      if (outcome === 'lost') throw new Error('lost response');
      if (outcome === 'conflict') return Response.json({ state: 'error', code: 'WORKBOOK_VERSION_CONFLICT', message: 'Workbook changed.', retryable: false }, { status: 409 });
      const create = path === '/api/v1/workbooks';
      record = { ...record, createdAt: create ? record.savedAt : record.createdAt, libraryId: create ? 'generated' : record.libraryId, version: create ? 1 : record.version + 1, workbook: { ...decodeEditableWorkbook(workbookRequest(body)), libraryId: create ? 'generated' : record.libraryId } };
      return Response.json(encodeSavedWorkbook(record), { status: create ? 201 : 200 });
    }
    return Response.json(path.endsWith('/list') ? [encodeSavedWorkbook(record)] : encodeSavedWorkbook(record));
  } };
  const client = createDashboardClient(clientOptions);
  return { client, newClient: () => createDashboardClient(clientOptions), calls, pausePosts() { let release!: () => void; postGate = new Promise(resolve => { release = resolve; }); return release; }, outcome(value: typeof outcome) { outcome = value; } };
}
async function page(client: DashboardClient, initialView: ViewRoute = {}) {
  let view = initialView;
  let latest: { book: EditableWorkbook | null; dirty: boolean } = { book: null, dirty: false };
  let toggleChild!: (show: boolean) => void;
  function Harness() {
    const [shown, setShown] = useState(true); toggleChild = setShown;
    const [route, setRoute] = useState(view); const [draft, setDraft] = useState(latest);
    return createElement(DashboardClientProvider, { client, children: createElement(ViewNavigationContext.Provider, { value: { view: route, start: false, setStart() {}, update(patch) { view = { ...view, ...patch }; setRoute(view); } }, children: shown ? createElement(SpreadsheetsSettings, { workbook: draft.book, workbookDirty: draft.dirty, onWorkbook(book, dirty) { latest = { book, dirty }; setDraft(latest); } }) : null }) });
  }
  const mount = async () => { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root?.render(createElement(ToastProvider, { children: createElement(Harness) }))); };
  await mount();
  return { latest: () => latest, view: () => view, async remountChild() { await act(async () => toggleChild(false)); await act(async () => toggleChild(true)); }, async remount() { await act(async () => root?.unmount()); document.body.replaceChildren(); latest = { book: null, dirty: false }; await mount(); } };
}
it('mounts the served list/open, performs CAS and readback, and retains a conflict draft', async () => {
  const w = world(); const p = await page(w.client); assert(button('Open Served.xlsx')); assert(!document.body.textContent?.includes('Student applicants'));
  await click('Open Served.xlsx'); assert.equal(p.latest().book?.libraryId, 'served-book');
  await edit('Ada'); await click('Save'); assert.match(document.body.textContent, /Saved · version 3/); assert.equal(p.latest().dirty, false);
  const posts = w.calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 1); assert.equal((posts[0].body as { expectedVersion: number }).expectedVersion, 2);
  assert.equal(w.calls[w.calls.indexOf(posts[0]) + 1]?.path, '/api/v1/workbooks/served-book');
  w.outcome('conflict'); await edit('Grace'); const draft = p.latest().book; await click('Save'); assert.match(document.body.textContent, /Save version conflict/); assert.equal(p.latest().book, draft); assert(p.latest().dirty);
});
it('retains UNKNOWN through edits and remount and repeated Save clicks only read', async () => {
  const w = world(); const p = await page(w.client, { spreadsheet: 'served-book' }); await edit('Ada'); w.outcome('lost'); await click('Save'); assert.match(document.body.textContent, /Save uncertain/);
  await edit('Grace'); await p.remount(); assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, 'Grace'); await click('Save'); await click('Save');
  assert.equal(w.calls.filter(call => call.method === 'POST').length, 1); assert(p.latest().dirty); assert.match(document.body.textContent, /Save uncertain/);
});
async function importDraft() {
  vi.mocked(importSpreadsheetInWorker).mockResolvedValue(newEditableWorkbook());
  const input = document.querySelector<HTMLInputElement>('input[type=file]'); assert(input);
  const file = new File(['fixture'], 'Untitled.xlsx'); Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(0) });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await click('Import selected columns');
}
it.each([
  ['SPREADSHEET_SIZE_UNSUPPORTED: This workbook has 250,001 populated cells. Relay supports up to 250,000 populated cells per workbook. Split the data into smaller files and import them separately.', /250,001 populated cells.*250,000.*Split/su],
  ['SPREADSHEET_TOO_LARGE: maximum file size is 20 MB.', /larger than 20 MB.*Split/su],
  ['SPREADSHEET_FORMAT_UNSUPPORTED: choose XLSX or CSV.', /Choose an XLSX or CSV file/su],
  ['SPREADSHEET_WORKER_FAILED', /save a new XLSX or CSV copy/su],
])('shows actionable import feedback for %s and permits another file', async (message, expected) => {
  const w = world(), p = await page(w.client);
  vi.mocked(importSpreadsheetInWorker).mockRejectedValueOnce(new Error(message));
  const input = document.querySelector<HTMLInputElement>('input[type=file]'); assert(input);
  const file = new File(['fixture'], 'Rejected.xlsx'); Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(0) });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  const alert = document.querySelector('[role=alert]'); assert(alert);
  assert.match(alert.textContent ?? '', expected);
  assert.doesNotMatch(alert.textContent ?? '', /SPREADSHEET_/u);
  assert.equal(p.latest().book, null);
  assert.equal(w.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(input.disabled, false);
  await importDraft();
  assert(p.latest().book);
  assert(!document.querySelector('[role=alert]'));
});
it('keeps an imported draft local until Save, adopts the generated ID and preserves local undo/redo', async () => {
  const w = world(); const p = await page(w.client); await importDraft(); assert.equal(w.calls.filter(call => call.method === 'POST').length, 0); assert.equal(p.latest().book?.libraryId, undefined);
  await edit('Ada'); await click('Save'); assert.match(document.body.textContent, /Saved · version 1/); assert.equal(p.latest().book?.libraryId, 'generated'); assert.equal(p.view().spreadsheet, 'generated'); assert.equal(w.calls.filter(call => call.method === 'POST').length, 1);
  await click('Undo spreadsheet edit'); assert.equal(p.latest().book?.libraryId, 'generated'); assert(p.latest().dirty); await click('Redo spreadsheet edit'); assert.equal(p.latest().book?.libraryId, 'generated');
});
it('imports reviewed columns into an editable draft without creating a library record', async () => {
  const w = world(); const p = await page(w.client); const imported = newEditableWorkbook(); vi.mocked(importSpreadsheetInWorker).mockResolvedValue({ ...imported, name: 'Imported.xlsx', sheets: imported.sheets.map(sheet => ({ ...sheet, rows: sheet.rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell, fill: undefined, background: undefined })) })) })) });
  const input = document.querySelector<HTMLInputElement>('input[type=file]'); assert(input); const file = new File(['csv'], 'Imported.xlsx'); Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(0) }); Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); assert(button('Import selected columns')); assert.equal(w.calls.filter(call => call.method === 'POST').length, 0);
  await click('Import selected columns'); assert(button('Save')); assert.equal(p.latest().book?.libraryId, undefined); assert(p.latest().dirty); assert.equal(w.calls.filter(call => call.method === 'POST').length, 0);
  await click('Save'); assert.match(document.body.textContent, /Saved · version 1/); assert.equal(p.latest().book?.libraryId, 'generated');
});
it('adopts a delayed create identity into newer edits and their history before the next CAS Save', async () => {
  const w = world(); const p = await page(w.client); await importDraft(); await edit('Ada');
  const release = w.pausePosts(); await click('Save'); await edit('Grace'); await act(async () => release());
  assert.equal(p.latest().book?.libraryId, 'generated'); assert.equal(p.view().spreadsheet, 'generated'); assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, 'Grace'); assert(p.latest().dirty); assert.doesNotMatch(document.body.textContent, /Saved · version/);
  await click('Undo spreadsheet edit'); assert.equal(p.latest().book?.libraryId, 'generated'); await click('Redo spreadsheet edit'); await click('Save');
  const writes = w.calls.filter(call => call.method === 'POST'); assert.equal(writes.length, 2); assert.equal(writes[1].path, '/api/v1/workbooks/generated/save'); assert.equal((writes[1].body as { expectedVersion: number }).expectedVersion, 1);
});
it('discards ordinary edits and rereads the saved workbook on explicit reopen', async () => {
  const w = world(); const p = await page(w.client); await click('Open Served.xlsx'); await edit('Discard me'); await click('Spreadsheets'); await click('Discard copy'); await click('Open Served.xlsx');
  assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, ''); assert.equal(p.latest().dirty, false); assert.equal(w.calls.filter(call => call.path === '/api/v1/workbooks/served-book').length, 2); assert.equal(w.calls.filter(call => call.method === 'POST').length, 0);
});
it('shows failed library authority without a mock list or a definitive empty result', async () => {
  const client = createDashboardClient({ baseUrl: 'http://spreadsheets.test', fetchImpl: async () => { throw new Error('offline'); } }); await page(client);
  assert.match(document.body.textContent, /Spreadsheet unavailable/); assert(document.body.textContent?.includes(ERROR_CATALOG.DASHBOARD_READ_FAILED.text)); assert.doesNotMatch(document.body.textContent, /No spreadsheets match|Student applicants/);
});
it('distinguishes a pending library from a verified empty library', async () => {
  const pending = Promise.withResolvers<void>();
  const client = createDashboardClient({ baseUrl: 'http://spreadsheets.test', fetchImpl: async () => { await pending.promise; return Response.json([]); } }); await page(client);
  assert.match(document.body.textContent, /Loading spreadsheets/); assert.doesNotMatch(document.body.textContent, /No spreadsheets yet/);
  await act(async () => pending.resolve()); assert.match(document.body.textContent, /No spreadsheets yet/); assert.doesNotMatch(document.body.textContent, /Loading spreadsheets/);
});
it('reopens a verified first create through its durable route with a fresh client', async () => {
  const w = world(); const p = await page(w.client); await importDraft(); await edit('Ada'); await click('Save');
  assert.equal(p.view().spreadsheet, 'generated'); assert.match(document.body.textContent, /Saved · version 1/);
  const route = JSON.parse(JSON.stringify(p.view())) as ViewRoute;
  await act(async () => root?.unmount()); document.body.replaceChildren();
  await page(w.newClient(), route); assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, 'Ada');
  assert.equal(w.calls.at(-1)?.path, '/api/v1/workbooks/generated'); assert.equal(w.calls.filter(call => call.method === 'POST').length, 1);
});
it('retains existing-workbook mapping review through child navigation and saves with its opened version', async () => {
  const w = world(); const p = await page(w.client); await click('Open Served.xlsx'); await edit('Ada'); await menu('Workbook actions', 'Edit column mappings');
  await click('Dashboard field for A');
  const aListbox = button('Dashboard field for A').getAttribute('aria-controls'); assert(aListbox);
  const notes = document.getElementById(aListbox)?.querySelector<HTMLElement>('[role="option"][data-value="roster.notes"]'); assert(notes); await act(async () => notes.click());
  await click('Dashboard field for C');
  const cListbox = button('Dashboard field for C').getAttribute('aria-controls'); assert(cListbox);
  const name = document.getElementById(cListbox)?.querySelector<HTMLElement>('[role="option"][data-value="fullName"]'); assert(name); await act(async () => name.click());
  const reviewing = p.latest().book; assert.equal(reviewing?.libraryId, undefined);
  await p.remountChild(); assert.equal(p.latest().book, reviewing); assert.doesNotMatch(document.body.textContent, /Import unavailable/);
  assert.equal(document.querySelector('[aria-label="Dashboard field for A"]')?.getAttribute('data-value'), 'roster.notes');
  await click('Import selected columns'); assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, 'Ada'); assert(p.latest().dirty);
  await click('Save'); assert.match(document.body.textContent, /Saved · version 3/);
  const writes = w.calls.filter(call => call.method === 'POST'); assert.equal(writes.length, 1); assert.equal(writes[0].path, '/api/v1/workbooks/served-book/save'); assert.equal((writes[0].body as { expectedVersion: number }).expectedVersion, 2);
});
it('exports the served draft as a download without saving or clearing its dirty authority', async () => {
  const w = world(); const p = await page(w.client); await click('Open Served.xlsx'); await edit('Ada'); const draft = p.latest().book;
  vi.mocked(exportSpreadsheetInWorker).mockResolvedValue(new ArrayBuffer(4));
  const createUrl = vi.fn(() => 'blob:spreadsheet-export'); vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = vi.fn(); });
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  await menu('Export copy', 'Excel workbook (.xlsx)'); assert.equal(vi.mocked(exportSpreadsheetInWorker).mock.calls.at(-1)?.[0], draft); assert.equal(createUrl.mock.calls.length, 1); assert.equal(download.mock.calls.length, 1);
  assert.equal(w.calls.filter(call => call.method === 'POST').length, 0); assert.equal(p.latest().book, draft); assert(p.latest().dirty); assert.match(document.body.textContent, /Edited copy/); assert.doesNotMatch(document.body.textContent, /Saved · version/);
});

for (const operation of ['list', 'open'] as const) it(`shows ${operation} loading as status and a rejected read as danger`, async () => {
  const w = world();
  const list = Promise.withResolvers<readonly WorkbookLibraryEntry[]>();
  const open = Promise.withResolvers<SavedWorkbook>();
  const client: DashboardClient = { ...w.client,
    workbookCatalog: () => operation === 'list' ? list.promise : w.client.workbookCatalog(),
    workbookOpen: id => operation === 'open' ? open.promise : w.client.workbookOpen(id) };
  await page(client, operation === 'open' ? { spreadsheet: 'served-book' } : {});
  const loading = operation === 'list' ? 'Loading spreadsheets…' : 'Loading spreadsheet…';
  assert([...document.querySelectorAll('[role="status"]')].some(node => node.textContent === loading));
  assert.doesNotMatch(document.body.textContent, /Spreadsheet unavailable/);
  await act(async () => { (operation === 'list' ? list : open).reject(new Error('Synthetic read failed')); });
  const danger = [...document.querySelectorAll('[role="alert"]')].find(node => node.textContent?.includes('Spreadsheet unavailable'));
  assert(danger); assert(danger.textContent?.includes(ERROR_CATALOG.DASHBOARD_READ_FAILED.text));
  assert.doesNotMatch(document.body.textContent, /No spreadsheets match|Synthetic read failed/);
  assert(![...document.querySelectorAll('[role="status"]')].some(node => node.textContent === loading));
});

async function settingsPage(client: DashboardClient) {
  let exitGuard: ((proceed: () => void) => void) | undefined;
  let show!: (value: boolean) => void;
  let adapter!: ReturnType<typeof useSpreadsheetWiringAdapter>["adapter"];
  function Probe() { adapter = useSpreadsheetWiringAdapter(false, null).adapter; return null; }
  function Harness() {
    const [shown, setShown] = useState(true); show = setShown;
    const [route, setRoute] = useState<ViewRoute>({ spreadsheet: 'served-book' });
    return createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId: 'local-operator', nowIso: '2026-10-16T12:00:00Z', children:
      createElement(ViewNavigationContext.Provider, { value: { view: route, start: false, setStart() {}, update(patch) { setRoute(previous => ({ ...previous, ...patch })); } }, children: createElement('div', null, createElement(Probe), shown ? createElement(SettingsPage, { profileName: "Synthetic Operator",
        onClose() {}, section: 'spreadsheets', actorId: 'local-operator', descriptorFingerprint: 'd'.repeat(64), onSection() {}, onExitGuardChange(guard) { exitGuard = guard; }
      }) : null) }) }) });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ToastProvider, { children: createElement(Harness) })));
  return {
    adapter: () => adapter,
    async discardAndExit() {
      assert(exitGuard); await act(async () => exitGuard?.(() => show(false)));
      assert.match(document.body.textContent, /Discard unsaved settings/);
      await click('Discard changes');
    },
    async reenter() { await act(async () => show(true)); }
  };
}
it('Settings confirmed Discard removes ordinary workbook edits on exit and reentry', async () => {
  const w = world(); const p = await settingsPage(w.client);
  await edit('Discard this edit');
  await p.discardAndExit(); await p.reenter();
  assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="A2"]')?.value, '');
  assert.equal(p.adapter().draft('served-book')?.dirty, false);
  assert.equal(w.calls.filter(call => call.method === 'POST').length, 0);
});
it.each(['pending', 'unknown'] as const)('Settings Discard keeps %s Save custody and never resends', async state => {
  const w = world(); const p = await settingsPage(w.client); await edit('Submitted original');
  const release = state === 'pending' ? w.pausePosts() : undefined;
  w.outcome('lost'); await click('Save');
  const adapter = p.adapter(), intent = adapter.draft('served-book')?.intent;
  assert(intent); const original = structuredClone({ draft: intent.draft, expectedVersion: intent.expectedVersion, libraryId: intent.libraryId });
  await edit('Later local edit'); await p.discardAndExit(); await p.reenter();
  assert.equal(adapter.draft('served-book')?.intent, intent);
  assert.deepEqual({ draft: intent.draft, expectedVersion: intent.expectedVersion, libraryId: intent.libraryId }, original);
  if (release) await act(async () => release());
  await click('Save'); await click('Save');
  assert.equal(w.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(adapter.draft('served-book')?.intent, intent);
  assert.match(document.body.textContent, /Save uncertain/);
});

it('opens the selected type through the mounted route and restores its trigger', async () => {
  const w = world(), p = await page(w.client), editType = button('Edit Roster');
  await act(async () => { editType.focus(); editType.click(); });
  assert.equal(p.view().spreadsheetType, 'roster');
  assert.match(document.querySelector('[role="dialog"]')?.textContent ?? '', /Edit spreadsheet type/);
  assert.equal(document.querySelector<HTMLInputElement>('input[name="spreadsheet-type-name"]')?.value, 'Roster');
  await click('Cancel'); await vi.waitFor(() => assert.equal(document.activeElement === editType, true));
  await click('Create type'); assert.equal(p.view().spreadsheetType, null);
  assert.match(document.querySelector('[role="dialog"]')?.textContent ?? '', /Create spreadsheet type/);
  assert.equal(document.querySelector<HTMLInputElement>('input[name="spreadsheet-type-name"]')?.value, '');
  assert.equal(w.calls.filter(call => call.method === 'POST').length, 0);
});

it('edits a 31-column type, required fields and membership through the mounted dialog', async () => {
  const columns = Array.from({ length: 31 }, (_, index) => spreadsheetTypeColumn(`Synthetic ${index + 1}`));
  const type: WorkbookType = { id: 'wide', name: 'Synthetic roster', keyFieldId: null, defaultWorkbookId: null,
    fields: columns.map(column => column.id), fieldLabels: Object.fromEntries(columns.map(column => [column.id, column.name])) };
  let saved: WorkbookType | undefined;
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ToastProvider, null, createElement(SpreadsheetTypeDialog, {
    open: true, onOpenChange: () => undefined, type, returnFocus: createRef<HTMLButtonElement>(),
    onSave: async value => { saved = value; return { state: 'confirmed' }; },
  }))));
  assert.equal(document.querySelectorAll('input[aria-label^="Column "]').length, 31);
  const first = document.querySelector<HTMLInputElement>('input[aria-label="Column 1 name"]'); assert(first);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(first, 'Renamed column'); first.dispatchEvent(new Event('input', { bubbles: true })); });
  const required = document.querySelector<HTMLElement>('[role="checkbox"]'); assert(required);
  await act(async () => required.click()); await click('Remove column 31'); await click('Save type');
  assert.equal(saved?.fields.length, 30); assert.equal(saved?.fieldLabels?.[columns[0].id], 'Renamed column');
  assert.deepEqual(saved?.requiredFields, [columns[0].id]); assert(!saved?.fields.includes(columns[30].id));
});

it.each(['Employee ID', 'UCPath Empl ID'])('keeps the existing EID when imported header %s resolves to it', async header => {
  const workbook = newEditableWorkbook();
  const imported = { ...workbook, sheets: workbook.sheets.map(sheet => ({ ...sheet, rows: [{ ...sheet.rows[0], cells: [{ value: header }, { value: 'Notes' }, { value: 'Other' }] }, ...sheet.rows.slice(1)] })) };
  let saved: WorkbookType | undefined;
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ToastProvider, null, createElement(SpreadsheetTypeDialog, {
    open: true, onOpenChange: () => undefined, workbook: imported, returnFocus: createRef<HTMLButtonElement>(),
    onSave: async value => { saved = value; return { state: 'confirmed' }; },
  }))));
  const input = (label: string) => { const node = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`); assert(node); return node; };
  const fill = async (node: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
  const columnNames = () => [...document.querySelectorAll<HTMLInputElement>('input[aria-label^="Column "]')].map(node => node.value);
  const checks = () => [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')];
  const selectHeader = async (value: string) => {
    const select = document.querySelector<HTMLElement>('[role="dialog"] [role="combobox"]'); assert(select);
    await act(async () => select.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.trim() === value); assert(option);
    await act(async () => option.click());
  };
  const name = document.querySelector<HTMLInputElement>('input[name="spreadsheet-type-name"]'); assert(name);
  await fill(name, 'Synthetic roster'); await fill(input('Column 3 name'), 'Payroll identifier');
  assert.equal(checks().length, 3); await act(async () => checks()[2].click());
  await selectHeader(header); await click('Add selected header');
  assert.deepEqual(columnNames(), ['First Name', 'Last Name', 'Payroll identifier']);
  assert.equal(checks()[2].getAttribute('aria-checked'), 'true');
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /already included as “Payroll identifier”/u);
  assert.equal(saved, undefined);
  await selectHeader('Notes'); await click('Add selected header');
  await fill(input('Column 4 name'), 'Team notes'); await act(async () => checks()[3].click());
  await fill(input('Column 3 name'), 'Payroll ID');
  assert.deepEqual(columnNames(), ['First Name', 'Last Name', 'Payroll ID', 'Team notes']);
  assert.equal(checks()[2].getAttribute('aria-checked'), 'true');
  assert.equal(checks()[3].getAttribute('aria-checked'), 'true');
  await click('Remove column 4'); await click('Remove column 2'); await fill(input('Column 1 name'), 'Given name');
  assert.deepEqual(columnNames(), ['Given name', 'Payroll ID']);
  assert.equal(checks()[1].getAttribute('aria-checked'), 'true');
  await click('Save type');
  const result = WorkbookTypeSchema.parse(saved);
  assert.equal(result.name, 'Synthetic roster'); assert.equal(result.keyFieldId, 'eid'); assert.equal(result.defaultWorkbookId, null);
  assert.deepEqual(result.fields, ['firstName', 'eid']);
  assert.deepEqual(result.fieldLabels, { firstName: 'Given name', eid: 'Payroll ID' });
  assert.deepEqual(result.requiredFields, ['eid']);
});

it('reopens a pending type on Check result with its name locked', async () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const type = { id: 'roster', name: 'Roster', keyFieldId: 'eid', fields: ['eid'], defaultWorkbookId: null };
  let checks = 0;
  await act(async () => root?.render(createElement(ToastProvider, null, createElement(SpreadsheetTypeDialog, {
    open: true, onOpenChange: () => undefined, type, returnFocus: createRef<HTMLButtonElement>(), pending: true,
    onSave: async value => { assert.deepEqual(value, type); checks++; return { state: 'confirmed' }; },
  }))));
  const name = document.querySelector<HTMLInputElement>('input[name="spreadsheet-type-name"]');
  assert.equal(name?.disabled, true); assert.match(document.body.textContent, /not yet confirmed/);
  await vi.waitFor(() => assert.equal(document.activeElement, button('Check result')));
  assert.equal(checks, 0); await click('Check result'); assert.equal(checks, 1);
});
