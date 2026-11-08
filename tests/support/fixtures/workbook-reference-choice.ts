import { rowPickDecision } from '../../../src/backend/runs/workbooks.js';
import { ActionDescriptorWireSchema } from '../../../src/models/dashboard/actions.js';
import { RunDetailWireSchema, RunDetailSectionResponseSchema, RunWorkbookWritesWireSchema, type RunWorkbookWritesWire } from '../../../src/models/dashboard/run-detail.js';
import { HASH_A, NOW, UUID_1, UUID_2, UUID_3 } from './phase1c-contract-fixtures.js';
export function workbookReferenceChoice(version = 4, runId = UUID_1, traceId = 'onb-120000-0001') {
  const target = { runId, expectedVersion: version, libraryId: UUID_2, typeId: 'roster', referenceDigest: HASH_A,
    key: 'example@example.edu', workbookVersion: version - 1, gateId: 'choose-roster-row' };
  const candidates = [
    { sheetId: 'july', rowId: 'person-1', label: 'July 6 · Row 2', values: [{ fieldId: 'email', value: target.key }, { fieldId: 'fullName', value: 'Example, Person' }] },
    { sheetId: 'august', rowId: 'person-2', label: 'August 2 · Row 3', values: [{ fieldId: 'email', value: target.key }, { fieldId: 'fullName', value: 'Another, Person' }] },
  ];
  const action = ActionDescriptorWireSchema.parse({ kind: 'command', command: 'resolve-workbook-reference-row', key: 'choose-roster-row', label: 'Choose row', intent: 'primary', placement: ['review'], expectedVersion: target.expectedVersion, referenceTarget: target });
  const section = RunWorkbookWritesWireSchema.parse({ runId, operations: [], referenceChoices: [{
    native: { eventId: UUID_3, order: 10, runId, attempt: 1, traceId, spanPath: traceId },
    libraryId: target.libraryId, typeId: target.typeId, referenceDigest: target.referenceDigest, key: target.key, reason: 'row-ambiguous',
    resolution: { state: 'available', target, candidates, action, decision: rowPickDecision('pick-row', 'Roster rows', action, candidates) },
  }] });
  const choice = section.referenceChoices?.[0];
  if (!choice || choice.resolution.state !== 'available' || choice.resolution.action.kind !== 'command') throw new Error('reference choice fixture invalid');
  return { choice, target, action: choice.resolution.action, candidates: choice.resolution.candidates };
}

export function workbookReferenceDetail(choice: NonNullable<RunWorkbookWritesWire['referenceChoices']>[number], version = 4) {
  const { native, resolution } = choice;
  const nodeId = 'choose-roster-row', categoryKey = 'roster-reference';
  const resolved = resolution.state === 'resolved', state = resolved ? 'done' : 'blocked';
  return RunDetailWireSchema.parse({ runId: native.runId, rowRevision: version, panelKind: 'run',
    header: { runId: native.runId, workflowId: 'onboarding', traceId: native.traceId, title: 'Example, Person',
      status: resolved ? 'running' : resolution.state === 'available' ? 'awaiting-approval' : 'queued', attempt: native.attempt },
    timeline: { steps: [{ key: categoryKey, label: 'Look up in roster', state, members: [{ nodeId, categoryKey, label: 'Choose roster row', state }] }],
      events: [{ native: { ...native, nodeId }, categoryKey, noteId: native.eventId, sequence: 0, at: NOW, label: 'Choose roster row', state,
        notRun: { state: 'absent', reason: 'This gate was reached' } }] },
    gate: { state: resolved ? 'resolved' : 'open', gateId: UUID_2, nodeId, label: 'Choose roster row',
      ...(resolved ? { resolution: 'approved', resolvedBy: 'local-operator', resolvedAt: NOW, revision: 2 } : { openedAt: NOW, revision: 1 }) },
    outcome: { state: 'absent', reason: 'Not complete' }, context: { dataFacts: 0, evidenceFacts: 0, attempts: native.attempt },
    captures: { state: 'absent', reason: 'No captures' }, availableSections: ['logs', 'workbook-writes'] });
}

export function workbookReferenceLogs(state: 'unavailable' | 'available' | 'resolved') {
  const f = workbookReferenceChoice();
  const choice = RunWorkbookWritesWireSchema.parse({ runId: f.target.runId, operations: [], referenceChoices: [{ ...f.choice,
    ...(state === 'unavailable' ? { native: { ...f.choice.native, order: 1 }, resolution: { state, code: 'WORKBOOK_ROW_CHOICE_UNAVAILABLE', candidates: [] } }
      : state === 'resolved' ? { resolution: { state, workbookVersion: f.target.workbookVersion, resolvedAt: NOW, selected: f.candidates[0] } } : {}) }] }).referenceChoices![0];
  const original = workbookReferenceDetail(choice);
  const category = (key: string) => ({ key, label: key === 'prepare' ? 'Read reference' : 'Run notes', state: 'done',
    members: [{ nodeId: key, categoryKey: key, label: key, state: 'done' }] });
  const detail = RunDetailWireSchema.parse({ ...original,
    timeline: { steps: [category('prepare'), ...original.timeline.steps!, category('notes')],
      events: state === 'unavailable' ? [] : original.timeline.events },
    ...(state === 'unavailable' ? { gate: { state: 'absent', reason: 'Choice not yet available' } } : {}) });
  const notes = [5, 20].map((order, index) => {
    const id = `10000000-0000-4000-8000-${String(order).padStart(12, '0')}`;
    return { native: { ...choice.native, eventId: id, order, nodeId: index === 0 ? 'prepare' : 'notes', spanPath: `${choice.native.traceId}/${index}` },
      noteId: id, runId: choice.native.runId, sequence: index, at: NOW, level: 'info', message: index === 0 ? 'Read retained reference' : 'Retained run note' };
  });
  const logs = RunDetailSectionResponseSchema.parse({ section: 'logs', payload: { runId: choice.native.runId, notes,
    rows: notes.map(note => ({ kind: 'note', native: note.native, logId: note.noteId, sequence: note.sequence, note })),
    nextCursor: { state: 'absent', reason: 'end-of-page' } } });
  const workbooks = RunDetailSectionResponseSchema.parse({ section: 'workbook-writes', payload: { runId: choice.native.runId, operations: [], referenceChoices: [choice] } });
  return { ...f, choice, detail, logs, workbooks };
}
