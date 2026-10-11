import assert_m0 from "node:assert/strict";
import { writeFileSync as writeFileSync_m0 } from "node:fs";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0,vi } from "vitest";
import { historyWorld as historyWorld_m0 } from "../../../support/helpers/storage/transaction-history-fixture.js";
/** Activity shape stays stable; confirmed database history replaces file folding. */
import { default as assert_m1,default as assert_m2,default as assert_m3 } from "node:assert/strict";
import { spawnSync as spawnSync_m4 } from "node:child_process";
import { randomUUID as randomUUID_m4 } from "node:crypto";
import { mkdtempSync as mkdtempSync_m4,realpathSync as realpathSync_m4,rmSync as rmSync_m4 } from "node:fs";
import { tmpdir as tmpdir_m4 } from "node:os";
import { join as join_m4 } from "node:path";
import { DatabaseSync as DatabaseSync_m3,DatabaseSync as DatabaseSync_m4 } from "node:sqlite";
import { afterEach as afterEach_m1,afterEach as afterEach_m2,afterEach as afterEach_m4,describe as describe_m1,describe as describe_m2,describe as describe_m4,expect as expect_m4,it as it_m1,it as it_m2,it as it_m3,it as it_m4 } from "vitest";
import { RunRecordService as RunRecordService_m4 } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createTimelineRepository as createTimelineRepository_m4 } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { createTransactionHistory as createTransactionHistory_m2,createTransactionHistory as createTransactionHistory_m4 } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { reconstructConfirmedOperation as reconstructConfirmedOperation_m4 } from "../../../../src/models/events/confirmed-operation.js";
import { TimelineAppendSchema as TimelineAppendSchema_m4 } from "../../../../src/models/events/timeline.js";
import { RunRecordSchema as RunRecordSchema_m4 } from "../../../../src/models/run/record.js";
import { localDatePart as localDatePart_m1,manualClock as manualClock_m4 } from "../../../../src/rules/time/clock.js";
import { fixtureUuid as fixtureUuid_m3 } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT_m4,LEDGER_PAYLOAD as LEDGER_PAYLOAD_m4,SPAN_OUTBOX_PAYLOAD as SPAN_OUTBOX_PAYLOAD_m4,UUID_5 as UUID_5_m4,UUID_6 as UUID_6_m4,WRITE_ATTEMPT as WRITE_ATTEMPT_m4,WRITE_INTENT_ATTEMPTING as WRITE_INTENT_ATTEMPTING_m4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testRunService as testRunService_m3 } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { historyClock as historyClock_m2,historyClock as historyClock_m3,historyWorld as historyWorld_m1,historyWorld as historyWorld_m2,historyWorld as historyWorld_m3 } from "../../../support/helpers/storage/transaction-history-fixture.js";
import { AuthorityDatabase as AuthorityDatabase_m2,AuthorityDatabase as AuthorityDatabase_m4 } from "../../../support/helpers/synthetic-storage-admission.js";
import { atomicWriteCheckpoint as atomicWriteCheckpoint_m4,currentAtomicWriteFixture as currentAtomicWriteFixture_m4,seedAtomicWriteOwner as seedAtomicWriteOwner_m4 } from "../../../support/helpers/timeline-write-fixture.js";


{

const cleanup: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const dispose of cleanup.splice(0)) dispose(); };
const range = { from: "2026-07-01", to: "2026-09-09" };
describe_m0("confirmed database transaction history", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("counts distinct operations at the same timestamp once after restart and ignores stale files", () => {
    const w = historyWorld_m0(); cleanup.push(() => w.dispose());
    w.commit(1); w.commit(2); const before = w.history.query(range);
    assert_m0.equal(before.rows.length, 2); assert_m0.equal(new Set(before.rows.map((row) => row.eventId)).size, 2);
    w.reopen(); assert_m0.deepEqual(w.history.query(range), before);
    writeFileSync_m0(`${w.root}/obsolete-ledger.jsonl`, "corrupt stale file\n");
    assert_m0.deepEqual(w.history.query(range), before);
    assert_m0.deepEqual(w.history.foldActivityRange(range.from, range.to).systems, [{ system: "ucpath", entries: 2, prod: 2, test: 0 }]);
    assert_m0.equal(w.history.query({ ...range, system: "kuali" }).rows.length, 0);
  });
});
}

{

const cleanup: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const dispose of cleanup.splice(0)) dispose(); };
const instant = "2026-08-03T18:30:00.000Z"; const day = localDatePart_m1(new Date(instant));
function world() { const w = historyWorld_m1({ terminalize: true }); cleanup.push(() => w.dispose()); return w; }
describe_m1("Activity confirmed transaction fold", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("answers an empty block when nothing was confirmed", () => { assert_m1.deepEqual(world().history.foldActivityRange(day, day), { systems: [] }); });
  it_m1("folds system/instance and orders by count then system id", () => {
    const w = world();
    for (const [index, system, instance] of [[1, "ucpath", "prod"], [2, "ucpath", "prod"], [3, "ucpath", "test"], [4, "kuali", "prod"], [5, "crm", "test"]] as const) w.commit(index, { system, instance, confirmedAt: instant });
    assert_m1.deepEqual(w.history.foldActivityRange(day, day), { systems: [{ system: "ucpath", entries: 3, prod: 2, test: 1 }, { system: "crm", entries: 1, prod: 0, test: 1 }, { system: "kuali", entries: 1, prod: 1, test: 0 }] });
  });
  it_m1("uses the confirmation's local day across a UTC midnight", () => {
    const w = world(); const boundary = "2026-08-04T01:30:00.000Z"; w.commit(11, { confirmedAt: boundary });
    assert_m1.equal(w.history.foldActivityRange(localDatePart_m1(new Date(boundary)), localDatePart_m1(new Date(boundary))).systems[0].entries, 1);
  });
  it_m1("excludes outside confirmations and includes them in an expanded window", () => {
    const w = world(); w.commit(12, { confirmedAt: instant }); w.commit(13, { confirmedAt: "2026-08-06T18:30:00.000Z" });
    assert_m1.equal(w.history.foldActivityRange(day, day).systems[0].entries, 1); assert_m1.equal(w.history.foldActivityRange(day, "2026-08-07").systems[0].entries, 2);
  });
  it_m1("refuses a backwards range", () => { assert_m1.throws(() => world().history.foldActivityRange("2026-08-05", "2026-08-01"), /ends before it starts/u); });
});
}

{

const cleanup: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const dispose of cleanup.splice(0)) dispose(); };
const range = { from: "2026-07-01", to: "2026-09-09" };
describe_m2("native committed history readers", () => {
afterEach_m2(_afterEachFixture0);

  it_m2("two independent database readers and a restarted reader see the same committed identities", () => {
    const w = historyWorld_m2(); cleanup.push(() => w.dispose()); w.commit(401);
    const reader = AuthorityDatabase_m2.open({ path: w.path, busyTimeoutMs: 250, migrationOwner: "second-history-reader" }, historyClock_m2);
    try {
      assert_m2.deepEqual(createTransactionHistory_m2(reader.authority).query(range), w.history.query(range));
      w.commit(402); assert_m2.equal(createTransactionHistory_m2(reader.authority).query(range).rows.length, 2);
      w.reopen(); assert_m2.deepEqual(createTransactionHistory_m2(reader.authority).query(range), w.history.query(range));
    } finally { reader.close(); }
  });
});
}

{


const range = { from: "2026-07-01", to: "2026-09-09" };

it_m3("refuses missing retained confirmation publication instead of returning smaller totals", () => {
  const w = historyWorld_m3({ terminalize: true });
  try {
    const fixture = w.commit(804), runId = fixture.commit.transaction.runId;
    const run = w.database.authority.runs.get(runId); assert_m3.ok(run);
    assert_m3.equal(testRunService_m3(w.database, historyClock_m3).delete({ commandId: fixtureUuid_m3("missing-history-delete"),
      runId, expectedVersion: run.version }).state, "deleted");
    assert_m3.equal(w.history.query(range).rows.length, 1);
    using raw = new DatabaseSync_m3(w.path);
    const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='write_intents'").all();
    try {
      for (const trigger of triggers) raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
      assert_m3.equal(raw.prepare("UPDATE write_intents SET publication_json=NULL WHERE id=?").run(fixture.commit.transaction.writeIntentId).changes, 1);
    } finally { for (const trigger of triggers) raw.exec(String(trigger.sql)); }
    assert_m3.throws(() => w.history.query(range), /run-search-index-rebuild-required/u);
  } finally { w.dispose(); }
});

it_m3("bounds cold range/run selected evidence independently of unrelated current and deleted history", () => {
  const w = historyWorld_m3({ terminalize: true });
  try {
    const deletedIds: string[] = [];
    for (let index = 1000; index < 1120; index++) {
      const fixture = w.commit(index, { confirmedAt: index === 1000 ? "2026-09-08T18:00:00.000Z" : "2026-08-01T18:00:00.000Z" });
      if (index < 1040) {
        const run = w.database.authority.runs.get(fixture.commit.transaction.runId); assert_m3.ok(run);
        assert_m3.equal(testRunService_m3(w.database, historyClock_m3).delete({ commandId: fixtureUuid_m3(`bounded-delete-${index}`),
          runId: run.envelope.runId, expectedVersion: run.version }).state, "deleted");
        deletedIds.push(run.envelope.runId);
      }
    }
    w.reopen();
    const observed: Array<{ sql: string; rows: number }> = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restores the native receiver.
    const original = DatabaseSync_m3.prototype.prepare;
    const spy = vi.spyOn(DatabaseSync_m3.prototype, "prepare").mockImplementation(function(this: DatabaseSync_m3, sql: string) {
      const statement = original.call(this, sql);
      if (sql.includes("WITH sources AS")) {
        const all = statement.all.bind(statement);
        statement.all = (...args) => { const rows = Reflect.apply(all, statement, args) as ReturnType<typeof all>; observed.push({ sql, rows: rows.length }); return rows; };
      }
      return statement;
    });
    try {
      assert_m3.equal(w.history.query({ from: "2026-09-08", to: "2026-09-08" }).rows.length, 1);
      assert_m3.equal(observed.length, 1);
      assert_m3.ok(observed.every(row => row.rows <= 1));
      observed.length = 0;
      assert_m3.equal(w.history.query({ from: "0001-01-01", to: "9999-12-31", runId: deletedIds[1] }).rows.length, 1);
      assert_m3.equal(observed.length, 1);
      assert_m3.ok(observed.every(row => row.rows <= 1));
      w.commit(1120, { confirmedAt: "2026-09-08T18:00:00.000Z" }); observed.length = 0;
      assert_m3.equal(w.history.query({ from: "2026-09-08", to: "2026-09-08" }).rows.length, 2);
      assert_m3.equal(observed.length, 1);
      assert_m3.ok(observed.every(row => row.rows <= 2));
      observed.length = 0;
      assert_m3.equal(w.history.query({ from: "0001-01-01", to: "9999-12-31" }).rows.length, 121);
      assert_m3.equal(observed[0]?.rows, 121);
      using raw = new DatabaseSync_m3(w.path, { readOnly: true });
      const rangePlan = raw.prepare("EXPLAIN QUERY PLAN SELECT id FROM timeline_events WHERE retention_class='confirmed-operation' AND confirmed_at>=? AND confirmed_at<? ORDER BY confirmed_at,id LIMIT 10001").all("2026-09-08", "2026-09-09");
      assert_m3.match(JSON.stringify(rangePlan), /SEARCH.*timeline_retention_idx/u);
      const runPlan = raw.prepare("EXPLAIN QUERY PLAN SELECT id FROM timeline_events WHERE retention_class='confirmed-operation' AND run_id=? ORDER BY confirmed_at,id LIMIT 10001").all(deletedIds[0] ?? "");
      assert_m3.match(JSON.stringify(runPlan), /SEARCH.*timeline_run_transactions_idx/u);
    } finally { spy.mockRestore(); }
  } finally { w.dispose(); }
});
}

{


const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture_m4(HISTORICAL_ATOMIC_WRITE_COMMIT_m4);

const roots: string[] = [];
const _afterEachFixture0 = () => { for (const root of roots.splice(0)) rmSync_m4(root, { recursive: true, force: true }); };
function root(): string {
  const path = mkdtempSync_m4(join_m4(realpathSync_m4(tmpdir_m4()), "timeline-"));
  roots.push(path);
  return path;
}
const ts = "2026-09-08T12:00:00.000Z";
function span() {
  return { t: "span.started" as const, kind: "worker" as const, ts, workflow: "person-lookup",
    pid: 123, workerId: "test-worker", spanPath: "worker/person-lookup/test-worker", name: "Worker" };
}
function event() {
  return TimelineAppendSchema_m4.parse({ schemaVersion: 1, eventId: randomUUID_m4(), workflow: "person-lookup",
    scope: { kind: "worker", workerId: "test-worker" }, occurredAt: ts, recordedAt: ts,
    retentionDate: "2026-09-08", payload: { kind: "span", event: span() }, source: { kind: "native" } });
}
function repository(database: DatabaseSync_m4) {
  return createTimelineRepository_m4({ database, read: (work) => work(), assertOwner: () => {},
    mutate: (work) => {
      database.exec("BEGIN IMMEDIATE");
      try { const { result } = work(); database.exec("COMMIT"); return result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    } });
}
function initialize(path: string): DatabaseSync_m4 {
  AuthorityDatabase_m4.open({ path, busyTimeoutMs: 500, migrationOwner: "timeline-baseline" }, manualClock_m4(new Date(ts))).close();
  const database = new DatabaseSync_m4(path);
  database.exec("PRAGMA foreign_keys=ON");
  return database;
}

describe_m4("SQLite timeline delivery", () => {
afterEach_m4(_afterEachFixture0);

  it_m4("reads durable events from a separate producer process after lost notification and restart", () => {
    const path = join_m4(root(), "cross-process.db");
    const first = AuthorityDatabase_m4.open({ path, busyTimeoutMs: 500, migrationOwner: "timeline-process-test" }, manualClock_m4(new Date(ts)));
    const script = `
      import { AuthorityDatabase } from './tests/support/helpers/synthetic-database-admission.ts';
      import { createTimelineEmitter } from './src/backend/storage/events/timeline-emitter.ts';
      import { manualClock } from './src/rules/time/clock.ts';
      const clock = manualClock(new Date(process.argv[2]));
      const db = AuthorityDatabase.open({ path: process.argv[1], busyTimeoutMs: 500, migrationOwner: 'timeline-child' }, clock);
      try {
        const writer = createTimelineEmitter({ repository: db.authority.timelineEvents, clock });
        writer.emit({ t: 'span.started', kind: 'worker', workflow: 'person-lookup', ts: process.argv[2],
          workerId: 'child-worker', spanPath: 'worker/child-worker', name: 'Child worker' });
        writer.emit({ t: 'span.ended', kind: 'worker', workflow: 'person-lookup', ts: process.argv[2],
          workerId: 'child-worker', spanPath: 'worker/child-worker', outcome: 'done' });
      } finally { db.close(); }
    `;
    try {
      const child = spawnSync_m4(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, path, "2026-09-08T00:30:00.000Z"],
        { cwd: process.cwd(), env: { ...process.env, TZ: "America/Los_Angeles" }, encoding: "utf8", timeout: 20_000 });
      expect_m4(child.status, child.stderr).toBe(0);
      const rows = first.authority.timelineEvents.page({});
      expect_m4(rows.length).toBe(2);
      expect_m4(rows.map((row) => row.cursor)).toEqual([1, 2]);
      expect_m4(rows.map((row) => row.retentionDate)).toEqual(["2026-09-07", "2026-09-07"]);
      first.close();
      const restarted = AuthorityDatabase_m4.open({ path, busyTimeoutMs: 500, migrationOwner: "timeline-restarted" }, manualClock_m4(new Date(ts)));
      try {
        expect_m4(restarted.authority.timelineEvents.page({})).toEqual(rows);
        expect_m4(restarted.authority.timelineEvents.pruneBefore("2026-09-07")).toBe(0);
        expect_m4(restarted.authority.timelineEvents.pruneBefore("2026-09-08")).toBe(2);
      }
      finally { restarted.close(); }
    } finally { first.close(); }
  });

  it_m4("pages across real connections and restart without collapsing equal timestamps or text", () => {
    const path = join_m4(root(), "state.db");
    using first = initialize(path);
    using second = new DatabaseSync_m4(path);
    const writer = repository(first);
    const reader = repository(second);
    const a = writer.append(event()).record;
    const b = writer.append(event()).record;
    expect_m4(a.cursor).toBe(1);
    expect_m4(b.cursor).toBe(2);
    expect_m4(reader.page({ limit: 1 })).toEqual([a]);
    expect_m4(reader.page({ after: a.cursor })).toEqual([b]);
    using restarted = new DatabaseSync_m4(path);
    expect_m4(repository(restarted).page({})).toEqual([a, b]);
  });

  it_m4("replays exact event identity and rejects divergent content without consuming a cursor", () => {
    using database = initialize(join_m4(root(), "state.db"));
    const history = repository(database);
    const input = event();
    const first = history.append(input);
    expect_m4(history.append(input)).toEqual({ state: "existing", record: first.record });
    expect_m4(() => history.append({ ...input, recordedAt: "2026-09-08T12:01:00.000Z" })).toThrow("timeline-event-identity-conflict");
    expect_m4(history.highWaterMark()).toBe(1);
    expect_m4(history.page({})).toEqual([first.record]);
  });

  it_m4("replays retained checkpoint and confirmation identities after the owner advances attempts", () => {
    const path = join_m4(root(), "replay.db");
    const database = AuthorityDatabase_m4.open({ path, busyTimeoutMs: 500,
      migrationOwner: "timeline-replay-test" }, manualClock_m4(new Date(ts)));
    try {
      seedAtomicWriteOwner_m4(database, ATOMIC_WRITE_COMMIT, path);
      database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING_m4, attempt: WRITE_ATTEMPT_m4 });
      database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint_m4(ATOMIC_WRITE_COMMIT));
      const records = database.authority.timelineEvents.page({});
      expect_m4(records.map((record) => record.payload.kind)).toEqual(["checkpoint-recorded", "operation-confirmed"]);
      const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING_m4.runId);
      if (run === undefined) throw new Error("missing replay owner");
      const requeued = database.authority.runs.requeue({ runId: run.envelope.runId,
        expectedVersion: run.version, cause: "recovery", now: ts });
      expect_m4(requeued.state).toBe("applied");
      const before = database.getMeta();
      for (const record of records) {
        const { cursor: _cursor, ...input } = record;
        expect_m4(database.authority.timelineEvents.append(input)).toEqual({ state: "existing", record });
        expect_m4(() => database.authority.timelineEvents.append({ ...input, recordedAt: "2026-09-08T12:01:00.000Z" }))
          .toThrow("timeline-event-identity-conflict");
        expect_m4(() => database.authority.timelineEvents.append({ ...input, eventId: randomUUID_m4() }))
          .toThrow(record.payload.kind === "checkpoint-recorded" ? "timeline-checkpoint-reference-mismatch" : "timeline-identity-conflict");
      }
      expect_m4(database.getMeta()).toEqual(before);
      expect_m4(database.authority.timelineEvents.page({})).toEqual(records);
    } finally { database.close(); }
  });

  it_m4("never reuses a cursor after every ordinary event was pruned", () => {
    using database = initialize(join_m4(root(), "state.db"));
    const history = repository(database);
    const first = history.append({ ...event(), payload: { kind: "span", event: { t: "span.ended", kind: "worker", ts, workflow: "person-lookup", pid: 123, workerId: "test-worker", spanPath: "worker/person-lookup/test-worker", outcome: "done" } } }).record;
    expect_m4(history.pruneBefore("2026-09-09")).toBe(1);
    expect_m4(history.highWaterMark()).toBe(first.cursor);
    expect_m4(history.append({ ...event(), payload: { kind: "span", event: { t: "span.ended", kind: "worker", ts, workflow: "person-lookup", pid: 123, workerId: "test-worker", spanPath: "worker/person-lookup/test-worker", outcome: "done" } } }).record.cursor).toBe(first.cursor + 1);
  });

  it_m4("pins a page horizon while a second connection appends", () => {
    const path = join_m4(root(), "state.db");
    using database = initialize(path);
    using other = new DatabaseSync_m4(path);
    const history = repository(database);
    const a = history.append(event()).record;
    const through = history.highWaterMark();
    const b = repository(other).append(event()).record;
    expect_m4(history.page({ through })).toEqual([a]);
    expect_m4(history.page({ after: through })).toEqual([b]);
  });

  it_m4("rejects scope drift and mutation of immutable stored events", () => {
    using database = initialize(join_m4(root(), "state.db"));
    const history = repository(database);
    expect_m4(() => history.append({ ...event(), scope: { kind: "worker", workerId: "different-worker" } })).toThrow();
    history.append(event());
    expect_m4(() => database.exec("UPDATE timeline_events SET recorded_at='changed'")).toThrow("immutable");
  });

  it_m4("enforces retained run ownership in SQLite", () => {
    using database = initialize(join_m4(root(), "state.db"));
    const input = event();
    const runId = randomUUID_m4();
    const runEvent = { ...input, scope: { kind: "run", runId }, payload: { kind: "span", event: {
      t: "run.claimed", ts, workflow: "person-lookup", pid: 123, runId, attempt: 1,
      traceId: "pl-120000-abcd", spanPath: "pl-120000-abcd", workerId: "test-worker",
    } } };
    expect_m4(() => repository(database).append(runEvent)).toThrow("FOREIGN KEY");
    expect_m4(repository(database).highWaterMark()).toBe(0);
  });
});

function deleteRun(database: AuthorityDatabase_m4, runId: string, commandId: string) {
  const run = database.authority.runs.get(runId);
  if (run === undefined) throw new Error("missing deletion owner");
  const service = new RunRecordService_m4({ database, clock: manualClock_m4(new Date(ts)), ids: { uuid: randomUUID_m4 },
    publishQueued: () => { throw new Error("deletion must not publish"); } });
  return service.delete({ runId, commandId, expectedVersion: run.version });
}
describe_m4("retained confirmed history and shared retry deletion", () => {
afterEach_m4(_afterEachFixture0);

  function committed() {
    const path = join_m4(root(), "confirmed.db");
    const database = AuthorityDatabase_m4.open({ path, busyTimeoutMs: 500,
      migrationOwner: "confirmed-retention-test" }, manualClock_m4(new Date(ts)));
    seedAtomicWriteOwner_m4(database, ATOMIC_WRITE_COMMIT, path);
    database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING_m4, attempt: WRITE_ATTEMPT_m4 });
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint_m4(ATOMIC_WRITE_COMMIT));
    const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING_m4.runId);
    if (run === undefined) throw new Error("missing fixture owner");
    database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
    return { database, run, path };
  }
  it_m4("reconstructs every current confirmation field and retains authenticated proof beyond pruning and deletion", () => {
    const { database, run } = committed();
    try {
      expect_m4(database.authority.timelineEvents.pruneBefore("2027-01-01")).toBe(0);
      const rows = database.authority.timelineEvents.page({});
      expect_m4(rows.map(row => row.payload.kind)).toEqual(["checkpoint-recorded", "operation-confirmed"]);
      const record = rows[1]; if (record === undefined) throw new Error("missing confirmation");
      expect_m4(reconstructConfirmedOperation_m4(database.authority, record)).toEqual({ ledger: LEDGER_PAYLOAD_m4, span: SPAN_OUTBOX_PAYLOAD_m4 });
      deleteRun(database, run.envelope.runId, UUID_5_m4);
      expect_m4(database.authority.timelineEvents.page({})).toEqual([]);
      const history = createTransactionHistory_m4(database.authority).query({ from: "2000-01-01", to: "2100-01-01" });
      expect_m4(history.rows).toHaveLength(1);
      expect_m4(history.rows[0]?.presentation.pointer).toEqual({ state: "unavailable", reason: "delivery cursor removed by authenticated run deletion" });
      const tombstone = database.authority.deletedRuns.get(run.envelope.runId);
      expect_m4(tombstone?.tallyVersion).toBe(3);
      expect_m4(tombstone?.removed.find((entry) => entry.table === "timeline_events")?.rows).toBe(2);
    } finally { database.close(); }
  });
  it_m4.each(["workflowId", "itemId"] as const)("refuses a run-owned operation with a contradictory %s", (field) => {
    const { database, run, path } = committed();
    try {
      const raw = new DatabaseSync_m4(path);
      try { raw.prepare("UPDATE write_intents SET payload_json = json_set(payload_json, ?, ?) WHERE id = ?")
        .run(`$.${field}`, field === "workflowId" ? "other-workflow" : randomUUID_m4(), WRITE_INTENT_ATTEMPTING_m4.writeIntentId); }
      finally { raw.close(); }
      const before = database.getMeta();
      expect_m4(() => deleteRun(database, run.envelope.runId, UUID_5_m4))
        .toThrow(/confirmed|write-intent/u);
      expect_m4(database.getMeta()).toEqual(before);
      expect_m4(database.authority.runs.get(run.envelope.runId)).toBeDefined();
      expect_m4(database.authority.deletedRuns.get(run.envelope.runId)).toBeUndefined();
    } finally { database.close(); }
  });

  it_m4("rolls back deletion when an operation has lost its current attempt", () => {
    const { database, run, path } = committed();
    try {
      // Model damaged retained ownership without removing the confirmed event.
      const raw = new DatabaseSync_m4(path);
      const trigger = String(raw.prepare("SELECT sql FROM sqlite_schema WHERE name='write_attempts_retained'").get()?.sql);
      try {
        raw.exec("DROP TRIGGER write_attempts_retained");
        expect_m4(raw.prepare("DELETE FROM write_attempts WHERE id = ?").run(WRITE_ATTEMPT_m4.writeAttemptId).changes).toBe(1);
      } finally { raw.exec(trigger); raw.close(); }
      const before = database.getMeta();
      expect_m4(() => deleteRun(database, run.envelope.runId, UUID_5_m4))
        .toThrow(/confirmed-history-attempt-mismatch/u);
      expect_m4(database.getMeta()).toEqual(before);
      expect_m4(database.authority.runs.get(run.envelope.runId)).toBeDefined();
      expect_m4(database.authority.deletedRuns.get(run.envelope.runId)).toBeUndefined();
    } finally { database.close(); }
  });

  it_m4("preserves permanent write proof through source and last retry deletion", () => {
    const { database, run } = committed();
    const permanent = {
      intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING_m4.writeIntentId),
      attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT_m4.writeAttemptId),
      publication: database.authority.writeIntents.getPublication(WRITE_INTENT_ATTEMPTING_m4.writeIntentId),
    };
    try {
      const retry = RunRecordSchema_m4.parse({ ...run,
        envelope: { ...run.envelope, runId: UUID_6_m4, traceId: "se-120000-6666", attempt: 2,
          retryOf: run.envelope.runId, enqueuedAt: ts },
        lifecycle: { state: "queued" }, version: 1, createdAt: ts, updatedAt: ts });
      database.authority.runs.enqueue(retry);
      database.authority.timelineEvents.pruneBefore("2027-01-01");
      deleteRun(database, run.envelope.runId, UUID_5_m4);
      expect_m4(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING_m4.writeIntentId)?.status).toBe("committed");
      const checkpoint = atomicWriteCheckpoint_m4(ATOMIC_WRITE_COMMIT);
      expect_m4(database.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId,
        checkpoint.attempt, checkpoint.claimGeneration)).toBeUndefined();
      expect_m4(database.authority.timelineEvents.page({})).toEqual([]);
      const history = createTransactionHistory_m4(database.authority).query({ from: "2000-01-01", to: "2100-01-01" });
      expect_m4(history.rows).toHaveLength(1);
      expect_m4(history.rows[0]?.presentation.pointer).toEqual({ state: "unavailable", reason: "delivery cursor removed by authenticated run deletion" });
      database.authority.runs.transition({ runId: retry.envelope.runId, expectedVersion: retry.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
      deleteRun(database, retry.envelope.runId, UUID_6_m4);
      expect_m4(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING_m4.writeIntentId)?.status).toBe("committed");
      expect_m4(database.authority.writeAttempts.get(WRITE_ATTEMPT_m4.writeAttemptId)?.outcome.state).toBe("committed");
      expect_m4({ intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING_m4.writeIntentId),
        attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT_m4.writeAttemptId),
        publication: database.authority.writeIntents.getPublication(WRITE_INTENT_ATTEMPTING_m4.writeIntentId) }).toEqual(permanent);
      expect_m4(database.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId,
        checkpoint.attempt, checkpoint.claimGeneration)).toBeUndefined();
      expect_m4(database.authority.deletedRuns.get(run.envelope.runId)).toBeDefined();
      expect_m4(database.authority.deletedRuns.get(retry.envelope.runId)?.removed.find((entry) => entry.table === "run_checkpoints")).toBeUndefined();
    } finally { database.close(); }
  });

});
}
