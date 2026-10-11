import assert from "node:assert/strict";

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";

import { OPERATOR_XLSX_MEDIA_TYPE } from "../../../../src/models/dashboard/xlsx-export.js";

import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";

import { manualClock } from "../../../../src/rules/time/clock.js";
import { deriveIdempotencyKeyDigest } from "../../../../src/rules/write-safety/write-safety.js";

import { COMMAND_FIXTURES, CONFIG_SNAPSHOT, DEPENDENCY_RECORD, HASH_A, HASH_B, HASH_C, ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT, IDEMPOTENCY_KEY, LATER, NOW, UUID_1, UUID_2, UUID_3, UUID_4, UUID_5, UUID_6, UUID_7, UUID_8, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, RUN_SESSION, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";

import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { atomicWriteCheckpoint, currentAtomicWriteFixture, seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";

const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_ATOMIC_WRITE_COMMIT);

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const databasePaths = new WeakMap<AuthorityDatabase, string>();
const CLOCK = manualClock(new Date(NOW));

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
const OPERATOR_XLSX_EXPORT_ALTERNATE = {
  ...OPERATOR_XLSX_EXPORT,
  exportId: UUID_6,
  requestedBy: LOCAL_OPERATOR_ACTOR_ID,
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

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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
