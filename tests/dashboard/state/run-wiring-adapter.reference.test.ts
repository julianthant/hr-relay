import assert from 'node:assert/strict';
import { it } from 'vitest';
import { projectRunLogs, type RunLogSnapshot } from '../../../src/dashboard/state/run-wiring-adapter.js';
import { workbookReferenceChoiceId } from '../../../src/dashboard/surfaces/run-detail/logs/workbook-write-model.js';
import { workbookReferenceLogs } from '../../support/fixtures/workbook-reference-choice.js';
import { RunWorkbookWritesWireSchema, NativeRunEventWireSchema } from '../../../src/models/dashboard/run-detail.js';

function snapshot(state: Parameters<typeof workbookReferenceLogs>[0]): RunLogSnapshot {
  const f = workbookReferenceLogs(state);
  if (f.logs.section !== 'logs') throw new Error('reference logs fixture invalid');
  return { detail: f.detail, logs: f.logs.payload, sections: [f.workbooks], unavailableEvidence: [],
    actionEvidence: { state: 'available', events: [], missingPages: [] }, confirmedActionBindings: [] };
}
const client = { artifactUrl: (id: string) => `/artifacts/${id}` };
for (const state of ['unavailable', 'available', 'resolved'] as const) it(`places ${state} roster choices by retained native order without duplicating the gate`, () => {
  const f = workbookReferenceLogs(state), projected = projectRunLogs(snapshot(state), client);
  const id = workbookReferenceChoiceId(f.choice);
  assert.deepEqual(projected.steps.map(step => step.id), state === 'unavailable'
    ? [id, f.logs.section === 'logs' && f.logs.payload.rows![0].logId, f.logs.section === 'logs' && f.logs.payload.rows![1].logId]
    : [f.logs.section === 'logs' && f.logs.payload.rows![0].logId, id, f.logs.section === 'logs' && f.logs.payload.rows![1].logId]);
  const decision = projected.steps.find(step => step.id === id)!;
  assert.equal(decision.entries.length, 1); assert.equal(decision.entries[0].kind, 'decision');
  if (decision.entries[0].kind !== 'decision') throw new Error('decision missing');
  assert.equal(decision.entries[0].decision.state, state === 'resolved' ? 'recorded' : state === 'unavailable' ? 'failed' : 'review');
  assert.equal(decision.time === '—', state === 'unavailable');
  assert.equal(decision.entries[0].decision.actions?.length, state === 'available' ? 1 : 0);
  if (state !== 'unavailable') assert.equal(projected.timeline.find(stage => stage.id === 'roster-reference')?.stepId, id);
});

it('refuses foreign, conflicting, future-attempt and wrong-gate native joins', () => {
  const original = snapshot('available');
  const section = original.sections[0]; if (section.section !== 'workbook-writes') throw new Error('fixture missing');
  const choice = section.payload.referenceChoices![0];
  for (const native of [{ ...choice.native, runId: '00000000-0000-4000-8000-000000000009' },
    { ...choice.native, traceId: 'onb-120001-0002' }, { ...choice.native, spanPath: 'foreign' }, { ...choice.native, attempt: 2 },
    { ...choice.native, order: 20 }, { ...choice.native, eventId: '10000000-0000-4000-8000-000000000020' }]) {
    assert.throws(() => projectRunLogs({ ...original, sections: [{ ...section, payload: { ...section.payload,
      referenceChoices: [{ ...choice, native: NativeRunEventWireSchema.parse(native) }] } }] }, client), /IDENTITY/);
  }
  const noOwner = { ...original, detail: { ...original.detail, timeline: { ...original.detail.timeline, events: [] } } };
  assert.throws(() => projectRunLogs(noOwner, client), /RUN_GATE_IDENTITY_MISMATCH/);
  assert.throws(() => projectRunLogs({ ...original, detail: { ...original.detail, gate: { state: 'absent', reason: 'No gate' } } }, client), /RUN_GATE_IDENTITY_MISMATCH/);
  assert.throws(() => projectRunLogs({ ...original, detail: { ...original.detail, timeline: { ...original.detail.timeline,
    events: original.detail.timeline.events.map(event => ({ ...event, native: NativeRunEventWireSchema.parse({ ...choice.native, nodeId: 'prepare' }), categoryKey: 'prepare' })) } } }, client), /RUN_GATE_IDENTITY_MISMATCH/);
});

it('keeps two batch members distinct and uses each retained selection time while their gate remains open', () => {
  const original = snapshot('available'), section = original.sections[0];
  if (section.section !== 'workbook-writes') throw new Error('fixture missing');
  const choice = section.payload.referenceChoices![0];
  const choices = [11, 12].map((order, index) => ({ ...choice, key: `person-${String(index)}`,
    native: { ...choice.native, order, nodeId: 'choose-roster-row', eventId: `10000000-0000-4000-8000-${String(order).padStart(12, '0')}` },
    resolution: { state: 'resolved', workbookVersion: 3, resolvedAt: `2026-01-01T12:${String(index).padStart(2, '0')}:00.000Z`,
      selected: { sheetId: 'july', rowId: `row-${String(index)}`, label: `Person ${String(index)}`, values: [{ fieldId: 'email', value: `person-${String(index)}@example.test` }] } },
  }));
  const payload = RunWorkbookWritesWireSchema.parse({ ...section.payload, referenceChoices: choices });
  const projected = projectRunLogs({ ...original, sections: [{ ...section, payload }] }, client);
  const steps = payload.referenceChoices!.map(choice => projected.steps.find(step => step.id === workbookReferenceChoiceId(choice))!);
  assert.equal(new Set(steps.map(step => step.id)).size, 2);
  assert.notEqual(steps[0].time, steps[1].time);
  assert.ok(steps.every(step => step.entries[0]?.kind === 'decision' && step.entries[0].decision.state === 'recorded'));
});
