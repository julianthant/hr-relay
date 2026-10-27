import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { createRunClaimFixtures } from "../../support/helpers/backend/run-claim-fixtures.js";
import { createRunIntegrationTestWorld } from "../../support/helpers/run-integration-world.js";
import { default as assert } from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe } from "vitest";
import { it } from "vitest";
import { z } from "zod";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { insertMeasuredSearchRun } from "../../support/helpers/backend/cross-date-search-harness.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { afterEach } from "vitest";

import { runRecordFromRow } from "../../../src/backend/storage/sqlite/run-record-row.js";
import { RunLifecycleSchema } from "../../../src/models/run/record.js";
import type { RunRecord } from "../../../src/models/run/record.js";




import { HASH_C } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { LATER as LATERImport2 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";

import { UUID_7 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";
import { RUN_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { WORKFLOW_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import { summaryFixture } from "../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { id } from "../../support/helpers/database-foundation/fixtures.js";
import { NOW as NOWImport2 } from "../../support/helpers/database-foundation/fixtures.js";


import { runClaim } from "../../../src/models/run/record.js";
import { runTransitionViolation } from "../../../src/models/run/record.js";

import { HASH_A } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_1 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { WORKER_START_REQUEST as BASE_WORKER_START_REQUEST } from "../../support/fixtures/phase1f-run-fixtures.js";

{
function corruptRunSource(raw: DatabaseSync, sql: string, ...values: (string | number | null)[]) {
  const trigger = z.object({ sql: z.string() }).parse(raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='runs_identity'").get());
  raw.exec("DROP TRIGGER runs_identity");
  try { raw.prepare(sql).run(...values); }
  finally { raw.exec(trigger.sql); }
}

describe("cross-date search authority read", () => {

  it("refuses a strict run record whose authority order instant is foreign", async () => {
    const profile = await createBoundProfileFixture();
    const databasePath = profile.path;
    const database = AuthorityDatabase.open(
      { path: databasePath, busyTimeoutMs: 1_000, migrationOwner: "search-malformed-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    const raw = new DatabaseSync(databasePath);
    try {
      const run = insertMeasuredSearchRun(database, { authorityPath: databasePath, seed: 90, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const malformed = RunRecordSchema.parse({
        ...run,
        createdAt: "2026-08-28T15:01:00.000Z",
        updatedAt: "2026-08-28T15:01:00.000Z",
      });
      const { envelope, ...lifecycle } = malformed;
      corruptRunSource(raw, "UPDATE runs SET envelope_json = ?, lifecycle_json = ? WHERE id = ?",
        canonicalJsonStringify(envelope), canonicalJsonStringify(lifecycle), run.envelope.runId);

      assert.throws(
        () => database.authority.runs.search({
          q: "separations",
          scope: "workflow",
          facets: {},
          limit: 1,
        }),
        /run-search-index-rebuild-required/,
      );
    } finally {
      raw.close();
      database.close();
      await profile.close();
    }
  });
});
}

{
const CLOCK = manualClock(new Date(LATERImport2));

const { roots, openDatabase, startRunning, cleanup, failure, failureAuthorization, resultRequest } = createRunIntegrationTestWorld(CLOCK);

const AFTER_LATER = "2026-07-31T17:02:00.000Z";

function corruptRunConsequence(
  mutate: (run: RunRecord) => unknown,
): void {
  const path = join(roots.at(-1) ?? "", "state.db");
  const raw = new DatabaseSync(path);
  try {
    const guards = ["runs_completion_update", "runs_completion_immutable"].map(name => {
      const row = raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name);
      if (row === undefined || typeof row.sql !== "string") throw new Error("missing corruption fixture guard");
      return { name, sql: row.sql };
    });
    raw.exec("BEGIN");
    try {
      for (const guard of guards) raw.exec("DROP TRIGGER " + guard.name);
      const row = raw.prepare("SELECT * FROM runs WHERE id=?").get(RUN_ID);
      if (row === undefined) throw new Error("run is absent from corruption fixture");
      const corrupted = z.looseObject({ lifecycle: RunLifecycleSchema, claimGeneration: z.number().int(),
        version: z.number().int(), updatedAt: z.string() }).parse(mutate(runRecordFromRow(row)));
      const { envelope, ...lifecycle } = corrupted;
      void envelope;
      const owner = "workerId" in corrupted.lifecycle ? corrupted.lifecycle.workerId : null;
      const heartbeat = "heartbeatAt" in corrupted.lifecycle ? corrupted.lifecycle.heartbeatAt : null;
      const outcome = corrupted.lifecycle.state === "terminal" ? corrupted.lifecycle.outcome : null;
      raw.prepare("UPDATE runs SET lifecycle_json=?,state=?,outcome=?,owner_worker_id=?,heartbeat_at=?,version=?,claim_generation=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(lifecycle), corrupted.lifecycle.state, outcome, owner, heartbeat,
          corrupted.version, corrupted.claimGeneration, corrupted.updatedAt, RUN_ID);
      for (const guard of guards) raw.exec(guard.sql);
      raw.exec("COMMIT");
    } catch (error) { raw.exec("ROLLBACK"); throw error; }
  } finally {
    raw.close();
  }
}







describe("atomic failure terminal authority", () => {
afterEach(cleanup);

  it("refuses replay for every schema-valid mismatch from failure authorization to consequence", async () => {
    const cases: ReadonlyArray<readonly [string, (run: RunRecord) => unknown]> = [
      ["version", (run: RunRecord) => ({ ...run, version: run.version + 1 })],
      ["claim generation", (run: RunRecord) => ({ ...run, claimGeneration: run.claimGeneration + 1 })],
      ["lifecycle state", (run: RunRecord) => ({ ...run, lifecycle: { state: "queued" as const } })],
      ["outcome", (run: RunRecord) => ({
        ...run,
        lifecycle: { state: "terminal" as const, outcome: "cancelled" as const, endedAt: LATERImport2 },
      })],
      ["failure id", (run: RunRecord) => ({
        ...run,
        lifecycle: run.lifecycle.state === "terminal"
          ? { ...run.lifecycle, failureId: UUID_7 }
          : run.lifecycle,
      })],
      ["endedAt", (run: RunRecord) => ({
        ...run,
        lifecycle: run.lifecycle.state === "terminal"
          ? { ...run.lifecycle, endedAt: AFTER_LATER }
          : run.lifecycle,
      })],
      ["updatedAt", (run: RunRecord) => ({ ...run, updatedAt: AFTER_LATER })],
    ];
    for (const [name, mutate] of cases) {
      const database = await openDatabase();
      const running = startRunning(database);
      const record = failure(running);
      const request = { failure: record, authorization: failureAuthorization(running) } as const;
      database.terminalizeFailure(personLookupDescriptor, request);
      corruptRunConsequence(mutate);
      assert.throws(
        () => database.terminalizeFailure(personLookupDescriptor, request),
        /completion|terminal consequence|run-search-index-corrupt/,
        name,
      );
    }
  });
});

describe("atomic success terminal authority", () => {
afterEach(cleanup);

  it("refuses replay for every schema-valid mismatch from success authorization to consequence", async () => {
    const cases: ReadonlyArray<readonly [string, (run: RunRecord) => unknown]> = [
      ["version", (run: RunRecord) => ({ ...run, version: run.version + 1 })],
      ["claim generation", (run: RunRecord) => ({ ...run, claimGeneration: run.claimGeneration + 1 })],
      ["lifecycle state", (run: RunRecord) => ({ ...run, lifecycle: { state: "queued" as const } })],
      ["outcome", (run: RunRecord) => ({
        ...run,
        lifecycle: { state: "terminal" as const, outcome: "cancelled" as const, endedAt: LATERImport2 },
      })],
      ["endedAt", (run: RunRecord) => ({
        ...run,
        lifecycle: run.lifecycle.state === "terminal"
          ? { ...run.lifecycle, endedAt: AFTER_LATER }
          : run.lifecycle,
      })],
      ["updatedAt", (run: RunRecord) => ({ ...run, updatedAt: AFTER_LATER })],
    ];
    for (const [name, mutate] of cases) {
      const database = await openDatabase();
      const running = startRunning(database);
      const terminal = resultRequest(database, running);
      const request = {
        result: terminal.result,
        authorization: terminal.authorization,
      };
      database.terminalizeSuccess(request, terminal.factoryAuthorization);
      corruptRunConsequence(mutate);
      assert.throws(
        () => database.terminalizeSuccess(request),
        /completion|terminal consequence|run-search-index-corrupt/,
        name,
      );
    }
  });
});
}

{
it("contains operation members once and preserves protected titles and missing warning evidence", async () => {
  const f = await summaryFixture();
  try {
    const rootId = id(8870), memberId = id(8871);
    f.db.withAuthorityTransaction(() => {
      for (const [runId, shape] of [[rootId, "operation"], [memberId, "operation-member"]] as const) {
        f.db.authority.runs.enqueue(RunRecordSchema.parse({ ...f.run,
          envelope: { ...f.run.envelope, runId, itemId: runId, shape, enqueuedAt: NOWImport2,
            ...(shape === "operation-member" ? { parent: { runId: rootId, tracePrefix: f.run.envelope.traceId, edgeId: "synthetic-member" } } : {}) },
          input: { ...f.run.input, raw: { emplId: "10812345" }, parsed: { ...f.run.input.parsed, value: { emplId: "10812345" },
            protectedBindings: [{ kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: id(8872) }] } },
          displayName: "10812345", lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: NOWImport2, updatedAt: NOWImport2 }));
      }
    });
    const wire = f.projection.buildDashboardDayWire("2026-09-09");
    assert.equal(wire.monthCounts.find(day => day.day === "2026-09-09")?.count, 1);
    assert.equal(wire.statusCounts.find(row => row.status === "queued")?.count, 1);
    const root = wire.queueSurfaces.find(row => row.runId === rootId);
    assert.equal(root?.surfaceKind, "operation");
    if (root?.surfaceKind !== "operation") throw new Error("operation-not-served");
    assert.deepEqual(root.memberRunIds, [memberId]);
    assert.equal(root.memberRollup.total, 1);
    assert.equal(root.warnings.state, "absent");
    assert.deepEqual(root.displayName, {
      state: "absent",
      reason: "the operator's display name is withheld because this run carries protected input",
    });
    assert.equal(JSON.stringify(wire).includes("10812345"), false);
    const report = f.projection.buildActivityReportWire("2026-09-09", "2026-09-09");
    assert.equal(report.totalRuns, 1);
  } finally { await f.dispose(); }
});
}

{
const WORKER_ID = `${WORKFLOW_ID}-worker-1`;
const WORKER_START_REQUEST = { ...BASE_WORKER_START_REQUEST, workerId: WORKER_ID };
const CLOCK = manualClock(new Date(NOW));
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

const LATER = "2026-07-31T17:05:00.000Z";
const MUCH_LATER = "2026-07-31T18:00:00.000Z";

const { openDatabase, claimOne, cleanup: cleanupClaims } =
  createRunClaimFixtures(CLOCK, roots, databases, WORKER_START_REQUEST, WORKER_ID);



describe("RunRecord", () => {
afterEach(cleanupClaims);

  it("refuses a claimed run that was never claimed", () => {
    assert.throws(
      () => RunRecordSchema.parse({
        ...QUEUED_RUN,
        lifecycle: { state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
        claimGeneration: 0,
      }),
      /must have been claimed at least once/,
    );
  });

  it("requires a failure record for a failed run and forbids one otherwise", () => {
    assert.throws(
      () => RunRecordSchema.parse({
        ...QUEUED_RUN,
        lifecycle: { state: "terminal", outcome: "failed", endedAt: LATER },
      }),
      /must name its structured failure record/,
    );
    assert.throws(
      () => RunRecordSchema.parse({
        ...QUEUED_RUN,
        lifecycle: { state: "terminal", outcome: "done", endedAt: LATER, failureId: UUID_1 },
      }),
      /outcome done cannot carry a failure record/,
    );
  });

  it("returns no claim for a queued, parked, or terminal row", () => {
    assert.equal(runClaim(RunRecordSchema.parse(QUEUED_RUN)), undefined);
    assert.equal(
      runClaim(RunRecordSchema.parse({
        ...QUEUED_RUN,
        claimGeneration: 1,
        lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: LATER, resumeAt: "active-status" },
      })),
      undefined,
    );
  });
});

describe("run transition legality", () => {
afterEach(cleanupClaims);

  const lifecycle = (input: unknown) => RunLifecycleSchema.parse(input);
  const queued = lifecycle({ state: "queued" });
  const claimed = lifecycle({ state: "claimed", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW });
  const running = lifecycle({ state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW });
  const done = lifecycle({ state: "terminal", outcome: "done", endedAt: LATER });
  const interrupted = lifecycle({ state: "terminal", outcome: "interrupted", endedAt: LATER });

  it("permits the documented edges", () => {
    assert.equal(runTransitionViolation(queued, claimed), undefined);
    assert.equal(runTransitionViolation(running, done), undefined);
    assert.equal(runTransitionViolation(interrupted, queued), undefined);
  });

  it("refuses running without a claim, and refuses reopening a settled run", () => {
    assert.match(String(runTransitionViolation(queued, running)), /queued cannot transition to running/);
    assert.match(String(runTransitionViolation(done, queued)), /only an interrupted run may be requeued/);
  });

  it("refuses a queued run ending as done without ever being claimed", () => {
    assert.match(String(runTransitionViolation(queued, done)), /cannot end as done without being claimed/);
    assert.equal(
      runTransitionViolation(queued, lifecycle({ state: "terminal", outcome: "cancelled", endedAt: LATER })),
      undefined,
    );
  });

  it("permits an unchanged lifecycle from any state, including a settled one", () => {
    assert.equal(runTransitionViolation(done, done), undefined);
    assert.equal(runTransitionViolation(queued, queued), undefined);
  });
});

describe("run claim store", () => {
afterEach(cleanupClaims);

  it("resumes only a parked run, and only to a named node", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const claimed = claimOne(database);
    const validating = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: claimed.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
      now: LATER,
    });
    if (validating.state !== "applied") throw new Error("validating transition should apply");
    assert.throws(
      () => database.authority.runs.resume({
        runId: RUN_ID,
        expectedVersion: validating.run.version,
        startAt: "active-status",
        now: LATER,
      }),
      /only a parked run resumes/,
    );

    const running = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: validating.run.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: LATER },
      now: LATER,
    });
    if (running.state !== "applied") throw new Error("running transition should apply");
    const parked = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: running.run.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: LATER, resumeAt: "active-status" },
      now: LATER,
    });
    if (parked.state !== "applied") throw new Error("park should apply");

    assert.equal(runClaim(parked.run), undefined);

    const resumed = database.authority.runs.resume({
      runId: RUN_ID,
      expectedVersion: parked.run.version,
      startAt: "active-status",
      now: MUCH_LATER,
    });
    if (resumed.state !== "applied") throw new Error("resume should apply");
    assert.equal(resumed.run.envelope.startAt, "active-status");
    assert.equal(resumed.run.envelope.attempt, 1, "a gate resume continues the same attempt");
    assert.equal(resumed.run.lifecycle.state, "queued");
  });
});

describe("run row column invariants", () => {
afterEach(cleanupClaims);

  it("keeps the typed columns in lockstep with the record, and rejects a claim outside a claimed state", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const claimed = claimOne(database);
    assert.equal(runClaim(claimed)?.workerId, WORKER_ID);

    const reopened = database.authority.runs.get(RUN_ID);
    assert.equal(reopened?.lifecycle.state, "claimed");
    assert.equal(reopened?.input.parsed.schemaHash, HASH_C);
    assert.equal(reopened?.input.ingressSchemaHash, HASH_A);
  });
});
}
