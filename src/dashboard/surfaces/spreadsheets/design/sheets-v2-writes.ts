import type { createSpreadsheetWiringAdapter } from '../../../state/spreadsheet-wiring-adapter.js';
import type { SpreadsheetSaveResult } from '../spreadsheet-editor-model.js';
import type { EditableWorkbook } from '../../../../rules/spreadsheets/workbook-io.js';
import { withMapping } from './sheets-v2-model.js';

type Adapter = ReturnType<typeof createSpreadsheetWiringAdapter>;
type Held = { key: string; document: EditableWorkbook; running?: Promise<ImportOutcome> };
type Writes = { held?: Held; queue: Promise<unknown>; edits: number };
const sessions = new WeakMap<Adapter, Writes>();
const writesOf = (adapter: Adapter): Writes => { let writes = sessions.get(adapter); if (!writes) { writes = { queue: Promise.resolve(), edits: 0 }; sessions.set(adapter, writes); } return writes; };

export type ImportOutcome = { state: 'added'; name: string } | { state: 'pending' | 'failed'; reason: string };

/** An unconfirmed import is resumed, never created again; it outlives the dialog and the page, and callers during a save join it. */
export function importWorkbook(adapter: Adapter, document: EditableWorkbook): Promise<ImportOutcome> {
  const writes = writesOf(adapter), held = writes.held ??= { key: adapter.create(document), document };
  if (held.running) return held.running;
  const settle = (): void => { if (writes.held === held) writes.held = undefined; };
  const running = (async (): Promise<ImportOutcome> => {
    const result = await adapter.save(held.key, held.document);
    if (result.state === 'confirmed') { settle(); return { state: 'added', name: held.document.name }; }
    if (result.state === 'uncertain') return { state: 'pending', reason: result.reason };
    settle(); adapter.close(held.key);
    return { state: 'failed', reason: result.reason };
  })().finally(() => { held.running = undefined; });
  held.running = running;
  return running;
}
export const pendingImportName = (adapter: Adapter): string | undefined => sessions.get(adapter)?.held?.document.name;

/** Mapping edits apply to the draft at once; saves run one at a time and each sends the newest draft until it is confirmed. */
export function editMapping(adapter: Adapter, id: string, worksheet: string, patch: Record<string, string | null>): Promise<{ result?: SpreadsheetSaveResult; latest: boolean }> {
  const writes = writesOf(adapter), current = adapter.draft(id)?.document;
  if (!current) return Promise.resolve({ latest: true });
  adapter.change(id, { ...current, sheets: current.sheets.map(item => item.id === worksheet ? withMapping(item, patch) : item) }, true);
  const mine = ++writes.edits;
  const turn = writes.queue.then(async () => {
    let result: SpreadsheetSaveResult | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const latest = adapter.draft(id);
      if (!latest) break;
      result = await adapter.save(id, latest.document);
      const after = adapter.draft(id);
      // Recovering an earlier save leaves newer edits unsent: send them next.
      if (result.state !== 'uncertain' || !after || after.intent || !after.dirty) break;
    }
    return { result, latest: mine === writes.edits };
  });
  writes.queue = turn;
  return turn;
}

/** True once every edit is saved and the draft was closed; a draft with unsaved edits stays open. */
export async function closeDraft(adapter: Adapter, id: string, discard: boolean): Promise<boolean> {
  await writesOf(adapter).queue;
  const draft = adapter.draft(id);
  if (draft && !discard && (draft.dirty || draft.intent)) return false;
  adapter.close(id);
  return true;
}
