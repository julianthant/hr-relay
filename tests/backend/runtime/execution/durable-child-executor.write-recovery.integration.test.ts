import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { testRunLifecycle, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, createWriteFixtureWorld, writeFixtureDescriptor,
  writeFixtureSessions, WRITE_FIXTURE_EID, WRITE_FIXTURE_IMPL_FINGERPRINT } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { fixtureBuildManifest } from "../../../support/fixtures/workflow-definition-fixtures.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { AuthorityDatabase, createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);
const input = z.strictObject({ eid: EidSchema });
const output = z.strictObject({ transactionId: z.string().min(1) });
const id = "fixture-child-write-recovery";
const root = compileWorkflow(defineWorkflow({ id, version: 1, code: "fcw", label: "Synthetic child write recovery", icon: "ShieldCheck",
  category: "operations", input, canonicalInput: defineCanonicalInput(input, input, [{ eid: WRITE_FIXTURE_EID }]),
  inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], identity: { matchKey: value => `eid:${value.eid}` }, presentation: { title: () => "Synthetic child write recovery" },
  scenarios: ["write-fixture/happy"], role: defineWorkflowRole({ kind: "standalone" }), steps: ({ delegate, result }) => {
    const child = delegate({ id: "write", target: { id: writeFixtureDescriptor.id, input, result: output }, edgeId: "write",
      cardinality: "one", await: "terminal", join: "one", policy: { cascadeCancel: "cascade", onChildFailed: "fail-parent",
        afterChildRetry: "resume-parent", visibility: "inline" } }, [],
    { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    return { steps: [[{ key: "write", label: "Write child" }, [child]]], result: result(output, [child], ({ outputs }) => {
      if (outputs.write.state !== "done") throw new Error("write-child-not-done");
      return outputs.write.output;
    }, [{ path: "transactionId", source: { kind: "child-output", entryId: "write", path: "transactionId" } }]) };
  } }), { manifest: fixtureBuildManifest([id]) });

function fixture() {
  const driver = createWriteFixtureWorld(), stores = buildWriteFixtureRegistry(driver);
  const h = world.executorHarness({ descriptor: root.descriptor, stores, sessions: writeFixtureSessions(driver) });
  const { database, clock, stateRoot, path } = h.authority;
  const patch = { "actor.label": { set: "Synthetic operator" } } as const;
  assert.equal(executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor(settings => resolveConfigWithProvenance(settings, hostConfigFacts({}), clock),
      createCredentialStore({ stateRoot })) }, { commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface",
    requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }).state, "applied");
  const sequencer = createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores, authority: database,
    sessions: h.manager, emitter: h.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: h.scheduler, taskDeadlineMs: 60_000,
    operator: "local-operator", log: h.deps.log, resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT });
  const execution = canonicalChildExecution({ ...h.deps, writeSequencer: sequencer }, database, path,
    workflow => workflow === root.descriptor.id ? root.descriptor : workflow === writeFixtureDescriptor.id ? writeFixtureDescriptor : undefined);
  const run = execution.start(root.descriptor, { eid: WRITE_FIXTURE_EID }, { dryRun: false });
  return { ...h.authority, driver, execution, run };
}

it("retains an UNKNOWN child write as parked without retry, parent settlement or redispatch", async () => {
  const f = fixture();
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
  const generation = f.database.getMeta().authorityGeneration;
  f.database.close();
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
