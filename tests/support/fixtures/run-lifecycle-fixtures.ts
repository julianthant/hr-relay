import { retainAuthoritySourceClosure } from '../../../src/backend/storage/source-closure.js';
import assert from "node:assert/strict";
import { workflowProjections, type AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { RunRecordService, workerRunLifecyclePort, runContinuationPort } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import type { Clock } from "../../../src/rules/time/clock.js";
import type { AuthorityRepositories } from "../../../src/backend/storage/sqlite/authority-database.js";
import type { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { CONFIG_SNAPSHOT } from "./phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "./phase1f-run-fixtures.js";
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

/** The admitted slot that claims for a pool index; claims are fenced by the run's claim generation, not a worker lifetime. */
export function testWorkerLifetime(database: AuthorityDatabase, workflow: string, poolIndex: number) {
  const member = database.authority.workerSlots.active(workflow).find(slot => slot.poolIndex === poolIndex);
  assert.ok(member, "claim fixture requires its actual admitted member");
  return { member, workerId: member.workerId };
}

export function testAdmittedWorker(database: AuthorityDatabase, clock: Clock, input: Readonly<{
  path: string; workflow: string; poolIndex: number; browserSystems: readonly string[];
}>) {
  const admission = boundProfileAdmission(input.path);
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const existing = database.authority.workerSlots.active(input.workflow).find(slot => slot.poolIndex === input.poolIndex);
  if (existing !== undefined) {
    assert.ok(boundFixtureWorker(database, input.path, existing.workerId), "fixture cannot adopt an unowned worker");
    return testWorkerLifetime(database, input.workflow, input.poolIndex);
  }
  const now = clock.now().toISOString();
  const member = database.withAuthorityTransaction(repositories => {
    const pool = repositories.workerPools.get(input.workflow);
    if (pool === undefined || pool.desiredWorkers < input.poolIndex) {
      repositories.workerPools.plan({ workflow: input.workflow, expectedVersion: pool?.version ?? 0,
        desiredWorkers: Math.max(pool?.desiredWorkers ?? 0, input.poolIndex), requestedBy: "local-operator", now });
    }
    return repositories.workerSlots.allocate({ workflow: input.workflow, poolIndex: input.poolIndex, now });
  });
  try {
    registerBoundFixtureWorker({ database, path: input.path, workerId: member.workerId, clock });
  } catch (error) {
    throw retainAuthoritySourceClosure([error], { admission: { admission, database, member } });
  }
  return testWorkerLifetime(database, input.workflow, input.poolIndex);
}

export function testWorkerPorts(database: AuthorityDatabase, clock: Clock, input: Readonly<{
  path: string; descriptor: AnyWorkflowDescriptor; poolIndex: number;
}>) {
  const runtimeConfig = database.authority.runtimeConfig.get() ?? database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const { member: slot } = testAdmittedWorker(database, clock, { path: input.path, workflow: input.descriptor.id,
    poolIndex: input.poolIndex, browserSystems: workflowProjections(input.descriptor).systems });
  const lifecycle = testRunLifecycle(database, clock);
  return { lifecycle, browserScreenshotCapture: { capture: async () => undefined }, claimNext: (request: { commandId: string; workflow: string; workerId: string }) => {
    assert.equal(request.workflow, slot.workflow);
    assert.equal(request.workerId, slot.workerId);
    assert.equal(database.authority.workerSlots.get(slot.workerId)?.retiredAt, null, "claim fixture requires its actual admitted member");
    return lifecycle.claimNext({ commandId: request.commandId, workflow: request.workflow, workerId: slot.workerId, runtimeConfig: {
      generation: runtimeConfig.generation, settingsRevision: runtimeConfig.settingsRevision,
      settingsFingerprint: runtimeConfig.settingsFingerprint, configFingerprint: runtimeConfig.configFingerprint,
    } });
  } };
}

/** Plans the pool up to `poolIndex` and allocates that slot inside the caller's authority transaction. */
export function admitFixtureSlot(repositories: AuthorityRepositories, workflow: string, poolIndex: number, now: string) {
  const pool = repositories.workerPools.get(workflow);
  if ((pool?.desiredWorkers ?? 0) < poolIndex) repositories.workerPools.plan({ workflow, expectedVersion: pool?.version ?? 0,
    desiredWorkers: poolIndex, requestedBy: "local-operator", now });
  return repositories.workerSlots.allocate({ workflow, poolIndex, now });
}
