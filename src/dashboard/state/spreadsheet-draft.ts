import type { SavedWorkbook } from '../../models/dashboard/workbooks.js';
import type { EditableWorkbook } from '../../rules/spreadsheets/workbook-io.js';
import { spreadsheetSaveMatches, type SpreadsheetSaveResult } from '../surfaces/spreadsheets/spreadsheet-editor-model.js';

type SaveIntent = { draft: EditableWorkbook; expectedVersion: number; libraryId?: string; error?: unknown };
type Saving = Promise<SpreadsheetSaveResult>;
export type SpreadsheetDraft =
  | { readonly phase: 'saved'; readonly document: EditableWorkbook; readonly opened: SavedWorkbook; readonly dirty: false; readonly intent?: undefined; readonly saving?: undefined }
  | { readonly phase: 'edited'; readonly document: EditableWorkbook; readonly opened?: SavedWorkbook; readonly dirty: true; readonly intent?: undefined; readonly saving?: undefined }
  | { readonly phase: 'saving'; readonly document: EditableWorkbook; readonly opened?: SavedWorkbook; readonly dirty: boolean; readonly intent: SaveIntent; readonly saving: Saving }
  | { readonly phase: 'unconfirmed'; readonly document: EditableWorkbook; readonly opened?: SavedWorkbook; readonly dirty: boolean; readonly intent: SaveIntent; readonly saving?: undefined }
  | { readonly phase: 'settling'; readonly document: EditableWorkbook; readonly opened: SavedWorkbook; readonly dirty: boolean; readonly intent?: undefined; readonly saving: Saving };

export type DraftEvent =
  | { readonly type: 'opened'; readonly opened: SavedWorkbook }
  | { readonly type: 'created'; readonly document: EditableWorkbook }
  | { readonly type: 'changed'; readonly document: EditableWorkbook; readonly dirty: boolean }
  | { readonly type: 'save-started'; readonly document: EditableWorkbook; readonly saving: Saving; readonly readReady: boolean; readonly libraryPending: boolean }
  | { readonly type: 'rejected' | 'unknown' | 'readback-mismatch' | 'released' | 'closed' | 'library-settled' }
  | { readonly type: 'confirmed'; readonly opened: SavedWorkbook; readonly refreshes: boolean };
export type DraftRefusal = { readonly refusal: 'read-not-ready' | 'library-pending' | 'save-held' | 'out-of-phase' };

const refuse = (refusal: DraftRefusal['refusal']): DraftRefusal => ({ refusal });
export const isDraftRefusal = (next: SpreadsheetDraft | undefined | DraftRefusal): next is DraftRefusal => next !== undefined && 'refusal' in next;
export const draftHasUnsavedWork = (draft: SpreadsheetDraft) => draft.dirty || draft.intent !== undefined;
export const draftHoldsSave = (draft: SpreadsheetDraft) => draft.intent !== undefined || draft.saving !== undefined;

const matchesOpened = (document: EditableWorkbook, opened: SavedWorkbook) => spreadsheetSaveMatches(document, { state: 'confirmed', version: opened.version, readback: opened.workbook });
const settled = (document: EditableWorkbook, opened: SavedWorkbook | undefined, dirty: boolean): SpreadsheetDraft =>
  !dirty && opened ? { phase: 'saved', document, opened, dirty: false } : { phase: 'edited', document, opened, dirty: true };

export function draftTransition(draft: SpreadsheetDraft | undefined, event: DraftEvent): SpreadsheetDraft | undefined | DraftRefusal {
  if (draft === undefined) {
    if (event.type === 'opened') return { phase: 'saved', document: event.opened.workbook, opened: event.opened, dirty: false };
    if (event.type === 'created') return { phase: 'edited', document: event.document, dirty: true };
    return refuse('out-of-phase');
  }
  switch (event.type) {
    case 'opened': return draft;
    case 'changed': {
      const { document } = event;
      if (draft.phase === 'saving' || draft.phase === 'unconfirmed') return { ...draft, document, dirty: true };
      const dirty = event.dirty || !draft.opened || !matchesOpened(document, draft.opened);
      return draft.phase === 'settling' ? { ...draft, document, dirty } : settled(document, draft.opened, dirty);
    }
    case 'save-started':
      if (event.libraryPending) return refuse('library-pending');
      if (draft.phase === 'saving' || draft.phase === 'settling') return draft;
      if (draft.phase === 'unconfirmed') return { ...draft, phase: 'saving', saving: event.saving };
      if (!event.readReady) return refuse('read-not-ready');
      return { phase: 'saving', document: draft.document, opened: draft.opened, dirty: draft.dirty, saving: event.saving,
        intent: { draft: structuredClone(event.document), libraryId: draft.opened?.libraryId, expectedVersion: draft.opened?.version ?? 0 } };
    case 'rejected':
      return draft.phase === 'saving' ? settled(draft.document, draft.opened, draft.dirty) : refuse('out-of-phase');
    case 'unknown': case 'readback-mismatch':
      return draft.phase === 'saving' ? { phase: 'unconfirmed', document: draft.document, opened: draft.opened, dirty: draft.dirty, intent: draft.intent } : refuse('out-of-phase');
    case 'confirmed': {
      if (draft.phase !== 'saving') return refuse('out-of-phase');
      const { opened } = event;
      const document = draft.document.libraryId === undefined ? { ...draft.document, libraryId: opened.libraryId } : draft.document;
      if (!matchesOpened(document, opened)) return { phase: 'edited', document, opened, dirty: true };
      return event.refreshes ? { phase: 'settling', document, opened, dirty: false, saving: draft.saving } : { phase: 'saved', document, opened, dirty: false };
    }
    case 'released':
      return draft.phase === 'settling' ? settled(draft.document, draft.opened, draft.dirty) : refuse('out-of-phase');
    case 'closed':
      return draftHoldsSave(draft) ? refuse('save-held') : undefined;
    case 'library-settled':
      return draft.phase === 'saved' ? undefined : draft;
    case 'created':
      return refuse('out-of-phase');
  }
}
