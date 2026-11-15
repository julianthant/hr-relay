import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach,it } from "vitest";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { DelegationManifestSchema } from "../../../../src/rules/workflow/dependencies.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { DelegationTerminalDependencySchema,delegationDependencyRecord } from "../../../../src/models/run/result.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { authorizeWorkflowDelegationRefresh,assertWorkflowDelegationRefreshAuthorization,descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { currentDelegationManifests,readDelegationEvidence,readDelegationScopeEvidence } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { childSettledReviewModules,childSettledObservationModules,childRevisedMembershipModules,childRevisedExpiringModules } from "../../../support/fixtures/child-execution-workflows.js";
import { Plan1Input,Plan1Output,plan1ExpiringFailureStores,plan1ControlledFailureStores,plan1TransientFailureStores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { createDelegationExecutionWorld } from "../../../support/helpers/backend/delegation-execution-world.js";

const world = createDelegationExecutionWorld(childSettledReviewModules);
const fixture = world.fixture;
afterEach(world.cleanup);

it("authenticates a retained all-settled scope before and after its failed member is replaced", async () => {
  const f = await fixture(plan1TransientFailureStores(() => {}), "fail", childSettledReviewModules);
  await f.execution.execute(f.run, world.SIGNAL);
  await f.execution.step(f.run, world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent?.lifecycle.state === "parked-gate");
  const refresh = authorizeWorkflowDelegationRefresh(childSettledReviewModules.root.descriptor,parent); assert.ok(refresh);
  assert.equal(assertWorkflowDelegationRefreshAuthorization(refresh,parent),childSettledReviewModules.root.descriptor);
  const failed = f.database.authority.runs.listChildren(parent.envelope.runId)[0];
  assert.ok(failed?.lifecycle.state === "terminal" && failed.lifecycle.outcome === "failed");
  const retained = readDelegationEvidence(f.database.authority,parent.envelope.runId,"members");
  const citation = delegationDependencyRecord(retained);
  const readRetainedScope = () => {
    const owner = f.database.authority.runs.get(parent.envelope.runId); assert.ok(owner);
    return readDelegationScopeEvidence(f.database.authority,owner,[{ kind: "delegation", nodeId: retained.nodeId, receipt: citation }]);
  };
  const originalScope = readRetainedScope();
  assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } }).state, "applied");
  const waiting = f.database.authority.runs.get(parent.envelope.runId); assert.equal(waiting?.delegationRefresh?.phase,"waiting");
  assert.deepEqual(waiting?.envelope,parent.envelope);
  assert.deepEqual(readRetainedScope(), originalScope);
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "done");
  assert.equal(f.database.authority.runs.get(parent.envelope.runId)?.delegationRefresh?.phase,"settled");
  assert.deepEqual(readRetainedScope(), originalScope);
  assert.notEqual(readDelegationEvidence(f.database.authority,parent.envelope.runId,retained.nodeId).children[0]?.run.envelope.runId, citation.members[0]?.runId);
  const foreign = DelegationTerminalDependencySchema.parse({ ...citation, members: citation.members.map(member => ({ ...member, runId: randomUUID() })) });
  assert.throws(() => readDelegationScopeEvidence(f.database.authority,parent,[{ kind: "delegation", nodeId: retained.nodeId, receipt: foreign }]), /delegation-cited-member-unavailable/);
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state,"parked-gate");
  assert.deepEqual(f.database.authority.runs.get(parent.envelope.runId)?.envelope,parent.envelope);
});

it("refreshes a completed read-only joined parent on the same row and retains its original terminal result", async () => {
  const f = await fixture(plan1TransientFailureStores(() => {}),"fail",childSettledObservationModules);
  await f.execution.execute(f.run,world.SIGNAL);
  await f.execution.step(f.run,world.SIGNAL);
  await f.execution.step(f.run,world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent?.completion?.kind === "done");
  const original = f.database.authority.runResults.get(parent.envelope.runId); assert.ok(original);
  const failed = f.database.authority.runs.listChildren(parent.envelope.runId)[0]; assert.ok(failed?.lifecycle.state === "terminal" && failed.lifecycle.outcome === "failed");
  const command = { commandId: randomUUID(), family: "run" as const, type: "retry" as const, source: "dashboard" as const,
    requestedBy: "local-operator" as const, requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } };
  const first = f.execution.kernel.execute(command); assert.equal(first.state,"applied");
  const waiting = f.database.authority.runs.get(parent.envelope.runId); assert.equal(waiting?.delegationRefresh?.phase,"waiting");
  assert.deepEqual(waiting?.envelope,parent.envelope);
  assert.equal(f.database.authority.runResults.get(parent.envelope.runId),undefined);
  assert.deepEqual(f.database.authority.runResults.getInitialSettlement(parent.envelope.runId)?.result,original);
  const audit = f.database.authority.commandAudits.findByCommand(command.commandId); assert.ok(audit);
  assert.ok(audit.versionChanges.some(change => change.target.family === "run" && change.target.runId === parent.envelope.runId && Number(change.before) === Number(parent.version) && change.after === waiting?.version));
  const replay = f.execution.kernel.execute(command); assert.deepEqual(replay,{ ...first, state: "already-applied" });
  assert.equal(f.database.authority.runs.get(parent.envelope.runId)?.version,waiting?.version);
  assert.equal((await f.execution.step(f.run,world.SIGNAL)).outcome.state,"done");
  const ready = f.database.authority.runs.get(parent.envelope.runId); assert.equal(ready?.delegationRefresh?.phase,"settled");
  f.database.authority.dependencies.reconcile(parent.envelope.runId,f.clock.now().toISOString());
  assert.equal(f.database.authority.runs.get(parent.envelope.runId)?.version,ready?.version);
  assert.equal((await f.execution.step(f.run,world.SIGNAL)).outcome.state,"done");
  const refreshed = f.database.authority.runs.get(parent.envelope.runId); assert.ok(refreshed?.completion?.kind === "done");
  assert.deepEqual(refreshed.envelope,parent.envelope);
  assert.deepEqual(f.database.authority.runResults.getInitialSettlement(parent.envelope.runId)?.result,original);
  assert.ok(refreshed.completion.expectedVersion > parent.completion.expectedVersion);
  assert.deepEqual(f.database.authority.runResults.getSettlement(parent.envelope.runId,refreshed.completion.expectedVersion + 1)?.result, f.database.authority.runResults.get(parent.envelope.runId));
});

it("releases a refreshed parent only after every accepted child retry settles", async () => {
  let fail = true;
  const f = await fixture(plan1ControlledFailureStores(() => fail),"fail",childSettledObservationModules);
  await f.execution.execute(f.run,world.SIGNAL);
  await f.execution.step(f.run,world.SIGNAL);
  await f.execution.step(f.run,world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent?.completion?.kind === "done");
  const failed = f.database.authority.runs.listChildren(parent.envelope.runId);
  assert.equal(failed.length,2);
  assert.ok(failed.every(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"));
  fail = false;
  for (const child of failed) assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard",
    requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: { runId: child.envelope.runId, expectedVersion: child.version } }).state,"applied");
  const waiting = f.database.authority.runs.get(parent.envelope.runId); assert.equal(waiting?.delegationRefresh?.retryCommandIds.length,2);
  assert.equal(waiting?.delegationRefresh?.phase,"waiting");
  assert.equal((await f.execution.step(f.run,world.SIGNAL)).outcome.state,"done");
  assert.equal(f.database.authority.runs.get(parent.envelope.runId)?.version,waiting?.version);
  assert.equal(f.database.authority.runs.get(parent.envelope.runId)?.delegationRefresh?.phase,"waiting");
  assert.equal((await f.execution.step(f.run,world.SIGNAL)).outcome.state,"done");
  const ready = f.database.authority.runs.get(parent.envelope.runId); assert.equal(ready?.delegationRefresh?.phase,"settled");
  assert.equal(ready?.version,(waiting?.version ?? 0)+1);
  assert.deepEqual(ready?.envelope,parent.envelope);
  assert.equal((await f.execution.step(f.run,world.SIGNAL)).outcome.state,"done");
});

it("revises lookup membership after a page retry and reuses only the unchanged record's fresh read", async () => {
  let fail = true;
  const f = await fixture(plan1ControlledFailureStores(input => fail && input.mode === "fail"),"fail",childRevisedMembershipModules);
  await f.execution.execute(f.run,world.SIGNAL);
  await f.execution.execute(f.run,world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent?.completion?.kind === "done");
  const original = readDelegationEvidence(f.database.authority,parent.envelope.runId,"lookups");
  assert.equal(original.children.length,1);
  const originalManifest = canonicalJsonStringify(original.manifest);
  const preserved = original.children[0]; assert.ok(preserved);
  const failed = f.database.authority.runs.listChildren(parent.envelope.runId).find(child => child.envelope.parent?.edgeId === "pages"
    && child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failed);
  fail = false;
  assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } }).state,"applied");
  await f.execution.execute(f.run,world.SIGNAL);
  const done = f.database.authority.runs.get(parent.envelope.runId); assert.ok(done?.completion?.kind === "done");
  const revised = readDelegationEvidence(f.database.authority,parent.envelope.runId,"lookups");
  assert.equal(revised.children.length,2);
  assert.notEqual(revised.manifest.manifestId,original.manifest.manifestId);
  assert.equal(revised.manifest.revision?.previousManifestId,original.manifest.manifestId);
  assert.equal(revised.manifest.children[0]?.reuse?.runId,preserved.run.envelope.runId);
  assert.deepEqual(revised.children[0],preserved);
  assert.equal(f.database.authority.runs.listChildren(parent.envelope.runId).filter(child => child.envelope.parent?.edgeId === "lookups").length,2);
  assert.equal(canonicalJsonStringify(f.database.authority.delegationManifests.get(original.manifest.manifestId)),originalManifest);
  assert.equal(currentDelegationManifests(f.database.authority,parent.envelope.runId).length,2);
  assert.equal(f.database.authority.delegationManifests.listByParentRun(parent.envelope.runId).length,3);
  assert.deepEqual(done.envelope,parent.envelope);
  const generation = f.database.getMeta().authorityGeneration;
  const source = revised.manifest.children[0]?.reuse; assert.ok(source);
  for (const reuse of [{ ...source, dependencyId: randomUUID() },{ ...source, appliedVersion: source.appliedVersion + 1 }]) {
    const forged = DelegationManifestSchema.parse({ ...revised.manifest, children: revised.manifest.children.map((child,index) => index === 0 ? { ...child,reuse } : child) });
    assert.throws(() => f.database.authority.dependencies.authenticateGroup(forged),/delegation-reuse-binding-mismatch/);
  }
  const cyclic = DelegationManifestSchema.parse({ ...revised.manifest, revision: { ...revised.manifest.revision, previousManifestId: revised.manifest.manifestId } });
  assert.throws(() => f.database.authority.dependencies.authenticateGroup(cyclic),/delegation-scope-cycle/);
  assert.equal(f.database.getMeta().authorityGeneration,generation);
});

for (const scenario of ["blank","group","replace","empty"] as const) it(`authenticates ${scenario} record membership after a page retry`, async () => {
  let fail = true;
  const f = await fixture(plan1ControlledFailureStores(input => fail && input.mode === "fail"),"fail",childRevisedMembershipModules,scenario);
  await f.execution.execute(f.run,world.SIGNAL);
  await f.execution.execute(f.run,world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent?.completion?.kind === "done");
  const original = readDelegationEvidence(f.database.authority,parent.envelope.runId,"lookups");
  const previous = original.children[0]; assert.ok(previous);
  const failed = f.database.authority.runs.listChildren(parent.envelope.runId).find(child => child.envelope.parent?.edgeId === "pages"
    && child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failed);
  fail = false;
  assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } }).state,"applied");
  await f.execution.execute(f.run,world.SIGNAL);
  assert.equal(f.database.authority.runs.get(parent.envelope.runId)?.lifecycle.state,"terminal");
  const revised = readDelegationEvidence(f.database.authority,parent.envelope.runId,"lookups");
  assert.equal(revised.children.length,scenario === "empty" ? 0 : 1);
  assert.notEqual(revised.invocationCommandId,original.invocationCommandId);
  assert.equal(revised.manifest.revision?.previousManifestId,original.manifest.manifestId);
  const joinEnds = f.database.authority.timelineEvents.page({ runId: parent.envelope.runId, limit: 1000 }).flatMap(({ payload }) =>
    payload.kind === "span" && payload.event.t === "span.ended" && payload.event.kind === "task" && payload.event.spanPath.startsWith(`${parent.envelope.traceId}/lookups#`) ? [payload.event] : []);
  assert.deepEqual(joinEnds.map(end => end.outcome),["done",scenario === "empty" ? "skipped" : "done"],"each lookups manifest records its own settlement once");
  assert.equal(joinEnds[0]?.ts,joinEnds[1]?.ts,"the refreshed manifest settles at the same instant as the earlier one");
  assert.deepEqual(joinEnds.map(end => end.spanPath.slice(end.spanPath.lastIndexOf("#join-") + "#join-".length)),[original.manifest.manifestId,revised.manifest.manifestId]);
  if (scenario === "blank") {
    assert.equal(revised.manifest.manifestFingerprint,original.manifest.manifestFingerprint);
    assert.deepEqual(revised.children[0],previous);
    assert.equal(revised.manifest.children[0]?.reuse?.runId,previous.run.envelope.runId);
  } else if (scenario === "empty") {
    assert.equal(f.database.authority.runs.listChildren(parent.envelope.runId).filter(child => child.envelope.parent?.edgeId === "lookups").length,1);
    assert.equal(currentDelegationManifests(f.database.authority,parent.envelope.runId).find(manifest => manifest.edgeId === "lookups")?.children.length,0);
  } else {
    assert.notEqual(revised.children[0]?.run.envelope.runId,previous.run.envelope.runId);
    assert.equal(revised.manifest.children[0]?.reuse,undefined);
    const replacement = revised.children[0]; assert.ok(replacement);
    assert.equal(Plan1Output.parse(replacement.result.result.value).providerState,"lookup");
    assert.ok(replacement.result.dependencies.some(dependency => dependency.state === "resolved"));
    assert.ok(replacement.result.dependencies.every(dependency => dependency.state !== "resolved" || dependency.checkpoint.runId === replacement.run.envelope.runId));
    if (scenario === "group") assert.deepEqual(revised.children[0]?.run.input,previous.run.input);
    else assert.equal(Plan1Input.parse(revised.children[0]?.run.input.parsed.value).emplId,"10800002");
  }
  assert.deepEqual(f.database.authority.delegationManifests.get(original.manifest.manifestId),original.manifest);
});

it("admits a new read when unchanged lookup input and records have expired observations", async () => {
  let fail = true;
  const f = await fixture(plan1ExpiringFailureStores(input => fail && input.mode === "fail"),"fail",childRevisedExpiringModules);
  await f.execution.execute(f.run,world.SIGNAL);
  await f.execution.execute(f.run,world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent?.completion?.kind === "done",JSON.stringify(f.database.authority.runs.listChildren(f.run.envelope.runId).map(run => ({ edge: run.envelope.parent?.edgeId, state: run.lifecycle.state,
    failure: run.lifecycle.state === "terminal" && run.lifecycle.failureId !== undefined ? f.database.authority.failures.get(run.lifecycle.failureId)?.summary : undefined }))));
  const original = readDelegationEvidence(f.database.authority,parent.envelope.runId,"lookups");
  const previous = original.children[0]; assert.ok(previous);
  const failed = f.database.authority.runs.listChildren(parent.envelope.runId).find(child => child.envelope.parent?.edgeId === "pages"
    && child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(failed);
  fail = false;
  assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } }).state,"applied");
  assert.equal((await f.execution.step(f.run,world.SIGNAL)).outcome.state,"done");
  f.clock.advanceWall(2000);
  await f.execution.execute(f.run,world.SIGNAL);
  const revised = readDelegationEvidence(f.database.authority,parent.envelope.runId,"lookups");
  assert.equal(revised.children.length,2);
  assert.notEqual(revised.children[0]?.run.envelope.runId,previous.run.envelope.runId);
  assert.deepEqual(revised.children[0]?.run.input,previous.run.input);
  assert.equal(revised.manifest.children[0]?.reuse,undefined);
  const replacement = revised.children[0]; assert.ok(replacement);
  const own = f.database.authority.runCheckpoints.listByItem(replacement.run.envelope.workflow,replacement.run.envelope.itemId)
    .filter(checkpoint => checkpoint.runId === replacement.run.envelope.runId);
  assert.ok(own.length > 0,"a new read must execute its own tasks");
  const observations = replacement.result.dependencies.flatMap(dependency => {
    if (dependency.state !== "resolved") return [];
    assert.equal(dependency.checkpoint.runId,replacement.run.envelope.runId);
    const reference = dependency.checkpoint;
    const checkpoint = f.database.authority.runCheckpoints.get(reference.workflowId,reference.itemId,dependency.nodeId,reference.attempt,reference.claimGeneration);
    assert.ok(checkpoint);
    return checkpoint.provenance.map(fact => f.clock.nowMs() - Date.parse(fact.source === "derived" ? fact.originalObservedAt : fact.observedAt));
  });
  assert.ok(observations.length > 0 && observations.every(age => age >= 0 && age <= 1000));
  assert.equal(Plan1Output.parse(replacement.result.result.value).providerState,"lookup");
  assert.equal(f.database.authority.runs.listChildren(parent.envelope.runId).filter(child => child.envelope.parent?.edgeId === "lookups").length,3);
  assert.deepEqual(f.database.authority.delegationManifests.get(original.manifest.manifestId),original.manifest);
});

it("retains both revised memberships through a failed retry followed by a successful retry", async () => {
  let fail = true;
  const f = await fixture(plan1ControlledFailureStores(input => fail && input.mode === "fail"),"fail",childRevisedMembershipModules);
  await f.execution.execute(f.run,world.SIGNAL);
  await f.execution.execute(f.run,world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent?.completion?.kind === "done");
  const initial = readDelegationEvidence(f.database.authority,parent.envelope.runId,"lookups");
  const revisions = [initial.manifest];
  for (const success of [false,true]) {
    const failed: RunRecord | undefined = readDelegationEvidence(f.database.authority,parent.envelope.runId,"pages").children.map(child => RunRecordSchema.parse(child.run)).find(run => run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed"); assert.ok(failed);
    fail = !success;
    assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
      requestedAt: f.clock.now().toISOString(), target: { runId: failed.envelope.runId, expectedVersion: failed.version } }).state,"applied");
    await f.execution.execute(f.run,world.SIGNAL);
    await f.execution.execute(f.run,world.SIGNAL);
    const owner = f.database.authority.runs.get(parent.envelope.runId); assert.ok(owner?.completion?.kind === "done");
    const current = readDelegationEvidence(f.database.authority,parent.envelope.runId,"lookups");
    assert.equal(current.children.length,success ? 2 : 1);
    assert.equal(current.manifest.revision?.previousManifestId,revisions.at(-1)?.manifestId);
    assert.equal(current.children[0]?.run.envelope.runId,initial.children[0]?.run.envelope.runId);
    revisions.push(current.manifest);
    for (const retained of revisions) assert.deepEqual(f.database.authority.delegationManifests.get(retained.manifestId),retained);
    assert.deepEqual(owner.envelope,parent.envelope);
  }
  assert.equal(new Set(revisions.map(manifest => manifest.manifestId)).size,3);
  assert.equal(currentDelegationManifests(f.database.authority,parent.envelope.runId).length,2);
});

it("accepts a new retry cohort while the previously awakened parent is still queued", async () => {
  let fail = true;
  const f = await fixture(plan1ControlledFailureStores(() => fail),"fail",childSettledObservationModules);
  await f.execution.execute(f.run,world.SIGNAL);
  await f.execution.step(f.run,world.SIGNAL);
  await f.execution.step(f.run,world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent?.completion?.kind === "done");
  const children = f.database.authority.runs.listChildren(parent.envelope.runId); assert.equal(children.length,2);
  for (const [index,child] of children.entries()) {
    fail = index === 0;
    assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
      requestedAt: f.clock.now().toISOString(), target: { runId: child.envelope.runId, expectedVersion: child.version } }).state,"applied");
    const waiting = f.database.authority.runs.get(parent.envelope.runId); assert.equal(waiting?.delegationRefresh?.phase,"waiting");
    assert.equal((await f.execution.step(f.run,world.SIGNAL)).outcome.state,index === 0 ? "failed" : "done");
    const ready = f.database.authority.runs.get(parent.envelope.runId); assert.ok(ready?.lifecycle.state === "queued");
    assert.equal(ready.delegationRefresh?.phase,"settled");
    assert.equal(f.database.authority.runResults.getSettlement(parent.envelope.runId,ready.version),undefined);
  }
  assert.equal((await f.execution.step(f.run,world.SIGNAL)).outcome.state,"done");
  const done = f.database.authority.runs.get(parent.envelope.runId); assert.ok(done?.completion?.kind === "done");
  assert.deepEqual(done.envelope,parent.envelope);
});

it("refuses child retry after the read-only owner's review gate is approved", async () => {
  const f = await fixture(plan1ControlledFailureStores(input => input.mode === "fail"),"fail",childSettledReviewModules);
  await f.execution.execute(f.run,world.SIGNAL);
  await f.execution.step(f.run,world.SIGNAL);
  const parked = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parked?.lifecycle.state === "parked-gate");
  const gate = descriptorRuntimeNodes(childSettledReviewModules.root.descriptor).find(node => node.id === "review"); assert.ok(gate?.kind === "gate");
  const approval = f.execution.kernel.execute({ commandId: randomUUID(), family: "gate", type: "resolve-gate", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: parked.envelope.runId, expectedVersion: parked.version, gateId: parked.lifecycle.gateId },
    payload: { result: { schemaHash: deriveSchemaHash(gate.result,"output"), value: { approved: true } } } });
  assert.equal(approval.state,"applied",JSON.stringify(approval));
  await f.execution.execute(f.run,world.SIGNAL);
  const owner = f.database.authority.runs.get(parked.envelope.runId); assert.ok(owner?.completion?.kind === "done");
  const children = f.database.authority.runs.listChildren(owner.envelope.runId), child = children[0]; assert.ok(child);
  const reply = f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard", requestedBy: "local-operator",
    requestedAt: f.clock.now().toISOString(), target: { runId: child.envelope.runId, expectedVersion: child.version } });
  assert.equal(reply.state,"rejected");
  if (reply.state === "rejected") assert.equal(reply.code,"RUN_CONTINUATION_REFUSED");
  assert.deepEqual(f.database.authority.runs.get(owner.envelope.runId),owner);
  assert.deepEqual(f.database.authority.runs.listChildren(owner.envelope.runId),children);
});
