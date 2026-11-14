// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { WorkbookLibraryEntrySchema } from '../../../../../src/models/dashboard/workbook-library.js';
import { ToastProvider, TooltipProvider } from '../../../../../src/dashboard/ds/ui.js';
import { addTag, sheetOf, tagsOf } from '../../../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2-model.js';

const wiring = vi.hoisted(() => ({ changeLibrary: undefined as unknown as ReturnType<typeof vi.fn>, catalog: [] as unknown[] }));
const make = (libraryId: string, name: string, state: { pinned: boolean; tags: string[]; origin?: unknown }) => WorkbookLibraryEntrySchema.parse({ libraryId, version: 1, name, updatedAt: '2026-11-01T00:00:00Z', rowCount: 1,
  worksheets: [{ id: 'people', name: 'People' }], metadata: { typeId: 't', sharePoint: null },
  type: { id: 't', name: 'Roster', keyFieldId: 'email', fields: ['email'], defaultWorkbookId: 'roster' },
  state: { libraryId, revision: 1, selectedVersionId: 'current', removed: false, origin: state.origin ?? { kind: 'local' }, pinned: state.pinned, tags: state.tags,
    versions: [{ id: 'current', name: 'current', snapshotId: 'current', version: 1, savedAt: '2026-11-01T00:00:00Z', source: 'operator' }] } });
vi.mock('../../../../../src/dashboard/state/spreadsheet-wiring-adapter.js', () => ({
  useSpreadsheetWiringAdapter: () => ({ adapter: { changeLibrary: wiring.changeLibrary }, catalog: wiring.catalog, compatibility: undefined, catalogLoading: false,
    catalogError: undefined, openError: undefined, draft: undefined, pendingLibraries: [] }),
}));
const { SheetsV2 } = await import('../../../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2.js');

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  wiring.changeLibrary = vi.fn(async () => ({ state: 'confirmed' }));
  wiring.catalog = [make('roster', 'Roster.xlsx', { pinned: true, tags: ['Fall'] }), make('keys', 'Keys.xlsx', { pinned: false, tags: [] })];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
const render = () => act(async () => root?.render(createElement(ToastProvider, null, createElement(TooltipProvider, null, createElement(SheetsV2)))));
const click = (element: Element | null | undefined) => { assert.ok(element); return act(async () => { (element as HTMLElement).click(); }); };
const byText = (selector: string, text: string) => [...document.body.querySelectorAll(selector)].find(node => node.textContent?.trim() === text);
const openMenu = (sheet: string) => click(host.querySelector(`button[aria-label="Actions for ${sheet}"]`));
const type = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
});

it('adds only valid, trimmed, case-insensitively unique tags', () => {
  assert.deepEqual(addTag(['Fall'], '  HR '), ['Fall', 'HR']);
  assert.equal(addTag(['Fall'], 'fall'), undefined);
  assert.equal(addTag(['Fall'], '   '), undefined);
  assert.equal(addTag([], 'x'.repeat(41)), undefined);
  assert.equal(addTag(Array.from({ length: 20 }, (_, index) => `t${index}`), 'more'), undefined);
});

it('lists the workflow tag before the operator tags', () => {
  const sheet = sheetOf(make('run', 'Run.xlsx', { pinned: false, tags: ['Fall'], origin: { kind: 'workflow', workflowLabel: 'Separations', workflowId: 'separations', runId: '11111111-1111-4111-8111-111111111111', partitionDay: '2026-11-01', rowCount: 1, rowSubject: 'person' } }));
  assert.deepEqual(tagsOf(sheet), ['Separations', 'Fall']);
});

it('shows pinned spreadsheets in a Pinned group first, with their tags', async () => {
  await render();
  const lists = [...host.querySelectorAll('ul[aria-label]')].map(list => list.getAttribute('aria-label'));
  assert.deepEqual(lists, ['Pinned', 'Created']);
  assert.ok(host.querySelector('ul[aria-label="Pinned"] li[aria-label="Roster.xlsx"]'));
  assert.ok(host.querySelector('ul[aria-label="Created"] li[aria-label="Keys.xlsx"]'));
  assert.match(host.querySelector('li[aria-label="Roster.xlsx"]')?.textContent ?? '', /Fall/u);
});

it('pins and unpins through the library command', async () => {
  await render();
  await openMenu('Keys.xlsx'); await click(byText('[role="menuitem"]', 'Pin'));
  assert.deepEqual(wiring.changeLibrary.mock.calls.at(-1)?.[1], { kind: 'pin' });
  await openMenu('Roster.xlsx'); await click(byText('[role="menuitem"]', 'Unpin'));
  assert.deepEqual(wiring.changeLibrary.mock.calls.at(-1)?.[1], { kind: 'unpin' });
});

it('adds and removes manual tags through set-tags', async () => {
  await render();
  await openMenu('Roster.xlsx'); await click(byText('[role="menuitem"]', 'Edit tags…'));
  const input = document.body.querySelector<HTMLInputElement>('input[aria-label="New tag"]'); assert.ok(input);
  await type(input, 'HR'); await click(byText('button', 'Add'));
  await click(byText('button', 'Save'));
  assert.deepEqual(wiring.changeLibrary.mock.calls.at(-1)?.[1], { kind: 'set-tags', tags: ['Fall', 'HR'] });
  await openMenu('Roster.xlsx'); await click(byText('[role="menuitem"]', 'Edit tags…'));
  await click(document.body.querySelector('button[aria-label="Remove tag Fall"]')); await click(byText('button', 'Save'));
  assert.deepEqual(wiring.changeLibrary.mock.calls.at(-1)?.[1], { kind: 'set-tags', tags: [] });
});

it('offers the operator tags in the tag filter', async () => {
  await render();
  await click(host.querySelector('button[aria-label="Filter by tag"]'));
  assert.ok(byText('[role="menuitemcheckbox"]', 'Fall'));
});

it('shows a toast when the command is refused', async () => {
  wiring.changeLibrary = vi.fn(async () => ({ state: 'refused', message: 'The library changed.' }));
  await render();
  await openMenu('Keys.xlsx'); await click(byText('[role="menuitem"]', 'Pin'));
  assert.match(document.body.textContent ?? '', /Couldn't save the change/u);
});
