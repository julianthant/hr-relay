import assert from 'node:assert/strict';
import { it } from 'vitest';
import { composeCommandRequest, verifyShellCommandEffect } from '../../../../src/dashboard/app/commands/command-dispatch.js';
import { CommandRequestSchema, CommandResultSchema } from '../../../../src/rules/commands/commands.js';
import type { DashboardClient } from '../../../../src/dashboard/client/index.js';
import { workbookReferenceChoice, workbookReferenceDetail } from '../../../support/fixtures/workbook-reference-choice.js';
import { workbookReferenceMatchesReplay } from '../../../../src/dashboard/surfaces/run-detail/logs/workbook-write-model.js';
import { checkedCommandResult } from '../../../../src/dashboard/client/commands/shared-commands.js';
const f = workbookReferenceChoice();
const answer = { sheetId: f.candidates[0].sheetId, rowId: f.candidates[0].rowId };
const context = { actorId: 'local-operator', source: 'run-detail' as const, workbookReferenceChoice: f.choice, workbookReferenceAnswer: answer };
it('composes a read choice from exact served membership and sends only the row identities', () => {
  const result = composeCommandRequest(f.action, f.target, context); assert.equal(result.state, 'ready');
  if (result.state !== 'ready') throw new Error('fixture not composed');
  const command = CommandRequestSchema.parse(result.request);
  assert.equal(command.type, 'resolve-workbook-reference-row'); assert.deepEqual(command.payload, answer);
  assert.equal(composeCommandRequest(f.action, { ...f.target, expectedVersion: 5 }, context).state, 'refused');
  assert.equal(composeCommandRequest(f.action, f.target, { ...context, workbookReferenceAnswer: { ...answer, rowId: 'foreign' } }).state, 'refused');
  assert.equal(composeCommandRequest({ ...f.action, expectedVersion: 5 }, f.target, context).state, 'refused');
});
it('requires the exact selected reference and row in authoritative readback', async () => {
  const composed = composeCommandRequest(f.action, f.target, context); if (composed.state !== 'ready') throw new Error('fixture not composed');
  const command = CommandRequestSchema.parse(composed.request);
  const targets = [{ family: 'gate', runId: f.target.runId, gateId: f.target.gateId }, { family: 'run', runId: f.target.runId }];
  const reply = CommandResultSchema.parse({ state: 'applied', commandId: command.commandId, affectedTargets: targets });
  assert.deepEqual(checkedCommandResult(command, reply), reply);
  const resolved = { ...f.choice, resolution: { state: 'resolved' as const, workbookVersion: f.target.workbookVersion, selected: f.candidates[0] } };
  const detail = workbookReferenceDetail(resolved, 5);
  assert.equal(workbookReferenceMatchesReplay(resolved, command, detail), true);
  for (const [choice, expected] of [[f.choice, 'mismatch'], [resolved, 'matched'], [{ ...resolved, resolution: { ...resolved.resolution, selected: f.candidates[1] } }, 'mismatch'], [{ ...resolved, resolution: { ...resolved.resolution, workbookVersion: 9 } }, 'mismatch']] as const) {
    const client = { runDetail: async () => detail,
      runSection: async () => ({ section: 'workbook-writes', payload: { runId: f.target.runId, operations: [], referenceChoices: [choice] } }) } as unknown as DashboardClient;
    assert.equal((await verifyShellCommandEffect(client, '2026-11-01', command, reply)).state, expected);
  }
  const client = { runDetail: async () => detail,
    runSection: async () => ({ section: 'workbook-writes', payload: { runId: f.target.runId, operations: [], referenceChoices: [resolved] } }) } as unknown as DashboardClient;
  for (const changed of [[targets[1]], [targets[0]], [targets[0], targets[0]],
    [{ ...targets[0], gateId: 'foreign' }, targets[1]], [{ ...targets[0], runId: '00000000-0000-4000-8000-000000000009' }, targets[1]]]) {
    const result = CommandResultSchema.parse({ state: 'applied', commandId: command.commandId, affectedTargets: changed });
    assert.throws(() => checkedCommandResult(command, result));
    assert.equal((await verifyShellCommandEffect(client, '2026-11-01', command, result)).state, 'mismatch');
  }
  for (const changed of [
    { ...detail, rowRevision: f.target.expectedVersion },
    { ...detail, timeline: { ...detail.timeline, events: [] } },
    { ...detail, header: { ...detail.header, attempt: 2 } },
    ...['order', 'runId', 'traceId', 'spanPath', 'nodeId'].map(field => ({ ...detail, timeline: { ...detail.timeline,
      events: detail.timeline.events.map(event => ({ ...event, native: { ...event.native, [field]: field === 'order' ? 11 : 'foreign' } })) } })),
  ]) assert.equal(workbookReferenceMatchesReplay(resolved, command, changed as typeof detail), false);
  assert.equal(workbookReferenceMatchesReplay(resolved, command, workbookReferenceDetail(f.choice, 5)), false);
});
