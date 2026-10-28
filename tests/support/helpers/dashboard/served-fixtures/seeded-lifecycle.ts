import { randomUUID } from "node:crypto";


import { admitDirectWorker } from "../../../../../src/backend/storage/sqlite/worker-slots.js";
import type { Clock } from "../../../../../src/rules/time/clock.js";
import { testWorkerLifetime } from "../../../fixtures/run-lifecycle-fixtures.js";
import { PERSON_LOOKUP_ACTIVE, personLookupTerminalIdentityEvidence } from "../../run-integration-world.js";
import { fenceWriteFixture } from "../../write-fence-fixture.js";
import { browserSessionSpanPath,workerSpanPath } from "../../../../../src/backend/logs/span-emitter.js";
import { buildRunResult } from "../../../../../src/backend/runs/lifecycle/run-result.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/index.js";
import type { RunRecord } from "../../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../../src/models/workflow/checkpoint.js";
import { ReadActiveStatus } from "../../../../../src/models/workflows/person-lookup/read-active-status.js";
import {
BrowserSessionIdSchema,
BrowserSystemIdSchema,
WorkerIdSchema,
WorkflowIdSchema,
} from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import {
deriveIdempotencyKeyDigest,
deriveWriteAuthorityReason,
deriveWriteBindingProofDigest,
} from "../../../../../src/rules/write-safety/write-safety.js";
import { PersonLookupCanonicalInput } from "../../../../../src/workflows/person-lookup/workflow.js";
import { personLookupDescriptor } from "../../registered-workflows.js";
import { CONFIG_FINGERPRINT,CONFIG_SNAPSHOT_ID,CONTRACT_FINGERPRINT,FAILURE_FINGERPRINT,INGRESS_SCHEMA_HASH,SEEDED_AT,SEEDED_NOW,WORKFLOW_ID } from "./seeded-identity.js";


/* ── deterministic identities ────────────────────────────────────────────── */

export function uuidOf(seed: number): string {
  const digits = String(seed).padStart(12, "0");
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4000-8000-${digits}`;
}


function traceOf(seed: number): string {
  const tick = String(seed % 60).padStart(2, "0");
  return `pl-09${tick}${tick}-${String(seed % 10000).padStart(4, "0")}`;
}


type Shape = "single" | "preview" | "operation" | "operation-member";


interface SeedSpec {
  readonly seed: number;
  readonly title: string;
  readonly shape?: Shape;
  readonly parentSeed?: number;
}


/* ── the seeded world ────────────────────────────────────────────────────── */

interface SeedWorld {
  readonly database: AuthorityDatabase;
  readonly authorityPath: string;
  readonly clock: Clock;
  readonly workers: Set<string>;
  readonly spans: ReturnType<typeof createTimelineEmitter>;
  readonly notes: ReturnType<typeof createNoteTimelineWriter>;
}


function enqueueRun(world: SeedWorld, spec: SeedSpec): RunRecord {
  const runId = uuidOf(spec.seed);
  const traceId = traceOf(spec.seed);
  const shape = spec.shape ?? "single";
  const parent = spec.parentSeed === undefined
    ? undefined
    : { runId: uuidOf(spec.parentSeed), tracePrefix: traceOf(spec.parentSeed), edgeId: "members" };

  const inserted = world.database.authority.runs.enqueue({
    envelope: {
      runId,
      workflow: WORKFLOW_ID,
      itemId: uuidOf(spec.seed + 5000),
      traceId,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: CONTRACT_FINGERPRINT,
      resolvedInstance: { ucpath: "prod", crm: "prod" },
      configFingerprint: CONFIG_FINGERPRINT,
      configSnapshotId: CONFIG_SNAPSHOT_ID,
      ...(parent === undefined ? {} : { parent }),
      shape,
      priority: "interactive",
      dryRun: false,
      attempt: 1,
      enqueuedAt: SEEDED_NOW,
    },
    input: {
      raw: { emplId: "10873698" },
      parsed: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        // Synthetic ordinary caller input, carrying the production admission source marker.
        protectedBindings: [],
        value: { mode: "search", crmCheck: true, emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
      ingressSchemaHash: INGRESS_SCHEMA_HASH,
    },
    lifecycle: { state: "queued" },
    claimGeneration: 0,

    runNumber: world.database.authority.runs.nextWorkflowRunNumber(WORKFLOW_ID),
    version: 1,
    createdAt: SEEDED_NOW,
    updatedAt: SEEDED_NOW,
  });

  world.spans.emit({
    t: "run.queued",
    kind: "run",
    ts: SEEDED_NOW,
    workflow: WORKFLOW_ID,
    runId,
    attempt: 1,
    traceId,
    spanPath: traceId,
    itemId: inserted.record.envelope.itemId,
    ...(parent === undefined ? {} : { parentRunId: parent.runId }),
    shape,
    priority: "interactive",
    dryRun: false,
    actorId: "local-operator",
    title: spec.title,
    descriptorVersion: personLookupDescriptor.version,
    contractFingerprint: CONTRACT_FINGERPRINT,
    resolvedInstance: { ucpath: "prod", crm: "prod" },
    configFingerprint: CONFIG_FINGERPRINT,
    configSnapshotId: CONFIG_SNAPSHOT_ID,
  });
  return inserted.record;
}


/** Enqueue → claim → validating → running, through production transitions only. */
function startRunning(world: SeedWorld, spec: SeedSpec, poolIndex: number, nodeId: string): RunRecord {
  if (!world.database.authority.workerSlots.list(WORKFLOW_ID).some(member => member.poolIndex === poolIndex && member.retiredAt === null)) {
    const slot = world.database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
      commandId: randomUUID(), workflow: WORKFLOW_ID, poolIndex,
      expectedPoolVersion: repositories.workerPools.get(WORKFLOW_ID)?.version ?? 0,
      processId: process.pid, now: SEEDED_NOW,
    }, randomUUID()));
    const started = world.database.authority.workerLeases.start({ workerId: slot.workerId, workflow: WORKFLOW_ID,
      browserSystems: ["crm", "ucpath"], processId: process.pid, requestedBy: "local-operator", now: SEEDED_NOW });
    world.workers.add(slot.workerId);
    if (started.state !== "started") throw new Error("seeded worker lifetime did not start");
  }
  const { workerId, workerLifetime } = testWorkerLifetime(world.database, WORKFLOW_ID, poolIndex);
  enqueueRun(world, spec);
  const claimed = world.database.authority.runs.claimNext({
    workflow: WORKFLOW_ID,
    workerId, workerLifetime,
    now: SEEDED_NOW,
  });
  if (claimed.state !== "claimed") {
    throw new Error(`seed ${String(spec.seed)} was not claimed by ${workerId}: ${claimed.state}`);
  }
  const runId = claimed.run.envelope.runId;
  if (runId !== uuidOf(spec.seed)) {
    throw new Error(`claimNext took ${runId}, not the just-enqueued ${uuidOf(spec.seed)}`);
  }
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const claimFields = { workerId, workerLifetime, claimedAt: SEEDED_NOW, heartbeatAt: SEEDED_NOW };

  world.spans.emit({
    t: "run.claimed",
    ts: SEEDED_NOW,
    workflow: WORKFLOW_ID,
    runId,
    attempt: 1,
    traceId: claimed.run.envelope.traceId,
    spanPath: claimed.run.envelope.traceId,
    workerId,
  });

  const validating = world.database.authority.runs.transition({
    runId,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", ...claimFields },
    now: SEEDED_NOW,
  });
  if (validating.state !== "applied") throw new Error(`run ${runId} did not enter validating`);

  const running = world.database.authority.runs.transition({
    runId,
    expectedVersion: validating.run.version,
    claim,
    lifecycle: { state: "running", ...claimFields, currentNodeId: nodeId },
    now: SEEDED_NOW,
  });
  if (running.state !== "applied") throw new Error(`run ${runId} did not enter running`);
  reportWorker(world, workerId, running.run.envelope.runId);
  return running.run;
}

function reportWorker(world: SeedWorld, workerId: string, runId?: string): void {
  const lease = world.database.authority.workerLeases.get(workerId);
  if (lease === undefined) throw new Error("seeded worker lifetime is absent");
  world.database.authority.workerLeases.reportLifecycle({ workerId, leaseGeneration: lease.leaseGeneration, now: SEEDED_NOW,
    lifecycle: { ...(runId === undefined ? { state: "idle" } : { state: "busy", runId }),
      startedAt: lease.lifecycle.startedAt, heartbeatAt: SEEDED_NOW } });
}


function taskSpan(world: SeedWorld, run: RunRecord, node: string, outcome?: "done" | "failed" | "skipped"): void {
  const traceId = run.envelope.traceId;
  const base = {
    ts: SEEDED_NOW,
    workflow: WORKFLOW_ID,
    runId: run.envelope.runId,
    attempt: 1,
    traceId,
  } as const;
  world.spans.emit({
    ...base,
    t: "span.started",
    kind: "task",
    spanPath: `${traceId}/${node}#1`,
    parentSpanPath: traceId,
    name: node,
  });
  if (outcome !== undefined) {
    world.spans.emit({ ...base, t: "span.ended", kind: "task", spanPath: `${traceId}/${node}#1`, outcome });
  }
}


function note(world: SeedWorld, run: RunRecord, level: "step" | "warn" | "error", message: string): void {
  world.notes.emitNote({
    workflow: WORKFLOW_ID,
    address: {
      runId: run.envelope.runId,
      attempt: run.envelope.attempt,
      traceId: run.envelope.traceId,
      spanPath: run.envelope.traceId,
    },
    level,
    message,
  });
}


function claimOf(run: RunRecord): { workerId: string; claimGeneration: number } {
  if (!("workerId" in run.lifecycle)) {
    throw new Error(`run ${run.envelope.runId} holds no claim to authorize a terminal transition`);
  }
  return { workerId: run.lifecycle.workerId, claimGeneration: run.claimGeneration };
}



function fenceAndParkWrite(world: SeedWorld, run: RunRecord): void {
  const runId = run.envelope.runId;
  const idempotencyKey = "10555121|termination|2026-08-03";
  const bindingProof = {
    kind: "subject-match",
    version: 1,
    proofId: uuidOf(907),
    runId,
    attempt: run.envelope.attempt,
    leaseId: uuidOf(908),
    taskId: "ucpath/terminate-person",
    observationId: "ucpath.termination.subject",
    pageStateId: "ucpath.termination-ready",
    expected: {
      kind: "person",
      identifierKind: "eid",
      bindingDigest: "3".repeat(64),
      displaySuffix: "5121",
    },
    observed: {
      kind: "person",
      identifierKind: "eid",
      bindingDigest: "3".repeat(64),
      displaySuffix: "5121",
    },
    match: "match",
    observedAt: SEEDED_NOW,
    afterPrepareSpanPath: "terminate/prepare",
  };
  const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
  const fenced = fenceWriteFixture(world.database, {
    intent: {
      writeIntentId: uuidOf(906),
      workflowId: WORKFLOW_ID,
      itemId: run.envelope.itemId,
      taskId: "ucpath/terminate-person",
      system: "ucpath",
      idempotencyKey,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", idempotencyKey),
      currentAttemptId: uuidOf(909),
      generation: 1,
      runId,
      runAttempt: run.envelope.attempt,
      bindingProof,
      bindingProofDigest,
      fencedAt: SEEDED_NOW,
      status: "attempting",
      version: 1,
      createdAt: SEEDED_NOW,
      updatedAt: SEEDED_NOW,
    },
    attempt: {
      writeAttemptId: uuidOf(909),
      writeIntentId: uuidOf(906),
      generation: 1,
      runId,
      runAttempt: run.envelope.attempt,
      leaseId: uuidOf(908),
      bindingProof,
      bindingProofDigest,
      fencedAt: SEEDED_NOW,
      outcome: { state: "attempting" },
      recordedAt: SEEDED_NOW,
    },
  });
  if (fenced.state !== "fenced") throw new Error(`the seeded write fence answered ${fenced.state}`);
  world.database.authority.writeIntents.parkAttempt({
    writeIntentId: uuidOf(906),
    generation: 1,
    expectedVersion: fenced.intent.version,
    code: "unknown",
    message: "the UCPath write outcome could not be observed",
    authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "parity seeded park"),
    now: SEEDED_NOW,
  });
}



function terminalizeFailed(world: SeedWorld, run: RunRecord, failureId: string): void {
  const summary = "CRM onboarding dates were unavailable";
  world.database.terminalizeFailure(personLookupDescriptor, {
    failure: {
      failureId,
      fingerprint: FAILURE_FINGERPRINT,
      runId: run.envelope.runId,
      traceId: run.envelope.traceId,
      attempt: run.envelope.attempt,
      workflowId: run.envelope.workflow,
      nodeId: "crm-dates",
      taskId: "crm/read-onboarding-dates",
      code: "CRM_UNAVAILABLE",
      summary,
      transient: true,
      writeState: "not-attempted",
      causeChain: [{
        code: "CRM_UNAVAILABLE",
        summary: "CRM returned an unavailable response",
        role: "primary",
        transient: true,
      }],
      remediation: [{ kind: "retry-when-served", message: "Retry after CRM is available" }],
      occurredAt: SEEDED_NOW,
    },
    authorization: {
      kind: "failed",
      runId: run.envelope.runId,
      workflowId: run.envelope.workflow,
      attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      expectedVersion: run.version,
      claim: claimOf(run),
      authorizedAt: SEEDED_NOW,
      failureId,
    },
  });
}



function terminalizeDone(world: SeedWorld, run: RunRecord, _outboxId: string): void {
  const checkpoint = RunCheckpointRecordSchema.parse({
    workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId,
    nodeId: "active-status",
    attempt: run.envelope.attempt,
    claimGeneration: 1,
    runId: run.envelope.runId,
    output: {
      schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"),
      value: PERSON_LOOKUP_ACTIVE,
    },
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: CONTRACT_FINGERPRINT,
    implFingerprint: CONFIG_FINGERPRINT,
    provenance: [{ path: "state", source: "derived", observedAt: SEEDED_NOW, originalObservedAt: SEEDED_NOW }],
    writtenAt: SEEDED_NOW,
  });
  world.database.authority.runCheckpoints.insert(checkpoint);

  const identityEvidence = personLookupTerminalIdentityEvidence(run);
  for (const entry of identityEvidence) {
    if (entry.state === "resolved") world.database.authority.runCheckpoints.insert(entry.checkpoint);
  }
  const built = buildRunResult(
    personLookupDescriptor,
    run,
    [
      ...identityEvidence,
      { state: "resolved", nodeId: "active-status", checkpoint },
      { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
    ],
    manualClock(SEEDED_AT),
  );
  const result = built.record;
  world.database.terminalizeSuccess({
    result,
    authorization: {
      kind: "done",
      runId: result.runId,
      workflowId: result.workflowId,
      attempt: result.attempt,
      descriptorVersion: result.descriptorVersion,
      contractFingerprint: result.contractFingerprint,
      expectedVersion: run.version,
      claim: claimOf(run),
      authorizedAt: SEEDED_NOW,
      resultDigest: result.resultDigest,
    },
  }, built.authorization);
}


// claimNext chooses the oldest queued row, so seed order controls which run is claimed.
export function seed(world: SeedWorld): Record<string, string> {

  const workerSpan = workerSpanPath(
    WorkflowIdSchema.parse(WORKFLOW_ID),
    WorkerIdSchema.parse("person-lookup-worker-1"),
  );
  world.spans.emit({
    t: "span.started",
    kind: "worker",
    ts: SEEDED_NOW,
    workflow: WORKFLOW_ID,
    workerId: "person-lookup-worker-1",
    spanPath: workerSpan,
    name: WORKFLOW_ID,
  });
  world.spans.emit({
    t: "span.started",
    kind: "browser",
    ts: SEEDED_NOW,
    workflow: WORKFLOW_ID,
    workerId: "person-lookup-worker-1",
    spanPath: browserSessionSpanPath(
      WorkflowIdSchema.parse(WORKFLOW_ID),
      WorkerIdSchema.parse("person-lookup-worker-1"),
      BrowserSystemIdSchema.parse("ucpath"),
      BrowserSessionIdSchema.parse(uuidOf(950)),
    ),
    parentSpanPath: workerSpan,
    name: "browser-session:ucpath",
    system: "ucpath",
  });

  // failed — real atomic failure terminalization off a running node.
  const failed = startRunning(world, { seed: 4, title: "EID 10873698" }, 1, "crm-dates");
  taskSpan(world, failed, "searching", "done");
  taskSpan(world, failed, "cross-verify", "done");
  taskSpan(world, failed, "crm-dates", "failed");
  note(world, failed, "step", "opened UCPath person search");
  note(world, failed, "step", "matched EID 10873698");
  note(world, failed, "error", "CRM returned an unavailable response");
  const failureId = uuidOf(904);
  terminalizeFailed(world, failed, failureId);
  reportWorker(world, claimOf(failed).workerId);

  // done — real atomic success terminalization with a factory-sealed result.
  const done = startRunning(world, { seed: 3, title: "Battistessa, Johnnie" }, 2, "active-status");
  taskSpan(world, done, "searching", "done");
  taskSpan(world, done, "cross-verify", "done");
  taskSpan(world, done, "active-status", "done");
  terminalizeDone(world, done, uuidOf(903));
  reportWorker(world, claimOf(done).workerId);

  // running — claimed, executing, one task span still open.
  const running = startRunning(world, { seed: 2, title: "Morrow, Bea" }, 1, "searching");
  taskSpan(world, running, "searching");
  note(world, running, "step", "opened UCPath person search");
  note(world, running, "warn", "two candidates matched; narrowing by department");

  // awaiting-approval — canonical parking plus the matching gate evidence.
  const gated = startRunning(world, { seed: 5, title: "EID 10101010" }, 3, "cross-verify");
  taskSpan(world, gated, "searching", "done");
  world.spans.emit({
    t: "gate.opened",
    ts: SEEDED_NOW,
    workflow: WORKFLOW_ID,
    runId: gated.envelope.runId,
    attempt: 1,
    traceId: gated.envelope.traceId,
    spanPath: `${gated.envelope.traceId}/cross-verify#1`,
    gate: "identity-review",
  });
  const gatedTransition = world.database.authority.runs.transition({
    runId: gated.envelope.runId, expectedVersion: gated.version, claim: claimOf(gated),
    lifecycle: { state: "parked-gate", gateId: "identity-review", resumeAt: "cross-verify", parkedAt: SEEDED_NOW },
    now: SEEDED_NOW,
  });
  if (gatedTransition.state !== "applied") throw new Error("fixture gate transition failed");
  reportWorker(world, claimOf(gated).workerId);


  const parked = startRunning(world, { seed: 6, title: "EID 10555121" }, 4, "cross-verify");
  taskSpan(world, parked, "searching", "done");
  fenceAndParkWrite(world, parked);
  const parkedTransition = world.database.authority.runs.transition({
    runId: parked.envelope.runId,
    expectedVersion: parked.version,
    claim: claimOf(parked),
    lifecycle: {
      state: "parked-write",
      writeIntentId: uuidOf(906),
      intentGeneration: 1,
      parkedAt: SEEDED_NOW,
      code: "unknown",
      message: "the UCPath write outcome could not be observed",
    },
    now: SEEDED_NOW,
  });
  if (parkedTransition.state !== "applied") throw new Error("parked-write transition was refused");
  reportWorker(world, claimOf(parked).workerId);

  // cancelled — a real terminal transition (the arm `transition` still owns).
  const cancelled = startRunning(world, { seed: 7, title: "EID 10222333" }, 5, "searching");
  const cancelTransition = world.database.authority.runs.transition({
    runId: cancelled.envelope.runId,
    expectedVersion: cancelled.version,
    claim: claimOf(cancelled),
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: SEEDED_NOW },
    now: SEEDED_NOW,
  });
  if (cancelTransition.state !== "applied") throw new Error("cancel transition was refused");
  reportWorker(world, claimOf(cancelled).workerId);

  // The group and its members, then the row that must stay queued — enqueued
  // last so no claimNext above could have taken them.
  enqueueRun(world, { seed: 30, title: "Onboarding packet — 3 people", shape: "operation" });
  const memberSeeds = [31, 32, 33];
  for (const memberSeed of memberSeeds) {
    enqueueRun(world, {
      seed: memberSeed,
      title: `Member ${String(memberSeed - 30)}`,
      shape: "operation-member",
      parentSeed: 30,
    });
  }
  enqueueRun(world, { seed: 1, title: "EID 10873698 — queued" });

  return {
    queuedRun: uuidOf(1),
    runningRun: uuidOf(2),
    doneRun: uuidOf(3),
    failedRun: uuidOf(4),
    openGateRun: uuidOf(5),
    parkedRun: uuidOf(6),
    cancelledRun: uuidOf(7),
    groupRun: uuidOf(30),
    memberRun: uuidOf(31),
    failureId,
  };
}
