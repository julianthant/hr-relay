import assert from 'node:assert/strict';
import { it } from 'vitest';
import { composeCommandRequest, verifyShellCommandEffect } from '../../../../src/dashboard/app/commands/command-dispatch.js';
import { CommandRequestSchema, CommandResultSchema } from '../../../../src/rules/commands/commands.js';
import type { DashboardClient } from '../../../../src/dashboard/client/index.js';
import { workbookReferenceChoice } from '../../../support/fixtures/workbook-reference-choice.js';
import { workbookReferenceMatchesReplay } from '../../../../src/dashboard/surfaces/run-detail/logs/workbook-write-model.js';
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
  const reply = CommandResultSchema.parse({ state: 'applied', commandId: command.commandId, affectedTargets: [{ family: 'run', runId: f.target.runId }] });
  const resolved = { ...f.choice, resolution: { state: 'resolved' as const, workbookVersion: f.target.workbookVersion, selected: f.candidates[0] } };
  assert.equal(workbookReferenceMatchesReplay(resolved, command), true);
  for (const [choice, expected] of [[f.choice, 'mismatch'], [resolved, 'matched'], [{ ...resolved, resolution: { ...resolved.resolution, selected: f.candidates[1] } }, 'mismatch'], [{ ...resolved, resolution: { ...resolved.resolution, workbookVersion: 9 } }, 'mismatch']] as const) {
    const client = { runDetail: async () => ({ runId: f.target.runId, rowRevision: 5, availableSections: ['workbook-writes'] }),
      runSection: async () => ({ section: 'workbook-writes', payload: { runId: f.target.runId, operations: [], referenceChoices: [choice] } }) } as unknown as DashboardClient;
    assert.equal((await verifyShellCommandEffect(client, '2026-11-01', command, reply)).state, expected);
  }
});
