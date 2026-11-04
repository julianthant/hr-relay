import assert from 'node:assert/strict';
import { afterEach, it } from 'vitest';
import { createAssistantReadAllowlist } from '../../../../../src/backend/app/composition/dashboard/assistant.js';
import { createProductionAssistantTools } from '../../../../../src/backend/assistant/tools.js';
import { assistantKnowledgeArtifact, createAssistantContext } from '../../../../../src/backend/assistant/context.js';
import { createAssistantService } from '../../../../../src/backend/assistant/service.js';
import { type RunDetailQueryDeps, buildRunDetail } from '../../../../../src/backend/runs/queries/run-detail.js';
import { type AssistantInferenceRequest, AssistantResultSchema } from '../../../../../src/models/dashboard/assistant.js';
import { RunRecordSchema } from '../../../../../src/models/run/record.js';
import { canonicalJsonStringify } from '../../../../../src/rules/validation/canonical-json.js';
import { makeWorld, queuedEventOf, uuidOf, type DashboardWorld } from '../../../../support/helpers/backend/dashboard-harness.js';

const worlds: DashboardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.dispose(); });
async function fixture() {
  const world = await makeWorld(); worlds.push(world);
  queuedEventOf(world, { seed: 1, displayName: 'Private selected person' });
  const runId = uuidOf(1), subjectRef = `run_${runId}_1`;
  const runDetail: RunDetailQueryDeps = { runReader: world.runReader, timeline: world.timeline,
    stateRoot: world.stateRoot, projection: world.projection, authority: world.authority, descriptors: { resolve: () => undefined } };
  let current = true;
  const assertCurrent = () => { if (!current) throw Error('person changed'); };
  const reads = createAssistantReadAllowlist({ runDetail, assertCurrent });
  const unreachable = (): never => { throw Error('write owner reached by a read'); };
  const knowledge = assistantKnowledgeArtifact();
  const tools = createProductionAssistantTools({ database: world.database, clock: world.clock, actorId: 'local-operator', assertCurrent, knowledge, reads,
    kernel: { assistantManifest: unreachable, assistantAvailability: unreachable },
    authorization: { createChat: unreachable, prepare: unreachable, approve: unreachable, consume: unreachable, cancel: unreachable } });
  const payloads: AssistantInferenceRequest[] = [];
  let beforeReply = () => {}, forgeReference = false, textOnly = false;
  const service = createAssistantService({ ...tools, context: createAssistantContext(Buffer.from(knowledge.bytes), knowledge.policy),
    runtime: () => knowledge.policy, clock: world.clock,
    modelPolicy: () => ({ policy: { eligible: true, consented: true, billing: 'chatgpt-plan', model: 'synthetic', verifiedUntil: '2099-01-01T00:00:00Z' }, isCurrent: () => current }),
    account: { readAuthority: async () => ({ revision: 1, attemptGeneration: 1, availability: 'available' }), revalidateAuthority: () => current,
      listAssistantModels: async () => ({ authority: { revision: 1, attemptGeneration: 1, availability: 'available' }, catalog: { models: [{ slug: 'synthetic', displayName: 'Synthetic' }] } }),
      async inferAssistant(request) {
        payloads.push(request); beforeReply();
        const projected: unknown = JSON.parse('content' in request.input[1] ? String(request.input[1].content) : '{}');
        const reference = typeof projected === 'object' && projected !== null && 'reference' in projected ? projected.reference : undefined;
        return { responseId: 'synthetic', model: 'synthetic', output: textOnly
          ? [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'This run succeeded.' }] }]
          : [{ type: 'function_call', call_id: 'read-1', namespace: 'relay', name: 'explain_selected_run', arguments: JSON.stringify({ reference: forgeReference ? 'ref_' + 'f'.repeat(32) : reference }) }] };
      } },
  });
  return { world, runId, subjectRef, runDetail, reads, service, payloads,
    beforeReply(work: () => void) { beforeReply = work; }, revoke() { current = false; }, forge() { forgeReference = true; }, textOnly() { textOnly = true; } };
}
it('reads canonical status with exact validated local citations, no private provider input and no write owner', async () => {
  const f = await fixture(), before = f.world.database.getMeta().authorityGeneration;
  const result = AssistantResultSchema.parse(await f.service.respond({ message: 'Explain this run?', subjectRef: f.subjectRef }, new AbortController().signal));
  assert.equal(result.state, 'answered'); if (result.state !== 'answered') throw Error('answer required');
  assert.match(result.text, /Private selected person: queued/u);
  assert.match(result.text, /No timeline events are recorded/u);
  const status = result.citations.find(citation => 'kind' in citation && citation.source === 'status');
  assert.ok(status && 'kind' in status);
  assert.equal(status.quote, canonicalJsonStringify(buildRunDetail(f.runDetail, f.runId).header));
  assert.equal(status.rowRevision, 1); assert.equal(status.runId, f.runId);
  assert.equal(result.citations.length, 4);
  const outbound = JSON.stringify(f.payloads);
  for (const privateValue of ['Private selected person', '10873698', f.runId, f.subjectRef, 'Explain this run']) assert.equal(outbound.includes(privateValue), false);
  assert.equal(f.payloads.length, 1);
  assert.equal(f.world.database.getMeta().authorityGeneration, before);
});
it('refuses forged evidence, stale revisions, missing runs and changed person authority', async () => {
  const f = await fixture(), captured = f.reads.selectedRun(f.subjectRef), citation = captured.citations[0];
  for (const changed of [{ ...citation, quote: 'forged' }, { ...citation, digest: 'a'.repeat(64) }, { ...citation, rowRevision: 2 }, { ...citation, runId: uuidOf(2) }, { ...citation, source: 'gate' as const }]) assert.throws(() => captured.validateCitation(changed));
  assert.throws(() => f.reads.selectedRun(`run_${f.runId}_2`));
  for (const reference of [undefined, 'selected-person', `run_${f.runId}_9007199254740992`, `run_${uuidOf(2)}_1`]) assert.throws(() => f.reads.selectedRun(reference));
  f.world.authority.records.delete(f.runId);
  assert.throws(() => captured.assertCurrent());
  f.revoke(); assert.throws(() => f.reads.selectedRun(f.subjectRef));
});
it.each(['version', 'deleted', 'person', 'reference', 'text-only'] as const)('refuses %s changes across inference without fabricating a local answer', async kind => {
  const f = await fixture();
  if (kind === 'reference') f.forge();
  if (kind === 'text-only') f.textOnly();
  f.beforeReply(() => {
    if (kind === 'version') {
      const run = f.world.authority.records.get(f.runId); assert.ok(run);
      f.world.authority.put(RunRecordSchema.parse({ ...run, version: 2 }));
    }
    if (kind === 'deleted') f.world.authority.records.delete(f.runId);
    if (kind === 'person') f.revoke();
  });
  const result = await f.service.respond({ message: 'run status', subjectRef: f.subjectRef }, new AbortController().signal);
  assert.equal(result.state, 'refused'); assert.equal(f.payloads.length, 1);
});
