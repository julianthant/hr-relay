import { createAuthorityAccountingTestWorld } from "../../../support/helpers/backend/authority-accounting-world.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { deriveRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { admitDirectWorker, admitWorkerPoolRoster } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { type AuthorityTableName } from "../../../../src/models/config/authority.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { projectNotificationTrigger } from "../../../../src/rules/notifications/notification-triggers.js";
import { explorerAuthorityFixture } from "../../../support/fixtures/explorer-authority.js";
import { COMMAND_FIXTURES, CONFIG_SNAPSHOT, DELEGATION_MANIFEST, DEPENDENCY_RECORD, GATE_RESULT, HASH_A, HASH_B, LATER, NOTIFICATION, NOW, UUID_1, UUID_2, UUID_5, UUID_7, UUID_8, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, RUN_SESSION, START_PLAN, WORKER_START_REQUEST, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { atomicWriteCheckpoint, seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";

const { ATOMIC_WRITE_COMMIT, roots, openDatabases, databasePaths, CLOCK, BULK_COMMAND_ACCEPTANCE, OPERATOR_XLSX_EXPORT, FAILURE_RECORD, DIAGNOSTIC_BUNDLE, RUN_CHECKPOINT, COMMAND_AUDIT, OBSERVED_PRESENT_WRITE_INTENT, databasePath, openDatabase, claimedWorkerId, prepareWorkerSlot, prepareRunning, prepareDelegationOwners, terminalizeForTrust, terminalFailureRequest, terminalSuccessRequest, INTAKE_MANIFEST, OCR_EXTRACTION, DRY_RUN_SCENARIO_RESULT } = createAuthorityAccountingTestWorld();


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
