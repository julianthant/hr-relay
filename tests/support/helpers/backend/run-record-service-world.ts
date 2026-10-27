import { createBoundProfileFixture } from "../admission-fixture.js";
import { fenceWriteFixture } from "../write-fence-fixture.js";
import { releaseSeededWriteOwners } from "../timeline-write-fixture.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { protectedSubjectDisplay } from "../../../../src/backend/runs/start/protected-input.js";
import { retainedRunProtectedBindings } from "../../../../src/models/write-safety/protected-input.js";
import { RunRecordService, type CreateRunRequest } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { RuntimeConfigClaimTokenSchema } from "../../../../src/models/config/runtime-generation.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT, NOW, UUID_1, UUID_6, HASH_C, LATER, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, WORKFLOW_ID } from "../../fixtures/phase1f-run-fixtures.js";
import { testWorkerLifetime, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../registered-workflows.js";
import { AuthorityDatabase, type AuthorityLifecycleHooks, type AuthorityTerminalizationHooks } from "../synthetic-storage-admission.js";
import { on, once } from "node:events";
import { Worker } from "node:worker_threads";
import { z } from "zod";



export const CANONICAL_WORKER_ID = "person-lookup-worker-1";
const WORKER_ID = CANONICAL_WORKER_ID;

export function createRunRecordServiceTestWorld() {
  const cleanups: (() => void | Promise<void>)[] = [];
  const serviceDatabases = new WeakMap<RunRecordService, AuthorityDatabase>();

  async function fixture(
    terminalizationHooks?: AuthorityTerminalizationHooks,
    lifecycleHooks?: AuthorityLifecycleHooks,
  ) {
    const profile = await createBoundProfileFixture({ sharedMachine: true });
    const root = profile.stateRoot;
    cleanups.push(async () => await profile.close());
    const clock = manualClock(new Date(NOW));
    const database = AuthorityDatabase.open(
      { path: join(root, "state.db"), migrationOwner: "unit-test", busyTimeoutMs: 250 },
      clock,
      undefined,
      terminalizationHooks,
      lifecycleHooks,
    );
    cleanups.push(() => {
      releaseSeededWriteOwners(database, clock.now().toISOString());
      database.close();
    });
    const active = database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    testWorkerPorts(database,clock,{path:join(root,"state.db"),descriptor:personLookupDescriptor,poolIndex:1});
    const runtimeConfig = RuntimeConfigClaimTokenSchema.parse({
      generation: active.generation, settingsRevision: active.settingsRevision,
      settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint,
    });
    let next = 100;
    const published: RunRecord[] = [];
    const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const service = new RunRecordService({ database, clock,
      ids: { uuid: () => `10000000-0000-4000-8000-${String(next++).padStart(12, "0")}` },
      publishQueued: (run) => {
        assert.equal(database.authority.runs.get(run.envelope.runId)?.version, 1);
        const display = protectedSubjectDisplay(retainedRunProtectedBindings(run), () => ({ title: "Synthetic run" }));
        emitter.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, ...display }));
        database.afterAuthorityCommit(() => published.push(run));
      },
    });
    serviceDatabases.set(service, database);
    const request: CreateRunRequest = {
      commandId: UUID_1, code: "pl", matchKey: "synthetic-item", workflow: WORKFLOW_ID,
      descriptorVersion: QUEUED_RUN.envelope.descriptorVersion,
      contractFingerprint: QUEUED_RUN.envelope.contractFingerprint,
      configFingerprint: CONFIG_SNAPSHOT.fingerprint,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
      resolvedInstance: RunRecordSchema.parse(QUEUED_RUN).envelope.resolvedInstance,
      priority: "bulk", shape: "single", dryRun: true,
      input: QUEUED_RUN.input, runtimeConfig,
    };
    return { database, service, clock, request, runtimeConfig, published, root };
  }

  function created(service: RunRecordService, request: CreateRunRequest) {
    const outcome = service.create(request);
    assert.equal(outcome.state, "applied");
    if (outcome.state !== "applied") throw new Error("create did not apply");
    return outcome.run;
  }

  function runningRun(service: RunRecordService, request: CreateRunRequest, runtimeConfig: unknown) {
    const database = serviceDatabases.get(service);
    if (database === undefined) throw new Error("run-service-fixture-owner-missing");
    const lifetime = testWorkerLifetime(database, WORKFLOW_ID, 1);
    const run = created(service, {
      ...request,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    });
    const claim = service.claimNext({
      commandId: "82000000-0000-4000-8000-000000000001",
      workflow: WORKFLOW_ID,
      workerId: WORKER_ID,
      workerLifetime: lifetime.workerLifetime,
      runtimeConfig,
    });
    if (claim.state !== "applied") throw new Error("claim refused");
    const validating = service.workerTransition({
      commandId: "82000000-0000-4000-8000-000000000002",
      runId: run.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
    });
    if (validating.state !== "applied") throw new Error("validating transition refused");
    const running = service.workerTransition({
      commandId: "82000000-0000-4000-8000-000000000003",
      runId: run.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: {
        state: "running",
        workerId: WORKER_ID,
        claimedAt: NOW,
        heartbeatAt: NOW,
        currentNodeId: "crm-dates",
      },
    });
    if (running.state !== "applied") throw new Error("running transition refused");
    return running.run;
  }

  function parkedWriteIntent(database: AuthorityDatabase, run: RunRecord,
    input: Readonly<{ writeIntentId: string; code: "unknown" | "operator-required"; message: string }>) {
    const proof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: run.envelope.runId,
      attempt: run.envelope.attempt, afterPrepareSpanPath: `${run.envelope.traceId}/termination/prepare` };
    const bindingProofDigest = deriveWriteBindingProofDigest(proof);
    const intent = { ...WRITE_INTENT_ATTEMPTING, writeIntentId: input.writeIntentId,
      workflowId: run.envelope.workflow, itemId: run.envelope.itemId, runId: run.envelope.runId,
      runAttempt: run.envelope.attempt, bindingProof: proof, bindingProofDigest };
    database.withAuthorityTransaction(repositories => {
      fenceWriteFixture(database, { intent, attempt: { ...WRITE_ATTEMPT, writeIntentId: intent.writeIntentId,
        runId: intent.runId, runAttempt: intent.runAttempt, bindingProof: proof, bindingProofDigest } });
      repositories.writeIntents.parkAttempt({ writeIntentId: intent.writeIntentId, generation: intent.generation,
        expectedVersion: intent.version, code: input.code, message: input.message, now: NOW,
        authorityReason: deriveWriteAuthorityReason(input.code === "unknown" ? "post-click-verifier-unknown"
          : "manual-confirmation-required", "probe", input.message) });
    });
    const parked = database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(parked && parked.status === "parked");
    return parked;
  }

  const RaceEventSchema = z.discriminatedUnion("type", [
    z.strictObject({ type: z.enum(["ready", "reserved"]) }),
    z.strictObject({ type: z.literal("error"), message: z.string() }),
    z.strictObject({ type: z.literal("result"), outcome: z.discriminatedUnion("state", [
      z.strictObject({ state: z.enum(["applied", "applied-already"]), run: RunRecordSchema }),
      z.strictObject({ state: z.literal("refused"), refusal: z.strictObject({ reason: z.enum(["none-eligible", "lost"]) }) }),
    ]) }),
  ]);

  async function raceConnection(data: unknown) {
    const worker = new Worker(new URL("../../../support/processes/run-record-race-worker.ts", import.meta.url), { workerData: data, execArgv: ["--import", "tsx"] });
    const events = on(worker, "message");
    const connection = {
      worker,
      close: async () => {
        try {
          if (worker.threadId === -1) throw new Error("race worker exited before close");
          const exited = once(worker, "exit");
          worker.postMessage("close");
          const [code] = z.tuple([z.number().int()]).parse(await exited);
          assert.equal(code, 0, "race worker close failed");
        } catch (error) {
          await worker.terminate();
          throw error;
        } finally {
          const closeEvents = events.return?.bind(events);
          assert.ok(closeEvents, "race worker message iterator must support close");
          await closeEvents();
        }
      },
      next: async () => {
        const event = await events.next();
        if (event.done) throw new Error("race worker ended before its expected event");
        return RaceEventSchema.parse(event.value[0]);
      },
    };
    try {
      return { ...connection, ready: await connection.next() };
    } catch (error) {
      await worker.terminate();
      throw error;
    }
  }

  async function closeRaceConnections(connections: Awaited<ReturnType<typeof raceConnection>>[], releases: SharedArrayBuffer[]) {
    for (const release of releases) {
      Atomics.store(new Int32Array(release), 0, 1);
      Atomics.notify(new Int32Array(release), 0);
    }
    const closed = await Promise.allSettled(connections.map(connection => connection.close()));
    for (const result of closed) if (result.status === "rejected") throw result.reason;
  }

  function failureTerminalRequest(run: RunRecord, commandId: string) {
    return {
      kind: "failure" as const,
      commandId,
      terminal: {
        failure: {
          failureId: UUID_6,
          fingerprint: HASH_C,
          runId: run.envelope.runId,
          traceId: run.envelope.traceId,
          attempt: run.envelope.attempt,
          workflowId: run.envelope.workflow,
          nodeId: "crm-dates",
          taskId: "crm/read-onboarding-dates",
          code: "CRM_UNAVAILABLE",
          summary: "CRM onboarding dates were unavailable",
          transient: true,
          writeState: "not-attempted",
          causeChain: [{
            code: "CRM_UNAVAILABLE",
            summary: "CRM returned an unavailable response",
            role: "primary",
            transient: true,
          }],
          remediation: [{ kind: "retry-when-served", message: "Retry after CRM is available" }],
          occurredAt: LATER,
        },
        authorization: {
          kind: "failed" as const,
          runId: run.envelope.runId,
          workflowId: run.envelope.workflow,
          attempt: run.envelope.attempt,
          descriptorVersion: run.envelope.descriptorVersion,
          contractFingerprint: run.envelope.contractFingerprint,
          expectedVersion: run.version,
          claim: { workerId: WORKER_ID, claimGeneration: 1 },
          authorizedAt: LATER,
          failureId: UUID_6,
        },
      },
    };
  }
  const cleanup = async () => {
    const failures: unknown[] = [];
    for (const dispose of [...cleanups].reverse()) {
      try { await dispose(); cleanups.splice(cleanups.indexOf(dispose), 1); }
      catch (error) { failures.push(error); }
    }
    if (failures.length !== 0) throw new AggregateError(failures, "run-service-fixture-closure-unproved");
  };
  return { cleanups, fixture, created, runningRun, parkedWriteIntent, raceConnection, closeRaceConnections, failureTerminalRequest, cleanup };
}
