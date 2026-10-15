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

export function testWorkerPorts(database: AuthorityDatabase, clock: Clock, input: Readonly<{
  path: string; descriptor: AnyWorkflowDescriptor; poolIndex: number;
}>) {
  const runtimeConfig = database.authority.runtimeConfig.get() ?? database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const slot = database.withAuthorityTransaction(repositories => {
    const current = repositories.workerPools.get(input.descriptor.id);
    const admitted = admitDirectWorker(repositories, { commandId: randomUUID(), workflow: input.descriptor.id,
      poolIndex: input.poolIndex, expectedPoolVersion: current?.version ?? 0, processId: process.pid,
      processAcquisitionId: randomUUID(), authorityPath: realpathSync(input.path),
      processLockRoot: join(dirname(realpathSync(input.path)), "locks"), now: clock.now().toISOString() }, randomUUID());
    if (repositories.workerLeases.get(admitted.workerId) === undefined) {
      const lease = repositories.workerLeases.start({ workerId: admitted.workerId, workflow: input.descriptor.id,
        browserSystems: workflowProjections(input.descriptor).systems, processId: process.pid,
        requestedBy: "local-operator", now: clock.now().toISOString() });
      assert.equal(lease.state, "started");
    }
    return admitted;
  });
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
