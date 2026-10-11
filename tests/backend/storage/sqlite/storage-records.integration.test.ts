import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { mkdtempSync as mkdtempSync_m1,realpathSync as realpathSync_m1,rmSync as rmSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m1 } from "node:path";
import { DatabaseSync as DatabaseSync_m1 } from "node:sqlite";
import { afterEach as afterEach_m1,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN as QUEUED_RUN_m1 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { cleanReceiptOf as cleanReceiptOf_m0,uuidOf as uuidOf_m0 } from "../../../support/helpers/backend/dashboard-harness.js";
import { failure as failure_m0,foundationFixture as foundationFixture_m0,terminalizeFixtureFailure as terminalizeFixtureFailure_m0 } from "../../../support/helpers/database-foundation/fixtures.js";
import { AuthorityDatabase as AuthorityDatabase_m1 } from "../../../support/helpers/synthetic-storage-admission.js";


{


function insertReceipt(f: ReturnType<typeof foundationFixture_m0>, seed: number) {
  const run = f.createRun(uuidOf_m0(seed));
  const failed = {
    ...failure_m0(),
    failureId: uuidOf_m0(seed + 9000),
    runId: run.envelope.runId,
    traceId: run.envelope.traceId,
    workflowId: run.envelope.workflow,
    attempt: run.envelope.attempt,
  };
  assert_m0.equal(terminalizeFixtureFailure_m0(f, run, failed).state, "applied");
  return f.db.authority.evidenceReceipts.insert({
    ...cleanReceiptOf_m0({ seed, workflow: run.envelope.workflow }),
    traceId: run.envelope.traceId,
    descriptorFingerprint: run.envelope.contractFingerprint,
    configFingerprint: run.envelope.configFingerprint,
    result: "failed",
    confidence: "partial",
    failure: { state: "present", value: failed.failureId },
  });
}

describe_m0("evidence receipt repository", () => {
  it_m0("filters multiple real SQLite receipt rows by exact run with stable cardinality", () => {
    const f = foundationFixture_m0();
    try {
      const seeds = [503, 501, 502] as const;
      const inserted = seeds.map(seed => insertReceipt(f, seed));
      const reads = seeds.map(seed => f.db.authority.evidenceReceipts.listByRun(uuidOf_m0(seed)));

      assert_m0.deepEqual(reads.map((receipts) => receipts.length), [1, 1, 1]);
      assert_m0.deepEqual(
        reads.map(([receipt]) => receipt?.receiptId),
        inserted.map(receipt => receipt.record.receiptId),
      );
    } finally {
      f.dispose();
    }
  });

  it_m0("returns no receipt for a well-formed absent run in populated SQLite authority", () => {
    const f = foundationFixture_m0();
    try {
      insertReceipt(f, 504);
      const receipts = f.db.authority.evidenceReceipts.listByRun(uuidOf_m0(505));

      assert_m0.deepEqual(receipts, []);
    } finally {
      f.dispose();
    }
  });

  it_m0("refuses a list read whose run id is not exact", () => {
    const f = foundationFixture_m0();
    try {
      assert_m0.throws(
        () => f.db.authority.evidenceReceipts.listByRun("not-a-run-id"),
        /run id must be a UUID/,
      );
    } finally {
      f.dispose();
    }
  });
});
}

{


const NOW = "2026-08-25T12:00:00.000Z";
const HASH = "a".repeat(64);
const roots: string[] = [];
const STARTED_MET_RESULT = {
  resultId: "11111111-1111-4111-8111-111111111111",
  scenarioId: "separations-kuali-finalization/dry-run",
  workflow: "separations-kuali-finalization",
  subjectLabel: "finalization-canary",
  manifestDigest: HASH,
  verdict: "met",
  assertions: [
    { assertionId: "nodes-reached", verdict: "met", reason: "reached-declared-nodes" },
    { assertionId: "write-deltas-zero", verdict: "met", reason: "write-deltas-unchanged" },
  ],
  wallTimeMs: 12_345,
  recordedAt: NOW,
  execution: {
    state: "started",
    runId: "22222222-2222-4222-8222-222222222222",
    traceId: "sep-120000-2222",
  },
};

const NOT_STARTED_BLOCKED_RESULT = {
  ...STARTED_MET_RESULT,
  resultId: "44444444-4444-4444-8444-444444444444",
  verdict: "blocked",
  assertions: [
    { assertionId: "subject-available", verdict: "blocked", reason: "subject-unavailable" },
  ],
  wallTimeMs: 0,
  execution: { state: "not-started", reason: "subject-unavailable" },
};

function databasePath(): string {
  const root = mkdtempSync_m1(join_m1(realpathSync_m1(tmpdir_m1()), "hrauto-dry-run-result-"));
  roots.push(root);
  return join_m1(root, "authority.sqlite");
}

function openDatabase(path = databasePath()): AuthorityDatabase_m1 {
  const database = AuthorityDatabase_m1.open(
    { path, busyTimeoutMs: 250, migrationOwner: "dry-run-result-test" },
    manualClock_m1(new Date(NOW)),
  );
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m1);
  return database;
}

const _afterEachFixture0 = () => {
  for (const root of roots.splice(0)) rmSync_m1(root, { recursive: true, force: true });
};

describe_m1("dry-run scenario result authority repository", () => {
afterEach_m1(_afterEachFixture0);


  it_m1("rejects a started result whose trace does not identify its dry-run record", () => {
    const database = openDatabase();
    database.authority.runs.enqueue({
      ...QUEUED_RUN_m1,
      envelope: { ...QUEUED_RUN_m1.envelope, dryRun: true },
    });

    assert_m1.throws(
      () => database.authority.dryRunScenarioResults.insert({
        ...STARTED_MET_RESULT,
        scenarioId: "person-lookup/dry-run",
        workflow: QUEUED_RUN_m1.envelope.workflow,
        execution: {
          state: "started",
          runId: QUEUED_RUN_m1.envelope.runId,
          traceId: "pl-170000-9999",
        },
      }),
      /does not match its dry-run execution/,
    );
    assert_m1.deepEqual(database.authority.dryRunScenarioResults.list(), []);
    database.close();
  });

  it_m1("treats exact replay as idempotent and rejects identity reuse with different content", () => {
    const database = openDatabase();
    const inserted = database.authority.dryRunScenarioResults.insert(NOT_STARTED_BLOCKED_RESULT);
    const generationAfterInsert = database.getMeta().authorityGeneration;

    const replayed = database.authority.dryRunScenarioResults.insert(NOT_STARTED_BLOCKED_RESULT);

    assert_m1.equal(inserted.state, "inserted");
    assert_m1.equal(replayed.state, "existing");
    assert_m1.equal(database.getMeta().authorityGeneration, generationAfterInsert);
    assert_m1.throws(
      () => database.authority.dryRunScenarioResults.insert({
        ...NOT_STARTED_BLOCKED_RESULT,
        wallTimeMs: 1,
      }),
      /already exists with different content/,
    );
    assert_m1.equal(database.getMeta().authorityGeneration, generationAfterInsert);
    database.close();
  });

  it_m1("rejects resolved subject values before any payload_json is written", () => {
    const path = databasePath();
    const database = openDatabase(path);

    assert_m1.throws(() => database.authority.dryRunScenarioResults.insert({
      ...NOT_STARTED_BLOCKED_RESULT,
      subjectValue: "10873698",
      assertions: [{
        ...NOT_STARTED_BLOCKED_RESULT.assertions[0],
        detail: "resolved EID 10873698",
      }],
    }));
    const raw = new DatabaseSync_m1(path, { readOnly: true });
    const row = raw.prepare(`
      SELECT count(*) AS count FROM dryrun_results
      WHERE instr(payload_json, '10873698') > 0
    `).get();
    assert_m1.equal(row?.count, 0);
    raw.close();
    database.close();
  });

  it_m1("refuses raw SQL updates to recorded evidence", () => {
    const path = databasePath();
    const database = openDatabase(path);
    database.authority.dryRunScenarioResults.insert(NOT_STARTED_BLOCKED_RESULT);
    database.close();
    const raw = new DatabaseSync_m1(path);

    assert_m1.throws(
      () => raw.prepare("UPDATE dryrun_results SET subject_label = ? WHERE id = ?")
        .run("rewritten-canary", NOT_STARTED_BLOCKED_RESULT.resultId),
      /retained-evidence-immutable/u,
    );
    raw.close();
  });

  it_m1("refuses raw SQL deletion of recorded evidence", () => {
    const path = databasePath();
    const database = openDatabase(path);
    database.authority.dryRunScenarioResults.insert(NOT_STARTED_BLOCKED_RESULT);
    database.close();
    const raw = new DatabaseSync_m1(path);

    assert_m1.throws(
      () => raw.prepare("DELETE FROM dryrun_results WHERE id = ?")
        .run(NOT_STARTED_BLOCKED_RESULT.resultId),
      /owner-deletion-required/u,
    );
    raw.close();
  });

  it_m1("fails boot when a raw insert contains a record that violates the strict boundary", () => {
    const path = databasePath();
    const database = openDatabase(path);
    database.close();
    const raw = new DatabaseSync_m1(path);
    const corrupted = {
      ...NOT_STARTED_BLOCKED_RESULT,
      resultId: "66666666-6666-4666-8666-666666666666",
      subjectLabel: "10873698",
    };
    raw.prepare(`
      INSERT INTO dryrun_results
        (id, scenario_id, workflow, subject_label, manifest_digest, verdict,
         execution_state, run_id, trace_id, wall_time_ms, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      corrupted.resultId, corrupted.scenarioId, corrupted.workflow, corrupted.subjectLabel,
      corrupted.manifestDigest, corrupted.verdict, corrupted.execution.state, null, null,
      corrupted.wallTimeMs, JSON.stringify(corrupted), corrupted.recordedAt,
    );
    raw.close();

    assert_m1.throws(
      () => openDatabase(path),
      /authority table dryrun_results failed native record validation/,
    );
  });
});
}
