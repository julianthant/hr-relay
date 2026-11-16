import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, derivePersistedSettingsFingerprint } from "../../../../src/models/config/settings.js";
import { batchMemberRetryAvailable } from "../../../../src/backend/runs/queries/run-retry.js";
import { workflowQueueCapabilities } from "../../../../src/backend/app/registries/workflow-registry.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it, vi } from "vitest";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { sessionFactoryHarness, healthyUcpathDriver } from "../../../support/helpers/phase1f-executor-harness.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { appliedRunIds } from "../../../support/fixtures/operator-command-fixtures.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

it("serves a native Lookup batch root Retry, retains its session once on replay and leaves siblings untouched", async () => {
  const harness = await world.executorHarness({ descriptor: personLookupDescriptor, stores: taskStoreRegistry,
    sessions: sessionFactoryHarness({ ucpath: () => ({ ...healthyUcpathDriver(), async searchPersonOrg() { throw new Error("synthetic-lookup-failure"); } }) }) });
  const { database, clock, path, stateRoot } = harness.authority;
  let descriptor = personLookupDescriptor;
  const resolve = (id: string) => id === personLookupDescriptor.id ? descriptor : undefined;
  const canonical = canonicalChildExecution(harness.deps, database, path, resolve);
  const h = { database, clock, stateRoot, kernel: canonical.kernel, plannerIds: { uuid: randomUUID } };
  const runtime = h.database.authority.runtimeConfig.get(); assert.ok(runtime);
  const plan = planStart({ authority: h.database, clock: h.clock, ids: h.plannerIds, planTtlMs: 600_000 }, {
    descriptor: personLookupDescriptor, submissions: [{ emplId: "10800000" }, { emplId: "10800001" }], dryRun: false,
    priority: "bulk", shape: "single", configFingerprint: runtime.configFingerprint, configSnapshotId: runtime.configSnapshotId, plannedBy: "local-operator",
  });
  assert.equal(h.database.authority.startPlans.create(plan).state, "inserted");
  const started = h.kernel.execute({ commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
    family: "start", type: "start-run", target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.version },
    payload: { descriptorFingerprint: plan.descriptorFingerprint, configFingerprint: plan.configFingerprint, ingressSchemaHash: plan.ingressSchemaHash,
      canonicalInputSchemaHash: plan.canonicalInputSchemaHash, inputFingerprint: plan.inputFingerprint } }); assert.equal(started.state, "applied");
  const [runId, siblingId] = appliedRunIds(started).map(id => RunIdSchema.parse(id));
  const source = h.database.authority.runs.get(runId), sibling = h.database.authority.runs.get(siblingId);
  assert.ok(source?.sessionId && sibling);
  assert.equal((await canonical.step(source, world.SIGNAL)).outcome.state, "failed");
  const failed = h.database.authority.runs.get(runId); assert.ok(failed);
  const reader = canonical.lifecycle;
  const projection = createOperatorProjection({ database: h.database, reader, stateRoot: h.stateRoot, clock: h.clock,
    appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(h.database.authority),
    descriptors: { resolve } });
  const row = projection.queueSurface(runId); assert.ok(row);
  const retry = row.actions.find(action => action.kind === "command" && action.command === "retry"); assert.ok(retry?.kind === "command");
  assert.deepEqual(retry.placement, ["banner"]); assert.equal(retry.expectedVersion, failed.version);
  assert.equal(row.parent, null); assert.equal(row.session.state, "present");
  const command = { commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "run-detail",
    family: "run", type: "retry", target: { runId, expectedVersion: retry.expectedVersion } };
  const stale = h.kernel.execute({ ...command, commandId: randomUUID(), target: { runId, expectedVersion: failed.version - 1 } });
  assert.equal(stale.state, "conflict");
  descriptor = { ...personLookupDescriptor, contractFingerprint: FingerprintSchema.parse("b".repeat(64)) };
  assert.equal(batchMemberRetryAvailable(h.database.authority, failed, descriptor, workflowQueueCapabilities("person-lookup")), false);
  assert.equal(batchMemberRetryAvailable(h.database.authority, failed, descriptor), false);
  const mismatched = h.kernel.execute({ ...command, commandId: randomUUID() });
  assert.ok(mismatched.state === "rejected" && mismatched.code === "schema-mismatch");
  descriptor = personLookupDescriptor;
  const blocked: ((repositories: AuthorityRepositories) => AuthorityRepositories)[] = [
    repositories => ({ ...repositories, runs: { ...repositories.runs, admission: () => ({ state: "draining", commandId: randomUUID(), hold: "update" }) } }),
  ];
  for (const view of blocked) {
    assert.equal(batchMemberRetryAvailable(view(h.database.authority), failed, descriptor, workflowQueueCapabilities("person-lookup")), false);
    const transaction = h.database.withAuthorityTransaction.bind(h.database);
    const views = new WeakMap<AuthorityRepositories, AuthorityRepositories>();
    const intercepted = vi.spyOn(h.database, "withAuthorityTransaction").mockImplementation(work => transaction(repositories => {
      let wrapped = views.get(repositories); if (wrapped === undefined) { wrapped = view(repositories); views.set(repositories, wrapped); }
      return work(wrapped);
    }));
    try {
      const rejected = h.kernel.execute({ ...command, commandId: randomUUID() });
      assert.ok(rejected.state === "rejected" && rejected.code === "policy-refused");
    } finally { intercepted.mockRestore(); }
    assert.equal(h.database.authority.runs.listBySession(source.sessionId).length, 2);
  }
  const runtimeMissing = { ...h.database.authority, runtimeConfig: { ...h.database.authority.runtimeConfig, get: () => undefined } };
  assert.throws(() => batchMemberRetryAvailable(runtimeMissing, failed, descriptor, workflowQueueCapabilities("person-lookup")), /run-retry-runtime-unavailable/);
  const applied = h.kernel.execute(command); assert.equal(applied.state, "applied");
  assert.equal(h.kernel.execute(command).state, "already-applied");
  const attempts = h.database.authority.runs.listBySession(source.sessionId);
  assert.equal(attempts.length, 3);
  const next = attempts.find(run => run.envelope.retryOf === runId); assert.ok(next);
  assert.equal(projection.queueSurface(runId)?.actions.some(action => action.key === "retry-batch-member"), false);
  assert.equal(next.sessionId, source.sessionId); assert.equal(next.envelope.parent, undefined);
  assert.equal(next.envelope.itemId, source.envelope.itemId); assert.equal(next.envelope.attempt, 2);
  assert.deepEqual(h.database.authority.runs.get(siblingId), sibling);
  assert.deepEqual(h.database.authority.runs.get(runId), failed);
  const refused = h.kernel.execute({ ...command, commandId: randomUUID() });
  assert.ok(refused.state === "rejected" && refused.code === "policy-refused");
  assert.equal(h.database.authority.runs.listBySession(source.sessionId).length, 3);
  assert.deepEqual(h.database.authority.writeIntents.listByRun(next.envelope.runId), []);
  assert.equal(h.kernel.execute({ ...command, commandId: randomUUID(), type: "cancel", target: { runId: next.envelope.runId, expectedVersion: next.version } }).state, "applied");
  assert.ok(projection.queueSurface(runId)?.actions.some(action => action.key === "retry-batch-member"));
  const settings = { timeouts: { taskMs: 90_000 } }, patch = { "timeouts.taskMs": { set: 90_000 } };
  const unused = (): never => { throw new Error("unexpected protected settings effect"); };
  const saved = executeSettingsCommand({ authority: h.database, clock: h.clock, ids: { uuid: randomUUID }, settings: {
    validateRequest: () => undefined, commitPrivate: unused, reconcileReplay: unused, applyOrdinary: () => ({ state: "applied", revision: 2, settings,
      settingsFingerprint: derivePersistedSettingsFingerprint(settings), restartRequired: true }) } }, {
    commandId: randomUUID(), family: "settings", type: "apply-settings", requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: 1 }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  assert.equal(saved.state, "applied");
  assert.equal(projection.queueSurface(runId)?.actions.some(action => action.key === "retry-batch-member"), false);
  assert.throws(() => h.kernel.execute({ ...command, commandId: randomUUID() }), /dashboard runtime settings are stale/);
  assert.equal(h.database.authority.runs.listBySession(source.sessionId).length, 3);

});
