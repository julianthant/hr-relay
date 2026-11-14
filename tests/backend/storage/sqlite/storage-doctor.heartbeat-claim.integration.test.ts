import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { it, vi } from "vitest";
import { z } from "zod";
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
import { testProcessImport } from "../../../support/compiled-process.js";
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

type HeartbeatMode = "interval" | "during" | "process" | "twelve" | "work";

async function claimWhilePeerHeartbeats(mode: HeartbeatMode) {
  const world = createWorkerDirectiveTestWorld();
  let timer: ReturnType<typeof setInterval> | undefined;
  let child: ChildProcess | undefined;
  try {
    const otherProcess = mode === "process" || mode === "work";
    const h = await world.loopHarness(otherProcess ? { sharedMachine: true } : {});
    const a = h.authority;
    const runtimeConfig = selectRunRuntime(a.database.authority);
    const peerCount = mode === "twelve" ? 12 : 1;
    const peers: Array<{ runId: string; workerId: string; claimGeneration: number; renew: () => void }> = [];
    for (let index = 0; index < peerCount; index += 1) {
      const enqueued = a.database.authority.runs.enqueue(personLookupQueuedRun({ runId: randomUUID(), itemId: randomUUID() }));
      assert.equal(enqueued.state, "inserted");
      emitQueued(a.database, a.clock, enqueued.record);
      const peer = testAdmittedWorker(a.database, a.clock, {
        path: a.path, workflow: personLookupDescriptor.id, poolIndex: index + 2,
        browserSystems: workflowProjections(personLookupDescriptor).systems,
      });
      const peerRun = requireLifecycleApplied(h.deps.lifecycle.claimNext({
        commandId: randomUUID(), workflow: personLookupDescriptor.id, workerId: peer.workerId, runtimeConfig,
      }));
      assert.equal(peerRun.claimGeneration, 1);
      const held = { workerId: peer.workerId, claimGeneration: peerRun.claimGeneration };
      const runId = peerRun.envelope.runId;
      peers.push({ runId, workerId: peer.workerId, claimGeneration: peerRun.claimGeneration, renew: () => {
        requireLifecycleApplied(h.deps.lifecycle.renewClaim({ commandId: randomUUID(), runId, claim: held }));
      } });
    }
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
    }, a.clock, boundProfileCredentials(a.profile.admission), a.database);
    const counts = { observations: 0, passesWithPeerCommits: 0, reprepared: [] as number[] };
    let heartbeats = 0;
    let resolveHeartbeat: (() => void) | undefined;
    const firstHeartbeat = new Promise<void>(resolve => { resolveHeartbeat = resolve; });
    const first = peers[0];
    assert.ok(first);
    const renew = () => { first.renew(); heartbeats += 1; resolveHeartbeat?.(); };
    if (otherProcess) {
      child = fork(fileURLToPath(new URL("../../../support/processes/owner-image-heartbeat-peer.ts", import.meta.url)),
        [String(a.profile.lifetime.port)],
        { execArgv: ["--import", testProcessImport()], stdio: ["ignore", "inherit", "inherit", "ipc"] });
      const peerProcess = child;
      const heard = once(peerProcess, "message", { signal: AbortSignal.timeout(20_000) });
      await a.profile.lifetime.share(peerProcess);
      const listening = z.union([
        z.strictObject({ type: z.literal("listening") }),
        z.strictObject({ type: z.literal("failed"), message: z.string() }),
      ]).parse((await heard)[0]);
      if (listening.type === "failed") throw new Error(listening.message);
      peerProcess.send({
        workspace: a.profile.workspace, profileId: a.profile.admission.profileBinding.profileId, path: a.path,
        now: a.clock.now().toISOString(), runId: first.runId, workerId: first.workerId, claimGeneration: first.claimGeneration,
        ...(mode === "work" ? { work: true } : {}),
      });
      const ready = z.union([
        z.strictObject({ type: z.literal("ready") }),
        z.strictObject({ type: z.literal("failed"), message: z.string() }),
      ]).parse((await once(peerProcess, "message", { signal: AbortSignal.timeout(20_000) }))[0]);
      if (ready.type === "failed") throw new Error(ready.message);
    }
    let renewed = 0;
    let renewing = false;
    if (mode === "twelve") {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const prepare = DatabaseSync.prototype.prepare;
      vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function renewDuringRead(this: DatabaseSync, ...args: Parameters<DatabaseSync["prepare"]>) {
        if (!renewing && (this.location() ?? "").includes("relay-readonly-authority-") && renewed < peers.length) {
          renewing = true;
          try { while (renewed < peers.length) peers[renewed++]?.renew(); }
          finally { renewing = false; }
        }
        return prepare.apply(this, args);
      });
    }
    const admission = createPreflightAdmission({
      clock: a.clock, scheduler: h.scheduler, validate() {},
      runners: () => PREFLIGHT_CHECKS.filter(spec => requiredPreflightChecks(["executor.run"]).includes(spec.id)).map(spec => ({
        check: spec.id, kind: spec.runner,
        async run(check) {
          if (spec.id !== "authority.health") return { check: spec.id, state: "healthy", summary: "Fixture healthy" };
          // The child commits on its own loop. Count passes until one holds a commit; one pass overlaps only by timing.
          const peerOverlapPassLimit = mode === "process" || mode === "work" ? 32 : 1;
          let observation: Awaited<ReturnType<AuthorityHealthPreflightRunner["run"]>> | undefined;
          for (let pass = 0; pass < peerOverlapPassLimit; pass += 1) {
            counts.observations++;
            const startedAt = a.database.getMeta().authorityGeneration;
            const checking = doctor.run(check);
            if (mode === "during") renew();
            observation = await checking;
            // A peer process must have committed while this pass read its owner image.
            if (a.database.getMeta().authorityGeneration > startedAt) {
              counts.passesWithPeerCommits++;
              break;
            }
          }
          if (observation === undefined) throw new Error("storage doctor produced no observation");
          return observation;
        },
      })),
    });
    const request = { commandId: randomUUID(), workflow: personLookupDescriptor.id, workerId: h.deps.workerId, runtimeConfig };
    timer = mode === "interval" ? setInterval(renew, WORKER_HEARTBEAT_INTERVAL_MS) : undefined;
    const result = await claimWithPreflight({
      signal: h.stop.signal, onObservationChanged: attempt => { counts.reprepared.push(attempt); },
      preflight: {
        admission, currentScope: () => scope, runScope: () => scope, descriptor: () => personLookupDescriptor,
        prepareSession: async () => { throw new Error("no session should prepare"); },
      },
      prepareRun: async () => { if (mode === "interval") await firstHeartbeat; },
      claim: admit => h.deps.lifecycle.claimNext(request, admit),
    });
    if (child !== undefined) {
      child.send("stop");
      const counted = z.union([
        z.strictObject({ type: z.literal("count"), count: z.number().int().nonnegative() }),
        z.strictObject({ type: z.literal("failed"), message: z.string() }),
      ]).parse((await once(child, "message", { signal: AbortSignal.timeout(20_000) }))[0]);
      if (counted.type === "failed") throw new Error(counted.message);
      assert.ok(counted.count >= 1);
      assert.ok(counts.passesWithPeerCommits >= 1, "no peer commit landed inside a doctor pass");
    }
    const stored = a.database.authority.runs.get(target.envelope.runId);
    assert.ok(stored);
    const workerId = stored.lifecycle.state === "claimed" || stored.lifecycle.state === "running"
      ? stored.lifecycle.workerId : stored.lifecycle.state;
    const code = "code" in result ? result.code : "";
    console.log(`heartbeat-claim ${mode} observationChanges=${String(counts.reprepared.length)} doctorPasses=${String(counts.observations)} heartbeats=${String(heartbeats)} renewed=${String(renewed)} result=${result.state} code=${code}`);
    assert.equal(counts.reprepared.length, 0);
    if (mode === "interval") assert.ok(heartbeats >= 1);
    if (mode === "twelve") assert.equal(renewed, peers.length);
    assert.deepEqual(
      { state: result.state, workerId, claimGeneration: stored.claimGeneration },
      { state: "applied", workerId: h.deps.workerId, claimGeneration: 1 },
    );
  } finally {
    if (timer !== undefined) clearInterval(timer);
    vi.restoreAllMocks();
    if (child !== undefined && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await world.cleanup();
  }
}

it("applies a claim while the only concurrent writer is a peer heartbeat at the production interval", async () => {
  await claimWhilePeerHeartbeats("interval");
});

it("applies a claim when a peer heartbeat lands inside every storage-doctor pass", async () => {
  await claimWhilePeerHeartbeats("during");
});

it("applies a claim while another process renews a peer claim for the whole claim", async () => {
  await claimWhilePeerHeartbeats("process");
});

it("applies a claim while twelve peer heartbeats land inside the doctor reads", async () => {
  await claimWhilePeerHeartbeats("twelve");
});

it("applies a claim while another process advances a peer run for the whole claim", async () => {
  await claimWhilePeerHeartbeats("work");
});
