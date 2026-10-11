import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname,join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { buildRunResult } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { deriveRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION,SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { admitDirectWorker,admitWorkerPoolRoster } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { type AuthorityTableName } from "../../../../src/models/config/authority.js";
import { OPERATOR_XLSX_MEDIA_TYPE } from "../../../../src/models/dashboard/xlsx-export.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { ReadActiveStatus } from "../../../../src/models/workflows/person-lookup/read-active-status.js";
import {
CommandRequestSchema,
deriveBulkRunCommandFingerprint
} from "../../../../src/rules/commands/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { projectNotificationTrigger } from "../../../../src/rules/notifications/notification-triggers.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { deriveIdempotencyKeyDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { PersonLookupCanonicalInput } from "../../../../src/workflows/person-lookup/workflow.js";
import { explorerAuthorityFixture } from "../../../support/fixtures/explorer-authority.js";
import {
COMMAND_FIXTURES,
CONFIG_SNAPSHOT,
DELEGATION_MANIFEST,
DEPENDENCY_RECORD,
GATE_RESULT,
HASH_A,
HASH_B,
HASH_C,
ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT,
LATER,
NOTIFICATION,
NOW,
UUID_1,
UUID_2,
UUID_3,
UUID_5,
UUID_6,
UUID_7,
UUID_8,
WRITE_ATTEMPT,
WRITE_INTENT_ATTEMPTING
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
QUEUED_RUN,
RUN_ID,
RUN_SESSION,
START_PLAN,
WORKER_START_REQUEST,
WORKFLOW_ID,
} from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { atomicWriteCheckpoint,currentAtomicWriteFixture,seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";

const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_ATOMIC_WRITE_COMMIT);

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const databasePaths = new WeakMap<AuthorityDatabase, string>();
const CLOCK = manualClock(new Date(NOW));
const SCHEMA_BOUND_VALUE = { schemaHash: HASH_A, value: { verified: true } };
const BULK_COMMAND_REQUEST = {
  commandId: UUID_8,
  requestedAt: NOW,
  requestedBy: "local-operator",
  source: "dashboard",
  family: "run",
  type: "cancel",
  bulkCommandId: UUID_8,
  targets: [{ runId: RUN_ID, expectedVersion: 1 }],
  mode: "best-effort",
} as const;
const BULK_COMMAND_ACCEPTANCE = {
  bulkCommandId: UUID_8,
  requestFingerprint: deriveBulkRunCommandFingerprint(BULK_COMMAND_REQUEST),
  request: BULK_COMMAND_REQUEST,
};

const OPERATOR_XLSX_EXPORT = {
  exportId: UUID_7,
  workbookVersion: 3 as const,
  requestedBy: LOCAL_OPERATOR_ACTOR_ID,
  createdAt: NOW,
  selection: {
    kind: "search" as const,
    query: {
      q: "separations",
      scope: "workflow" as const,
      facets: { day: "2026-07-31", dryRun: true as const },
      limit: 20,
    },
    snapshot: {
      generatedAt: NOW,
      sourceIdentity: HASH_C,
      authorityGeneration: 3,
      order: "match-strength/enqueued-desc/run-id-asc:v2" as const,
      totalMatches: 1,
      coverage: { matched: 1, subjectUnavailable: 0, actorUnavailable: 0, candidateLimit: 10000 as const },
    },
  },
  workbook: { sheetNames: ["Read Me", "Runs"] as const, rowCount: 1 },
  artifact: {
    id: UUID_8,
    sha256: HASH_A,
    bytes: 1_024,
    mediaType: OPERATOR_XLSX_MEDIA_TYPE,
  },
  download: {
    filename: "hr-run-search-2026-07-31-g3.xlsx",
    mediaType: OPERATOR_XLSX_MEDIA_TYPE,
    contentDisposition: "attachment; filename=\"hr-run-search-2026-07-31-g3.xlsx\"",
    byteLength: 1_024,
    sha256: HASH_A,
  },
};
const ACTIVE_STATUS = {
  state: "active" as const,
  reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
  hdh: true,
};
const FAILURE_RECORD = {
  failureId: UUID_6,
  fingerprint: HASH_C,
  runId: RUN_ID,
  traceId: QUEUED_RUN.envelope.traceId,
  attempt: 1,
  workflowId: WORKFLOW_ID,
  code: "UNEXPECTED_PAGE_STATE",
  summary: "The current page state was not recognized",
  transient: false,
  writeState: "not-attempted",
  causeChain: [{
    code: "UNEXPECTED_PAGE_STATE",
    summary: "The current page state was not recognized",
    role: "primary",
    transient: false,
  }],
  remediation: [{ kind: "code-change", message: "Map the verified page state" }],
  occurredAt: LATER,
};
const DIAGNOSTIC_BUNDLE = {
  bundleId: UUID_5,
  runId: RUN_ID,
  origin: { kind: "failure", failureId: FAILURE_RECORD.failureId },
  createdAt: LATER,
  contentDigest: HASH_A,
  configFingerprint: HASH_B,
  descriptorFingerprint: HASH_C,
  redaction: {
    fields: [{ state: "redacted", key: "input.ssn", classification: "sensitive-hr", transform: "drop" }],
    warnings: [],
  },
  attachments: [{
    kind: "accessibility-excerpt",
    artifactId: UUID_7,
    mediaType: "text/yaml",
    byteLength: 128,
    digest: HASH_B,
    sensitivity: "redacted",
  }],
  retention: { kind: "pinned", reason: "write-recovery" },
};
const RUN_CHECKPOINT = {
  workflowId: "person-lookup",
  itemId: UUID_3,
  nodeId: "searching",
  attempt: 1,
  claimGeneration: 1,
  runId: UUID_1,
  output: SCHEMA_BOUND_VALUE,
  descriptorVersion: 1,
  contractFingerprint: HASH_A,
  implFingerprint: HASH_B,
  provenance: [{ path: "verified", source: "live", observedAt: NOW, originalObservedAt: NOW }],
  writtenAt: NOW,
};
const COMMAND_AUDIT = {
  auditId: UUID_2,
  request: COMMAND_FIXTURES[0],
  result: {
    state: "applied",
    commandId: UUID_1,
    affectedTargets: [{ family: "start", workflowId: "onboarding", startPlanId: UUID_3, expectedVersion: 1 }],
  },
  completedAt: NOW,
  versionChanges: [],
  affectedDependencyIds: [],
};
const OBSERVED_PRESENT_WRITE_INTENT = {
  writeIntentId: UUID_7,
  workflowId: "separation",
  itemId: UUID_5,
  taskId: "ucpath/terminate-person",
  system: "ucpath",
  idempotencyKey: "10001573|termination|2026-08-02",
  idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", "10001573|termination|2026-08-02"),
  generation: 1,
  status: "observed-present",
  observedProof: { schemaHash: HASH_A, value: "receipt-seen-during-recovery" },
  observedAt: NOW,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

function databasePath(name = "authority.sqlite"): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-rebuild-sqlite-"));
  roots.push(root);
  return join(root, name);
}

function openDatabase(path = databasePath(), busyTimeoutMs = 250): AuthorityDatabase {
  const database = AuthorityDatabase.open({ path, busyTimeoutMs, migrationOwner: "unit-test" }, CLOCK);
  openDatabases.push(database);
  databasePaths.set(database, path);
  return database;
}

function claimedWorkerId(run: ReturnType<typeof prepareRunning>): string {
  if (run.lifecycle.state !== "claimed" && run.lifecycle.state !== "validating" && run.lifecycle.state !== "running") {
    throw new Error("fixture-run-not-held");
  }
  return run.lifecycle.workerId;
}

function prepareWorkerSlot(database: AuthorityDatabase) {
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const path = databasePaths.get(database);
  if (path === undefined) throw new Error("fixture-authority-path-missing");
  const slot = database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
    commandId: randomUUID(), workflow: WORKFLOW_ID, poolIndex: 1,
    expectedPoolVersion: repositories.workerPools.get(WORKFLOW_ID)?.version ?? 0,
    processId: process.pid, processAcquisitionId: randomUUID(), authorityPath: path,
    processLockRoot: join(dirname(path), "locks"), now: NOW,
  }, randomUUID()));
  return slot;
}

function prepareRunning(database: AuthorityDatabase) {
  const slot = prepareWorkerSlot(database);
  assert.equal(database.authority.workerLeases.start({ ...WORKER_START_REQUEST, workerId: slot.workerId }).state, "started");
  database.authority.runs.enqueue({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
        protectedBindings: [],
      },
    },
  });
  const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: slot.workerId, now: NOW });
  if (claimed.state !== "claimed") throw new Error("generation fixture did not claim a run");
  const validating = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: claimed.run.version,
    claim: { workerId: slot.workerId, claimGeneration: 1 },
    lifecycle: { state: "validating", workerId: slot.workerId, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  if (validating.state !== "applied") throw new Error("generation fixture did not validate");
  const running = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: validating.run.version,
    claim: { workerId: slot.workerId, claimGeneration: 1 },
    lifecycle: { state: "running", workerId: slot.workerId, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  if (running.state !== "applied") throw new Error("generation fixture did not run");
  return running.run;
}

/** Ref operator-trust's trust records hang off a real terminal run and its durable failure. */
function prepareDelegationOwners(database: AuthorityDatabase): void {
  database.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope,
    runId: DELEGATION_MANIFEST.parentRunId, itemId: UUID_6, traceId: "pl-120000-0003", shape: "operation" } });
  database.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope,
    runId: DEPENDENCY_RECORD.childRunId, itemId: DEPENDENCY_RECORD.childItemId, traceId: "pl-120000-0004",
    parent: { runId: DELEGATION_MANIFEST.parentRunId, edgeId: DELEGATION_MANIFEST.edgeId, tracePrefix: "pl-120000-0003" } } });
}

function terminalizeForTrust(database: AuthorityDatabase): void {
  const run = prepareRunning(database);
  database.terminalizeFailure(personLookupDescriptor, terminalFailureRequest(run));
}

function terminalFailureRequest(run: ReturnType<typeof prepareRunning>) {
  return {
    failure: FAILURE_RECORD,
    authorization: {
      kind: "failed" as const,
      runId: run.envelope.runId,
      workflowId: run.envelope.workflow,
      attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      expectedVersion: run.version,
      claim: { workerId: claimedWorkerId(run), claimGeneration: 1 },
      authorizedAt: LATER,
      failureId: FAILURE_RECORD.failureId,
    },
  };
}

function terminalSuccessRequest(database: AuthorityDatabase, run: ReturnType<typeof prepareRunning>) {
  const checkpoint = RunCheckpointRecordSchema.parse({
    workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId,
    nodeId: "active-status",
    attempt: run.envelope.attempt,
    claimGeneration: run.claimGeneration,
    runId: run.envelope.runId,
    output: {
      schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"),
      value: ACTIVE_STATUS,
    },
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint,
    implFingerprint: HASH_B,
    provenance: [{ path: "state", source: "derived", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
  if (database.authority.runCheckpoints.get(
    checkpoint.workflowId,
    checkpoint.itemId,
    checkpoint.nodeId,
    checkpoint.attempt,
    checkpoint.claimGeneration,
  ) === undefined) {
    database.authority.runCheckpoints.insert(checkpoint);
  }
  const built = buildRunResult(personLookupDescriptor, run, [
    { state: "resolved", nodeId: "active-status", checkpoint },
    { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
  ], CLOCK);
  return {
    request: {
      result: built.record,
      authorization: {
        kind: "done" as const,
        runId: built.record.runId,
        workflowId: built.record.workflowId,
        attempt: built.record.attempt,
        descriptorVersion: built.record.descriptorVersion,
        contractFingerprint: built.record.contractFingerprint,
        expectedVersion: run.version,
        claim: { workerId: claimedWorkerId(run), claimGeneration: 1 },
        authorizedAt: LATER,
        resultDigest: built.record.resultDigest,
      },
    },
    factoryAuthorization: built.authorization,
  };
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("native SQLite authority schema", () => {

  it("creates a fresh authority at the current schema with one baseline journal row", () => {
    const path = databasePath("fresh-v32.sqlite");
    openDatabase(path).close();

    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(raw.prepare("PRAGMA user_version").get() ?? {}, "user_version"), CURRENT_AUTHORITY_SCHEMA_VERSION);
      const row = raw.prepare(`
        SELECT id, upgrade_id, phase, payload_json
        FROM database_upgrades
      `).get() ?? {};
      const record = JSON.parse(String(Reflect.get(row, "payload_json"))) as Record<string, unknown>;
      assert.deepEqual({
        recordKey: record.recordKey,
        upgradeId: record.upgradeId,
        phase: record.phase,
        fromSchemaVersion: record.fromSchemaVersion,
        toSchemaVersion: record.toSchemaVersion,
        by: record.by,
        recordedAt: record.recordedAt,
      }, {
        recordKey: Reflect.get(row, "id"),
        upgradeId: "fresh",
        phase: "baseline",
        fromSchemaVersion: 0,
        toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
        by: "local-operator",
        recordedAt: NOW,
      });
      assert.equal(Reflect.get(row, "upgrade_id"), "fresh");
      assert.equal(Reflect.get(row, "phase"), "baseline");
    } finally {
      raw.close();
    }
  });

  it("fails loud for empty, foreign, newer, locked, and structurally invalid databases", () => {
    const emptyPath = databasePath("empty.sqlite");
    writeFileSync(emptyPath, "");
    assert.throws(() => openDatabase(emptyPath), /exists but is empty/);

    const foreignPath = databasePath("foreign.sqlite");
    writeFileSync(foreignPath, "not a sqlite database");
    const foreignBytes = readFileSync(foreignPath);
    assert.throws(() => openDatabase(foreignPath), { code: "ERR_SQLITE_ERROR", errcode: 26, message: "file is not a database" });
    assert.deepEqual(readFileSync(foreignPath), foreignBytes);

    const newerPath = databasePath("newer.sqlite");
    openDatabase(newerPath).close();
    const newer = new DatabaseSync(newerPath);
    newer.exec(`PRAGMA user_version = ${String(CURRENT_AUTHORITY_SCHEMA_VERSION + 1)}`);
    newer.close();
    assert.throws(() => openDatabase(newerPath), /authority schema 2 does not match supported 1/);

    const malformedPath = databasePath("malformed.sqlite");
    openDatabase(malformedPath).close();
    const malformed = new DatabaseSync(malformedPath);
    malformed.exec("DROP TABLE artifacts");
    malformed.close();
    assert.throws(() => openDatabase(malformedPath), /authority-native-schema-shape-mismatch/);

    const badForeignKeyPath = databasePath("bad-foreign-key.sqlite");
    openDatabase(badForeignKeyPath).close();
    const badForeignKey = new DatabaseSync(badForeignKeyPath, { enableForeignKeyConstraints: false });
    badForeignKey.prepare(`
      INSERT INTO command_audits (id, command_id, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(UUID_2, UUID_8, JSON.stringify(COMMAND_AUDIT), NOW);
    badForeignKey.close();
    assert.throws(() => openDatabase(badForeignKeyPath), /foreign-key validation failed/);
  });
});
const INTAKE_MANIFEST = {
  version: 1,
  manifestId: "9f8a1c2d-4b5e-4a6f-9c8d-0e1f2a3b4c5d",
  workflow: "work-study",
  source: {
    artifactId: "11111111-2222-4333-8444-555555555555",
    sha256: "3f1c0a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
    originalName: "WorkStudy_July.xlsx",
  },
  mappingFingerprint: "a".repeat(64),
  mappingSnapshotHash: "b".repeat(64),
  intakeProjectionFingerprint: "c".repeat(64),
  workflowContractFingerprint: "d".repeat(64),
  canonicalInputSchemaHash: "e".repeat(64),
  createdAt: "2026-08-07T09:00:00.000Z",
  totals: { sourceRows: 1, valid: 1, rejected: 0, rejectionEvents: 0, excluded: 0, corrected: 0 },
  sourceRowDispositions: [{
    sourceRow: 1,
    disposition: "valid",
    itemId: "22222222-3333-4444-8555-666666666666",
    currentRejectIds: [],
  }],
  validRows: [{
    sourceRow: 1,
    itemId: "22222222-3333-4444-8555-666666666666",
    inputHash: "f".repeat(64),
    parsedInput: { emplId: "10456712" },
  }],
  rejectedRows: [],
  corrections: [],
  exclusions: [],
};

const OCR_EXTRACTION = {
  formType: "oath",
  source: { kind: "local-agent", agentId: "claude-code", invocation: "read page1.png" },
  readAt: "2026-08-07T09:00:00.000Z",
  sourceSha256: "3f1c0a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
  sourcePage: 1,
  pageKind: "emergency-contact",
  record: null,
  pageFingerprint: "1".repeat(64),
};
const DRY_RUN_SCENARIO_RESULT = {
  resultId: UUID_8,
  scenarioId: "person-lookup/dry-run",
  workflow: "person-lookup",
  subjectLabel: "ordinary-canary",
  manifestDigest: HASH_A,
  verdict: "blocked",
  assertions: [{
    assertionId: "subject-available",
    verdict: "blocked",
    reason: "subject-unavailable",
  }],
  wallTimeMs: 0,
  recordedAt: NOW,
  execution: { state: "not-started", reason: "subject-unavailable" },
};

describe("authority generation accounting", () => {

  type MutationCase = Readonly<{
    table: Exclude<AuthorityTableName, "database_states" | "database_upgrades">;
    prepare?: (database: AuthorityDatabase) => void;
    mutate: (database: AuthorityDatabase) => void;
  }>;

  const cases: readonly MutationCase[] = [
    { table: "runs", mutate: (db) => { db.authority.runs.enqueue(QUEUED_RUN); } },
    {
      table: "run_failures",
      prepare: (db) => { prepareRunning(db); },
      mutate: (db) => {
        const run = db.authority.runs.get(RUN_ID);
        if (run === undefined) throw new Error("failure generation fixture lost its run");
        db.terminalizeFailure(personLookupDescriptor, terminalFailureRequest(run));
      },
    },
    {
      table: "run_results",
      prepare: (db) => {
        const run = prepareRunning(db);
        terminalSuccessRequest(db, run);
      },
      mutate: (db) => {
        const run = db.authority.runs.get(RUN_ID);
        if (run === undefined) throw new Error("result generation fixture lost its run");
        const terminal = terminalSuccessRequest(db, run);
        db.terminalizeSuccess(terminal.request, terminal.factoryAuthorization);
      },
    },
    {
      table: "diagnostic_snapshots",
      prepare: (db) => { terminalizeForTrust(db); },
      mutate: (db) => { db.authority.diagnosticBundles.insert(DIAGNOSTIC_BUNDLE); },
    },
    {
      table: "diagnostic_files",
      prepare: (db) => { terminalizeForTrust(db); },
      mutate: (db) => { db.authority.diagnosticBundles.insert(DIAGNOSTIC_BUNDLE); },
    },
    {
      table: "run_receipts",
      prepare: (db) => { terminalizeForTrust(db); },
      mutate: db => {
        const run = db.authority.runs.get(RUN_ID); assert.ok(run);
        const result = db.authority.runResults.get(RUN_ID); assert.ok(result);
        const failure = db.authority.failures.get(FAILURE_RECORD.failureId); assert.ok(failure);
        db.authority.evidenceReceipts.insert(deriveRunEvidenceReceipt({ descriptor: personLookupDescriptor,
          run, result, failure, checkpoints: [], writes: [], gateResults: [] }).receipt);
      },
    },
    {
      table: "dryrun_results",
      mutate: (db) => { db.authority.dryRunScenarioResults.insert(DRY_RUN_SCENARIO_RESULT); },
    },
    {
      table: "artifacts",
      mutate: (db) => { db.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT); },
    },
    { table: "run_search", mutate: db=>{db.authority.runs.enqueue(QUEUED_RUN);} },
    { table: "timeline_events", prepare:db=>{db.authority.runs.enqueue(QUEUED_RUN);},mutate:db=>{
      const e=QUEUED_RUN.envelope;
      createTimelineEmitter({repository:db.authority.timelineEvents,clock:CLOCK,pid:4242}).emit({
        t:"run.queued",kind:"run",ts:NOW,workflow:e.workflow,runId:e.runId,attempt:e.attempt,traceId:e.traceId,
        spanPath:e.traceId,itemId:e.itemId,shape:e.shape,priority:e.priority,dryRun:e.dryRun,actorId:"fixture-actor",title:"Fixture",
        descriptorVersion:e.descriptorVersion,contractFingerprint:e.contractFingerprint,resolvedInstance:e.resolvedInstance,
        configFingerprint:e.configFingerprint,configSnapshotId:e.configSnapshotId,
      });
    } },
    { table: "write_intents",prepare:db=>{
      seedAtomicWriteOwner(db,ATOMIC_WRITE_COMMIT,databasePaths.get(db) ?? (() => { throw new Error("missing fixture path"); })());
      assert.equal(db.authority.writeIntents.fenceAttempt({intent:WRITE_INTENT_ATTEMPTING,attempt:WRITE_ATTEMPT}).state,"fenced");
    },mutate:db=>{db.commitWriteAttempt(ATOMIC_WRITE_COMMIT,atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));} },
    { table: "artifacts", mutate: (db) => { db.authority.intakeManifests.insert(INTAKE_MANIFEST); } },
    { table: "artifacts", mutate: (db) => { db.authority.ocrExtractions.insert(OCR_EXTRACTION); } },
    { table: "worker_leases", prepare: db => { prepareWorkerSlot(db); }, mutate: db => {
      const slot = db.authority.workerSlots.list(WORKFLOW_ID)[0]; assert.ok(slot);
      db.authority.workerLeases.start({ ...WORKER_START_REQUEST, workerId: slot.workerId });
    } },
    {
      table: "auth_leases",
      prepare: db => { prepareRunning(db); },
      mutate: (db) => {
        db.authority.duoCeremonyLeases.acquire({
          credentialKey: "ab".repeat(32), workerId: db.authority.workerSlots.list(WORKFLOW_ID)[0]?.workerId, system: "ucpath",
          now: "2026-08-21T10:00:00.000Z", ttlMs: 80_000,
        });
      },
    },
    {
      table: "worker_pools",
      mutate: (db) => {
        db.authority.workerPools.plan({
          workflow: WORKFLOW_ID, expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW,
        });
      },
    },
    { table: "run_batches", mutate: (db) => { db.authority.runSessions.insert(RUN_SESSION); } },
    {

      table: "deleted_runs",
      prepare: db => {
        const run = prepareRunning(db);
        const service = testRunService(db, CLOCK);
        const requested = service.transition({ commandId: UUID_8, runId: RUN_ID, expectedVersion: run.version,
          lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
        assert.equal(requested.state, "applied");
        if (requested.state !== "applied") throw new Error("fixture-cancellation-not-requested");
        assert.equal(service.terminalize({ kind: "cancelled", commandId: UUID_5, runId: RUN_ID,
          expectedVersion: requested.run.version, claim: { workerId: claimedWorkerId(run), claimGeneration: run.claimGeneration },
          endedAt: NOW }, personLookupDescriptor).state, "applied");
      },
      mutate: db => {
        const run = db.authority.runs.get(RUN_ID); assert.ok(run);
        assert.equal(testRunService(db, CLOCK).delete({ commandId: UUID_7, runId: RUN_ID, expectedVersion: run.version }).state, "deleted");
      },
    },
    { table: "run_delegations", prepare: prepareDelegationOwners, mutate: (db) => { db.authority.delegationManifests.insert(DELEGATION_MANIFEST); } },
    { table: "delegation_dependencies", prepare: (db) => { prepareDelegationOwners(db); db.authority.delegationManifests.insert(DELEGATION_MANIFEST); }, mutate: (db) => { db.authority.dependencies.insert(DEPENDENCY_RECORD); } },
    { table: "commands", mutate: (db) => { db.authority.commands.insert(COMMAND_FIXTURES[0]); } },
    { table: "command_audits", prepare: (db) => { db.authority.commands.insert(COMMAND_FIXTURES[0]); }, mutate: (db) => { db.authority.commandAudits.insert(COMMAND_AUDIT); } },
    { table: "explorer_overrides", mutate: db => {
      const f = explorerAuthorityFixture();
      try {
        const command = f.command(UUID_7);
        const result = f.kernel.execute(command);
        assert.equal(result.state, "applied");
        const override = f.database.authority.explorerOverrides.read(command.target.workflowId);
        const audit = f.database.authority.commandAudits.findByCommand(command.commandId);
        assert.ok(override); assert.ok(audit);
        db.withAuthorityTransaction(repos => {
          repos.commands.insert(command);
          repos.explorerOverrides.replace(command, override);
          repos.commandAudits.insert(audit);
        });
      } finally { f.dispose(); }
    } },
    { table: "notifications", mutate: (db) => { db.authority.notifications.create(NOTIFICATION); } },
    { table: "notifications", prepare: db => { db.authority.notifications.create({ ...NOTIFICATION,
      ...projectNotificationTrigger({ kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: HASH_A }) }); }, mutate: db => {
      db.withAuthorityTransaction(repos => repos.notificationPublications.create({ sourceId: HASH_A, actorId: NOTIFICATION.actorId,
        notificationId: NOTIFICATION.notificationId, event: { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: HASH_A },
        occurredAt: NOW, createdAt: NOW, adopted: false }));
    } },
    { table: "notification_states", mutate: db => { db.withAuthorityTransaction(repos => repos.notificationHealth.put({
      concern: "disk-space", active: false, occurrence: 0, samples: [], observedAt: NOW, createdAt: NOW,
    })); } },
    { table: "settings_snapshots", mutate: (db) => { db.authority.configSnapshots.insert(CONFIG_SNAPSHOT); } },
    { table: "settings", mutate: db => { db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT); } },
    { table: "worker_slots", mutate: db => {
      const path = databasePaths.get(db);
      if (path === undefined) throw new Error("fixture-authority-path-missing");
      db.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
        commandId: randomUUID(), workflow: WORKFLOW_ID, poolIndex: 1, expectedPoolVersion: 0,
        processId: process.pid, processAcquisitionId: randomUUID(), authorityPath: path,
        processLockRoot: join(dirname(path), "locks"), now: NOW,
      }, randomUUID()));
    } },
    { table: "worker_controls", mutate: db => {
      const request = CommandRequestSchema.parse({ commandId: UUID_1, family: "worker-browser", type: "plan-worker-count",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 0 }, payload: { desiredWorkers: 1 },
        requestedAt: NOW, requestedBy: "local-operator", source: "dashboard" });
      if (request.family !== "worker-browser" || request.type !== "plan-worker-count") throw new Error("fixture-worker-plan-kind");
      db.withAuthorityTransaction(repositories => {
        repositories.commands.insert(request);
        const roster = admitWorkerPoolRoster(repositories, request, NOW);
        repositories.workerControls.admit({ commandId: request.commandId, request, roster,
          scope: "worker-pool:person-lookup", executorId: UUID_2, admittedAt: NOW, expiresAt: LATER,
          basisVersion: 0, phase: { state: "admitted" } });
      });
    } },
    { table: "browser_sessions", prepare: db => { prepareRunning(db); }, mutate: db => {
      const slot = db.authority.workerSlots.list(WORKFLOW_ID)[0]; assert.ok(slot);
      db.authority.workerControls.observe({ workerId: slot.workerId, leaseGeneration: 1,
        sessionId: UUID_1, system: "crm", configFingerprint: HASH_A, signInFingerprint: HASH_B,
        browserMode: "headless", acceptDownloads: false, exclusive: false, health: "authenticated",
        openedAt: NOW, observedAt: NOW, profileRevision: 1 });
    } },
    { table: "gate_results", prepare: db => {
      db.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId: GATE_RESULT.runId } });
      db.authority.commands.insert(COMMAND_FIXTURES[0]);
    }, mutate: (db) => { db.authority.gateResults.insert(GATE_RESULT); } },
    { table: "run_checkpoints", prepare: (db) => {
      db.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope,
        runId: RUN_CHECKPOINT.runId, itemId: RUN_CHECKPOINT.itemId, workflow: RUN_CHECKPOINT.workflowId } });
    }, mutate: (db) => { db.authority.runCheckpoints.insert(RUN_CHECKPOINT); } },
    { table: "timeline_events", mutate: (db) => {
      db.authority.timelineEvents.append({ schemaVersion: 1, eventId: UUID_8, workflow: "person-lookup",
        scope: { kind: "worker", workerId: "timeline-worker" }, occurredAt: NOW, recordedAt: NOW,
        retentionDate: NOW.slice(0, 10), source: { kind: "native" }, payload: { kind: "span", event: {
          t: "span.started", kind: "worker", workflow: "person-lookup", ts: NOW, pid: 4242,
          workerId: "timeline-worker", spanPath: "worker/timeline-worker", name: "Worker" } } });
    } },
    { table: "run_requests", mutate: (db) => { db.authority.startPlans.create(START_PLAN); } },
    { table: "write_intents", mutate: (db) => { db.authority.writeIntents.recordObservedPresent(OBSERVED_PRESENT_WRITE_INTENT); } },
    { table: "write_attempts", prepare: (db) => { seedAtomicWriteOwner(db, ATOMIC_WRITE_COMMIT, databasePaths.get(db) ?? (() => { throw new Error("missing fixture path"); })()); }, mutate: (db) => { db.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }); } },
  ];

  it("#16 enumerates every current deletion guard and each aborts without an admitted owner deletion", () => {
    const expected = SQLITE_MIGRATIONS.flatMap(({ statements }) => statements.flatMap(statement =>
      [...statement.matchAll(/CREATE TRIGGER\s+([a-z0-9_]+)\s+BEFORE DELETE ON "?([a-z0-9_]+)"?[\s\S]*?BEGIN SELECT RAISE\(ABORT,'([^']+)'\); END;/gu)]
        .map(match => ({ name: match[1], tableName: match[2], message: match[3] }))));
    assert.ok(expected.length > 0, "deletion guard census must not be empty");
    const inventory = openDatabase();
    const inventoryPath = databasePaths.get(inventory); assert.ok(inventoryPath);
    const rawInventory = new DatabaseSync(inventoryPath);
    try {
      const actual = rawInventory.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND sql LIKE '%BEFORE DELETE ON%' ORDER BY name").all();
      assert.deepEqual(actual.map(row => row.name), expected.map(trigger => trigger.name).sort());
    } finally { rawInventory.close(); }
    for (const trigger of expected) {
      assert.ok(trigger.tableName); assert.ok(trigger.message); assert.ok(trigger.name);
      assert.match(trigger.tableName, /^[a-z0-9_]+$/u);
      const database = openDatabase();
      const path = databasePaths.get(database); assert.ok(path);
      if (trigger.name === "commands_bulk_retained") {
        database.authority.commands.acceptBulk(BULK_COMMAND_ACCEPTANCE);
      } else if (trigger.tableName === "timeline_events") {
        seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, path);
        assert.equal(database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }).state, "fenced");
        database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
      } else if (trigger.tableName !== "database_upgrades") {
        const mutation = cases.find(({ table }) => table === trigger.tableName);
        assert.ok(mutation, `${trigger.name} needs a current owner fixture`);
        if (mutation.table !== "settings" && mutation.table !== "settings_snapshots") database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
        mutation.prepare?.(database);
        mutation.mutate(database);
      }
      const raw = new DatabaseSync(path);
      try {
        const count = raw.prepare(`SELECT count(*) AS count FROM "${trigger.tableName}"`).get();
        assert.ok(typeof count?.count === "number" && count.count > 0, `${trigger.name} must be driven against a real row`);
        assert.throws(() => raw.exec(`DELETE FROM "${trigger.tableName}"`),
          error => error instanceof Error && error.message === trigger.message, trigger.name);
      } finally { raw.close(); }
    }
  });
});
