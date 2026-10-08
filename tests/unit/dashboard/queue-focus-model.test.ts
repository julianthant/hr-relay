import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { applyQueuePreviewAction, queuePreviewCounts, seedQueuePreview } from '../../../src/dashboard/surfaces/queue/queue-preview-model.js';
import { FIXTURE_DAY_WIRE } from '../../parity/helpers/fixture-queue.js';
import { FIXTURE_NOW } from '../../parity/helpers/fixture-identity.js';

const rows = FIXTURE_DAY_WIRE.queueSurfaces;
const single = rows.find(row => row.surfaceKind === 'single' && row.status === 'failed');
if (single === undefined) throw new Error('missing failed queue fixture');
const newId = () => '00000000-8000-4000-8000-000000000001';

describe('approved local Focus queue actions', () => {
  it('retries as a new attempt with the same original settings and preserves the source', () => {
    const state = seedQueuePreview(rows);
    const original = state.records.find(record => record.row.runId === single.runId)!;
    const before = JSON.stringify(state);
    const next = applyQueuePreviewAction(state, 'retry', [single.runId], FIXTURE_NOW, newId);
    assert.equal(JSON.stringify(state), before);
    const retried = next.records.at(-1)!;
    assert.equal(retried.row.status, 'queued');
    assert.equal(retried.row.attempt, single.attempt + 1);
    assert.equal(retried.row.itemId, single.itemId);
    assert.equal(retried.row.runId, newId());
    assert.equal(retried.originalSettings, original.originalSettings);
    assert.equal(retried.row.priority, single.priority);
    assert.equal(retried.row.dryRun, single.dryRun);
    assert.deepEqual(retried.row.resolvedInstances, single.resolvedInstances);
    assert.ok(retried.row.pipeline.every(step => step.state === 'pending' && step.durationSec === undefined));
    assert.deepEqual(retried.row.actions, []);
    assert.equal(retried.row.facts.state, 'absent');
    assert.equal(retried.row.warnings.state, 'absent');
    const counts = queuePreviewCounts(next.records.map(record => record.row), single.workflowId);
    assert.equal(counts.find(entry => entry.status === 'failed')?.count ?? 0, 0);
    const twice = applyQueuePreviewAction(next, 'retry', [single.runId], FIXTURE_NOW, () => '00000000-8000-4000-8000-000000000002');
    assert.equal(twice.records.at(-1)?.row.attempt, single.attempt + 2);
    assert.equal(twice.records.at(-1)?.originalSettings, original.originalSettings);
  });
  it('retains archived records, deletes locally and refuses missing targets without mutation', () => {
    const state = seedQueuePreview(rows);
    const archived = applyQueuePreviewAction(state, 'archive', [single.runId], FIXTURE_NOW, newId);
    assert.equal(archived.archived[0]?.row, single);
    assert.ok(!archived.records.some(record => record.row.runId === single.runId));
    const deleted = applyQueuePreviewAction(state, 'delete', [single.runId], FIXTURE_NOW, newId);
    assert.equal(deleted.archived.length, 0);
    assert.ok(!deleted.records.some(record => record.row.runId === single.runId));
    assert.throws(() => applyQueuePreviewAction(state, 'retry', ['missing'], FIXTURE_NOW, newId), /QUEUE_MOCK_TARGET_UNAVAILABLE/);
    assert.throws(() => applyQueuePreviewAction(state, 'delete', [single.runId, single.runId], FIXTURE_NOW, newId), /QUEUE_MOCK_DUPLICATE_TARGET/);
  });
  it('retries a loaded operation with new member identities and coherent parent joins', () => {
    const group = rows.find(row => row.surfaceKind === 'operation' && row.memberRunIds.every(id => rows.some(member => member.runId === id)));
    assert.ok(group?.surfaceKind === 'operation');
    const state = seedQueuePreview(rows);
    let index = 0;
    const next = applyQueuePreviewAction(state, 'retry', [group.runId], FIXTURE_NOW, () => `00000000-8000-4000-8000-${String(++index).padStart(12, '0')}`);
    const added = next.records.slice(state.records.length);
    const retried = added.find(record => record.row.surfaceKind === 'operation');
    assert.ok(retried?.row.surfaceKind === 'operation');
    assert.equal(added.length, group.memberRunIds.length + 1);
    assert.equal(retried.row.memberRollup.terminal, 0);
    for (const member of added.filter(record => record.row.surfaceKind === 'member')) {
      assert.ok(member.row.lineage.state === 'child');
      assert.equal(member.row.lineage.parentRunId, retried.row.runId);
      assert.ok(retried.row.memberRunIds.includes(member.row.runId));
    }
  });
});
