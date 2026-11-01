import { afterAll } from "vitest";
import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { stopSyntheticDatabaseWorkers } from "../../../support/helpers/synthetic-database-admission.js";
import { childWriteRecoveryRoot as root, childPrerequisiteRoot, childPrerequisiteModules } from "../../../support/fixtures/child-execution-write-workflow.js";
import assert from "node:assert/strict";
import { ErrorCatalogCodeSchema } from "../../../../src/models/failures/error-catalog.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { taskId } from "../../../../src/rules/identity/ids.js";
import { childExecutionBuildManifest } from "../../../support/fixtures/child-execution-build-manifest.js";
import { resolveTaskImplFingerprint } from "../../../../src/workflow-kit/validation/build-manifest.js";
import { admitWorkerReset } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { workflowProjections } from "../../../../src/workflow-kit/workflow.js";
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

const profiles = createClonedProfileFixtures();
afterAll(() => profiles.close());
const world = createRunExecutorTestWorld(profiles.create);
afterEach(world.cleanup);

async function fixture(prerequisites = false) {
  const driver = createWriteFixtureWorld(), graph = prerequisites ? childPrerequisiteModules(driver) : undefined;
  const selectedRoot = prerequisites ? childPrerequisiteRoot : root;
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
    operator: "local-operator", log: h.deps.log, resolveImplFingerprint: id => prerequisites ? resolveTaskImplFingerprint(childExecutionBuildManifest, id) : WRITE_FIXTURE_IMPL_FINGERPRINT });
  const execution = canonicalChildExecution({ ...h.deps, writeSequencer: sequencer,
    ...(prerequisites ? { buildManifest: childExecutionBuildManifest } : {}) }, database, path,
    workflow => graph === undefined ? workflow === root.descriptor.id ? root.descriptor : workflow === writeFixtureDescriptor.id ? writeFixtureDescriptor : undefined
      : graph.modules.find(module => module.descriptor.id === workflow)?.descriptor);
  const run = execution.start(selectedRoot.descriptor, prerequisites ? { emplId: WRITE_FIXTURE_EID, text: "same", mode: "ok" } : { eid: WRITE_FIXTURE_EID }, { dryRun: false });
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

for (const unrelatedReset of [false, true]) {
it(`authenticates task and transaction prerequisites through child resume with unrelated reset ${String(unrelatedReset)}`, async () => {
  const f = await fixture(true);
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
