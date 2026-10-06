// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it, vi } from 'vitest';
import { SpreadsheetEditor } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor.js';
import { newEditableWorkbook, type EditableWorkbook } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { SettingsSaveFeedback } from '../../../src/dashboard/surfaces/settings/editor/settings-feedback.js';
import { SessionsView } from '../../../src/dashboard/surfaces/sessions/sessions-view.js';
import { createSessionPreviewPort, useSessionPreviewCommands, type SessionPreviewCommandPort, type SessionPreviewRequest, type SessionPreviewResult } from '../../../src/dashboard/surfaces/sessions/session-preview-command-model.js';
import { sessionsSample } from '../../../src/dashboard/surfaces/sessions/sessions-fixture.js';
import { buildWorkflowCatalog } from '../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); vi.useRealTimers(); });
async function mount(element: ReturnType<typeof createElement>) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root?.render(element)); return host; }
const button = (name: string) => { const found = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name); assert(found, name); return found; };
const press = async (name: string) => act(async () => button(name).click());
function SheetHarness({ initial }: { initial: EditableWorkbook }) {
  const [book, setBook] = useState(initial), [dirty, setDirty] = useState(false);
  return createElement(SpreadsheetEditor, { document: book, dirty, onDocument: (next, changed) => { assert(next); setBook(next); setDirty(changed); } });
}
function SessionsHarness({ port }: { port: SessionPreviewCommandPort }) {
  const catalog = buildWorkflowCatalog([]);
  const commands = useSessionPreviewCommands(sessionsSample('active'), catalog, port);
  return createElement(SessionsView, { data: commands.data, open: true, onOpenChange: () => undefined, workflows: catalog.map(flow => ({ id: flow.id, label: flow.label })), onControl: commands.control, onAdd: commands.add, operations: commands.operations, onCheck: commands.check });
}
describe('mounted frontend reliability contracts', () => {
  it('bounds 100,000 cells in both dimensions, pages and searches the full sheet', async () => {
    const original = newEditableWorkbook();
    const rows = Array.from({ length: 1001 }, (_, row) => ({ id: `row-${row}`, cells: Array.from({ length: 99 }, (_, column) => ({ value: row === 0 ? `Column ${column}` : `record-${row}-${column}` })) }));
    const host = await mount(createElement(SheetHarness, { initial: { ...original, sheets: [{ ...original.sheets[0], width: 99, rows }] } }));
    assert.equal(host.querySelectorAll('tbody tr').length, 50);
    assert.equal(host.querySelectorAll('tbody input').length, 1000);
    await press('Next spreadsheet columns');
    assert(host.querySelector('input[aria-label="U2"]'));
    await press('Next spreadsheet page');
    assert(host.querySelector('input[aria-label="U52"]'));
    const search = host.querySelector('input[aria-label="Search spreadsheet cells"]'); assert(search instanceof HTMLInputElement);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'record-999-20'); search.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(host.querySelectorAll('tbody tr').length, 1);
    assert(host.querySelector('input[aria-label="U1000"]'));
  });
  it('supports reversible controlled cell edits and keeps unrelated text-field shortcuts native', async () => {
    const host = await mount(createElement(SheetHarness, { initial: newEditableWorkbook() }));
    const cell = host.querySelector('input[aria-label="A2"]'); assert(cell instanceof HTMLInputElement);
    await act(async () => { cell.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(cell, 'Changed'); cell.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(cell.value, 'Changed');
    await act(async () => cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })));
    assert.equal(cell.value, '');
    await press('Redo spreadsheet edit'); assert.equal(cell.value, 'Changed');
    const search = host.querySelector('input[aria-label="Search spreadsheet cells"]'); assert(search);
    const shortcut = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => search.dispatchEvent(shortcut)); assert.equal(shortcut.defaultPrevented, false); assert.equal(cell.value, 'Changed');
  });
  it('retains saved status, distinguishes restart-required and preserves uncertain retry', async () => {
    vi.useFakeTimers(); let retry = 0;
    const host = await mount(createElement(SettingsSaveFeedback, { save: { state: 'applied', replayed: false }, restartRequired: true, retry: () => retry++ }));
    await act(async () => vi.advanceTimersByTime(10000));
    assert.match(host.textContent ?? '', /Saved · Restart required/);
    await act(async () => root?.render(createElement(SettingsSaveFeedback, { save: { state: 'unconfirmed', message: 'Response unavailable' }, retry: () => retry++ })));
    assert(!host.textContent?.includes('Saved')); await press('Retry exact attempt'); assert.equal(retry, 1);
  });
  it('blocks repeat worker commands until acknowledgment and preserves peer state', async () => {
    let resolve!: (result: SessionPreviewResult) => void;
    const requests: SessionPreviewRequest[] = [];
    const port = { send: (request: SessionPreviewRequest) => { requests.push(request); return new Promise<SessionPreviewResult>(done => { resolve = done; }); }, check: async (request: SessionPreviewRequest) => ({ id: request.id, state: 'confirmed' as const }) };
    const host = await mount(createElement(SessionsHarness, { port }));
    const first = [...host.querySelectorAll('button[aria-label="Pause"]')][0] as HTMLButtonElement;
    await act(async () => { first.click(); first.click(); });
    assert.equal(requests.length, 1); assert(first.disabled);
    assert.match(host.textContent ?? '', /Pause requested/); assert.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 0);
    await act(async () => resolve({ id: requests[0].id, state: 'confirmed' }));
    assert.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 1); assert.equal(host.querySelectorAll('button[aria-label="Pause"]').length, 1);
  });
  it('keeps refused state unchanged and checks an uncertain exact command without resubmitting', async () => {
    const sent: SessionPreviewRequest[] = [], checked: SessionPreviewRequest[] = [];
    const port: SessionPreviewCommandPort = { send: async request => { sent.push(request); return { id: request.id, state: 'uncertain', message: 'Lost response' }; }, check: async request => { checked.push(request); return { id: request.id, state: 'confirmed' }; } };
    const host = await mount(createElement(SessionsHarness, { port }));
    await act(async () => (host.querySelector('button[aria-label="Pause"]') as HTMLButtonElement).click());
    assert.match(host.textContent ?? '', /Lost response/);
    await press('Check outcome'); assert.equal(sent.length, 1); assert.equal(checked[0], sent[0]);
    assert.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 1);
    const refusal: SessionPreviewCommandPort = { send: async request => ({ id: request.id, state: 'refused', message: 'Busy elsewhere' }), check: async request => ({ id: request.id, state: 'uncertain', message: 'Unknown' }) };
    await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren();
    const refused = await mount(createElement(SessionsHarness, { port: refusal }));
    await act(async () => (refused.querySelector('button[aria-label="Pause"]') as HTMLButtonElement).click());
    assert.match(refused.textContent ?? '', /Busy elsewhere/); assert.equal(refused.querySelectorAll('button[aria-label="Resume"]').length, 0);
  });
  it('the fictional port separates uncertain response from original command readback', async () => {
    vi.useFakeTimers(); const port = createSessionPreviewPort('uncertain');
    const request: SessionPreviewRequest = { id: 'exact-one', target: 'worker-one', action: 'pause' };
    const sent = port.send(request); await vi.advanceTimersByTimeAsync(600); assert.equal((await sent).state, 'uncertain');
    const read = port.check(request); await vi.advanceTimersByTimeAsync(600); assert.equal((await read).state, 'confirmed');
  });
  it('refuses foreign worker acknowledgment and retains the original recovery identity', async () => {
    const sent: SessionPreviewRequest[] = [], checked: SessionPreviewRequest[] = [];
    const port: SessionPreviewCommandPort = { send: async request => { sent.push(request); return { id: 'foreign', state: 'confirmed' }; }, check: async request => { checked.push(request); return { id: request.id, state: 'confirmed' }; } };
    const host = await mount(createElement(SessionsHarness, { port }));
    await act(async () => (host.querySelector('button[aria-label="Pause"]') as HTMLButtonElement).click());
    assert.match(host.textContent ?? '', /response belongs to another command/);
    assert.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 0);
    assert((host.querySelector('button[aria-label="Pause"]') as HTMLButtonElement).disabled);
    await press('Check outcome'); assert.equal(checked[0], sent[0]); assert.equal(sent.length, 1);
    assert.equal(host.querySelectorAll('button[aria-label="Resume"]').length, 1);
  });
});
