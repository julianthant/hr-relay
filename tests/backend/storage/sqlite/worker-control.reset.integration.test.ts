import { WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { testWorkerLifetime, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { writeFixtureDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { DatabaseSync } from "node:sqlite";
import { syntheticDatabasePath } from "../../../support/helpers/synthetic-database-admission.js";
import { absentProbeEvidence, writeFixtureQueuedRun } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { admitWorkerReset } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";

const world = createWriteSequencerTestWorld();
afterEach(world.cleanup);
function resetRequest(h: Awaited<ReturnType<typeof world.harness>>) {
  const slot = h.database.authority.workerSlots.list()[0];
  if (slot === undefined) throw new Error("missing fixture member");
  const lease = h.database.authority.workerLeases.get(slot.workerId);
  if (lease === undefined) throw new Error("missing fixture lifetime");
  return { commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard",
    requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", target: { workerId: slot.workerId,
      membershipRevision: slot.membershipRevision, expectedVersion: lease.version,
      controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } } };
}
function admit(h: Awaited<ReturnType<typeof world.harness>>, request: unknown = resetRequest(h)) {
  return h.database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, request, randomUUID(), h.clock.now().toISOString()));
}

describe("exact native worker reset reservation", () => {
  it("retains genuine claim lifetime through active transitions and refuses rewriting or dropping it", async () => {
    const h = await world.harness();
    const { run, claim } = world.claimRunning(h.database, h.clock);
    if (run.lifecycle.state !== "running") throw new Error("missing active fixture");
    expect(run.lifecycle.workerLifetime).toEqual({ membershipRevision: 1, leaseGeneration: 1 });
    const { workerLifetime, ...withoutLifetime } = run.lifecycle;
    const before = JSON.stringify(h.database.authority.runs.get(run.envelope.runId));
    for (const lifecycle of [withoutLifetime, { ...run.lifecycle, workerLifetime: { ...workerLifetime, leaseGeneration: 2 } }]) {
      expect(() => h.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
        claim, lifecycle, now: h.clock.now().toISOString() })).toThrow("run-claim-lifetime-immutable");
      expect(JSON.stringify(h.database.authority.runs.get(run.envelope.runId))).toBe(before);
    }
    expect(admit(h).reset?.work.kind).toBe("current");
  });

  it("keeps the lifetime supplied at claim on the admitted reset", async () => {
    const h = await world.harness();
    const request = resetRequest(h);
    h.database.authority.runs.enqueue(writeFixtureQueuedRun());
    const claimMember1 = h.database.authority.workerSlots.get(request.target.workerId);
    if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
    const lifetime = testWorkerLifetime(h.database, "write-fixture", claimMember1.poolIndex).workerLifetime;
    const claimed = h.database.authority.runs.claimNext({ workerLifetime: lifetime, workflow: "write-fixture", workerId: request.target.workerId,
      now: h.clock.now().toISOString() });
    expect(claimed.state).toBe("claimed");
    if (claimed.state !== "claimed" || claimed.run.lifecycle.state !== "claimed") throw new Error("missing claim");
    expect(claimed.run.lifecycle.workerLifetime).toEqual(lifetime);
    const record = admit(h, request);
    expect(record.reset?.work).toMatchObject({ kind: "current", current: { runId: claimed.run.envelope.runId, claimGeneration: claimed.run.claimGeneration } });
  });

  for (const operation of ["fenceAttempt", "refenceRetryable"] as const) {
    it(`reset admission wins before ${operation} without changing write authority`, async () => {
      const h = await world.harness();
      const { run, claim } = world.claimRunning(h.database, h.clock);
      const original = world.attemptingIntentFixture(run.envelope.runId);
      let fence = original;
      if (operation === "refenceRetryable") {
        expect(h.database.authority.writeIntents.fenceAttempt({ ...original, claim }).state).toBe("fenced");
        h.database.authority.writeIntents.settleRetryable({ writeIntentId: original.intent.writeIntentId,
          generation: 1, expectedVersion: 1, now: h.clock.now().toISOString(), settlement: { state: "operator-confirmed-absent",
            writeIntentId: original.intent.writeIntentId, generation: 1, operator: "local-operator",
            confirmedAt: h.clock.now().toISOString() } });
        const bindingProof = { ...original.intent.bindingProof, proofId: UUID_6 };
        const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
        fence = { intent: { ...original.intent, generation: 2, version: 3, bindingProof, bindingProofDigest },
          attempt: { ...original.attempt, generation: 2, bindingProof, bindingProofDigest } };
      }
      const record = admit(h);
      expect(record.reset?.work).toMatchObject({ kind: "current", current: { runId: run.envelope.runId,
        workerId: claim.workerId, claimGeneration: claim.claimGeneration, attempt: run.envelope.attempt } });
      const generation = h.database.getMeta().authorityGeneration;
      const before = JSON.stringify(h.database.authority.writeIntents.listByRun(run.envelope.runId));
      const result = operation === "fenceAttempt" ? h.database.authority.writeIntents.fenceAttempt({ ...fence, claim })
        : h.database.authority.writeIntents.refenceRetryable({ ...fence, claim, expectedVersion: 2 });
      expect(result).toMatchObject({ state: "refused", refusal: { reason: "invalid-state" } });
      expect(h.database.getMeta().authorityGeneration).toBe(generation);
      expect(JSON.stringify(h.database.authority.writeIntents.listByRun(run.envelope.runId))).toBe(before);
      expect(h.database.authority.runs.get(run.envelope.runId)?.cancelRequested).not.toBe(true);
    });
  }

  it("admits after the write fence without cancelling or altering the actual write owner", async () => {
    const h = await world.harness();
    const { run, claim } = world.claimRunning(h.database, h.clock);
    const fence = world.attemptingIntentFixture(run.envelope.runId);
    expect(h.database.authority.writeIntents.fenceAttempt({ ...fence, claim }).state).toBe("fenced");
    const before = JSON.stringify({ run: h.database.authority.runs.get(run.envelope.runId),
      intent: h.database.authority.writeIntents.listByRun(run.envelope.runId), attempts: h.database.authority.writeAttempts.listByIntent(fence.intent.writeIntentId) });
    expect(admit(h).reset?.work.kind).toBe("current");
    expect(JSON.stringify({ run: h.database.authority.runs.get(run.envelope.runId),
      intent: h.database.authority.writeIntents.listByRun(run.envelope.runId), attempts: h.database.authority.writeAttempts.listByIntent(fence.intent.writeIntentId) })).toBe(before);
  });

  it("binds the run observed inside admission after a newer claim wins, and excludes the next direct/canonical claim", async () => {
    const h = await world.harness();
    const request = resetRequest(h);
    const { run, claim } = world.claimRunning(h.database, h.clock);
    const reset = admit(h, request);
    expect(reset.reset?.work).toMatchObject({ kind: "current", current: { runId: run.envelope.runId, claimGeneration: claim.claimGeneration } });
    expect(() => h.database.authority.runs.claimNext({ workerId: claim.workerId, workflow: run.envelope.workflow,
      now: h.clock.now().toISOString() })).toThrow("worker-reset-reserved");
    const lifecycle = new RunRecordService({ database: h.database, clock: h.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
    const runtime = h.database.authority.runtimeConfig.get();
    if (runtime === undefined) throw new Error("missing runtime");
    expect(lifecycle.claimNext({ commandId: randomUUID(), workerId: claim.workerId, workflow: run.envelope.workflow,
      runtimeConfig: { generation: runtime.generation, configFingerprint: runtime.configFingerprint,
        settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint } })).toMatchObject({ state: "refused", refusal: { reason: "none-eligible" } });
  });

  it("rejects stale membership and lease ABA before reserving, and retains the admitted reset across expiry", async () => {
    const h = await world.harness();
    const request = resetRequest(h), generation = h.database.getMeta().authorityGeneration;
    expect(() => admit(h, { ...request, target: { ...request.target, membershipRevision: 2 } })).toThrow("worker-reset-target-conflict");
    expect(() => admit(h, { ...request, target: { ...request.target, controlBasis: { ...request.target.controlBasis, leaseGeneration: 2 } } })).toThrow("worker-reset-target-conflict");
    expect(h.database.getMeta().authorityGeneration).toBe(generation);
    const record = admit(h);
    h.clock.advanceWall(600_000);
    expect(h.database.authority.workerControls.resetForWorker(request.target.workerId)).toEqual(record);
    expect(() => h.database.authority.workerControls.transition(record.commandId, "admitted", { state: "refused",
      completedAt: h.clock.now().toISOString(), message: "expired" })).toThrow("worker-reset-settlement-unavailable");
    expect(() => h.database.authority.workerControls.audit(record.commandId, h.clock.now().toISOString())).toThrow("worker-reset-settlement-unavailable");
    expect(h.database.authority.workerControls.pending(record.scope)).toEqual([record]);
  });
  it("refuses an unproved queued cascade and a foreign owned child before reservation", async () => {
    for (const childState of ["queued", "foreign"] as const) {
      const h = await world.harness();
      const owned = world.claimRunning(h.database, h.clock);
      const { run } = owned;
      let foreign: { run: ReturnType<typeof world.claimRunning>["run"]; claim: { workerId: string; claimGeneration: number } } | undefined;
      try {
      const childId = randomUUID(), manifestId = randomUUID(), dependencyId = randomUUID();
      const source = RunRecordSchema.parse(writeFixtureQueuedRun());
      const child = { ...source, envelope: { ...source.envelope, runId: childId, itemId: childId,
        parent: { runId: run.envelope.runId, tracePrefix: "wf-090000-2222", edgeId: "reset-child" } } };
      h.database.authority.runs.enqueue(child);
      const policy = { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" };
      h.database.authority.delegationManifests.insert({ manifestId, parentRunId: run.envelope.runId, edgeId: "reset-child",
        inputSchemaHash: "a".repeat(64), resultSchemaHash: "b".repeat(64), cardinality: "one", join: "one", policy,
        children: [{ dependencyId, childRunId: childId, childItemId: childId, canonicalInputFingerprint: "a".repeat(64) }],
        createdAt: h.clock.now().toISOString(), manifestFingerprint: "a".repeat(64) });
      h.database.authority.dependencies.insert({ dependencyId, manifestId, edgeId: "reset-child", parentRunId: run.envelope.runId,
        childRunId: childId, childItemId: childId, policy, state: "active", version: 1,
        createdAt: h.clock.now().toISOString(), updatedAt: h.clock.now().toISOString() });
      if (childState === "foreign") {
        testWorkerPorts(h.database, h.clock, { path: syntheticDatabasePath(h.database), descriptor: writeFixtureDescriptor, poolIndex: 2 });
        const worker = h.database.authority.workerSlots.list()[1];
        if (worker === undefined) throw new Error("missing foreign worker");
        const claimMember2 = h.database.authority.workerSlots.get(worker.workerId);
        if (claimMember2 === undefined) throw new Error("fixture-claim-member-required");
        const claimed = h.database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(h.database, run.envelope.workflow, claimMember2.poolIndex).workerLifetime, workflow: run.envelope.workflow, workerId: worker.workerId, now: h.clock.now().toISOString() });
        expect(claimed.state).toBe("claimed");
        if (claimed.state === "claimed") foreign = { run: claimed.run, claim: { workerId: worker.workerId, claimGeneration: claimed.run.claimGeneration } };
      }
      const before = h.database.getMeta().authorityGeneration;
      if (childState === "foreign") {
        expect(() => admit(h)).toThrow("worker-reset-foreign-cascade-owner");
        expect(h.database.getMeta().authorityGeneration).toBe(before);
      } else {
        expect(() => admit(h)).toThrow("delegation-invocation-authority-unavailable");
        expect(h.database.getMeta().authorityGeneration).toBe(before);
      }
      } finally {
        if (foreign !== undefined) world.releaseClaim(h.database, h.clock, foreign.run, foreign.claim);
        world.releaseClaim(h.database, h.clock, owned.run, owned.claim);
      }
    }
  });

  it("preserves historical unbound Stop bytes but refuses pending replay, claims and birth", async () => {
    const h = await world.harness();
    const strict = resetRequest(h);
    const { membershipRevision: _membership, ...target } = strict.target;
    const request = { ...strict, target };
    h.database.authority.commands.insert(request);
    const historical = { commandId: request.commandId, request, scope: `worker-pool:${h.database.authority.workerSlots.list()[0]?.workflow}`,
      executorId: randomUUID(), admittedAt: h.clock.now().toISOString(), expiresAt: h.clock.now().toISOString(),
      basisVersion: 1, phase: { state: "uncertain", startedAt: h.clock.now().toISOString(), observedAt: h.clock.now().toISOString(), message: "historical owner unresolved" } };
    const raw = new DatabaseSync(syntheticDatabasePath(h.database));
    try {
      raw.prepare("INSERT INTO worker_controls(command_id,scope,worker_id,phase,audited_at,payload_json,created_at) VALUES(?,?,?,'uncertain',NULL,?,?)")
        .run(request.commandId, historical.scope, request.target.workerId, JSON.stringify(historical), h.clock.now().toISOString());
      const before = raw.prepare("SELECT request_json FROM commands WHERE id=?").get(request.commandId);
      expect(h.database.authority.workerControls.get(request.commandId)).toEqual(historical);
      expect(() => h.database.authority.workerControls.resetForWorker(request.target.workerId)).toThrow("worker-reset-authority-unavailable");
      expect(() => h.database.authority.runs.claimNext({ workerId: request.target.workerId, workflow: "write-fixture", now: h.clock.now().toISOString() })).toThrow("worker-reset-authority-unavailable");
      expect(() => h.database.authority.workerControls.audit(request.commandId, h.clock.now().toISOString())).toThrow("worker-reset-settlement-unavailable");
      expect(raw.prepare("SELECT request_json FROM commands WHERE id=?").get(request.commandId)).toEqual(before);
    } finally { raw.close(); }
  });

  it("retains the real fenced sequencer callback through reset then preserves its UNKNOWN parked result", async () => {
    const h = await world.harness();
    const { run, claim } = world.claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    let release: () => void = () => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    let started: () => void = () => undefined;
    const starting = new Promise<void>(resolve => { started = resolve; });
    h.world.afterCommitClickBeforeTaskSettlement = async () => { started(); await held; };
    const parent = new AbortController();
    let settled = false;
    const execution = h.execute({ ...world.contextFor(run, claim), signal: parent.signal }).then(
      value => ({ value }), (error: unknown) => ({ error })).finally(() => { settled = true; });
    await starting;
    const record = admit(h);
    parent.abort(new Error("controlled exact reset observer"));
    await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(settled).toBe(false);
    expect(world.intentByKey(h.database)?.status).toBe("attempting");
    expect(h.sessions.closeReasons()).toEqual([]);
    expect(h.database.authority.workerControls.get(record.commandId)?.phase.state).toBe("admitted");
    release();
    const result = await execution;
    expect("error" in result && result.error).toBeInstanceOf(WriteParkedError);
    expect(world.intentByKey(h.database)?.status).toBe("parked");
    expect(h.database.authority.runs.get(run.envelope.runId)?.lifecycle.state).toBe("parked-write");
    expect(h.database.authority.workerControls.pending(record.scope)).toHaveLength(1);
  });

  it("admits after heartbeat row-version advance while exact control/member basis stays current, without inventing an absent version", async () => {
    for (const carriesVersion of [true, false]) {
      const h = await world.harness(), request = resetRequest(h);
      const lease = h.database.authority.workerLeases.get(request.target.workerId);
      if (lease === undefined) throw new Error("missing lifetime");
      h.clock.advanceWall(1000);
      h.database.authority.workerLeases.reportLifecycle({ workerId: lease.workerId, leaseGeneration: lease.leaseGeneration,
        lifecycle: { state: "idle", startedAt: lease.lifecycle.startedAt, heartbeatAt: h.clock.now().toISOString() }, now: h.clock.now().toISOString() });
      const observed = h.database.authority.workerLeases.get(lease.workerId);
      const { expectedVersion: _version, ...withoutVersion } = request.target;
      const record = admit(h, { ...request, target: carriesVersion ? request.target : withoutVersion });
      expect(record.basisVersion).toBe(observed?.version);
      expect(record.reset?.basis).toEqual(request.target.controlBasis);
      if (!carriesVersion) expect("expectedVersion" in record.request.target).toBe(false);
    }
  });

  it("checks explicit claim membership/lifetime before taking queued work and rejects retired-member birth", async () => {
    const h = await world.harness(), request = resetRequest(h);
    h.database.authority.runs.enqueue(writeFixtureQueuedRun());
    const workflow = h.database.authority.workerSlots.list()[0]?.workflow;
    const input = { workflow, workerId: request.target.workerId, now: h.clock.now().toISOString() };
    for (const workerLifetime of [{ membershipRevision: 2, leaseGeneration: 1 }, { membershipRevision: 1, leaseGeneration: 2 }]) {
      expect(() => h.database.authority.runs.claimNext({ ...input, workerLifetime })).toThrow("worker-claim-membership-unavailable");
    }
    const commandId = randomUUID();
    h.database.authority.workerLeases.reportLifecycle({ workerId: request.target.workerId, leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: h.clock.now().toISOString(), stoppedAt: h.clock.now().toISOString(), reason: "shutdown" }, now: h.clock.now().toISOString() });
    h.database.withAuthorityTransaction(repositories => {
      repositories.commands.insert({ ...request, commandId, type: "plan-worker-count", target: { workflowId: workflow, expectedVersion: repositories.workerPools.get(String(workflow))?.version }, payload: { desiredWorkers: 0 } });
      repositories.workerSlots.retire({ workerId: request.target.workerId, expectedRevision: 1, commandId, now: h.clock.now().toISOString() });
      repositories.workerPools.plan({ workflow, expectedVersion: repositories.workerPools.get(String(workflow))?.version, desiredWorkers: 0, requestedBy: "local-operator", now: h.clock.now().toISOString() });
    });
    expect(() => h.database.authority.runs.claimNext(input)).toThrow("worker-claim-membership-unavailable");
    expect(() => h.database.authority.workerLeases.start({ workerId: request.target.workerId, workflow,
      browserSystems: ["ucpath"], processId: process.pid, requestedBy: "local-operator", now: h.clock.now().toISOString() })).toThrow("worker-lease-membership-unavailable");
  });

  it("cannot replay an earlier canonical claim through the pending reset barrier", async () => {
    const h = await world.harness();
    h.database.authority.runs.enqueue(writeFixtureQueuedRun());
    const lifecycle = new RunRecordService({ database: h.database, clock: h.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
    const request = resetRequest(h), runtime = h.database.authority.runtimeConfig.get();
    if (runtime === undefined) throw new Error("missing runtime");
    const claimRequest = { commandId: randomUUID(), workerId: request.target.workerId,
      workerLifetime: { leaseGeneration: request.target.controlBasis.leaseGeneration, membershipRevision: request.target.membershipRevision },
      workflow: h.database.authority.workerSlots.list()[0]?.workflow, runtimeConfig: { generation: runtime.generation,
        configFingerprint: runtime.configFingerprint, settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint } };
    expect(lifecycle.claimNext(claimRequest).state).toBe("applied");
    admit(h, request);
    const generation = h.database.getMeta().authorityGeneration;
    expect(lifecycle.claimNext(claimRequest)).toMatchObject({ state: "refused", refusal: { reason: "none-eligible" } });
    expect(h.database.getMeta().authorityGeneration).toBe(generation);
  });

});
