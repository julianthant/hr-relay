import { dryRunScenarioResultRecords } from "../../../support/helpers/dry-run-scenario-fixtures.js";
import { default as assert } from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { cleanReceiptOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { failure as failure_m0, foundationFixture, terminalizeFixtureFailure } from "../../../support/helpers/database-foundation/fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

{

function insertReceipt(f: Awaited<ReturnType<typeof foundationFixture>>, seed: number) {
  const run = f.createRun(uuidOf(seed));
  const failed = {
    ...failure_m0(),
    failureId: uuidOf(seed + 9000),
    runId: run.envelope.runId,
    traceId: run.envelope.traceId,
    workflowId: run.envelope.workflow,
    attempt: run.envelope.attempt,
  };
  assert.equal(terminalizeFixtureFailure(f, run, failed).state, "applied");
  return f.db.authority.evidenceReceipts.insert({
    ...cleanReceiptOf({ seed, workflow: run.envelope.workflow }),
    traceId: run.envelope.traceId,
    descriptorFingerprint: run.envelope.contractFingerprint,
    configFingerprint: run.envelope.configFingerprint,
    result: "failed",
    confidence: "partial",
    failure: { state: "present", value: failed.failureId },
  });
}

describe("evidence receipt repository", () => {
  it("filters multiple real SQLite receipt rows by exact run with stable cardinality", async () => {
    const f = await foundationFixture();
    try {
      const seeds = [503, 501, 502] as const;
      const inserted = seeds.map(seed => insertReceipt(f, seed));
      const reads = seeds.map(seed => f.db.authority.evidenceReceipts.listByRun(uuidOf(seed)));

      assert.deepEqual(reads.map((receipts) => receipts.length), [1, 1, 1]);
      assert.deepEqual(
        reads.map(([receipt]) => receipt?.receiptId),
        inserted.map(receipt => receipt.record.receiptId),
      );
    } finally {
      await f.dispose();
    }
  });

  it("returns no receipt for a well-formed absent run in populated SQLite authority", async () => {
    const f = await foundationFixture();
    try {
      insertReceipt(f, 504);
      const receipts = f.db.authority.evidenceReceipts.listByRun(uuidOf(505));

      assert.deepEqual(receipts, []);
    } finally {
      await f.dispose();
    }
  });

  it("refuses a list read whose run id is not exact", async () => {
    const f = await foundationFixture();
    try {
      assert.throws(
        () => f.db.authority.evidenceReceipts.listByRun("not-a-run-id"),
        /run id must be a UUID/,
      );
    } finally {
      await f.dispose();
    }
  });
});
}

{

const NOW = "2026-08-25T12:00:00.000Z";
const HASH = "a".repeat(64);
const roots: string[] = [];
const { STARTED_MET_RESULT, NOT_STARTED_BLOCKED_RESULT } = dryRunScenarioResultRecords(HASH, NOW);



function databasePath(): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-dry-run-result-"));
  roots.push(root);
  return join(root, "authority.sqlite");
}

function openDatabase(path = databasePath()): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "dry-run-result-test" },
    manualClock(new Date(NOW)),
  );
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  return database;
}

const _afterEachFixture0 = () => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

describe("dry-run scenario result authority repository", () => {
afterEach(_afterEachFixture0);

  it("rejects a started result whose trace does not identify its dry-run record", () => {
    const database = openDatabase();
    database.authority.runs.enqueue({
      ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, dryRun: true },
    });

    assert.throws(
      () => database.authority.dryRunScenarioResults.insert({
        ...STARTED_MET_RESULT,
        scenarioId: "person-lookup/dry-run",
        workflow: QUEUED_RUN.envelope.workflow,
        execution: {
          state: "started",
          runId: QUEUED_RUN.envelope.runId,
          traceId: "pl-170000-9999",
        },
      }),
      /does not match its dry-run execution/,
    );
    assert.deepEqual(database.authority.dryRunScenarioResults.list(), []);
    database.close();
  });

  it("treats exact replay as idempotent and rejects identity reuse with different content", () => {
    const database = openDatabase();
    const inserted = database.authority.dryRunScenarioResults.insert(NOT_STARTED_BLOCKED_RESULT);
    const generationAfterInsert = database.getMeta().authorityGeneration;

    const replayed = database.authority.dryRunScenarioResults.insert(NOT_STARTED_BLOCKED_RESULT);

    assert.equal(inserted.state, "inserted");
    assert.equal(replayed.state, "existing");
    assert.equal(database.getMeta().authorityGeneration, generationAfterInsert);
    assert.throws(
      () => database.authority.dryRunScenarioResults.insert({
        ...NOT_STARTED_BLOCKED_RESULT,
        wallTimeMs: 1,
      }),
      /already exists with different content/,
    );
    assert.equal(database.getMeta().authorityGeneration, generationAfterInsert);
    database.close();
  });

  it("rejects resolved subject values before any payload_json is written", () => {
    const path = databasePath();
    const database = openDatabase(path);

    assert.throws(() => database.authority.dryRunScenarioResults.insert({
      ...NOT_STARTED_BLOCKED_RESULT,
      subjectValue: "10873698",
      assertions: [{
        ...NOT_STARTED_BLOCKED_RESULT.assertions[0],
        detail: "resolved EID 10873698",
      }],
    }));
    const raw = new DatabaseSync(path, { readOnly: true });
    const row = raw.prepare(`
      SELECT count(*) AS count FROM dryrun_results
      WHERE instr(payload_json, '10873698') > 0
    `).get();
    assert.equal(row?.count, 0);
    raw.close();
    database.close();
  });

  it("refuses raw SQL updates to recorded evidence", () => {
    const path = databasePath();
    const database = openDatabase(path);
    database.authority.dryRunScenarioResults.insert(NOT_STARTED_BLOCKED_RESULT);
    database.close();
    const raw = new DatabaseSync(path);

    assert.throws(
      () => raw.prepare("UPDATE dryrun_results SET subject_label = ? WHERE id = ?")
        .run("rewritten-canary", NOT_STARTED_BLOCKED_RESULT.resultId),
      /retained-evidence-immutable/u,
    );
    raw.close();
  });

  it("refuses raw SQL deletion of recorded evidence", () => {
    const path = databasePath();
    const database = openDatabase(path);
    database.authority.dryRunScenarioResults.insert(NOT_STARTED_BLOCKED_RESULT);
    database.close();
    const raw = new DatabaseSync(path);

    assert.throws(
      () => raw.prepare("DELETE FROM dryrun_results WHERE id = ?")
        .run(NOT_STARTED_BLOCKED_RESULT.resultId),
      /owner-deletion-required/u,
    );
    raw.close();
  });

  it("fails boot when a raw insert contains a record that violates the strict boundary", () => {
    const path = databasePath();
    const database = openDatabase(path);
    database.close();
    const raw = new DatabaseSync(path);
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

    assert.throws(
      () => openDatabase(path),
      /authority table dryrun_results failed native record validation/,
    );
  });
});
}
