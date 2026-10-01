import { plan1Leaf, plan1Contract } from "../../fixtures/plan1-operation-workflows.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../../src/domain/workflow/operation-display-snapshot.js";
import { createDeclaredActionBinder } from "../../../src/core/operation-action-binding.js";
import { createNoteJsonlWriter } from "../../../src/infra/events/note-jsonl-writer.js";
import { resolveOperationSource } from "../../../src/server/dashboard/queries/operation-source.js";
import { archivedRunContentDigest, type ArchivedRunRecord } from "../../../src/domain/archive/model.js";
import { historicalArchiveAuthority } from "../helpers/historical-archive-authority.js";
import { createRunLifecycleStorage } from "../../../src/core/run-lifecycle-storage.js";
import { createCommandKernel } from "../../../src/core/command-kernel.js";
import { CommandResultSchema } from "../../../src/domain/commands.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { seedSyntheticRuntimeConfig } from "../../fixtures/operator-command-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";
import { HASH_B, UUID_4 } from "../../fixtures/phase1c-contract-fixtures.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { RunRecordService, requireLifecycleApplied } from "../../../src/core/run-record-service.js";
import { manualClock } from "../../../src/domain/clock.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { listCanonicalRuns } from "../../../src/server/dashboard/queries/canonical-runs.js";
import { buildRunDetail, readRunDetail, type RunDetailQueryDeps } from "../../../src/server/dashboard/queries/run-detail.js";
import { buildArchiveIndex, buildArchivedRunDetail } from "../../../src/server/dashboard/queries/archive.js";
import { createArchiveSnapshotSource } from "../../../src/server/dashboard/queries/archive-snapshot.js";
import { deriveArchivedRunRecord } from "../../../src/services/archive/archive-service.js";
import { archivedRunReferenceFingerprint } from "../../../src/domain/archive/model.js";
import { archiveQueryDeps } from "../../fixtures/archive-seams.js";
import { VERSION_PLAN_ROW, VERSION_BUMP_APPLICATION } from "../../fixtures/archive-fixtures.js";
import { sqliteRunReader } from "../../helpers/canonical-run-reader.js";
import { AT, DAY, makeWorld, queuedEventOf, runRecordOf, uuidOf } from "../../unit/server/helpers/dashboard-harness.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function fixture(historical=false) {
  const root = mkdtempSync(join(tmpdir(), "canonical-operator-"));
  cleanups.push(() => rmSync(root, { recursive: true }));
  const clock = manualClock(AT);
  const database = historical ? historicalArchiveAuthority(join(root,"authority.sqlite"),clock) : AuthorityDatabase.open({ path: join(root, "authority.sqlite"), migrationOwner: "unit-test", busyTimeoutMs: 250 }, clock);
  cleanups.push(() => database.close());
  const realReader = sqliteRunReader(database, clock);
  let listCalls = 0, treeCalls = 0;
  const reader: typeof realReader = {
    read: (id) => realReader.read(id),
    withRunTreeSnapshot: (ids, work) => { treeCalls += 1; return realReader.withRunTreeSnapshot(ids, work); },
    list: (input) => { listCalls += 1; return realReader.list(input); },
  };
  const world = makeWorld({ reader });
  cleanups.push(() => world.dispose());
  const service = new RunRecordService({ database, clock,
    ids: { uuid: () => { throw new Error("read fixture cannot create identities"); } },
    publishQueued: () => { throw new Error("this proof must not publish spans"); },
  });
  const detailDeps: RunDetailQueryDeps = { stateRoot: world.stateRoot,
    projection: world.projection, runReader: reader, authority: world.authority,
    descriptors: { resolve: () => undefined },
    canonical: { reader, database, descriptors: { resolve: () => undefined } },
  };
  const detail = (runId: string) => buildRunDetail(detailDeps, runId);
  return { root, database, reader, world, service, detail, detailDeps, clock,
    listCalls: () => listCalls, treeCalls: () => treeCalls, resetListCalls: () => { listCalls = 0; treeCalls = 0; },
  };
}

it.each(["single", "operation-member"] as const)("freezes a spanless canonical %s and converges live/archive/deleted views without reconstructing evidence", async (shape) => {
  const f = fixture(true);
  const parent = shape === "operation-member" ? runRecordOf({ seed: 412, shape: "operation" }) : undefined;
  if (parent !== undefined) f.database.authority.runs.enqueue(parent);
  const run = runRecordOf({ seed: 409, shape, ...(parent === undefined ? {} : { parentSeed: 412 }) });
  f.database.authority.runs.enqueue(run);
  assert.equal((await readRunDetail(f.detailDeps, run.envelope.runId)).header.status, "queued");
  const terminal = requireLifecycleApplied(f.service.transition({ commandId: uuidOf(6409),
    runId: run.envelope.runId, expectedVersion: run.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT.toISOString() },
  }));
  const frozen = createArchiveSnapshotSource(f.detailDeps).snapshot(run.envelope.runId);
  assert.equal(frozen.row.status, "cancelled");
  assert.equal(frozen.row.actorId, undefined);
  assert.deepEqual(frozen.detail.timeline.events, []);
  assert.equal(frozen.sections.attempts.state, "absent");
  const archive = f.database.withAuthorityTransaction((repositories) => {
    repositories.versionPlans.insert(VERSION_PLAN_ROW);
    repositories.versionBumpApplications.insert({ ...VERSION_BUMP_APPLICATION,
      archivedRunIds: [run.envelope.runId] });
    return deriveArchivedRunRecord({ repositories, run: terminal, snapshot: frozen,
      applicationId: VERSION_BUMP_APPLICATION.applicationId, drift: ["descriptor-version"],
      archivedBy: "local-operator", archivedAt: AT.toISOString(),
      workflowLabel: undefined, workflowCode: undefined,
    });
  });
  requireLifecycleApplied(f.service.archive({ commandId: uuidOf(7409), expectedVersion: terminal.version, archive }));
  const queries = archiveQueryDeps({ database: f.database, clock: f.clock, appVersion: "0.1.0",
    descriptors: [], stateRoot: f.world.stateRoot });
  const assertCurrentCount = (expected: number) => {
    const day = f.world.projection.buildDashboardDayWire(DAY);
    assert.equal(day.queueSurfaces.length, expected);
    assert.equal(day.workflowCounts.reduce((total, entry) => total + entry.count, 0), expected);
    assert.equal(day.statusCounts.reduce((total, entry) => total + entry.count, 0), expected);
    assert.equal(day.monthCounts.reduce((total, entry) => total + entry.count, 0), expected);
    assert.equal(f.world.projection.buildActivityReportWire(DAY, DAY).totalRuns, expected);
  };
  assertCurrentCount(parent === undefined ? 0 : 1);
  if (parent !== undefined) {
    const row = f.world.projection.queueSurface(parent.envelope.runId);
    assert.ok(row?.surfaceKind === "operation");
    assert.deepEqual(row.memberRollup, { total: 0, terminal: 0, failed: 0 });
    assert.deepEqual(row.memberRunIds, []);
  }
  assert.equal(buildArchiveIndex(queries).entries.length, 1);
  assert.throws(() => f.detail(run.envelope.runId), /archived/);
  const readback = buildArchivedRunDetail(queries, run.envelope.runId);
  assert.equal(readback.row.status, "cancelled");
  assert.deepEqual(readback.detail.timeline.events, []);
  assert.equal(JSON.stringify(f.database.authority.archivedRuns.get(run.envelope.runId)), JSON.stringify(archive));
  const deletion = f.service.deleteArchived({ commandId: uuidOf(8409), runId: run.envelope.runId,
    archiveFingerprint: archivedRunReferenceFingerprint(archive) });
  if (parent === undefined) assert.equal(deletion.state, "deleted");
  else {
    assert.deepEqual(deletion, { state: "refused", refusal: { reason: "is-member" } });
    const settled = requireLifecycleApplied(f.service.transition({ commandId: uuidOf(8412),
      runId: parent.envelope.runId, expectedVersion: parent.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT.toISOString() },
    }));
    assert.equal(f.service.delete({ commandId: uuidOf(9412), runId: parent.envelope.runId,
      expectedVersion: settled.version }).state, "deleted");
  }
  assertCurrentCount(0);
  assert.equal(buildArchiveIndex(queries).entries.length, 0);
  assert.throws(() => buildArchivedRunDetail(queries, run.envelope.runId), /deleted/);
  assert.equal(f.world.projection.runFold(run.envelope.runId), undefined);
});

it("reads a real canonical run without any spans through queue, detail, Activity and polling", async () => {
  const f = fixture();
  const run = runRecordOf({ seed: 401 });
  f.database.authority.runs.enqueue(run);
  assert.equal(f.world.projection.runFold(run.envelope.runId), undefined);
  assert.equal(f.world.projection.queueSurface(run.envelope.runId)?.status, "queued");
  const detail = f.detail(run.envelope.runId);
  assert.equal(detail.header.status, "queued");
  assert.equal(detail.header.actorId, undefined);
  assert.deepEqual(detail.timeline.events, []);
  assert.equal(detail.header.title, run.envelope.runId);
  const asynchronous = await readRunDetail(f.detailDeps, run.envelope.runId);
  assert.deepEqual(asynchronous.header, detail.header);
  assert.equal(asynchronous.captures?.state, "absent");
  assert.equal(f.world.projection.buildDashboardDayWire(DAY).queueSurfaces.length, 1);
  assert.equal(f.world.projection.buildActivityReportWire(DAY, DAY).totalRuns, 1);
  const before = f.world.changes.length;
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, before + 1);
  assert.equal(f.world.changes.at(-1)?.kind, "snapshot");
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, before + 1, "unchanged authority must not churn snapshots");
});

it("does not resurrect absent or deleted canonical runs from retained spans", () => {
  const f = fixture();
  const queued = queuedEventOf(f.world, { seed: 402 });
  assert.equal(f.reader.read(queued.runId).state, "absent");
  assert.equal(f.world.projection.queueSurface(queued.runId), undefined);
  assert.throws(() => f.detail(queued.runId), /is absent/);
  const run = runRecordOf({ seed: 402 });
  f.database.authority.runs.enqueue(run);
  const terminal = requireLifecycleApplied(f.service.transition({ commandId: uuidOf(1402),
    runId: run.envelope.runId, expectedVersion: run.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT.toISOString() },
  }));
  assert.equal(f.world.projection.queueSurface(queued.runId)?.status, "cancelled");
  assert.equal(f.service.delete({ commandId: uuidOf(2402), runId: queued.runId, expectedVersion: terminal.version }).state, "deleted");
  assert.equal(f.reader.read(queued.runId).state, "deleted");
  assert.notEqual(f.world.projection.runFold(queued.runId), undefined, "evidence survives deletion");
  assert.equal(f.world.projection.queueSurface(queued.runId), undefined);
  assert.deepEqual(f.world.projection.buildDashboardDayWire(DAY).queueSurfaces, []);
  assert.throws(() => f.detail(queued.runId), /is deleted/);
});

it("refuses a real generation change between canonical list pages instead of mixing generations", () => {
  const f = fixture();
  f.database.withAuthorityTransaction((repositories) => {
    for (let seed = 1; seed <= 1001; seed++) repositories.runs.enqueue(runRecordOf({ seed }));
  });
  assert.equal(listCanonicalRuns(f.reader, "live").length, 1001, "positive control spans both pages");
  let calls = 0;
  assert.throws(() => listCanonicalRuns({ list(input) {
    const page = f.reader.list(input);
    if (++calls === 1) f.database.authority.runs.enqueue(runRecordOf({ seed: 2001 }));
    return page;
  } }, "live"), /cursor-stale/);
  assert.equal(calls, 2);
});

it("moves a claimed run back to the queue and preserves its canonical attempt without a requeue span", () => {
  const f = fixture();
  const run = runRecordOf({ seed: 410 });
  f.database.authority.runs.enqueue(run);
  const claim = f.database.authority.runs.claimNext({ workflow: run.envelope.workflow,
    workerId: "person-lookup-worker-1", now: AT.toISOString() });
  assert.equal(claim.state, "claimed");
  if (claim.state !== "claimed") throw new Error("claim positive control failed");
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.detail(run.envelope.runId).header.status, "running");
  const before = f.world.changes.length;
  const outcome = f.service.requeue({ commandId: uuidOf(6410), runId: run.envelope.runId,
    expectedVersion: claim.run.version, claim: { workerId: "person-lookup-worker-1", claimGeneration: 1 },
    cause: "recovery",
  });
  assert.equal(outcome.state, "applied");
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, before + 1);
  const detail = f.detail(run.envelope.runId);
  assert.equal(detail.header.status, "queued");
  assert.equal(detail.header.attempt, run.envelope.attempt);
  const day = f.world.projection.buildDashboardDayWire(DAY);
  assert.deepEqual(day.statusCounts, [{ status: "queued", count: 1 }]);
  assert.equal(day.queueSurfaces[0]?.attempt, run.envelope.attempt);
  assert.equal(f.world.projection.buildActivityReportWire(DAY, DAY).totalRuns, 1);
  assert.equal(f.world.projection.runFold(run.envelope.runId), undefined);
});


it("publishes cancellation and rename without spans, while a pure claim heartbeat does not churn snapshots", () => {
  const f = fixture();
  const run = runRecordOf({ seed: 403 });
  f.database.authority.runs.enqueue(run);
  assert.equal(f.database.authority.runs.claimNext({ workflow: run.envelope.workflow,
    workerId: "person-lookup-worker-1", now: AT.toISOString(),
  }).state, "claimed");
  const named = runRecordOf({ seed: 408 });
  f.database.authority.runs.enqueue(named);
  f.world.projection.reconcileWorkerAuthority();
  const initial = f.world.changes.length;
  f.clock.advanceWall(1_000);
  const renewed = requireLifecycleApplied(f.service.renewClaim({ commandId: uuidOf(3403),
    runId: run.envelope.runId, claim: { workerId: "person-lookup-worker-1", claimGeneration: 1 },
  }));
  assert.ok(renewed.version > run.version);
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, initial, "heartbeat alone is not an operator change");
  const cancelling = requireLifecycleApplied(f.service.transition({ commandId: uuidOf(4403),
    runId: run.envelope.runId, expectedVersion: renewed.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.clock.now().toISOString() },
  }));
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, initial + 1);
  assert.equal(f.detail(run.envelope.runId).header.status, "cancelling");
  const surface = f.world.projection.queueSurface(run.envelope.runId);
  assert.equal(surface?.status, "cancelling");
  assert.equal(surface?.endedAt.state, "absent");
  requireLifecycleApplied(f.service.transition({ commandId: uuidOf(5403),
    runId: named.envelope.runId, expectedVersion: named.version, displayName: "Queued work under review",
  }));
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, initial + 2);
  assert.deepEqual(f.world.projection.queueSurface(named.envelope.runId)?.displayName, { state: "present", value: "Queued work under review" });
  assert.equal(cancelling.cancelRequested, true);
});


it("counts zero, one and multiple spanless members and removes the settled tree through canonical deletion", () => {
  const f = fixture();
  const parent = runRecordOf({ seed: 404, shape: "operation" });
  f.database.authority.runs.enqueue(parent);
  const rollup = () => {
    const row = f.world.projection.queueSurface(parent.envelope.runId);
    assert.ok(row?.surfaceKind === "operation");
    return row.memberRollup;
  };
  assert.deepEqual(rollup(), { total: 0, terminal: 0, failed: 0 });
  const member = runRecordOf({ seed: 405, parentSeed: 404, shape: "operation-member" });
  f.database.authority.runs.enqueue(member);
  assert.deepEqual(rollup(), { total: 1, terminal: 0, failed: 0 });
  const child = runRecordOf({ seed: 406, parentSeed: 404, shape: "operation-member" });
  f.database.authority.runs.enqueue(child);
  const terminal = requireLifecycleApplied(f.service.transition({ commandId: uuidOf(7406),
    runId: child.envelope.runId, expectedVersion: child.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT.toISOString() },
  }));
  f.database.authority.runs.enqueue(runRecordOf({ seed: 407, parentSeed: 404, shape: "single" }));
  assert.deepEqual(rollup(), { total: 2, terminal: 1, failed: 0 });
  assert.equal(f.world.projection.queueSurface(parent.envelope.runId)?.linkedRuns.length, 1);
  assert.equal(f.world.projection.buildActivityReportWire(DAY, DAY).totalRuns, 2, "members count inside their operation");
  assert.deepEqual(f.service.delete({ commandId: uuidOf(6406), runId: terminal.envelope.runId, expectedVersion: terminal.version }),
    { state: "refused", refusal: { reason: "is-member" } });
  assert.deepEqual(rollup(), { total: 2, terminal: 1, failed: 0 });
  for (const seed of [405, 407, 404]) requireLifecycleApplied(f.service.transition({
    commandId: uuidOf(seed + 8000), runId: uuidOf(seed), expectedVersion: 1,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT.toISOString() },
  }));
  assert.equal(f.service.delete({ commandId: uuidOf(9404), runId: parent.envelope.runId, expectedVersion: 2 }).state, "deleted");
  assert.equal(f.world.projection.queueSurface(parent.envelope.runId), undefined);
  assert.deepEqual(f.world.projection.buildDashboardDayWire(DAY).queueSurfaces, []);
  assert.equal(f.world.projection.buildActivityReportWire(DAY, DAY).totalRuns, 0);
});

it.each([
  { order: "child first", parentSeed: 412, childSeed: 409, extraRuns: 0 },
  { order: "parent first", parentSeed: 409, childSeed: 412, extraRuns: 0 },
  { order: "child first, larger batch", parentSeed: 412, childSeed: 409, extraRuns: 18 },
])("freezes complete membership with one canonical enumeration: $order", ({ parentSeed, childSeed, extraRuns }) => {
  const f = fixture();
  seedSyntheticRuntimeConfig(f.database);
  const parent = runRecordOf({ seed: parentSeed, shape: "operation" });
  const child = runRecordOf({ seed: childSeed, shape: "operation-member", parentSeed });
  const runs = [parent, child, ...Array.from({ length: extraRuns }, (_, index) => runRecordOf({ seed: 500 + index }))];
  for (const [index, run] of runs.entries()) {
    f.database.authority.runs.enqueue(run);
    requireLifecycleApplied(f.service.transition({
      commandId: uuidOf(6400 + index), runId: run.envelope.runId,
      expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT.toISOString() },
    }));
  }
  const kernel = createCommandKernel({
    lifecycle: f.service, authority: { withAuthorityTransaction: work => f.database.withAuthorityTransaction(work) },
    clock: f.clock, ids: sequentialIdFactory("a"), appVersion: "0.1.0",
    descriptors: { resolve: id => id === "person-lookup" ? personLookupDescriptor : undefined },
    archiveSnapshots: createArchiveSnapshotSource(f.detailDeps),
    configIdentity: { configFingerprint: HASH_B, configSnapshotId: UUID_4 },
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: { resolvePresent: () => { throw new Error("unused"); }, resolveAbsent: () => { throw new Error("unused"); } },
    workerRuntime: { planWorkerCount: () => { throw new Error("unused"); }, spawnWorker: () => { throw new Error("unused"); },
      refreshBrowser: () => { throw new Error("unused"); }, reopenBrowser: () => { throw new Error("unused"); } },
  });
  const envelope = { requestedAt: AT.toISOString(), requestedBy: "local-operator", source: "archive", family: "version-archive" };
  const planned = CommandResultSchema.parse(kernel.execute({ ...envelope, commandId: uuidOf(7501), type: "plan-version-bump",
    target: { scope: { kind: "workflows", workflowIds: ["person-lookup"] } }, payload: {
      targetVersion: "0.2.0", changeFingerprint: HASH_B,
      changeRecord: { kind: "major", what: "Archive synthetic prior-version parent and child", why: "Prove archive ordering preserves frozen membership",
        commit: { state: "absent", reason: "synthetic archive batch regression" } },
    },
  }));
  assert.equal(planned.state, "applied", JSON.stringify(planned));
  if (planned.state !== "applied") throw new Error("plan not applied");
  const target = planned.affectedTargets.find(value => value.family === "version-archive");
  assert.ok(target?.family === "version-archive");
  const plan = f.database.readVersionChange(target.versionPlanId); assert.ok(plan);
  f.resetListCalls();
  const applied = CommandResultSchema.parse(kernel.execute({ ...envelope, commandId: uuidOf(7502), type: "apply-version-bump",
    target: { versionPlanId: plan.changeId, expectedVersion: 1 }, payload: { planFingerprint: plan.reviewFingerprint },
  }));
  assert.equal(applied.state, "applied", JSON.stringify(applied));
  for (const run of runs) {
    const existence = f.reader.read(run.envelope.runId);
    assert.ok(existence.state === "present" && existence.disposition === "archived");
  }
  const frozen = createRunLifecycleStorage(f.database).readReport(parent.envelope.runId); assert.ok(frozen);
  const section = frozen.content.sections.find(section => section.title === "Displayed run"); assert.ok(section?.kind === "values");
  const value = (label: string) => section.values.find(cell => cell.label === label)?.value;
  assert.equal(value("row.surfaceKind"), "operation");
  assert.equal(value("row.memberRunIds.0"), child.envelope.runId);
  assert.equal(value("row.memberRollup.total"), 1);
  assert.equal(value("row.memberRollup.terminal"), 1);
  assert.equal(value("row.memberRollup.failed"), 0);
  assert.equal(value("sections.people.state"), "present");
  assert.equal(value("sections.people.value.total"), 1);
  assert.equal(value("sections.people.value.members.0.runId"), child.envelope.runId);
  assert.equal(value("sections.people.value.members.0.parentRunId"), parent.envelope.runId);
  assert.equal(value("sections.people.value.members.0.status"), "cancelled");
  assert.equal(f.listCalls(), 0, "archive capture must not enumerate whole history");
  assert.equal(f.treeCalls(), 1, "archive batch shares one canonical selected-tree snapshot");
});

it("does not enumerate authority for an empty archive batch and refuses absent candidates", () => {
  const f = fixture();
  const snapshots = createArchiveSnapshotSource(f.detailDeps);
  f.resetListCalls();
  assert.equal(snapshots.snapshotBatch([]).size, 0);
  assert.equal(f.listCalls(), 0);
  assert.throws(() => snapshots.snapshotBatch([uuidOf(409)]), /no live canonical row/);
});


it("freezes all exact local action observations across pages, reopens archive authority and refuses corrupt or missing historical evidence", () => {
  const f = fixture(true);
  const definition = freezeWorkflowOperationDisplaySnapshot({ workflowId: plan1Leaf.descriptor.id, definitionFingerprint: plan1Leaf.descriptor.contractFingerprint, display: plan1Leaf.descriptor.operationDisplay });
  assert.ok(definition);
  const base = runRecordOf({ seed: 819 });
  const run = { ...base, claimGeneration: 1, envelope: { ...base.envelope, workflow: plan1Leaf.descriptor.id, contractFingerprint: plan1Leaf.descriptor.contractFingerprint, operationDisplayCapability: "complete" as const, operationDisplaySnapshot: definition } };
  f.database.authority.runs.enqueue(run);
  const binder = createDeclaredActionBinder({ snapshot: definition, runId: run.envelope.runId, attempt: 1, claimGeneration: 1, taskAttempt: 1, nodeId: "first", taskId: plan1Contract.id, contractRole: "task", parsedInput: { emplId: "10800000", text: "same", mode: "ok" }, protectedBindings: [] });
  const writer = createNoteJsonlWriter({ stateRoot: f.world.stateRoot, clock: f.clock, pid: 4242 });
  let occurrence;
  for (let index = 0; index < 301; index++) {
    const action = binder({ at: f.clock.now().toISOString(), kind: "read", targetId: "read-provider-state", value: "same", declaredActionId: "read-provider-state" });
    occurrence = action.operation;
    writer.emitRunAction({ workflow: run.envelope.workflow, address: { runId: run.envelope.runId, attempt: 1, traceId: run.envelope.traceId, spanPath: `${run.envelope.traceId}/first#1` }, action }, run);
  }
  assert.ok(occurrence);
  const { value: _value, ...identity } = occurrence;
  const terminal = requireLifecycleApplied(f.service.transition({ commandId: uuidOf(6819), runId: run.envelope.runId, expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.clock.now().toISOString() } }));
  const frozen = createArchiveSnapshotSource(f.detailDeps).snapshot(run.envelope.runId);
  assert.equal(frozen.sections.logs.state, "present");
  if (frozen.sections.logs.state !== "present") throw new Error("fixture logs missing");
  assert.equal(frozen.sections.logs.value.operationStructure?.state, "observed");
  if (frozen.sections.logs.value.operationStructure?.state !== "observed") throw new Error("fixture structure missing");
  assert.equal(frozen.sections.logs.value.operationStructure.observations.length, 301);
  assert.deepEqual(frozen.sections.logs.value.operationStructure.observations.map((observation) => observation.occurrence.occurrence), Array.from({ length: 301 }, (_, index) => index + 1));
  const archive = f.database.withAuthorityTransaction((repositories) => {
    repositories.versionPlans.insert(VERSION_PLAN_ROW);
    repositories.versionBumpApplications.insert({ ...VERSION_BUMP_APPLICATION, archivedRunIds: [run.envelope.runId] });
    return deriveArchivedRunRecord({ repositories, run: terminal, snapshot: frozen, applicationId: VERSION_BUMP_APPLICATION.applicationId, drift: ["descriptor-version"], archivedBy: "local-operator", archivedAt: f.clock.now().toISOString(), workflowLabel: undefined, workflowCode: undefined });
  });
  requireLifecycleApplied(f.service.archive({ commandId: uuidOf(7819), expectedVersion: terminal.version, archive }));
  f.database.close();
  const reopened = historicalArchiveAuthority(join(f.root, "authority.sqlite"), f.clock);
  cleanups.push(() => reopened.close());
  const deps = { ...f.detailDeps, runReader: sqliteRunReader(reopened, f.clock), canonical: { ...f.detailDeps.canonical, database: reopened } } as RunDetailQueryDeps;
  assert.equal(resolveOperationSource(deps, run.envelope.runId, { identity }).state, "found");
  const held = reopened.authority.archivedRuns.get(run.envelope.runId);
  assert.ok(held);
  const withArchive = (record: ArchivedRunRecord): RunDetailQueryDeps => ({ ...deps, canonical: { ...deps.canonical, database: { ...reopened, withAuthorityReadSnapshot: (work: () => unknown) => work(), authority: { ...reopened.authority, runResults: reopened.authority.runResults, archivedRuns: { get: () => record } } } } } as unknown as RunDetailQueryDeps);
  assert.throws(() => resolveOperationSource(withArchive({ ...held, contentDigest: "0".repeat(64) }), run.envelope.runId, { identity }), /archive-digest/u);
  const { contentDigest: _digest, ...content } = held;
  const { operationStructure: _structure, ...oldLogs } = frozen.sections.logs.value;
  const historic = { ...content, sections: { ...content.sections, logs: { state: "present" as const, value: oldLogs } } };
  const absent = { ...historic, contentDigest: archivedRunContentDigest(historic) } as ArchivedRunRecord;
  assert.equal(resolveOperationSource(withArchive(absent), run.envelope.runId, { identity }).state, "unavailable");
});
