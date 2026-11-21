import { currentBuildId } from "../../../../../src/backend/runtime/build-id.js";


import { WorkerActivitySchema, type WorkerActivity } from "../../../../../src/backend/runtime/workers/worker-messages.js";
import type { Clock, TestClock } from "../../../../../src/rules/time/clock.js";
import { admitFixtureSlot, testWorkerLifetime } from "../../../fixtures/run-lifecycle-fixtures.js";
import { PERSON_LOOKUP_ACTIVE, personLookupTerminalIdentityEvidence } from "../../run-integration-world.js";
import { browserSessionSpanPath,workerSpanPath } from "../../../../../src/backend/logs/span-emitter.js";
import { buildRunResult } from "../../../../../src/backend/runs/lifecycle/run-result.js";
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
import { PersonLookupCanonicalInput } from "../../../../../src/workflows/person-lookup/workflow.js";
import { personLookupDescriptor } from "../../registered-workflows.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api.js";
import { startScriptedRun, type ScriptedExecutor, type ScriptedOutcome, type ScriptedPosition, type ScriptedRun, type SeededRequest } from "./seeded-scripted-executor.js";
import { CONFIG_FINGERPRINT,CONFIG_SNAPSHOT_ID,CONTRACT_FINGERPRINT,INGRESS_SCHEMA_HASH,SEEDED_AT,WORKFLOW_ID } from "./seeded-identity.js";


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
  readonly clock: TestClock;
  /** Seeded pool members by worker id, with the activity each last reported. */
  readonly workers: Map<string, WorkerActivity>;
  /** Members whose process is still spawning: no activity yet, which the worker card shows as starting. */
  readonly starting: Set<string>;
  readonly spans: ReturnType<typeof createTimelineEmitter>;
}


const nowOf = (world: SeedWorld): string => world.clock.now().toISOString();

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
      enqueuedAt: nowOf(world),
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
    createdAt: nowOf(world),
    updatedAt: nowOf(world),
  });

  world.spans.emit({
    t: "run.queued",
    kind: "run",
    ts: nowOf(world),
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


/** The pool member at this index, admitted idle on first use. */
function admitWorker(world: SeedWorld, poolIndex: number): string {
  if (!world.database.authority.workerSlots.list(WORKFLOW_ID).some(member => member.poolIndex === poolIndex && member.retiredAt === null)) {
    const slot = world.database.withAuthorityTransaction(repositories => admitFixtureSlot(repositories, WORKFLOW_ID, poolIndex, nowOf(world)));
    world.workers.set(slot.workerId, { state: "idle" });
  }
  return testWorkerLifetime(world.database, WORKFLOW_ID, poolIndex).workerId;
}

/** Enqueue → claim → validating → running, through production transitions only. */
function startRunning(world: SeedWorld, spec: SeedSpec, poolIndex: number, nodeId: string): RunRecord {
  const workerId = admitWorker(world, poolIndex);
  enqueueRun(world, spec);
  const claimed = world.database.authority.runs.claimNext({
    workflow: WORKFLOW_ID,
    workerId, now: nowOf(world),
  });
  if (claimed.state !== "claimed") {
    throw new Error(`seed ${String(spec.seed)} was not claimed by ${workerId}: ${claimed.state}`);
  }
  const runId = claimed.run.envelope.runId;
  if (runId !== uuidOf(spec.seed)) {
    throw new Error(`claimNext took ${runId}, not the just-enqueued ${uuidOf(spec.seed)}`);
  }
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const claimFields = { workerId, claimedAt: nowOf(world), heartbeatAt: nowOf(world) };

  world.spans.emit({
    t: "run.claimed",
    ts: nowOf(world),
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
    now: nowOf(world),
  });
  if (validating.state !== "applied") throw new Error(`run ${runId} did not enter validating`);

  const running = world.database.authority.runs.transition({
    runId,
    expectedVersion: validating.run.version,
    claim,
    lifecycle: { state: "running", ...claimFields, currentNodeId: nodeId },
    now: nowOf(world),
  });
  if (running.state !== "applied") throw new Error(`run ${runId} did not enter running`);
  reportWorker(world, workerId, running.run.envelope.runId);
  return running.run;
}

function reportWorker(world: SeedWorld, workerId: string, runId?: string): void {
  if (!world.workers.has(workerId)) throw new Error("seeded worker lifetime is absent");
  world.workers.set(workerId, WorkerActivitySchema.parse(runId === undefined ? { state: "idle" } : { state: "busy", runId }));
}


function taskSpan(world: SeedWorld, run: RunRecord, node: string, outcome?: "done" | "failed" | "not-run"): void {
  const traceId = run.envelope.traceId;
  const base = {
    ts: nowOf(world),
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
    world.spans.emit({ ...base, t: "span.ended", kind: "task", spanPath: `${traceId}/${node}#1`,
      ...(outcome === "not-run" ? { outcome: "skipped", notRunReason: "condition-false" } : { outcome }) });
  }
}


function claimOf(run: RunRecord): { workerId: string; claimGeneration: number } {
  if (!("workerId" in run.lifecycle)) {
    throw new Error(`run ${run.envelope.runId} holds no claim to authorize a terminal transition`);
  }
  return { workerId: run.lifecycle.workerId, claimGeneration: run.claimGeneration };
}



function terminalizeDone(world: SeedWorld, run: RunRecord): void {
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
    provenance: [{ path: "state", source: "derived", observedAt: nowOf(world), originalObservedAt: nowOf(world) }],
    writtenAt: nowOf(world),
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
    world.clock,
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
      authorizedAt: nowOf(world),
      resultDigest: result.resultDigest,
    },
  }, built.authorization);
}


/** done — real atomic success terminalization with a factory-sealed result. */
function finishDone(world: SeedWorld, spec: SeedSpec, poolIndex: number): RunRecord {
  const done = startRunning(world, spec, poolIndex, "active-status");
  // One settled span per declared node, as the executor writes: the nodes the sealed result resolves are done,
  // the rest are branches this input never takes. A node with no span would leave its step reading Upcoming.
  for (const node of ["searching", "search-identity", "cross-verify", "crm-identity", "active-status"]) taskSpan(world, done, node, "done");
  for (const node of ["matching", "crm-selected-record", "crm-results", "crm-only-recovery", "crm-dates", "reference-check"]) taskSpan(world, done, node, "not-run");
  terminalizeDone(world, done);
  reportWorker(world, claimOf(done).workerId);
  return done;
}

function endRun(world: SeedWorld, run: RunRecord, outcome: "cancelled" | "interrupted" | "discarded" | "superseded"): RunRecord {
  const ended = world.database.authority.runs.transition({
    runId: run.envelope.runId,
    expectedVersion: run.version,
    claim: claimOf(run),
    lifecycle: { state: "terminal", outcome, endedAt: nowOf(world) },
    now: nowOf(world),
  });
  if (ended.state !== "applied") throw new Error(`the ${outcome} transition of seed run ${run.envelope.runId} was refused`);
  reportWorker(world, claimOf(run).workerId);
  return ended.run;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Earlier days hold finished work only; the mix repeats so each day shows done and cancelled rows. */
export const SEEDED_PAST_DAYS = 4;
const RUNS_PER_PAST_DAY = 6;

function seedPastDays(world: SeedWorld): void {
  for (let back = SEEDED_PAST_DAYS; back >= 1; back -= 1) {
    world.clock.setWall(new Date(SEEDED_AT.getTime() - back * DAY_MS));
    for (let index = 0; index < RUNS_PER_PAST_DAY; index += 1) {
      const seed = 100 + back * 10 + index;
      const spec = { seed, title: `EID 10${String(seed).padStart(6, "0")}` };
      if (index % 3 === 2) endRun(world, startRunning(world, spec, 2, "searching"), "cancelled");
      else finishDone(world, spec, 2);
    }
  }
  world.clock.setWall(SEEDED_AT);
}

// claimNext chooses the oldest queued row, so seed order controls which run is claimed.
export function seed(world: SeedWorld): Record<string, string> {
  seedPastDays(world);

  const workerSpan = workerSpanPath(
    WorkflowIdSchema.parse(WORKFLOW_ID),
    WorkerIdSchema.parse("person-lookup-worker-1"),
  );
  world.spans.emit({
    t: "span.started",
    kind: "worker",
    ts: nowOf(world),
    workflow: WORKFLOW_ID,
    workerId: "person-lookup-worker-1",
    spanPath: workerSpan,
    name: WORKFLOW_ID,
  });
  world.spans.emit({
    t: "span.started",
    kind: "browser",
    ts: nowOf(world),
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

  finishDone(world, { seed: 3, title: "Battistessa, Johnnie" }, 2);

  // running — claimed, executing, one task span still open.
  const running = startRunning(world, { seed: 2, title: "Morrow, Bea" }, 1, "searching");
  taskSpan(world, running, "searching");

  // The terminal outcomes the lifecycle's `transition` arm owns, one row each.
  const cancelled = endRun(world, startRunning(world, { seed: 7, title: "EID 10222333" }, 3, "searching"), "cancelled");
  const interrupted = endRun(world, startRunning(world, { seed: 8, title: "EID 10333444" }, 3, "searching"), "interrupted");
  const discarded = endRun(world, startRunning(world, { seed: 9, title: "EID 10444555" }, 3, "searching"), "discarded");
  const superseded = endRun(world, startRunning(world, { seed: 10, title: "EID 10555666" }, 3, "searching"), "superseded");

  // Members with no run: one signing in to its browser, one the operator paused.
  world.workers.set(admitWorker(world, 4), WorkerActivitySchema.parse({ state: "waiting", waiting: "authenticating" }));
  world.workers.set(admitWorker(world, 5), WorkerActivitySchema.parse({ state: "paused" }));
  // A member whose process never started: admitted to the pool and never heard from, which the worker card shows as failed.
  world.database.withAuthorityTransaction(repositories => admitFixtureSlot(repositories, WORKFLOW_ID, 6, nowOf(world)));
  // A member whose process is still spawning.
  const startingWorker = admitWorker(world, 7);
  world.workers.delete(startingWorker);
  world.starting.add(startingWorker);
  // A finished preview: the queue shape a start plan gives a run that previews instead of saving.
  const preview = finishDone(world, { seed: 11, title: "EID 10666777 — preview", shape: "preview" }, 2);

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
    cancelledRun: cancelled.envelope.runId,
    interruptedRun: interrupted.envelope.runId,
    discardedRun: discarded.envelope.runId,
    supersededRun: superseded.envelope.runId,
    previewRun: preview.envelope.runId,
    groupRun: uuidOf(30),
    memberRun: uuidOf(31),
  };
}


/** The review, parked, failed and written variants: real executions of the scripted workflow, never forged rows. */
export async function seedScriptedRuns(world: Readonly<{ app: DashboardApp; scripted: ScriptedExecutor; clock: Clock }>): Promise<Record<string, string>> {
  const { scripted } = world;
  const now = (): string => world.clock.now().toISOString();
  const request: SeededRequest = async (path, body) => {
    const response = await world.app.fetch(new Request(`http://127.0.0.1${path}`, body === undefined ? {} : {
      method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify(body) }));
    const parsed: unknown = await response.json();
    if (!response.ok) throw new Error(`seed ${path} answered ${String(response.status)}: ${JSON.stringify(parsed)}`);
    return parsed;
  };
  const settle = async (run: ScriptedRun, expected: ScriptedOutcome["state"], reached: ScriptedOutcome | ScriptedPosition): Promise<string> => {
    const outcome = "at" in reached ? (reached.at === "settled" ? reached.outcome : undefined) : reached;
    if (outcome?.state !== expected) {
      const why = outcome?.state === "failed" ? JSON.stringify(await request(`/api/v1/runs/${run.runId}/failure`)) : "";
      throw new Error(`scripted seed ${run.runId} reached ${JSON.stringify(reached)}, not ${expected} ${why}`);
    }
    return run.runId;
  };
  const started = async (eid: string, review = false): Promise<ScriptedRun> =>
    scripted.drive(await startScriptedRun(request, now(), eid, review ? scripted.reviewReference() : undefined));

  // Fails at the transaction, before it stages: the read's step is done and its values are in Logs.
  const failing = await started("10873698");
  await failing.advance();
  const failed = await failing.fail();
  const failedRun = await settle(failing, "failed", failed);
  // The operator opens the failed run's receipt, which derives it; the queue row then counts the receipt's failure warning.
  await request(`/api/v1/runs/${failedRun}/receipt`);
  const writing = await started("10444001");
  const writtenRun = await settle(writing, "done", await writing.finish());
  const parking = await started("10555121");
  await parking.advance();
  const parkedRun = await settle(parking, "parked-write", await parking.parkWrite());
  const gated = await started("10101010", true);
  const openGateRun = await settle(gated, "parked-gate", await gated.finish());
  if (failed.at !== "settled" || failed.outcome.state !== "failed") throw new Error("unreachable: settle proved the failed outcome");
  return { failedRun, failureId: failed.outcome.failureId, openGateRun, parkedRun, writtenRun };
}
