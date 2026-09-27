import { createTransactionHistory } from "../../../src/infra/sqlite/transaction-history.js";
import { RunRecordService } from "../../../src/core/run-record-service.js";
import { currentAtomicWriteFixture, atomicWriteCheckpoint, seedAtomicWriteOwner } from "../helpers/timeline-write-fixture.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT, UUID_5, UUID_6, LEDGER_PAYLOAD, SPAN_OUTBOX_PAYLOAD } from "../../fixtures/phase1c-contract-fixtures.js";
import { reconstructConfirmedOperation } from "../../../src/events/confirmed-operation.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { spawnSync } from "node:child_process";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { manualClock } from "../../../src/domain/clock.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineAppendSchema } from "../../../src/events/timeline.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import { createTimelineRepository, TIMELINE_EVENT_INDEX_DDL, TIMELINE_EVENT_TABLE_DDL } from "../../../src/infra/sqlite/timeline-repository.js";
import { inspectTimelineSources, preserveTimelineSources, readPreservedTimelineSources,
  timelineImportRecords } from "../../../src/infra/events/timeline-import.js";
import type { VerifiedBackup } from "../../../src/infra/sqlite/backup-service.js";

const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_ATOMIC_WRITE_COMMIT);

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function root(): string {
  const path = mkdtempSync(join(tmpdir(), "timeline-"));
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
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE workflow_runs(record_key TEXT PRIMARY KEY) STRICT");
  database.exec("CREATE TABLE deleted_runs(record_key TEXT PRIMARY KEY) STRICT");
  database.exec(TIMELINE_EVENT_TABLE_DDL);
  for (const sql of TIMELINE_EVENT_INDEX_DDL) database.exec(sql);
  return database;
}

describe("SQLite timeline delivery", () => {
  it("reads durable events from a separate producer process after lost notification and restart", () => {
    const path = join(root(), "cross-process.db");
    const first = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "timeline-process-test" }, manualClock(new Date(ts)));
    const script = `
      import { AuthorityDatabase } from './src/infra/sqlite/authority-database.ts';
      import { createTimelineEmitter } from './src/infra/events/timeline-emitter.ts';
      import { manualClock } from './src/domain/clock.ts';
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
    const database = AuthorityDatabase.open({ path: join(root(), "replay.db"), busyTimeoutMs: 500,
      migrationOwner: "timeline-replay-test" }, manualClock(new Date(ts)));
    try {
      seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT);
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
          .toThrow(/timeline-checkpoint-reference-mismatch|confirmed-history-run-mismatch/u);
      }
      expect(database.getMeta()).toEqual(before);
      expect(database.authority.timelineEvents.page({})).toEqual(records);
    } finally { database.close(); }
  });

  it("never reuses a cursor after every ordinary event was pruned", () => {
    using database = initialize(join(root(), "state.db"));
    const history = repository(database);
    const first = history.append(event()).record;
    expect(history.pruneBefore("2026-09-09")).toBe(1);
    expect(history.highWaterMark()).toBe(first.cursor);
    expect(history.append(event()).record.cursor).toBe(first.cursor + 1);
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
    expect(() => database.exec("UPDATE timeline_events SET created_at='changed'")).toThrow("immutable");
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

// The file-copy unit consumes only this already-verified backup binding. Full
// upgrade tests exercise the real backup verifier and stopped admission.
function backup(stateRoot: string): VerifiedBackup {
  return { manifestPath: join(stateRoot, "backups", "source.manifest.json"), backupPath: join(stateRoot, "backups", "source.db"),
    manifest: { sha256: "a".repeat(64), sourceDatabaseIdentity: "b".repeat(64), authorityGeneration: 4 } } as VerifiedBackup;
}
function sources(bytes: string) {
  const path = root();
  mkdirSync(join(path, "spans"));
  mkdirSync(join(path, "backups"));
  writeFileSync(join(path, "spans", "person-lookup-2026-07-01.jsonl"), bytes);
  return { path, evidence: backup(path) };
}

describe("verified timeline source copy", () => {
  it("preserves exact bytes and original retention day with separate equal-timestamp events", () => {
    const bytes = `${JSON.stringify(span())}\n${JSON.stringify(span())}\n`;
    const { path, evidence } = sources(bytes);
    const snapshot = inspectTimelineSources(path, evidence);
    const directory = preserveTimelineSources(snapshot, evidence);
    expect(readFileSync(join(directory, snapshot.files[0].relativePath), "utf8")).toBe(bytes);
    const restored = readPreservedTimelineSources(directory, snapshot.digest, evidence);
    const records = timelineImportRecords(restored, ts);
    expect(records).toHaveLength(2);
    expect(records[0].eventId).not.toBe(records[1].eventId);
    expect(records.map((record) => record.retentionDate)).toEqual(["2026-07-01", "2026-07-01"]);
    expect(timelineImportRecords(restored, ts)).toEqual(records);
    expect(preserveTimelineSources(snapshot, evidence)).toBe(directory);
  });

  it.each(["{\"private\":\"DO-NOT-PRINT\"}\n", JSON.stringify(span()), "\n"])("refuses malformed/torn input without exposing payload: %s", (bytes) => {
    const { path, evidence } = sources(bytes);
    let message = "";
    try { inspectTimelineSources(path, evidence); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("timeline-source-invalid");
    expect(message).not.toContain("DO-NOT-PRINT");
  });

  it("refuses an invalid append date even for an empty source file", () => {
    const { path, evidence } = sources("");
    rmSync(join(path, "spans", "person-lookup-2026-07-01.jsonl"));
    writeFileSync(join(path, "spans", "person-lookup-2026-13-01.jsonl"), "");
    expect(() => inspectTimelineSources(path, evidence)).toThrow(/timeline-source-invalid/u);
  });

  it.each(["file", "directory"])("refuses a linked source %s and restores cwd", (kind) => {
    const { path, evidence } = sources(`${JSON.stringify(span())}\n`);
    const other = root();
    const previous = process.cwd();
    if (kind === "directory") {
      rmSync(join(path, "spans"), { recursive: true });
      symlinkSync(other, join(path, "spans"));
    } else {
      const name = "person-lookup-2026-07-01.jsonl";
      writeFileSync(join(other, name), `${JSON.stringify(span())}\n`);
      rmSync(join(path, "spans", name));
      symlinkSync(join(other, name), join(path, "spans", name));
    }
    expect(() => inspectTimelineSources(path, evidence)).toThrow(/timeline-source/u);
    expect(process.cwd()).toBe(previous);
  });

  it("refuses snapshot mutation before creating a recovery copy", () => {
    const { path, evidence } = sources(`${JSON.stringify(span())}\n`);
    const snapshot = inspectTimelineSources(path, evidence);
    snapshot.files[0].bytes[0] = 0;
    expect(() => preserveTimelineSources(snapshot, evidence)).toThrow(/snapshot-mismatch/u);
  });

  it("rejects altered recovery bytes and a backup binding mismatch", () => {
    const { path, evidence } = sources(`${JSON.stringify(span())}\n`);
    const snapshot = inspectTimelineSources(path, evidence);
    const directory = preserveTimelineSources(snapshot, evidence);
    const different = { ...evidence, manifest: { ...evidence.manifest, sha256: FingerprintSchema.parse("c".repeat(64)) } };
    expect(() => readPreservedTimelineSources(directory, snapshot.digest, different)).toThrow("binding-mismatch");
    // Deliberate fault injection: replace an otherwise read-only recovery file.
    const file = join(directory, snapshot.files[0].relativePath);
    rmSync(file);
    writeFileSync(file, `${JSON.stringify({ ...span(), pid: 456 })}\n`);
    expect(() => readPreservedTimelineSources(directory, snapshot.digest, evidence)).toThrow("content-mismatch");
  });
});


describe("retained confirmed history and shared retry deletion", () => {
  function committed() {
    const path = join(root(), "confirmed.db");
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 500,
      migrationOwner: "confirmed-retention-test" }, manualClock(new Date(ts)));
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT);
    database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
    const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);
    if (run === undefined) throw new Error("missing fixture owner");
    database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
    return { database, run, path };
  }
  it("reconstructs every old ledger/span field and retains confirmation beyond ordinary pruning", () => {
    const { database, run } = committed();
    try {
      expect(database.authority.timelineEvents.pruneBefore("2027-01-01")).toBe(1);
      const rows = database.authority.timelineEvents.page({});
      expect(rows.length).toBe(1);
      expect(rows[0]?.payload.kind).toBe("operation-confirmed");
      const record = rows[0]; if (record === undefined) throw new Error("missing confirmation");
      expect(reconstructConfirmedOperation(database.authority, record)).toEqual({ ledger: LEDGER_PAYLOAD, span: SPAN_OUTBOX_PAYLOAD });
      database.authority.runs.delete({ runId: run.envelope.runId, origin: "queue", commandId: UUID_5, now: ts });
      expect(database.authority.timelineEvents.page({})).toEqual([]);
      expect(createTransactionHistory(database.authority).query({ from: "2000-01-01", to: "2100-01-01" }).rows).toEqual([]);
      const tombstone = database.authority.deletedRuns.get(run.envelope.runId);
      expect(tombstone?.tallyVersion).toBe(3);
      expect(tombstone?.removed.find((entry) => entry.table === "timeline_events")?.rows).toBe(1);
    } finally { database.close(); }
  });
  it.each(["workflowId", "itemId"] as const)("refuses a run-owned operation with a contradictory %s", (field) => {
    const { database, run, path } = committed();
    try {
      const raw = new DatabaseSync(path);
      try { raw.prepare("UPDATE run_operations SET record_json = json_set(record_json, ?, ?) WHERE record_key = ?")
        .run(`$.${field}`, field === "workflowId" ? "other-workflow" : randomUUID(), WRITE_INTENT_ATTEMPTING.writeIntentId); }
      finally { raw.close(); }
      const before = database.getMeta();
      expect(() => database.authority.runs.delete({ runId: run.envelope.runId, origin: "queue", commandId: UUID_5, now: ts }))
        .toThrow("run-delete-operation-column-mismatch");
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
      try { raw.prepare("DELETE FROM run_operation_attempts WHERE record_key = ?").run(WRITE_ATTEMPT.writeAttemptId); }
      finally { raw.close(); }
      const before = database.getMeta();
      expect(() => database.authority.runs.delete({ runId: run.envelope.runId, origin: "queue", commandId: UUID_5, now: ts }))
        .toThrow(/run-delete-current-attempt-missing/u);
      expect(database.getMeta()).toEqual(before);
      expect(database.authority.runs.get(run.envelope.runId)).toBeDefined();
      expect(database.authority.deletedRuns.get(run.envelope.runId)).toBeUndefined();
    } finally { database.close(); }
  });

  it("preserves exact shared evidence after source deletion and collects it when the last retry is deleted", () => {
    const { database, run } = committed();
    try {
      const retry = RunRecordSchema.parse({ ...run,
        envelope: { ...run.envelope, runId: UUID_6, traceId: "se-120000-6666", attempt: 2,
          retryOf: run.envelope.runId, enqueuedAt: ts },
        lifecycle: { state: "queued" }, version: 1, createdAt: ts, updatedAt: ts });
      database.authority.runs.enqueue(retry);
      database.authority.timelineEvents.pruneBefore("2027-01-01");
      database.authority.runs.delete({ runId: run.envelope.runId, origin: "queue", commandId: UUID_5, now: ts });
      expect(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status).toBe("committed");
      const checkpoint = atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT);
      expect(database.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId,
        checkpoint.attempt, checkpoint.claimGeneration)).toEqual(checkpoint);
      expect(database.authority.timelineEvents.page({})).toEqual([]);
      expect(createTransactionHistory(database.authority).query({ from: "2000-01-01", to: "2100-01-01" }).rows).toEqual([]);
      database.authority.runs.transition({ runId: retry.envelope.runId, expectedVersion: retry.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
      database.authority.runs.delete({ runId: retry.envelope.runId, origin: "queue", commandId: UUID_6, now: ts });
      expect(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)).toBeUndefined();
      expect(database.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId,
        checkpoint.attempt, checkpoint.claimGeneration)).toBeUndefined();
      expect(database.authority.deletedRuns.get(run.envelope.runId)).toBeDefined();
      expect(database.authority.deletedRuns.get(retry.envelope.runId)?.removed.find((entry) => entry.table === "run_checkpoints")?.rows).toBe(1);
    } finally { database.close(); }
  });
  it("preserves ancestor evidence across deletion of an intermediate retry", () => {
    const { database, run } = committed();
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
      expect(readCheckpoint()).toEqual(checkpoint);
      database.authority.runs.transition({ runId: descendant.envelope.runId, expectedVersion: descendant.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: ts }, now: ts });
      remove(descendant.envelope.runId, "87000000-0000-4000-8000-000000000004");
      expect(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)).toBeUndefined();
      expect(readCheckpoint()).toBeUndefined();
      expect(database.authority.deletedRuns.get(descendant.envelope.runId)?.removed.find(
        (entry) => entry.table === "run_checkpoints")?.rows).toBe(1);
    } finally { database.close(); }
  });

});
