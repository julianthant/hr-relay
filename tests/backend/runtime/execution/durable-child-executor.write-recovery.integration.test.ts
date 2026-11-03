import { afterAll } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { stopSyntheticDatabaseWorkers } from "../../../support/helpers/synthetic-database-admission.js";
import { childWriteRecoveryRoot as root, childPrerequisiteRoot, childPrerequisiteModules, childCrashWrite, parallelChildWriteRecoveryRoot, childReadPreviewRoot, childUnsupportedPreviewRoot, childUnsupportedPreviewTarget, childGateResumeRoot } from "../../../support/fixtures/child-execution-write-workflow.js";
import assert from "node:assert/strict";
import { ErrorCatalogCodeSchema } from "../../../../src/models/failures/error-catalog.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { taskId } from "../../../../src/rules/identity/ids.js";
import { childExecutionBuildManifest } from "../../../support/fixtures/child-execution-build-manifest.js";
import { resolveTaskImplFingerprint } from "../../../../src/workflow-kit/validation/build-manifest.js";
import { admitWorkerReset } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { descriptorRuntimeNodes, workflowDryRunSupport, workflowProjections } from "../../../../src/workflow-kit/workflow.js";
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
  writeFixtureSessions, WRITE_FIXTURE_EID, WRITE_FIXTURE_IMPL_FINGERPRINT } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { AuthorityDatabase, createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";

import { RunDryRunPreviewResultSchema, deriveCheckpointOutputDigest, deriveCheckpointProvenanceDigest } from "../../../../src/models/run/result.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { Plan1Output, plan1Leaf } from "../../../support/fixtures/plan1-operation-workflows.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const world = createRunExecutorTestWorld(profiles.create);
afterEach(world.cleanup);

async function fixture(mode: "single" | "prerequisites" | "parallel" | "read-preview" | "unsupported-preview" | "gate-resume" = "single", dryRun = false) {
  const prerequisites = mode === "prerequisites", parallel = mode === "parallel", readPreview = mode === "read-preview", unsupportedPreview = mode === "unsupported-preview";
  const withReads = prerequisites || readPreview || unsupportedPreview || mode === "gate-resume";
  const driver = createWriteFixtureWorld(), graph = withReads || parallel ? childPrerequisiteModules(driver) : undefined;
  const selectedRoot = mode === "gate-resume" ? childGateResumeRoot : readPreview ? childReadPreviewRoot : unsupportedPreview ? childUnsupportedPreviewRoot
    : parallel ? parallelChildWriteRecoveryRoot : prerequisites ? childPrerequisiteRoot : root;
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
    operator: "local-operator", log: h.deps.log, resolveImplFingerprint: id => withReads || parallel ? resolveTaskImplFingerprint(childExecutionBuildManifest, id) : WRITE_FIXTURE_IMPL_FINGERPRINT });
  const execution = canonicalChildExecution({ ...h.deps, writeSequencer: sequencer,
    ...(withReads || parallel ? { buildManifest: childExecutionBuildManifest } : {}) }, database, path,
    workflow => graph === undefined ? workflow === root.descriptor.id ? root.descriptor : workflow === writeFixtureDescriptor.id ? writeFixtureDescriptor : undefined
      : workflow === selectedRoot.descriptor.id ? selectedRoot.descriptor : parallel && workflow === childCrashWrite.descriptor.id ? childCrashWrite.descriptor
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
    workerLifetime: owner.workerLifetime, runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
      settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } });
  assert.deepEqual(next, { state: "refused", refusal: { reason: "none-eligible" } });
  assert.equal(f.database.getMeta().authorityGeneration, beforeClaim);
  assert.equal(f.database.authority.dependencies.listByParentRun(f.run.envelope.runId).length, 1);
  assert.equal(f.database.authority.runs.listChildren(f.run.envelope.runId).length, 1);
  assert.equal(f.database.authority.writeIntents.get(intent.writeIntentId)?.version, intent.version);
  assert.equal(f.driver.events.filter(event => event === "prepare").length, 1);
  const dependencies = f.database.authority.dependencies.listByParentRun(f.run.envelope.runId);
  const invocations = f.database.authority.lifecycleJournal.listDelegationInvocations(f.run.envelope.runId);
  const beforeOwnedWorkerStop = f.database.getMeta().authorityGeneration;
  stopSyntheticDatabaseWorkers({ database: f.database, path: f.path });
  assert.ok(f.database.getMeta().authorityGeneration > beforeOwnedWorkerStop);
  const afterOwnedWorkerStop = f.database.getMeta().authorityGeneration;
  stopSyntheticDatabaseWorkers({ database: f.database, path: f.path });
  assert.equal(f.database.getMeta().authorityGeneration, afterOwnedWorkerStop);
  const generation = f.database.getMeta().authorityGeneration;
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
      workerLifetime: owner.workerLifetime, runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
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

for (const unrelatedReset of [false, true]) {
it(`authenticates task and transaction prerequisites through child resume with unrelated reset ${String(unrelatedReset)}`, async () => {
  const f = await fixture("prerequisites");
  let control: ReturnType<typeof admitWorkerReset> | undefined;
  if (unrelatedReset) {
    const home = testAdmittedWorker(f.database, f.clock, { path: f.path, workflow: f.run.envelope.workflow,
      poolIndex: 1, browserSystems: workflowProjections(childPrerequisiteRoot.descriptor).systems });
    const other = testAdmittedWorker(f.database, f.clock, { path: f.path, workflow: f.run.envelope.workflow,
      poolIndex: 2, browserSystems: workflowProjections(childPrerequisiteRoot.descriptor).systems });
    control = f.database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
      commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard",
      requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: {
        workerId: other.workerId, membershipRevision: other.member.membershipRevision,
        controlBasis: { leaseGeneration: other.lease.leaseGeneration, controlRevision: other.lease.controlRevision },
      },
    }, randomUUID(), f.clock.now().toISOString()));
    assert.ok(control.reset);
    assert.equal(f.database.authority.workerControls.resetForWorker(home.workerId), undefined);
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
  assert.equal(observation.implFingerprint, resolveTaskImplFingerprint(childExecutionBuildManifest, taskId("ocr/extract-form-page")));
  assert.equal(transaction.implFingerprint, resolveTaskImplFingerprint(childExecutionBuildManifest, taskId("ucpath/submit-write-fixture")));
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
  if (control !== undefined) {
    assert.ok(control.reset);
    assert.equal(f.database.authority.workerControls.get(control.commandId)?.phase.state, "admitted");
    f.database.authority.workerControls.transition(control.commandId, "admitted", { state: "executing", startedAt: f.clock.now().toISOString() });
    f.execution.lifecycle.settleResetWork(control.reset);
  }
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
  assert.ok(preview.steps.some(step => step.nodeId === "write" && step.state === "transaction-preview"));
  assert.equal(f.driver.events.filter(event => event === "prepare").length, 1);
  assert.equal(f.driver.events.some(event => event.startsWith("commit-click:")), false);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(f.run.envelope.runId), []);
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
