import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { readDelegationEvidence, readDelegationInvocationEvidence, readDelegationScopeEvidence } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { buildRunPreviewResult, buildRunResult } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { afterAll } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { stopSyntheticDatabaseWorkers } from "../../../support/helpers/synthetic-database-admission.js";
import { childWriteRecoveryRoot as root, childPrerequisiteRoot, childPrerequisiteModules, childCrashWrite, parallelChildWriteRecoveryRoot, childReadPreviewRoot, childUnsupportedPreviewRoot, childUnsupportedPreviewTarget, childGateResumeRoot, childPreviewPrerequisiteRoot, childPreviewDispatchRoot, childPreviewEmptyRoot, childPreviewNestedRoot } from "../../../support/fixtures/child-execution-write-workflow.js";
import assert from "node:assert/strict";
import { ErrorCatalogCodeSchema } from "../../../../src/models/failures/error-catalog.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { taskImplFingerprint } from "../../../../src/workflow-kit/fingerprints.js";
import { reconcileExitedWorker } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { descriptorRuntimeNodes, authorizeWorkflowDelegationRefresh, assertWorkflowDelegationRefreshAuthorization, workflowDryRunSupport, workflowProjections } from "../../../../src/workflow-kit/workflow.js";
import { createWorkflowDescriptorRegistry } from "../../../../src/workflows/registry.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { testRunLifecycle, testWorkerLifetime, testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, createWriteFixtureWorld, writeFixtureDescriptor,
  writeFixtureSessions, WRITE_FIXTURE_EID, WRITE_FIXTURE_WORKER_ID, WriteFixtureCommit } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { AuthorityDatabase, createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";

import { RunDryRunPreviewResultSchema, RunDelegatedDryRunPreviewResultSchema, RunResultRecordSchema, delegationDependencyRecord, deriveRunResultDigest, deriveCheckpointOutputDigest, deriveCheckpointProvenanceDigest } from "../../../../src/models/run/result.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { Plan1Output, plan1Contract, plan1Leaf } from "../../../support/fixtures/plan1-operation-workflows.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const world = createRunExecutorTestWorld(profiles.create);
afterEach(world.cleanup);

async function fixture(mode: "single" | "prerequisites" | "parallel" | "read-preview" | "unsupported-preview" | "gate-resume" | "delegated-prerequisite" | "dispatch-preview" | "empty-preview" | "nested-preview" = "single", dryRun = false) {
  const prerequisites = mode === "prerequisites", parallel = mode === "parallel", readPreview = mode === "read-preview", unsupportedPreview = mode === "unsupported-preview";
  const withReads = prerequisites || readPreview || unsupportedPreview || mode === "gate-resume";
  const delegatedPrerequisite = mode === "delegated-prerequisite" || mode === "dispatch-preview" || mode === "empty-preview" || mode === "nested-preview";
  const driver = createWriteFixtureWorld(), graph = withReads || parallel || delegatedPrerequisite ? childPrerequisiteModules(driver) : undefined;
  const selectedRoot = mode === "nested-preview" ? childPreviewNestedRoot : mode === "dispatch-preview" ? childPreviewDispatchRoot : mode === "empty-preview" ? childPreviewEmptyRoot
    : delegatedPrerequisite ? childPreviewPrerequisiteRoot : mode === "gate-resume" ? childGateResumeRoot : readPreview ? childReadPreviewRoot : unsupportedPreview ? childUnsupportedPreviewRoot
    : parallel ? parallelChildWriteRecoveryRoot : prerequisites ? childPrerequisiteRoot : root;
  if (parallel && dryRun) createWorkflowDescriptorRegistry([selectedRoot.descriptor], [plan1Leaf.descriptor, childCrashWrite.descriptor]);
  if (delegatedPrerequisite) createWorkflowDescriptorRegistry([selectedRoot.descriptor], [childCrashWrite.descriptor,
    ...(mode === "nested-preview" ? [childPreviewPrerequisiteRoot.descriptor] : [])]);
  const stores = graph?.stores ?? buildWriteFixtureRegistry(driver);
  const h = await world.executorHarness({ descriptor: selectedRoot.descriptor, stores, sessions: writeFixtureSessions(driver) });
  const { database, clock, stateRoot, path } = h.authority;
  const patch = { "actor.label": { set: "Synthetic operator" } } as const;
  assert.equal(executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor(settings => resolveConfigWithProvenance(settings, hostConfigFacts({}), clock),
      createCredentialStore({ stateRoot })) }, { commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface",
    requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }).state, "applied");
  const sequencer = createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores, authority: database,
    sessions: h.manager, emitter: h.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: h.scheduler, taskDeadlineMs: 60_000,
    operator: "local-operator", log: h.deps.log });
  const execution = canonicalChildExecution({ ...h.deps, writeSequencer: sequencer,
    }, database, path,
    workflow => graph === undefined ? workflow === root.descriptor.id ? root.descriptor : workflow === writeFixtureDescriptor.id ? writeFixtureDescriptor : undefined
      : workflow === selectedRoot.descriptor.id ? selectedRoot.descriptor : mode === "nested-preview" && workflow === childPreviewPrerequisiteRoot.descriptor.id ? childPreviewPrerequisiteRoot.descriptor
      : (parallel || delegatedPrerequisite) && workflow === childCrashWrite.descriptor.id ? childCrashWrite.descriptor
      : graph.modules.find(module => module.descriptor.id === workflow)?.descriptor);
  const run = execution.start(selectedRoot.descriptor, withReads ? { emplId: WRITE_FIXTURE_EID, text: "same", mode: "ok" } : { eid: WRITE_FIXTURE_EID }, { dryRun });
  return { ...h.authority, driver, execution, run };
}

it("retains an UNKNOWN child write as parked without retry, parent settlement or redispatch", async () => {
  const f = await fixture();
  f.driver.probeResults.push(absentProbeEvidence(f.clock.now().toISOString()));
  f.driver.commitThrows = new Error("synthetic commit failed after the actual write fence");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  const child = await f.execution.step(f.run, world.SIGNAL);
  assert.equal(child.outcome.state, "parked-write");
  const parked = f.database.authority.runs.get(child.run.envelope.runId);
  assert.ok(parked?.lifecycle.state === "parked-write");
  const intent = f.database.authority.writeIntents.get(parked.lifecycle.writeIntentId);
  assert.ok(intent);
  assert.equal(intent.status, "parked");
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.lifecycle.state, "queued");
  assert.equal(f.database.authority.runResults.get(parked.envelope.runId), undefined);
  assert.equal(f.database.authority.runResults.get(f.run.envelope.runId), undefined);
  assert.equal(f.driver.events.filter(event => event.startsWith("commit-click:")).length, 0);
  for (const target of [parked, f.database.authority.runs.get(f.run.envelope.runId)]) {
    assert.ok(target);
    for (const type of ["retry", "cancel"] as const) {
      const result = f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type, source: "dashboard",
        requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: { runId: target.envelope.runId, expectedVersion: target.version } });
      assert.equal(result.state, "rejected");
      assert.ok(result.state === "rejected");
      assert.equal(result.code, "invalid-state");
    }
  }
  const owner = testWorkerLifetime(f.database, f.run.envelope.workflow, 1), active = f.database.authority.runtimeConfig.get();
  assert.ok(active);
  const beforeClaim = f.database.getMeta().authorityGeneration;
  const next = f.execution.lifecycle.claimNext({ commandId: randomUUID(), workflow: f.run.envelope.workflow, workerId: owner.workerId,
    runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
      settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } });
  assert.deepEqual(next, { state: "refused", refusal: { reason: "none-eligible" } });
  assert.equal(f.database.getMeta().authorityGeneration, beforeClaim);
  assert.equal(f.database.authority.dependencies.listByParentRun(f.run.envelope.runId).length, 1);
  assert.equal(f.database.authority.runs.listChildren(f.run.envelope.runId).length, 1);
  assert.equal(f.database.authority.writeIntents.get(intent.writeIntentId)?.version, intent.version);
  assert.equal(f.driver.events.filter(event => event === "prepare").length, 1);
  const dependencies = f.database.authority.dependencies.listByParentRun(f.run.envelope.runId);
  const invocations = f.database.authority.lifecycleJournal.listDelegationInvocations(f.run.envelope.runId);
  // Worker custody is in memory: stopping a worker that holds no claim commits nothing, however often it runs.
  const generation = f.database.getMeta().authorityGeneration;
  stopSyntheticDatabaseWorkers({ database: f.database, path: f.path });
  stopSyntheticDatabaseWorkers({ database: f.database, path: f.path });
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  f.closeDatabase();
  const reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "child-write-reopen-test" }, f.clock);
  try {
    assert.equal(reopened.getMeta().authorityGeneration, generation);
    assert.deepEqual(reopened.authority.writeIntents.get(intent.writeIntentId), intent);
    assert.deepEqual(reopened.authority.dependencies.listByParentRun(f.run.envelope.runId), dependencies);
    assert.deepEqual(reopened.authority.lifecycleJournal.listDelegationInvocations(f.run.envelope.runId), invocations);
    assert.deepEqual(reopened.authority.runs.get(parked.envelope.runId), parked);
    const lifecycle = new RunRecordService({ database: reopened, clock: f.clock, ids: { uuid: randomUUID },
      resolveDescriptor: workflow => workflow === root.descriptor.id ? root.descriptor : workflow === writeFixtureDescriptor.id ? writeFixtureDescriptor : undefined,
      publishQueued: () => { throw new Error("reopen must not publish a replacement"); } });
    assert.deepEqual(lifecycle.claimNext({ commandId: randomUUID(), workflow: f.run.envelope.workflow, workerId: owner.workerId,
      runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
        settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } }),
    { state: "refused", refusal: { reason: "none-eligible" } });
    assert.equal(reopened.getMeta().authorityGeneration, generation);
    assert.equal(reopened.authority.runs.listChildren(f.run.envelope.runId).length, 1);
    assert.equal(reopened.authority.runResults.get(f.run.envelope.runId), undefined);
    assert.equal(reopened.authority.runResults.get(parked.envelope.runId), undefined);
  } finally { reopened.close(); }
});

it("preserves a completed parallel branch while its differently typed sibling parks UNKNOWN across cancellation, retry and reopen", async () => {
  const f = await fixture("parallel");
  f.driver.probeResults.push(absentProbeEvidence(f.clock.now().toISOString()));
  f.driver.commitThrows = new Error("synthetic parallel write failed after the actual write fence");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  assert.equal(f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId).length, 2);
  const steps = [await f.execution.step(f.run, world.SIGNAL), await f.execution.step(f.run, world.SIGNAL)];
  const completed = steps.find(step => step.outcome.state === "done");
  const unknown = steps.find(step => step.outcome.state === "parked-write");
  assert.ok(completed && unknown);
  const receipt = f.database.authority.runResults.get(completed.run.envelope.runId);
  assert.ok(receipt);
  const intent = f.database.authority.writeIntents.listByRun(unknown.run.envelope.runId)[0];
  assert.ok(intent?.status === "parked");
  const parent = f.database.authority.runs.get(f.run.envelope.runId);
  const parked = f.database.authority.runs.get(unknown.run.envelope.runId);
  assert.ok(parent && parked?.lifecycle.state === "parked-write");
  for (const [type, target] of [["cancel", parent], ["recover-run", parent], ["retry", parked]] as const) {
    const result = f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type, source: "dashboard", requestedBy: "local-operator",
      requestedAt: f.clock.now().toISOString(), target: { runId: target.envelope.runId, expectedVersion: target.version } });
    assert.ok(result.state === "rejected");
    assert.equal(result.code, type === "recover-run" ? "RUN_CONTINUATION_REFUSED" : "invalid-state");
  }
  assert.deepEqual(f.database.authority.writeIntents.get(intent.writeIntentId), intent);
  assert.deepEqual(f.database.authority.runResults.get(completed.run.envelope.runId), receipt);
  assert.equal(f.database.authority.runs.listChildren(f.run.envelope.runId).length, 2);
  assert.equal(f.database.authority.runResults.get(f.run.envelope.runId), undefined);
  assert.equal(f.database.authority.dependencies.readiness(f.run.envelope.runId, "join").state, "waiting");
  stopSyntheticDatabaseWorkers({ database: f.database, path: f.path });
  f.closeDatabase();
  const reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "parallel-unknown-reopen-proof" }, f.clock);
  try {
    assert.deepEqual(reopened.authority.writeIntents.get(intent.writeIntentId), intent);
    assert.deepEqual(reopened.authority.runResults.get(completed.run.envelope.runId), receipt);
    assert.equal(reopened.authority.runs.listChildren(f.run.envelope.runId).length, 2);
    assert.equal(reopened.authority.runResults.get(f.run.envelope.runId), undefined);
    assert.equal(reopened.authority.dependencies.readiness(f.run.envelope.runId, "join").state, "waiting");
    assert.equal(reopened.authority.dependencies.wait(f.run.envelope.runId, parallelChildWriteRecoveryRoot.descriptor)?.nodeId, "children");
    assert.equal(f.driver.events.filter(event => event === "prepare").length, 1);
  } finally { reopened.close(); }
});

for (const unrelatedExit of [false, true]) {
it(`authenticates task and transaction prerequisites through child resume with unrelated worker exit ${String(unrelatedExit)}`, async () => {
  const f = await fixture("prerequisites");
  if (unrelatedExit) {
    testAdmittedWorker(f.database, f.clock, { path: f.path, workflow: f.run.envelope.workflow,
      poolIndex: 1, browserSystems: workflowProjections(childPrerequisiteRoot.descriptor).systems });
    const other = testAdmittedWorker(f.database, f.clock, { path: f.path, workflow: f.run.envelope.workflow,
      poolIndex: 2, browserSystems: workflowProjections(childPrerequisiteRoot.descriptor).systems });
    const lock = f.profile.machine.lifetime; assert.ok(lock instanceof RuntimeLifetimeLock);
    reconcileExitedWorker({ machine: f.profile.machine, admission: f.profile.admission, database: f.database, clock: f.clock,
      lifecycle: f.execution.lifecycle, lock, workerId: other.workerId });
  }
  f.driver.probeResults.push(absentProbeEvidence(f.clock.now().toISOString()));
  const first = await f.execution.step(f.run, world.SIGNAL);
  const failure = first.outcome.state === "failed" ? f.database.authority.failures.get(first.outcome.failureId) : undefined;
  const code = ErrorCatalogCodeSchema.safeParse(failure?.code);
  const diagnosticPaths = new Set(["src/backend/runtime/execution/run-executor.ts","src/backend/runtime/execution/durable-child-executor.ts","src/backend/runs/lifecycle/run-record-service.ts","src/backend/runs/lifecycle/delegation-admission.ts","src/backend/storage/sqlite/authority-database.ts","src/workflow-kit/task.ts","src/workflow-kit/workflow.ts"]);
    const diagnosticTexts = failure?.debug === undefined ? [] : [failure.debug.stack, ...failure.debug.causes];
    const diagnosticFrames = diagnosticTexts.flatMap((value) => [...value.matchAll(/(?:^|[(/\s])((?:src)\/[A-Za-z0-9_./-]+\.ts):(\d+):(\d+)/gm)]
      .filter((match) => diagnosticPaths.has(match[1] ?? ""))
      .map((match) => ({ path: match[1], line: Number(match[2]), column: Number(match[3]) })));
    const diagnosticClasses = ["Error", "TypeError", "RangeError", "AssertionError", "ZodError", "AggregateError", "RunLifecycleRefusedError", "WorkerControlRefusal"].filter((name) => diagnosticTexts.some((value) => value.startsWith(name + ":")));
    assert.equal(first.outcome.state, "yielded-delegation", new Error(failure === undefined ? undefined : JSON.stringify({
    code: code.success ? code.data : "UNCLASSIFIED", codeSha256: sha256Hex(failure.code),
    failureSha256: sha256Hex(canonicalJsonStringify(failure)), frames: diagnosticFrames, classes: diagnosticClasses, causeCount: failure?.debug?.causes.length ?? 0})));
  const checkpoints = f.database.authority.runCheckpoints.listByItem(f.run.envelope.workflow, f.run.envelope.itemId);
  const observation = checkpoints.find(checkpoint => checkpoint.nodeId === "observe");
  const transaction = checkpoints.find(checkpoint => checkpoint.nodeId === "write");
  assert.ok(observation && transaction);
  assert.ok((observation.observationOrigins?.length ?? 0) > 0);
  assert.equal(observation.implFingerprint, taskImplFingerprint(plan1Contract));
  assert.equal(transaction.implFingerprint, taskImplFingerprint(WriteFixtureCommit));
  const retained = canonicalJsonStringify(checkpoints);
  assert.equal(f.database.authority.runs.listChildren(f.run.envelope.runId).length, 1);
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "done");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "done");
  assert.equal(canonicalJsonStringify(f.database.authority.runCheckpoints.listByItem(f.run.envelope.workflow, f.run.envelope.itemId)), retained);
  const result = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(result);
  assert.deepEqual(result.result.value, { eid: WRITE_FIXTURE_EID, disposition: "same/same", providerState: "same" });
  assert.equal(f.driver.events.filter(event => event.startsWith("commit-click:")).length, 1);
  const writes = f.database.authority.writeIntents.listByRun(f.run.envelope.runId);
  assert.equal(writes.length, 1); assert.equal(writes[0]?.status, "committed");
});
}
it("runs nested read-only delegated children with dryRun true and consumes their normal typed observations in a parent preview", async () => {
  const f = await fixture("read-preview", true);
  f.driver.probeResults.push(absentProbeEvidence(f.clock.now().toISOString()));
  assert.deepEqual(workflowDryRunSupport(plan1Leaf.descriptor), { state: "unsupported", reason: "no-transaction-node" });
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  const done = await f.execution.execute(f.run, world.SIGNAL);
  assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done");
  const child = f.database.authority.runs.listChildren(f.run.envelope.runId)[0]; assert.ok(child);
  const nested = f.database.authority.runs.listChildren(child.envelope.runId)[0]; assert.ok(nested);
  for (const run of [child, nested]) {
    assert.equal(run.envelope.dryRun, true);
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    const result = f.database.authority.runResults.get(run.envelope.runId); assert.ok(result);
    assert.equal(result.resultSchemaHash, deriveSchemaHash(Plan1Output, "output"));
    assert.deepEqual(Plan1Output.parse(result.result.value), { eid: WRITE_FIXTURE_EID, disposition: "same/same", providerState: "same" });
    assert.equal(RunDryRunPreviewResultSchema.safeParse(result.result.value).success, false);
    assert.ok(run.completion?.kind === "done");
    assert.equal(run.completion.resultDigest, result.resultDigest);
    const reads = result.dependencies.filter(dependency => dependency.state === "resolved");
    if (run.envelope.runId === nested.envelope.runId) assert.equal(reads.length, 2);
    for (const read of reads) {
      const address = read.checkpoint;
      const checkpoint = f.database.authority.runCheckpoints.get(address.workflowId, address.itemId, read.nodeId, address.attempt, address.claimGeneration);
      assert.ok(checkpoint);
      assert.equal(checkpoint.runId, run.envelope.runId);
      assert.equal(deriveCheckpointOutputDigest(checkpoint.output), read.outputDigest);
      assert.equal(deriveCheckpointProvenanceDigest(checkpoint.provenance), read.provenanceDigest);
    }
    assert.deepEqual(f.database.authority.writeIntents.listByRun(run.envelope.runId), []);
  }
  const parentResult = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(parentResult);
  const preview = RunDryRunPreviewResultSchema.parse(parentResult.result.value);
  assert.equal(preview.externalCommit, "none");
  assert.deepEqual(parentResult.dependencies.map(dependency => [dependency.nodeId, dependency.state]), [["observe", "resolved"], ["lookup", "child-resolved"]]);
  const observed = f.database.authority.runCheckpoints.listByItem(f.run.envelope.workflow, f.run.envelope.itemId).find(checkpoint => checkpoint.nodeId === "observe");
  assert.ok(observed);
  const read = { state: "resolved", nodeId: observed.nodeId, checkpoint: observed } as const;
  const delegated = readDelegationEvidence(f.database.authority, f.run.envelope.runId, "lookup");
  const { completion, ...retainedRun } = done.run; assert.equal(completion?.kind, "done");
  const running = { ...retainedRun, lifecycle: { state: "running", workerId: WRITE_FIXTURE_WORKER_ID,
    claimedAt: f.clock.now().toISOString(), heartbeatAt: f.clock.now().toISOString() } };
  const build = (evidence: unknown) => buildRunPreviewResult(childReadPreviewRoot.descriptor, running, preview.steps, evidence, f.clock);
  assert.deepEqual(build([read, delegated]).record.dependencies, parentResult.dependencies);
  assert.throws(() => build([read]), /missing=lookup/);
  assert.throws(() => build([read, { ...delegated, parentRunId: child.envelope.runId }]), /terminal-delegation-dependency-identity-mismatch/);

  assert.ok(preview.steps.some(step => step.nodeId === "write" && step.state === "transaction-preview"));
  assert.equal(f.driver.events.filter(event => event === "prepare").length, 1);
  assert.equal(f.driver.events.some(event => event.startsWith("commit-click:")), false);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(f.run.envelope.runId), []);
});

it("joins ordinary read and prepared write branches into a preview without deriving an ordinary parent result, across replay and reopen", async () => {
  const f = await fixture("parallel", true);
  f.driver.probeResults.push(absentProbeEvidence(f.clock.now().toISOString()));
  assert.deepEqual(workflowDryRunSupport(parallelChildWriteRecoveryRoot.descriptor), { state: "supported", firstDelegationNodeId: "write" });
  const requeue = f.execution.lifecycle.requeue.bind(f.execution.lifecycle);
  let releases = 0;
  f.execution.lifecycle.requeue = request => { releases++; return requeue(request); };
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  const manifests = f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId);
  assert.deepEqual(manifests.map(manifest => manifest.edgeId).sort(), ["read", "write"]);
  assert.equal(f.database.authority.lifecycleJournal.listDelegationInvocations(f.run.envelope.runId).length, 2);
  assert.equal(releases, 1);
  const done = await f.execution.execute(f.run, world.SIGNAL);
  assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done");
  const children = f.database.authority.runs.listChildren(f.run.envelope.runId);
  const read = children.find(child => child.envelope.workflow === plan1Leaf.descriptor.id);
  const write = children.find(child => child.envelope.workflow === childCrashWrite.descriptor.id);
  assert.ok(read && write);
  const refresh = authorizeWorkflowDelegationRefresh(plan1Leaf.descriptor,read); assert.ok(refresh);
  assert.equal(assertWorkflowDelegationRefreshAuthorization(refresh,read),plan1Leaf.descriptor);
  assert.throws(() => assertWorkflowDelegationRefreshAuthorization({},read), /delegation-refresh-factory-authorization-unavailable/);
  assert.throws(() => assertWorkflowDelegationRefreshAuthorization(refresh,RunRecordSchema.parse({ ...read, version: read.version + 1 })), /delegation-refresh-factory-authorization-unavailable/);
  assert.equal(authorizeWorkflowDelegationRefresh(parallelChildWriteRecoveryRoot.descriptor,done.run),undefined);
  const readResult = f.database.authority.runResults.get(read.envelope.runId);
  const writeResult = f.database.authority.runResults.get(write.envelope.runId);
  const parentResult = f.database.authority.runResults.get(f.run.envelope.runId);
  assert.ok(readResult && writeResult && parentResult);
  assert.deepEqual(Plan1Output.parse(readResult.result.value), { eid: WRITE_FIXTURE_EID, disposition: "parallel read/parallel read", providerState: "parallel read" });
  assert.equal(readResult.resultSchemaHash, deriveSchemaHash(Plan1Output, "output"));
  assert.equal(RunDryRunPreviewResultSchema.parse(writeResult.result.value).externalCommit, "none");
  const preview = RunDelegatedDryRunPreviewResultSchema.parse(parentResult.result.value);
  assert.deepEqual(preview.steps, [{ nodeId: "children", state: "exercised" }, { nodeId: "read", state: "exercised" }, { nodeId: "write", state: "delegation-preview" }]);
  assert.deepEqual(preview.coverage, { state: "full" });
  assert.equal(parentResult.operationLineage, undefined);
  assert.equal(writeResult.operationLineage, undefined);
  const evidence = ["read", "write"].map(nodeId => readDelegationEvidence(f.database.authority, f.run.envelope.runId, nodeId));
  for (const entry of evidence) assert.deepEqual(readDelegationInvocationEvidence(f.database.authority, entry.invocationCommandId), entry);
  assert.throws(() => readDelegationInvocationEvidence(f.database.authority, randomUUID()), /delegation-invocation-authority-unavailable/);
  const first = evidence[0], other = evidence[1]; assert.ok(first && other);
  const otherCommand = f.database.authority.lifecycleJournal.getCommand(other.invocationCommandId); assert.ok(otherCommand);
  assert.throws(() => readDelegationInvocationEvidence({ ...f.database.authority,
    lifecycleJournal: { ...f.database.authority.lifecycleJournal,
      getCommand: id => id === first.invocationCommandId ? otherCommand : f.database.authority.lifecycleJournal.getCommand(id) },
  }, first.invocationCommandId), /delegation-invocation-binding-mismatch/);
  const references = evidence.map(entry => ({ kind: "delegation" as const, nodeId: entry.nodeId, receipt: delegationDependencyRecord(entry) }));
  const parent = done.run;
  assert.deepEqual(readDelegationScopeEvidence(f.database.authority, parent, references), references.map(entry => ({ nodeId: entry.nodeId, delegation: entry.receipt })));
  assert.throws(() => readDelegationScopeEvidence(f.database.authority, read, references), /delegation-scope-outcome-mismatch/);
  assert.throws(() => readDelegationScopeEvidence(f.database.authority, parent,
    references.map(entry => ({ ...entry, nodeId: entry.nodeId === first.nodeId ? other.nodeId : first.nodeId }))), /delegation-scope-outcome-mismatch/);
  const { completion, ...retained } = done.run; assert.ok(completion?.kind === "done");
  const running = { ...retained, lifecycle: { state: "running", workerId: WRITE_FIXTURE_WORKER_ID,
    claimedAt: f.clock.now().toISOString(), heartbeatAt: f.clock.now().toISOString() } };
  const generation = f.database.getMeta().authorityGeneration;
  const rebuild = (input: unknown) => buildRunPreviewResult(parallelChildWriteRecoveryRoot.descriptor, running, preview.steps, input, f.clock);
  assert.deepEqual(rebuild(evidence).record, parentResult);
  assert.throws(() => buildRunResult(parallelChildWriteRecoveryRoot.descriptor, running, evidence, f.clock), /terminal-preview-is-not-workflow-output/);
  assert.throws(() => rebuild(evidence.slice(0, 1)), /missing=write/);
  assert.throws(() => rebuild(evidence.map(entry => ({ ...entry, parentRunId: read.envelope.runId }))), /terminal-delegation-dependency-identity-mismatch/);
  assert.throws(() => buildRunPreviewResult(parallelChildWriteRecoveryRoot.descriptor,
    { ...running, envelope: { ...running.envelope, dryRun: false } }, preview.steps, evidence, f.clock), /not a dry run/);
  const repositories = f.database.authority;
  const localPreview = RunDryRunPreviewResultSchema.parse(writeResult.result.value);
  const changedValue = { ...writeResult.result, value: { ...localPreview, steps: [{ nodeId: "forged-preparation", state: "exercised" }] } };
  const changedResult = RunResultRecordSchema.parse({ ...writeResult, result: changedValue, resultDigest: deriveRunResultDigest(changedValue) });
  assert.ok(write.completion?.kind === "done");
  const changedRun = { ...write, completion: { ...write.completion, resultDigest: changedResult.resultDigest } };
  assert.throws(() => readDelegationEvidence({ ...repositories,
    runs: { ...repositories.runs, get: id => id === write.envelope.runId ? changedRun : repositories.runs.get(id) },
    runResults: { ...repositories.runResults, get: id => id === write.envelope.runId ? changedResult : repositories.runResults.get(id),
      getInitialSettlement: id => id === write.envelope.runId ? { run: changedRun, result: changedResult } : repositories.runResults.getInitialSettlement(id) },
  }, f.run.envelope.runId, "write"), /delegation-settlement-authority-unavailable/);
  assert.throws(() => readDelegationEvidence({ ...repositories,
    runs: { ...repositories.runs, get: id => id === write.envelope.runId ? { ...write, envelope: { ...write.envelope, dryRun: false } } : repositories.runs.get(id) },
  }, f.run.envelope.runId, "write"), /delegation-child-binding-mismatch/);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  for (const run of [done.run, ...children]) {
    assert.equal(run.envelope.dryRun, true);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(run.envelope.runId), []);
    assert.deepEqual(f.database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId),
      { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  }
  for (const run of children) {
    assert.throws(() => f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard",
      requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: { runId: run.envelope.runId, expectedVersion: run.version } }),
    /delegation-retry-source-unavailable/);
  }
  assert.equal(f.driver.events.filter(event => event === "prepare").length, 1);
  assert.equal(f.driver.events.some(event => event.startsWith("commit-click:")), false);
  const date = f.clock.now().toISOString().slice(0, 10);
  assert.deepEqual(createTransactionHistory(f.database.authority).query({ from: date, to: date }).rows, []);
  stopSyntheticDatabaseWorkers({ database: f.database, path: f.path });
  const stoppedGeneration = f.database.getMeta().authorityGeneration;
  f.closeDatabase();
  const reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "mixed-preview-reopen-test" }, f.clock);
  try {
    assert.equal(reopened.getMeta().authorityGeneration, stoppedGeneration);
    assert.deepEqual(reopened.authority.runResults.get(f.run.envelope.runId), parentResult);
    assert.deepEqual(reopened.authority.runResults.get(read.envelope.runId), readResult);
    assert.deepEqual(reopened.authority.runResults.get(write.envelope.runId), writeResult);
    assert.deepEqual(["read", "write"].map(nodeId => readDelegationEvidence(reopened.authority, f.run.envelope.runId, nodeId)), evidence);
    assert.deepEqual(reopened.authority.delegationManifests.listByParentRun(f.run.envelope.runId), manifests);
    assert.equal(reopened.authority.runs.listChildren(f.run.envelope.runId).length, 2);
    assert.equal(reopened.getMeta().authorityGeneration, stoppedGeneration);
  } finally { reopened.close(); }
});

it("retains unavailable intermediary tasks after a child preview without requiring their nonexistent checkpoints", async () => {
  const f = await fixture("delegated-prerequisite", true);
  f.driver.probeResults.push(absentProbeEvidence(f.clock.now().toISOString()));
  const done = await f.execution.execute(f.run, world.SIGNAL);
  assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done");
  const result = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(result);
  assert.deepEqual(RunDelegatedDryRunPreviewResultSchema.parse(result.result.value).steps, [
    { nodeId: "child", state: "delegation-preview" },
    { nodeId: "observe", state: "unavailable", reason: "requires-unsubmitted-output" },
    { nodeId: "write", state: "unavailable", reason: "requires-unsubmitted-output" },
  ]);
  assert.deepEqual(result.dependencies.map(dependency => dependency.nodeId), ["child"]);
  assert.deepEqual(f.database.authority.runCheckpoints.listByItem(f.run.envelope.workflow, f.run.envelope.itemId), []);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(f.run.envelope.runId), []);
  assert.equal(f.driver.events.filter(event => event === "prepare").length, 1);
  assert.equal(f.driver.events.some(event => event.startsWith("commit-click:")), false);
});

for (const mode of ["empty-preview", "dispatch-preview"] as const) {
it(`accounts for ${mode} without claiming a prepared child`, async () => {
  const f = await fixture(mode, true);
  const done = await f.execution.step(f.run, world.SIGNAL);
  assert.equal(done.outcome.state, "done");
  const result = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(result);
  const preview = RunDelegatedDryRunPreviewResultSchema.parse(result.result.value);
  assert.deepEqual(preview.steps, [{ nodeId: "children", state: "exercised" }]);
  assert.deepEqual(preview.coverage, mode === "empty-preview" ? { state: "full" }
    : { state: "partial", boundaryNodeId: "children", reason: "descendant-not-awaited" });
  const evidence = readDelegationEvidence(f.database.authority, f.run.envelope.runId, "children");
  assert.deepEqual(evidence.children, []);
  assert.equal(evidence.manifest.children.length, mode === "empty-preview" ? 0 : 1);
  assert.equal(f.database.authority.runs.listChildren(f.run.envelope.runId).length, mode === "empty-preview" ? 0 : 1);
  assert.equal(f.driver.events.includes("prepare"), false);
  assert.equal(f.driver.events.some(event => event.startsWith("commit-click:")), false);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(f.run.envelope.runId), []);
});
}

it("authenticates a delegated preview through every waiting ancestor on one home worker", async () => {
  const f = await fixture("nested-preview", true);
  f.driver.probeResults.push(absentProbeEvidence(f.clock.now().toISOString()));
  const done = await f.execution.execute(f.run, world.SIGNAL);
  assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done");
  const [middle] = f.database.authority.runs.listChildren(f.run.envelope.runId); assert.ok(middle);
  const [leaf] = f.database.authority.runs.listChildren(middle.envelope.runId); assert.ok(leaf);
  for (const run of [done.run, middle, leaf]) {
    assert.equal(run.envelope.dryRun, true);
    assert.equal(run.envelope.attempt, 1);
    const retained = f.database.authority.runs.get(run.envelope.runId); assert.ok(retained?.completion?.kind === "done");
    const result = f.database.authority.runResults.get(run.envelope.runId); assert.ok(result);
    assert.equal(retained.completion.resultDigest, result.resultDigest);
    assert.deepEqual(f.database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId),
      { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
    const preview = run.envelope.runId === leaf.envelope.runId ? RunDryRunPreviewResultSchema.parse(result.result.value)
      : RunDelegatedDryRunPreviewResultSchema.parse(result.result.value);
    assert.equal(preview.externalCommit, "none");
    assert.equal(result.operationLineage, undefined);
  }
  assert.equal(f.driver.events.filter(event => event === "prepare").length, 1);
  assert.equal(f.driver.events.some(event => event.startsWith("commit-click:")), false);
});

it("still refuses a delegated child whose transaction explicitly does not support a dry run", async () => {
  const f = await fixture("unsupported-preview", true);
  assert.deepEqual(workflowDryRunSupport(childUnsupportedPreviewTarget.descriptor), { state: "unsupported", reason: "node-declares-unsupported", nodeId: "write" });
  const admit = f.execution.lifecycle.admitDelegation.bind(f.execution.lifecycle);
  let refused = false;
  f.execution.lifecycle.admitDelegation = (context, plans) => {
    try { return admit(context, plans); }
    catch (error) { assert.ok(error instanceof Error); assert.equal(error.message, "delegation-target-dry-run-unsupported"); refused = true; throw error; }
  };
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "failed");
  assert.equal(refused, true);
  assert.deepEqual(f.database.authority.runs.listChildren(f.run.envelope.runId), []);
  assert.equal(f.driver.events.includes("prepare"), false);
  assert.equal(f.driver.events.some(event => event.startsWith("commit-click:")), false);
});

for (const dryRun of [false, true]) {
it(`resumes an approved gate at its next node after a completed child with dryRun ${String(dryRun)}`, async () => {
  const f = await fixture("gate-resume", dryRun);
  f.driver.probeResults.push(absentProbeEvidence(f.clock.now().toISOString()));
  const parked = await f.execution.execute(f.run, world.SIGNAL);
  assert.ok(parked.run?.lifecycle.state === "parked-gate");
  assert.equal(parked.run.lifecycle.gateId, "review");
  assert.equal(parked.run.lifecycle.resumeAt, "write");
  const children = f.database.authority.runs.listChildren(f.run.envelope.runId);
  assert.equal(children.length, 1);
  const child = children[0]; assert.ok(child);
  assert.ok(child.lifecycle.state === "terminal" && child.lifecycle.outcome === "done");
  const childResult = f.database.authority.runResults.get(child.envelope.runId); assert.ok(childResult);
  const manifests = f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId);
  assert.equal(f.driver.events.includes("prepare"), false);
  const gate = descriptorRuntimeNodes(childGateResumeRoot.descriptor).find(node => node.id === "review");
  assert.ok(gate?.kind === "gate");
  const command = { commandId: randomUUID(), family: "gate", type: "resolve-gate", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: parked.run.envelope.runId, expectedVersion: parked.run.version, gateId: parked.run.lifecycle.gateId },
    payload: { result: { schemaHash: deriveSchemaHash(gate.result, "output"), value: { approved: true } } } } as const;
  const approved = f.execution.kernel.execute(command);
  assert.equal(approved.state, "applied", JSON.stringify(approved));
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.envelope.startAt, "write");
  const done = await f.execution.execute(f.run, world.SIGNAL);
  assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done",
    JSON.stringify(f.database.authority.failures.listByRun(f.run.envelope.runId).map(failure => ({ code: failure.code, summary: failure.summary, stack: failure.debug?.stack }))));
  assert.equal(done.run.envelope.runId, f.run.envelope.runId);
  assert.equal(done.run.envelope.attempt, f.run.envelope.attempt);
  assert.deepEqual(f.database.authority.runs.listChildren(f.run.envelope.runId), children);
  assert.deepEqual(f.database.authority.runResults.get(child.envelope.runId), childResult);
  assert.deepEqual(f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId), manifests);
  assert.equal(f.driver.events.filter(event => event === "prepare").length, 1);
  assert.equal(f.driver.events.filter(event => event.startsWith("commit-click:")).length, dryRun ? 0 : 1);
  assert.equal(f.database.authority.commandAudits.findByCommand(command.commandId)?.result.state, "applied");
  const result = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(result);
  if (dryRun) assert.equal(RunDryRunPreviewResultSchema.parse(result.result.value).externalCommit, "none");
  else assert.deepEqual(result.result.value, { transactionId: "T123456" });
});
}
