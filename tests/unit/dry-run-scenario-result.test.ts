import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { AUTHORITY_TABLE_REGISTRY } from "../../src/domain/authority.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { manualClock } from "../../src/domain/clock.js";
import { DryRunScenarioResultSchema } from "../../src/domain/trust/dry-run-scenario-result.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { AUTHORITY_RECORD_SCHEMA_REGISTRY } from "../../src/infra/sqlite/storage-records.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";

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
  const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-result-"));
  roots.push(root);
  return join(root, "authority.sqlite");
}

function openDatabase(path = databasePath()): AuthorityDatabase {
  return AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "dry-run-result-test" },
    manualClock(new Date(NOW)),
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("durable dry-run scenario results", () => {
  it("accepts a started scenario that met its ordered assertions", () => {
    const result = DryRunScenarioResultSchema.parse(STARTED_MET_RESULT);

    assert.equal(result.execution.state, "started");
    assert.deepEqual(result.assertions.map(({ assertionId }) => assertionId), [
      "nodes-reached",
      "write-deltas-zero",
    ]);
  });

  it("accepts a started scenario whose assertion failed", () => {
    const result = DryRunScenarioResultSchema.parse({
      ...STARTED_MET_RESULT,
      resultId: "33333333-3333-4333-8333-333333333333",
      verdict: "failed",
      assertions: [
        { assertionId: "nodes-reached", verdict: "failed", reason: "stopped-before-finalize-kuali" },
      ],
    });

    assert.equal(result.verdict, "failed");
  });

  it("records a missing subject as not-started blocked without run or trace ids", () => {
    const result = DryRunScenarioResultSchema.parse(NOT_STARTED_BLOCKED_RESULT);

    assert.deepEqual(result.execution, { state: "not-started", reason: "subject-unavailable" });
  });

  it("rejects duplicate assertion identities in the ordered outcome ledger", () => {
    assert.equal(DryRunScenarioResultSchema.safeParse({
      ...STARTED_MET_RESULT,
      assertions: [STARTED_MET_RESULT.assertions[0], STARTED_MET_RESULT.assertions[0]],
    }).success, false);
  });

  it("rejects a met verdict when any assertion did not meet", () => {
    assert.equal(DryRunScenarioResultSchema.safeParse({
      ...STARTED_MET_RESULT,
      assertions: [
        { assertionId: "nodes-reached", verdict: "failed", reason: "stopped-before-finalize-kuali" },
      ],
    }).success, false);
  });

  it("rejects subject values and leaky or open fields at every result boundary", () => {
    const leaky = [
      { ...STARTED_MET_RESULT, subjectLabel: "10873698" },
      { ...STARTED_MET_RESULT, subjectValue: "10873698" },
      {
        ...STARTED_MET_RESULT,
        assertions: [{ ...STARTED_MET_RESULT.assertions[0], resolvedValue: "10873698" }],
      },
      {
        ...STARTED_MET_RESULT,
        assertions: [{ ...STARTED_MET_RESULT.assertions[0], detail: "resolved EID 10873698" }],
      },
      {
        ...STARTED_MET_RESULT,
        assertions: [{ ...STARTED_MET_RESULT.assertions[0], reason: "10873698" }],
      },
      { ...STARTED_MET_RESULT, execution: { ...STARTED_MET_RESULT.execution, subjectValue: "10873698" } },
    ];

    for (const candidate of leaky) {
      assert.equal(DryRunScenarioResultSchema.safeParse(candidate).success, false);
    }
  });

  it("rejects a not-started result with any verdict except blocked", () => {
    assert.equal(DryRunScenarioResultSchema.safeParse({
      ...STARTED_MET_RESULT,
      execution: { state: "not-started", reason: "subject-unavailable" },
    }).success, false);
  });

  it("accepts only a structured reason code for an assertion outcome", () => {
    const result = DryRunScenarioResultSchema.parse({
      ...STARTED_MET_RESULT,
      assertions: [
        { assertionId: "nodes-reached", verdict: "met", reason: "reached-declared-nodes" },
      ],
    });

    assert.equal(result.assertions[0]?.reason, "reached-declared-nodes");
  });
});

describe("dry-run scenario result authority repository", () => {
  it("registers the table and its boot-time record schema", () => {
    assert.equal(
      AUTHORITY_TABLE_REGISTRY.find(({ name }) => name === "dryrun_results")?.classification,
      "authority",
    );
    assert.equal(AUTHORITY_RECORD_SCHEMA_REGISTRY.dryrun_results, DryRunScenarioResultSchema);
  });

  it("inserts, reads, and lists durable results in recorded order", () => {
    const database = openDatabase();
    const later = {
      ...NOT_STARTED_BLOCKED_RESULT,
      resultId: "55555555-5555-4555-8555-555555555555",
      subjectLabel: "second-canary",
      recordedAt: "2026-08-25T12:01:00.000Z",
    };

    const inserted = database.authority.dryRunScenarioResults.insert(NOT_STARTED_BLOCKED_RESULT);
    database.authority.dryRunScenarioResults.insert(later);

    assert.equal(inserted.state, "inserted");
    assert.deepEqual(
      database.authority.dryRunScenarioResults.get(NOT_STARTED_BLOCKED_RESULT.resultId),
      DryRunScenarioResultSchema.parse(NOT_STARTED_BLOCKED_RESULT),
    );
    assert.deepEqual(
      database.authority.dryRunScenarioResults.list().map(({ resultId }) => resultId),
      [NOT_STARTED_BLOCKED_RESULT.resultId, later.resultId],
    );
    database.close();
  });

  it("stores the parsed result as canonical record_json", () => {
    const path = databasePath();
    const database = openDatabase(path);
    const parsed = DryRunScenarioResultSchema.parse(NOT_STARTED_BLOCKED_RESULT);
    database.authority.dryRunScenarioResults.insert(parsed);
    const raw = new DatabaseSync(path, { readOnly: true });
    const row = raw.prepare(`
      SELECT record_json FROM dryrun_results WHERE record_key = ?
    `).get(parsed.resultId);

    assert.equal(row?.record_json, canonicalJsonStringify(parsed));
    raw.close();
    database.close();
  });

  it("inserts a started result bound to its dry-run execution identities", () => {
    const database = openDatabase();
    database.authority.runs.enqueue({
      ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, dryRun: true },
    });
    const result = {
      ...STARTED_MET_RESULT,
      scenarioId: "person-lookup/dry-run",
      workflow: QUEUED_RUN.envelope.workflow,
      execution: {
        state: "started",
        runId: QUEUED_RUN.envelope.runId,
        traceId: QUEUED_RUN.envelope.traceId,
      },
    };

    const inserted = database.authority.dryRunScenarioResults.insert(result);

    assert.equal(inserted.state, "inserted");
    assert.deepEqual(database.authority.dryRunScenarioResults.get(result.resultId),
      DryRunScenarioResultSchema.parse(result));
    database.close();
  });

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

  it("rejects resolved subject values before any record_json is written", () => {
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
      WHERE instr(record_json, '10873698') > 0
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
      () => raw.prepare("UPDATE dryrun_results SET subject_label = ? WHERE record_key = ?")
        .run("rewritten-canary", NOT_STARTED_BLOCKED_RESULT.resultId),
      /dry-run scenario results are immutable/,
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
      () => raw.prepare("DELETE FROM dryrun_results WHERE record_key = ?")
        .run(NOT_STARTED_BLOCKED_RESULT.resultId),
      /dry-run scenario results are never deleted/,
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
        (record_key, scenario_id, workflow, subject_label, manifest_digest, verdict,
         execution_state, run_id, trace_id, wall_time_ms, record_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      corrupted.resultId, corrupted.scenarioId, corrupted.workflow, corrupted.subjectLabel,
      corrupted.manifestDigest, corrupted.verdict, corrupted.execution.state, null, null,
      corrupted.wallTimeMs, JSON.stringify(corrupted), corrupted.recordedAt,
    );
    raw.close();

    assert.throws(
      () => openDatabase(path),
      /authority table dryrun_results record .* failed strict record schema validation/,
    );
  });
});
