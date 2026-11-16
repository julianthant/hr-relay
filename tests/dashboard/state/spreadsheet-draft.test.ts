import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { draftHasUnsavedWork, draftHoldsSave, draftTransition, isDraftRefusal, type DraftEvent, type SpreadsheetDraft } from '../../../src/dashboard/state/spreadsheet-draft.js';
import { newEditableWorkbook, type SpreadsheetSaveResult } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { SavedWorkbookSchema, type SavedWorkbook } from '../../../src/models/dashboard/workbooks.js';
import type { EditableWorkbook } from '../../../src/rules/spreadsheets/workbook-io.js';

const book = (name = 'Saved.xlsx'): EditableWorkbook => ({ ...newEditableWorkbook(), name, libraryId: 'saved' });
const savedAt = (version: number, workbook: EditableWorkbook): SavedWorkbook => SavedWorkbookSchema.parse({ libraryId: 'saved', version, createdAt: '2026-10-01T00:00:00Z', savedAt: '2026-10-15T00:00:00Z', workbook });
const pending = Promise.resolve<SpreadsheetSaveResult>({ state: 'uncertain', reason: 'held' });
const original = book(), edit = book('Edited.xlsx'), later = book('Later.xlsx');
const v3 = savedAt(3, original), v4 = savedAt(4, edit);

function step(draft: SpreadsheetDraft | undefined, event: DraftEvent): SpreadsheetDraft | undefined {
  const next = draftTransition(draft, event);
  assert(!isDraftRefusal(next), `unexpected refusal ${JSON.stringify(next)} for ${event.type}`);
  return next;
}
function arm(draft: SpreadsheetDraft | undefined, event: DraftEvent): SpreadsheetDraft {
  const next = step(draft, event); assert(next); return next;
}
const start = (document = edit): Extract<DraftEvent, { type: 'save-started' }> => ({ type: 'save-started', document, saving: pending, readReady: true, libraryPending: false });
const saved = () => arm(undefined, { type: 'opened', opened: v3 });
const edited = () => arm(saved(), { type: 'changed', document: edit, dirty: true });
const created = () => arm(undefined, { type: 'created', document: newEditableWorkbook() });
const saving = () => arm(edited(), start());
const unconfirmed = () => arm(saving(), { type: 'unknown' });
const settling = () => arm(saving(), { type: 'confirmed', opened: v4, refreshes: true });
const phases = { saved, edited, saving, unconfirmed, settling } as const;
const events: readonly DraftEvent['type'][] = ['opened', 'created', 'changed', 'save-started', 'rejected', 'unknown', 'readback-mismatch', 'confirmed', 'released', 'closed', 'library-settled'];

describe('spreadsheet draft transition table', () => {
  it('none: opened reads back as saved and created is an unopened edited draft', () => {
    const opened = saved();
    assert.equal(opened.phase, 'saved'); assert.equal(opened.opened, v3); assert.equal(opened.document, v3.workbook); assert.equal(opened.dirty, false);
    const fresh = created();
    assert.equal(fresh.phase, 'edited'); assert.equal(fresh.opened, undefined); assert.equal(fresh.dirty, true);
  });
  it('an existing draft is kept when the workbook is opened again', () => {
    const draft = edited(); assert.equal(draftTransition(draft, { type: 'opened', opened: v4 }), draft);
  });
  it('saved / edited: a clean change equal to the opened workbook is saved, any other change is edited', () => {
    for (const from of [saved(), edited()]) {
      const back = arm(from, { type: 'changed', document: { ...original }, dirty: false });
      assert.equal(back.phase, 'saved'); assert.equal(back.dirty, false);
      assert.equal(arm(from, { type: 'changed', document: edit, dirty: false }).phase, 'edited');
      const forced = arm(from, { type: 'changed', document: { ...original }, dirty: true });
      assert.equal(forced.phase, 'edited'); assert.equal(forced.dirty, true);
    }
    const unopened = arm(created(), { type: 'changed', document: newEditableWorkbook(), dirty: false });
    assert.equal(unopened.phase, 'edited'); assert.equal(unopened.dirty, true);
  });
  it('saving / unconfirmed: a change keeps the phase and forces dirty', () => {
    for (const make of [saving, unconfirmed]) {
      const from = make();
      const next = arm(from, { type: 'changed', document: { ...original }, dirty: false });
      assert.equal(next.phase, from.phase); assert.equal(next.dirty, true); assert.equal(next.intent, from.intent); assert.equal(next.saving, from.saving);
    }
  });
  it('settling: a change keeps the phase and takes dirty from the opened readback', () => {
    const clean = arm(settling(), { type: 'changed', document: { ...edit }, dirty: false });
    assert.equal(clean.phase, 'settling'); assert.equal(clean.dirty, false); assert.equal(clean.saving, pending);
    const changed = arm(settling(), { type: 'changed', document: later, dirty: false });
    assert.equal(changed.phase, 'settling'); assert.equal(changed.dirty, true);
  });
  it('settling: a second save joins the held promise and released ends saved or edited', () => {
    const from = settling(); assert.equal(draftTransition(from, start()), from);
    const done = arm(from, { type: 'released' }); assert.equal(done.phase, 'saved'); assert.equal(done.saving, undefined); assert.equal(done.opened, v4);
    const dirty = arm(arm(settling(), { type: 'changed', document: later, dirty: true }), { type: 'released' });
    assert.equal(dirty.phase, 'edited'); assert.equal(dirty.document, later);
  });
  it('saved / edited: save-started clones its document into a new intent and keeps dirty', () => {
    const from = saved(), next = arm(from, start(edit));
    assert.equal(next.phase, 'saving'); assert.equal(next.dirty, false); assert.equal(next.saving, pending);
    assert(next.intent); assert.deepEqual(next.intent.draft, edit); assert.notEqual(next.intent.draft, edit);
    assert.equal(next.intent.libraryId, 'saved'); assert.equal(next.intent.expectedVersion, 3);
    const unopened = arm(created(), start());
    assert.equal(unopened.phase, 'saving'); assert.equal(unopened.dirty, true); assert.equal(unopened.intent?.libraryId, undefined); assert.equal(unopened.intent?.expectedVersion, 0);
  });
  it('saved / edited: save-started is refused when the list read is not ready or a library change is pending', () => {
    for (const from of [saved(), edited()]) {
      assert.deepEqual(draftTransition(from, { ...start(), readReady: false }), { refusal: 'read-not-ready' });
      assert.deepEqual(draftTransition(from, { ...start(), libraryPending: true }), { refusal: 'library-pending' });
    }
  });
  it('unconfirmed: save-started recovers with the retained intent and ignores read readiness', () => {
    const from = unconfirmed(), held = from.intent;
    const next = arm(from, { type: 'save-started', document: later, saving: pending, readReady: false, libraryPending: false });
    assert.equal(next.phase, 'saving'); assert.equal(next.intent, held); assert.equal(next.saving, pending);
    assert.deepEqual(draftTransition(from, { ...start(), libraryPending: true }), { refusal: 'library-pending' });
  });
  it('saving: a second save joins the running save', () => {
    const from = saving(); assert.equal(draftTransition(from, { ...start(), readReady: false }), from);
  });
  it('a pending library change refuses a save in every phase, as the adapter checks it first', () => {
    for (const make of Object.values(phases)) { const from = make(); assert.deepEqual(draftTransition(from, { ...start(), libraryPending: true }), { refusal: 'library-pending' }); }
  });
  it('saving: rejected returns to saved when clean and edited when dirty', () => {
    const clean = saved(), cleanSaving = arm(clean, start(original));
    const back = arm(cleanSaving, { type: 'rejected' }); assert.equal(back.phase, 'saved'); assert.equal(back.intent, undefined); assert.equal(back.saving, undefined); assert.equal(back.opened, v3);
    const dirty = arm(saving(), { type: 'rejected' }); assert.equal(dirty.phase, 'edited'); assert.equal(dirty.intent, undefined); assert.equal(dirty.saving, undefined);
  });
  it('saving: unknown and readback-mismatch keep the intent as unconfirmed', () => {
    for (const type of ['unknown', 'readback-mismatch'] as const) {
      const from = saving(), next = arm(from, { type });
      assert.equal(next.phase, 'unconfirmed'); assert.equal(next.intent, from.intent); assert.equal(next.saving, undefined); assert.equal(next.dirty, from.dirty);
    }
  });
  it('saving: confirmed settles while the catalog refreshes, is saved when it does not, and stays edited on newer edits', () => {
    const settled = settling();
    assert.equal(settled.phase, 'settling'); assert.equal(settled.opened, v4); assert.equal(settled.dirty, false); assert.equal(settled.intent, undefined); assert.equal(settled.saving, pending);
    const quiet = arm(saving(), { type: 'confirmed', opened: v4, refreshes: false });
    assert.equal(quiet.phase, 'saved'); assert.equal(quiet.opened, v4); assert.equal(quiet.saving, undefined);
    const newer = arm(arm(saving(), { type: 'changed', document: later, dirty: true }), { type: 'confirmed', opened: v4, refreshes: true });
    assert.equal(newer.phase, 'edited'); assert.equal(newer.opened, v4); assert.equal(newer.document, later); assert.equal(newer.dirty, true); assert.equal(newer.intent, undefined);
  });
  it('confirmed gives an unopened document the generated library identity', () => {
    const fresh = created(), document = fresh.document, readback = SavedWorkbookSchema.parse({ libraryId: 'generated', version: 1, createdAt: '2026-10-01T00:00:00Z', savedAt: '2026-10-15T00:00:00Z', workbook: { ...document, libraryId: 'generated' } });
    const next = arm(arm(fresh, start(document)), { type: 'confirmed', opened: readback, refreshes: false });
    assert.equal(next.phase, 'saved'); assert.equal(next.document.libraryId, 'generated'); assert.equal(next.opened, readback);
  });
  it('closed removes saved and edited drafts and is refused while a save is held', () => {
    assert.equal(step(saved(), { type: 'closed' }), undefined); assert.equal(step(edited(), { type: 'closed' }), undefined);
    for (const make of [saving, unconfirmed, settling]) assert.deepEqual(draftTransition(make(), { type: 'closed' }), { refusal: 'save-held' });
  });
  it('library-settled reopens only a saved draft', () => {
    assert.equal(step(saved(), { type: 'library-settled' }), undefined);
    for (const make of [edited, saving, unconfirmed, settling]) { const from = make(); assert.equal(draftTransition(from, { type: 'library-settled' }), from); }
  });
  it('refuses every pair the table does not list', () => {
    const listed: Record<keyof typeof phases | 'none', readonly DraftEvent['type'][]> = {
      none: ['opened', 'created'],
      saved: ['opened', 'changed', 'save-started', 'closed', 'library-settled'],
      edited: ['opened', 'changed', 'save-started', 'closed', 'library-settled'],
      saving: ['opened', 'changed', 'save-started', 'rejected', 'unknown', 'readback-mismatch', 'confirmed', 'closed', 'library-settled'],
      unconfirmed: ['opened', 'changed', 'save-started', 'closed', 'library-settled'],
      settling: ['opened', 'changed', 'save-started', 'released', 'closed', 'library-settled'],
    };
    const sample = (type: DraftEvent['type']): DraftEvent => {
      switch (type) {
        case 'opened': return { type, opened: v3 };
        case 'created': case 'changed': return type === 'created' ? { type, document: edit } : { type, document: edit, dirty: true };
        case 'save-started': return { type, document: edit, saving: pending, readReady: true, libraryPending: false };
        case 'confirmed': return { type, opened: v4, refreshes: true };
        default: return { type };
      }
    };
    for (const [phase, allowed] of Object.entries(listed)) for (const type of events) {
      const from = phase === 'none' ? undefined : phases[phase as keyof typeof phases]();
      const next = draftTransition(from, sample(type));
      if (allowed.includes(type)) assert(!isDraftRefusal(next) || next.refusal !== 'out-of-phase', `${phase} ${type} should be listed`);
      else assert.deepEqual(next, { refusal: 'out-of-phase' }, `${phase} ${type} should be refused`);
    }
  });
});

describe('spreadsheet draft readers', () => {
  it('unsaved work is dirty or a held intent; a held save is an intent or a promise', () => {
    const expected = { saved: [false, false], edited: [true, false], saving: [true, true], unconfirmed: [true, true], settling: [false, true] } as const;
    for (const [phase, make] of Object.entries(phases)) {
      const draft = make(); assert.deepEqual([draftHasUnsavedWork(draft), draftHoldsSave(draft)], expected[phase as keyof typeof phases], phase);
    }
  });
});
