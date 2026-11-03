import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { readDelegationEvidence } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { childExecutionParallelRoot as root, childExecutionParallelModules as modules, childExecutionStores } from "../../../support/fixtures/child-execution-workflows.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";
import { plan1TransientFailureStores } from "../../../support/fixtures/plan1-operation-workflows.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

async function fixture(stores = childExecutionStores, mode: "ok" | "fail" = "ok") {
  const h = await world.executorHarness({ descriptor: root.descriptor, stores });
  const { database, clock, path, stateRoot } = h.authority;
  const patch = { "actor.label": { set: "Synthetic operator" } } as const;
  assert.equal(executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, hostConfigFacts({}), clock), createCredentialStore({ stateRoot })) },
  { commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface", requestedBy: "local-operator",
    requestedAt: clock.now().toISOString(), target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }).state, "applied");
  const execution = canonicalChildExecution(h.deps, database, path, id => modules.find(module => module.descriptor.id === id)?.descriptor);
  const run = execution.start(root.descriptor, { emplId: "10800000", text: "parallel", mode }, { dryRun: false });
  return { ...h.authority, execution, run };
}

it("admits both different fan-outs before one release and completes their nested work on one home worker", async () => {
  const f = await fixture();
  const requeue = f.execution.lifecycle.requeue.bind(f.execution.lifecycle);
  let releases = 0;
  f.execution.lifecycle.requeue = request => { releases++; return requeue(request); };
  const first = await f.execution.step(f.run, world.SIGNAL);
  assert.equal(first.outcome.state, "yielded-delegation");
  assert.equal(releases, 1);
  const manifests = f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId);
  assert.deepEqual(manifests.map(manifest => manifest.edgeId).sort(), ["left", "right"]);
  assert.equal(f.database.authority.runs.listChildren(f.run.envelope.runId).length, 2);
  const waiting = f.database.authority.runs.get(f.run.envelope.runId);
  assert.ok(waiting);
  assert.equal(waiting.lifecycle.state, "queued");
  assert.equal(runClaim(waiting), undefined);
  assert.deepEqual(waiting.envelope, f.run.envelope);
  const home = f.database.authority.workerSlots.list().filter(slot => slot.workflow === root.descriptor.id);
  assert.equal(home.length, 1);
  const completed = await f.execution.execute(f.run, world.SIGNAL);
  assert.equal(completed.run?.lifecycle.state, "terminal");
  assert.equal(completed.run?.envelope.runId, f.run.envelope.runId);
  assert.equal(completed.run?.envelope.attempt, f.run.envelope.attempt);
  assert.deepEqual(f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId), manifests);
  const left = readDelegationEvidence(f.database.authority, f.run.envelope.runId, "left");
  const right = readDelegationEvidence(f.database.authority, f.run.envelope.runId, "right");
  assert.equal(left.children.length, 1);
  assert.equal(right.children.length, 1);
  assert.ok(left.children[0]);
  assert.equal(readDelegationEvidence(f.database.authority, left.children[0].run.envelope.runId, "nested").children.length, 1);
  assert.deepEqual(f.database.authority.workerSlots.list().filter(slot => slot.workflow === root.descriptor.id), home);
  assert.equal(completed.outcomes.filter(outcome => outcome.state === "yielded-delegation").length, 1);
  assert.equal(releases, 2);
});

it("rolls back the first fan-out and its native publication when the second admission fails", async () => {
  const f = await fixture();
  const admit = f.execution.lifecycle.admitDelegation.bind(f.execution.lifecycle);
  let reached = false;
  f.execution.lifecycle.admitDelegation = (context, plans) => {
    const generation = f.database.getMeta().authorityGeneration;
    const input = root.descriptor.canonicalInput.parse(f.run.input.parsed.value);
    const leaves = context.leaves.map((leaf, index) => index === 0 ? leaf : {
      ...leaf, scope: { ...leaf.scope, input: { ...input, text: "changed" } },
    });
    try { return admit({ ...context, leaves }, plans); }
    catch (error) {
      reached = true;
      assert.match(String(error), /delegation-scope-input-mismatch/u);
      assert.equal(f.database.getMeta().authorityGeneration, generation);
      assert.deepEqual(f.database.authority.runs.listChildren(f.run.envelope.runId), []);
      assert.deepEqual(f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId), []);
      assert.deepEqual(f.database.authority.lifecycleJournal.listDelegationInvocations(f.run.envelope.runId), []);
      assert.deepEqual(f.database.authority.dependencies.listByParentRun(f.run.envelope.runId), []);
      throw error;
    }
  };
  const outcome = await f.execution.step(f.run, world.SIGNAL);
  assert.equal(reached, true);
  assert.equal(outcome.outcome.state, "failed");
});

it("cancels only the cascading branch and still claims its independent sibling on the same home", async () => {
  const f = await fixture();
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  const parent = f.database.authority.runs.get(f.run.envelope.runId);
  assert.ok(parent);
  assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "cancel", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: parent.envelope.runId, expectedVersion: parent.version } }).state, "applied");
  const members = f.database.authority.runs.listChildren(parent.envelope.runId);
  const left = members.find(member => member.envelope.parent?.edgeId === "left"), right = members.find(member => member.envelope.parent?.edgeId === "right");
  assert.ok(left?.lifecycle.state === "terminal" && left.lifecycle.outcome === "cancelled");
  assert.ok(right?.lifecycle.state === "queued");
  const completed = await f.execution.step(f.run, world.SIGNAL);
  assert.equal(completed.run.envelope.runId, right.envelope.runId);
  assert.equal(completed.outcome.state, "done");
  assert.deepEqual(f.database.authority.runs.get(left.envelope.runId), left);
});

it("recovers only the failed nested branch and reuses the completed sibling receipt without another dispatch", async () => {
  const calls = new Map<string, number>();
  const f = await fixture(plan1TransientFailureStores(input => calls.set(input.emplId, (calls.get(input.emplId) ?? 0) + 1)), "fail");
  const first = await f.execution.execute(f.run, world.SIGNAL);
  assert.equal(first.outcomes.at(-1)?.state, "failed");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "failed");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "failed");
  const failed = f.database.authority.runs.get(f.run.envelope.runId);
  assert.ok(failed?.lifecycle.state === "terminal" && failed.lifecycle.outcome === "failed");
  const right = f.database.authority.runs.listChildren(f.run.envelope.runId).find(child => child.envelope.parent?.edgeId === "right");
  assert.ok(right?.lifecycle.state === "terminal" && right.lifecycle.outcome === "done");
  const receipt = f.database.authority.runResults.get(right.envelope.runId);
  assert.ok(receipt);
  assert.equal(calls.get("10800001"), 1);
  assert.equal(calls.get("10800002"), 2);
  assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "recover-run", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } }).state, "applied");
  const replacement = f.database.authority.runs.listByItem({ workflow: f.run.envelope.workflow, itemId: f.run.envelope.itemId })
    .find(run => run.envelope.retryOf === f.run.envelope.runId);
  assert.ok(replacement);
  const recovered = await f.execution.execute(replacement, world.SIGNAL);
  assert.ok(recovered.run?.lifecycle.state === "terminal" && recovered.run.lifecycle.outcome === "done");
  assert.deepEqual(f.database.authority.runResults.get(right.envelope.runId), receipt);
  assert.equal(f.database.authority.runs.listByItem({ workflow: right.envelope.workflow, itemId: right.envelope.itemId }).length, 1);
  assert.deepEqual(f.database.authority.runs.listChildren(replacement.envelope.runId), []);
  assert.equal(calls.get("10800001"), 3);
  assert.equal(calls.get("10800002"), 2);
});
