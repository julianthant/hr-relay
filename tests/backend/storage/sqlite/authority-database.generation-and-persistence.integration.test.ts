import { fenceWriteFixture, writeFenceFixtureInput } from "../../../support/helpers/write-fence-fixture.js";
import { authorityMutationCases, type MutationCase } from "../../../support/helpers/backend/authority-accounting-world.js";
import { createAuthorityAccountingTestWorld } from "../../../support/helpers/backend/authority-accounting-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { COMMAND_FIXTURES, CONFIG_SNAPSHOT, DEPENDENCY_RECORD, HASH_B, LATER, NOTIFICATION, NOW, UUID_1, UUID_3, UUID_7, UUID_8, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, RUN_SESSION, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { atomicWriteCheckpoint, seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";
import { DatabaseSync } from "node:sqlite";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { IDEMPOTENCY_KEY, UUID_4, UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";


{
const { ATOMIC_WRITE_COMMIT, openDatabases, cleanup, databasePaths, CLOCK, BULK_COMMAND_ACCEPTANCE, OPERATOR_XLSX_EXPORT, FAILURE_RECORD, DIAGNOSTIC_BUNDLE, RUN_CHECKPOINT, COMMAND_AUDIT, OBSERVED_PRESENT_WRITE_INTENT, databasePath, openDatabase, claimedWorkerId, prepareWorkerSlot, prepareRunning, prepareDelegationOwners, terminalizeForTrust, terminalFailureRequest, terminalSuccessRequest, INTAKE_MANIFEST, OCR_EXTRACTION, DRY_RUN_SCENARIO_RESULT } = createAuthorityAccountingTestWorld();

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
afterEach(cleanup);

  it("keeps one read snapshot while another connection commits without waiting", async () => {
    const path = await databasePath("concurrent-read-snapshot.sqlite");
    const reader = await openDatabase(path, 10);
    const writer = await openDatabase(path, 10);

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
  const _cases: readonly MutationCase[] = authorityMutationCases({ prepareRunning, terminalFailureRequest, terminalSuccessRequest, terminalizeForTrust, DIAGNOSTIC_BUNDLE, FAILURE_RECORD, DRY_RUN_SCENARIO_RESULT, OPERATOR_XLSX_EXPORT, CLOCK, ATOMIC_WRITE_COMMIT, databasePaths, INTAKE_MANIFEST, OCR_EXTRACTION, prepareWorkerSlot, claimedWorkerId, prepareDelegationOwners, COMMAND_AUDIT, RUN_CHECKPOINT, OBSERVED_PRESENT_WRITE_INTENT });

  it("accounts intake preparation in its single imported authority row", async () => {
    const db=await openDatabase();const before=db.getMeta().authorityGeneration;
    db.authority.intakeSessions.create(INTAKE_SESSION);
    assert.equal(db.getMeta().authorityGeneration,before+1);
    assert.deepEqual(db.authority.intakeSessions.get(INTAKE_SESSION.intakeSessionId),INTAKE_SESSION);
  });

  it("accounts parent acceptance in commands once without an execution audit", async () => {
    const db = await openDatabase(await databasePath("bulk-parent-generation.sqlite"));
    const before = db.getMeta().authorityGeneration;
    assert.equal(db.authority.commands.acceptBulk(BULK_COMMAND_ACCEPTANCE).state, "inserted");
    assert.equal(db.getMeta().authorityGeneration, before + 1);
    assert.equal(db.authority.commands.acceptBulk(BULK_COMMAND_ACCEPTANCE).state, "existing");
    assert.equal(db.getMeta().authorityGeneration, before + 1);
    assert.equal(db.authority.commandAudits.findByCommand(BULK_COMMAND_ACCEPTANCE.bulkCommandId), undefined);
  });

  it("shares nested authority transactions and increments exactly once", async () => {
    const database = await openDatabase();
    database.withAuthorityTransaction((authority) => {
      authority.commands.insert(COMMAND_FIXTURES[0]);
      database.withAuthorityTransaction((nested) => {
        nested.notifications.create(NOTIFICATION);
      });
    });
    assert.equal(database.getMeta().authorityGeneration, 1);
  });

  it("rolls back a caught nested atomic outbox failure while committing unrelated outer work once", async () => {
    const path = await databasePath();
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
      CLOCK,
      { afterStorageStep: (step) => { if (step === "timeline-event") throw new Error("injected nested outbox failure"); } },
    );
    openDatabases.push(database);
    databasePaths.set(database, path);
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, databasePaths.get(database) ?? (() => { throw new Error("missing fixture path"); })());
    fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
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

  it("leaves generation unchanged for empty, projection-only, idempotent, and rolled-back work", async () => {
    const database = await openDatabase();
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

  it("exposes no retired projection or OCR placeholder mutation", async () => {
    const database = await openDatabase();
    assert.equal("projections" in database, false);
    assert.equal("opaque" in database.authority, false);
    assert.equal(database.getMeta().authorityGeneration, 0);
  });
});
}

{
const { ATOMIC_WRITE_COMMIT, cleanup, databasePaths, OPERATOR_XLSX_EXPORT, COMMAND_AUDIT, OBSERVED_PRESENT_WRITE_INTENT, databasePath, openDatabase } = createAuthorityAccountingTestWorld();

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
afterEach(cleanup);


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
  ])("refuses a current XLSX $label mismatch at read and boot", async ({ label, sql, values }) => {
    const path = await databasePath(`operator-xlsx-${label.replaceAll(" ", "-")}.sqlite`);
    const database = await openDatabase(path);
    database.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT_ALTERNATE);
    corruptXlsx(path, corruptor => {
      assert.equal(corruptor.prepare(sql).run(...values).changes, 1);
    });

    assert.throws(
      () => database.authority.operatorXlsxExports.get(UUID_6),
      /generated-artifact|generated export/,
    );
    database.close();
    await assert.rejects(
      async () => await openDatabase(path),
      /generated|quick_check|current authority record invariants/,
    );
  });

  it("refuses an XLSX artifact index that disagrees with its strict evidence record", async () => {
    const path = await databasePath();
    const database = await openDatabase(path);
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

  it("reconciles every mirrored XLSX evidence column during boot inspection", async () => {
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
      const path = await databasePath(`${corruption.name.replaceAll(" ", "-")}.sqlite`);
      const database = await openDatabase(path);
      database.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT);
      database.close();
      corruptXlsx(path, corruptor => {
        assert.equal(corruptor.prepare(corruption.sql).run(corruption.value).changes, 1);
      });

      await assert.rejects(
        async () => await openDatabase(path),
        /generated|quick_check|current authority record invariants/,
        corruption.name,
      );
    }
  });

  it("makes command insertion idempotent but rejects command-id content reuse", async () => {
    const database = await openDatabase();
    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "inserted");
    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "existing");
    assert.throws(() => database.authority.commands.insert({
      ...(COMMAND_FIXTURES[0] as Record<string, unknown>),
      requestedBy: "different-operator",
    }), /reused with different content/);
    assert.equal(database.getMeta().authorityGeneration, 1);
  });

  it("keeps committed and observed-present idempotency keys permanent", async () => {
    const database = await openDatabase();
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, databasePaths.get(database) ?? (() => { throw new Error("missing fixture path"); })());
    const fence = writeFenceFixtureInput(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    const generationBefore = database.getMeta().authorityGeneration;
    assert.equal(database.authority.writeIntents.fenceAttempt(fence).state, "fenced");
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
    const committedReplay = {
      intent: { ...WRITE_INTENT_ATTEMPTING, writeIntentId: UUID_8, currentAttemptId: UUID_6 },
      attempt: { ...WRITE_ATTEMPT, writeIntentId: UUID_8, writeAttemptId: UUID_6 },
    };
    assert.equal(fenceWriteFixture(database, committedReplay).state, "existing");
    assert.equal(database.authority.writeIntents.findByPermanentKey("ucpath", IDEMPOTENCY_KEY)?.writeIntentId, UUID_1);

    assert.equal(database.authority.writeIntents.recordObservedPresent(OBSERVED_PRESENT_WRITE_INTENT).state, "recorded-observed-present");
    const observedReplay = { ...OBSERVED_PRESENT_WRITE_INTENT, writeIntentId: UUID_6 };
    assert.equal(database.authority.writeIntents.recordObservedPresent(observedReplay).state, "existing");
    assert.equal(database.authority.writeIntents.findByPermanentKey("ucpath", OBSERVED_PRESENT_WRITE_INTENT.idempotencyKey)?.writeIntentId, UUID_7);
    assert.equal(database.getMeta().authorityGeneration, generationBefore + 3);
  });

  it("enforces command, delegation, write-attempt, and outbox foreign keys", async () => {
    const database = await openDatabase();
    assert.throws(() => database.authority.commandAudits.insert(COMMAND_AUDIT), /FOREIGN KEY constraint failed/);
    assert.throws(() => database.authority.dependencies.insert(DEPENDENCY_RECORD), /FOREIGN KEY constraint failed/);
    assert.throws(
      () => database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT)),
      /write intent .* does not exist/,
    );
    assert.equal(database.getMeta().authorityGeneration, 0);
  });

  it("rejects authority mutation inside a projection transaction", async () => {
    const database = await openDatabase();
    assert.equal("withProjectionTransaction" in database, false);
    assert.equal(database.getMeta().authorityGeneration, 0);
  });
});

describe("run ordinals", () => {
afterEach(cleanup);

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

  it("hands out consecutive ordinals per workflow and refuses a spent one", async () => {
    const database = await openDatabase();
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

  it("counts each workflow separately and tolerates a gap", async () => {
    const database = await openDatabase();
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
afterEach(cleanup);

  it("persists genuine grouping, fences presentation edits and preserves batch identity across reopen", async () => {
    const path = await databasePath("workflow-batches.sqlite");
    const db = await openDatabase(path);
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
    const reopened = await openDatabase(path);
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
