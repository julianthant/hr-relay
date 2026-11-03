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
import { queryQueueSummaries } from "../../../../src/backend/runs/queries/queue-summaries.js";
import { childExecutionParallelRoot as root, childExecutionParallelModules as modules, childExecutionStores, childWaitModules, childPolicyModules } from "../../../support/fixtures/child-execution-workflows.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";
import { plan1TransientFailureStores } from "../../../support/fixtures/plan1-operation-workflows.js";

import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { composeQueueSummaries } from "../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { gateNodeViewsOf } from "../../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { DelegationAdmissionRequestSchema } from "../../../../src/backend/storage/sqlite/delegation-contracts.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { readDelegationWait } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { stopSyntheticDatabaseWorkers } from "../../../support/helpers/synthetic-database-admission.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { partition } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { isQueueMember, isQueueTopLevel } from "../../../../src/models/dashboard/queue-parent.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

async function fixture(stores = childExecutionStores, mode: "ok" | "fail" = "ok", workflows: { root: { descriptor: AnyWorkflowDescriptor }; modules: readonly { descriptor: AnyWorkflowDescriptor }[] } = { root, modules }) {
  const { root, modules } = workflows;
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
  return { ...h.authority, execution, run, modules };
}

for (const choice of [
  { visibility: "inline", topLevel: false, pendingMember: true, doneMember: true, failedMember: true },
  { visibility: "linked", topLevel: true, pendingMember: false, doneMember: false, failedMember: false },
  { visibility: "hidden-unless-failed", topLevel: false, pendingMember: false, doneMember: false, failedMember: true },
] as const) for (const mode of ["ok", "fail"] as const) {
it(`authenticates ${choice.visibility} parent membership through admission and ${mode} settlement`, async () => {
  const f = await fixture(childExecutionStores, mode, childPolicyModules("cascade", choice.visibility));
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  const child = f.database.authority.runs.listChildren(f.run.envelope.runId)[0]; assert.ok(child);
  const v = views(f);
  const verifyPresentation = (memberVisible: boolean) => {
    const rows = v.projection.buildDashboardDayWire(f.run.envelope.enqueuedAt.slice(0, 10)).queueSurfaces;
    const parentRow = rows.find(row => row.runId === f.run.envelope.runId);
    const childRow = rows.find(row => row.runId === child.envelope.runId);
    assert.ok(parentRow); assert.ok(childRow);
    assert.deepEqual(childRow.parent, { runId: parentRow.runId, visibility: choice.visibility,
      workflowId: parentRow.workflowId, partitionDay: parentRow.startedAt.slice(0, 10),
      label: f.modules.find(module => module.descriptor.id === parentRow.workflowId)?.descriptor.label,
      title: parentRow.title, panelKind: parentRow.panelKind, status: parentRow.status });
    assert.deepEqual(parentRow.linkedRuns.map(link => link.runId), choice.topLevel ? [childRow.runId] : []);
    const layout = partition(rows);
    assert.equal(layout.top.some(row => row.runId === childRow.runId), choice.topLevel);
    assert.deepEqual(layout.membersOf.get(parentRow.runId)?.map(row => row.runId) ?? [], memberVisible ? [childRow.runId] : []);
    assert.equal(parentRow.surfaceKind === "operation", memberVisible);
    assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.envelope.shape, "single");
  };
  verifyPresentation(choice.pendingMember);
  const source = () => f.database.withAuthorityReadSnapshot(() => f.database.authority.dependencies.parents([f.run.envelope, child.envelope]));
  const parents = source(), parent = parents.get(child.envelope.runId); assert.ok(parent);
  assert.equal(parents.get(f.run.envelope.runId), null);
  assert.deepEqual(parent, { runId: f.run.envelope.runId, visibility: choice.visibility });
  assert.equal(isQueueTopLevel({ parent }), choice.topLevel);
  assert.equal(isQueueMember({ parent, status: "queued" }), choice.pendingMember);
  const manifest = f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId)[0]; assert.ok(manifest);
  f.database.withAuthorityReadSnapshot(() => {
    const proof = f.database.authority.dependencies.authenticateGroup(manifest);
    const member = proof.children[0]; assert.ok(member);
    member.history.length = 0;
    assert.deepEqual(f.database.authority.dependencies.authenticateGroup(manifest).children[0]?.history, [child.envelope.runId]);
    const altered = structuredClone(manifest);
    altered.policy.visibility = choice.visibility === "linked" ? "inline" : "linked";
    assert.throws(() => f.database.authority.dependencies.authenticateGroup(altered), /delegation-manifest-binding-mismatch/u);
    assert.deepEqual(f.database.authority.dependencies.authenticateGroup(manifest).children[0]?.history, [child.envelope.runId]);
  });
  const first = queryQueueSummaries(f.database, { topLevel: true, limit: 1 });
  const next = first.next === null ? [] : queryQueueSummaries(f.database, { topLevel: true, limit: 1, after: first.next }).items;
  assert.deepEqual([...first.items, ...next].map(row => row.runId).sort(),
    (choice.topLevel ? [f.run.envelope.runId, child.envelope.runId] : [f.run.envelope.runId]).sort());
  const day = f.run.envelope.enqueuedAt.slice(0, 10);
  assert.deepEqual(f.database.queryRunCalendar({ month: day.slice(0, 7), day, today: day }).monthCounts,
    [{ day, count: choice.topLevel ? 2 : 1 }]);
  await f.execution.execute(f.run, world.SIGNAL);
  const settled = f.database.authority.runs.get(child.envelope.runId);
  assert.ok(settled?.lifecycle.state === "terminal");
  assert.equal(settled.lifecycle.outcome, mode === "ok" ? "done" : "failed");
  v.projection.ingestFromTimeline();
  verifyPresentation(mode === "ok" ? choice.doneMember : choice.failedMember);
  assert.deepEqual(source(), parents);
  assert.equal(isQueueMember({ parent, status: settled.lifecycle.outcome }), mode === "ok" ? choice.doneMember : choice.failedMember);
});
}

it("keeps later-day inline children under their original parent day with exact attempt metadata", async () => {
  const f = await fixture(childExecutionStores, "ok", childPolicyModules("cascade", "inline"));
  const parentDay = f.clock.todayLocal();
  f.clock.advanceWall(24 * 60 * 60 * 1000);
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  const child = f.database.authority.runs.listChildren(f.run.envelope.runId)[0]; assert.ok(child);
  const reader = { read: f.execution.lifecycle.read.bind(f.execution.lifecycle), list: f.execution.lifecycle.list.bind(f.execution.lifecycle),
    withRunTreeSnapshot: f.execution.lifecycle.withRunTreeSnapshot.bind(f.execution.lifecycle),
    summaries: { ...composeQueueSummaries(f.database), activity() { throw new Error("unrequested activity"); } } };
  const projection = createOperatorProjection({ database: f.database, reader,
    descriptors: { resolve: id => f.modules.find(module => module.descriptor.id === id)?.descriptor },
    stateRoot: f.stateRoot, clock: f.clock, appVersion: "0.1.0", descriptorSetHash: f.run.envelope.contractFingerprint,
    ledger: { foldActivityRange: () => { throw new Error("unrequested activity"); } } });
  projection.rebuildFromTimeline();
  const day = projection.buildDashboardDayWire(parentDay);
  const layout = partition(day.queueSurfaces);
  assert.deepEqual(layout.top.map(row => row.runId), [f.run.envelope.runId]);
  assert.deepEqual(layout.membersOf.get(f.run.envelope.runId)?.map(row => row.runId), [child.envelope.runId]);
  assert.ok(day.attemptHistory);
  assert.equal(day.attemptHistory.length, 2);
  assert.equal(day.attemptHistory.find(row => row.runId === child.envelope.runId)?.startedAt, child.envelope.enqueuedAt);
  assert.equal(day.queueSurfaces.find(row => row.runId === child.envelope.runId)?.parent?.partitionDay, parentDay);
  assert.deepEqual(projection.buildDashboardDayWire(f.clock.todayLocal()).workflowCounts, []);
});

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
  const admissions = f.database.authority.lifecycleJournal.listDelegationAdmissions(f.run.envelope.runId, waiting.claimGeneration);
  const requests = admissions.map(command => DelegationAdmissionRequestSchema.parse(command.request));
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0]?.claim, requests[1]?.claim);
  assert.equal(requests[0]?.expectedVersion, requests[1]?.expectedVersion);
  const requestKeys = ["claim", "commandId", "expectedVersion", "invocationCommandId", "observedScopeDigest", "runId", "scopeEvidence"];
  for (const request of requests) assert.deepEqual(Object.keys(request).sort(), requestKeys);
  assert.equal(requests.filter(request => f.database.authority.lifecycleJournal.getCommand(lifecycleCommandId("delegation-release", request.commandId)) !== undefined).length, 1);
  assert.throws(() => readDelegationWait({ ...f.database.authority, lifecycleJournal: { ...f.database.authority.lifecycleJournal,
    listDelegationAdmissions: () => admissions.slice(1) } }, waiting, root.descriptor), /delegation-owner-membership-mismatch/u);
  const query = { workflow: root.descriptor.id, limit: 1, topLevel: true } as const;
  const visible = queryQueueSummaries(f.database, query);
  assert.equal(visible.items[0]?.status, "running");
  assert.equal(visible.items[0]?.runId, f.run.envelope.runId);
  assert.equal(visible.items[0]?.startedAt, f.run.envelope.enqueuedAt);
  assert.equal(queryQueueSummaries(f.database, { ...query, status: "queued" }).items.length, 0);
  assert.equal(queryQueueSummaries(f.database, { ...query, status: "running" }).items[0]?.runId, f.run.envelope.runId);
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


function views(f: Awaited<ReturnType<typeof fixture>>) {
  const descriptors = { resolve: (id: string) => f.modules.find(module => module.descriptor.id === id)?.descriptor };
  const projection = createOperatorProjection({ database: f.database, reader: f.execution.lifecycle, descriptors,
    stateRoot: f.stateRoot, clock: f.clock, appVersion: "0.1.0", descriptorSetHash: f.run.envelope.contractFingerprint,
    ledger: { foldActivityRange: () => { throw new Error("unrequested activity"); } } });
  projection.rebuildFromTimeline();
  const detail = createOperatorRunDetail({ database: f.database, runReader: f.execution.lifecycle, projection, stateRoot: f.stateRoot });
  return { projection, detail: (runId: string) => buildRunDetail({ ...detail, descriptors: { resolve: id => {
    const descriptor = descriptors.resolve(id);
    return descriptor === undefined ? undefined : { ...descriptor, gateNodes: gateNodeViewsOf(descriptor) };
  } } }, runId) };
}

it("keeps an approval only on its owning run while both waiting ancestors retain their row and current step", async () => {
  const workflows = childWaitModules("gate");
  const f = await fixture(childExecutionStores, "ok", workflows);
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  const parked = await f.execution.step(f.run, world.SIGNAL);
  assert.equal(parked.outcome.state, "parked-gate");
  const middle = f.database.authority.runs.listChildren(f.run.envelope.runId)[0];
  const leaf = middle === undefined ? undefined : f.database.authority.runs.listChildren(middle.envelope.runId)[0];
  assert.ok(middle); assert.ok(leaf?.lifecycle.state === "parked-gate");
  const v = views(f);
  for (const run of [f.run, middle]) {
    const row = v.projection.queueSurface(run.envelope.runId);
    assert.equal(row?.status, "running");
    assert.equal(row?.startedAt, run.envelope.enqueuedAt);
    assert.equal(row?.pipeline.find(step => step.id === "child")?.state, "active");
    assert.equal(v.detail(run.envelope.runId).header.status, "running");
    assert.equal(queryQueueSummaries(f.database, { workflow: run.envelope.workflow, limit: 1, status: "queued", topLevel: false }).items.length, 0);
  }
  assert.equal(v.projection.queueSurface(leaf.envelope.runId)?.status, "awaiting-approval");
  assert.equal(v.detail(leaf.envelope.runId).header.status, "awaiting-approval");
  const gate = descriptorRuntimeNodes(workflows.leaf.descriptor).find(node => node.kind === "gate");
  assert.ok(gate?.kind === "gate");
  const approved = f.execution.kernel.execute({ commandId: randomUUID(), family: "gate", type: "resolve-gate", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: leaf.envelope.runId, expectedVersion: leaf.version, gateId: leaf.lifecycle.gateId },
    payload: { result: { schemaHash: deriveSchemaHash(gate.result, "output"), value: { approved: true } } } });
  assert.equal(approved.state, "applied");
  const done = await f.execution.execute(f.run, world.SIGNAL);
  assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done");
  assert.equal(done.run.envelope.runId, f.run.envelope.runId);
  assert.equal(done.run.envelope.attempt, f.run.envelope.attempt);
  assert.equal(done.run.envelope.enqueuedAt, f.run.envelope.enqueuedAt);
});

it("propagates a block-parent failure through both waiting ancestors and refreshes their existing rows", async () => {
  const f = await fixture(childExecutionStores, "fail", childWaitModules("blocked"));
  await f.execution.step(f.run, world.SIGNAL);
  await f.execution.step(f.run, world.SIGNAL);
  const v = views(f), changes: string[] = [];
  v.projection.onChange(change => changes.push(change.kind));
  assert.equal(v.projection.queueSurface(f.run.envelope.runId)?.status, "running");
  f.database.withAuthorityReadSnapshot(() => {
    const wait = f.database.authority.dependencies.waitState(f.run.envelope.runId); assert.ok(wait);
    assert.equal(wait.state, "running");
    wait.state = "blocked";
    assert.equal(f.database.authority.dependencies.waitState(f.run.envelope.runId)?.state, "running");
  });
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "failed");
  v.projection.ingestFromTimeline();
  assert.equal(v.projection.health().state, "live");
  assert.ok(changes.includes("snapshot"));
  const middle = f.database.authority.runs.listChildren(f.run.envelope.runId)[0]; assert.ok(middle);
  for (const run of [f.run, middle]) {
    const row = v.projection.queueSurface(run.envelope.runId);
    assert.equal(row?.status, "blocked");
    assert.equal(row?.pipeline.find(step => step.id === "child")?.state, "blocked");
    assert.equal(row?.startedAt, run.envelope.enqueuedAt);
    assert.equal(v.detail(run.envelope.runId).header.status, "blocked");
    assert.equal(queryQueueSummaries(f.database, { workflow: run.envelope.workflow, status: "blocked", limit: 1, topLevel: false }).items[0]?.runId, run.envelope.runId);
    assert.equal(queryQueueSummaries(f.database, { workflow: run.envelope.workflow, status: "queued", limit: 1, topLevel: false }).items.length, 0);
  }
});

it("holds a retried child at existing Paused/Resume until the exact completed attempt is acknowledged", async () => {
  const f = await fixture(plan1TransientFailureStores(() => {}), "fail", childWaitModules("manual"));
  await f.execution.step(f.run, world.SIGNAL);
  await f.execution.step(f.run, world.SIGNAL);
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "failed");
  const middleId = f.database.authority.runs.listChildren(f.run.envelope.runId)[0]?.envelope.runId; assert.ok(middleId);
  const failed = f.database.authority.runs.listChildren(middleId)[0]; assert.ok(failed?.lifecycle.state === "terminal");
  for (const type of ["pause", "resume"] as const) {
    const parent = f.database.authority.runs.get(middleId); assert.ok(parent);
    assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type, source: "dashboard", requestedBy: "local-operator",
      requestedAt: f.clock.now().toISOString(), target: { runId: middleId, expectedVersion: parent.version } }).state, "applied");
  }
  assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } }).state, "applied");
  const paused = f.database.authority.runs.get(middleId); assert.ok(paused);
  assert.equal(paused.pause?.state, "paused");
  const resume = { commandId: randomUUID(), family: "run", type: "resume", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: middleId, expectedVersion: paused.version } } as const;
  assert.equal(f.execution.kernel.execute(resume).state, "rejected");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "done");
  assert.equal(f.database.authority.dependencies.readiness(middleId, "join").state, "blocked");
  const v = views(f);
  assert.equal(v.projection.queueSurface(middleId)?.pauseControl?.state, "paused");
  assert.equal(v.projection.queueSurface(middleId)?.pauseControl?.command, "resume");
  const resumed = { ...resume, commandId: randomUUID() };
  assert.equal(f.execution.kernel.execute(resumed).state, "applied");
  assert.equal(f.execution.kernel.execute(resumed).state, "already-applied");
  assert.equal(f.database.authority.dependencies.readiness(middleId, "join").state, "ready");
  const done = await f.execution.execute(f.run, world.SIGNAL);
  assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done");
  assert.equal(f.database.authority.runs.get(middleId)?.envelope.attempt, paused.envelope.attempt);
  assert.equal(f.database.authority.runs.get(middleId)?.envelope.enqueuedAt, paused.envelope.enqueuedAt);
});

it("does not carry a manual Resume acknowledgement into a later retry attempt", async () => {
  let calls = 0;
  const stores = plan1TransientFailureStores(() => { if (++calls === 3) throw new Error("second attempt failed"); });
  const f = await fixture(stores, "fail", childWaitModules("manual"));
  await f.execution.step(f.run, world.SIGNAL);
  await f.execution.step(f.run, world.SIGNAL);
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "failed");
  const middleId = f.database.authority.runs.listChildren(f.run.envelope.runId)[0]?.envelope.runId; assert.ok(middleId);
  const retry = () => {
    const failed = f.database.authority.runs.listChildren(middleId).filter(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed")
      .sort((a, b) => b.envelope.attempt - a.envelope.attempt)[0]; assert.ok(failed);
    return f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
      requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } });
  };
  const resume = () => {
    const parent = f.database.authority.runs.get(middleId); assert.ok(parent);
    return f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "resume", source: "dashboard", requestedBy: "local-operator",
      requestedAt: f.clock.now().toISOString(), target: { runId: middleId, expectedVersion: parent.version } });
  };
  assert.equal(retry().state, "applied");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "failed");
  assert.equal(resume().state, "applied");
  assert.deepEqual(f.database.authority.dependencies.readiness(middleId, "join").state, "blocked");
  assert.equal(retry().state, "applied");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "done");
  const readiness = f.database.authority.dependencies.readiness(middleId, "join");
  assert.ok(readiness.state === "blocked" && readiness.reason === "manual-parent-resume");
  assert.equal(f.database.authority.runs.get(middleId)?.pause?.state, "paused");
  assert.equal(resume().state, "applied");
  const done = await f.execution.execute(f.run, world.SIGNAL);
  assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done");
});

for (const policy of ["cascade", "independent"] as const) {
  it(`retries authenticated cancelled children with ${policy} policy without replacing the parent`, async () => {
    const f = await fixture(childExecutionStores, "ok", childPolicyModules(policy));
    assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
    const command = (type: "cancel" | "retry", runId: string) => {
      const run = f.database.authority.runs.get(runId); assert.ok(run);
      return f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type, source: "dashboard", requestedBy: "local-operator",
        ...(type === "cancel" ? { reason: "Synthetic cancellation" } : {}),
        requestedAt: f.clock.now().toISOString(), target: { runId, expectedVersion: run.version } });
    };
    if (policy === "independent") assert.equal(command("cancel", f.run.envelope.runId).state, "applied");
    const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const child = f.database.authority.runs.listChildren(f.run.envelope.runId).find(run => run.envelope.attempt === attempt); assert.ok(child);
      assert.equal(command("cancel", child.envelope.runId).state, "applied");
      const cancelled = f.database.authority.runResults.get(child.envelope.runId); assert.ok(cancelled);
      assert.equal(command("retry", child.envelope.runId).state, "applied");
      assert.deepEqual(f.database.authority.runResults.get(child.envelope.runId), cancelled);
    }
    const completed = await f.execution.step(f.run, world.SIGNAL);
    assert.equal(completed.outcome.state, "done");
    assert.equal(completed.run.envelope.attempt, 3);
    assert.deepEqual(f.database.authority.runs.get(f.run.envelope.runId), parent);
    assert.equal(f.database.authority.runs.listByItem({ workflow: f.run.envelope.workflow, itemId: f.run.envelope.itemId }).length, 1);
  });
}


it("retries a failed nested branch through the operator Retry door and reuses its successful sibling", async () => {
  const calls = new Map<string, number>();
  const f = await fixture(plan1TransientFailureStores(input => calls.set(input.emplId, (calls.get(input.emplId) ?? 0) + 1)), "fail");
  assert.equal((await f.execution.execute(f.run, world.SIGNAL)).outcomes.at(-1)?.state, "failed");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "failed");
  const children = f.database.authority.runs.listChildren(f.run.envelope.runId);
  const left = children.find(child => child.envelope.parent?.edgeId === "left"), right = children.find(child => child.envelope.parent?.edgeId === "right");
  assert.ok(left?.lifecycle.state === "terminal" && left.lifecycle.outcome === "failed");
  assert.ok(right?.lifecycle.state === "terminal" && right.lifecycle.outcome === "done");
  const receipt = f.database.authority.runResults.get(right.envelope.runId); assert.ok(receipt);
  const retry = f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: left.envelope.runId, expectedVersion: left.version } });
  assert.equal(retry.state, "applied");
  const done = await f.execution.execute(f.run, world.SIGNAL);
  assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done");
  assert.deepEqual(f.database.authority.runResults.get(right.envelope.runId), receipt);
  assert.equal(calls.get("10800001"), 3);
  assert.equal(calls.get("10800002"), 2);
  assert.equal(done.run.envelope.runId, f.run.envelope.runId);
  assert.equal(done.run.envelope.attempt, f.run.envelope.attempt);
});


it("holds the continuing parent at Paused/Resume for a retained manual inner retry", async () => {
  const f = await fixture(plan1TransientFailureStores(() => {}), "fail", childWaitModules("manual-recovery"));
  assert.equal((await f.execution.execute(f.run, world.SIGNAL)).outcomes.at(-1)?.state, "failed");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "failed");
  const original = f.database.authority.runs.listChildren(f.run.envelope.runId)[0];
  assert.ok(original?.lifecycle.state === "terminal" && original.lifecycle.outcome === "failed");
  assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: original.envelope.runId, expectedVersion: original.version } }).state, "applied");
  const continuing = f.database.authority.runs.listChildren(f.run.envelope.runId).find(run => run.envelope.retryOf === original.envelope.runId);
  assert.ok(continuing); assert.equal(continuing.pause?.state, "paused");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "done");
  const readiness = f.database.authority.dependencies.readiness(continuing.envelope.runId, "join");
  assert.ok(readiness.state === "blocked" && readiness.reason === "manual-parent-resume");
  const v = views(f);
  assert.equal(v.projection.queueSurface(continuing.envelope.runId)?.status, "blocked");
  assert.equal(v.projection.queueSurface(f.run.envelope.runId)?.status, "blocked");
  assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "resume", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: continuing.envelope.runId, expectedVersion: continuing.version } }).state, "applied");
  const done = await f.execution.execute(f.run, world.SIGNAL);
  assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done");
  assert.equal(f.database.authority.runs.get(continuing.envelope.runId)?.envelope.attempt, continuing.envelope.attempt);
});

it("reopens the unchanged singleton admission receipt without converting or re-admitting it", async () => {
  const workflows = childPolicyModules("cascade"), f = await fixture(childExecutionStores, "ok", workflows);
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "yielded-delegation");
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent);
  const admissions = f.database.authority.lifecycleJournal.listDelegationAdmissions(parent.envelope.runId, parent.claimGeneration);
  assert.equal(admissions.length, 1);
  const command = admissions[0]; assert.ok(command);
  const request = DelegationAdmissionRequestSchema.parse(command.request);
  const releaseId = lifecycleCommandId("delegation-release", request.commandId);
  const release = f.database.authority.lifecycleJournal.getCommand(releaseId);
  const wait = f.database.authority.dependencies.wait(parent.envelope.runId, workflows.root.descriptor);
  assert.ok(wait); assert.equal(wait.admissionCommandId, request.commandId); assert.equal(wait.nodeId, "child");
  stopSyntheticDatabaseWorkers({ database: f.database, path: f.path });
  f.closeDatabase();
  const reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "retained-singleton-wait" }, f.clock);
  try {
    assert.deepEqual(reopened.authority.dependencies.wait(parent.envelope.runId, workflows.root.descriptor), wait);
    assert.deepEqual(reopened.authority.lifecycleJournal.getCommand(command.commandId), command);
    assert.deepEqual(reopened.authority.lifecycleJournal.getCommand(releaseId), release);
    assert.deepEqual(reopened.authority.runs.get(parent.envelope.runId), parent);
  } finally { reopened.close(); }
});
