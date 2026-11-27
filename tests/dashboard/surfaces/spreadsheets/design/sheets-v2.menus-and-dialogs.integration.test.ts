// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { WorkbookLibraryEntrySchema } from '../../../../../src/models/dashboard/workbook-library.js';
import { ToastProvider, TooltipProvider } from '../../../../../src/dashboard/ds/ui.js';

const wiring = vi.hoisted(() => ({ adapter: {} as Record<string, ReturnType<typeof vi.fn>>, catalog: [] as unknown[] }));
const LINK = 'https://contoso.sharepoint.com/sites/hr/roster.xlsx';
const version = (id: string, n: number) => ({ id, name: `v${n}`, snapshotId: id, version: n, savedAt: `2026-11-0${n}T00:00:00Z`, source: 'operator' });
const make = (libraryId: string, name: string, options: { pinned?: boolean; linked?: boolean; sync?: unknown } = {}) => WorkbookLibraryEntrySchema.parse({ libraryId, version: 2, name, updatedAt: '2026-11-02T00:00:00Z', rowCount: 1, ...(options.sync ? { sync: options.sync } : {}),
  worksheets: [{ id: 'people', name: 'People' }], metadata: { typeId: 't', sharePoint: options.linked ? { url: LINK, verifiedAt: '2026-11-01T00:00:00Z' } : null },
  type: { id: 't', name: 'Roster', keyFieldId: 'email', fields: ['email'], defaultWorkbookId: 'roster' },
  state: { libraryId, revision: 1, selectedVersionId: 'v2', removed: false, origin: { kind: 'local' }, pinned: options.pinned ?? false, tags: [], versions: [version('v1', 1), version('v2', 2)] } });
vi.mock('../../../../../src/dashboard/state/spreadsheet-wiring-adapter.js', () => ({
  useSpreadsheetWiringAdapter: () => ({ adapter: wiring.adapter, catalog: wiring.catalog, compatibility: undefined, catalogLoading: false,
    catalogError: undefined, openError: undefined, draft: undefined, pendingLibraries: [] }),
}));
const { SheetsV2 } = await import('../../../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2.js');

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  wiring.adapter = { changeLibrary: vi.fn(async () => ({ state: 'confirmed' })), cloneLibrary: vi.fn(async () => ({ state: 'confirmed' })), importSharePoint: vi.fn(async () => ({ state: 'confirmed' })) };
  wiring.catalog = [make('roster', 'Roster.xlsx', { pinned: true, linked: true }), make('keys', 'Keys.xlsx')];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
const render = () => act(async () => root?.render(createElement(ToastProvider, null, createElement(TooltipProvider, null, createElement(SheetsV2)))));
const click = (element: Element | null | undefined) => { assert.ok(element); return act(async () => { (element as HTMLElement).click(); }); };
const byText = (selector: string, text: string) => [...document.body.querySelectorAll(selector)].find(node => node.textContent?.trim() === text);
const openMenu = (sheet: string) => click(host.querySelector(`button[aria-label="Actions for ${sheet}"]`));
const items = () => [...document.body.querySelectorAll('[role="menuitem"]')].map(node => node.textContent?.trim());
const type = (input: Element | null | undefined, value: string) => act(async () => {
  assert.ok(input);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
});

it('lists the row menu with Download first and no pin or tag items', async () => {
  await render();
  await openMenu('Roster.xlsx');
  assert.deepEqual(items(), ['Download', 'Sync now', 'Change SharePoint link…', 'Clone', 'Rename', 'Delete']);
  await click(byText('[role="menuitem"]', 'Clone'));
  await click(byText('button', 'Cancel'));
  await openMenu('Keys.xlsx');
  assert.deepEqual(items(), ['Download', 'Link to SharePoint…', 'Clone', 'Rename', 'Delete']);
});

it('shows each served sync state under the SharePoint link and offers Retry sync only after a failure', async () => {
  const sync = (value: object) => ({ state: 'idle', ...value });
  wiring.catalog = [
    make('ok', 'Ok.xlsx', { linked: true, sync: sync({ lastFinishedAt: '2026-11-02T10:05:00Z', lastResult: 'ok' }) }),
    make('run', 'Run.xlsx', { linked: true, sync: { state: 'running' } }),
    make('bad', 'Bad.xlsx', { linked: true, sync: sync({ lastFinishedAt: '2026-11-02T10:05:00Z', lastResult: 'failed', lastFailureCode: 'WORKBOOK_VERSION_CONFLICT' }) }),
    make('odd', 'Odd.xlsx', { linked: true, sync: sync({ lastFinishedAt: '2026-11-02T10:05:00Z', lastResult: 'failed', lastFailureCode: 'WORKBOOK_STORAGE_CORRUPT' }) }),
    make('new', 'New.xlsx', { linked: true, sync: sync({}) }),
    make('local', 'Local.xlsx'),
  ];
  wiring.adapter.snapshot = vi.fn(() => ({ pendingLibraries: [] }));
  await render();
  const status = (name: string) => host.querySelector(`li[aria-label="${name}"] [data-sync]`)?.textContent?.trim();
  assert.match(status('Ok.xlsx') ?? '', /^Synced Nov 2/u);
  assert.equal(status('Run.xlsx'), 'Syncing…');
  assert.equal(status('Bad.xlsx'), 'Sync failed');
  // Focusing the failed status says why in the catalog's plain sentence, never the code; a code outside the sync set gets the generic sync sentence.
  const why = async (name: string) => {
    await act(async () => { host.querySelector<HTMLElement>(`li[aria-label="${name}"] [data-sync]`)?.focus(); });
    await act(async () => { await new Promise(done => setTimeout(done, 700)); });
    return document.body.querySelector('[role="tooltip"]')?.textContent ?? '';
  };
  assert.match(await why('Bad.xlsx'), /^The saved workbook changed\. Load its current version before saving\. \(Nov 2/u);
  assert.match(await why('Odd.xlsx'), /^Sync did not finish\. Start Sync again\. \(Nov 2/u);
  assert.doesNotMatch(host.textContent ?? '', /WORKBOOK_/u);
  assert.equal(status('New.xlsx'), 'Not synced yet');
  assert.equal(status('Local.xlsx'), undefined);
  await openMenu('Bad.xlsx');
  assert.deepEqual(items().slice(1, 2), ['Retry sync']);
  await click(byText('[role="menuitem"]', 'Retry sync'));
  assert.deepEqual(wiring.adapter.changeLibrary?.mock.calls.at(-1)?.[1], { kind: 'sync' });
  await openMenu('Run.xlsx');
  assert.deepEqual(items().slice(1, 2), ['Syncing…']);
});

it('asks for a name on Clone and sends the clone write', async () => {
  await render();
  await openMenu('Keys.xlsx'); await click(byText('[role="menuitem"]', 'Clone'));
  const name = document.body.querySelector<HTMLInputElement>('input[aria-label="Name"]'); assert.ok(name);
  assert.equal(name.value, 'Copy of Keys.xlsx');
  await type(name, '  Keys 2  '); await click(byText('button', 'Clone'));
  assert.deepEqual(wiring.adapter.cloneLibrary?.mock.calls.at(-1), ['keys', { name: 'Keys 2' }]);
});

it('keeps the Clone dialog open and says why when the name is refused', async () => {
  wiring.adapter.cloneLibrary = vi.fn(async () => ({ state: 'refused', message: 'A spreadsheet named Keys 2 already exists.' }));
  await render();
  await openMenu('Keys.xlsx'); await click(byText('[role="menuitem"]', 'Clone'));
  await click(byText('button', 'Clone'));
  assert.match(document.body.textContent ?? '', /already exists/u);
});

it('offers From this computer and SharePoint link from the Import menu, with no import dialog', async () => {
  await render();
  await click(byText('button', 'Import'));
  assert.ok(!document.body.querySelector('[role="dialog"]'));
  assert.deepEqual(items(), ['From this computer.xlsx or .csv', 'SharePoint linkStays in sync']);
});

it('sends a SharePoint import with the link and name', async () => {
  await render();
  await click(byText('button', 'Import'));
  await click(document.body.querySelectorAll('[role="menuitem"]')[1]);
  assert.equal((byText('button', 'Add') as HTMLButtonElement).disabled, true);
  await type(document.body.querySelector('input[aria-label="Workbook link"]'), LINK);
  await type(document.body.querySelector('input[aria-label="Name"]'), 'Roster 2');
  await click(byText('button', 'Add'));
  assert.deepEqual(wiring.adapter.importSharePoint?.mock.calls.at(-1), [{ source: 'sharepoint', url: LINK, name: 'Roster 2' }]);
});

it('titles the version dialog "Roll back" and confirms with "Roll back to v<n>?"', async () => {
  await render();
  await click(host.querySelector('button[aria-label="Versions of Keys.xlsx, now v2"]'));
  const dialog = document.body.querySelector('[role="dialog"]'); assert.ok(dialog);
  assert.equal(dialog.querySelector('h2, [data-slot="dialog-title"]')?.textContent?.trim(), 'Roll back');
  assert.equal((byText('button', 'Roll back') as HTMLButtonElement).disabled, true);
  await click([...dialog.querySelectorAll('[role="radio"]')].find(node => node.textContent?.includes('v1')));
  await click(byText('button', 'Roll back'));
  assert.match(document.body.textContent ?? '', /Roll back to v1\?/u);
  await click(byText('button', 'Roll back'));
  assert.deepEqual(wiring.adapter.changeLibrary?.mock.calls.at(-1)?.[1], { kind: 'use-version', versionId: 'v1' });
});
