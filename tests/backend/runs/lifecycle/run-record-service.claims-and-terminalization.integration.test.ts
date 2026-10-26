import { randomUUID } from "node:crypto";
import { childPolicyModules } from "../../../support/fixtures/child-execution-workflows.js";
import { plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { testAdmittedWorker, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { CANONICAL_WORKER_ID as WORKER_ID, createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { deriveTerminalFailureDigest } from "../../../../src/models/run/result.js";
import { CONFIG_SNAPSHOT, GATE_RESULT, HASH_A, LATER, NOW, UUID_5, UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const {fixture, created, runningRun, parkedWriteIntent, failureTerminalRequest, cleanup } = createRunRecordServiceTestWorld();

const executorWorld = createRunExecutorTestWorld();
afterEach(cleanup);
afterEach(executorWorld.cleanup);

describe("canonical run-record service", () => {

  it("#1 reserves distinct monotonically increasing item and workflow ordinals", () => {
    const { service, request, database, published } = fixture();
    const before = database.getMeta().authorityGeneration;
    const runs = Array.from({ length: 5 }, (_, index) => created(service, {
      ...request, commandId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    assert.deepEqual(runs.map((run) => run.envelope.attempt), [1, 2, 3, 4, 5]);
    assert.deepEqual(runs.map((run) => run.runNumber), [1, 2, 3, 4, 5]);
    assert.equal(new Set(runs.map((run) => run.envelope.runId)).size, 5);
    assert.equal(database.getMeta().authorityGeneration, before + 5);
    assert.equal(published.length, 5);
  });

  it("#3 refuses a missing parent and retry source without reserving ordinals", () => {
    const { service, request, database } = fixture();
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(service.create({ ...request, parent: { runId: UUID_5, tracePrefix: "pl-170000-5555", edgeId: "member" } }),
      { state: "refused", refusal: { reason: "parent-missing" } });
    assert.deepEqual(service.create({ ...request, retryOf: UUID_5 }),
      { state: "refused", refusal: { reason: "retry-of-missing" } });
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.equal(created(service, request).envelope.attempt, 1);
  });

  it("refuses an absent runtime token and preserves queued authority", () => {
    const { service, request, database } = fixture();
    const run = created(service, request);
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID, workerId: WORKER_ID }),
      { state: "refused", refusal: { reason: "runtime-stale" } });
    assert.deepEqual(service.read(run.envelope.runId), { state: "present", disposition: "live", run });
    assert.equal(database.getMeta().authorityGeneration, before);
  });

  it("#4 grants a queued row once and refuses a busy worker", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const run = created(service, request);
    const first = service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID, workerId: WORKER_ID, workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime, runtimeConfig });
    assert.equal(first.state, "applied");
    if (first.state !== "applied") throw new Error("claim refused");
    assert.equal(first.run.envelope.runId, run.envelope.runId);
    assert.equal(first.run.claimGeneration, 1);
    assert.equal(first.run.version, 2);
    assert.deepEqual(service.claimNext({ commandId: "50000000-0000-4000-8000-000000000010", workflow: WORKFLOW_ID, workerId: WORKER_ID, workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime, runtimeConfig }),
      { state: "refused", refusal: { reason: "worker-busy", runId: run.envelope.runId } });
  });

  it("#4 claims the first eligible row after dependency filtering and total ordering", async () => {
    const { root: compiled, modules } = childPolicyModules("cascade");
    const h = executorWorld.executorHarness({ descriptor: compiled.descriptor, stores: plan1Stores });
    const { database, clock, path } = h.authority;
    const execution = canonicalChildExecution(h.deps, database, path,
      id => modules.find(module => module.descriptor.id === id)?.descriptor);
    const service = execution.lifecycle;
    const blocked = execution.start(compiled.descriptor, { emplId: "10800000", text: "same", mode: "ok" }, { dryRun: false });
    assert.equal((await execution.step(blocked, executorWorld.SIGNAL)).outcome.state, "yielded-delegation");
    const children = database.authority.runs.listChildren(blocked.envelope.runId);
    assert.equal(children.length, 1);
    const child = children[0]; assert.ok(child);
    assert.equal(database.authority.dependencies.readiness(blocked.envelope.runId, "join").state, "waiting");
    const parent = database.authority.runs.get(blocked.envelope.runId); assert.ok(parent);
    assert.equal(parent.lifecycle.state, "queued");
    assert.equal(parent.envelope.priority, "interactive");
    const active = database.authority.runtimeConfig.get(); assert.ok(active);
    const runtimeConfig = { generation: active.generation, settingsRevision: active.settingsRevision,
      settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint };
    const firstOwner = testWorkerLifetime(database, compiled.descriptor.id, 1);
    const childClaim = service.claimNext({ commandId: randomUUID(), workflow: compiled.descriptor.id,
      workerId: firstOwner.workerId, workerLifetime: firstOwner.workerLifetime, runtimeConfig });
    assert.equal(childClaim.state, "applied");
    assert.ok("run" in childClaim);
    assert.equal(childClaim.run.envelope.runId, child.envelope.runId);
    assert.equal(childClaim.run.lifecycle.state, "claimed");
    assert.ok("workerLifetime" in childClaim.run.lifecycle);
    assert.deepEqual(childClaim.run.lifecycle.workerLifetime, firstOwner.workerLifetime);
    const request = { commandId: randomUUID(), code: compiled.descriptor.code, matchKey: "claim-order",
      workflow: compiled.descriptor.id, descriptorVersion: compiled.descriptor.version,
      contractFingerprint: compiled.descriptor.contractFingerprint, configFingerprint: blocked.envelope.configFingerprint,
      configSnapshotId: blocked.envelope.configSnapshotId, resolvedInstance: blocked.envelope.resolvedInstance,
      priority: blocked.envelope.priority, shape: blocked.envelope.shape, dryRun: false,
      input: blocked.input, runtimeConfig };
    const olderBulk = created(service, {
      ...request,
      commandId: "51000000-0000-4000-8000-000000000006",
      matchKey: "claim-older-bulk",
      priority: "bulk",
    });
    const newerInteractive = created(service, {
      ...request,
      commandId: "51000000-0000-4000-8000-000000000007",
      matchKey: "claim-newer-interactive",
      priority: "interactive",
    });

    const owner = testAdmittedWorker(database, clock, { path, workflow: compiled.descriptor.id, poolIndex: 2, browserSystems: [] });
    const generation = database.getMeta().authorityGeneration;
    const claim = service.claimNext({
      commandId: "51000000-0000-4000-8000-000000000008",
      workflow: compiled.descriptor.id,
      workerId: owner.workerId,
      workerLifetime: owner.workerLifetime,
      runtimeConfig,
    });
    assert.equal(claim.state, "applied");
    if (claim.state !== "applied") throw new Error("eligible claim refused");
    assert.equal(claim.run.envelope.runId, newerInteractive.envelope.runId);
    assert.equal(service.read(blocked.envelope.runId).state, "present");
    assert.equal(service.read(olderBulk.envelope.runId).state, "present");
    assert.deepEqual(database.authority.runs.get(blocked.envelope.runId), parent);
    assert.deepEqual(database.authority.runs.get(olderBulk.envelope.runId), olderBulk);
    assert.equal(database.getMeta().authorityGeneration, generation + 1);
    assert.equal(execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "cancel", source: "dashboard",
      requestedBy: "local-operator", requestedAt: clock.now().toISOString(),
      target: { runId: child.envelope.runId, expectedVersion: childClaim.run.version },
    }).state, "applied");
    const requestedChild = database.authority.runs.get(child.envelope.runId); assert.ok(requestedChild);
    assert.equal(requestedChild.cancelRequested, true);
    const childDescriptor = modules.find(module => module.descriptor.id === child.envelope.workflow)?.descriptor;
    assert.ok(childDescriptor);
    assert.equal(service.terminalize({ kind: "cancelled", commandId: randomUUID(), runId: child.envelope.runId,
      expectedVersion: requestedChild.version, claim: { workerId: firstOwner.workerId, claimGeneration: childClaim.run.claimGeneration },
      endedAt: clock.now().toISOString() }, childDescriptor).state, "applied");
    assert.equal(database.authority.dependencies.readiness(blocked.envelope.runId, "join").state, "ready");
  });

  it("#25 preserves spent attempt and run number after deleting the highest row", () => {
    const { service, request, database, runtimeConfig } = fixture();
    const source = created(service, {
      ...request,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    });
    const settledSource = service.transition({ commandId: UUID_5, runId: source.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    assert.equal(settledSource.state, "applied");
    const highest = created(service, {
      ...request,
      commandId: "30000000-0000-4000-8000-000000000001",
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    });
    assert.equal(highest.envelope.attempt, 2);
    assert.equal(highest.runNumber, 2);
    const settledHighest = service.transition({
      commandId: "30000000-0000-4000-8000-000000000002",
      runId: highest.envelope.runId,
      expectedVersion: highest.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(settledHighest.state, "applied");
    const deleted = service.delete({ commandId: "30000000-0000-4000-8000-000000000003",
      runId: highest.envelope.runId, expectedVersion: 2 });
    assert.equal(deleted.state, "deleted");
    const tombstone = database.authority.deletedRuns.get(highest.envelope.runId);
    assert.equal(tombstone?.attempt, 2);
    assert.equal(tombstone?.runNumber, 2);
    assert.equal(tombstone?.ordinalSource, "tombstone");
    const next = service.retry({
      commandId: "30000000-0000-4000-8000-000000000004",
      runId: source.envelope.runId,
      expectedVersion: 2,
      runtimeConfig,
    }, personLookupDescriptor);
    assert.equal(next.state, "applied");
    if (next.state !== "applied") throw new Error("retry after highest tombstone refused");
    assert.equal(next.run.envelope.attempt, 3);
    assert.equal(next.run.runNumber, 3);
    assert.equal(service.read(highest.envelope.runId).state, "deleted");
  });

  it("persists a cancellation request without changing the claimed lifecycle or fence", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const run = created(service, request);
    const claim = service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID, workerId: WORKER_ID, workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime, runtimeConfig });
    if (claim.state !== "applied") throw new Error("claim refused");
    const cancelled = service.transition({ commandId: "40000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId, expectedVersion: claim.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    assert.equal(cancelled.state, "applied");
    if (cancelled.state !== "applied") throw new Error("cancel request refused");
    assert.deepEqual(cancelled.run, { ...claim.run, cancelRequested: true, version: claim.run.version + 1 });
    const renewed = service.renewClaim({ commandId: "40000000-0000-4000-8000-000000000002",
      runId: run.envelope.runId, claim: { workerId: WORKER_ID, claimGeneration: 1 } });
    assert.equal(renewed.state, "applied");
    if (renewed.state !== "applied") throw new Error("renew refused");
    assert.equal(renewed.run.cancelRequested, true);
    assert.equal(renewed.run.lifecycle.state, "claimed");
  });

  it("#5 a generation advance refuses the next claim without invalidating the held claim", () => {
    const { service, request, runtimeConfig, database, clock } = fixture();
    const run = created(service, request);
    const queued = created(service, {
      ...request,
      commandId: "50000000-0000-4000-8000-000000000009",
      matchKey: "stale-runtime-queued",
    });
    const claim = service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID, workerId: WORKER_ID, workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime, runtimeConfig });
    if (claim.state !== "applied") throw new Error("claim refused");
    database.authority.runtimeConfig.activate({ settingsRevision: 2, settingsFingerprint: HASH_A,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint,
      activatedAt: NOW });
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(service.claimNext({ commandId: "50000000-0000-4000-8000-000000000001",
      workflow: WORKFLOW_ID, workerId: WORKER_ID, workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime, runtimeConfig }),
    { state: "refused", refusal: { reason: "runtime-stale" } });
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.deepEqual(service.read(run.envelope.runId), { state: "present", disposition: "live", run: claim.run });
    assert.deepEqual(service.read(queued.envelope.runId), { state: "present", disposition: "live", run: queued });
    clock.advanceWall(1000);
    const renewed = service.renewClaim({ commandId: "50000000-0000-4000-8000-000000000002",
      runId: run.envelope.runId, claim: { workerId: WORKER_ID, claimGeneration: 1 } });
    assert.equal(renewed.state, "applied");
  });

  it("#6/#7 requeues only an expired claim, preserves its attempt/fence, and rejects the zombie", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const run = created(service, request);
    const claim = service.claimNext({
      commandId: "83000000-0000-4000-8000-000000000001",
      workflow: WORKFLOW_ID,
      workerId: WORKER_ID,
      workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime,
      runtimeConfig,
    });
    if (claim.state !== "applied") throw new Error("claim refused");
    const beforeLive = database.getMeta().authorityGeneration;
    assert.deepEqual(service.requeue({
      commandId: "83000000-0000-4000-8000-000000000002",
      runId: run.envelope.runId,
      expectedVersion: claim.run.version,
      cause: "recovery",
      staleBefore: NOW,
    }), { state: "refused", refusal: { reason: "heartbeat-live" } });
    assert.equal(database.getMeta().authorityGeneration, beforeLive);
    const requeued = service.requeue({
      commandId: "83000000-0000-4000-8000-000000000003",
      runId: run.envelope.runId,
      expectedVersion: claim.run.version,
      cause: "recovery",
      staleBefore: LATER,
    });
    assert.equal(requeued.state, "applied");
    if (requeued.state !== "applied") throw new Error("expired claim did not requeue");
    assert.equal(requeued.run.lifecycle.state, "queued");
    assert.equal(requeued.run.envelope.attempt, run.envelope.attempt);
    assert.equal(requeued.run.claimGeneration, claim.run.claimGeneration);
    assert.equal(requeued.run.version, claim.run.version + 1);
    const zombieClaim = { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration };
    assert.deepEqual(service.renewClaim({
      commandId: "83000000-0000-4000-8000-000000000004",
      runId: run.envelope.runId,
      claim: zombieClaim,
    }), { state: "refused", refusal: { reason: "lost" } });
    assert.deepEqual(service.workerTransition({
      commandId: "83000000-0000-4000-8000-000000000005",
      runId: run.envelope.runId,
      claim: zombieClaim,
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
    }), { state: "refused", refusal: { reason: "lost" } });
    assert.deepEqual(service.terminalize(
      failureTerminalRequest(claim.run, "83000000-0000-4000-8000-000000000006"),
      personLookupDescriptor,
    ), { state: "refused", refusal: { reason: "lost" } });
  });

  it("re-enqueues a resolved gate at its durable continuation node", () => {
    const { service, request, runtimeConfig } = fixture();
    const running = runningRun(service, request, runtimeConfig);
    const parked = service.workerTransition({
      commandId: "83000000-0000-4000-8000-000000000007",
      runId: running.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: {
        state: "parked-gate",
        gateId: GATE_RESULT.gateId,
        parkedAt: NOW,
        resumeAt: "crm-dates",
      },
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("gate park refused");

    const resumed = service.transition({
      commandId: "83000000-0000-4000-8000-000000000008",
      runId: running.envelope.runId,
      expectedVersion: parked.run.version,
      lifecycle: { state: "queued" },
    });

    assert.equal(resumed.state, "applied");
    if (resumed.state !== "applied") throw new Error("gate resume refused");
    assert.equal(resumed.run.envelope.startAt, "crm-dates");
  });

  it("refuses queued metadata that gate resolution cannot preserve", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const running = runningRun(service, request, runtimeConfig);
    const parked = service.workerTransition({
      commandId: "83000000-0000-4000-8000-000000000015",
      runId: running.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: {
        state: "parked-gate",
        gateId: GATE_RESULT.gateId,
        parkedAt: NOW,
        resumeAt: "crm-dates",
      },
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("gate park refused");
    const generation = database.getMeta().authorityGeneration;

    assert.deepEqual(service.transition({
      commandId: "83000000-0000-4000-8000-000000000016",
      runId: running.envelope.runId,
      expectedVersion: parked.run.version,
      lifecycle: { state: "queued", requeuedFrom: "recovery", notBefore: LATER },
    }), {
      state: "refused",
      refusal: {
        reason: "illegal-transition",
        from: "parked-gate",
        to: "queued",
        message: "gate resolution cannot add queued metadata",
      },
    });
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(service.read(running.envelope.runId), {
      state: "present",
      disposition: "live",
      run: parked.run,
    });
  });

  it("refuses to re-enqueue a parked write without a resolution continuation", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const running = runningRun(service, request, runtimeConfig);
    const intent = parkedWriteIntent(database, running, {
      writeIntentId: "83000000-0000-4000-8000-000000000097", code: "operator-required", message: "check whether the external write landed",
    });
    const parked = service.workerTransition({
      commandId: "83000000-0000-4000-8000-000000000013",
      runId: running.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: {
        state: "parked-write",
        writeIntentId: intent.writeIntentId,
        intentGeneration: intent.generation,
        parkedAt: NOW,
        code: "operator-required",
        message: "check whether the external write landed",
      },
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("write park refused");
    const generation = database.getMeta().authorityGeneration;

    assert.deepEqual(service.transition({
      commandId: "83000000-0000-4000-8000-000000000014",
      runId: running.envelope.runId,
      expectedVersion: parked.run.version,
      lifecycle: { state: "queued" },
    }), {
      state: "refused",
      refusal: {
        reason: "illegal-transition",
        from: "parked-write",
        to: "queued",
        message: "write resolution requires its continuation node",
      },
    });
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(service.read(running.envelope.runId), {
      state: "present",
      disposition: "live",
      run: parked.run,
    });
  });

  it("#9/#10 terminalize is atomic and command replay is exact or divergent", () => {
    const interrupted = fixture({
      afterFailureStorageStep: (step) => {
        if (step === "failure") throw new Error("injected terminal settlement failure");
      },
    });
    const interruptedRun = runningRun(interrupted.service, interrupted.request, interrupted.runtimeConfig);
    const interruptedRequest = failureTerminalRequest(
      interruptedRun,
      "84000000-0000-4000-8000-000000000001",
    );
    const before = interrupted.database.getMeta().authorityGeneration;
    assert.throws(
      () => interrupted.service.terminalize(interruptedRequest, personLookupDescriptor),
      /injected terminal settlement failure/,
    );
    assert.equal(interrupted.database.getMeta().authorityGeneration, before);
    assert.equal(interrupted.database.authority.failures.get(UUID_6), undefined);
    assert.equal(interrupted.database.authority.runResults.get(interruptedRun.envelope.runId), undefined);
    assert.equal(interrupted.database.authority.runs.get(interruptedRun.envelope.runId)?.completion, undefined);
    assert.deepEqual(interrupted.service.read(interruptedRun.envelope.runId), {
      state: "present",
      disposition: "live",
      run: interruptedRun,
    });

    const normal = fixture();
    const running = runningRun(normal.service, normal.request, normal.runtimeConfig);
    const request = failureTerminalRequest(running, "84000000-0000-4000-8000-000000000002");
    const applied = normal.service.terminalize(request, personLookupDescriptor);
    assert.equal(applied.state, "applied");
    if (applied.state !== "applied") throw new Error("terminalize refused");
    assert.equal(applied.run.version, running.version + 1);
    assert.equal(normal.database.authority.failures.listByRun(running.envelope.runId).length, 1);
    const evidence=normal.database.authority.runResults.get(running.envelope.runId);
    assert.ok(evidence);
    assert.equal(evidence.runId,running.envelope.runId);
    const persistedFailure=normal.database.authority.failures.get(UUID_6);assert.ok(persistedFailure);
    assert.deepEqual(evidence.result.value,{kind:"failed-evidence",authorization:request.terminal.authorization,failureDigest:deriveTerminalFailureDigest(persistedFailure)});
    assert.ok(normal.database.authority.runs.get(running.envelope.runId)?.completion);
    const replayGeneration = normal.database.getMeta().authorityGeneration;
    const replay = normal.service.terminalize(request, personLookupDescriptor);
    assert.equal(replay.state, "applied-already");
    if (replay.state !== "applied-already" || !("run" in replay)) throw new Error("terminalize did not replay");
    assert.equal(replay.run.version, applied.run.version);
    assert.equal(normal.database.getMeta().authorityGeneration, replayGeneration);
    assert.deepEqual(normal.service.terminalize({
      ...request,
      terminal: {
        ...request.terminal,
        failure: { ...request.terminal.failure, summary: "Different safe failure summary" },
      },
    }, personLookupDescriptor), {
      state: "refused",
      refusal: { reason: "replay-divergent" },
    });
    assert.equal(normal.database.getMeta().authorityGeneration, replayGeneration);
    assert.equal(normal.service.delete({
      commandId: "84000000-0000-4000-8000-000000000003",
      runId: running.envelope.runId,
      expectedVersion: applied.run.version,
    }).state, "deleted");
    const replayAfterDelete = normal.service.terminalize(request, personLookupDescriptor);
    assert.equal(replayAfterDelete.state, "applied-already");
    assert.ok("tombstone" in replayAfterDelete);
    if (!("tombstone" in replayAfterDelete)) throw new Error("deleted terminal replay lost its tombstone");
    assert.equal(replayAfterDelete.tombstone.runId, running.envelope.runId);
    assert.equal(replayAfterDelete.appliedVersion, applied.run.version);
  });

  it("refuses failure terminalization while a direct tree member is non-terminal", () => {
    const { service, request, runtimeConfig } = fixture();
    const anchor = runningRun(service, { ...request, shape: "operation" }, runtimeConfig);
    const member = created(service, {
      ...request,
      commandId: "84000000-0000-4000-8000-000000000007",
      matchKey: "terminalize-active-member",
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      shape: "operation-member",
      parent: {
        runId: anchor.envelope.runId,
        tracePrefix: anchor.envelope.traceId,
        edgeId: "active-member",
      },
    });

    assert.deepEqual(service.terminalize(
      failureTerminalRequest(anchor, "84000000-0000-4000-8000-000000000008"),
      personLookupDescriptor,
    ), { state: "refused", refusal: { reason: "tree-non-terminal", runId: member.envelope.runId } });
  });

  it("refuses failure terminalization while a nested tree member is non-terminal", () => {
    const { service, request, runtimeConfig } = fixture();
    const anchor = runningRun(service, { ...request, shape: "operation" }, runtimeConfig);
    const member = created(service, {
      ...request,
      commandId: "84000000-0000-4000-8000-000000000009",
      matchKey: "terminalize-terminal-member",
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      shape: "operation-member",
      parent: {
        runId: anchor.envelope.runId,
        tracePrefix: anchor.envelope.traceId,
        edgeId: "terminal-member",
      },
    });
    const terminalMember = service.transition({
      commandId: "84000000-0000-4000-8000-000000000010",
      runId: member.envelope.runId,
      expectedVersion: member.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(terminalMember.state, "applied");
    const grandchild = created(service, {
      ...request,
      commandId: "84000000-0000-4000-8000-000000000011",
      matchKey: "terminalize-active-grandchild",
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      shape: "operation-member",
      parent: {
        runId: member.envelope.runId,
        tracePrefix: member.envelope.traceId,
        edgeId: "active-grandchild",
      },
    });

    assert.deepEqual(service.terminalize(
      failureTerminalRequest(anchor, "84000000-0000-4000-8000-000000000012"),
      personLookupDescriptor,
    ), { state: "refused", refusal: { reason: "tree-non-terminal", runId: grandchild.envelope.runId } });
  });

  it("refuses a distinct terminal lifecycle self-edge", () => {
    const { service, request } = fixture();
    const run = created(service, request);
    const lifecycle = { state: "terminal" as const, outcome: "cancelled" as const, endedAt: NOW };
    const settled = service.transition({
      commandId: "84000000-0000-4000-8000-000000000013",
      runId: run.envelope.runId,
      expectedVersion: run.version,
      lifecycle,
    });
    assert.equal(settled.state, "applied");
    if (settled.state !== "applied") throw new Error("settlement refused");

    assert.deepEqual(service.transition({
      commandId: "84000000-0000-4000-8000-000000000014",
      runId: run.envelope.runId,
      expectedVersion: settled.run.version,
      lifecycle,
    }), {
      state: "refused",
      refusal: {
        reason: "illegal-transition",
        from: "terminal",
        to: "terminal",
        message: "terminal has no self-edge; a settled outcome is settled",
      },
    });
  });

  it("refuses a display-name self-edge on a terminal run", () => {
    const { service, request } = fixture();
    const run = created(service, request);
    const settled = service.transition({
      commandId: "84000000-0000-4000-8000-000000000015",
      runId: run.envelope.runId,
      expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(settled.state, "applied");
    if (settled.state !== "applied") throw new Error("settlement refused");

    assert.deepEqual(service.transition({
      commandId: "84000000-0000-4000-8000-000000000016",
      runId: run.envelope.runId,
      expectedVersion: settled.run.version,
      displayName: "Late rename",
    }), {
      state: "refused",
      refusal: {
        reason: "illegal-transition",
        from: "terminal",
        to: "terminal",
        message: "terminal has no self-edge; a settled outcome is settled",
      },
    });
  });

  it("#10 journals only request commitments and returns the current version on exact replay", () => {
    const { service, request, database } = fixture();
    const protectedRequest={...request,input:{...request.input,parsed:{...request.input.parsed,protectedBindings:[{kind:"test-data-local" as const,inputPath:"emplId" as const,name:"personLookupCanaryEid" as const,sourceId:UUID_6}]}}};
    const run = created(service, protectedRequest);
    const first = service.transition({
      commandId: "85000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId,
      expectedVersion: run.version,
      displayName: "Reviewed name",
    });
    if (first.state !== "applied") throw new Error("rename refused");
    const second = service.transition({
      commandId: "85000000-0000-4000-8000-000000000002",
      runId: run.envelope.runId,
      expectedVersion: first.run.version,
      priority: "interactive",
    });
    if (second.state !== "applied") throw new Error("bump refused");
    const generation = database.getMeta().authorityGeneration;
    const replay = service.transition({
      commandId: "85000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId,
      expectedVersion: run.version,
      displayName: "Reviewed name",
    });
    assert.equal(replay.state, "applied-already");
    if (replay.state !== "applied-already" || !("run" in replay)) throw new Error("rename did not replay");
    assert.equal(replay.run.version, second.run.version);
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(service.transition({
      commandId: "85000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId,
      expectedVersion: run.version,
      displayName: "Divergent name",
    }), { state: "refused", refusal: { reason: "replay-divergent" } });
    const journal = database.authority.lifecycleJournal.getCommand(request.commandId);
    assert.ok(journal !== undefined && "kind" in journal);
    if (!("kind" in journal)) throw new Error("create journal used the product command arm");
    assert.equal(journal.kind, "run-lifecycle");
    assert.equal(JSON.stringify(journal).includes("10873698"), false);
  });

});
