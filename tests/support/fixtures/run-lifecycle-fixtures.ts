import { retainAuthoritySourceClosure } from '../../../src/backend/storage/source-closure.js';
import { isLiveWorker } from "../../../src/models/run/worker.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { admitDirectWorker } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { workflowProjections, type AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { RunRecordService, workerRunLifecyclePort, runContinuationPort } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import type { Clock } from "../../../src/rules/time/clock.js";
import type { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { CONFIG_SNAPSHOT } from "./phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "./phase1f-run-fixtures.js";
import { bindWorkerProcessAdmission } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { WorkerIdSchema } from "../../../src/rules/identity/ids.js";
import { boundFixtureWorker, boundProfileAdmission, registerBoundFixtureWorker } from "../helpers/synthetic-database-admission.js";

export function testRunService(database: AuthorityDatabase, clock: Clock) {
  return new RunRecordService({ database, clock, ids: sequentialIdFactory("e"),
    publishQueued: () => { throw new Error("fixture lifecycle ports do not create runs"); },
  });
}

export function testRunLifecycle(database: AuthorityDatabase, clock: Clock) {
  return workerRunLifecyclePort(testRunService(database, clock));
}

export function testRunContinuation(database: AuthorityDatabase, clock: Clock) {
  return runContinuationPort(testRunService(database, clock));
}

export function testWorkerLifetime(database: AuthorityDatabase, workflow: string, poolIndex: number) {
  const member = database.authority.workerSlots.list(workflow).find(slot => slot.poolIndex === poolIndex && slot.retiredAt === null);
  assert.ok(member, "claim fixture requires its actual admitted member");
  const lease = database.authority.workerLeases.get(member.workerId);
  assert.ok(lease && lease.workflow === member.workflow && isLiveWorker(lease), "claim fixture requires its actual current lifetime");
  return { member, lease, workerId: member.workerId,
    workerLifetime: { membershipRevision: member.membershipRevision, leaseGeneration: lease.leaseGeneration } };
}

export function testAdmittedWorker(database: AuthorityDatabase, clock: Clock, input: Readonly<{
  path: string; workflow: string; poolIndex: number; browserSystems: readonly string[];
}>) {
  const admission = boundProfileAdmission(input.path);
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const existing = database.authority.workerSlots.list(input.workflow).find(slot => slot.poolIndex === input.poolIndex && slot.retiredAt === null);
  if (existing !== undefined) {
    assert.ok(boundFixtureWorker(database, input.path, existing.workerId), "fixture cannot adopt an unowned worker");
    const custody = database.workerLifetimeCustody(existing.workerId);
    assert.equal(custody.state, "alive");
    assert.equal(custody.birth.owner.pid, process.pid);
    return { ...testWorkerLifetime(database, input.workflow, input.poolIndex), started: undefined };
  }
  const authorityPath = realpathSync(input.path), processLockRoot = join(dirname(authorityPath), "locks");
  let owned: ReturnType<typeof bindWorkerProcessAdmission> | undefined;
  try {
  owned = bindWorkerProcessAdmission({ authorityPath, processLockRoot, pid: process.pid, clock,
    open: () => database, close: value => value.close(),
    admit: (value, acquisitionId) => value.withAuthorityTransaction(repositories => {
      const current = repositories.workerPools.get(input.workflow);
      return WorkerIdSchema.parse(admitDirectWorker(repositories, { commandId: randomUUID(), workflow: input.workflow,
        poolIndex: input.poolIndex, expectedPoolVersion: current?.version ?? 0, processId: process.pid,
        processAcquisitionId: acquisitionId, authorityPath, processLockRoot, now: clock.now().toISOString() }, randomUUID()).workerId);
    }) });
  let failure: { error: unknown } | undefined;
  let started: ReturnType<typeof database.startOwnedWorker> | undefined;
  try {
    started = database.startOwnedWorker({ workerId: owned.workerId, workflow: input.workflow,
      browserSystems: input.browserSystems, processId: process.pid, requestedBy: "local-operator",
      now: clock.now().toISOString() }, owned.processLock);
    assert.equal(started.state, "started");
  } catch (error) { failure = { error }; }
  let registrationFailure: { error: unknown } | undefined;
  try {
    registerBoundFixtureWorker({ database, path: input.path, workerId: owned.workerId,
      generation: database.authority.workerLeases.get(owned.workerId)?.leaseGeneration,
      processId: process.pid, handle: owned.processLock, clock });
  } catch (error) { registrationFailure = { error }; }
  if (registrationFailure !== undefined) {
    if (failure !== undefined) throw new AggregateError([failure.error, registrationFailure.error], "fixture-worker-owner-registration-unproved", { cause: failure.error });
    throw registrationFailure.error;
  }
  if (failure !== undefined) throw failure.error;
  assert.ok(started);
  return { ...testWorkerLifetime(database, input.workflow, input.poolIndex), started };
  } catch (error) {
    throw retainAuthoritySourceClosure([error], { admission: { admission, database, owned } });
  }
}

export function testWorkerPorts(database: AuthorityDatabase, clock: Clock, input: Readonly<{
  path: string; descriptor: AnyWorkflowDescriptor; poolIndex: number;
}>) {
  const runtimeConfig = database.authority.runtimeConfig.get() ?? database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const { member: slot } = testAdmittedWorker(database, clock, { path: input.path, workflow: input.descriptor.id,
    poolIndex: input.poolIndex, browserSystems: workflowProjections(input.descriptor).systems });
  const lifecycle = testRunLifecycle(database, clock);
  return { lifecycle, claimNext: (request: { commandId: string; workflow: string; workerId: string }) => {
    assert.equal(request.workflow, slot.workflow);
    assert.equal(request.workerId, slot.workerId);
    const currentMember = database.authority.workerSlots.get(slot.workerId), lease = database.authority.workerLeases.get(slot.workerId);
    assert.ok(currentMember, "claim fixture requires its actual admitted member");
    assert.ok(lease, "claim fixture requires its actual current lifetime");
    return lifecycle.claimNext({ commandId: request.commandId, workflow: request.workflow, workerId: slot.workerId,
      workerLifetime: { membershipRevision: currentMember.membershipRevision, leaseGeneration: lease.leaseGeneration }, runtimeConfig: {
      generation: runtimeConfig.generation, settingsRevision: runtimeConfig.settingsRevision,
      settingsFingerprint: runtimeConfig.settingsFingerprint, configFingerprint: runtimeConfig.configFingerprint,
    } });
  } };
}
