import { sqliteRunReader } from "../helpers/canonical-run-reader.js";
import { createRunLifecycleStorage } from "../../src/infra/sqlite/lifecycle-storage.js";
import { genericArchiveSection } from "../../src/services/archive/report-capture.js";
import { JsonValueSchema } from "../../src/domain/canonical-json.js";
import { LifecycleSourceSnapshotSchema } from "../../src/domain/archive/lifecycle-source.js";
import { projectArchiveReport, queryArchiveReports } from "../../src/server/dashboard/queries/archive-reports.js";
import { runQueuedSpanEvent } from "../../src/server/dashboard/commands/run-queued-span.js";
import { ActorIdSchema as PublicationActorIdSchema } from "../../src/domain/ids.js";
import { RunRecordService } from "../../src/core/run-record-service.js";
/**
 * The operator lifecycle, walked ACROSS the 2h/2i slices (2j, D185).
 *
 * This file is the corpus's second kind — an INTEGRATION WALK, not a graph
 * scenario. It claims no coverage point and carries no manifest row, because it
 * does not follow one descriptor's graph; it follows one operator's day through
 * machinery that six suites already prove in isolation:
 *
 *   `intake-session` / `intake-command-arms`  the session CAS and the six arms
 *   `archive-model` / `archive-invariants`    the five archive clauses
 *   `evidence-receipt` / `advisory-*`         receipts and advisories
 *
 * None of them can see what happens BETWEEN them, and that is the whole reason
 * this file exists. The joins asserted here are exactly the ones composition
 * can falsify and a slice cannot:
 *
 *  1. the manifest's `itemId` really joins the runs the fan-out minted, over
 *     bytes that went through the real artifact writer and the real parser;
 *  2. an intake row nobody ran BLOCKS a version bump — a queue fact and an
 *     archive fact meeting for the first time;
 *  3. the archived row/detail are BYTE-IDENTICAL to the last live projection,
 *     because the bump freezes the production projection through
 *     `createArchiveSnapshotSource` rather than re-deriving them later;
 *  4. the receipt frozen into an archived run is the exact record the receipt
 *     service derived from authority beforehand — and its ABSENCE, when it
 *     could not be derived, is frozen with the reason instead of a hole;
 *  5. the retired relaunch command refuses without creating a descendant,
 *     changing archive bytes or extending the original intake manifest.
 *
 * ## Two refusals this walk asserts instead of stepping over
 *
 * **The only spreadsheet-capable workflow is a fixture.** No registered
 * workflow declares an intake projection (`person-lookup`'s ingress is a union
 * — real 2i-E3 design work), so the fan-out leg necessarily runs on
 * `intake-fixture`. That is not a fixture chosen for convenience; it is the
 * production state, and `intake-surface`'s own suite refuses `person-lookup`
 * upload by name for the same reason.
 *
 * **A fixture workflow therefore cannot have a receipt.** `EVIDENCE_FIELD_CLASSIFICATIONS`
 * declares leaves for the two REGISTERED workflows only, and an undeclared leaf
 * is a loud refusal by design (D140) — dropping it would make a receipt look
 * complete while hiding what the run read. So the fan-out leg asserts the
 * refusal BY NAME and then asserts its durable consequence: the archived record
 * freezes `receipt: absent` with the reason, not an empty object. The positive
 * half of the join — a receipt DERIVED from authority and frozen verbatim into
 * an archive — is walked on the registered `person-lookup` exit run, which is
 * the only place today where both halves can be true at once.
 *
 * **Nothing publishes a notification yet.** `createNotificationInbox` has no
 * production caller: terminal settlement writes authority rows and no inbox
 * row, which the walk asserts before publishing the `verified-done` trigger
 * itself through the real inbox and joining it back to the run the manifest
 * minted.
 *
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import type { AnyWorkflowDescriptor } from "../../src/base/workflow.js";
import { createCommandKernel } from "../../src/core/command-kernel.js";
import { buildRunResult } from "../../src/core/run-result.js";
import { manualClock } from "../../src/domain/clock.js";
import { CommandResultSchema } from "../../src/domain/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../src/domain/ids.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { deriveEvidenceReceiptId } from "../../src/domain/trust/evidence-identity.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { createContentAddressedArtifactWriter } from "../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { createTimelineEmitter } from "../../src/infra/events/timeline-emitter.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { createNotificationInbox } from "../../src/services/notifications/inbox.js";
import { createDashboardCommandService } from "../../src/server/dashboard/commands/command-service.js";
import { publicVersionReviewFingerprint } from "../../src/server/dashboard/commands/version-review-binding.js";
import { createIntakeService } from "../../src/server/dashboard/commands/intake-service.js";
import { descriptorSetHash } from "../../src/server/dashboard/compose.js";
import { createRunQueueProjection } from "../../src/server/dashboard/projectors/run-queue-projection.js";

import { buildRunDetail } from "../../src/server/dashboard/queries/run-detail.js";
import type { RunDetailQueryDeps } from "../../src/server/dashboard/queries/run-detail.js";
import { createIntakeParser } from "../../src/server/intake/intake-parser.js";
import { createReceiptService } from "../../src/server/trust/receipt-service.js";
import { archiveSnapshots } from "../fixtures/archive-seams.js";
import {
  INTAKE_FIXTURE_WORKFLOW_ID,
  defineIntakeFixtureDescriptor,
  intakeFixtureProjection,
} from "../fixtures/intake-workflow-fixture.js";
import { FixtureReadReceipt } from "../unit/architecture/helpers/descriptor-fixtures.js";
import { CONFIG_SNAPSHOT, HASH_B, HASH_C, NOW, UUID_1 } from "../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import {
  EXIT_RUN_ID,
  EXIT_TERMINAL_AT,
  seedPersonLookupExitRun,
} from "../fixtures/receipt-run-fixtures.js";
import { createTransactionHistory } from "../../src/infra/sqlite/transaction-history.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";

/* ── the source file, as an operator would upload it ─────────────────────── */

/**
 * Real CSV bytes. Everything downstream — the columns, the header row, the
 * validation dispositions, the manifest totals — is DERIVED from these by the
 * production edge; nothing here hand-writes a shape it should have derived.
 * Row 2's EID is malformed on purpose, so the walk has a rejection to resolve.
 */
const ROSTER_CSV = [
  "Work-study roster,,",
  "Employee ID#,Effective Date,Dept",
  "10800000,07/01/2026,Housing Dining Hospitality",
  "10-8000,07/01/2026,Housing Dining Hospitality",
  "10800001,07/01/2026,Student Affairs",
  "",
].join("\n");
const REJECTED_SOURCE_ROW = 2;

const APP_VERSION = "0.1.0";
const WORKER_ID = "intake-fixture-worker-1";
const TERMINAL_AT = "2026-07-31T17:05:00.000Z";

const INTAKE_V1 = defineIntakeFixtureDescriptor({
  id: INTAKE_FIXTURE_WORKFLOW_ID,
  code: "if",
  contractFingerprint: "f".repeat(64),
  enqueue: "allow-parallel",
});
/** The same workflow after a source edit plus `npm run build:manifest`. */
const INTAKE_V2 = defineIntakeFixtureDescriptor({
  id: INTAKE_FIXTURE_WORKFLOW_ID,
  code: "if",
  contractFingerprint: HASH_C,
  enqueue: "allow-parallel",
  version: 2,
});

/* ── harness ─────────────────────────────────────────────────────────────── */

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

let commandSequence = 0;
function commandEnvelope(): Readonly<{
  commandId: string;
  requestedAt: string;
  requestedBy: string;
  source: string;
}> {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return {
    commandId: `dddddddd-${tail}-4000-8000-${tail}00000000`,
    requestedAt: NOW,
    requestedBy: LOCAL_OPERATOR_ACTOR_ID,
    source: "dashboard",
  };
}

interface World {
  readonly database: AuthorityDatabase;
  readonly stateRoot: string;
  readonly clock: ReturnType<typeof manualClock>;
  readonly projection: ReturnType<typeof createRunQueueProjection>;
  readonly spans: ReturnType<typeof createTimelineEmitter>;
  readonly runDetail: RunDetailQueryDeps;
  readonly receipts: ReturnType<typeof createReceiptService>;
  readonly inbox: ReturnType<typeof createNotificationInbox>;
  readonly commands: ReturnType<typeof createDashboardCommandService>;
  readonly intake: ReturnType<typeof createIntakeService>;
  /** Flipped by the walk to simulate a version bump; the kernel reads it. */
  registry: readonly AnyWorkflowDescriptor[];
}

/**
 * The REAL composition, minus the process edges a test must pin (clock, ids,
 * pid). Every read model the walk asserts against — the queue projection, the
 * run detail, the receipt service, the archive snapshot source — is the one
 * `compose.ts` wires, so a join proved here is a join production makes.
 */
function createWorld(descriptors: readonly AnyWorkflowDescriptor[]): World {
  const root = mkdtempSync(join(tmpdir(), "hrauto-lifecycle-walk-"));
  const stateRoot = join(root, ".tracker");
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 1000, migrationOwner: "operator-lifecycle-walk" },
    clock,
  );
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  // The config identity a fan-out stamps has to name a snapshot the database
  // holds; `UNSTORED_CONFIG_IDENTITY` is for kernels that never enqueue.
  database.withAuthorityTransaction((repositories) => repositories.configSnapshots.insert(CONFIG_SNAPSHOT));
  database.authority.runtimeConfig.activate({ settingsRevision: 1, settingsFingerprint: CONFIG_SNAPSHOT.fingerprint,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint, activatedAt: NOW });


  const world = { registry: descriptors } as World & { registry: readonly AnyWorkflowDescriptor[] };
  const resolve = (workflowId: string): AnyWorkflowDescriptor | undefined =>
    world.registry.find((descriptor) => String(descriptor.id) === workflowId);
  const descriptorResolver = { resolve };

  const projection = createRunQueueProjection({
    timeline: database.authority.timelineEvents,
    reader: sqliteRunReader(database, clock),
    stateRoot,
    clock,
    appVersion: APP_VERSION,
    descriptorSetHash: descriptorSetHash(descriptors.map((descriptor) => descriptor.contractFingerprint)),
    ledger: createTransactionHistory(database.authority),
    authority: {
      listNotifications: (actorId) => database.authority.notifications.listByActor(actorId),
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
      getWorkerLease: (workerId) => database.authority.workerLeases.get(workerId),
      listWorkerPools: () => database.authority.workerPools.list(),
      listRunBatches: () => database.authority.runSessions.list(),
      getRunBatch: (id) => database.authority.runSessions.get(id),
      getFailure: (failureId) => database.authority.failures.get(failureId),
      getReceipt: (runId) => database.authority.evidenceReceipts.findByRun(runId),
      canonicalPerson: (runId: string) => database.canonicalPerson(runId),
      latestCheckpoint: (workflowId, itemId, nodeId) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
    descriptors: descriptorResolver,
  });
  const jsonlWriter = createTimelineEmitter({
    repository: database.authority.timelineEvents,
    clock,
    pid: 4242,
  });
  // D218: the projection's one live feed is the SQLite cursor feed; the walk ticks it
  // after every append so each event folds through the production path.
  const spans: ReturnType<typeof createTimelineEmitter> = Object.freeze({
    emit: (event: unknown): void => {
      jsonlWriter.emit(event);
      database.afterAuthorityCommit(() => projection.ingestFromTimeline());
    },
  });
  const receipts = createReceiptService({ database, runReader: sqliteRunReader(database, clock), descriptors });
  const runDetail: RunDetailQueryDeps = { runReader: sqliteRunReader(database, clock),
    stateRoot,
    projection,
    authority: {
      getRun: (runId) => database.authority.runs.get(runId),
      latestCheckpoint: (workflowId, itemId, nodeId) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      getWriteIntent: (writeIntentId) => database.authority.writeIntents.get(writeIntentId),
      listGateResults: (runId) => database.authority.gateResults.listByRun(runId),
    },
    descriptors: descriptorResolver,
    trust: receipts,
  };

  const artifacts = createContentAddressedArtifactWriter({
    workspaceRoot: root,
    artifactRoot: ".tracker/artifacts",
  });
  const parser = createIntakeParser({ artifacts });
  const projections = {
    resolve: (workflowId: string) =>
      (workflowId === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureProjection : undefined),
  };

  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: (run, publication) => {
      if (publication === undefined) throw new Error("command-created run lacks queue presentation");
      spans.emit(runQueuedSpanEvent({ run, ...publication, actorId: PublicationActorIdSchema.parse(publication.actorId) }));
    } }),
    appVersion: APP_VERSION,
    archiveSnapshots: archiveSnapshots(runDetail),
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("b"),
    configIdentity: { configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: UUID_1 },
    descriptors: descriptorResolver,
    intakeParser: parser,
    intakeProjections: projections,
    writeResolution: {
      resolvePresent: () => { throw new Error("this walk resolves no write"); },
      resolveAbsent: () => { throw new Error("this walk resolves no write"); },
    },
    workerRuntime: {
      planWorkerCount: () => { throw new Error("this walk runs no worker supervisor"); },
      spawnWorker: () => { throw new Error("this walk runs no worker supervisor"); },
      refreshBrowser: () => { throw new Error("this walk runs no browser"); },
      reopenBrowser: () => { throw new Error("this walk runs no browser"); },
    },
  });
  const commands = createDashboardCommandService({ kernel, projection, versionChanges: createRunLifecycleStorage(database) });
  const intake = createIntakeService({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: {
      getIntakeSession: (intakeSessionId) => database.authority.intakeSessions.get(intakeSessionId),
      getIntakeManifest: (manifestId) => database.authority.intakeManifests.get(manifestId),
      findIntakeManifestsBySource: (sourceSha256) =>
        database.authority.intakeManifests.findBySource(sourceSha256),
    },
    artifacts,
    parser,
    projections,
    descriptors: descriptorResolver,
    clock,
    ids: sequentialIdFactory("c"),
    actorId: LOCAL_OPERATOR_ACTOR_ID,
  });

  return Object.assign(world, {
    database,
    stateRoot,
    clock,
    projection,
    spans,
    runDetail,
    receipts,
    inbox: createNotificationInbox({
      runReader: sqliteRunReader(database, clock),
      authority: {
        authority: database.authority,
        withAuthorityTransaction: (work) => database.withAuthorityTransaction(work),
      },
      clock,
      ids: sequentialIdFactory("f"),
      actorId: LOCAL_OPERATOR_ACTOR_ID,
    }),
    commands,
    intake,
  });
}

/** Exactly what `POST /api/v1/commands` does: prepare the seam, then dispatch. */
async function send(
  world: World,
  intakeSessionId: string,
  type: string,
  payload?: Record<string, unknown>,
): Promise<{ readonly state: string; readonly message?: string }> {
  const session = world.database.authority.intakeSessions.get(intakeSessionId);
  if (session === undefined) throw new Error(`intake session ${intakeSessionId} vanished mid-walk`);
  const command = {
    ...commandEnvelope(),
    family: "intake",
    type,
    target: { intakeSessionId, expectedVersion: session.version },
    ...(payload === undefined ? {} : { payload }),
  };
  await world.intake.prepare(command);
  const result = world.commands.execute(command);
  return result.state === "rejected"
    ? { state: result.state, message: result.message }
    : { state: result.state };
}

/**
 * Charter §25's change record every bump in this walk carries. The archive's
 * whole point is that somebody can read it later; "who and when" without "what
 * and why" is the half of that which does not survive six months.
 */
const WALK_CHANGE_RECORD = {
  kind: "major",
  what: "the intake fixture workflow's descriptor moved to v2",
  why: "the walk bumps the version so the settled run becomes prior-version and the archive has something to sweep",
  commit: { state: "absent", reason: "authored inside a scenario walk, which has no commit to name" },
} as const;

function versionCommand(
  world: World,
  type: string,
  target: Record<string, unknown>,
  payload?: Record<string, unknown>,
) {
  return CommandResultSchema.parse(world.commands.execute({
    ...commandEnvelope(),
    family: "version-archive",
    type,
    target,
    ...(payload === undefined ? {} : { payload }),
  }));
}

/**
 * Settle one queued run through the REAL D110/D114 composite: claim it, walk it
 * to `running`, write the node's checkpoint, and terminalize with a
 * factory-sealed result. Nothing about the terminal row is hand-built, which is
 * what makes the receipt derivation downstream meaningful.
 */
function settleOneQueuedRunDone(world: World, descriptor: AnyWorkflowDescriptor): string {
  const claimed = world.database.authority.runs.claimNext({
    workflow: String(descriptor.id),
    workerId: WORKER_ID,
    now: TERMINAL_AT,
  });
  if (claimed.state !== "claimed") throw new Error(`no queued run to settle: ${claimed.state}`);
  const runId = String(claimed.run.envelope.runId);
  const claim = { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration };
  const claimFields = { workerId: WORKER_ID, claimedAt: TERMINAL_AT, heartbeatAt: TERMINAL_AT };

  const validating = world.database.authority.runs.transition({
    runId,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", ...claimFields },
    now: TERMINAL_AT,
  });
  if (validating.state !== "applied") throw new Error(`run ${runId} did not enter validating`);
  const running = world.database.authority.runs.transition({
    runId,
    expectedVersion: validating.run.version,
    claim,
    lifecycle: { state: "running", ...claimFields, currentNodeId: "probe" },
    now: TERMINAL_AT,
  });
  if (running.state !== "applied") throw new Error(`run ${runId} did not enter running`);

  const parsed = running.run.input.parsed.value as Readonly<{ emplId: string }>;
  const checkpoint = RunCheckpointRecordSchema.parse({
    workflowId: running.run.envelope.workflow,
    itemId: running.run.envelope.itemId,
    nodeId: "probe",
    attempt: running.run.envelope.attempt,
    claimGeneration: 1,
    runId,
    output: {
      schemaHash: deriveSchemaHash(FixtureReadReceipt.output, "output"),
      value: { eid: parsed.emplId, present: true },
    },
    descriptorVersion: running.run.envelope.descriptorVersion,
    contractFingerprint: running.run.envelope.contractFingerprint,
    implFingerprint: HASH_B,
    provenance: ["eid", "present"].map((path) => ({
      path,
      source: "live",
      observedAt: TERMINAL_AT,
      originalObservedAt: TERMINAL_AT,
    })),
    writtenAt: TERMINAL_AT,
  });
  world.database.authority.runCheckpoints.insert(checkpoint);

  const built = buildRunResult(
    descriptor,
    running.run,
    [{ state: "resolved", nodeId: "probe", checkpoint }],
    manualClock(new Date(TERMINAL_AT)),
  );
  world.database.terminalizeSuccess({
    result: built.record,
    authorization: {
      kind: "done",
      runId: built.record.runId,
      workflowId: built.record.workflowId,
      attempt: built.record.attempt,
      descriptorVersion: built.record.descriptorVersion,
      contractFingerprint: built.record.contractFingerprint,
      expectedVersion: running.run.version,
      claim,
      authorizedAt: TERMINAL_AT,
      resultDigest: built.record.resultDigest,
    },
  }, built.authorization);
  return runId;
}

/** Cancel a run the operator never ran, so the bump has no live blocker left. */
function cancel(world: World, runId: string): void {
  const run = world.database.authority.runs.get(runId);
  if (run === undefined) throw new Error(`run ${runId} vanished mid-walk`);
  const outcome = world.database.authority.runs.transition({
    runId,
    expectedVersion: run.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: TERMINAL_AT },
    now: TERMINAL_AT,
  });
  if (outcome.state !== "applied") throw new Error(`run ${runId} did not cancel: ${outcome.state}`);
}

const WALK_PHASES = [
  "01-upload",
  "02-validate",
  "03-fan-out",
  "04-settle",
  "05-receipt-refusal",
  "06-notification",
  "07-blocked-bump",
  "08-archive-freeze",
  "09-archive-render",
  "10-relaunch",
] as const;
type WalkPhase = typeof WALK_PHASES[number];
const EXPECTED_WALK_PHASE_EVENTS = WALK_PHASES.flatMap((phase) => [
  `[scenario:operator-lifecycle] ${phase}:begin\n`,
  `[scenario:operator-lifecycle] ${phase}:complete\n`,
]);
const observedWalkPhaseEvents: string[] = [];

function beginWalkPhaseReporting(): void {
  observedWalkPhaseEvents.length = 0;
}

function reportWalkPhase(
  phase: WalkPhase,
  state: "begin" | "complete",
): void {
  const event = `[scenario:operator-lifecycle] ${phase}:${state}\n`;
  const expected = EXPECTED_WALK_PHASE_EVENTS[observedWalkPhaseEvents.length];
  if (event !== expected) {
    throw new Error(
      `operator lifecycle phase ${String(observedWalkPhaseEvents.length + 1)} must be ${JSON.stringify(expected)}; received ${JSON.stringify(event)}`,
    );
  }
  observedWalkPhaseEvents.push(event);
  process.stdout.write(event);
}

function assertWalkPhaseReportingComplete(): void {
  assert.deepEqual(observedWalkPhaseEvents, EXPECTED_WALK_PHASE_EVENTS);
}

/* ── the walk ────────────────────────────────────────────────────────────── */

describe("the operator lifecycle, across slices", () => {
  it("carries a spreadsheet through fan-out, settlement, archive and retired-relaunch refusal on ONE authority database", async () => {
    beginWalkPhaseReporting();
    const world = createWorld([INTAKE_V1]);
    const { database } = world;

    /* ① the route creates the session from real bytes ---------------------- */
    reportWalkPhase("01-upload", "begin");
    const upload = await world.intake.upload({
      workflow: INTAKE_FIXTURE_WORKFLOW_ID,
      mediaType: "text/csv; charset=utf-8",
      fileName: "cohort-a.csv",
      bytes: new TextEncoder().encode(ROSTER_CSV),
    });
    if (upload.state === "refused") throw new Error(`the roster was refused: ${upload.message}`);
    const sessionId = String(upload.session.intakeSessionId);
    const sourceSha256 = String(upload.session.artifact.sha256);
    assert.equal(upload.session.state, "mapping");
    assert.equal(upload.session.rowCount, 3);
    reportWalkPhase("01-upload", "complete");

    /* ② mapping → validated, through the real command kernel --------------- */
    reportWalkPhase("02-validate", "begin");
    const layout = String(upload.session.headerFingerprint);
    const column = (header: string): string => {
      const found = upload.session.columns.find((entry) => entry.header === header);
      if (found === undefined) throw new Error(`the parsed file has no ${header} column`);
      return String(found.sourceColumnId);
    };
    assert.equal(
      (await send(world, sessionId, "exclude-intake-row", {
        sourceRow: REJECTED_SOURCE_ROW,
        reason: "Malformed EID",
      })).state,
      "applied",
    );
    for (const [targetFieldId, header] of [["emplId", "Employee ID#"], ["effectiveDate", "Effective Date"]]) {
      assert.equal(
        (await send(world, sessionId, "confirm-intake-mapping", {
          targetFieldId,
          sourceColumnId: column(header),
          headerFingerprint: layout,
        })).state,
        "applied",
      );
    }
    assert.equal((await send(world, sessionId, "validate-intake")).state, "applied");
    assert.equal(database.authority.intakeSessions.get(sessionId)?.state, "validated");
    reportWalkPhase("02-validate", "complete");

    /* ③ the fan-out, and the JOIN the manifest makes ------------------------ */
    reportWalkPhase("03-fan-out", "begin");
    assert.equal((await send(world, sessionId, "enqueue-intake-manifest", { dryRun: false })).state, "applied");
    const manifestId = String(database.authority.intakeSessions.get(sessionId)?.intakeManifestId);
    const manifest = database.authority.intakeManifests.get(manifestId);
    if (manifest === undefined) throw new Error("the enqueued session names no manifest");
    assert.equal(manifest.source.sha256, sourceSha256, "the manifest names the bytes that were uploaded");
    assert.equal(manifest.validRows.length, 2);

    const mintedByItem = new Map<string, string>();
    for (const row of manifest.validRows) {
      const runs = database.authority.runs.listByItem({
        workflow: INTAKE_FIXTURE_WORKFLOW_ID,
        itemId: row.itemId,
      });
      assert.equal(runs.length, 1, `source row ${String(row.sourceRow)} minted exactly one run`);
      assert.equal(runs[0].envelope.contractFingerprint, INTAKE_V1.contractFingerprint);
      // The run renders: the fan-out's span reached the projection an operator
      // reads, so the intake surface and the queue surface agree on this run.
      assert.notEqual(world.projection.queueSurface(String(runs[0].envelope.runId)), undefined);
      mintedByItem.set(String(row.itemId), String(runs[0].envelope.runId));
    }
    const mintedRunIds = [...mintedByItem.values()];
    reportWalkPhase("03-fan-out", "complete");

    /* ④ one run settles `done` through the real terminal composite ---------- */
    reportWalkPhase("04-settle", "begin");
    const settledRunId = settleOneQueuedRunDone(world, INTAKE_V1);
    assert.ok(mintedRunIds.includes(settledRunId), "the settled run is one the manifest minted");
    assert.equal(database.authority.runs.get(settledRunId)?.lifecycle.state, "terminal");
    assert.notEqual(database.authority.runResults.get(settledRunId), undefined);
    reportWalkPhase("04-settle", "complete");

    /* ⑤ the receipt REFUSES, by name, and settlement minted none ------------ */
    reportWalkPhase("05-receipt-refusal", "begin");
    assert.equal(
      database.authority.evidenceReceipts.findByRun(settledRunId),
      undefined,
      "a receipt is DERIVED on demand, never minted by settlement",
    );
    assert.throws(
      () => world.receipts.ensure(settledRunId),
      /no declared evidence classification for/,
      "the only spreadsheet-capable workflow is a fixture, whose evidence leaves are undeclared",
    );
    assert.equal(
      database.authority.evidenceReceipts.findByRun(settledRunId),
      undefined,
      "a refused derivation writes nothing",
    );
    reportWalkPhase("05-receipt-refusal", "complete");

    /* ⑥ the notification is durable, and nothing produced it automatically -- */
    reportWalkPhase("06-notification", "begin");
    assert.deepEqual(
      database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID),
      [],
      "terminal settlement files no inbox row; no production caller wires the inbox yet",
    );
    const published = await world.inbox.publish({
      kind: "verified-done",
      runId: settledRunId,
      workflowId: INTAKE_FIXTURE_WORKFLOW_ID,
    });
    assert.equal(published.durable, "created");
    const inbox = database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].status, "unread");
    assert.equal(inbox[0].count, 1);
    assert.equal(inbox[0].trigger, "verified-done");
    assert.deepEqual(
      JSON.parse(JSON.stringify(inbox[0].links)),
      [{ kind: "run", runId: settledRunId }],
      "the inbox row links the run the manifest minted",
    );
    reportWalkPhase("06-notification", "complete");

    /* ⑦ the un-run row BLOCKS the bump ------------------------------------- */
    reportWalkPhase("07-blocked-bump", "begin");
    const blockedRunId = mintedRunIds.find((runId) => runId !== settledRunId);
    if (blockedRunId === undefined) throw new Error("the fan-out minted only one run");
    world.registry = [INTAKE_V2];
    const blockedPlan = versionCommand(world, "plan-version-bump", {
      scope: { kind: "workflows", workflowIds: [INTAKE_FIXTURE_WORKFLOW_ID] },
    }, { targetVersion: "0.2.0", changeFingerprint: HASH_C, changeRecord: WALK_CHANGE_RECORD });
    assert.equal(blockedPlan.state, "applied");
    const planTarget = blockedPlan.state === "applied" ? blockedPlan.affectedTargets[0] : undefined;
    const versionPlanId = planTarget?.family === "version-archive" ? planTarget.versionPlanId : "";
    const storedPlan = createRunLifecycleStorage(database).readVersionChange(versionPlanId);
    assert.ok(storedPlan);
    assert.deepEqual(
      storedPlan?.blockers,
      [blockedRunId],
      "an intake row nobody ran is an archive blocker — a queue fact meeting an archive fact",
    );
    const refusedApply = versionCommand(
      world,
      "apply-version-bump",
      { versionPlanId, expectedVersion: 1 },
      { planFingerprint: publicVersionReviewFingerprint(storedPlan) },
    );
    assert.equal(refusedApply.state, "rejected");
    assert.equal(refusedApply.state === "rejected" ? refusedApply.code : "", "active-version-blockers");
    assert.equal(database.authority.archivedRuns.list().length, 0, "a refused bump archives nothing");
    reportWalkPhase("07-blocked-bump", "complete");

    /* ⑧ the archive freezes the LAST LIVE projection, byte for byte --------- */
    reportWalkPhase("08-archive-freeze", "begin");
    cancel(world, blockedRunId);
    const reviewed = versionCommand(world, "plan-version-bump", {
      scope: { kind: "workflows", workflowIds: [INTAKE_FIXTURE_WORKFLOW_ID] },
    }, { targetVersion: "0.2.0", changeFingerprint: HASH_C, changeRecord: WALK_CHANGE_RECORD });
    const reviewedTarget = reviewed.state === "applied" ? reviewed.affectedTargets[0] : undefined;
    const reviewedPlanId = reviewedTarget?.family === "version-archive" ? reviewedTarget.versionPlanId : "";
    const reviewedRow = createRunLifecycleStorage(database).readVersionChange(reviewedPlanId);
    assert.ok(reviewedRow);
    assert.deepEqual(reviewedRow?.blockers, []);

    const lastLiveRow = world.projection.queueSurface(settledRunId);
    const lastLiveDetail = buildRunDetail(world.runDetail, settledRunId);
    const lastLiveDisplay = archiveSnapshots(world.runDetail).snapshot(settledRunId);
    assert.deepEqual(lastLiveDisplay.row,lastLiveRow);
    assert.deepEqual(lastLiveDisplay.detail,lastLiveDetail);
    const applied = versionCommand(
      world,
      "apply-version-bump",
      { versionPlanId: reviewedPlanId, expectedVersion: 1 },
      { planFingerprint: publicVersionReviewFingerprint(reviewedRow) },
    );
    assert.equal(applied.state, "applied", applied.state === "rejected" ? applied.message : "apply refused");

    const storage = createRunLifecycleStorage(database);
    const archived = storage.readReport(settledRunId);
    if (archived === undefined) throw new Error("the settled run was not archived");
    assert.deepEqual(archived.content.sections.find(section=>section.title === "Displayed run"),
      genericArchiveSection("Displayed run",JsonValueSchema.parse(lastLiveDisplay)),
      "the saved display freezes exactly the last live row, detail and named unavailable sections");
    const captured = LifecycleSourceSnapshotSchema.parse(JSON.parse(archived.content.sources[0].json));
    assert.equal(captured.records.find(group=>group.table === "run_receipts")?.rows.length,0);
    assert.deepEqual(captured.records.find(group=>group.table === "run_checkpoints")?.rows.map(row=>(JSON.parse(row.json) as {nodeId:string}).nodeId),["probe"]);
    reportWalkPhase("08-archive-freeze", "complete");

    /* ⑨ the archived record renders with no live descriptor at all ---------- */
    reportWalkPhase("09-archive-render", "begin");
    world.registry = [];
    const archivedDetail = projectArchiveReport(storage.readReport(settledRunId));
    assert.equal(archivedDetail.state,"available");
    if (archivedDetail.state !== "available") throw new Error("missing report");
    assert.equal(archivedDetail.runId,settledRunId);
    assert.equal(archivedDetail.descriptorVersion,"1");
    const index = queryArchiveReports(storage,{limit:50});
    assert.deepEqual(index.items.map(item=>item.state === "available" ? item.runId : "missing").sort(),[...mintedRunIds].sort());
    reportWalkPhase("09-archive-render", "complete");

    /* ⑩ the retired relaunch door refuses without creating a descendant ----- */
    reportWalkPhase("10-relaunch", "begin");
    world.registry = [INTAKE_V2];
    const beforeRelaunch = database.getMeta().authorityGeneration;
    const relaunched = versionCommand(world, "relaunch-archived-run", {
      archivedRunId: settledRunId, archiveFingerprint: archivedDetail.archiveFingerprint,
    });
    assert.equal(relaunched.state,"rejected");
    assert.equal(relaunched.state === "rejected" ? relaunched.code : "","policy-refused");
    assert.equal(database.getMeta().authorityGeneration,beforeRelaunch);
    assert.equal(database.authority.runs.listByWorkflow(INTAKE_FIXTURE_WORKFLOW_ID).length,0);
    const reread = database.authority.intakeManifests.get(manifestId);
    assert.equal(reread?.validRows.length,2);
    assert.deepEqual(storage.readReport(settledRunId),archived,"the immutable report is untouched");
    reportWalkPhase("10-relaunch", "complete");
    assertWalkPhaseReportingComplete();
  });

  it("freezes into an archive the exact receipt the receipt service derived from authority", () => {
    /*
      The other half of ⑤'s refusal, on the one workflow where both halves can
      be true: `person-lookup` is registered, so its evidence classification is
      declared, and the exit run is the real 2026-08-04 settlement seeded
      through the real D110/D114 composite.
      */
    const world = createWorld([personLookupDescriptor]);
    const { database } = world;
    const seeded = seedPersonLookupExitRun(database);
    world.clock.advanceWall(Math.max(0, Date.parse(EXIT_TERMINAL_AT) - world.clock.now().getTime()));
    const runId = String(seeded.run.envelope.runId);
    assert.equal(runId, EXIT_RUN_ID);

    // The projection folds from spans, so the run has to have been announced
    // before it can be archived — `createArchiveSnapshotSource` refuses to
    // freeze a row the live surface could not render.
    world.spans.emit({
      t: "run.queued",
      kind: "run",
      ts: seeded.run.envelope.enqueuedAt,
      workflow: seeded.run.envelope.workflow,
      runId,
      attempt: seeded.run.envelope.attempt,
      traceId: seeded.run.envelope.traceId,
      spanPath: seeded.run.envelope.traceId,
      itemId: seeded.run.envelope.itemId,
      shape: seeded.run.envelope.shape,
      priority: seeded.run.envelope.priority,
      dryRun: seeded.run.envelope.dryRun,
      actorId: LOCAL_OPERATOR_ACTOR_ID,
      title: `EID ${String(seeded.run.envelope.itemId).slice(0, 8)}`,
      descriptorVersion: seeded.run.envelope.descriptorVersion,
      contractFingerprint: seeded.run.envelope.contractFingerprint,
      resolvedInstance: seeded.run.envelope.resolvedInstance,
      configFingerprint: seeded.run.envelope.configFingerprint,
      configSnapshotId: seeded.run.envelope.configSnapshotId,
    });

    /* the receipt is DERIVED, and its identities fold from the run's --------- */
    assert.equal(database.authority.evidenceReceipts.findByRun(runId), undefined);
    const derived = world.receipts.ensure(runId);
    assert.equal(derived.state, "derived");
    assert.equal(derived.receipt.runId, runId);
    assert.equal(
      derived.receipt.receiptId,
      deriveEvidenceReceiptId(runId, seeded.run.envelope.attempt),
      "the receipt id folds from the run identity, never from a minted uuid",
    );
    assert.equal(derived.receipt.attempt, seeded.run.envelope.attempt);
    assert.equal(derived.receipt.workflowId, String(personLookupDescriptor.id));
    assert.equal(derived.receipt.generatedAt, EXIT_TERMINAL_AT, "generatedAt is the TERMINAL instant");
    // Re-deriving one run yields the same bytes, which is what lets the store
    // refuse a divergent rebuild by name rather than storing two answers.
    const again = world.receipts.ensure(runId);
    assert.equal(again.state, "existing");
    assert.deepEqual(JSON.parse(JSON.stringify(again.receipt)), JSON.parse(JSON.stringify(derived.receipt)));

    /* the bump freezes THAT record ----------------------------------------- */
    /*
      An APPLICATION-scope sweep, which is charter §25's "a dashboard update
      bumps the effective version of EVERY workflow". The registry is left
      exactly as production has it — the drift is the run's own missing
      `appVersion` stamp, which is the real state of the 2026-08-04 settlement
      (D179 stamped the build after it ran). Swapping in a shallow copy of the
      descriptor to fake a version move would have been a lie the projection
      catches anyway: `descriptorRuntimeNodes` binds to the exact object
      `defineWorkflowDescriptor` returned.
      */
    const lastLiveRow = world.projection.queueSurface(runId);
    const lastLiveDisplay = archiveSnapshots(world.runDetail).snapshot(runId);
    assert.deepEqual(lastLiveDisplay.row,lastLiveRow);
    const reviewed = versionCommand(world, "plan-version-bump", {
      scope: { kind: "application", applicationVersion: APP_VERSION },
    }, { targetVersion: "0.2.0", changeFingerprint: HASH_C, changeRecord: WALK_CHANGE_RECORD });
    assert.equal(reviewed.state, "applied", reviewed.state === "rejected" ? reviewed.message : "plan refused");
    const target = reviewed.state === "applied" ? reviewed.affectedTargets[0] : undefined;
    const versionPlanId = target?.family === "version-archive" ? target.versionPlanId : "";
    const stored = createRunLifecycleStorage(database).readVersionChange(versionPlanId);
    assert.ok(stored);
    const applied = versionCommand(
      world,
      "apply-version-bump",
      { versionPlanId, expectedVersion: 1 },
      { planFingerprint: publicVersionReviewFingerprint(stored) },
    );
    assert.equal(applied.state, "applied", applied.state === "rejected" ? applied.message : "apply refused");

    const archived = createRunLifecycleStorage(database).readReport(runId);
    if (archived === undefined) throw new Error("the exit run was not archived");
    const expectedDisplay = genericArchiveSection("Displayed run",JsonValueSchema.parse(lastLiveDisplay));
    if (expectedDisplay.kind !== "values") throw new Error("wrong display section");
    for (const cell of expectedDisplay.values) {
      if (cell.label === "row.itemId") cell.value = "[protected]-0000-4000-8000-000000000001";
      if (cell.label === "row.descriptorHash" || cell.label === "row.configFingerprint") cell.value = "[protected digest]";
    }
    assert.deepEqual(archived.content.sections.find(section=>section.title === "Displayed run"),expectedDisplay,
      "the frozen projection changes only the three known protected display cells");
    const captured = LifecycleSourceSnapshotSchema.parse(JSON.parse(archived.content.sources[0].json));
    const receiptRows=captured.records.find(group=>group.table === "run_receipts")!.rows;
    assert.equal(receiptRows.length,1);
    assert.deepEqual(JSON.parse(receiptRows[0].json),JSON.parse(JSON.stringify(derived.receipt)),
      "the report retains the exact receipt already derived by authority");
    assert.deepEqual(captured.records.find(group=>group.table === "run_checkpoints")!.rows.map(row=>(JSON.parse(row.json) as {nodeId:string}).nodeId).sort(),
      ["active-status","cross-verify","searching"]);

  });
});
