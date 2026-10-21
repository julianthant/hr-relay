// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { ChatFiles } from '../../../../src/dashboard/surfaces/shell/chat-files.js';
import type { ChatFile, ChatFilesPort } from '../../../../src/dashboard/surfaces/shell/chat-files-model.js';
import { newEditableWorkbook } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { MeasurementFreeResizeObserver } from '../../../support/helpers/settings-storage-doctor-fixtures.js';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
beforeEach(() => { vi.stubGlobal('ResizeObserver', MeasurementFreeResizeObserver); const host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
function fixture(files: readonly ChatFile[] = []): ChatFilesPort {
  return { subscribe: () => () => undefined, snapshot: () => files, open: vi.fn<ChatFilesPort['open']>(async () => ({ kind: 'workbook', document: newEditableWorkbook() })), download: vi.fn() };
}
const file: ChatFile = { id: 'book', name: 'Autumn-updated.xlsx', kind: 'workbook', reference: { libraryId: 'book', version: 2, name: 'Autumn-updated.xlsx', status: 'Updated' } };
const button = (name: string) => { const value = [...document.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === name); assert(value, name); return value; };
it('renders the exact HUB empty copy and returns to chat', async () => {
  const back = vi.fn(); await act(async () => root.render(createElement(ChatFiles, { port: fixture(), onBackToChat: back })));
  assert.match(document.body.textContent, /No files yet/); assert.match(document.body.textContent, /Attach a file with the \+ button in chat/);
  await act(async () => button('Back to chat').click()); assert.equal(back.mock.calls.length, 1);
});
it('opens the saved version preview and hands its full identity to the editor', async () => {
  const port = fixture([file]), open = vi.fn(); await act(async () => root.render(createElement(ChatFiles, { port, onBackToChat() {}, onOpenWorkbook: open })));
  await act(async () => button(`Preview ${file.name}`).click()); assert(document.querySelector('[role=dialog]'));
  assert(document.querySelector('table[aria-label="Sheet 1 preview"]'));
  await act(async () => button('Open spreadsheet').click()); assert.deepEqual(open.mock.calls, [[file.reference]]); assert.equal(document.querySelector('[role=dialog]'), null);
});
it('attaches a file from the picker and excludes a previous conversation selection', async () => {
  const attach = vi.fn(), port = fixture([file]);
  await act(async () => root.render(createElement(ChatFiles, { port, mode: 'attach', onAttachFile: attach, onBackToChat() {} })));
  await act(async () => button(`Attach ${file.name}`).click()); assert.deepEqual(attach.mock.calls, [[file]]);
  await act(async () => root.render(createElement(ChatFiles, { port, onBackToChat() {} })));
  await act(async () => button(`Preview ${file.name}`).click());
  await act(async () => root.render(createElement(ChatFiles, { port: fixture(), onBackToChat() {} })));
  assert.equal(document.querySelector('[role=dialog]'), null); assert.match(document.body.textContent, /No files yet/);
});
it('shows preview failure without an invented empty result', async () => {
  const port = fixture([file]); vi.mocked(port.open).mockRejectedValue(new Error('Saved version unavailable'));
  await act(async () => root.render(createElement(ChatFiles, { port, onBackToChat() {} })));
  await act(async () => button(`Preview ${file.name}`).click()); assert.match(document.body.textContent, /Preview unavailable/); assert.match(document.body.textContent, /Saved version unavailable/);
});
