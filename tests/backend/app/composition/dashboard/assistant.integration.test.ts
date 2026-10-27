import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { z } from 'zod';
import { DatabaseSync } from 'node:sqlite';
import { assistantCoupledWorld, SYNTHETIC_ASSISTANT_SOURCE } from '../../../../support/helpers/assistant-coupled-world.js';
import { createAssistantController } from '../../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { ASSISTANT_FAILURES } from '../../../../../src/models/dashboard/assistant.js';
import { createDashboardClient } from '../../../../../src/dashboard/client/index.js';
import { disposeHttpRouteHarness, harness } from '../../../../support/helpers/backend/http-route-harness.js';
import { runRecordOf } from '../../../../support/helpers/backend/dashboard-harness.js';
import { personLookupDescriptor, separationsDescriptor } from '../../../../support/helpers/registered-workflows.js';
import { writeFixtureDescriptorWithoutDryRunArm } from '../../../../support/fixtures/write-sequencer-fixtures.js';

function authorityRows(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => {
      assert.equal(typeof row.name, 'string');
      if (typeof row.name !== 'string' || !/^[a-z_]+$/u.test(row.name)) throw new Error('table-name-invalid');
      return { table: row.name, rows: db.prepare(`SELECT * FROM ${row.name} ORDER BY rowid`).all() };
    });
  } finally { db.close(); }
}
it('couples controller, shared client, admitted mounted HTTP, actual account parser, pure planner and canonical repositories with zero durable effects', async () => {
  const f = await assistantCoupledWorld();
  try {
    const before = authorityRows(f.databasePath);
    f.controller.action({ type: 'edit', value: 'Propose a dry run for the selected synthetic subject' });
    f.controller.action({ type: 'send' });
    await vi.waitFor(() => assert.equal(f.controller.snapshot().turn.state, 'proposal'));
    const turn = f.controller.snapshot().turn; assert.equal(turn.state, 'proposal');
    if (turn.state !== 'proposal') throw new Error('proposal-not-settled');
    assert.equal(turn.proposal.subjects.length, 1); assert.equal(turn.proposal.subjects[0].id, f.subject().employeeId);
    assert.equal(turn.proposal.mode, 'dry-run'); assert.match(turn.proposal.stopBefore[0], /submit-write/u);
    assert.equal(f.requests(), 1); assert.equal(f.identities(), 1);
    const accountCalls = f.account.calls.filter(call => call.url.endsWith('/responses')); assert.equal(accountCalls.length, 1);
    f.controller.action({ type: 'confirm' }); f.controller.action({ type: 'confirm' });
    assert.equal(f.requests(), 1, 'zero additional plan/preparation/dispatch HTTP calls');
    assert.deepEqual(authorityRows(f.databasePath), before, 'zero plan rows, command acceptance, preparation, HR writes or other durable deltas');
    assert.equal(f.controller.snapshot().turn.state, 'proposal');
  } finally { await f.close(); }
});
it('coupled actual account/broker/planner refuses ambiguity, changed selection, current-policy loss, protected and no-transaction proposals', async () => {
  for (const kind of ['ambiguity', 'subject', 'policy', 'protected', 'no-transaction'] as const) {
    const f = await assistantCoupledWorld();
    try {
      if (kind === 'ambiguity') { f.ambiguous(); f.reply({ action: 'read-subjects', query: 'Synthetic' }); }
      if (kind === 'subject') f.beforeInference(() => f.staleSubject());
      if (kind === 'policy') f.beforeInference(() => f.invalidatePolicy());
      if (kind === 'protected' || kind === 'no-transaction') {
        const descriptor = kind === 'protected' ? separationsDescriptor : personLookupDescriptor;
        f.descriptor(descriptor); f.reply({ action: 'propose', workflowId: descriptor.id, intent: 'dry-run' });
      }
      const before = authorityRows(f.databasePath);
      const result = await f.client.assistantRespond({ message: 'Prepare', subjectRef: f.subject().subjectRef });
      if (kind === 'ambiguity') assert.equal(result.state, 'resolution-required');
      else {
        assert.equal(result.state, 'refused');
        if (result.state === 'refused') assert.equal(result.code, kind === 'subject' ? 'ASSISTANT_SUBJECT_REQUIRED' : kind === 'policy' ? 'ASSISTANT_MODEL_UNVERIFIED' : 'ASSISTANT_PROPOSAL_REFUSED');
      }
      assert.deepEqual(authorityRows(f.databasePath), before);
      if (kind === 'protected') assert.equal(f.mapped(), 0, 'protected descriptors refuse before mapping or pure planning');
      assert.equal(f.plannerIds(), 0, 'refused proposals never enter pure planning');
    } finally { await f.close(); }
  }
});
it('canonical planner adapter detects subject, descriptor/schema and run-authority changes and checks the actual schema-bound subject', async () => {
  for (const kind of ['subject', 'config', 'descriptor', 'schema', 'run-authority'] as const) {
    const f = await assistantCoupledWorld();
    try {
      const context = f.adapters.planner.context('write-fixture', f.subject());
      if (kind === 'subject') f.staleSubject();
      if (kind === 'config') f.changeConfig();
      if (kind === 'descriptor') f.descriptor(writeFixtureDescriptorWithoutDryRunArm);
      if (kind === 'schema') f.descriptor({ ...context.request.descriptor, input: z.strictObject({ different: z.string() }) });
      if (kind === 'run-authority') { const run = runRecordOf({ seed: 42 }); f.database.authority.runs.enqueue({ ...run, envelope: { ...run.envelope, configSnapshotId: context.request.configSnapshotId, configFingerprint: context.request.configFingerprint } }); }
      assert.throws(() => context.assertCurrent());
    } finally { await f.close(); }
  }
  const f = await assistantCoupledWorld();
  try {
    const context = f.adapters.planner.context('write-fixture', f.subject());
    assert.throws(() => context.assertSubjectBinding({ schemaHash: context.request.descriptor.contractFingerprint, value: { eid: '10899999' } }));
  } finally { await f.close(); }
});
it('canonical client validates inputs/results and production app exposes named unavailable without trusted composition', async () => {
  const h = await harness();
  try {
    let calls = 0;
    const client = createDashboardClient({ baseUrl: 'http://127.0.0.1:3938', fetchImpl: async (url, init) => {
      calls++; return h.app.request(url, { ...init, headers: { ...init?.headers, host: '127.0.0.1:3938' } });
    } });
    assert.deepEqual(await client.assistantRespond({ message: 'Explain' }), { state: 'refused', code: 'ASSISTANT_UNAVAILABLE', message: ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE });
    await assert.rejects(client.assistantRespond({ message: 'x'.repeat(4001) })); assert.equal(calls, 1);
    const malformed = createDashboardClient({ baseUrl: 'http://127.0.0.1:3938', fetchImpl: async () => Response.json({ state: 'answered', text: 'bad', citations: [{ path: 'bad' }] }) });
    await assert.rejects(malformed.assistantRespond({ message: 'Explain' }));
  } finally { await disposeHttpRouteHarness(); }
});
it('coupled citations are bounded, policy/config authority changes cancel settlement, and cancellation/New Chat cannot admit a late response', async () => {
  const f = await assistantCoupledWorld();
  try {
    f.reply({ action: 'answer', text: 'Explanation', citations: [{ path: 'docs/rebuild/assistant.md', revision: SYNTHETIC_ASSISTANT_SOURCE.revision, startLine: 2, endLine: 3, quote: 'Dry runs stop before writes.' }] });
    const forged = await f.client.assistantRespond({ message: 'Explain' }); assert.equal(forged.state, 'refused');
    f.reply({ action: 'answer', text: 'Late answer', citations: [] });
    for (const action of ['new-chat', 'cancel', 'authority'] as const) {
      const c = createAssistantController(f.client, { authority: 'original', subjectRef: f.subject().subjectRef });
      f.beforeInference(() => { if (action === 'authority') { f.changeConfig(); c.bind({ authority: 'changed-config' }); } else c.action({ type: action }); });
      c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
      await vi.waitFor(() => assert.notEqual(c.snapshot().turn.state, 'waiting'));
      assert.equal(c.snapshot().messages.some(message => message.text === 'Late answer'), false);
      assert.equal(c.snapshot().sequence, 1); c.abort();
    }
  } finally { await f.close(); }
});

it('private runtime identity refuses before actual synthetic account inference', async () => {
  const f = await assistantCoupledWorld();
  try {
    f.staleRuntime();
    const result = await f.client.assistantRespond({ message: 'Explain' });
    assert.equal(result.state, 'refused');
    if (result.state === 'refused') assert.equal(result.code, 'ASSISTANT_CONTEXT_STALE');
    assert.equal(f.account.calls.filter(call => call.url.endsWith('/responses')).length, 0);
  } finally { await f.close(); }
});
