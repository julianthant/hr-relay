import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { afterEach, describe, it, vi } from "vitest";
import { historyWorld } from "../../../support/helpers/storage/transaction-history-fixture.js";
/** Activity shape stays stable; confirmed database history replaces file folding. */

/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
/** Activity shape stays stable; confirmed database history replaces file folding. */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createTimelineRepository } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { reconstructConfirmedOperation } from "../../../../src/models/events/confirmed-operation.js";
import { TimelineAppendSchema } from "../../../../src/models/events/timeline.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { localDatePart, manualClock } from "../../../../src/rules/time/clock.js";
import { fixtureUuid } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT_m4, LEDGER_PAYLOAD, SPAN_OUTBOX_PAYLOAD, UUID_5, UUID_6, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { historyClock } from "../../../support/helpers/storage/transaction-history-fixture.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { openConfirmedRetentionDatabase } from "../../../support/helpers/storage/confirmed-retention-fixtures.js";
import { atomicWriteCheckpoint, currentAtomicWriteFixture, seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";

{

const cleanup: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const dispose of cleanup.splice(0)) dispose(); };
const range = { from: "2026-07-01", to: "2026-09-09" };
describe("confirmed database transaction history", () => {
afterEach(_afterEachFixture0);

  it("counts distinct operations at the same timestamp once after restart and ignores stale files", () => {
    const w = historyWorld(); cleanup.push(() => w.dispose());
    w.commit(1); w.commit(2); const before = w.history.query(range);
    assert.equal(before.rows.length, 2); assert.equal(new Set(before.rows.map((row) => row.eventId)).size, 2);
    w.reopen(); assert.deepEqual(w.history.query(range), before);
    writeFileSync(`${w.root}/obsolete-ledger.jsonl`, "corrupt stale file\n");
    assert.deepEqual(w.history.query(range), before);
    assert.deepEqual(w.history.foldActivityRange(range.from, range.to).systems, [{ system: "ucpath", entries: 2, prod: 2, test: 0 }]);
    assert.equal(w.history.query({ ...range, system: "kuali" }).rows.length, 0);
  });
});
}

{

const cleanup: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const dispose of cleanup.splice(0)) dispose(); };
const instant = "2026-08-03T18:30:00.000Z"; const day = localDatePart(new Date(instant));
function world() { const w = historyWorld({ terminalize: true }); cleanup.push(() => w.dispose()); return w; }
describe("Activity confirmed transaction fold", () => {
afterEach(_afterEachFixture0);

  it("answers an empty block when nothing was confirmed", () => { assert.deepEqual(world().history.foldActivityRange(day, day), { systems: [] }); });
  it("folds system/instance and orders by count then system id", () => {
    const w = world();
    for (const [index, system, instance] of [[1, "ucpath", "prod"], [2, "ucpath", "prod"], [3, "ucpath", "test"], [4, "kuali", "prod"], [5, "crm", "test"]] as const) w.commit(index, { system, instance, confirmedAt: instant });
    assert.deepEqual(w.history.foldActivityRange(day, day), { systems: [{ system: "ucpath", entries: 3, prod: 2, test: 1 }, { system: "crm", entries: 1, prod: 0, test: 1 }, { system: "kuali", entries: 1, prod: 1, test: 0 }] });
  });
  it("uses the confirmation's local day across a UTC midnight", () => {
    const w = world(); const boundary = "2026-08-04T01:30:00.000Z"; w.commit(11, { confirmedAt: boundary });
    assert.equal(w.history.foldActivityRange(localDatePart(new Date(boundary)), localDatePart(new Date(boundary))).systems[0].entries, 1);
  });
  it("excludes outside confirmations and includes them in an expanded window", () => {
    const w = world(); w.commit(12, { confirmedAt: instant }); w.commit(13, { confirmedAt: "2026-08-06T18:30:00.000Z" });
    assert.equal(w.history.foldActivityRange(day, day).systems[0].entries, 1); assert.equal(w.history.foldActivityRange(day, "2026-08-07").systems[0].entries, 2);
  });
  it("refuses a backwards range", () => { assert.throws(() => world().history.foldActivityRange("2026-08-05", "2026-08-01"), /ends before it starts/u); });
});
}

{

const cleanup: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const dispose of cleanup.splice(0)) dispose(); };
const range = { from: "2026-07-01", to: "2026-09-09" };
describe("native committed history readers", () => {
afterEach(_afterEachFixture0);

  it("two independent database readers and a restarted reader see the same committed identities", () => {
    const w = historyWorld(); cleanup.push(() => w.dispose()); w.commit(401);
    const reader = AuthorityDatabase.open({ path: w.path, busyTimeoutMs: 250, migrationOwner: "second-history-reader" }, historyClock);
    try {
      assert.deepEqual(createTransactionHistory(reader.authority).query(range), w.history.query(range));
      w.commit(402); assert.equal(createTransactionHistory(reader.authority).query(range).rows.length, 2);
      w.reopen(); assert.deepEqual(createTransactionHistory(reader.authority).query(range), w.history.query(range));
    } finally { reader.close(); }
  });
});
}

{

const range = { from: "2026-07-01", to: "2026-09-09" };

it("refuses missing retained confirmation publication instead of returning smaller totals", () => {
  const w = historyWorld({ terminalize: true });
  try {
    const fixture = w.commit(804), runId = fixture.commit.transaction.runId;
    const run = w.database.authority.runs.get(runId); assert.ok(run);
    assert.equal(testRunService(w.database, historyClock).delete({ commandId: fixtureUuid("missing-history-delete"),
      runId, expectedVersion: run.version }).state, "deleted");
    assert.equal(w.history.query(range).rows.length, 1);
    using raw = new DatabaseSync(w.path);
    const publication = raw.prepare("SELECT publication_json FROM write_intents WHERE id=?").get(fixture.commit.transaction.writeIntentId)?.publication_json;
    assert.ok(typeof publication === "string");
    const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='write_intents'").all();
    using _restoreTriggers = { [Symbol.dispose]() { for (const trigger of triggers) raw.exec(String(trigger.sql)); } };
    for (const trigger of triggers) raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
    using _restorePublication = { [Symbol.dispose]() { raw.prepare("UPDATE write_intents SET publication_json=? WHERE id=?").run(publication, fixture.commit.transaction.writeIntentId); } };
    assert.equal(raw.prepare("UPDATE write_intents SET publication_json=NULL WHERE id=?").run(fixture.commit.transaction.writeIntentId).changes, 1);
    assert.throws(() => w.history.query(range), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /run-search-index-rebuild-required/u);
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, /authority table write_intents failed native record validation:[\s\S]*expected string, received null/u);
      return true;
    });
  } finally { w.dispose(); }
});

it("bounds cold range/run selected evidence independently of unrelated current and deleted history", () => {
  const w = historyWorld({ terminalize: true });
  try {
    const deletedIds: string[] = [];
    w.database.withAuthorityTransaction(() => {
      for (let index = 1000; index < 1120; index++) {
        const fixture = w.commit(index, { confirmedAt: index === 1000 ? "2026-09-08T18:00:00.000Z" : "2026-08-01T18:00:00.000Z" });
        if (index < 1040) {
          const run = w.database.authority.runs.get(fixture.commit.transaction.runId); assert.ok(run);
          assert.equal(testRunService(w.database, historyClock).delete({ commandId: fixtureUuid(`bounded-delete-${index}`),
            runId: run.envelope.runId, expectedVersion: run.version }).state, "deleted");
          deletedIds.push(run.envelope.runId);
        }
      }
    });
    w.reopen();
    const observed: Array<{ sql: string; rows: number }> = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restores the native receiver.
    const original = DatabaseSync.prototype.prepare;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
      const statement = original.call(this, sql);
      if (sql.includes("WITH sources AS")) {
        const all = statement.all.bind(statement);
        statement.all = (...args) => { const rows = Reflect.apply(all, statement, args) as ReturnType<typeof all>; observed.push({ sql, rows: rows.length }); return rows; };
      }
      return statement;
    });
    try {
      assert.equal(w.history.query({ from: "2026-09-08", to: "2026-09-08" }).rows.length, 1);
      assert.equal(observed.length, 1);
      assert.ok(observed.every(row => row.rows <= 1));
      observed.length = 0;
      assert.equal(w.history.query({ from: "0001-01-01", to: "9999-12-31", runId: deletedIds[1] }).rows.length, 1);
      assert.equal(observed.length, 1);
      assert.ok(observed.every(row => row.rows <= 1));
      w.commit(1120, { confirmedAt: "2026-09-08T18:00:00.000Z" }); observed.length = 0;
      assert.equal(w.history.query({ from: "2026-09-08", to: "2026-09-08" }).rows.length, 2);
      assert.equal(observed.length, 1);
      assert.ok(observed.every(row => row.rows <= 2));
      observed.length = 0;
      assert.equal(w.history.query({ from: "0001-01-01", to: "9999-12-31" }).rows.length, 121);
      assert.equal(observed[0]?.rows, 121);
      using raw = new DatabaseSync(w.path, { readOnly: true });
      const rangePlan = raw.prepare("EXPLAIN QUERY PLAN SELECT id FROM timeline_events WHERE retention_class='confirmed-operation' AND confirmed_at>=? AND confirmed_at<? ORDER BY confirmed_at,id LIMIT 10001").all("2026-09-08", "2026-09-09");
      assert.match(JSON.stringify(rangePlan), /SEARCH.*timeline_retention_idx/u);
      const runPlan = raw.prepare("EXPLAIN QUERY PLAN SELECT id FROM timeline_events WHERE retention_class='confirmed-operation' AND run_id=? ORDER BY confirmed_at,id LIMIT 10001").all(deletedIds[0] ?? "");
      assert.match(JSON.stringify(runPlan), /SEARCH.*timeline_run_transactions_idx/u);
    } finally { spy.mockRestore(); }
  } finally { w.dispose(); }
});
}

{

const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_ATOMIC_WRITE_COMMIT_m4);

const profiles: ReturnType<typeof createBoundProfileFixture>[] = [];
const _afterEachFixture0 = () => { for (const profile of profiles.splice(0)) profile.close(); };
function profileFixture() {
  const profile = createBoundProfileFixture({ sharedMachine: true });
  profiles.push(profile);
  return profile;
}
const ts = "2026-09-08T12:00:00.000Z";
function span() {
  return { t: "span.started" as const, kind: "worker" as const, ts, workflow: "person-lookup",
    pid: 123, workerId: "test-worker", spanPath: "worker/person-lookup/test-worker", name: "Worker" };
}
function event() {
  return TimelineAppendSchema.parse({ schemaVersion: 1, eventId: randomUUID(), workflow: "person-lookup",
    scope: { kind: "worker", workerId: "test-worker" }, occurredAt: ts, recordedAt: ts,
    retentionDate: "2026-09-08", payload: { kind: "span", event: span() }, source: { kind: "native" } });
}
function repository(database: DatabaseSync) {
  return createTimelineRepository({ database, read: (work) => work(), assertOwner: () => {},
    mutate: (work) => {
      database.exec("BEGIN IMMEDIATE");
      try { const { result } = work(); database.exec("COMMIT"); return result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    } });
}
function initialize(path: string): DatabaseSync {
  AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "timeline-baseline" }, manualClock(new Date(ts))).close();
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys=ON");
  return database;
}

describe("SQLite timeline delivery", () => {
afterEach(_afterEachFixture0);

  it("reads durable events from a separate producer process after lost notification and restart", () => {
    const path = profileFixture().path;
    const first = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "timeline-process-test" }, manualClock(new Date(ts)));
    const script = `
      import { AuthorityDatabase } from './src/backend/storage/sqlite/authority-database.ts';
      import { acquireEntrypointAdmission } from './src/backend/storage/admission/bootstrap-admission.ts';
      import { createProfileRegistry } from './src/backend/profiles/registry.ts';
      import { basename, dirname, resolve } from 'node:path';
      import { createTimelineEmitter } from './src/backend/storage/events/timeline-emitter.ts';
      import { manualClock } from './src/rules/time/clock.ts';
      const clock = manualClock(new Date(process.argv[2]));
      const path = process.argv[1];
      const machine = acquireEntrypointAdmission(resolve(dirname(path), '../../../..'), 'shared');
      const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(basename(dirname(path))));
      const db = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 500, migrationOwner: 'timeline-child' }, clock);
      try {
        const writer = createTimelineEmitter({ repository: db.authority.timelineEvents, clock });
        writer.emit({ t: 'span.started', kind: 'worker', workflow: 'person-lookup', ts: process.argv[2],
          workerId: 'child-worker', spanPath: 'worker/child-worker', name: 'Child worker' });
        writer.emit({ t: 'span.ended', kind: 'worker', workflow: 'person-lookup', ts: process.argv[2],
          workerId: 'child-worker', spanPath: 'worker/child-worker', outcome: 'done' });
      } finally { db.close(); admission.release(); machine.release(); }
    `;
    try {
      const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, path, "2026-09-08T00:30:00.000Z"],
        { cwd: process.cwd(), env: { ...process.env, TZ: "America/Los_Angeles" }, encoding: "utf8", timeout: 20_000 });
      expect(child.status, child.stderr).toBe(0);
      const rows = first.authority.timelineEvents.page({});
      expect(rows.length).toBe(2);
      expect(rows.map((row) => row.cursor)).toEqual([1, 2]);
      expect(rows.map((row) => row.retentionDate)).toEqual(["2026-09-07", "2026-09-07"]);
      first.close();
      const restarted = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "timeline-restarted" }, manualClock(new Date(ts)));
      try {
        expect(restarted.authority.timelineEvents.page({})).toEqual(rows);
        expect(restarted.authority.timelineEvents.pruneBefore("2026-09-07")).toBe(0);
        expect(restarted.authority.timelineEvents.pruneBefore("2026-09-08")).toBe(2);
      }
      finally { restarted.close(); }
    } finally { first.close(); }
  });

  it("pages across real connections and restart without collapsing equal timestamps or text", () => {
    const path = profileFixture().path;
    using first = initialize(path);
    using second = new DatabaseSync(path);
    const writer = repository(first);
    const reader = repository(second);
    const a = writer.append(event()).record;
    const b = writer.append(event()).record;
    expect(a.cursor).toBe(1);
    expect(b.cursor).toBe(2);
    expect(reader.page({ limit: 1 })).toEqual([a]);
    expect(reader.page({ after: a.cursor })).toEqual([b]);
    using restarted = new DatabaseSync(path);
    expect(repository(restarted).page({})).toEqual([a, b]);
  });

  it("replays exact event identity and rejects divergent content without consuming a cursor", () => {
    using database = initialize(profileFixture().path);
    const history = repository(database);
    const input = event();
    const first = history.append(input);
    expect(history.append(input)).toEqual({ state: "existing", record: first.record });
    expect(() => history.append({ ...input, recordedAt: "2026-09-08T12:01:00.000Z" })).toThrow("timeline-event-identity-conflict");
    expect(history.highWaterMark()).toBe(1);
    expect(history.page({})).toEqual([first.record]);
  });

  it("replays retained checkpoint and confirmation identities after the owner advances attempts", () => {
    const path = profileFixture().path;
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 500,
      migrationOwner: "timeline-replay-test" }, manualClock(new Date(ts)));
    try {
      seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, path);
      fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
      database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
      const records = database.authority.timelineEvents.page({});
      expect(records.map((record) => record.payload.kind)).toEqual(["checkpoint-recorded", "operation-confirmed"]);
      const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);
      if (run === undefined) throw new Error("missing replay owner");
      const requeued = database.authority.runs.requeue({ runId: run.envelope.runId,
        expectedVersion: run.version, cause: "recovery", now: ts });
      expect(requeued.state).toBe("applied");
      const before = database.getMeta();
      for (const record of records) {
        const { cursor: _cursor, ...input } = record;
        expect(database.authority.timelineEvents.append(input)).toEqual({ state: "existing", record });
        expect(() => database.authority.timelineEvents.append({ ...input, recordedAt: "2026-09-08T12:01:00.000Z" }))
          .toThrow("timeline-event-identity-conflict");
        expect(() => database.authority.timelineEvents.append({ ...input, eventId: randomUUID() }))
          .toThrow(record.payload.kind === "checkpoint-recorded" ? "timeline-checkpoint-reference-mismatch" : "timeline-identity-conflict");
      }
      expect(database.getMeta()).toEqual(before);
      expect(database.authority.timelineEvents.page({})).toEqual(records);
    } finally { database.close(); }
  });

  it("never reuses a cursor after every ordinary event was pruned", () => {
    using database = initialize(profileFixture().path);
    const history = repository(database);
    const first = history.append({ ...event(), payload: { kind: "span", event: { t: "span.ended", kind: "worker", ts, workflow: "person-lookup", pid: 123, workerId: "test-worker", spanPath: "worker/person-lookup/test-worker", outcome: "done" } } }).record;
    expect(history.pruneBefore("2026-09-09")).toBe(1);
    expect(history.highWaterMark()).toBe(first.cursor);
    expect(history.append({ ...event(), payload: { kind: "span", event: { t: "span.ended", kind: "worker", ts, workflow: "person-lookup", pid: 123, workerId: "test-worker", spanPath: "worker/person-lookup/test-worker", outcome: "done" } } }).record.cursor).toBe(first.cursor + 1);
  });

  it("pins a page horizon while a second connection appends", () => {
    const path = profileFixture().path;
    using database = initialize(path);
    using other = new DatabaseSync(path);
    const history = repository(database);
    const a = history.append(event()).record;
    const through = history.highWaterMark();
    const b = repository(other).append(event()).record;
    expect(history.page({ through })).toEqual([a]);
    expect(history.page({ after: through })).toEqual([b]);
  });

  it("rejects scope drift and mutation of immutable stored events", () => {
    using database = initialize(profileFixture().path);
    const history = repository(database);
    expect(() => history.append({ ...event(), scope: { kind: "worker", workerId: "different-worker" } })).toThrow();
    history.append(event());
    expect(() => database.exec("UPDATE timeline_events SET recorded_at='changed'")).toThrow("immutable");
  });

  it("enforces retained run ownership in SQLite", () => {
    using database = initialize(profileFixture().path);
    const input = event();
    const runId = randomUUID();
    const runEvent = { ...input, scope: { kind: "run", runId }, payload: { kind: "span", event: {
      t: "run.claimed", ts, workflow: "person-lookup", pid: 123, runId, attempt: 1,
      traceId: "pl-120000-abcd", spanPath: "pl-120000-abcd", workerId: "test-worker",
    } } };
    expect(() => repository(database).append(runEvent)).toThrow("FOREIGN KEY");
    expect(repository(database).highWaterMark()).toBe(0);
  });
});

function deleteRun(database: AuthorityDatabase, runId: string, commandId: string) {
  const run = database.authority.runs.get(runId);
  if (run === undefined) throw new Error("missing deletion owner");
  const service = new RunRecordService({ database, clock: manualClock(new Date(ts)), ids: { uuid: randomUUID },
    publishQueued: () => { throw new Error("deletion must not publish"); } });
  return service.delete({ runId, commandId, expectedVersion: run.version });
}
describe("retained confirmed history and shared retry deletion", () => {
afterEach(_afterEachFixture0);

  function committed() {
    return openConfirmedRetentionDatabase(profileFixture().path, ts, ATOMIC_WRITE_COMMIT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT);
  }
  it("reconstructs every current confirmation field and retains authenticated proof beyond pruning and deletion", () => {
    const { database, run } = committed();
    try {
      const before = database.authority.timelineEvents.page({});
      expect(before.map(row => row.payload.kind)).toEqual(["checkpoint-recorded", "operation-confirmed", "span"]);
      expect(before[2]?.payload).toMatchObject({ kind: "span", event: {
        t: "span.ended", kind: "run", runId: run.envelope.runId, outcome: "cancelled",
      } });
      expect(database.authority.timelineEvents.pruneBefore("2027-01-01")).toBe(1);
      expect(database.authority.timelineEvents.pruneBefore("2027-01-01")).toBe(0);
      const rows = database.authority.timelineEvents.page({});
      expect(rows.map(row => row.payload.kind)).toEqual(["checkpoint-recorded", "operation-confirmed"]);
      const record = rows[1]; if (record === undefined) throw new Error("missing confirmation");
      expect(reconstructConfirmedOperation(database.authority, record)).toEqual({ ledger: LEDGER_PAYLOAD, span: SPAN_OUTBOX_PAYLOAD });
      deleteRun(database, run.envelope.runId, UUID_5);
      expect(database.authority.timelineEvents.page({})).toEqual([]);
      const history = createTransactionHistory(database.authority).query({ from: "2000-01-01", to: "2100-01-01" });
      expect(history.rows).toHaveLength(1);
      expect(history.rows[0]?.presentation.pointer).toEqual({ state: "unavailable", reason: "delivery cursor removed by authenticated run deletion" });
      const tombstone = database.authority.deletedRuns.get(run.envelope.runId);
      expect(tombstone?.tallyVersion).toBe(3);
      expect(tombstone?.removed.find((entry) => entry.table === "timeline_events")?.rows).toBe(2);
    } finally { database.close(); }
  });
  it.each(["workflowId", "itemId"] as const)("refuses a run-owned operation with a contradictory %s", (field) => {
    const { database, run, path } = committed();
    try {
      const before = database.getMeta();
      {
        using raw = new DatabaseSync(path);
        const payload = raw.prepare("SELECT payload_json FROM write_intents WHERE id=?").get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.payload_json;
        assert.ok(typeof payload === "string");
        using _restore = { [Symbol.dispose]() { raw.prepare("UPDATE write_intents SET payload_json=? WHERE id=?").run(payload, WRITE_INTENT_ATTEMPTING.writeIntentId); } };
        raw.prepare("UPDATE write_intents SET payload_json = json_set(payload_json, ?, ?) WHERE id = ?")
          .run(`$.${field}`, field === "workflowId" ? "other-workflow" : randomUUID(), WRITE_INTENT_ATTEMPTING.writeIntentId);
        expect(() => deleteRun(database, run.envelope.runId, UUID_5))
          .toThrow(/confirmed|write-intent/u);
      }
      expect(database.getMeta()).toEqual(before);
      expect(database.authority.runs.get(run.envelope.runId)).toBeDefined();
      expect(database.authority.deletedRuns.get(run.envelope.runId)).toBeUndefined();
    } finally { database.close(); }
  });

  it("rolls back deletion when an operation has lost its current attempt", () => {
    const { database, run, path } = committed();
    try {
      // Model damaged retained ownership without removing the confirmed event.
      const before = database.getMeta();
      {
        using raw = new DatabaseSync(path);
        const attempt = raw.prepare("SELECT * FROM write_attempts WHERE id=?").get(WRITE_ATTEMPT.writeAttemptId);
        assert.ok(attempt);
        const trigger = raw.prepare("SELECT sql FROM sqlite_schema WHERE name='write_attempts_retained'").get()?.sql;
        assert.ok(typeof trigger === "string");
        using _restoreTrigger = { [Symbol.dispose]() { raw.exec(trigger); } };
        raw.exec("DROP TRIGGER write_attempts_retained");
        using _restoreAttempt = { [Symbol.dispose]() { raw.prepare("INSERT INTO write_attempts (id,intent_id,generation,run_id,payload_json,created_at) VALUES (?,?,?,?,?,?)")
          .run(attempt.id, attempt.intent_id, attempt.generation, attempt.run_id, attempt.payload_json, attempt.created_at); } };
        expect(raw.prepare("DELETE FROM write_attempts WHERE id = ?").run(WRITE_ATTEMPT.writeAttemptId).changes).toBe(1);
        expect(() => deleteRun(database, run.envelope.runId, UUID_5))
          .toThrow(/confirmed-history-attempt-mismatch/u);
      }
      expect(database.getMeta()).toEqual(before);
      expect(database.authority.runs.get(run.envelope.runId)).toBeDefined();
      expect(database.authority.deletedRuns.get(run.envelope.runId)).toBeUndefined();
    } finally { database.close(); }
  });

  it("preserves permanent write proof through source and last retry deletion", () => {
    const { database, run } = committed();
    const permanent = {
      intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
      attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId),
      publication: database.authority.writeIntents.getPublication(WRITE_INTENT_ATTEMPTING.writeIntentId),
    };
    try {
      const retry = RunRecordSchema.parse({ ...run,
        envelope: { ...run.envelope, runId: UUID_6, traceId: "se-120000-6666", attempt: 2,
          retryOf: run.envelope.runId, enqueuedAt: ts },
        lifecycle: { state: "queued" }, version: 1, createdAt: ts, updatedAt: ts });
      database.authority.runs.enqueue(retry);
      database.authority.timelineEvents.pruneBefore("2027-01-01");
      deleteRun(database, run.envelope.runId, UUID_5);
      expect(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status).toBe("committed");
      const checkpoint = atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT);
      expect(database.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId,
        checkpoint.attempt, checkpoint.claimGeneration)).toBeUndefined();
      expect(database.authority.timelineEvents.page({})).toEqual([]);
      const history = createTransactionHistory(database.authority).query({ from: "2000-01-01", to: "2100-01-01" });
      expect(history.rows).toHaveLength(1);
      expect(history.rows[0]?.presentation.pointer).toEqual({ state: "unavailable", reason: "delivery cursor removed by authenticated run deletion" });
      database.authority.runs.transition({ runId: retry.envelope.runId, expectedVersion: retry.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
      deleteRun(database, retry.envelope.runId, UUID_6);
      expect(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status).toBe("committed");
      expect(database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId)?.outcome.state).toBe("committed");
      expect({ intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
        attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId),
        publication: database.authority.writeIntents.getPublication(WRITE_INTENT_ATTEMPTING.writeIntentId) }).toEqual(permanent);
      expect(database.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId,
        checkpoint.attempt, checkpoint.claimGeneration)).toBeUndefined();
      expect(database.authority.deletedRuns.get(run.envelope.runId)).toBeDefined();
      expect(database.authority.deletedRuns.get(retry.envelope.runId)?.removed.find((entry) => entry.table === "run_checkpoints")).toBeUndefined();
    } finally { database.close(); }
  });

});
}
