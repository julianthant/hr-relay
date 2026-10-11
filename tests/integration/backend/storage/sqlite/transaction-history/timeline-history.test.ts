import { createTransactionHistory } from "../../../../../../src/backend/storage/sqlite/transaction-history.js";
import { RunRecordService } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { currentAtomicWriteFixture, atomicWriteCheckpoint, seedAtomicWriteOwner } from "../../../../../support/helpers/timeline-write-fixture.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT, UUID_5, UUID_6, LEDGER_PAYLOAD, SPAN_OUTBOX_PAYLOAD } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { reconstructConfirmedOperation } from "../../../../../../src/models/events/confirmed-operation.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { spawnSync } from "node:child_process";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineAppendSchema } from "../../../../../../src/models/events/timeline.js";
import { createTimelineRepository } from "../../../../../../src/backend/storage/sqlite/timeline-repository.js";

const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_ATOMIC_WRITE_COMMIT);

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function root(): string {
  const path = mkdtempSync(join(realpathSync(tmpdir()), "timeline-"));
  roots.push(path);
  return path;
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
  it("reads durable events from a separate producer process after lost notification and restart", () => {
    const path = join(root(), "cross-process.db");
    const first = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "timeline-process-test" }, manualClock(new Date(ts)));
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
    const path = join(root(), "state.db");
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
    using database = initialize(join(root(), "state.db"));
    const history = repository(database);
    const input = event();
    const first = history.append(input);
    expect(history.append(input)).toEqual({ state: "existing", record: first.record });
    expect(() => history.append({ ...input, recordedAt: "2026-09-08T12:01:00.000Z" })).toThrow("timeline-event-identity-conflict");
    expect(history.highWaterMark()).toBe(1);
    expect(history.page({})).toEqual([first.record]);
  });

  it("replays retained checkpoint and confirmation identities after the owner advances attempts", () => {
    const path = join(root(), "replay.db");
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 500,
      migrationOwner: "timeline-replay-test" }, manualClock(new Date(ts)));
    try {
      seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, path);
      database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
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
    using database = initialize(join(root(), "state.db"));
    const history = repository(database);
    const first = history.append({ ...event(), payload: { kind: "span", event: { t: "span.ended", kind: "worker", ts, workflow: "person-lookup", pid: 123, workerId: "test-worker", spanPath: "worker/person-lookup/test-worker", outcome: "done" } } }).record;
    expect(history.pruneBefore("2026-09-09")).toBe(1);
    expect(history.highWaterMark()).toBe(first.cursor);
    expect(history.append({ ...event(), payload: { kind: "span", event: { t: "span.ended", kind: "worker", ts, workflow: "person-lookup", pid: 123, workerId: "test-worker", spanPath: "worker/person-lookup/test-worker", outcome: "done" } } }).record.cursor).toBe(first.cursor + 1);
  });

  it("pins a page horizon while a second connection appends", () => {
    const path = join(root(), "state.db");
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
    using database = initialize(join(root(), "state.db"));
    const history = repository(database);
    expect(() => history.append({ ...event(), scope: { kind: "worker", workerId: "different-worker" } })).toThrow();
    history.append(event());
    expect(() => database.exec("UPDATE timeline_events SET recorded_at='changed'")).toThrow("immutable");
  });

  it("enforces retained run ownership in SQLite", () => {
    using database = initialize(join(root(), "state.db"));
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
  function committed() {
    const path = join(root(), "confirmed.db");
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 500,
      migrationOwner: "confirmed-retention-test" }, manualClock(new Date(ts)));
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, path);
    database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
    const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);
    if (run === undefined) throw new Error("missing fixture owner");
    database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
    return { database, run, path };
  }
  it("reconstructs every current confirmation field and retains authenticated proof beyond pruning and deletion", () => {
    const { database, run } = committed();
    try {
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
      const raw = new DatabaseSync(path);
      try { raw.prepare("UPDATE write_intents SET payload_json = json_set(payload_json, ?, ?) WHERE id = ?")
        .run(`$.${field}`, field === "workflowId" ? "other-workflow" : randomUUID(), WRITE_INTENT_ATTEMPTING.writeIntentId); }
      finally { raw.close(); }
      const before = database.getMeta();
      expect(() => deleteRun(database, run.envelope.runId, UUID_5))
        .toThrow(/confirmed|write-intent/u);
      expect(database.getMeta()).toEqual(before);
      expect(database.authority.runs.get(run.envelope.runId)).toBeDefined();
      expect(database.authority.deletedRuns.get(run.envelope.runId)).toBeUndefined();
    } finally { database.close(); }
  });

  it("rolls back deletion when an operation has lost its current attempt", () => {
    const { database, run, path } = committed();
    try {
      // Model damaged retained ownership without removing the confirmed event.
      const raw = new DatabaseSync(path);
      const trigger = String(raw.prepare("SELECT sql FROM sqlite_schema WHERE name='write_attempts_retained'").get()?.sql);
      try {
        raw.exec("DROP TRIGGER write_attempts_retained");
        expect(raw.prepare("DELETE FROM write_attempts WHERE id = ?").run(WRITE_ATTEMPT.writeAttemptId).changes).toBe(1);
      } finally { raw.exec(trigger); raw.close(); }
      const before = database.getMeta();
      expect(() => deleteRun(database, run.envelope.runId, UUID_5))
        .toThrow(/confirmed-history-attempt-mismatch/u);
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
  it("preserves permanent ancestor proof across intermediate and descendant deletion", () => {
    const { database, run } = committed();
    const permanent = {
      intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
      attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId),
      publication: database.authority.writeIntents.getPublication(WRITE_INTENT_ATTEMPTING.writeIntentId),
    };
    const service = new RunRecordService({ database, clock: manualClock(new Date(ts)),
      ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("deletion must not publish"); } });
    const remove = (runId: string, commandId: string): void => {
      const retained = database.authority.runs.get(runId);
      if (retained === undefined) throw new Error("missing deletion owner");
      expect(service.delete({ runId, commandId, expectedVersion: retained.version }).state).toBe("deleted");
    };
    try {
      const retry = RunRecordSchema.parse({ ...run,
        envelope: { ...run.envelope, runId: UUID_6, traceId: "se-120000-6666", attempt: 2,
          retryOf: run.envelope.runId, enqueuedAt: ts },
        lifecycle: { state: "queued" }, version: 1, createdAt: ts, updatedAt: ts });
      database.authority.runs.enqueue(retry);
      remove(run.envelope.runId, UUID_5);
      database.authority.runs.transition({ runId: retry.envelope.runId, expectedVersion: retry.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
      const descendant = RunRecordSchema.parse({ ...retry, envelope: { ...retry.envelope,
        runId: "87000000-0000-4000-8000-000000000003", traceId: "se-120000-7777", attempt: 3,
        retryOf: retry.envelope.runId } });
      database.authority.runs.enqueue(descendant);
      const checkpoint = atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT);
      const readCheckpoint = () => database.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId,
        checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration);
      remove(retry.envelope.runId, UUID_6);
      expect(database.authority.runs.get(descendant.envelope.runId)).toBeDefined();
      expect(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status).toBe("committed");
      expect(readCheckpoint()).toBeUndefined();
      database.authority.runs.transition({ runId: descendant.envelope.runId, expectedVersion: descendant.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
      remove(descendant.envelope.runId, "87000000-0000-4000-8000-000000000004");
      expect(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status).toBe("committed");
      expect(database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId)?.outcome.state).toBe("committed");
      expect({ intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
        attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId),
        publication: database.authority.writeIntents.getPublication(WRITE_INTENT_ATTEMPTING.writeIntentId) }).toEqual(permanent);
      expect(readCheckpoint()).toBeUndefined();
      expect(database.authority.deletedRuns.get(descendant.envelope.runId)?.removed.find(
        (entry) => entry.table === "run_checkpoints")).toBeUndefined();
    } finally { database.close(); }
  });

});
