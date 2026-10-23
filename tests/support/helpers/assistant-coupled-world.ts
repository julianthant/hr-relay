import { createSettingsApplicationExecutor } from '../../../src/backend/runs/commands/settings-service.js';
import { executeSettingsCommand } from '../../../src/backend/runs/commands/command-kernel.js';
import { resolveConfigWithProvenance } from '../../../src/backend/app/config/resolve.js';
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from '../../../src/models/config/settings.js';
import { readSettings } from '../../../src/backend/runtime/settings/settings-runtime.js';
import { createBoundProfileFixture, boundProfileCredentials } from './admission-fixture.js';
import { registerChatGptAccountRoutes } from '../../../src/backend/transports/http/routes/chatgpt-account.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { createAssistantPlanningAdapters } from '../../../src/backend/app/composition/dashboard/assistant.js';
import { createAssistantContext, PUBLIC_ASSISTANT_REPOSITORY_ID } from '../../../src/backend/assistant/context.js';
import { createAssistantService } from '../../../src/backend/assistant/service.js';
import { registerAssistantRoutes } from '../../../src/backend/transports/http/routes/assistant.js';
import { createSoloRequestIdentityCheckpoint } from '../../../src/backend/transports/http/request-identity.js';
import type { DashboardApp } from '../../../src/backend/transports/http/routes/api-types.js';
import { createDashboardClient } from '../../../src/dashboard/client/index.js';
import { createAssistantController } from '../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { deriveSchemaHash } from '../../../src/models/validation/schema-bound-value.js';
import { RunRecordSchema } from '../../../src/models/run/record.js';
import type { AssistantSubject, AssistantTurn } from '../../../src/models/dashboard/assistant.js';
import type { AnyWorkflowDescriptor } from '../../../src/workflow-kit/workflow.js';
import { AuthorityDatabase } from './synthetic-storage-admission.js';
import { chatGptFixture, completedOcrStream } from './chatgpt-account-fixtures.js';
import { runRecordOf } from './backend/dashboard-harness.js';
import { seedInitialSettingsRuntimeConfig } from '../fixtures/operator-command-fixtures.js';
import { sequentialIdFactory } from '../fixtures/phase1f-run-fixtures.js';
import { writeFixtureDescriptor } from '../fixtures/write-sequencer-fixtures.js';

export const SYNTHETIC_ASSISTANT_SOURCE = { repositoryId: PUBLIC_ASSISTANT_REPOSITORY_ID, revision: '9af76694409eeff5e0ac954fc9501bc69991643a' };
export async function assistantCoupledWorld() {
  const profile = createBoundProfileFixture();
  const account = chatGptFixture(profile.admission);
  const database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: 'assistant-synthetic' }, account.clock);
  try {
  seedInitialSettingsRuntimeConfig(database, account.clock);
  await account.connected();
  const baseRun = runRecordOf({ seed: 41, workflow: 'synthetic-selection', displayName: 'Avery Synthetic' });
  const active = database.authority.runtimeConfig.get(); assert.ok(active);
  const selectedRun = RunRecordSchema.parse({ ...baseRun, envelope: { ...baseRun.envelope, configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint },
    input: { raw: { eid: '10812345' }, parsed: { schemaHash: deriveSchemaHash(writeFixtureDescriptor.canonicalInput, 'output'), protectedBindings: [], value: { eid: '10812345' } }, ingressSchemaHash: deriveSchemaHash(writeFixtureDescriptor.input, 'input') } });
  database.authority.runs.enqueue(selectedRun);
  let descriptor: AnyWorkflowDescriptor = writeFixtureDescriptor, currentPolicy = true;
  let subjectVersion = '', reply: AssistantTurn = { action: 'propose', workflowId: 'write-fixture', intent: 'dry-run' };
  let hold = false, pendingStream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let beforeInference: (() => void) | undefined;
  const subject = (): AssistantSubject => {
    const run = database.authority.runs.get(selectedRun.envelope.runId); assert.ok(run && run.displayName);
    const value = z.strictObject({ eid: z.string().regex(/^\d{8}$/u) }).parse(run.input.parsed.value);
    return { subjectRef: run.envelope.runId, displayName: run.displayName + subjectVersion, employeeId: value.eid };
  };
  let candidates = [subject()];
  let mapped = 0, plannerIds = 0; const ids = sequentialIdFactory('f');
  const adapters = createAssistantPlanningAdapters({ database, clock: account.clock, ids: { uuid() { plannerIds++; return ids.uuid(); } }, planTtlMs: 600_000,
    descriptors: { resolve: id => id === descriptor.id ? descriptor : undefined },
    subjects: { search: () => candidates, resolve: ref => { assert.equal(ref, subject().subjectRef); return subject(); } },
    submission: (_flow, person) => { mapped++; return { eid: person.employeeId }; },
    assertSubjectBinding: (_flow, person, input) => assert.equal(z.object({ eid: z.string() }).parse(input.value).eid, person.employeeId),
  });
  const file = { path: 'docs/rebuild/assistant.md', mode: '100644', text: 'Synthetic public reference.\nDry runs stop before writes.' };
  const bytes = Buffer.from(JSON.stringify({ ...SYNTHETIC_ASSISTANT_SOURCE, files: [file] }));
  const context = createAssistantContext(bytes, { ...SYNTHETIC_ASSISTANT_SOURCE, exportSha256: createHash('sha256').update(bytes).digest('hex') });
  account.setResponse(() => {
    beforeInference?.();
    return new Response(hold ? new ReadableStream<Uint8Array>({ start(controller) { pendingStream = controller; }, cancel() { pendingStream = undefined; } })
      : completedOcrStream(JSON.stringify(reply)), { headers: { 'content-type': 'text/event-stream' } });
  });
  let runtime = { ...SYNTHETIC_ASSISTANT_SOURCE }, requests = 0, identities = 0;
  const service = createAssistantService({ ...adapters, account: account.service, context, clock: account.clock, runtime: () => runtime,
    modelPolicy: { model: 'gpt-6.1-sol', eligible: true, consented: true, billing: 'chatgpt-plan', verifiedUntil: '2026-10-19T00:00:00Z' }, isModelPolicyCurrent: () => currentPolicy });
  const app: DashboardApp = new Hono();
  const identity = createSoloRequestIdentityCheckpoint({ id: 'local-operator', label: 'Local operator' });
  app.use('*', async (c, next) => { identities++; c.set('requestActorId', identity.identify(c.req.raw)); return next(); });
  registerAssistantRoutes(app, service);
  registerChatGptAccountRoutes(app, { chatGptAccount: account.service });
  const client = createDashboardClient({ baseUrl: 'http://127.0.0.1:3938', fetchImpl: async (url, init) => {
    requests++; assert.equal(new URL(url).pathname, '/api/v1/assistant/respond', 'Confirm must never request a start plan or command');
    return app.request(url, { ...init, headers: { ...init?.headers, host: '127.0.0.1:3938' } });
  } });
  const settings = createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, { primaryDisplay: null }, account.clock), boundProfileCredentials(profile.admission));
  const controller = createAssistantController(client, { authority: 'synthetic-selected-authority', subjectRef: subject().subjectRef });
  return { account, database, databasePath: profile.path, app, client, controller, subject, adapters, context, service,
    holdReply() { hold = true; },
    releaseReply() { hold = false; const stream = pendingStream; pendingStream = undefined; if (stream) { stream.enqueue(new TextEncoder().encode(completedOcrStream(JSON.stringify(reply)))); stream.close(); } },
    mapped: () => mapped, plannerIds: () => plannerIds,
    requests: () => requests, identities: () => identities,
    reply(value: AssistantTurn) { reply = value; }, beforeInference(hook: () => void) { beforeInference = hook; },
    changeConfig() {
      const patch = { 'features.debugScreenshots': { set: true } };
      const result = executeSettingsCommand({ authority: database, clock: account.clock, ids: sequentialIdFactory('b'), settings }, {
        commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', family: 'settings', type: 'apply-settings', requestedAt: account.clock.now().toISOString(),
        requestedBy: 'local-operator', source: 'settings-surface', target: { expectedRevision: readSettings(database.authority).revision },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
      });
      assert.ok(result.state === 'applied');
    },
    invalidatePolicy() { currentPolicy = false; }, staleSubject() { subjectVersion = ' changed'; },
    descriptor(value: AnyWorkflowDescriptor) { descriptor = value; },
    ambiguous() { candidates = [subject(), { ...subject(), subjectRef: 'synthetic-second-subject' }]; },
    staleRuntime() { runtime = { ...runtime, revision: 'a'.repeat(40) }; },
    async close() { controller.abort(); await account.cleanup(); database.close(); profile.close(); },
  };
  } catch (error) { await account.cleanup(); database.close(); profile.close(); throw error; }
}
