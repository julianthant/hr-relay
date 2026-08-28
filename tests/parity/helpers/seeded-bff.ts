/**
 * The seeded BFF (ref frontend-backend-integration §7.2, test-only adapter #2): the REAL production
 * dashboard stack — authority SQLite, the span/note JSONL writers, THE
 * run/queue projection, the command kernel, the start-plan service, the SSE
 * hub and `createDashboardApp` — booted on an isolated temp state root and an
 * ephemeral port, serving the built React bundle alongside it.
 *
 * Adapter #1 (`fixture-bff.ts`) proves the app renders a contract; this one
 * proves the contract is what the real machinery actually produces. Nothing
 * here hand-writes a wire payload: every row on screen is the projection's
 * fold over spans this module emitted through the production writer, joined
 * against authority records this module moved through production transitions.
 *
 * Where the real machinery cannot reach a state in the 1i slice, that state is
 * ABSENT rather than faked — see `SEEDED_COVERAGE_GAPS`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import type { Hono } from "hono";
import { buildRunResult } from "../../../src/core/run-result.js";
import { createCommandKernel } from "../../../src/core/command-kernel.js";
import { browserSessionSpanPath, workerSpanPath } from "../../../src/core/span-emitter.js";
import { manualClock } from "../../../src/domain/clock.js";
import {
  BrowserSessionIdSchema,
  BrowserSystemIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../src/domain/ids.js";
import { ReadActiveStatus } from "../../../src/domain/contracts/person-lookup/read-active-status.js";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import {
  deriveIdempotencyKeyDigest,
  deriveWriteBindingProofDigest,
} from "../../../src/domain/write-safety.js";
import { RunCheckpointRecordSchema } from "../../../src/domain/workflow/checkpoint.js";
import { defineWorkflowRole } from "../../../src/domain/workflow/module-role.js";
import { RunTerminalOutboxRecordSchema } from "../../../src/domain/run/terminal-outbox.js";
import type { RunRecord } from "../../../src/domain/run/record.js";
import { createNoteJsonlWriter } from "../../../src/infra/events/note-jsonl-writer.js";
import { createSpanJsonlWriter } from "../../../src/infra/events/span-jsonl-writer.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { createDashboardCommandService } from "../../../src/server/dashboard/commands/command-service.js";
import { createStartPlanService } from "../../../src/server/dashboard/commands/start-plan-service.js";
import { descriptorSetHash } from "../../../src/server/dashboard/compose.js";
import { createReceiptService } from "../../../src/server/trust/receipt-service.js";
import { createDashboardApp } from "../../../src/server/dashboard/routes/api.js";
import { createRunQueueProjection } from "../../../src/server/dashboard/projectors/run-queue-projection.js";
import { createDashboardStreamHub } from "../../../src/server/dashboard/subscriptions/dashboard-stream.js";
import {
  PersonLookupCanonicalInput,
  personLookupDescriptor,
} from "../../../src/workflows/person-lookup/descriptor.js";
import { assertServedBundle, type ParityBundleProof } from "./bundle.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER, UNWIRED_INTAKE_SERVICE } from "../../fixtures/intake-kernel-seams.js";
import { resolveConfig } from "../../../src/domain/config/resolve.js";
import { UNWIRED_CAPTURE_SERVICE } from "../../fixtures/capture-surface-seams.js";
import { explorerQueryDeps, uiCatalogQueryDeps } from "../../fixtures/explorer-seams.js";
import { archiveQueryDeps, archiveSnapshots } from "../../fixtures/archive-seams.js";
import { createLedgerReadThrough } from "../../../src/infra/ledger/ledger-read-through.js";
import { UNOBSERVED_BACKFILL_GAP_NOTIFIER } from "../../fixtures/dashboard-stream-seams.js";

/* ── the pinned instant (aligned with the fixture corpus) ────────────────── */

export const SEEDED_DAY = "2026-08-03";
export const SEEDED_AT = new Date("2026-08-03T10:00:00.000-07:00");
export const SEEDED_NOW = SEEDED_AT.toISOString();
export const SEEDED_APP_VERSION = "0.1.0";

const WORKFLOW_ID = personLookupDescriptor.id;
const CONTRACT_FINGERPRINT = personLookupDescriptor.contractFingerprint;
const CONFIG_FINGERPRINT = "b".repeat(64);
const INGRESS_SCHEMA_HASH = "a".repeat(64);
const FAILURE_FINGERPRINT = "c".repeat(64);
const CONFIG_SNAPSHOT_ID = "44444444-4444-4444-8444-444444444444";

/**
 * States the 1i slice's real machinery CANNOT reach, and why. These are the
 * honest differences between adapter #1's fixture matrix and this adapter; a
 * parity spec must not assert them against the seeded backend.
 */
export const SEEDED_COVERAGE_GAPS: readonly string[] = Object.freeze([
  "status 'partial': the projection's RUN_OUTCOME_STATUS maps no run outcome to it "
  + "(done|failed|cancelled|discarded|superseded|interrupted only), so no real transition produces it",
  "surfaceKind 'preview': the shape is legal but nothing in the 1i slice enqueues a preview run",
  "worker-card states waiting|paused|failed: the projection derives only stopped|working|idle",
  "liveMessage 'present' on a NON-failed row: the projection serves the terminal FailureRecord's "
  + "summary for a failed run (D13) and nothing else authors a live progress sentence, so every other "
  + "status carries a reasoned absence",
  "warnings 'present': the count comes off the run's ALREADY-DERIVED evidence receipt, and this seed "
  + "derives none — D141 makes derivation an on-demand act and the projection never writes authority",
  "subtitle 'present': the start-plan path this seed uses proposes no subtitle",
]);

/* ── deterministic identities ────────────────────────────────────────────── */

function uuidOf(seed: number): string {
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
  readonly spans: ReturnType<typeof createSpanJsonlWriter>;
  readonly notes: ReturnType<typeof createNoteJsonlWriter>;
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
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
      ingressSchemaHash: INGRESS_SCHEMA_HASH,
    },
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    // D230: taken from the REAL counter, inside the same store production
    // reads it from, so the seeded corpus photographs the ordinals a live day
    // would carry rather than a hand-numbered fixture's opinion of them.
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
function startRunning(world: SeedWorld, spec: SeedSpec, workerId: string, nodeId: string): RunRecord {
  enqueueRun(world, spec);
  const claimed = world.database.authority.runs.claimNext({
    workflow: WORKFLOW_ID,
    workerId,
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
  return running.run;
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

/**
 * Fence a permanent write against this run and park it — the ref write-safety §4 shape,
 * through the production repository's own CAS pair.
 *
 * The binding proof is a `subject-match`, which is the arm the operator surface
 * has the most to render: it pins `expected` and `observed` as canonically
 * identical (its own `superRefine` refuses a proof where they differ), so the
 * served subject is a whole fact rather than half of one.
 */
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
  const fenced = world.database.authority.writeIntents.fenceAttempt({
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
    now: SEEDED_NOW,
  });
}

/** The real D110/D114 atomic failure terminalization. */
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

/** The real D110/D114 atomic success terminalization, sealed by the descriptor factory. */
function terminalizeDone(world: SeedWorld, run: RunRecord, outboxId: string): void {
  const checkpoint = RunCheckpointRecordSchema.parse({
    workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId,
    nodeId: "active-status",
    attempt: run.envelope.attempt,
    claimGeneration: 1,
    runId: run.envelope.runId,
    output: {
      schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"),
      value: {
        state: "active",
        reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
        hdh: true,
      },
    },
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: CONTRACT_FINGERPRINT,
    implFingerprint: CONFIG_FINGERPRINT,
    provenance: [{ path: "state", source: "derived", observedAt: SEEDED_NOW, originalObservedAt: SEEDED_NOW }],
    writtenAt: SEEDED_NOW,
  });
  world.database.authority.runCheckpoints.insert(checkpoint);

  const built = buildRunResult(
    personLookupDescriptor,
    run,
    [
      { state: "resolved", nodeId: "active-status", checkpoint },
      { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
    ],
    manualClock(SEEDED_AT),
  );
  const result = built.record;
  const outbox = RunTerminalOutboxRecordSchema.parse({
    outboxId,
    payload: {
      kind: "run-terminal-result",
      runId: result.runId,
      workflowId: result.workflowId,
      attempt: result.attempt,
      resultDigest: result.resultDigest,
    },
    projection: { state: "pending" },
    createdAt: result.createdAt,
  });
  world.database.terminalizeSuccess({
    result,
    outbox,
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
      outboxId,
    },
  }, built.authorization);
}

/**
 * Seeds one run per status the projection can genuinely reach, plus an
 * operation group with members. Order matters: `claimNext` takes the OLDEST
 * queued row, so every run that must LEAVE the queue is enqueued and claimed
 * before the rows that must stay queued are enqueued at all.
 */
function seed(world: SeedWorld): Record<string, string> {
  /*
   * The worker's own spans, composed by the SAME functions the executor emits
   * them with. They were hand-written paths until D248 gave the browser path a
   * reader (`worker/<workflow>/<worker>/browser:<system>#<sessionId>` carries
   * the session identity the tile grid folds), and a fixture that spells a path
   * production never emits is a fixture asserting over a shape the projector
   * would refuse in the field.
   *
   * The card itself is the LEASE (D248): the run below claims through the real
   * `runs.claimNext`, so authority already holds a `person-lookup-worker-1`
   * lease by the time the day is built.
   */
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
  const failed = startRunning(world, { seed: 4, title: "EID 10873698" }, "person-lookup-worker-1", "crm-dates");
  taskSpan(world, failed, "searching", "done");
  taskSpan(world, failed, "cross-verify", "done");
  taskSpan(world, failed, "crm-dates", "failed");
  note(world, failed, "step", "opened UCPath person search");
  note(world, failed, "step", "matched EID 10873698");
  note(world, failed, "error", "CRM returned an unavailable response");
  const failureId = uuidOf(904);
  terminalizeFailed(world, failed, failureId);

  // done — real atomic success terminalization with a factory-sealed result.
  const done = startRunning(world, { seed: 3, title: "Battistessa, Johnnie" }, "person-lookup-worker-2", "active-status");
  taskSpan(world, done, "searching", "done");
  taskSpan(world, done, "cross-verify", "done");
  taskSpan(world, done, "active-status", "done");
  terminalizeDone(world, done, uuidOf(903));

  // running — claimed, executing, one task span still open.
  const running = startRunning(world, { seed: 2, title: "Blirea, Glaundi" }, "person-lookup-worker-1", "searching");
  taskSpan(world, running, "searching");
  note(world, running, "step", "opened UCPath person search");
  note(world, running, "warn", "two candidates matched; narrowing by department");

  // awaiting-approval — a real gate.opened span (row.openGates).
  const gated = startRunning(world, { seed: 5, title: "EID 10001573" }, "person-lookup-worker-3", "cross-verify");
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

  // blocked — a real parked-write lifecycle transition, over a real fenced
  // and parked `write_intents` row.
  //
  // THE ROW IS NOT OPTIONAL, and its absence was a live defect (W2). This
  // adapter has transitioned run 6 to `parked-write` since the seed was
  // written, and `availableSections` advertises the parked-write section from
  // that lifecycle alone — but the serving arm re-reads the intent the park
  // NAMES and throws by design when authority does not hold it (ref write-safety §4.1: a
  // parked run with no intent is a lie, not an empty panel). Nothing had ever
  // opened this run, so nobody had met the 500. It goes through the production
  // repository's own `fenceAttempt` → `parkAttempt` CAS pair rather than an
  // INSERT, because a hand-written row would be exactly the "adapter #2 fakes
  // a state the machinery cannot reach" this file exists to refuse.
  const parked = startRunning(world, { seed: 6, title: "EID 10555121" }, "person-lookup-worker-4", "cross-verify");
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

  // cancelled — a real terminal transition (the arm `transition` still owns).
  const cancelled = startRunning(world, { seed: 7, title: "EID 10222333" }, "person-lookup-worker-5", "searching");
  const cancelTransition = world.database.authority.runs.transition({
    runId: cancelled.envelope.runId,
    expectedVersion: cancelled.version,
    claim: claimOf(cancelled),
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: SEEDED_NOW },
    now: SEEDED_NOW,
  });
  if (cancelTransition.state !== "applied") throw new Error("cancel transition was refused");

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

/* ── static asset serving (mirrors the fixture adapter) ──────────────────── */

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(distDir: string, pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === "/" ? "/index.html" : pathname;
  const target = normalize(join(distDir, relative));
  if (!target.startsWith(normalize(distDir))) {
    res.writeHead(404).end("not found");
    return;
  }
  try {
    const body = await readFile(target);
    const type = CONTENT_TYPES[extname(target)];
    res.writeHead(200, type === undefined ? {} : { "content-type": type }).end(body);
  } catch {
    // A missing asset is a 404, never a silent empty 200 — a parity capture of
    // a blank page must fail loudly rather than be frozen as a reference.
    res.writeHead(404).end("not found");
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function bridge(app: Hono, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  const response = await app.fetch(new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
    method: req.method ?? "GET",
    headers: Object.fromEntries(
      Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    ...(body === undefined ? {} : { body: new Uint8Array(body) }),
  }));
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body === null) {
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  // SSE and other streaming bodies must be piped, not buffered — awaiting the
  // full body of an open event stream would never resolve.
  const reader = response.body.getReader();
  const pump = async (): Promise<void> => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      res.write(Buffer.from(chunk.value));
    }
  };
  res.on("close", () => void reader.cancel().catch(() => undefined));
  await pump();
  res.end();
}

/* ── the server ──────────────────────────────────────────────────────────── */

export interface SeededServer {
  readonly port: number;
  readonly baseUrl: string;
  readonly day: string;
  readonly runIds: Readonly<Record<string, string>>;
  close(): Promise<void>;
}

export async function startSeededServer(
  input: Readonly<{ distDir: string; bundle: ParityBundleProof }>,
): Promise<SeededServer> {
  // Ref frontend-backend-integration §7: the same working-tree proof the fixture adapter demands —
  // asserted before any temp root, database or port exists.
  assertServedBundle(input.distDir, input.bundle);
  const root = mkdtempSync(join(tmpdir(), "hrauto-parity-seeded-"));
  const stateRoot = join(root, ".tracker-rebuild");
  const clock = manualClock(SEEDED_AT);
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 1000, migrationOwner: "parity-seeded-bff" },
    clock,
  );

  const descriptors = {
    resolve: (workflowId: string) => (workflowId === WORKFLOW_ID ? personLookupDescriptor : undefined),
  };
  const projection = createRunQueueProjection({
    stateRoot,
    clock,
    appVersion: SEEDED_APP_VERSION,
    descriptorSetHash: descriptorSetHash([CONTRACT_FINGERPRINT]),
    ledger: createLedgerReadThrough(stateRoot),
    authority: {
      getRun: (runId) => database.authority.runs.get(runId),
      listNotifications: (actorId: string) => database.authority.notifications.listByActor(actorId),
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
      getWorkerLease: (workerId: string) => database.authority.workerLeases.get(workerId),
      listWorkerPools: () => database.authority.workerPools.list(),
      isArchived: (runId: string) => database.authority.archivedRuns.isArchived(runId),
      getFailure: (failureId: string) => database.authority.failures.get(failureId),
      getReceipt: (runId: string) => database.authority.evidenceReceipts.findByRun(runId),
      latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
    descriptors,
    projectionStore: database,
  });
  const jsonlWriter = createSpanJsonlWriter({
    stateRoot,
    clock,
    pid: 4242,
  });
  // D218: the projection's one live feed is the disk tail; the seeder ticks
  // it after every append so each event folds through the production path.
  const spans: ReturnType<typeof createSpanJsonlWriter> = Object.freeze({
    emit: (event: unknown): void => {
      jsonlWriter.emit(event);
      projection.ingestFromDisk();
    },
  });
  const notes = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });

  const runIds = seed({ database, spans, notes });

  const trust = createReceiptService({ database, descriptors: [personLookupDescriptor] });

  /**
   * THE DONE RUN'S EVIDENCE RECEIPT IS PART OF THE SEED, not a side effect of
   * whoever loaded a page first.
   *
   * The queue row's D7 outcome chips come from `#facts` in
   * `run-queue-projection.ts`, which looks a receipt UP (`getReceipt`) and never
   * derives one — D141 makes derivation an act that writes an authority row, and
   * a projection may not write. The only thing that derives one here is the
   * panel's own `GET /api/v1/runs/:runId/receipt`, and that request lands AFTER
   * the day snapshot `/events/v1` built for the page it is opening. So without
   * this line the row's chips depend on whether an EARLIER page load against
   * this same server happened to derive the receipt first, and the seeded server
   * lives for a whole Playwright worker — which Playwright replaces after any
   * failed test. That is exactly how the corpus came to hold two references for
   * ONE state that disagree: `run-receipt-populated--graphite-warm` (captured
   * first, on a cold server) records the row with no chips, and
   * `--paper-ink` (captured second, on the warm one) records them.
   *
   * Deriving it here through the production `ReceiptService` — the same thing
   * `tests/perf/dashboard-fixture.ts` does — makes the state determinate and
   * matches what the state CLAIMS to be: a run whose receipt is populated and on
   * screen. The assertion is the point: a seed that silently produced a
   * receipt with no output facts would photograph an empty row and call it a
   * populated receipt.
   */
  const doneReceipt = trust.ensureReceipt(runIds.doneRun);
  if (doneReceipt.output.length === 0) {
    throw new Error(
      `the seeded done run ${runIds.doneRun} derived an evidence receipt with no output fact; `
      + "the run-receipt-populated state photographs a queue row that states what the run produced",
    );
  }

  const runDetailDeps = {
    stateRoot,
    projection,
    authority: {
      getRun: (runId: string) => database.authority.runs.get(runId),
      latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      getWriteIntent: (writeIntentId: string) => database.authority.writeIntents.get(writeIntentId),
      listGateResults: (runId: string) => database.authority.gateResults.listByRun(runId),
    },
    descriptors: {
      resolve: (workflowId: string) =>
        (workflowId === personLookupDescriptor.id ? personLookupDescriptor : undefined),
    },
    trust,
  };

  const kernel = createCommandKernel({
    appVersion: SEEDED_APP_VERSION,
    archiveSnapshots: archiveSnapshots(runDetailDeps),
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: { uuid: () => uuidOf(7000) },
    descriptors,
    writeResolution: {
      resolvePresent: () => {
        throw new Error("write resolution is not wired in the parity seed");
      },
      resolveAbsent: () => {
        throw new Error("write resolution is not wired in the parity seed");
      },
    },
    workerRuntime: {
      planWorkerCount: () => ({ state: "accepted", workerIds: ["person-lookup-worker-1"] }),
      spawnWorker: () => ({ state: "accepted" }),
      refreshBrowser: () => ({ state: "accepted" }),
      reopenBrowser: () => ({ state: "accepted" }),
    },
  });
  const commands = createDashboardCommandService({
    kernel,
    clock,
    spans,
    projection,
    descriptors,
    authorityRead: {
      getRun: (runId) => database.authority.runs.get(runId),
      getStartPlan: (startPlanId) => database.authority.startPlans.get(startPlanId),
      getIntakeSession: (intakeSessionId) => database.authority.intakeSessions.get(intakeSessionId),
      getIntakeManifest: (manifestId) => database.authority.intakeManifests.get(manifestId),
    },
  });
  const startPlans = createStartPlanService({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: database,
    descriptors,
    clock,
    ids: { uuid: () => uuidOf(8000) },
    planTtlMs: 10 * 60 * 1000,
    configFingerprint: CONFIG_FINGERPRINT,
    configSnapshotId: CONFIG_SNAPSHOT_ID,
    plannedBy: "local-operator",
  });
  const hub = createDashboardStreamHub({ projection, backfillGaps: UNOBSERVED_BACKFILL_GAP_NOTIFIER });

  const app = createDashboardApp({
    intake: UNWIRED_INTAKE_SERVICE,
    capture: UNWIRED_CAPTURE_SERVICE,
    bootstrap: {
      appVersion: SEEDED_APP_VERSION,
      clock,
      // D219 — the bootstrap document is built from MODULE views now, because
      // the served `role` is the module's declaration. This harness serves the
      // one standalone workflow the parity corpus runs.
      modules: [{ descriptor: personLookupDescriptor, role: defineWorkflowRole({ kind: "standalone" }) }],
      descriptorSetHash: descriptorSetHash([CONTRACT_FINGERPRINT]),
      settingsSchemaHash: descriptorSetHash(["settings-schema"]),
      projection,
      authorityMeta: () => database.getMeta(),
      // The seeded adapter runs no backup lane; "missing" is its true state.
      backupSummary: () => "missing",
      // The parity corpus never composes a provider (D178): a reference must
      // not depend on a key being present in the environment that captured it.
      advisoryAvailability: () => ({
        state: "unavailable",
        code: "not-configured",
        reason: "no ai.advisory provider is composed in this harness",
      }),
    },
    projection,
    runDetail: runDetailDeps,
    archive: archiveQueryDeps({
      database,
      clock,
      appVersion: SEEDED_APP_VERSION,
      descriptors: [personLookupDescriptor],
    }),
    commands,
    startPlans,
    hub,
    // D274 item 6 — the read-only Settings status sections read the SAME
    // resolved config and descriptor tuple this harness composes everything else
    // from, so nothing on that page can be true here and false in production.
    settings: { config: resolveConfig({}, {}, clock), descriptors: [personLookupDescriptor] },
    storage: {
      doctorOptions: {
        stateRoot,
        // The seeded database lives at the temp ROOT, not under stateRoot.
        authorityPath: join(root, "authority.sqlite"),
        backupDirectory: join(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 45 * 60 * 1000,
        busyTimeoutMs: 1000,
      },
      clock,
      serviceState: () => ({
        state: "never-run",
        reason: "the seeded adapter runs no backup lane",
      }),
    },
    explorer: explorerQueryDeps(clock, descriptorSetHash([CONTRACT_FINGERPRINT])),
    uiCatalog: uiCatalogQueryDeps(),
  });

  const server: Server = createServer((req, res) => {
    void (async (): Promise<void> => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/events/")) {
        await bridge(app, req, res, url);
        return;
      }
      await serveStatic(input.distDir, url.pathname, res);
    })().catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({
        state: "error",
        code: "INTERNAL_FAILURE",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      }));
    });
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("seeded server bound no TCP address");
  }

  return Object.freeze({
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    day: SEEDED_DAY,
    runIds: Object.freeze(runIds),
    close: async (): Promise<void> => {
      server.closeAllConnections();
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error === undefined ? resolvePromise() : rejectPromise(error)));
      });
      hub.close();
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  });
}
