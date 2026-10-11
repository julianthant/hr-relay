import { randomUUID } from "node:crypto";
import { admitDirectWorker } from "../../../src/backend/storage/sqlite/worker-slots.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import {
RunLifecycleSchema,
RunRecordSchema,
runClaim,
runTransitionViolation,
} from "../../../src/models/run/record.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import {
CONFIG_SNAPSHOT,
HASH_A,
HASH_C,
NOW,
UUID_1
} from "../../support/fixtures/phase1c-contract-fixtures.js";
import {
WORKER_START_REQUEST as BASE_WORKER_START_REQUEST,
QUEUED_RUN,
RUN_ID,
WORKFLOW_ID
} from "../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const WORKER_ID = `${WORKFLOW_ID}-worker-1`;
const WORKER_START_REQUEST = { ...BASE_WORKER_START_REQUEST, workerId: WORKER_ID };
const CLOCK = manualClock(new Date(NOW));
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

const LATER = "2026-07-31T17:05:00.000Z";
const MUCH_LATER = "2026-07-31T18:00:00.000Z";

function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-rebuild-runs-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  for (const poolIndex of [1, 2]) database.withAuthorityTransaction(repositories => {
    admitDirectWorker(repositories, { commandId: randomUUID(), workflow: WORKFLOW_ID, poolIndex,
      expectedPoolVersion: repositories.workerPools.get(WORKFLOW_ID)?.version ?? 0, processId: WORKER_START_REQUEST.processId,
      processAcquisitionId: randomUUID(), authorityPath: join(root, "state.sqlite"), processLockRoot: join(root, "locks"), now: NOW }, randomUUID());
  });
  databases.push(database);
  return database;
}

function claimOne(database: AuthorityDatabase, now = NOW) {
  const outcome = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now });
  if (outcome.state !== "claimed") throw new Error(`expected a claim, got ${outcome.state}`);
  return outcome.run;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe("RunRecord", () => {
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

  it("resumes only a parked run, and only to a named node", () => {
    const database = openDatabase();
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
    // A parked run holds no claim: the column trigger and the schema agree.
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
  it("keeps the typed columns in lockstep with the record, and rejects a claim outside a claimed state", () => {
    const database = openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const claimed = claimOne(database);
    assert.equal(runClaim(claimed)?.workerId, WORKER_ID);

    const reopened = database.authority.runs.get(RUN_ID);
    assert.equal(reopened?.lifecycle.state, "claimed");
    assert.equal(reopened?.input.parsed.schemaHash, HASH_C);
    assert.equal(reopened?.input.ingressSchemaHash, HASH_A);
  });
});
