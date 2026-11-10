import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { it } from "vitest";
import { WORKER_HEARTBEAT_INTERVAL_MS } from "../../../../src/backend/app/composition/worker-compose.js";
import { claimWithPreflight } from "../../../../src/backend/app/preflight/worker-admission.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import type { Clock } from "../../../../src/rules/time/clock.js";
import { PREFLIGHT_CHECKS } from "../../../../src/models/runtime/runtime-dependencies.js";
import { requiredPreflightChecks } from "../../../../src/models/preflight/preflight.js";
import { createPreflightAdmission, PreflightAdmissionScopeSchema } from "../../../../src/rules/preflight/preflight-admission.js";
import { workflowProjections } from "../../../../src/workflow-kit/workflow.js";
import { UUID_5, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { createWorkerDirectiveTestWorld } from "../../../support/helpers/backend/worker-directive-world.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

function emitQueued(database: AuthorityDatabase, clock: Clock, run: RunRecord) {
  const e = run.envelope;
  createTimelineEmitter({ repository: database.authority.timelineEvents, clock }).emit({
    t: "run.queued", kind: "run", ts: e.enqueuedAt, workflow: e.workflow, runId: e.runId, attempt: e.attempt,
    traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: e.dryRun,
    actorId: "local-operator", title: "Heartbeat claim fixture", descriptorVersion: e.descriptorVersion,
    contractFingerprint: e.contractFingerprint, resolvedInstance: e.resolvedInstance,
    configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId,
  });
}

async function claimWhilePeerHeartbeats(duringPass: boolean) {
  const world = createWorkerDirectiveTestWorld();
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
  const h = await world.loopHarness();
  const a = h.authority;
  const runtimeConfig = selectRunRuntime(a.database.authority);
  const peerEnqueued = a.database.authority.runs.enqueue(personLookupQueuedRun({ runId: UUID_5, itemId: UUID_7 }));
  assert.equal(peerEnqueued.state, "inserted");
    emitQueued(a.database, a.clock, peerEnqueued.record);
  const peer = testAdmittedWorker(a.database, a.clock, {
    path: a.path, workflow: personLookupDescriptor.id, poolIndex: 2,
    browserSystems: workflowProjections(personLookupDescriptor).systems,
  });
  const peerRun = requireLifecycleApplied(h.deps.lifecycle.claimNext({
    commandId: randomUUID(), workflow: personLookupDescriptor.id, workerId: peer.workerId, runtimeConfig,
  }));
  assert.equal(peerRun.claimGeneration, 1);
  assert.ok(peerRun.lifecycle.state === "claimed");
  const held = { workerId: peer.workerId, claimGeneration: peerRun.claimGeneration };
  const targetEnqueued = a.database.authority.runs.enqueue(personLookupQueuedRun());
  assert.equal(targetEnqueued.state, "inserted");
    emitQueued(a.database, a.clock, targetEnqueued.record);
  const target = targetEnqueued.record;
  const scope = PreflightAdmissionScopeSchema.parse({
    configSnapshotId: target.envelope.configSnapshotId, configFingerprint: target.envelope.configFingerprint,
    descriptorFingerprint: target.envelope.contractFingerprint, requestedCapabilities: ["executor.run"],
  });
  const doctor = new AuthorityHealthPreflightRunner(a.profile.admission, {
    stateRootTrustAnchor: a.profile.workspace, stateRoot: a.stateRoot, authorityPath: a.path,
    backupDirectory: join(a.stateRoot, "backups", "authority"), busyTimeoutMs: 250,
  }, a.clock, boundProfileCredentials(a.profile.admission));
  const counts = { observations: 0, reprepared: [] as number[] };
  const renew = () => requireLifecycleApplied(h.deps.lifecycle.renewClaim({
    commandId: randomUUID(), runId: peerRun.envelope.runId, claim: held,
  }));
  const admission = createPreflightAdmission({
    clock: a.clock, scheduler: h.scheduler, validate() {},
    runners: () => PREFLIGHT_CHECKS.filter(spec => requiredPreflightChecks(["executor.run"]).includes(spec.id)).map(spec => ({
      check: spec.id, kind: spec.runner,
      async run(check) {
        if (spec.id !== "authority.health") return { check: spec.id, state: "healthy", summary: "Fixture healthy" };
        counts.observations++;
        const checking = doctor.run(check);
        if (duringPass) renew();
        return checking;
      },
    })),
  });
  const request = { commandId: randomUUID(), workflow: personLookupDescriptor.id, workerId: h.deps.workerId, runtimeConfig };
  timer = duringPass ? undefined : setInterval(renew, WORKER_HEARTBEAT_INTERVAL_MS);
    const result = await claimWithPreflight({
      signal: h.stop.signal, onObservationChanged: attempt => { counts.reprepared.push(attempt); },
      preflight: {
        admission, currentScope: () => scope, runScope: () => scope, descriptor: () => personLookupDescriptor,
        prepareSession: async () => { throw new Error("no session should prepare"); },
      },
      prepareRun: async () => undefined,
      claim: admit => h.deps.lifecycle.claimNext(request, admit),
    });
    const stored = a.database.authority.runs.get(target.envelope.runId);
    assert.ok(stored);
    const workerId = stored.lifecycle.state === "claimed" || stored.lifecycle.state === "running"
      ? stored.lifecycle.workerId : stored.lifecycle.state;
    const code = "code" in result ? result.code : "";
    console.log(`heartbeat-claim ${duringPass ? "loaded" : "production"} observationChanges=${String(counts.reprepared.length)} doctorPasses=${String(counts.observations)} result=${result.state} code=${code}`);
    assert.deepEqual(
      { state: result.state, workerId, claimGeneration: stored.claimGeneration },
      { state: "applied", workerId: h.deps.workerId, claimGeneration: 1 },
    );
  } finally {
    if (timer !== undefined) clearInterval(timer);
    await world.cleanup();
  }
}

it("applies a claim while the only concurrent writer is a peer heartbeat at the production interval", async () => {
  await claimWhilePeerHeartbeats(false);
});

it("applies a claim when a peer heartbeat lands inside every storage-doctor pass", async () => {
  await claimWhilePeerHeartbeats(true);
});
