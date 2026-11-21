import { currentBuildId } from "../../../../../src/backend/runtime/build-id.js";


import { WorkerActivitySchema, type WorkerActivity } from "../../../../../src/backend/runtime/workers/worker-messages.js";
import type { Clock } from "../../../../../src/rules/time/clock.js";
import { admitFixtureSlot, testWorkerLifetime } from "../../../fixtures/run-lifecycle-fixtures.js";
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
import { randomUUID } from "node:crypto";
import { taskStoreRegistry } from "../../../../../src/backend/app/registries/task-registry.js";
import { createWorkbookLibraryAdapter } from "../../../../../src/backend/processing/providers/workbook-library-adapter.js";
import { createRunWorkbookService } from "../../../../../src/backend/runs/workbooks.js";
import type { RunExecutorDependencies } from "../../../../../src/backend/runtime/execution/run-executor.js";
import { createWriteSequencer } from "../../../../../src/backend/runtime/writes/write-sequencer.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import { createWorkbookLibraryService } from "../../../../../src/backend/workbooks/workbook-library-service.js";
import { REFERENCE_CHECK_REVIEW_GATE } from "../../../../../src/models/processing/workbooks/reference-check-stop.js";
import { REFERENCE_CHECK } from "../../../../../src/models/processing/workbooks/verify-person.js";
import { UcpathPayPathReadSchema } from "../../../../../src/models/ui/ucpath-paypath.js";
import type { TestClock } from "../../../../../src/rules/time/clock.js";
import type { AnyWorkflowDescriptor } from "../../../../../src/workflow-kit/workflow.js";
import { workStudyWorkflow } from "../../../../../src/workflows/work-study/workflow.js";
import { testRunLifecycle } from "../../../fixtures/run-lifecycle-fixtures.js";
import { canonicalChildExecution } from "../../backend/canonical-child-execution.js";
import { unexpectedWorkbookSync } from "../../backend/workbook-sync.js";
import { duoCeremonyGatesOver } from "../../duo-ceremony-fixtures.js";
import { ManualScheduler, recordingLogger, sessionFactoryHarness, sessionManagerFor } from "../../phase1f-executor-harness.js";
import { protectedSecretSource } from "../../protected-secret-source.js";
import { registeredModule } from "../../registered-workflows.js";


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
  /** The run is already queued; start it instead of enqueueing another. */
  readonly enqueued?: boolean;
}


/* ── the seeded world ────────────────────────────────────────────────────── */

export interface SeedWorld {
  readonly database: AuthorityDatabase;
  readonly authorityPath: string;
  readonly clock: Clock;
  /** Seeded pool members by worker id, with the activity each last reported. */
  readonly workers: Map<string, WorkerActivity>;
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
      buildId: currentBuildId(),
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
    const slot = world.database.withAuthorityTransaction(repositories => admitFixtureSlot(repositories, WORKFLOW_ID, poolIndex, SEEDED_NOW));
    world.workers.set(slot.workerId, { state: "idle" });
  }
  const { workerId } = testWorkerLifetime(world.database, WORKFLOW_ID, poolIndex);
  if (spec.enqueued !== true) enqueueRun(world, spec);
  const claimed = world.database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: SEEDED_NOW });
  if (claimed.state !== "claimed") {
    throw new Error(`seed ${String(spec.seed)} was not claimed by ${workerId}: ${claimed.state}`);
  }
  const runId = claimed.run.envelope.runId;
  if (runId !== uuidOf(spec.seed)) {
    throw new Error(`claimNext took ${runId}, not ${uuidOf(spec.seed)}`);
  }
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const claimFields = { workerId, claimedAt: SEEDED_NOW, heartbeatAt: SEEDED_NOW };

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
  if (!world.workers.has(workerId)) throw new Error("seeded worker lifetime is absent");
  world.workers.set(workerId, WorkerActivitySchema.parse(runId === undefined ? { state: "idle" } : { state: "busy", runId }));
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
    authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "mock seeded park"),
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


/* ── drive: one event at a time on the seeded world, through the seed's own transitions ── */

const QUEUED_SEED = 1;
const RUNNING_SEED = 2;
const DONE_SEED = 3;
const DRIVE_POOL_INDEX = 6;

function seededRun(world: SeedWorld, seedNumber: number): RunRecord {
  const run = world.database.authority.runs.get(uuidOf(seedNumber));
  if (run === undefined) throw new Error(`seeded run ${uuidOf(seedNumber)} is absent`);
  return run;
}

/** Run starting: the seeded queued run is claimed and moved to running. Among rows queued at one instant claimNext takes the lowest id, which is this run. */
export function startQueuedRun(world: SeedWorld): string {
  return startRunning(world, { seed: QUEUED_SEED, title: "EID 10873698 — queued", enqueued: true }, DRIVE_POOL_INDEX, "searching").envelope.runId;
}

/** Step finishing: the running run's open task span ends. */
export function finishRunningStep(world: SeedWorld): string {
  const run = seededRun(world, RUNNING_SEED);
  const traceId = run.envelope.traceId;
  world.spans.emit({
    t: "span.ended", kind: "task", ts: SEEDED_NOW, workflow: WORKFLOW_ID, runId: run.envelope.runId, attempt: 1, traceId,
    spanPath: `${traceId}/searching#1`, outcome: "done",
  });
  return run.envelope.runId;
}

/** The seed's own park: the running Person Lookup run takes the `parked-gate` lifecycle at its task node `cross-verify`.
 * Person Lookup declares no gate; `createDeclaredGateDrive` parks a run at a gate its workflow declares. */
export function parkRunningRunAtGate(world: SeedWorld): string {
  const run = seededRun(world, RUNNING_SEED);
  world.spans.emit({
    t: "gate.opened", ts: SEEDED_NOW, workflow: WORKFLOW_ID, runId: run.envelope.runId, attempt: 1, traceId: run.envelope.traceId,
    spanPath: `${run.envelope.traceId}/cross-verify#1`, gate: "cross-verify",
  });
  const parked = world.database.authority.runs.transition({
    runId: run.envelope.runId, expectedVersion: run.version, claim: claimOf(run),
    lifecycle: { state: "parked-gate", gateId: "cross-verify", resumeAt: "cross-verify", parkedAt: SEEDED_NOW },
    now: SEEDED_NOW,
  });
  if (parked.state !== "applied") throw new Error(`the running run did not park at its gate: ${parked.state}`);
  reportWorker(world, claimOf(run).workerId);
  return run.envelope.runId;
}

/** The notification event a publication drive sends: the seeded done run, verified. */
export function seededDoneNotificationEvent(): { kind: "verified-done"; runId: string; workflowId: string } {
  return { kind: "verified-done", runId: uuidOf(DONE_SEED), workflowId: WORKFLOW_ID };
}


/* ── drive: a run parked at a gate its workflow declares, by the production executor ── */

/** Work-Study declares the operator gate `reference-check-review`; its executor parks there when a picked spreadsheet lacks the employee. */
export const DECLARED_GATE_MODULE = registeredModule(workStudyWorkflow);
export const DECLARED_GATE_DESCRIPTOR: AnyWorkflowDescriptor = DECLARED_GATE_MODULE.descriptor;
export const DECLARED_GATE_ID = REFERENCE_CHECK_REVIEW_GATE;

const GATE_RUN_EMPL_ID = "10000001";
const GATE_RUN_POOL_INDEX = 1;

export interface DeclaredGateDrive {
  /** Starts a Work-Study run through the start plan and the executor, held at its first UCPath read; answers its run id.
   * With `readFails` the held read throws once it is let go, so the run fails instead of parking. */
  start(options?: DeclaredGateStart): Promise<string>;
  /** Lets the held run go on: the executor finishes the read and the reference check and parks at the declared gate. */
  park(): Promise<string>;
  /** Lets a held read go, waits for the run and closes its sessions. Answers how the run failed (rejected, or ended anywhere
   * but parked at its gate) when no caller has seen it; throws only when the sessions could not be closed. */
  close(): Promise<Error | undefined>;
}

export interface DeclaredGateStart { readonly readFails?: boolean }

/** Everything one start owns, recorded as it is acquired so teardown reaches it wherever the start stopped. */
interface DeclaredGateRun {
  release: () => void;
  closeSessions?: () => Promise<void>;
  runId?: string;
  settled?: Promise<RunRecord | undefined>;
  /** A caller of start or park has been told how the run ended, or will be. */
  outcomeSeen: boolean;
  held?: Readonly<{ runId: string; workerId: string }>;
}

export function createDeclaredGateDrive(world: SeedWorld, clock: TestClock, profilePath: string): DeclaredGateDrive {
  const { database } = world;
  const descriptor = DECLARED_GATE_DESCRIPTOR;
  const resolve = (workflowId: string): AnyWorkflowDescriptor | undefined => workflowId === String(descriptor.id) ? descriptor : undefined;
  let owned: DeclaredGateRun | undefined;

  /** Why a settled run is not parked at the declared gate, with the failures it recorded. */
  function notParked(run: RunRecord | undefined, runId: string): Error | undefined {
    if (run?.lifecycle.state === "parked-gate" && String(run.lifecycle.gateId) === DECLARED_GATE_ID) return undefined;
    const failures = database.authority.failures.listByRun(runId).map(failure => `${failure.code}: ${failure.summary}`);
    return new Error(`the run did not park at ${DECLARED_GATE_ID}: ${run?.lifecycle.state ?? "absent"} ${JSON.stringify(failures)}`);
  }

  async function start(options: DeclaredGateStart = {}): Promise<string> {
    if (owned !== undefined) throw new Error("the seeded server already drives one declared-gate run");
    let release = (): void => undefined;
    const released = new Promise<void>(done => { release = done; });
    const current: DeclaredGateRun = { release, outcomeSeen: false };
    owned = current;
    try {
      return await startOwned(current, released, options.readFails === true);
    } catch (error) {
      current.outcomeSeen = true;
      throw error;
    }
  }

  async function startOwned(current: DeclaredGateRun, released: Promise<void>, readFails: boolean): Promise<string> {
    let entered = (): void => undefined;
    const atRead = new Promise<void>(done => { entered = done; });
    const paypath = deterministicPayPathOperations({ read: UcpathPayPathReadSchema.parse({
      pageStateId: "ucpath.paypath.position-data-ready", observedAt: SEEDED_NOW, emplId: GATE_RUN_EMPL_ID, displayedName: "Lee, Jordan",
      position: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
    }) });
    const sessions = sessionFactoryHarness({ ucpath: () => ({ ...createDeterministicUcpathPersonOrgDriver(), ...paypath,
      readPayPathPosition: async (input: Parameters<typeof paypath.readPayPathPosition>[0]) => {
        entered();
        await released;
        if (readFails) throw new Error("the seeded PayPath read failed");
        return paypath.readPayPathPosition(input);
      } }) });
    const manager = await sessionManagerFor(sessions, clock, undefined, undefined, duoCeremonyGatesOver(database, clock));
    current.closeSessions = () => manager.closeAll("worker-stop");
    const scheduler = new ManualScheduler(clock, 0);
    const log = recordingLogger().log;
    const library = createWorkbookLibraryService({ repository: database.authority.workbooks, clock, sync: unexpectedWorkbookSync });
    const runWorkbooks = createRunWorkbookService({ database, clock });
    const base: RunExecutorDependencies = {
      lifecycle: testRunLifecycle(database, clock), descriptor, stores: taskStoreRegistry, authority: database, sessions: manager,
      emitter: world.spans, clock, ids: { uuid: randomUUID }, scheduler, taskDeadlineMs: 60_000, log,
    };
    const writeSequencer = createWriteSequencer({ lifecycle: base.lifecycle, stores: base.stores, authority: database, sessions: manager,
      emitter: world.spans, clock, ids: { uuid: randomUUID }, scheduler, taskDeadlineMs: 60_000, operator: "local-operator", log });
    const execution = canonicalChildExecution({ ...base, taskNotes: world.notes, writeSequencer }, database, profilePath, resolve, undefined, {
      poolIndex: GATE_RUN_POOL_INDEX, workbooks: library,
      protectedSecrets: protectedSecretSource({ profileName: "Synthetic Timekeeper", profileInitials: "TQ" }),
      resources: (_reader, run) => ({ providers: { configSnapshots: database.authority.configSnapshots, idFactory: { next: randomUUID },
        adapters: { "workbooks.library": createWorkbookLibraryAdapter({ repository: database.authority.workbooks, runId: run.envelope.runId, clock,
          references: { runId: run.envelope.runId, write: () => { throw new Error("the reference check must not write a reference"); },
            verifyPerson: command => runWorkbooks.verifyPerson(run, command) } }) } } }) });
    // A reference spreadsheet without the employee: the check reports "not found" and the review gate applies.
    const saved = library.create({ name: "Badge list", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Issued", width: 1, hidden: [], headerRow: 1,
      columnBindings: [{ id: "column-0", sourceColumn: 0, sourceHeader: "eid", fieldId: "eid", basis: "manual" as const }],
      rows: [{ id: "header", cells: [{ value: "eid" }] }, { id: "row-0", cells: [{ value: "10000009" }] }] }] });
    const queued = execution.start(descriptor, { emplId: GATE_RUN_EMPL_ID, effectiveDate: "08/03/2026" }, { dryRun: false, workbookReferences: [{
      entry: 1, typeId: REFERENCE_CHECK.id, libraryId: saved.libraryId, versionId: library.libraryVersion(saved.libraryId).version.id,
      sheetId: "sheet", expectedVersion: library.read(saved.libraryId).version }] });
    const runId = queued.envelope.runId;
    current.runId = runId;
    const settled = execution.execute(queued, new AbortController().signal).then(({ run }) => run);
    current.settled = settled;
    await Promise.race([atRead, settled.then(run => { throw new Error(`the declared-gate run ended before its UCPath read: ${run?.lifecycle.state ?? "absent"}`); })]);
    const lifecycle = database.authority.runs.get(runId)?.lifecycle;
    if (lifecycle?.state !== "running") throw new Error(`the declared-gate run is ${lifecycle?.state ?? "absent"} at its UCPath read, not running`);
    world.workers.set(lifecycle.workerId, WorkerActivitySchema.parse({ state: "busy", runId }));
    current.held = { runId, workerId: lifecycle.workerId };
    return runId;
  }

  async function park(): Promise<string> {
    const current = owned;
    if (current?.held === undefined || current.settled === undefined) throw new Error("no declared-gate run is held at its UCPath read");
    current.release();
    current.outcomeSeen = true;
    const { runId, workerId } = current.held;
    const failure = notParked(await current.settled, runId);
    if (failure !== undefined) throw failure;
    world.workers.set(workerId, WorkerActivitySchema.parse({ state: "idle" }));
    return runId;
  }

  async function close(): Promise<Error | undefined> {
    const current = owned;
    if (current === undefined) return undefined;
    current.release();
    let runFailure: Error | undefined;
    try {
      const run = await current.settled;
      // Released here and not through park: the run still has to reach its gate, and a failed outcome resolves, it does not reject.
      if (!current.outcomeSeen && current.runId !== undefined) runFailure = notParked(run, current.runId);
    } catch (error) {
      if (!current.outcomeSeen) runFailure = error instanceof Error ? error : new Error("the declared-gate run failed", { cause: error });
    }
    // `owned` is cleared only once the sessions are closed, so a failed close can be tried again.
    await current.closeSessions?.();
    owned = undefined;
    return runFailure;
  }

  return { start, park, close };
}
