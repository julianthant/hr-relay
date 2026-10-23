import { dryRunScenarioResultRecords } from "../../support/helpers/dry-run-scenario-fixtures.js";
import assert from "node:assert/strict";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { DryRunScenarioResultSchema } from "../../../src/models/trust/dry-run-scenario-result.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const NOW = "2026-08-25T12:00:00.000Z";
const HASH = "a".repeat(64);
const profiles: ReturnType<typeof createBoundProfileFixture>[] = [];
const { STARTED_MET_RESULT, NOT_STARTED_BLOCKED_RESULT } = dryRunScenarioResultRecords(HASH, NOW);



function databasePath(): string {
  const profile = createBoundProfileFixture();
  profiles.push(profile);
  return profile.path;
}

function openDatabase(path = databasePath()): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "dry-run-result-test" },
    manualClock(new Date(NOW)),
  );
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  return database;
}

afterEach(() => {
  for (const profile of profiles.splice(0)) profile.close();
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

  it("stores the parsed result as canonical payload_json", () => {
    const path = databasePath();
    const database = openDatabase(path);
    const parsed = DryRunScenarioResultSchema.parse(NOT_STARTED_BLOCKED_RESULT);
    database.authority.dryRunScenarioResults.insert(parsed);
    const raw = new DatabaseSync(path, { readOnly: true });
    const row = raw.prepare(`
      SELECT payload_json FROM dryrun_results WHERE id = ?
    `).get(parsed.resultId);

    assert.equal(row?.payload_json, canonicalJsonStringify(parsed));
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
});
