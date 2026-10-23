import type { RunRecord } from "../../../../src/models/run/record.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { admitWorkerReset } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { childPolicyModules } from "../../../support/fixtures/child-execution-workflows.js";
import { plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

function terminal(run: RunRecord, outcome: "cancelled" | "done"): void {
  assert.ok(run.lifecycle.state === "terminal");
  assert.equal(run.lifecycle.outcome, outcome);
}

function fixture(policy: "cascade" | "independent") {
  const { root: compiled, modules } = childPolicyModules(policy);
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
  const root = execution.start(compiled.descriptor, { emplId: "10800000", text: "same", mode: "ok" }, { dryRun: true });
  const currentRoot = () => { const run = database.authority.runs.get(root.envelope.runId); assert.ok(run); return run; };
  const child = () => { const children = database.authority.runs.listChildren(root.envelope.runId); assert.equal(children.length, 1); assert.ok(children[0]); return children[0]; };
  const cancel = () => CommandRequestSchema.parse({ commandId: randomUUID(), family: "run", type: "cancel", source: "dashboard",
    requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { runId: root.envelope.runId, expectedVersion: currentRoot().version } });
  return { ...h.authority, execution, root, currentRoot, child, cancel };
}

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
