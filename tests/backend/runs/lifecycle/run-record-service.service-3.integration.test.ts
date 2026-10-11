import assert from "node:assert/strict";
import { on } from "node:events";
import { mkdtempSync,readFileSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import ts from "typescript";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService,lifecycleCommandId,requireLifecycleApplied,runContinuationPort,workerRunLifecyclePort,type CreateRunRequest } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { RuntimeConfigClaimTokenSchema } from "../../../../src/models/config/runtime-generation.js";
import { RunRecordSchema,type RunRecord } from "../../../../src/models/run/record.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { CONFIG_SNAPSHOT,HASH_C,LATER,NOW,UUID_1,UUID_5,UUID_6,WRITE_ATTEMPT,WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN,WORKER_ID,WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import {
AuthorityDatabase,
type AuthorityLifecycleHooks,
type AuthorityTerminalizationHooks,
} from "../../../support/helpers/synthetic-storage-admission.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function fixture(
  terminalizationHooks?: AuthorityTerminalizationHooks,
  lifecycleHooks?: AuthorityLifecycleHooks,
) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "run-record-service-"));
  cleanups.push(() => rmSync(root, { recursive: true }));
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), migrationOwner: "unit-test", busyTimeoutMs: 250 },
    clock,
    undefined,
    terminalizationHooks,
    lifecycleHooks,
  );
  cleanups.push(() => database.close());
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
      emitter.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Synthetic run" }));
      database.afterAuthorityCommit(() => published.push(run));
    },
  });
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
  const run = created(service, {
    ...request,
    descriptorVersion: personLookupDescriptor.version,
    contractFingerprint: personLookupDescriptor.contractFingerprint,
  });
  const claim = service.claimNext({
    commandId: "82000000-0000-4000-8000-000000000001",
    workflow: WORKFLOW_ID,
    workerId: WORKER_ID,
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

const RaceEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.enum(["ready", "reserved"]) }),
  z.strictObject({ type: z.literal("error"), message: z.string() }),
  z.strictObject({ type: z.literal("result"), outcome: z.discriminatedUnion("state", [
    z.strictObject({ state: z.enum(["applied", "applied-already"]), run: RunRecordSchema }),
    z.strictObject({ state: z.literal("refused"), refusal: z.strictObject({ reason: z.enum(["none-eligible", "lost"]) }) }),
  ]) }),
]);

function raceConnection(data: unknown) {
  const worker = new Worker(new URL("../../../support/processes/run-record-race-worker.ts", import.meta.url), { workerData: data, execArgv: ["--import", "tsx"] });
  const events = on(worker, "message");
  return {
    worker,
    next: async () => {
      const event = await events.next();
      if (event.done) throw new Error("race worker ended before its expected event");
      return RaceEventSchema.parse(event.value[0]);
    },
  };
}

describe("canonical run-record service", () => {

  it("table-class coverage drives every public service method and generation class", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const covered = new Set<string>();
    let commandSequence = 100;
    const commandId = () => `99000000-0000-4000-8000-${String(commandSequence++).padStart(12, "0")}`;
    const measure = <T,>(method: string, delta: 0 | 1, call: () => T): T => {
      const before = database.getMeta().authorityGeneration;
      const result = call();
      assert.equal(database.getMeta().authorityGeneration, before + delta, method);
      covered.add(method);
      return result;
    };

    const sourceResult = measure("create", 1, () => service.create({
      ...request,
      commandId: commandId(),
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    }));
    if (sourceResult.state !== "applied") throw new Error("coverage create refused");
    const source = sourceResult.run;
    assert.deepEqual(measure("withRunTreeSnapshot", 0, () => service.withRunTreeSnapshot([source.envelope.runId], runs => runs.map(run => run.envelope.runId))), [source.envelope.runId]);
    measure("read", 0, () => service.read(source.envelope.runId));
    measure("list", 0, () => service.list({ disposition: "live", limit: 10 }));
    const terminal = measure("transition", 1, () => service.transition({
      commandId: commandId(), runId: source.envelope.runId, expectedVersion: source.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    }));
    if (terminal.state !== "applied") throw new Error("coverage transition refused");
    const retry = measure("retry", 1, () => service.retry({
      commandId: commandId(), runId: source.envelope.runId,
      expectedVersion: terminal.run.version, runtimeConfig,
    }, personLookupDescriptor));
    if (retry.state !== "applied") throw new Error("coverage retry refused");
    const settledRetry = service.transition({
      commandId: commandId(), runId: retry.run.envelope.runId, expectedVersion: retry.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    if (settledRetry.state !== "applied") throw new Error("coverage retry setup refused");
    const restart = measure("restart", 1, () => service.restart({
      commandId: commandId(), runId: source.envelope.runId,
      expectedVersion: terminal.run.version, runtimeConfig,
    }, personLookupDescriptor));
    if (restart.state !== "applied") throw new Error("coverage restart refused");
    const settledRestart = service.transition({
      commandId: commandId(), runId: restart.run.envelope.runId, expectedVersion: restart.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    if (settledRestart.state !== "applied") throw new Error("coverage restart setup refused");

    const workerRun = created(service, {
      ...request,
      commandId: commandId(),
      matchKey: "coverage-worker",
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    });
    const claim = measure("claimNext", 1, () => service.claimNext({
      commandId: commandId(), workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig,
    }));
    if (claim.state !== "applied" || claim.run.envelope.runId !== workerRun.envelope.runId) {
      throw new Error("coverage claim refused or selected the wrong run");
    }
    const renewed = measure("renewClaim", 1, () => service.renewClaim({
      commandId: commandId(), runId: workerRun.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration },
    }));
    if (renewed.state !== "applied") throw new Error("coverage renew refused");
    const validating = measure("workerTransition", 1, () => service.workerTransition({
      commandId: commandId(), runId: workerRun.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration },
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
    }));
    if (validating.state !== "applied") throw new Error("coverage worker transition refused");
    const running = service.workerTransition({
      commandId: commandId(), runId: workerRun.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration },
      lifecycle: {
        state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW,
        currentNodeId: "crm-dates",
      },
    });
    if (running.state !== "applied") throw new Error("coverage running transition refused");
    const terminalized = measure("terminalize", 1, () => service.terminalize(
      failureTerminalRequest(running.run, commandId()),
      personLookupDescriptor,
    ));
    if (terminalized.state !== "applied") throw new Error("coverage terminalize refused");

    const recoverable = created(service, { ...request, commandId: commandId(), matchKey: "coverage-requeue" });
    const recoveryClaim = service.claimNext({
      commandId: commandId(), workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig,
    });
    if (recoveryClaim.state !== "applied" || recoveryClaim.run.envelope.runId !== recoverable.envelope.runId) {
      throw new Error("coverage recovery claim refused or selected the wrong run");
    }
    const requeued = measure("requeue", 1, () => service.requeue({
      commandId: commandId(), runId: recoverable.envelope.runId,
      expectedVersion: recoveryClaim.run.version,
      claim: { workerId: WORKER_ID, claimGeneration: recoveryClaim.run.claimGeneration },
      cause: "recovery",
    }));
    if (requeued.state !== "applied") throw new Error("coverage requeue refused");

    const deleted = measure("delete", 1, () => service.delete({
      commandId: commandId(), runId: source.envelope.runId,
      expectedVersion: terminal.run.version,
    }));
    assert.equal(deleted.state, "deleted");
    const purged = measure("purge", 1, () => service.purge({
      commandId: commandId(), evidenceClass: "diagnostic-bundle", bundleId: UUID_6,
    }));
    assert.deepEqual(purged, { state: "purged", evidenceClass: "diagnostic-bundle", purged: 0 });

    const sourceText = readFileSync(join(process.cwd(), "src/backend/runs/lifecycle/run-record-service.ts"), "utf8");
    const sourceFile = ts.createSourceFile("run-record-service.ts", sourceText, ts.ScriptTarget.Latest, true);
    const serviceClass = sourceFile.statements.find((statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === "RunRecordService");
    assert.ok(serviceClass !== undefined);
    const publicMethods = serviceClass.members
      .filter((member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
        && !member.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.PrivateKeyword))
      .map((method) => {
        assert.ok(ts.isIdentifier(method.name), "service public method names remain static identifiers");
        return method.name.text;
      })
      .sort();
    assert.deepEqual([...covered].sort(), publicMethods);
  });

});


describe("worker lifecycle service capability", () => {
  it("separates command authority and stable nested identities", () => {
    const { service } = fixture();
    assert.deepEqual(Object.keys(workerRunLifecyclePort(service)).sort(),
      ["claimNext", "renewClaim", "requeue", "terminalize", "workerTransition"].sort());
    assert.deepEqual(Object.keys(runContinuationPort(service)), ["transition"]);
    assert.equal(lifecycleCommandId("worker", UUID_1), lifecycleCommandId("worker", UUID_1));
    assert.notEqual(lifecycleCommandId("worker", UUID_1), lifecycleCommandId("continuation", UUID_1));
    assert.notEqual(lifecycleCommandId("continuation", UUID_1), UUID_1);
  });

  it("settles admitted cancellation under both fences; outer rollback removes journal and lifecycle", () => {
    const { database, service, request, runtimeConfig } = fixture();
    const run = created(service, request);
    const claimed = requireLifecycleApplied(service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID,
      workerId: WORKER_ID, runtimeConfig }));
    const requested = requireLifecycleApplied(service.transition({ commandId: UUID_6,
      runId: run.envelope.runId, expectedVersion: claimed.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
    const terminal = { kind: "cancelled", commandId: lifecycleCommandId("cancel", run.envelope.runId),
      runId: run.envelope.runId, expectedVersion: requested.version,
      claim: { workerId: WORKER_ID, claimGeneration: claimed.claimGeneration }, endedAt: NOW };
    const generation = database.getMeta().authorityGeneration;
    assert.throws(() => database.withAuthorityTransaction(() => {
      assert.equal(service.terminalize(terminal, personLookupDescriptor).state, "applied");
      throw new Error("outer cancellation rollback");
    }), /outer cancellation rollback/);
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(database.authority.runs.get(run.envelope.runId), requested);
    const settled = requireLifecycleApplied(service.terminalize(terminal, personLookupDescriptor));
    assert.deepEqual(settled.lifecycle, { state: "terminal", outcome: "cancelled", endedAt: NOW });
    const after = database.getMeta().authorityGeneration;
    assert.equal(service.terminalize(terminal, personLookupDescriptor).state, "applied-already");
    assert.deepEqual(service.terminalize({ ...terminal, endedAt: LATER }, personLookupDescriptor),
      { state: "refused", refusal: { reason: "replay-divergent" } });
    assert.equal(database.getMeta().authorityGeneration, after);
  });

  it("finds attempting evidence from an absent run before releasing or cancelling the same item", () => {
    const { database, service, request, runtimeConfig } = fixture();
    const run = created(service, request);
    const claimed = requireLifecycleApplied(service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID,
      workerId: WORKER_ID, runtimeConfig }));
    const requested = requireLifecycleApplied(service.transition({ commandId: UUID_6,
      runId: run.envelope.runId, expectedVersion: claimed.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
    const absentRunId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const bindingProof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: absentRunId };
    const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
    database.authority.writeIntents.fenceAttempt({
      intent: { ...WRITE_INTENT_ATTEMPTING, workflowId: run.envelope.workflow, itemId: run.envelope.itemId,
        runId: absentRunId, bindingProof, bindingProofDigest },
      attempt: { ...WRITE_ATTEMPT, runId: absentRunId, bindingProof, bindingProofDigest },
    });
    assert.equal(database.authority.writeIntents.listByRun(run.envelope.runId).length, 0);
    const generation = database.getMeta().authorityGeneration;
    assert.equal(database.authority.writeIntents.listAttemptingByItem({
      workflowId: run.envelope.workflow, itemId: run.envelope.itemId }).length, 1);
    assert.equal(database.authority.writeIntents.listAttemptingByItem({
      workflowId: run.envelope.workflow, itemId: UUID_1 }).length, 0);
    assert.throws(() => database.authority.writeIntents.listAttemptingByItem({
      workflowId: run.envelope.workflow, itemId: run.envelope.itemId, extra: true }));
    const result = service.requeue({ commandId: lifecycleCommandId("recovery", run.envelope.runId),
      runId: run.envelope.runId, expectedVersion: requested.version, cause: "recovery", staleBefore: LATER });
    assert.equal(result.state, "recovery-required");
    if (result.state !== "recovery-required") throw new Error("Unfinished write intent did not refuse release");
    assert.equal(result.parked, false);
    assert.deepEqual(result.run, requested);
    assert.equal(database.getMeta().authorityGeneration, generation);
  });
});


for (const finishingGeneration of [2, 3]) {
  it(`rejects generation1 after reassignment; generation${finishingGeneration} finishes and Retry preserves completion`, () => {
    const f = fixture(); let next = 20;
    const id = () => `99000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
    let running = runningRun(f.service, f.request, f.runtimeConfig);
    const stale = failureTerminalRequest(running, id());
    for (let generation = 2; generation <= finishingGeneration; generation++) {
      assert.equal(f.service.requeue({ commandId: id(), runId: running.envelope.runId,
        expectedVersion: running.version, cause: "recovery", staleBefore: LATER }).state, "applied");
      const workerId = generation === 2 ? "worker-b" : WORKER_ID;
      const claimed = requireLifecycleApplied(f.service.claimNext({ commandId: id(), workflow: WORKFLOW_ID, workerId, runtimeConfig: f.runtimeConfig }));
      assert.equal(claimed.claimGeneration, generation);
      const claim = { workerId, claimGeneration: generation };
      requireLifecycleApplied(f.service.workerTransition({ commandId: id(), runId: claimed.envelope.runId,
        claim, lifecycle: { state: "validating", workerId, claimedAt: NOW, heartbeatAt: NOW } }));
      running = requireLifecycleApplied(f.service.workerTransition({ commandId: id(), runId: claimed.envelope.runId,
        claim, lifecycle: { state: "running", workerId, claimedAt: NOW, heartbeatAt: NOW, currentNodeId: "crm-dates" } }));
      const before = f.database.getMeta();
      assert.deepEqual(f.service.terminalize(stale, personLookupDescriptor), { state: "refused", refusal: { reason: "lost" } });
      assert.deepEqual(f.database.getMeta(), before);
      assert.equal(f.database.authority.runs.get(running.envelope.runId)?.completion, undefined);
    }
    const current = failureTerminalRequest(running, id());
    current.terminal.authorization.claim = { workerId: finishingGeneration === 2 ? "worker-b" : WORKER_ID, claimGeneration: finishingGeneration };
    const terminal = requireLifecycleApplied(f.service.terminalize(current, personLookupDescriptor));
    assert.equal(terminal.completion?.claim.claimGeneration, finishingGeneration);
    const retry = requireLifecycleApplied(f.service.retry({ commandId: id(), runId: terminal.envelope.runId,
      expectedVersion: terminal.version, runtimeConfig: f.runtimeConfig }, personLookupDescriptor));
    assert.notEqual(retry.envelope.runId, terminal.envelope.runId);
    assert.equal(retry.envelope.retryOf, terminal.envelope.runId);
    assert.equal(retry.completion, undefined);
    assert.deepEqual(f.database.authority.runs.get(terminal.envelope.runId), terminal);
    assert.equal(f.service.terminalize(current, personLookupDescriptor).state, "applied-already");
    const claims = f.database.authority.timelineEvents.page({}).filter((record) => record.payload.kind === "span" && record.payload.event.t === "run.claimed");
    assert.equal(claims.length, finishingGeneration);
    claims.forEach((record, index) => {
      assert.ok(record.payload.kind === "span" && record.payload.event.t === "run.claimed");
      assert.equal(record.payload.event.claimGeneration, index + 1);
    });
  });
}

it("competing connections cannot accept conflicting failure settlements", async () => {
  const f = fixture(); const running = runningRun(f.service, f.request, f.runtimeConfig);
  const firstRequest = failureTerminalRequest(running, "99000000-0000-4000-8000-000000000051");
  const secondRequest = failureTerminalRequest(running, "99000000-0000-4000-8000-000000000052");
  secondRequest.terminal.failure.failureId = UUID_5;
  secondRequest.terminal.authorization.failureId = UUID_5;
  const releases = [new SharedArrayBuffer(4), new SharedArrayBuffer(4)];
  const connections = [firstRequest, secondRequest].map((request, index) => raceConnection({
    path: join(f.root, "state.db"), now: NOW, release: releases[index], runId: running.envelope.runId,
    operation: { kind: "terminal-failure", request: { commandId: request.commandId, terminal: request.terminal } },
  }));
  const [first, second] = connections; assert.ok(first && second && releases[0] && releases[1]);
  try {
    assert.deepEqual(await first.next(), { type: "ready" }); assert.deepEqual(await second.next(), { type: "ready" });
    first.worker.postMessage("run"); assert.deepEqual(await first.next(), { type: "reserved" });
    second.worker.postMessage("run"); const busy = await second.next(); assert.equal(busy.type, "error");
    if (busy.type !== "error") throw new Error("competing settlement did not encounter held transaction");
    assert.match(busy.message, /locked|busy/);
    assert.deepEqual(f.database.authority.runs.get(running.envelope.runId), running);
    Atomics.store(new Int32Array(releases[0]), 0, 1); Atomics.notify(new Int32Array(releases[0]), 0);
    const accepted = await first.next(); assert.equal(accepted.type, "result");
    if (accepted.type !== "result") throw new Error("winning settlement missing");
    assert.equal(accepted.outcome.state, "applied");
    Atomics.store(new Int32Array(releases[1]), 0, 1); second.worker.postMessage("run");
    assert.deepEqual(await second.next(), { type: "result", outcome: { state: "refused", refusal: { reason: "lost" } } });
    assert.equal(f.database.authority.failures.listByRun(running.envelope.runId).length, 1);
    assert.equal(f.database.authority.failures.get(UUID_5), undefined);
    assert.equal(f.database.authority.lifecycleJournal.getCommand(secondRequest.commandId), undefined);
  } finally { await Promise.all(connections.map(({ worker }) => worker.terminate())); }
});


describe("current settings selection",()=>{
  for(const operation of ["retry","restart"] as const)it(`${operation} selects active settings and preserves source and journal replay`,()=>{
    const f=settingsFixture();
    try{
      const source=f.create(),terminal=requireLifecycleApplied(f.service.transition({commandId:UUID_5,
        runId:source.envelope.runId,expectedVersion:source.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW}}));
      assert.equal(f.save({"timeouts.taskMs":{set:90000}}).state,"applied");
      const selected=f.database.authority.runtimeConfig.get();assert.ok(selected);
      const request={commandId:"83000000-0000-4000-8000-000000000091",runId:terminal.envelope.runId,
        expectedVersion:terminal.version,runtimeConfig:selectRunRuntime(f.database.authority)};
      const next=requireLifecycleApplied(f.service[operation](request,personLookupDescriptor));
      assert.equal(next.envelope.configSnapshotId,selected.configSnapshotId);
      assert.equal(next.envelope.configFingerprint,selected.configFingerprint);
      assert.notEqual(next.envelope.configSnapshotId,terminal.envelope.configSnapshotId);
      assert.deepEqual(next.input,terminal.input);
      assert.deepEqual(f.database.authority.runs.get(terminal.envelope.runId),terminal);
      assert.equal(f.save({"timeouts.taskMs":{clear:true}}).state,"applied");
      const generation=f.database.getMeta().authorityGeneration;
      assert.deepEqual(requireLifecycleApplied(f.service[operation](request,personLookupDescriptor)),next);
      assert.equal(f.database.getMeta().authorityGeneration,generation);
    }finally{f.close();}
  });
});

it("direct creation selects current settings while exact replay retains the original snapshot",()=>{
  const f=settingsFixture();
  try{
    assert.equal(f.save({"timeouts.taskMs":{set:90000}}).state,"applied");
    const selected=f.database.authority.runtimeConfig.get();assert.ok(selected);
    const request=f.request(),next=created(f.service,request);
    assert.equal(next.envelope.configSnapshotId,selected.configSnapshotId);
    assert.equal(next.envelope.configFingerprint,selected.configFingerprint);
    assert.equal(f.save({"timeouts.taskMs":{clear:true}}).state,"applied");
    const generation=f.database.getMeta().authorityGeneration;
    assert.deepEqual(requireLifecycleApplied(f.service.create(request)),next);
    assert.equal(f.database.getMeta().authorityGeneration,generation);
  }finally{f.close();}
});
