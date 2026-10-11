import { createAuthorityAccountingTestWorld } from "../../../support/helpers/backend/authority-accounting-world.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { deriveRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { admitDirectWorker, admitWorkerPoolRoster } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { type AuthorityTableName } from "../../../../src/models/config/authority.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { projectNotificationTrigger } from "../../../../src/rules/notifications/notification-triggers.js";
import { explorerAuthorityFixture } from "../../../support/fixtures/explorer-authority.js";
import { COMMAND_FIXTURES, CONFIG_SNAPSHOT, DELEGATION_MANIFEST, DEPENDENCY_RECORD, GATE_RESULT, HASH_A, HASH_B, LATER, NOTIFICATION, NOW, UUID_1, UUID_2, UUID_3, UUID_5, UUID_7, UUID_8, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, RUN_SESSION, START_PLAN, WORKER_START_REQUEST, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { atomicWriteCheckpoint, seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";
import { DatabaseSync } from "node:sqlite";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { IDEMPOTENCY_KEY, UUID_4, UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";


{
const { ATOMIC_WRITE_COMMIT, roots, openDatabases, databasePaths, CLOCK, BULK_COMMAND_ACCEPTANCE, OPERATOR_XLSX_EXPORT, FAILURE_RECORD, DIAGNOSTIC_BUNDLE, RUN_CHECKPOINT, COMMAND_AUDIT, OBSERVED_PRESENT_WRITE_INTENT, databasePath, openDatabase, claimedWorkerId, prepareWorkerSlot, prepareRunning, prepareDelegationOwners, terminalizeForTrust, terminalFailureRequest, terminalSuccessRequest, INTAKE_MANIFEST, OCR_EXTRACTION, DRY_RUN_SCENARIO_RESULT } = createAuthorityAccountingTestWorld();

const INTAKE_SESSION = {
  intakeSessionId: "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5e",
  actorId: "local-operator",
  workflow: "person-lookup",
  artifact: {
    id: "11111111-2222-4333-8444-555555555555",
    sha256: "3f1c0a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
    bytes: 2048,
    mediaType: "text/csv",
  },
  sheet: "default",
  headerRowIndex: null,
  bindings: [],
  constants: [],
  corrections: [],
  exclusions: [],
  state: "mapping",
  validation: { state: "none" },
  reservedManifestId: "8e7d6c5b-4a39-4827-9615-0f1e2d3c4b5a",
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

describe("authority generation accounting", () => {
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

  it("keeps one read snapshot while another connection commits without waiting", () => {
    const path = databasePath("concurrent-read-snapshot.sqlite");
    const reader = openDatabase(path, 10);
    const writer = openDatabase(path, 10);

    const during = reader.withAuthorityReadSnapshot(() => {
      const generation = reader.getMeta().authorityGeneration;
      writer.authority.notifications.create(NOTIFICATION);
      return {
        generation,
        generationAfterWriterCommit: reader.getMeta().authorityGeneration,
        notification: reader.authority.notifications.get(NOTIFICATION.notificationId),
      };
    });

    assert.deepEqual({
      during,
      generationAfterSnapshot: reader.getMeta().authorityGeneration,
      notificationAfterSnapshot: reader.authority.notifications.get(NOTIFICATION.notificationId),
    }, {
      during: {
        generation: 0,
        generationAfterWriterCommit: 0,
        notification: undefined,
      },
      generationAfterSnapshot: 1,
      notificationAfterSnapshot: NOTIFICATION,
    });
  });

  type MutationCase = Readonly<{
    table: Exclude<AuthorityTableName, "database_states" | "database_upgrades">;
    prepare?: (database: AuthorityDatabase) => void;
    mutate: (database: AuthorityDatabase) => void;
  }>;

  const _cases: readonly MutationCase[] = [
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

  it("accounts intake preparation in its single imported authority row", () => {
    const db=openDatabase();const before=db.getMeta().authorityGeneration;
    db.authority.intakeSessions.create(INTAKE_SESSION);
    assert.equal(db.getMeta().authorityGeneration,before+1);
    assert.deepEqual(db.authority.intakeSessions.get(INTAKE_SESSION.intakeSessionId),INTAKE_SESSION);
  });

  it("accounts parent acceptance in commands once without an execution audit", () => {
    const db = openDatabase(databasePath("bulk-parent-generation.sqlite"));
    const before = db.getMeta().authorityGeneration;
    assert.equal(db.authority.commands.acceptBulk(BULK_COMMAND_ACCEPTANCE).state, "inserted");
    assert.equal(db.getMeta().authorityGeneration, before + 1);
    assert.equal(db.authority.commands.acceptBulk(BULK_COMMAND_ACCEPTANCE).state, "existing");
    assert.equal(db.getMeta().authorityGeneration, before + 1);
    assert.equal(db.authority.commandAudits.findByCommand(BULK_COMMAND_ACCEPTANCE.bulkCommandId), undefined);
  });

  it("shares nested authority transactions and increments exactly once", () => {
    const database = openDatabase();
    database.withAuthorityTransaction((authority) => {
      authority.commands.insert(COMMAND_FIXTURES[0]);
      database.withAuthorityTransaction((nested) => {
        nested.notifications.create(NOTIFICATION);
      });
    });
    assert.equal(database.getMeta().authorityGeneration, 1);
  });

  it("rolls back a caught nested atomic outbox failure while committing unrelated outer work once", () => {
    const path = databasePath();
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
      CLOCK,
      { afterStorageStep: (step) => { if (step === "timeline-event") throw new Error("injected nested outbox failure"); } },
    );
    openDatabases.push(database);
    databasePaths.set(database, path);
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, databasePaths.get(database) ?? (() => { throw new Error("missing fixture path"); })());
    database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    const generationBefore = database.getMeta().authorityGeneration;

    database.withAuthorityTransaction((authority) => {
      authority.notifications.create(NOTIFICATION);
      assert.throws(() => database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT)), /injected nested outbox failure/);
    });

    assert.deepEqual(database.authority.notifications.get(UUID_3), NOTIFICATION);
    assert.equal(database.authority.writeIntents.get(UUID_1)?.status, "attempting");
    assert.equal(database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId)?.outcome.state, "attempting");
    assert.deepEqual(database.authority.timelineEvents.page({}).filter((event) => event.payload.kind === "operation-confirmed"), []);
    assert.equal(database.getMeta().authorityGeneration, generationBefore + 1);
  });

  it("leaves generation unchanged for empty, projection-only, idempotent, and rolled-back work", () => {
    const database = openDatabase();
    database.withAuthorityTransaction(() => undefined);
    assert.equal(database.getMeta().authorityGeneration, 0);

    assert.equal("projections" in database,false);
    assert.equal(database.getMeta().authorityGeneration, 0);

    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "inserted");
    assert.equal(database.getMeta().authorityGeneration, 1);
    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "existing");
    assert.equal(database.getMeta().authorityGeneration, 1);

    assert.throws(() => database.withAuthorityTransaction((authority) => {
      authority.notifications.create(NOTIFICATION);
      throw new Error("roll back the authority unit");
    }), /roll back the authority unit/);
    assert.equal(database.getMeta().authorityGeneration, 1);
    assert.equal(database.authority.notifications.get(UUID_3), undefined);
  });

  it("exposes no retired projection or OCR placeholder mutation", () => {
    const database = openDatabase();
    assert.equal("projections" in database, false);
    assert.equal("opaque" in database.authority, false);
    assert.equal(database.getMeta().authorityGeneration, 0);
  });
});
}

{
const { ATOMIC_WRITE_COMMIT, roots, openDatabases, databasePaths, OPERATOR_XLSX_EXPORT, COMMAND_AUDIT, OBSERVED_PRESENT_WRITE_INTENT, databasePath, openDatabase } = createAuthorityAccountingTestWorld();

const OPERATOR_XLSX_EXPORT_ALTERNATE = {
  ...OPERATOR_XLSX_EXPORT,
  exportId: UUID_6,
  requestedBy: LOCAL_OPERATOR_ACTOR_ID,
};

function corruptXlsx(path: string, mutate: (database: DatabaseSync) => void): void {
  const database = new DatabaseSync(path);
  const triggers = ["artifacts_generated_evidence", "artifacts_identity"].map(name => {
    const row = database.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name);
    if (typeof row?.sql !== "string") throw new Error("fixture-generated-artifact-trigger-missing");
    return { name, sql: row.sql };
  });
  try {
    for (const trigger of triggers) database.exec(`DROP TRIGGER ${trigger.name}`);
    database.exec("PRAGMA ignore_check_constraints=ON");
    mutate(database);
  } finally {
    database.exec("PRAGMA ignore_check_constraints=OFF");
    for (const trigger of triggers) database.exec(trigger.sql);
    database.close();
  }
}

describe("authority persistence invariants", () => {
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});


  it.each([
    {
      label: "evidence fingerprint",
      sql: "UPDATE artifacts SET payload_json=json_set(payload_json,'$.exportEvidenceFingerprint',?) WHERE export_id=?",
      values: [HASH_B, UUID_6] as const,
    },
    {
      label: "record JSON actor",
      sql: "UPDATE artifacts SET payload_json=json_set(payload_json,'$.exportEvidenceJson',json_set(json_extract(payload_json,'$.exportEvidenceJson'),'$.requestedBy',?) || '') WHERE export_id=?",
      values: ["other-operator", UUID_6] as const,
    },
  ])("refuses a current XLSX $label mismatch at read and boot", ({ label, sql, values }) => {
    const path = databasePath(`operator-xlsx-${label.replaceAll(" ", "-")}.sqlite`);
    const database = openDatabase(path);
    database.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT_ALTERNATE);
    corruptXlsx(path, corruptor => {
      assert.equal(corruptor.prepare(sql).run(...values).changes, 1);
    });

    assert.throws(
      () => database.authority.operatorXlsxExports.get(UUID_6),
      /generated-artifact|generated export/,
    );
    database.close();
    assert.throws(
      () => openDatabase(path),
      /generated|quick_check|current authority record invariants/,
    );
  });

  it("refuses an XLSX artifact index that disagrees with its strict evidence record", () => {
    const path = databasePath();
    const database = openDatabase(path);
    database.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT);
    corruptXlsx(path, corruptor => {
      assert.equal(corruptor.prepare("UPDATE artifacts SET payload_json=json_set(payload_json,'$.versions[0].artifact.id',?) WHERE export_id=?")
        .run(UUID_6, UUID_7).changes, 1);
    });

    assert.throws(
      () => database.authority.operatorXlsxExports.listByArtifact(UUID_8),
      /generated-artifact|generated export/,
    );
  });

  it("reconciles every mirrored XLSX evidence column during boot inspection", () => {
    const corruptions = [
      { name: "record key", sql: "UPDATE artifacts SET id = ?", value: UUID_6 },
      { name: "selection kind", sql: "UPDATE artifacts SET payload_json=json_set(payload_json,'$.exportEvidenceJson',json_set(json_extract(payload_json,'$.exportEvidenceJson'),'$.selection.kind',?) || '')", value: "activity" },
      { name: "artifact id", sql: "UPDATE artifacts SET payload_json=json_set(payload_json,'$.exportEvidenceJson',json_set(json_extract(payload_json,'$.exportEvidenceJson'),'$.artifact.id',?) || '')", value: UUID_6 },
      { name: "digest", sql: "UPDATE artifacts SET payload_json=json_set(payload_json,'$.exportEvidenceJson',json_set(json_extract(payload_json,'$.exportEvidenceJson'),'$.artifact.sha256',?) || '')", value: HASH_B },
      { name: "byte length", sql: "UPDATE artifacts SET payload_json=json_set(payload_json,'$.exportEvidenceJson',json_set(json_extract(payload_json,'$.exportEvidenceJson'),'$.artifact.bytes',?) || '')", value: 2_048 },
      { name: "media type", sql: "UPDATE artifacts SET payload_json=json_set(payload_json,'$.exportEvidenceJson',json_set(json_extract(payload_json,'$.exportEvidenceJson'),'$.artifact.mediaType',?) || '')", value: "application/pdf" },
      {
        name: "filename",
        sql: "UPDATE artifacts SET payload_json=json_set(payload_json,'$.exportEvidenceJson',json_set(json_extract(payload_json,'$.exportEvidenceJson'),'$.download.filename',?) || '')",
        value: "hr-run-search-2026-07-31-g4.xlsx",
      },
      { name: "created at", sql: "UPDATE artifacts SET payload_json=json_set(payload_json,'$.exportEvidenceJson',json_set(json_extract(payload_json,'$.exportEvidenceJson'),'$.createdAt',?) || '')", value: LATER },
    ] as const;

    for (const corruption of corruptions) {
      const path = databasePath(`${corruption.name.replaceAll(" ", "-")}.sqlite`);
      const database = openDatabase(path);
      database.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT);
      database.close();
      corruptXlsx(path, corruptor => {
        assert.equal(corruptor.prepare(corruption.sql).run(corruption.value).changes, 1);
      });

      assert.throws(
        () => openDatabase(path),
        /generated|quick_check|current authority record invariants/,
        corruption.name,
      );
    }
  });

  it("makes command insertion idempotent but rejects command-id content reuse", () => {
    const database = openDatabase();
    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "inserted");
    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "existing");
    assert.throws(() => database.authority.commands.insert({
      ...(COMMAND_FIXTURES[0] as Record<string, unknown>),
      requestedBy: "different-operator",
    }), /reused with different content/);
    assert.equal(database.getMeta().authorityGeneration, 1);
  });

  it("keeps committed and observed-present idempotency keys permanent", () => {
    const database = openDatabase();
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, databasePaths.get(database) ?? (() => { throw new Error("missing fixture path"); })());
    const generationBefore = database.getMeta().authorityGeneration;
    assert.equal(database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }).state, "fenced");
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
    const committedReplay = {
      intent: { ...WRITE_INTENT_ATTEMPTING, writeIntentId: UUID_8, currentAttemptId: UUID_6 },
      attempt: { ...WRITE_ATTEMPT, writeIntentId: UUID_8, writeAttemptId: UUID_6 },
    };
    assert.equal(database.authority.writeIntents.fenceAttempt(committedReplay).state, "existing");
    assert.equal(database.authority.writeIntents.findByPermanentKey("ucpath", IDEMPOTENCY_KEY)?.writeIntentId, UUID_1);

    assert.equal(database.authority.writeIntents.recordObservedPresent(OBSERVED_PRESENT_WRITE_INTENT).state, "recorded-observed-present");
    const observedReplay = { ...OBSERVED_PRESENT_WRITE_INTENT, writeIntentId: UUID_6 };
    assert.equal(database.authority.writeIntents.recordObservedPresent(observedReplay).state, "existing");
    assert.equal(database.authority.writeIntents.findByPermanentKey("ucpath", OBSERVED_PRESENT_WRITE_INTENT.idempotencyKey)?.writeIntentId, UUID_7);
    assert.equal(database.getMeta().authorityGeneration, generationBefore + 3);
  });

  it("enforces command, delegation, write-attempt, and outbox foreign keys", () => {
    const database = openDatabase();
    assert.throws(() => database.authority.commandAudits.insert(COMMAND_AUDIT), /FOREIGN KEY constraint failed/);
    assert.throws(() => database.authority.dependencies.insert(DEPENDENCY_RECORD), /FOREIGN KEY constraint failed/);
    assert.throws(
      () => database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT)),
      /write intent .* does not exist/,
    );
    assert.equal(database.getMeta().authorityGeneration, 0);
  });

  it("rejects authority mutation inside a projection transaction", () => {
    const database = openDatabase();
    assert.equal("withProjectionTransaction" in database, false);
    assert.equal(database.getMeta().authorityGeneration, 0);
  });
});

describe("run ordinals", () => {
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

  const RUN_ID_2 = "aaaaaaaa-0002-4000-8000-000200000000";
  const RUN_ID_3 = "aaaaaaaa-0003-4000-8000-000300000000";

  function queuedRunAt(
    runId: string,
    overrides: Readonly<{ workflow?: string; itemId?: string; traceId?: string; runNumber?: number }>,
  ): Record<string, unknown> {
    const { runNumber, ...envelopeOverrides } = overrides;
    return {
      ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, runId, ...envelopeOverrides },
      ...(runNumber === undefined ? {} : { runNumber }),
    };
  }

  it("hands out consecutive ordinals per workflow and refuses a spent one", () => {
    const database = openDatabase();
    assert.equal(database.authority.runs.nextWorkflowRunNumber(WORKFLOW_ID), 1);
    if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    database.authority.runs.enqueue(queuedRunAt(RUN_ID, { runNumber: 1 }));
    assert.equal(database.authority.runs.nextWorkflowRunNumber(WORKFLOW_ID), 2);
    if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    database.authority.runs.enqueue(queuedRunAt(RUN_ID_2, {
      itemId: UUID_6, traceId: "pl-170002-0002", runNumber: 2,
    }));
    assert.equal(database.authority.runs.get(RUN_ID)?.runNumber, 1);
    assert.equal(database.authority.runs.get(RUN_ID_2)?.runNumber, 2);

    // A stale reader that re-uses #2 is refused by NAME, not by an index error.
    assert.throws(
      () => database.authority.runs.enqueue(queuedRunAt(RUN_ID_3, {
        itemId: UUID_8, traceId: "pl-170003-0003", runNumber: 2,
      })),
      /already spent \(its next unspent number is #3\)/,
    );
    // …and nothing landed, so the counter did not move either.
    assert.equal(database.authority.runs.get(RUN_ID_3), undefined);
    assert.equal(database.authority.runs.nextWorkflowRunNumber(WORKFLOW_ID), 3);
  });

  it("counts each workflow separately and tolerates a gap", () => {
    const database = openDatabase();
    if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    database.authority.runs.enqueue(queuedRunAt(RUN_ID, { runNumber: 1 }));
    // A different workflow starts at 1 again — the ordinal names a run WITHIN
    // one workflow's history, and a global sequence would make `#1` unreadable.
    assert.equal(database.authority.runs.nextWorkflowRunNumber("separations"), 1);
    // A gap is legal: a refused fan-out entry leaves nothing behind, and the
    // numbers around the gap still name the runs they always named.
    if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    database.authority.runs.enqueue(queuedRunAt(RUN_ID_2, {
      itemId: UUID_6, traceId: "pl-170002-0002", runNumber: 7,
    }));
    assert.equal(database.authority.runs.nextWorkflowRunNumber(WORKFLOW_ID), 8);
  });
});

describe("workflow batch presentation persistence", () => {
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

  it("persists genuine grouping, fences presentation edits and preserves batch identity across reopen", () => {
    const path = databasePath("workflow-batches.sqlite");
    const db = openDatabase(path);
    db.authority.runSessions.insert(RUN_SESSION);
    const migrated = db.authority.runSessions.get(RUN_SESSION.sessionId);
    assert.equal(migrated?.groupInQueue, false);
    assert.equal(migrated?.version, 1);
    assert.equal(migrated?.sessionId, RUN_SESSION.sessionId);
    const before = db.getMeta().authorityGeneration;
    db.authority.runSessions.setGrouping(RUN_SESSION.sessionId, 1, true);
    assert.equal(db.getMeta().authorityGeneration, before + 1);
    assert.throws(() => db.authority.runSessions.setGrouping(RUN_SESSION.sessionId, 1, false), /version conflict/u);
    assert.throws(() => db.authority.runSessions.setGrouping(UUID_4, 1, false), /does not exist/u);
    db.close();
    const reopened = openDatabase(path);
    assert.equal(reopened.authority.runSessions.get(RUN_SESSION.sessionId)?.groupInQueue, true);
    assert.equal(reopened.authority.runSessions.get(RUN_SESSION.sessionId)?.version, 2);
    const sql = new DatabaseSync(path);
    assert.equal(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks','run_sessions')").get(), undefined);
    assert.deepEqual(sql.prepare("PRAGMA foreign_key_check").all(), []);
    assert.throws(() => sql.exec("UPDATE run_batches SET workflow='other'"), /run-batches-presentation/u);
    assert.throws(() => sql.exec("UPDATE run_batches SET group_in_queue=0"), /run-batches-presentation/u);
    sql.close();
  });
});
}
