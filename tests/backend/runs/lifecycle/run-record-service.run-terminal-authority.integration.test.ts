import { createRunIntegrationTestWorld } from "../../../support/helpers/run-integration-world.js";
import assert from "node:assert/strict";
import { syntheticDatabasePath } from "../../../support/helpers/synthetic-database-admission.js";

import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";




import { manualClock } from "../../../../src/rules/time/clock.js";

import {
LATER,
UUID_6,
UUID_7
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
RUN_ID
} from "../../../support/fixtures/phase1f-run-fixtures.js";

import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const CLOCK = manualClock(new Date(LATER));
const { roots, cleanup, WORKER_ID, CLAIM, openDatabase, startRunning, failure, failureAuthorization, resultRequest } =
  createRunIntegrationTestWorld(CLOCK);

afterEach(cleanup);

describe("atomic failure terminal authority", () => {

  it("copies a failure's diagnostic admission stamp exactly when terminalizing", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const record = { ...failure(running), diagnosticSafetyVersion: 1 as const };
    const applied = database.terminalizeFailure(personLookupDescriptor, {
      failure: record,
      authorization: failureAuthorization(running),
    });

    assert.equal(applied.run.lifecycle.state, "terminal");
    assert.equal(
      applied.run.lifecycle.state === "terminal"
        ? applied.run.lifecycle.diagnosticSafetyVersion
        : undefined,
      record.diagnosticSafetyVersion,
    );
  });

  it("rejects identity, execution, version, claim, and generic failed bypasses", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const record = failure(running);
    assert.throws(() => database.terminalizeFailure(personLookupDescriptor, {
      failure: { ...record, traceId: "pl-170001-1111" },
      authorization: failureAuthorization(running),
    }), /identity does not match/);
    assert.throws(() => database.terminalizeFailure(personLookupDescriptor, {
      failure: { ...record, taskId: "ucpath/search-person-org" },
      authorization: failureAuthorization(running),
    }), /does not match descriptor node/);
    assert.throws(() => database.terminalizeFailure(personLookupDescriptor, {
      failure: record,
      authorization: { ...failureAuthorization(running), expectedVersion: running.version - 1 },
    }), /not/);
    assert.throws(() => database.terminalizeFailure(personLookupDescriptor, {
      failure: record,
      authorization: {
        ...failureAuthorization(running),
        claim: { workerId: "worker-2", claimGeneration: 1 },
      },
    }), /no longer claimed/);
    assert.throws(() => database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: running.version,
      claim: CLAIM,
      lifecycle: { state: "terminal", outcome: "failed", endedAt: LATER, failureId: UUID_6 },
      now: LATER,
    }), /requires atomic terminal authority/);
    assert.equal(database.authority.failures.get(UUID_6), undefined);
  });

  for (const injectedStep of ["failure", "run"] as const) {
    it(`rolls back every failure terminal write when ${injectedStep} persistence fails`, () => {
      const database = openDatabase({
        afterFailureStorageStep: (step) => {
          if (step === injectedStep) throw new Error(`injected ${step} failure`);
        },
      });
      const running = startRunning(database);
      const record = failure(running);
      const generation = database.getMeta().authorityGeneration;
      assert.throws(() => database.terminalizeFailure(personLookupDescriptor, {
        failure: record,
        authorization: failureAuthorization(running),
      }), /injected/);
      assert.equal(database.authority.failures.get(UUID_6), undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
      assert.equal(database.getMeta().authorityGeneration, generation);
    });
  }
});

describe("atomic success terminal authority", () => {

  it("rejects an authenticated result whose exact checkpoint was never stored", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, authorization, factoryAuthorization } = resultRequest(database, running);
    // A second connection corrupts the exact checkpoint while this authority
    // remains open: terminal settlement must independently reject the absence.
    const path = syntheticDatabasePath(database);
    assert.equal(path, join(roots.at(-1) ?? "", "state.db"));
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA database_list").all().find(row => row.name === "main")?.file, path);
      const guard = raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='run_checkpoints_owner_delete'").get();
      if (guard === undefined || typeof guard.sql !== "string") throw new Error("missing checkpoint ownership guard");
      raw.exec("BEGIN; DROP TRIGGER run_checkpoints_owner_delete; DELETE FROM run_checkpoints");
      raw.exec(guard.sql); raw.exec("COMMIT");
    } finally { raw.close(); }
    assert.throws(
      () => database.terminalizeSuccess({ result, authorization }, factoryAuthorization),
      /has no exact stored checkpoint|timeline-checkpoint-reference-mismatch/,
    );
    // Reopening also refuses the now-dangling durable checkpoint event.
    assert.throws(() => AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, CLOCK,
    ), /timeline-checkpoint-reference-mismatch/);

  });

  for (const injectedStep of ["result", "run"] as const) {
    it(`rolls back every success terminal write when ${injectedStep} persistence fails`, () => {
      const database = openDatabase({
        afterSuccessStorageStep: (step) => {
          if (step === injectedStep) throw new Error(`injected ${step} failure`);
        },
      });
      const running = startRunning(database);
      const { result, authorization, factoryAuthorization } = resultRequest(database, running);
      const generation = database.getMeta().authorityGeneration;
      assert.throws(() => database.terminalizeSuccess({
        result,
          authorization,
      }, factoryAuthorization), /injected/);
      assert.equal(database.authority.runResults.get(RUN_ID), undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
      assert.equal(database.getMeta().authorityGeneration, generation);
    });
  }
});


describe("public settlement write boundaries", () => {
  for (const kind of ["success", "failure"] as const) {
    for (const table of [kind === "success" ? "run_results" : "run_failures", "runs", "timeline_events", "commands", "command_audits"]) {
      it(`${kind} rolls back completion, consequence, timeline and journal after ${table} write`, () => {
        const database = openDatabase(); const running = startRunning(database);
        const built = kind === "success" ? resultRequest(database, running) : undefined;
        const request = { kind, commandId: "99000000-0000-4000-8000-000000000011",
          terminal: built === undefined ? { failure: failure(running), authorization: failureAuthorization(running) }
            : { result: built.result, authorization: built.authorization } };
        const service = new RunRecordService({ database, clock: CLOCK, publishQueued: () => { throw new Error("unexpected queue publication"); }, ids: { uuid: () => UUID_7 } });
        const path = syntheticDatabasePath(database);
        assert.equal(path, join(roots.at(-1) ?? "", "state.db"));
        const raw = new DatabaseSync(path);
        try {
          assert.equal(raw.prepare("PRAGMA database_list").all().find(row => row.name === "main")?.file, path);
          const before = database.getMeta(); const events = database.authority.timelineEvents.page({});
          raw.exec(`CREATE TRIGGER injected_completion AFTER ${table === "runs" ? "UPDATE" : "INSERT"} ON ${table} BEGIN SELECT RAISE(ABORT, 'C-write-fault'); END`);
          assert.throws(() => service.terminalize(request, personLookupDescriptor, built?.factoryAuthorization), /C-write-fault/);
          assert.deepEqual(database.authority.runs.get(RUN_ID), running);
          assert.deepEqual(database.authority.failures.listByRun(RUN_ID), []);
          assert.equal(database.authority.runResults.get(RUN_ID), undefined);
          assert.equal(database.authority.lifecycleJournal.getCommand(request.commandId), undefined);
          assert.equal(database.authority.lifecycleJournal.findAuditByCommand(request.commandId), undefined);
          assert.deepEqual(database.authority.timelineEvents.page({}), events);
          assert.deepEqual(database.getMeta(), before);
          raw.exec("DROP TRIGGER injected_completion");
          assert.equal(service.terminalize(request, personLookupDescriptor, built?.factoryAuthorization).state, "applied");
          const settled = database.authority.runs.get(RUN_ID); assert.ok(settled?.completion);
          // Discard the acknowledgement and replay through an independently opened connection.
          const reopened = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "c-replay" }, CLOCK);
          try {
            const replay = new RunRecordService({ database: reopened, clock: CLOCK, publishQueued: () => { throw new Error("unexpected queue publication"); }, ids: { uuid: () => UUID_7 } });
            const generation = reopened.getMeta().authorityGeneration;
            assert.equal(replay.terminalize(request, personLookupDescriptor).state, "applied-already");
            assert.deepEqual(reopened.authority.runs.get(RUN_ID), settled);
            assert.equal(reopened.getMeta().authorityGeneration, generation);
            const ended = reopened.authority.timelineEvents.page({}).filter((record) => record.payload.kind === "span" && record.payload.event.t === "span.ended");
            assert.equal(ended.length, 1);
            const event = ended[0]?.payload;
            assert.ok(event?.kind === "span" && event.event.t === "span.ended" && event.event.kind === "run");
            assert.equal(event.event.workerId, WORKER_ID); assert.equal(event.event.claimGeneration, 1);
          } finally { reopened.close(); }
        } finally { raw.close(); }
      });
    }
  }
});
