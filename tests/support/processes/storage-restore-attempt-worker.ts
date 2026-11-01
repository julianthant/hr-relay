import { testProcessImport } from "../compiled-process.js";
import type { WorkerLeaseRecord } from "../../../src/models/run/worker.js";
import { RuntimeLifetimeLock, WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { randomUUID } from "node:crypto";
import { deriveWriteBindingProofDigest } from "../../../src/rules/write-safety/write-safety.js";
import { RunRecordService, workerRunLifecyclePort } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { executeSequencedWriteCommit } from "../../../src/backend/runtime/writes/write-sequencer.js";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../src/backend/runs/commands/run-queued-span.js";
import { IsoInstantSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../src/rules/identity/ids.js";
import { runClaim, type RunRecord } from "../../../src/models/run/record.js";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { admitDirectWorker } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { WorkerPoolMemberSchema, workerPoolMember, type WorkerPoolMember } from "../../../src/models/run/worker-slot.js";
import { createBoundProfileFixture, registerBoundProfile, unregisterBoundProfile } from "../helpers/admission-fixture.js";
import { AuthorityDatabase } from "../helpers/synthetic-database-admission.js";
import { AuthorityBackupService } from "../../../src/backend/storage/sqlite/backup-service.js";
import { FakeKeyringEntry } from "../helpers/credential-keychain-fake.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../src/models/config/snapshot.js";
import { seedAtomicWriteOwner, currentAtomicWriteFixture, atomicWriteCheckpoint } from "../helpers/timeline-write-fixture.js";
import { fenceWriteFixture } from "../helpers/write-fence-fixture.js";
import { ATOMIC_WRITE_COMMIT, COMMAND_FIXTURES, CONFIG_SNAPSHOT, NOW, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../fixtures/phase1c-contract-fixtures.js";
import { manualClock } from "../../../src/rules/time/clock.js";

assert.ok(process.send !== undefined);
if (process.argv[2] === "successor-renew-confirmed") {
  const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[3]), () => { process.exitCode = 1; });
  const machine = RuntimeAdmission.acquireWorker(z.string().min(1).parse(process.argv[4]), lifetime);
  const admission = machine.admitProfile(z.uuid().parse(process.argv[5]));
  registerBoundProfile(admission, machine);
  const incoming = once(process, "message");
  process.send({ state: "successor-ready" });
  const request = z.strictObject({ nonce: z.uuid(), runId: z.string().min(1), member: WorkerPoolMemberSchema,
    oldLeaseGeneration: z.number().int().positive(), oldProcessId: z.number().int().positive(), oldLeaseStartedAt: IsoInstantSchema,
    oldClaimGeneration: z.number().int().nonnegative(),
    oldAttempt: z.number().int().positive(), expectedPoolVersion: z.number().int().nonnegative(), now: IsoInstantSchema }).parse((await incoming)[0]);
  const clock = manualClock(new Date(request.now)), path = join(admission.stateRoot, "state.db");
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "restore-confirmed-successor" }, clock);
  const closePhysicalDatabase = database.close.bind(database);
  let primary: { error: unknown } | undefined;
  let reply: { state: "successor-renewed"; nonce: string; run: RunRecord; member: WorkerPoolMember; lease: WorkerLeaseRecord;
    previousLifetime: { workerId: string; processId: number; leaseGeneration: number; startedAt: string } } | undefined;
  try {
    const prior = database.authority.runs.get(request.runId), oldLease = database.authority.workerLeases.get(request.member.workerId);
    assert.ok(prior); assert.ok(oldLease);
    assert.equal(prior.lifecycle.state, "queued"); assert.equal(prior.claimGeneration, request.oldClaimGeneration);
    assert.equal(prior.envelope.attempt, request.oldAttempt); assert.equal(prior.envelope.workflow, request.member.workflowId);
    const oldMember = database.authority.workerSlots.get(request.member.workerId); assert.ok(oldMember);
    assert.deepEqual(workerPoolMember(oldMember), request.member); assert.equal(oldLease.workflow, request.member.workflowId);
    assert.equal(oldLease.lifecycle.state, "stopped"); assert.equal(oldLease.leaseGeneration, request.oldLeaseGeneration);
    assert.equal(oldLease.processId, request.oldProcessId); assert.equal(oldLease.lifecycle.startedAt, request.oldLeaseStartedAt);
    const intent = database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId);
    const attempt = database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId);
    const checkpoint = database.authority.runCheckpoints.get(prior.envelope.workflow, prior.envelope.itemId,
      `write-${WRITE_INTENT_ATTEMPTING.writeIntentId}`, prior.envelope.attempt, request.oldClaimGeneration);
    assert.ok(intent); assert.ok(attempt); assert.ok(checkpoint);
    assert.ok(intent.status === "committed");
    assert.equal(intent.runId, request.runId); assert.equal(intent.runAttempt, request.oldAttempt);
    assert.equal(attempt.runId, request.runId); assert.equal(checkpoint.runId, request.runId);
    assert.equal(checkpoint.claimGeneration, request.oldClaimGeneration);
    assert.equal(attempt.outcome.state, "committed");
    assert.equal(database.authority.writeIntents.listByRun(request.runId).every(value => value.status === "committed" || value.status === "observed-present"), true);
    const member = database.withAuthorityTransaction(repositories => {
      const currentMember = repositories.workerSlots.get(request.member.workerId), currentLease = repositories.workerLeases.get(request.member.workerId);
      assert.ok(currentMember); assert.ok(currentLease); assert.deepEqual(workerPoolMember(currentMember), request.member);
      assert.equal(currentLease.lifecycle.state, "stopped"); assert.equal(currentLease.leaseGeneration, request.oldLeaseGeneration);
      return admitDirectWorker(repositories, { commandId: randomUUID(), workflow: request.member.workflowId, poolIndex: request.member.poolIndex,
        expectedPoolVersion: request.expectedPoolVersion, processId: process.pid, now: request.now }, randomUUID());
    });
    assert.deepEqual(workerPoolMember(member), request.member);
    const started = database.authority.workerLeases.start({ workerId: member.workerId, workflow: member.workflow,
      browserSystems: oldLease.browserSystems, processId: process.pid, requestedBy: LOCAL_OPERATOR_ACTOR_ID, now: request.now });
    assert.equal(started.state, "started");
    if (started.state !== "started") throw new Error("confirmed-successor-birth-refused", { cause: started });
    assert.equal(started.lease.leaseGeneration, request.oldLeaseGeneration + 1); assert.equal(started.lease.processId, process.pid);
    const active = database.authority.runtimeConfig.get(); assert.ok(active);
    const service = new RunRecordService({ database, clock, ids: { uuid: randomUUID },
      publishQueued: () => { throw new Error("successor must not create a run"); } });
    const claimed = service.claimNext({ commandId: randomUUID(), workflow: member.workflow, workerId: member.workerId,
      workerLifetime: { membershipRevision: member.membershipRevision, leaseGeneration: started.lease.leaseGeneration },
      runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
        settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } });
    assert.equal(claimed.state, "applied");
    if (claimed.state !== "applied") throw new Error("confirmed-successor-claim-refused", { cause: claimed });
    assert.equal(claimed.run.envelope.runId, request.runId); assert.equal(claimed.run.envelope.attempt, request.oldAttempt);
    assert.equal(claimed.run.claimGeneration, request.oldClaimGeneration + 1);
    const claim = runClaim(claimed.run); assert.ok(claim);
    const renewed = service.renewClaim({ commandId: randomUUID(), runId: request.runId,
      claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration } });
    assert.equal(renewed.state, "applied");
    if (renewed.state !== "applied") throw new Error("confirmed-successor-renewal-refused", { cause: renewed });
    assert.ok(renewed.run.version > claimed.run.version);
    assert.deepEqual(database.authority.writeIntents.get(intent.writeIntentId), intent);
    assert.deepEqual(database.authority.writeAttempts.get(attempt.writeAttemptId), attempt);
    assert.deepEqual(database.authority.runCheckpoints.get(prior.envelope.workflow, prior.envelope.itemId,
      checkpoint.nodeId, prior.envelope.attempt, request.oldClaimGeneration), checkpoint);
    const lease = database.authority.workerLeases.get(member.workerId); assert.ok(lease);
    reply = { state: "successor-renewed", nonce: request.nonce, run: renewed.run, member: workerPoolMember(member), lease,
      previousLifetime: { workerId: oldLease.workerId, processId: oldLease.processId,
        leaseGeneration: oldLease.leaseGeneration, startedAt: oldLease.lifecycle.startedAt } };
  } catch (error) { primary = { error }; }
  try { closePhysicalDatabase(); }
  catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary.error, error], "confirmed-successor-physical-close-failed", { cause: error }); }
  if (primary !== undefined) throw primary.error;
  const response = reply; assert.ok(response);
  await new Promise<void>((resolve, reject) => {
    assert.ok(process.send !== undefined);
    process.send(response, error => { if (error !== null) reject(error); else resolve(); });
  });
  unregisterBoundProfile(admission); admission.release(); machine.release(); await lifetime.close();
  assert.ok(process.disconnect !== undefined); process.disconnect();
} else if (process.argv[2] === "worker") {
  const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[3]), () => { process.exitCode = 1; });
  const machine = RuntimeAdmission.acquireWorker(z.string().min(1).parse(process.argv[4]), lifetime);
  const admission = machine.admitProfile(z.uuid().parse(process.argv[5]));
  admission.assertProfileRuntime();
  const release = once(process, "message");
  process.send({ state: "inherited-held" });
  assert.deepEqual((await release)[0], { state: "release-inherited" });
  assert.ok(process.disconnect !== undefined);
  admission.release(); machine.release(); await lifetime.close(); process.disconnect();
} else {
  const lifetimeLock = await RuntimeLifetimeLock.acquire(Number(process.argv[2]));
  const accounting = z.enum(["before", "after"]).optional().parse(process.argv[4]);
  const clock = manualClock(new Date(accounting === undefined ? NOW : WRITE_INTENT_ATTEMPTING.fencedAt));
  const profile = await createBoundProfileFixture({ lifetime: lifetimeLock, sharedMachine: true });
  const authorityPath = realpathSync(profile.path);
  const processLockRoot = join(profile.workspace, rebuildRuntimeIsolation.processLockRoot);
  const database = AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 250, migrationOwner: "storage-restore-attempt-worker" }, clock);
  const closePhysicalDatabase = database.close.bind(database);
  const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, clock,
    { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
  const snapshot = ConfigSnapshotRecordSchema.parse({ ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint, provenance: resolved.provenance });
  const proof = accounting === undefined ? WRITE_INTENT_ATTEMPTING.bindingProof : { ...WRITE_INTENT_ATTEMPTING.bindingProof,
    afterPrepareSpanPath: `${ATOMIC_WRITE_COMMIT.transaction.traceId}/write-${WRITE_INTENT_ATTEMPTING.writeIntentId}/prepare` };
  const bindingProofDigest = accounting === undefined ? WRITE_INTENT_ATTEMPTING.bindingProofDigest : deriveWriteBindingProofDigest(proof);
  const commit = currentAtomicWriteFixture({ ...ATOMIC_WRITE_COMMIT,
    transaction: { ...ATOMIC_WRITE_COMMIT.transaction, configFingerprint: snapshot.fingerprint, bindingProofDigest },
    committedSpan: { ...ATOMIC_WRITE_COMMIT.committedSpan, bindingProofDigest } });
  const intent = accounting === undefined ? WRITE_INTENT_ATTEMPTING : { ...WRITE_INTENT_ATTEMPTING, bindingProof: proof, bindingProofDigest };
  const attempt = accounting === undefined ? WRITE_ATTEMPT : { ...WRITE_ATTEMPT, bindingProof: proof, bindingProofDigest };
  database.authority.commands.insert(COMMAND_FIXTURES[0]);
  seedAtomicWriteOwner(database, commit, authorityPath, 1, snapshot);
  if (accounting !== undefined) {
    const queued = database.authority.runs.get(intent.runId); assert.ok(queued);
    assert.equal(queued.lifecycle.state, "claimed");
    if (queued.lifecycle.state !== "claimed") throw new Error("fixture owner was not claimed");
    createTimelineEmitter({ repository: database.authority.timelineEvents, clock }).emit(
      runQueuedSpanEvent({ run: queued, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Synthetic restored commit" }));
    const workerId = queued.lifecycle.workerId;
    const service = new RunRecordService({ database, clock, ids: { uuid: randomUUID },
      publishQueued: () => { throw new Error("test must not enqueue"); } });
    assert.equal(service.workerTransition({ commandId: randomUUID(), runId: queued.envelope.runId,
      claim: { workerId, claimGeneration: 1 }, lifecycle: { state: "validating", workerLifetime: queued.lifecycle.workerLifetime,
        workerId, claimedAt: clock.now().toISOString(), heartbeatAt: clock.now().toISOString() } }).state, "applied");
    assert.equal(service.workerTransition({ commandId: randomUUID(), runId: queued.envelope.runId,
      claim: { workerId, claimGeneration: 1 }, lifecycle: { state: "running", workerLifetime: queued.lifecycle.workerLifetime,
        workerId, claimedAt: clock.now().toISOString(), heartbeatAt: clock.now().toISOString(), currentNodeId: atomicWriteCheckpoint(commit).nodeId } }).state, "applied");
  }
  assert.equal(fenceWriteFixture(database, { intent, attempt }).state, "fenced");
  const source = database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId);
  assert.ok(source); assert.equal(source.status, "attempting");
  const current = database.authority.runs.get(source.runId);
  assert.ok(current); const claim = runClaim(current); assert.ok(claim);
  assert.equal(claim.claimGeneration, current.claimGeneration);
  assert.equal(current.envelope.attempt, source.runAttempt);
  assert.equal(database.authority.workerLeases.get(claim.workerId)?.processId, process.pid);
  assert.deepEqual(database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), attempt);
  const member = database.authority.workerSlots.get(claim.workerId), lease = database.authority.workerLeases.get(claim.workerId);
  assert.ok(member); assert.ok(lease);
  assert.ok("workerLifetime" in current.lifecycle);
  assert.deepEqual(current.lifecycle.workerLifetime, { membershipRevision: member.membershipRevision, leaseGeneration: lease.leaseGeneration });
  const directory = join(profile.stateRoot, "backups", "authority");
  const backup = async () => {
    const report = await new AuthorityBackupService(profile.admission, database, { directory }, clock)
      .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
    const manifest = report.manifests[0]; assert.ok(manifest);
    return join(directory, manifest.backupFileName + ".manifest.json");
  };
  const beforeManifestPath = await backup();
  let manifestPath = beforeManifestPath;
  if (accounting !== undefined) {
    clock.setWall(new Date(commit.confirmedAt));
    const service = new RunRecordService({ database, clock, ids: { uuid: randomUUID },
      publishQueued: () => { throw new Error("test must not enqueue"); } });
    const held = { workerId: claim.workerId, claimGeneration: claim.claimGeneration };
    assert.ok("claimedAt" in current.lifecycle);
    executeSequencedWriteCommit(database, { run: { runId: current.envelope.runId, expectedVersion: current.version, claim: held },
      commit, checkpoint: atomicWriteCheckpoint(commit) }, { kind: "advance-running", claim: held, claimedAt: current.lifecycle.claimedAt,
      port: workerRunLifecyclePort(service) });
    assert.equal(database.authority.workerSlots.get(claim.workerId)?.membershipRevision, member.membershipRevision);
    assert.equal(database.authority.workerLeases.get(claim.workerId)?.leaseGeneration, lease.leaseGeneration);
    assert.equal(database.authority.runs.get(current.envelope.runId)?.claimGeneration, claim.claimGeneration);
    if (accounting === "after") manifestPath = await backup();
  }
  const descriptors = () => {
    const report = spawnSync("lsof", ["-nP", "-a", "-p", String(process.pid), "-Fn"], { encoding: "utf8" });
    assert.equal(report.error, undefined); assert.equal(report.status, 0); assert.equal(report.stderr, "");
    return report.stdout.split("\n").filter(line => line.startsWith("n")).map(line => line.slice(1));
  };
  assert.ok(descriptors().includes(authorityPath));
  closePhysicalDatabase();
  const files = [authorityPath, authorityPath + "-wal", authorityPath + "-shm", authorityPath + "-journal"];
  assert.equal(descriptors().some(path => files.some(file => path === file || path === file + " (deleted)")), false);
  lifetimeLock.assertHeld();
  let inherited: ReturnType<typeof spawn> | undefined;
  let inheritedClose: Promise<unknown[]> | undefined;
  if (process.argv[3] === "inherited-child") {
    inherited = spawn(process.execPath, ["--import", testProcessImport(), import.meta.filename, "worker", String(lifetimeLock.port), profile.workspace, profile.admission.profileBinding.profileId],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    inherited.stderr?.resume();
    inheritedClose = once(inherited, "close");
    const held = Promise.race([once(inherited, "message"), inheritedClose.then(() => { throw new Error("inherited-attempt-worker-exited-before-held"); })]);
    await lifetimeLock.share(inherited);
    assert.deepEqual((await held)[0], { state: "inherited-held" });
  }
  const request = once(process, "message");
  const binding = profile.admission.profileBinding;
  const keychain = FakeKeyringEntry.snapshot().filter(([account]) => account === `Relay:${binding.installationId}:${binding.profileId}`);
  assert.equal(keychain.length, 1);
  process.send({ state: "attempting", workspace: profile.workspace, stateRoot: profile.stateRoot,
    authorityPath, profileId: binding.profileId, installationId: binding.installationId, workerId: claim.workerId,
    processLockRoot, pid: process.pid, keychain, manifestPath, beforeManifestPath,
    claimGeneration: current.claimGeneration, runId: current.envelope.runId, databaseClosed: true, retained: true,
    workerLease: lease });
  if (inherited !== undefined) {
    assert.deepEqual((await request)[0], { state: "close-root-listener" });
    const closing = lifetimeLock.close();
    lifetimeLock.assertHeld();
    const release = once(process, "message");
    process.send({ state: "root-listener-closing" });
    assert.deepEqual((await release)[0], { state: "release-inherited" });
    inherited.send({ state: "release-inherited" });
    assert.deepEqual(await inheritedClose, [0, null]);
    await closing;
    process.send({ state: "inherited-closed" });
  } else {
    z.never().parse((await request)[0]);
  }
  process.on("disconnect", () => { process.exitCode = 1; });
}
