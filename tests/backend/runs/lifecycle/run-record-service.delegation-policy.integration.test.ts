import { withBoundRunConfigFingerprint } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { descriptorRuntimeNodes, workflowProjections } from "../../../../src/workflow-kit/workflow.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import assert from "node:assert/strict";
import { ErrorCatalogCodeSchema } from "../../../../src/models/failures/error-catalog.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { workerRunLifecyclePort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { delegatedCandidateEligible } from "../../../../src/backend/runs/lifecycle/run-claim-admission.js";
import { authenticateDescendantHome } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { createDurableChildRunExecutor } from "../../../../src/backend/runtime/execution/durable-child-executor.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { admitWorkerReset } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { terminalEvidenceResult } from "../../../../src/models/run/result.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { childPolicyModules, childUnawaitedIndependentModules } from "../../../support/fixtures/child-execution-workflows.js";
import { plan1Stores, plan1Contract } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testAdmittedWorker, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

function terminal(run: RunRecord, outcome: "cancelled" | "done"): void {
  assert.ok(run.lifecycle.state === "terminal");
  assert.equal(run.lifecycle.outcome, outcome);
}

function fixture(policy: "cascade" | "independent", unawaited = false) {
  const { root: compiled, modules } = unawaited ? childUnawaitedIndependentModules() : childPolicyModules(policy);
  assert.equal(plan1Contract.effect, "read");
  for (const module of modules) {
    assert.ok(descriptorRuntimeNodes(module.descriptor).every(node => node.kind !== "transaction"));
    assert.deepEqual(workflowProjections(module.descriptor).systems, []);
  }
  const h = world.executorHarness({ descriptor: compiled.descriptor, stores: plan1Stores });
  const { database, clock, path, stateRoot } = h.authority;
  const patch = { "actor.label": { set: "Synthetic operator" } } as const;
  assert.equal(executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor(settings => resolveConfigWithProvenance(settings, hostConfigFacts({}), clock),
      createCredentialStore({ stateRoot })) }, {
    commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface",
    requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
  }).state, "applied");
  const execution = canonicalChildExecution(h.deps, database, path, id => modules.find(module => module.descriptor.id === id)?.descriptor);
  const root = execution.start(compiled.descriptor, { emplId: "10800000", text: "same", mode: "ok" }, { dryRun: false });
  const currentRoot = () => { const run = database.authority.runs.get(root.envelope.runId); assert.ok(run); return run; };
  const child = () => { const children = database.authority.runs.listChildren(root.envelope.runId); assert.equal(children.length, 1); assert.ok(children[0]); return children[0]; };
  const cancel = () => CommandRequestSchema.parse({ commandId: randomUUID(), family: "run", type: "cancel", source: "dashboard",
    requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { runId: root.envelope.runId, expectedVersion: currentRoot().version } });
  return { ...h.authority, deps: h.deps, execution, root, currentRoot, child, cancel, modules };
}

it("authenticates a genuine delegated child at claim and execution boundaries and refuses absent root session or manifests", async () => {
  const f = fixture("cascade");
  assert.equal((await f.execution.step(f.root, world.SIGNAL)).outcome.state, "yielded-delegation");
  const root = f.currentRoot(), child = f.child();
  assert.ok(root.sessionId);
  const resolve = (workflow: string) => f.modules.find(module => module.descriptor.id === workflow)?.descriptor;
  const generation = f.database.getMeta().authorityGeneration;
  f.database.withAuthorityTransaction(repositories => {
    assert.equal(delegatedCandidateEligible(repositories, child, root.envelope.workflow, resolve), true);
    assert.equal(authenticateDescendantHome(repositories, child, root.envelope.workflow), true);
    const { sessionId: _sessionId, ...withoutSession } = root;
    const missingSession = { ...repositories, runs: { ...repositories.runs,
      get: (runId: string) => runId === root.envelope.runId ? withoutSession : repositories.runs.get(runId) } };
    assert.throws(() => delegatedCandidateEligible(missingSession, child, root.envelope.workflow, resolve),
      /delegation-root-start-authority-unavailable/u);
    assert.throws(() => authenticateDescendantHome(missingSession, child, root.envelope.workflow),
      /delegation-root-start-authority-unavailable/u);
    const missingManifest = { ...repositories, delegationManifests: { ...repositories.delegationManifests,
      listByParentRun: () => [] } };
    assert.throws(() => delegatedCandidateEligible(missingManifest, child, root.envelope.workflow, resolve),
      /delegation-group-incomplete/u);
    assert.throws(() => authenticateDescendantHome(missingManifest, child, root.envelope.workflow),
      /delegation-group-incomplete/u);
    const missingBoth = { ...missingSession, delegationManifests: missingManifest.delegationManifests };
    assert.throws(() => delegatedCandidateEligible(missingBoth, child, root.envelope.workflow, resolve),
      /delegation-root-start-authority-unavailable/u);
    assert.throws(() => authenticateDescendantHome(missingBoth, child, root.envelope.workflow),
      /delegation-root-start-authority-unavailable/u);
  });
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  const completed = await f.execution.step(f.root, world.SIGNAL);
  assert.equal(completed.run.envelope.runId, child.envelope.runId);
  assert.equal(completed.outcome.state, "done");
});

async function executeAfterCompletedChild(f: ReturnType<typeof fixture>, after: () => void) {
  assert.equal((await f.execution.step(f.root, world.SIGNAL)).outcome.state, "yielded-delegation");
  assert.equal((await f.execution.step(f.root, world.SIGNAL)).outcome.state, "done");
  const owner = testWorkerLifetime(f.database, f.root.envelope.workflow, 1), runtime = f.database.authority.runtimeConfig.get();
  assert.ok(runtime);
  await f.deps.sessions.closeAll("parked");
  const claimed = f.execution.lifecycle.claimNext({ commandId: randomUUID(), workflow: f.root.envelope.workflow,
    workerId: owner.workerId, workerLifetime: owner.workerLifetime, runtimeConfig: { generation: runtime.generation,
      settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
  assert.ok(claimed.state === "applied" || claimed.state === "applied-already");
  assert.ok("run" in claimed);
  assert.equal(claimed.run.envelope.runId, f.root.envelope.runId);
  return executeClaimedParent(f, claimed.run, after);
}

async function executeClaimedParent(f: ReturnType<typeof fixture>, claimed: RunRecord, after: () => void) {
  const owner = testWorkerLifetime(f.database, f.root.envelope.workflow, 1);
  const descriptor = f.modules.find(module => module.descriptor.id === f.root.envelope.workflow)?.descriptor;
  assert.ok(descriptor);
  f.deps.sessions.configureExecution(descriptor.id, plan1Stores);
  const actual = createDurableChildRunExecutor({ authority: f.database,
    admission: { admitAndRelease: (context, plan) => f.execution.lifecycle.admitDelegation(context, plan) },
    resolveTarget: id => { const module = f.modules.find(module => module.descriptor.id === id); assert.ok(module); return module.descriptor; } });
  let observed = 0;
  const outcome = await withBoundRunConfigFingerprint(f.deps.sessions, FingerprintSchema.parse(claimed.envelope.configFingerprint),
    () => executeClaimedRun({ ...f.deps, descriptor, lifecycle: workerRunLifecyclePort(f.execution.lifecycle),
      childRuns: { async executeChildRun(context) {
        const value = await actual.executeChildRun(context);
        observed++;
        after();
        return value;
      } } }, { run: claimed, claim: { workerId: owner.workerId, claimGeneration: claimed.claimGeneration }, signal: world.SIGNAL }),
    claimed.envelope.browserMode, { runId: claimed.envelope.runId,
      descriptorFingerprint: claimed.envelope.contractFingerprint,
      ...(claimed.envelope.captureBrowserScreenshots === undefined ? {} : { captureBrowserScreenshots: claimed.envelope.captureBrowserScreenshots }) });
  assert.equal(observed, 1);
  return outcome;
}

it("freshly claims an independent queued child after its other physical parent's reset", async () => {
  const f = fixture("independent", true);
  const parentOwner = testAdmittedWorker(f.database, f.clock, { path: f.path, workflow: f.root.envelope.workflow,
    poolIndex: 1, browserSystems: [] });
  const childOwner = testAdmittedWorker(f.database, f.clock, { path: f.path, workflow: f.root.envelope.workflow,
    poolIndex: 2, browserSystems: [] });
  await f.deps.sessions.closeAll("parked"); f.deps.sessions.releaseRunConfigFingerprint();
  const runtime = f.database.authority.runtimeConfig.get(); assert.ok(runtime);
  const runtimeConfig = { generation: runtime.generation, settingsRevision: runtime.settingsRevision,
    settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint };
  const parent = f.execution.lifecycle.claimNext({ commandId: randomUUID(), workflow: f.root.envelope.workflow,
    workerId: parentOwner.workerId, workerLifetime: parentOwner.workerLifetime, runtimeConfig });
  assert.ok(parent.state === "applied" && "run" in parent);
  let childClaim: { run: RunRecord; claim: { workerId: string; claimGeneration: number } } | undefined;
  let reset: ReturnType<typeof admitWorkerReset> | undefined;
  const outcome = await executeClaimedParent(f, parent.run, () => {
    const owner = testWorkerLifetime(f.database, f.root.envelope.workflow, 1);
    reset = f.database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
      commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard",
      requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: {
        workerId: owner.workerId, membershipRevision: owner.member.membershipRevision,
        controlBasis: { leaseGeneration: owner.lease.leaseGeneration, controlRevision: owner.lease.controlRevision },
      },
    }, randomUUID(), f.clock.now().toISOString()));
    const claimed = f.execution.lifecycle.claimNext({ commandId: randomUUID(), workflow: f.root.envelope.workflow,
      workerId: childOwner.workerId, workerLifetime: childOwner.workerLifetime, runtimeConfig });
    assert.ok(claimed.state === "applied" && "run" in claimed);
    assert.equal(claimed.run.envelope.parent?.runId, f.root.envelope.runId);
    childClaim = { run: claimed.run, claim: { workerId: childOwner.workerId, claimGeneration: claimed.run.claimGeneration } };
    assert.equal(f.database.authority.workerControls.resetForRun(f.root.envelope.runId)?.commandId, reset.commandId);
    assert.equal(f.database.authority.workerControls.resetForWorker(childOwner.workerId), undefined);
    assert.equal(f.database.authority.workerControls.resetForRun(childClaim.run.envelope.runId), undefined);
    f.execution.lifecycle.assertCurrentExecution({ runId: childClaim.run.envelope.runId, claim: childClaim.claim });
    const generation = f.database.getMeta().authorityGeneration;
    assert.equal(f.execution.lifecycle.renewClaim({ commandId: randomUUID(), runId: childClaim.run.envelope.runId,
      claim: childClaim.claim }).state, "applied");
    assert.equal(f.database.getMeta().authorityGeneration, generation + 1);
    assert.equal(f.database.authority.runResults.get(childClaim.run.envelope.runId), undefined);
  });
  const failure = outcome.state === "failed" ? f.database.authority.failures.get(outcome.failureId) : undefined;
  const code = ErrorCatalogCodeSchema.safeParse(failure?.code);
  assert.deepEqual(outcome, { state: "abandoned", runId: f.root.envelope.runId, reason: "run lifecycle lost" },
    new Error(failure === undefined ? undefined : JSON.stringify({ code: code.success ? code.data : "UNCLASSIFIED", codeSha256: sha256Hex(failure.code) })));
  assert.ok(reset && childClaim);
  f.database.authority.workerControls.transition(reset.commandId, "admitted", { state: "executing", startedAt: f.clock.now().toISOString() });
  f.execution.lifecycle.settleResetWork(reset.reset);
  terminal(f.currentRoot(), "cancelled");
  f.execution.lifecycle.assertCurrentExecution({ runId: childClaim.run.envelope.runId, claim: childClaim.claim });
  const current = f.child();
  const cancelled = f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "cancel", source: "dashboard",
    requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: { runId: current.envelope.runId, expectedVersion: current.version } });
  assert.equal(cancelled.state, "applied");
  const requested = f.child();
  assert.equal(requested.cancelRequested, true);
  const childModule = f.modules.find(({ descriptor }) => descriptor.id === requested.envelope.workflow);
  assert.ok(childModule);
  assert.equal(f.execution.lifecycle.terminalize({ kind: "cancelled", commandId: randomUUID(), runId: requested.envelope.runId,
    expectedVersion: requested.version, claim: childClaim.claim, endedAt: f.clock.now().toISOString() }, childModule.descriptor).state, "applied");
  terminal(f.child(), "cancelled");
  assert.equal(f.database.authority.runs.listChildren(f.root.envelope.runId).length, 1);
  assert.equal(f.database.authority.writeIntents.listByRun(f.root.envelope.runId).length, 0);
});

for (const policy of ["cascade", "independent"] as const) {
  it(`fences the actual parent after child await on a physical reset with ${policy} policy`, async () => {
    const f = fixture(policy);
    let retained: RunRecord | undefined;
    let reset: ReturnType<typeof admitWorkerReset> | undefined;
    let childResult: ReturnType<typeof f.database.authority.runResults.get>;
    const outcome = await executeAfterCompletedChild(f, () => {
      retained = f.currentRoot();
      childResult = f.database.authority.runResults.get(f.child().envelope.runId);
      assert.ok(childResult);
      const owner = testWorkerLifetime(f.database, f.root.envelope.workflow, 1);
      reset = f.database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
        commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard",
        requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: {
          workerId: owner.workerId, membershipRevision: owner.member.membershipRevision,
          controlBasis: { leaseGeneration: owner.lease.leaseGeneration, controlRevision: owner.lease.controlRevision },
        },
      }, randomUUID(), f.clock.now().toISOString()));
    });
    assert.deepEqual(outcome, { state: "abandoned", runId: f.root.envelope.runId, reason: "run lifecycle lost" });
    assert.ok(retained && reset?.reset);
    assert.deepEqual(f.currentRoot(), retained);
    assert.equal(f.database.authority.runResults.get(f.root.envelope.runId), undefined);
    assert.deepEqual(f.database.authority.runResults.get(f.child().envelope.runId), childResult);
    assert.equal(f.database.authority.runs.listChildren(f.root.envelope.runId).length, 1);
    assert.equal(f.database.authority.writeIntents.listByRun(f.root.envelope.runId).length, 0);
    const resetWorkerId = reset.reset.member.workerId;
    assert.throws(() => f.database.assertWorkerLifecycleRelease(resetWorkerId), /worker-lifecycle-release-unproved/u);
    assert.equal(f.database.authority.workerControls.resetForWorker(reset.reset.member.workerId)?.commandId, reset.commandId);
    f.database.authority.workerControls.transition(reset.commandId, "admitted", { state: "executing", startedAt: f.clock.now().toISOString() });
    f.execution.lifecycle.settleResetWork(reset.reset);
    terminal(f.currentRoot(), "cancelled");
    assert.deepEqual(f.database.authority.runResults.get(f.child().envelope.runId), childResult);
  });
}

it("admits delegation and fresh child work on its actual home while another member reset is pending", async () => {
  const f = fixture("cascade");
  const home = testAdmittedWorker(f.database, f.clock, { path: f.path, workflow: f.root.envelope.workflow,
    poolIndex: 1, browserSystems: [] });
  const unrelated = testAdmittedWorker(f.database, f.clock, { path: f.path, workflow: f.root.envelope.workflow,
    poolIndex: 2, browserSystems: [] });
  const control = f.database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
    commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard",
    requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: {
      workerId: unrelated.workerId, membershipRevision: unrelated.member.membershipRevision,
      controlBasis: { leaseGeneration: unrelated.lease.leaseGeneration, controlRevision: unrelated.lease.controlRevision },
    },
  }, randomUUID(), f.clock.now().toISOString()));
  assert.ok(control.reset);
  assert.equal(f.database.authority.workerControls.resetForWorker(home.workerId), undefined);
  assert.equal((await f.execution.step(f.root, world.SIGNAL)).outcome.state, "yielded-delegation");
  const child = f.child();
  assert.equal(child.lifecycle.state, "queued");
  assert.equal(f.database.authority.workerControls.get(control.commandId)?.phase.state, "admitted");
  const executed = await f.execution.step(f.root, world.SIGNAL);
  assert.equal(executed.run.envelope.runId, child.envelope.runId);
  assert.equal(executed.claim.workerId, home.workerId);
  assert.equal(executed.outcome.state, "done");
  assert.equal((await f.execution.step(f.root, world.SIGNAL)).outcome.state, "done");
  assert.ok(f.database.authority.runResults.get(child.envelope.runId));
  assert.equal(f.database.authority.workerControls.get(control.commandId)?.phase.state, "admitted");
  assert.equal(f.database.authority.workerControls.resetForWorker(home.workerId), undefined);
  f.database.authority.workerControls.transition(control.commandId, "admitted", { state: "executing", startedAt: f.clock.now().toISOString() });
  f.execution.lifecycle.settleResetWork(control.reset);
});

it("refuses the real child return after its registered profile session epoch advances", async () => {
  const f = fixture("independent");
  const registry = createProfileRegistry(f.profile.machine);
  const initial = registry.read();
  let retained: RunRecord | undefined;
  let childResult: ReturnType<typeof f.database.authority.runResults.get>;
  let observed = 0;
  await assert.rejects(executeAfterCompletedChild(f, () => {
    retained = f.currentRoot();
    childResult = f.database.authority.runResults.get(f.child().envelope.runId);
    assert.ok(childResult);
    observed++;
    assert.equal(registry.advanceSession(null), initial.sessionGeneration + 1);
  }), /profile-storage-claim-generation-changed/u);
  assert.equal(observed, 1);
  assert.ok(retained);
  assert.equal(registry.read().activeProfileId, null);
  assert.equal(registry.read().sessionGeneration, initial.sessionGeneration + 1);
  assert.deepEqual(f.currentRoot(), retained);
  assert.equal(f.database.authority.runResults.get(f.root.envelope.runId), undefined);
  assert.deepEqual(f.database.authority.runResults.get(f.child().envelope.runId), childResult);
  assert.equal(f.database.authority.runs.listChildren(f.root.envelope.runId).length, 1);
  assert.equal(f.database.authority.writeIntents.listByRun(f.root.envelope.runId).length, 0);
  const owner = testWorkerLifetime(f.database, f.root.envelope.workflow, 1);
  const retainedRun = retained;
  assert.throws(() => f.execution.lifecycle.assertCurrentExecution({ runId: retainedRun.envelope.runId,
    claim: { workerId: owner.workerId, claimGeneration: retainedRun.claimGeneration } }), /profile-storage-claim-generation-changed/u);
  assert.throws(() => f.database.assertWorkerLifecycleRelease(owner.workerId), /worker-lifecycle-release-unproved/u);
  const reset = f.database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
    commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard",
    requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: {
      workerId: owner.workerId, membershipRevision: owner.member.membershipRevision,
      controlBasis: { leaseGeneration: owner.lease.leaseGeneration, controlRevision: owner.lease.controlRevision },
    },
  }, randomUUID(), f.clock.now().toISOString()));
  f.database.authority.workerControls.transition(reset.commandId, "admitted", { state: "executing", startedAt: f.clock.now().toISOString() });
  f.execution.lifecycle.settleResetWork(reset.reset);
  terminal(f.currentRoot(), "cancelled");
  assert.deepEqual(f.database.authority.runResults.get(f.child().envelope.runId), childResult);
  assert.equal(registry.read().activeProfileId, null);
});

for (const policy of ["cascade", "independent"] as const) {
  it(`authenticates actual operator cancellation with the authored ${policy} child policy`, async () => {
    const f = fixture(policy);
    assert.equal((await f.execution.step(f.root, world.SIGNAL)).outcome.state, "yielded-delegation");
    const originalChild = f.child(), source = f.cancel();
    assert.equal(originalChild.lifecycle.state, "queued");
    const owner = testWorkerLifetime(f.database, f.root.envelope.workflow, 1);
    const applied = f.execution.kernel.execute(source);
    assert.equal(applied.state, "applied");
    assert.equal(f.execution.kernel.execute(source).state, "already-applied");
    assert.equal(f.currentRoot().lifecycle.state, "terminal");
    terminal(f.currentRoot(), "cancelled");
    if (policy === "cascade") {
      const child = f.child();
      assert.ok(child.lifecycle.state === "terminal" && child.lifecycle.outcome === "cancelled");
      assert.equal(f.database.authority.runResults.get(child.envelope.runId)?.runId, child.envelope.runId);
      assert.ok(applied.state === "applied");
      assert.equal(applied.affectedTargets.length, 2);
    } else {
      assert.equal(f.child().lifecycle.state, "queued");
      const continued = await f.execution.step(f.root, world.SIGNAL);
      assert.equal(continued.run.envelope.runId, originalChild.envelope.runId);
      assert.equal(continued.claim.workerId, owner.workerId);
      assert.equal(continued.outcome.state, "done");
      terminal(f.child(), "done");
      terminal(f.currentRoot(), "cancelled");
      assert.ok(applied.state === "applied");
      assert.equal(applied.affectedTargets.length, 1);
    }
  });
}

it("refuses a retained pending cancellation source without the actual canonical dispatch scope", async () => {
  const f = fixture("cascade");
  assert.equal((await f.execution.step(f.root, world.SIGNAL)).outcome.state, "yielded-delegation");
  const child = f.child(), request = f.cancel();
  f.database.withAuthorityTransaction(repositories => { repositories.commands.insert(request); });
  const generation = f.database.getMeta().authorityGeneration;
  assert.throws(() => f.execution.lifecycle.transition({
    commandId: lifecycleCommandId("operator-cancel", { commandId: request.commandId, runId: child.envelope.runId }),
    runId: child.envelope.runId, expectedVersion: child.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.clock.now().toISOString() },
    cancellationSource: { commandId: request.commandId, rootRunId: f.root.envelope.runId },
  }), /canonical-run-command-scope-unavailable/u);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.equal(f.child().version, child.version);
  assert.equal(f.database.authority.commandAudits.findByCommand(request.commandId), undefined);
  assert.equal(f.database.authority.runResults.get(child.envelope.runId), undefined);
});

it("refuses a real awaited child outcome after canonical cancellation revokes the original parent claim", async () => {
  const f = fixture("cascade");
  assert.equal((await f.execution.step(f.root, world.SIGNAL)).outcome.state, "yielded-delegation");
  const completed = await f.execution.step(f.root, world.SIGNAL);
  assert.equal(completed.outcome.state, "done");
  const childResult = f.database.authority.runResults.get(f.child().envelope.runId);
  assert.ok(childResult);
  const owner = testWorkerLifetime(f.database, f.root.envelope.workflow, 1), runtime = f.database.authority.runtimeConfig.get();
  assert.ok(runtime);
  await f.deps.sessions.closeAll("parked");
  const claimed = f.execution.lifecycle.claimNext({ commandId: randomUUID(), workflow: f.root.envelope.workflow,
    workerId: owner.workerId, workerLifetime: owner.workerLifetime, runtimeConfig: { generation: runtime.generation,
      settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
  assert.ok(claimed.state === "applied" || claimed.state === "applied-already");
  assert.ok("run" in claimed);
  assert.equal(claimed.run.envelope.runId, f.root.envelope.runId);
  const descriptor = f.modules.find(module => module.descriptor.id === f.root.envelope.workflow)?.descriptor;
  assert.ok(descriptor);
  f.deps.sessions.configureExecution(descriptor.id, plan1Stores);
  const actual = createDurableChildRunExecutor({ authority: f.database,
    admission: { admitAndRelease: (context, plan) => f.execution.lifecycle.admitDelegation(context, plan) },
    resolveTarget: id => { const module = f.modules.find(module => module.descriptor.id === id); assert.ok(module); return module.descriptor; } });
  let observed = 0;
  const outcome = await withBoundRunConfigFingerprint(f.deps.sessions, FingerprintSchema.parse(claimed.run.envelope.configFingerprint),
    () => executeClaimedRun({ ...f.deps, descriptor, lifecycle: workerRunLifecyclePort(f.execution.lifecycle),
    childRuns: { async executeChildRun(context) {
      const value = await actual.executeChildRun(context);
      observed++;
      assert.equal(f.execution.kernel.execute(f.cancel()).state, "applied");
      return value;
    } } }, { run: claimed.run, claim: { workerId: owner.workerId, claimGeneration: claimed.run.claimGeneration }, signal: world.SIGNAL }), claimed.run.envelope.browserMode, {
      runId: claimed.run.envelope.runId, descriptorFingerprint: claimed.run.envelope.contractFingerprint,
      ...(claimed.run.envelope.captureBrowserScreenshots === undefined ? {} : { captureBrowserScreenshots: claimed.run.envelope.captureBrowserScreenshots }),
    });
  assert.deepEqual(outcome, { state: "abandoned", runId: f.root.envelope.runId, reason: "cancelled" });
  assert.equal(observed, 1);
  terminal(f.currentRoot(), "cancelled");
  const result = f.database.authority.runResults.get(f.root.envelope.runId);
  assert.ok(result);
  const evidence = terminalEvidenceResult(result);
  assert.ok(evidence?.kind === "lifecycle-evidence");
  assert.equal(evidence.outcome, "cancelled");
  assert.deepEqual(f.database.authority.runResults.get(f.child().envelope.runId), childResult);
  assert.equal(f.database.authority.runs.listChildren(f.root.envelope.runId).length, 1);
  assert.equal(f.database.authority.writeIntents.listByRun(f.root.envelope.runId).length, 0);
});

it("fences an independent queued descendant with its actual physical home reset reservation", async () => {
  const f = fixture("independent");
  const first = await f.execution.step(f.root, world.SIGNAL);
  assert.equal(first.outcome.state, "yielded-delegation");
  const owner = testWorkerLifetime(f.database, f.root.envelope.workflow, 1);
  const reset = f.database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
    commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard",
    requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: {
      workerId: owner.workerId, membershipRevision: owner.member.membershipRevision,
      controlBasis: { leaseGeneration: owner.lease.leaseGeneration, controlRevision: owner.lease.controlRevision },
    },
  }, randomUUID(), f.clock.now().toISOString()));
  assert.equal(f.database.authority.workerControls.resetForWorker(owner.workerId)?.commandId, reset.commandId);
  const runtime = f.database.authority.runtimeConfig.get();
  assert.ok(runtime);
  const generation = f.database.getMeta().authorityGeneration, child = f.child();
  const next = f.execution.lifecycle.claimNext({ commandId: randomUUID(), workflow: f.root.envelope.workflow,
    workerId: owner.workerId, workerLifetime: owner.workerLifetime, runtimeConfig: { generation: runtime.generation,
      settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
  assert.deepEqual(next, { state: "refused", refusal: { reason: "none-eligible" } });
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.equal(f.child().version, child.version);
  assert.equal(f.database.authority.runResults.get(child.envelope.runId), undefined);
  assert.equal(f.database.authority.workerSlots.list(child.envelope.workflow).length, 0);
});
