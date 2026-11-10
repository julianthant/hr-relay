import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { requireLifecycleApplied } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { testRunLifecycle } from "../fixtures/run-lifecycle-fixtures.js";

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const parentStop = new AbortController();
  const lifetime = await WorkerRuntimeLifetimeLock.receive(z.coerce.number().int().positive().parse(process.argv[2]), () => {
    parentStop.abort(new Error("heartbeat peer parent disconnected"));
  });
  if (process.send === undefined) throw new Error("heartbeat peer requires ipc");
  const send = process.send.bind(process);
  try {
    parentStop.signal.throwIfAborted();
    send({ type: "listening" });
    const request = z.strictObject({
      workspace: z.string(), profileId: z.string(), path: z.string(), now: z.string(),
      runId: z.string(), workerId: z.string(), claimGeneration: z.number().int().positive(),
      work: z.boolean().optional(),
    }).parse((await once(process, "message"))[0]);
    const clock = manualClock(new Date(request.now));
    const machine = acquireSharedRuntimeAdmission(request.workspace, lifetime);
    const admission = machine.admitProfile(request.profileId);
    const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
    const database = AuthorityDatabase.open(admission, { path: request.path, busyTimeoutMs: 5000, migrationOwner: "owner-image-heartbeat-peer" },
      clock, undefined, undefined, undefined, credentials);
    const lifecycle = testRunLifecycle(database, clock);
    const claim = { workerId: request.workerId, claimGeneration: request.claimGeneration };
    let stopped = false;
    process.on("message", message => { if (message === "stop") stopped = true; });
    let count = 0;
    const claimed = request.work === true ? database.authority.runs.get(request.runId) : undefined;
    if (request.work === true && (claimed === undefined || claimed.lifecycle.state !== "claimed")) throw new Error("peer-run-not-claimed");
    if (claimed !== undefined && claimed.lifecycle.state === "claimed") {
      const held = { workerId: claimed.lifecycle.workerId, claimedAt: claimed.lifecycle.claimedAt, heartbeatAt: claimed.lifecycle.heartbeatAt };
      requireLifecycleApplied(lifecycle.workerTransition({ commandId: randomUUID(), runId: request.runId, claim,
        lifecycle: { state: "validating", ...held } }));
      requireLifecycleApplied(lifecycle.workerTransition({ commandId: randomUUID(), runId: request.runId, claim,
        lifecycle: { state: "running", ...held, currentNodeId: "crm-dates" } }));
    }
    const envelope = claimed?.envelope;
    const timeline = envelope === undefined ? undefined : createTimelineEmitter({ repository: database.authority.timelineEvents, clock });
    send({ type: "ready" });
    while (!stopped) {
      if (envelope !== undefined && timeline !== undefined) {
        requireLifecycleApplied(lifecycle.renewClaim({ commandId: randomUUID(), runId: request.runId, claim }));
        const spanPath = `${envelope.traceId}/owner-image-work#${String(count + 1)}`;
        const identity = { ts: clock.now().toISOString(), workflow: envelope.workflow, runId: envelope.runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath };
        timeline.emit({ ...identity, t: "span.started", kind: "task", parentSpanPath: envelope.traceId, name: "owner-image-work" });
        timeline.emit({ ...identity, t: "span.ended", kind: "task", parentSpanPath: envelope.traceId, outcome: "done" });
      } else {
        lifecycle.renewClaim({ commandId: randomUUID(), runId: request.runId, claim });
      }
      count += 1;
      await new Promise<void>(resolve => { setImmediate(resolve); });
    }
    try { database.close(); admission.release(); machine.release(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "heartbeat-peer-close-failed";
      send({ type: "failed", message }, () => { process.exit(1); });
      await new Promise<void>(() => {});
    }
    send({ type: "count", count }, () => { process.exit(0); });
  } catch (error) {
    const message = error instanceof Error ? error.message : "heartbeat-peer-failed";
    send({ type: "failed", message }, () => { process.exit(1); });
  }
}
